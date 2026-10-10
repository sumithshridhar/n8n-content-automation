// Behaviour of the JavaScript inside the workflows' Code nodes.
// The code is read out of the JSON and run in a sandbox with mocked n8n globals
// ($input, $("Node"), items). No n8n, no network, no LLM.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { codeOf, load, node, runCode } from "./helpers.mjs";

const faceless = load("faceless");
const viral = load("viral");
const ig = load("ig");

const scene = (index, sentence, visual) => ({ index, sentence, visual });
const llmJson = (scenes) => JSON.stringify({ scenes });

// ---- faceless-yt-shorts-factory.json (the local-Ollama copy, node names end in "1") ----

test("faceless / Filter Viral Posts1: only posts with 1000+ upvotes that are not stickied or NSFW can be picked", () => {
  const post = (title, ups, extra = {}) => ({ data: { title, ups, stickied: false, over_18: false, ...extra } });
  const reddit = { data: { children: [post("pinned", 9000, { stickied: true }), post("nsfw", 9000, { over_18: true }), post("low", 999), post("good", 1000)] } };
  const [out] = runCode(codeOf(faceless, "Filter Viral Posts1"), {
    items: [{ json: reddit }],
    nodes: { "Chaos Seed1": [{ json: { hook: "H", music_url: "M", seed: 7 } }] },
  });
  assert.deepEqual(out.json, { topic: "good", hook: "H", music_url: "M", seed: 7 });
});

test("faceless / Filter Viral Posts1: falls back to a built-in topic when nothing qualifies or Reddit returns nothing", () => {
  for (const reddit of [{ data: { children: [] } }, {}]) {
    const [out] = runCode(codeOf(faceless, "Filter Viral Posts1"), {
      items: [{ json: reddit }],
      nodes: { "Chaos Seed1": [{ json: { hook: "H", music_url: "M", seed: 1 } }] },
    });
    assert.equal(out.json.topic, "The psychological reason you can't fall asleep at night");
  }
});

test("faceless / JSON Parser1: turns the model's JSON into scenes and maps visual keywords to Pexels searches", () => {
  const raw = llmJson([scene(1, "One.", "brain"), scene(2, "Two.", "Ocean"), scene(3, "Three.", "something odd")]);
  const [out] = runCode(codeOf(faceless, "JSON Parser1"), { items: [{ json: { text: raw } }], nodes: { "Quality Gate1": [{ json: { music_url: "M" } }] } });
  assert.deepEqual(out.json.scenes.map((s) => s.visual), ["neural network abstract", "deep ocean dark", "something odd"]);
  assert.equal(out.json.music_url, "M");
});

test("faceless / JSON Parser1: strips <think> blocks and code fences before parsing", () => {
  const raw = "<think>planning...</think>\n```json\n" + llmJson([scene(1, "Hello.", "void")]) + "\n```";
  const [out] = runCode(codeOf(faceless, "JSON Parser1"), { items: [{ json: { text: raw } }], nodes: { "Quality Gate1": [{ json: {} }] } });
  assert.deepEqual(out.json.scenes, [scene(1, "Hello.", "black void abstract")]);
});

test("faceless / JSON Parser1: keeps at most 6 scenes and drops scenes with no sentence", () => {
  const many = Array.from({ length: 9 }, (_, i) => scene(i + 1, `Line ${i + 1}.`, "brain"));
  const [capped] = runCode(codeOf(faceless, "JSON Parser1"), { items: [{ json: { text: llmJson(many) } }], nodes: { "Quality Gate1": [{ json: {} }] } });
  assert.equal(capped.json.scenes.length, 6);
  const [dropped] = runCode(codeOf(faceless, "JSON Parser1"), { items: [{ json: { text: llmJson([scene(1, "", "brain"), scene(2, "Kept.", "brain")]) } }], nodes: { "Quality Gate1": [{ json: {} }] } });
  assert.deepEqual(dropped.json.scenes.map((s) => s.sentence), ["Kept."]);
});

test("faceless / JSON Parser1: unusable model output gives the 5 built-in fallback scenes", () => {
  for (const text of ["not json at all", "{\"scenes\": []}", "", "{broken"]) {
    const [out] = runCode(codeOf(faceless, "JSON Parser1"), { items: [{ json: { text } }], nodes: { "Quality Gate1": [{ json: {} }] } });
    assert.equal(out.json.scenes.length, 5, JSON.stringify(text));
    assert.equal(out.json.scenes[0].sentence, "Your brain processes 11 million bits of information every second.");
  }
});

