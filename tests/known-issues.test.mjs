// Problems found by reading the exports. Each test asserts the behaviour we WANT.
//
//   GAP: ...   fails today. It is reported as TODO and does not fail the run.
//   (no GAP)   already true in at least one workflow; kept to show the contrast.
//
// None of these were found by running n8n. They come from the JSON, from the code in the
// Code nodes, and from reading n8n's own node source (Loop Over Items, Wait, Execute
// Command). See the README for the plain-English list.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { FILES, allStrings, codeOf, gap, load, reachableFrom, runCode, targetsOf } from "./helpers.mjs";

const faceless = load("faceless");
const viral = load("viral");
const ig = load("ig");

const isModelNode = (n) => /\.lm[A-Z]/.test(n.type); // chat-model sub-nodes use a different connection type
const triggerOf = (wf) => wf.nodes.find((n) => n.type === "n8n-nodes-base.manualTrigger").name;
const unreachable = (wf) => {
  const seen = reachableFrom(wf, triggerOf(wf));
  return wf.nodes.filter((n) => !isModelNode(n) && !seen.has(n.name)).map((n) => n.name);
};

// ---- the manual trigger should start the whole pipeline ---------------------------
gap(`${FILES.faceless}: every node is reachable from the manual trigger`,
  "the trigger feeds the first copy (Gemini, emptied out); the second copy starts at 'Chaos Seed1' with no input",
  () => assert.deepEqual(unreachable(faceless), []));

gap(`${FILES.viral}: every node is reachable from the manual trigger`,
  "'Start Workflow' is connected to nothing; the pipeline only runs if you execute it from '0. Chaos Seed5'",
  () => assert.deepEqual(unreachable(viral), []));

gap(`${FILES.ig}: every node is reachable from the manual trigger`,
  "only 10 of the 30 flow nodes are reachable (blind taps). The screenshot, vision and retry nodes are not connected to the trigger",
  () => assert.deepEqual(unreachable(ig), []));

// ---- nothing should be missing from the export ------------------------------------
gap(`${FILES.faceless}: no Code node is empty`,
  "7 Code nodes in the first copy have a language but no code",
  () => {
    const empty = faceless.nodes.filter((n) => n.type === "n8n-nodes-base.code" && !(n.parameters.jsCode ?? "").trim());
    assert.deepEqual(empty.map((n) => n.name), []);
  });

const promptText = (n) => {
  const p = n.parameters ?? {};
  const fromMessages = (p.messages?.messageValues ?? []).map((m) => m.message ?? "").join("");
  return `${typeof p.text === "string" ? p.text : ""}${fromMessages}`.trim();
};
const llmNodesWithoutPrompt = (wf) => wf.nodes.filter((n) => n.type.endsWith(".chainLlm") && !promptText(n)).map((n) => n.name);

test(`${FILES.viral}: every LLM chain node has a prompt`, () => assert.deepEqual(llmNodesWithoutPrompt(viral), []));

gap(`${FILES.faceless}: every LLM chain node has a prompt`,
  "all 8 LLM chain nodes have no prompt text in this export",
  () => assert.deepEqual(llmNodesWithoutPrompt(faceless), []));

gap(`${FILES.ig}: the vision node is told what to look for`,
  "the screenshot is sent with no instruction text, and nothing reads the answer",
  () => assert.deepEqual(llmNodesWithoutPrompt(ig), []));

// ---- the critic's verdict should decide whether a script goes on ------------------
const rejectedByCritic = { items: [{ json: { text: "REJECT" } }] };

gap(`${FILES.faceless}: Quality Gate1 stops a script the critic rejected`,
  "it always returns approved: true and ignores the critic's text",
  () => {
    const [out] = runCode(codeOf(faceless, "Quality Gate1"), {
      ...rejectedByCritic,
      nodes: { "Script Writer1": [{ json: { text: "A script." } }], "Filter Viral Posts1": [{ json: { music_url: "M" } }] },
    });
    assert.equal(out.json.approved, false);
  });

gap(`${FILES.viral}: 6. Quality Check2 stops a script the critic rejected`,
  "the code says 'Always approve for now' and never reads the critic",
  () => {
    const out = runCode(codeOf(viral, "6. Quality Check2"), {
      ...rejectedByCritic,
      nodes: { "4. Script Writer2": [{ json: { text: "A script." } }], "0. Chaos Seed5": [{ json: { music_url: "M" } }] },
    });
    assert.ok(out.length === 0 || out[0].json.approved === false);
  });