test("faceless / Split Scenes1: one item per scene with its audio and clip file names", () => {
  const items = runCode(codeOf(faceless, "Split Scenes1"), { items: [{ json: { scenes: [scene(1, "A", "x"), scene(2, "B", "y")], music_url: "M" } }] });
  assert.equal(items.length, 2);
  assert.equal(items[1].json.audio_filename, "audio_2.mp3");
  assert.equal(items[1].json.visual_filename, "scene_2_visual.mp4");
  assert.equal(items[1].json.total_scenes, 2);
});

const pickerNodes = { "Split Scenes1": [{ json: { index: 2, base_folder: "C:\\work", visual_filename: "scene_2_visual.mp4", audio_filename: "audio_2.mp3", sentence: "S", music_url: "M", total_scenes: 5 } }] };
const clip = (quality, width, link) => ({ quality, width, link });

test("faceless / Smart Media Picker1: prefers an HD clip of at least 720 px wide", () => {
  const pexels = { videos: [{ video_files: [clip("sd", 640, "https://example.test/sd.mp4"), clip("hd", 1080, "https://example.test/hd.mp4")] }] };
  const [out] = runCode(codeOf(faceless, "Smart Media Picker1"), { items: [{ json: pexels }], nodes: pickerNodes });
  assert.match(out.json.downloadCommand, /example\.test\/hd\.mp4/);
  assert.match(out.json.downloadCommand, /scene_2_visual\.mp4/);
});

test("faceless / Smart Media Picker1: with no results it makes a purple placeholder clip instead of failing", () => {
  const [out] = runCode(codeOf(faceless, "Smart Media Picker1"), { items: [{ json: { videos: [] } }], nodes: pickerNodes });
  assert.match(out.json.downloadCommand, /^ffmpeg .*color=c=purple/);
});

test("faceless / Quality Gate1: strips <think> blocks and passes the script and music on", () => {
  const [out] = runCode(codeOf(faceless, "Quality Gate1"), {
    items: [{ json: { text: "<think>hmm</think>APPROVE" } }],
    nodes: { "Script Writer1": [{ json: { text: "<think>draft</think>The script." } }], "Filter Viral Posts1": [{ json: { music_url: "M" } }] },
  });
  assert.equal(out.json.script, "The script.");
  assert.equal(out.json.critic_output, "APPROVE");
  assert.equal(out.json.music_url, "M");
});

test("faceless / Prep Merge1: builds an ffmpeg command from the scene's paths", () => {
  const [out] = runCode(codeOf(faceless, "Prep Merge1"), { items: [{ json: { base_folder: "C:\\work", index: 3, music_url: "M", total_scenes: 5 } }] });
  assert.match(out.json.mergeCommand, /scene_3_visual\.mp4/);
  assert.match(out.json.mergeCommand, /audio_3\.mp3/);
  assert.match(out.json.mergeCommand, /part_3\.mp4/);
});

// ---- viral-shorts-factory-native-ai.json -------------------------------------------

const viralParserNodes = { "6. Quality Check2": [{ json: { music_url: "M" } }] };

test("viral / 2. Filter Viral Posts3: the upvote threshold is 3000, and the default topic is used when nothing qualifies", () => {
  const post = (title, ups) => ({ data: { title, ups, stickied: false, over_18: false } });
  const nodes = { "0. Chaos Seed5": [{ json: { hook: "H", music_url: "M", seed: 1, retry_count: 0 } }] };
  const run = (children) => runCode(codeOf(viral, "2. Filter Viral Posts3"), { items: [{ json: { data: { children } } }], nodes })[0].json;
  assert.equal(run([post("below", 2999), post("at", 3000)]).topic, "at");
  assert.equal(run([post("below", 2999)]).topic, "Signs of High Intelligence");
});

test("viral / 8. JSON Parser2: maps visuals, appends ' aesthetic' to unknown ones, and caps at 6 scenes", () => {
  const scenes = [scene(1, "A.", "Brain"), scene(2, "B.", "volcano"), ...Array.from({ length: 6 }, (_, i) => scene(i + 3, `L${i}.`, "calm"))];
  const [out] = runCode(codeOf(viral, "8. JSON Parser2"), { items: [{ json: { text: llmJson(scenes) } }], nodes: viralParserNodes });
  assert.equal(out.json.scenes.length, 6);
  assert.deepEqual(out.json.scenes.slice(0, 2).map((s) => s.visual), ["neural network abstract", "volcano aesthetic"]);
  assert.equal(out.json.music_url, "M");
});

test("viral / 8. JSON Parser2: unusable model output gives the 5 built-in fallback scenes", () => {
  for (const text of ["no json here", "{\"scenes\": []}"]) {
    const [out] = runCode(codeOf(viral, "8. JSON Parser2"), { items: [{ json: { text } }], nodes: viralParserNodes });
    assert.equal(out.json.scenes.length, 5, text);
  }
});