// ---- the scene loop should loop ----------------------------------------------------
// In Loop Over Items v3 output 0 is "done" and output 1 is "loop" (checked in n8n's
// source). The work for each scene must hang off output 1 and lead back to the loop.
function loopsBack(wf, loopName) {
  const start = targetsOf(wf, loopName, 1);
  const seen = new Set();
  const stack = [...start];
  while (stack.length) {
    const name = stack.pop();
    if (name === loopName) return true;
    if (seen.has(name)) continue;
    seen.add(name);
    for (const out of Object.values(wf.connections[name] ?? {}).flatMap((byType) => byType)) stack.push(...out.map((t) => t.node));
  }
  return false;
}
const loopNodes = (wf) => wf.nodes.filter((n) => n.type === "n8n-nodes-base.splitInBatches").map((n) => n.name);

test(`${FILES.viral}: the per-scene branch hangs off the 'loop' output and returns to the loop node`, () => {
  assert.deepEqual(loopNodes(viral).filter((name) => !loopsBack(viral, name)), []);
});

gap(`${FILES.faceless}: the per-scene branch hangs off the 'loop' output and returns to the loop node`,
  "the per-scene nodes are wired to output 0 ('done') and the subtitle step to output 1 ('loop'): the reverse of the viral workflow",
  () => assert.deepEqual(loopNodes(faceless).filter((name) => !loopsBack(faceless, name)), []));

// ---- data must reach the step that needs it ---------------------------------------
gap(`${FILES.faceless}: Prep Merge1 still builds a valid command after Execute Command`,
  "Execute Command returns only exitCode, stderr and stdout, so base_folder, index and the rest are undefined here",
  () => {
    const executeCommandResult = { exitCode: 0, stderr: "", stdout: "" };
    const [out] = runCode(codeOf(faceless, "Prep Merge1"), { items: [{ json: executeCommandResult }] });
    assert.doesNotMatch(out.json.mergeCommand, /undefined/);
  });

gap(`${FILES.viral}: the stitch step does not hard-code a part that may not exist`,
  "it lists part_1 to part_6, but the scene splitter asks for 5-6 scenes and the fallback has 5",
  () => {
    const command = viral.nodes.find((n) => n.name === "15. Stitch + Generate ASS2").parameters.command;
    const parts = [...command.matchAll(/part_(\d+)\.mp4/g)].map((m) => Number(m[1]));
    assert.ok(Math.max(...parts) <= 5, `lists up to part_${Math.max(...parts)}`);
  });

// ---- the IG workflow's labels should match what the nodes do -----------------------
gap(`${FILES.ig}: a Wait node called "Wait Ns" waits N seconds`,
  "n8n's Wait node defaults to 1 for amount and hours for unit, and several labels disagree with their settings",
  () => {
    const wrong = [];
    for (const n of ig.nodes.filter((x) => x.type === "n8n-nodes-base.wait")) {
      const label = /^Wait (\d+)s/.exec(n.name);
      if (!label) continue;
      const { amount = 1, unit = "hours" } = n.parameters;
      if (unit !== "seconds" || amount !== Number(label[1])) wrong.push(`${n.name}: ${amount} ${unit}`);
    }
    assert.deepEqual(wrong, []);
  });

// ---- text from a model should not reach a shell unchanged -------------------------
gap(`${FILES.faceless}: model text is cleaned before it goes into a cmd.exe command`,
  "only double quotes and line breaks are replaced; %NAME% would still be expanded by cmd.exe",
  () => {
    const command = faceless.nodes.find((n) => n.name === "Generate TTS Audio1").parameters.command;
    const expression = /\{\{\s*(\$json\.sentence\.replace[\s\S]*?)\s*\}\}/.exec(command)[1];
    const cleaned = vm.runInNewContext(expression, { $json: { sentence: "It costs %USERNAME% a lot" } });
    assert.doesNotMatch(cleaned, /%/);
  });

// ---- local details that should not be in a public export ---------------------------
gap("the exports contain no personal local paths",
  "4 values hard-code a Windows user folder (faceless: 2, viral: 2)",
  () => {
    const found = [];
    for (const key of Object.keys(FILES)) {
      for (const text of allStrings(load(key))) {
        if (/[A-Za-z]:\\{1,2}Users\\{1,2}[^\\]+/.test(text)) found.push(FILES[key]);
      }
    }
    assert.deepEqual(found, []);
  });