test("viral / 9. Split Scenes2: one item per scene with its file names", () => {
  const items = runCode(codeOf(viral, "9. Split Scenes2"), { nodes: { "8. JSON Parser2": [{ json: { scenes: [scene(1, "A", "x"), scene(2, "", "y")], music_url: "M" } }] } });
  assert.equal(items.length, 2);
  assert.equal(items[0].json.audio_filename, "audio_1.mp3");
  assert.equal(items[1].json.sentence, "Something is happening.", "an empty sentence gets a placeholder");
});

const loopItem = { index: 2, base_folder: "C:\\work", visual: "v", visual_filename: "scene_2_visual.mp4", audio_filename: "audio_2.mp3", music_url: "M" };

test("viral / 10. Smart Media Picker2: prefers HD, and falls back to a placeholder clip when Pexels returns nothing", () => {
  const nodes = { "Loop Batches7": [{ json: loopItem }] };
  const withClips = { videos: [{ video_files: [clip("sd", 640, "https://example.test/sd.mp4"), clip("hd", 1080, "https://example.test/hd.mp4")] }] };
  const [hd] = runCode(codeOf(viral, "10. Smart Media Picker2"), { items: [{ json: withClips }], nodes });
  assert.match(hd.json.download_cmd, /example\.test\/hd\.mp4/);
  const [none] = runCode(codeOf(viral, "10. Smart Media Picker2"), { items: [{ json: { videos: [] } }], nodes });
  assert.match(none.json.download_cmd, /^ffmpeg .*color=c=purple/);
});

test("viral / 12. Prep Merge2: recovers the scene's paths from the loop node, because the SSH step's output does not carry them", () => {
  const sshResult = { code: 0, signal: null, stdout: "", stderr: "" };
  const [out] = runCode(codeOf(viral, "12. Prep Merge2"), { items: [{ json: sshResult }], nodes: { "Loop Batches7": [{ json: loopItem }] } });
  assert.match(out.json.merge_cmd, /scene_2_visual\.mp4/);
  assert.match(out.json.merge_cmd, /audio_2\.mp3/);
  assert.match(out.json.merge_cmd, /part_2\.mp4/);
  assert.doesNotMatch(out.json.merge_cmd, /undefined/);
});

test("viral / 14. ASS Script2: produces a base64 Python script that uses Whisper and writes subs.ass", () => {
  const [out] = runCode(codeOf(viral, "14. ASS Script2"));
  const python = Buffer.from(out.json.b64_script, "base64").toString("utf8");
  assert.match(python, /import whisper/);
  assert.match(python, /subs\.ass/);
});

// ---- the embedded subtitle script and the IG workflow ------------------------------

test("faceless / ASS Subtitle Generator1: the embedded base64 script decodes to valid Python", (t) => {
  const code = codeOf(faceless, "ASS Subtitle Generator1");
  const b64 = code.match(/const b64_script = "([^"]+)"/)[1];
  const python = Buffer.from(b64, "base64").toString("utf8");
  assert.match(python, /^import sys/);
  assert.match(python, /subs\.ass/);
  for (const exe of ["python3", "python"]) {
    const probe = spawnSync(exe, ["--version"], { encoding: "utf8" });
    if (probe.error || probe.status !== 0) continue; // not installed (or a Windows Store stub), try the next
    const r = spawnSync(exe, ["-c", "import sys; compile(sys.stdin.read(), 'gen_subs.py', 'exec')"], { input: python, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return;
  }
  t.diagnostic("no Python found: only the text of the script was checked");
});

test("ig / Initialize Workflow State: reads the screen size from `adb shell wm size` and defaults to 1080x2408", () => {
  const run = (output) => runCode(codeOf(ig, "Initialize Workflow State"), { items: [{ json: { output } }] });
  assert.deepEqual([run("Physical size: 720x1600").width, run("Physical size: 720x1600").height], [720, 1600]);
  assert.deepEqual([run("garbage").width, run("garbage").height], [1080, 2408]);
});

test("ig / Initialize Workflow State: every named tap position is a fraction of the screen", () => {
  const { coordinates } = runCode(codeOf(ig, "Initialize Workflow State"), { items: [{ json: { output: "" } }] });
  for (const [name, { x, y }] of Object.entries(coordinates)) {
    assert.ok(x > 0 && x < 1 && y > 0 && y < 1, name);
  }
});

test("ig / the reachable chain only calls adb with fixed commands (no text from other nodes is spliced into a shell command)", () => {
  for (const n of ig.nodes.filter((x) => x.type === "n8n-nodes-base.executeCommand")) {
    assert.doesNotMatch(n.parameters.command, /\{\{|\$json/, n.name);
  }
});

test("sanity: the nodes these tests rely on still exist", () => {
  for (const [wf, name] of [[faceless, "Quality Gate1"], [viral, "6. Quality Check2"], [ig, "Vision Analysis"]]) node(wf, name);
});
