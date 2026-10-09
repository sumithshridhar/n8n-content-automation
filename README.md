# n8n content automation

Three n8n workflow exports from a Reddit-to-Shorts video pipeline, plus tests that check them.

The pipeline takes a popular Reddit topic and has local LLMs write a short script. It then makes a voice-over and picks stock footage for each scene, and stitches everything into a captioned 720x1280 video. A separate workflow taps through Instagram on an Android phone to post a finished video.

## Read this first: status of each export

I checked these files by reading the JSON and by running the Code-node JavaScript in a test harness. I did not run the workflows end to end from this repo. Reading them shows that only one is close to runnable. The list is below, and each item has a test in `tests/known-issues.test.mjs`.

| File | Nodes | What it is | State of this export |
|---|---|---|---|
| [`viral-shorts-factory-native-ai.json`](workflows/viral-shorts-factory-native-ai.json) | 26 | The full pipeline. Every LLM call goes to local Ollama. Heavy steps run over SSH. | **Closest to runnable.** The Start node is not connected to anything. Execute it from `0. Chaos Seed5`. |
| [`faceless-yt-shorts-factory.json`](workflows/faceless-yt-shorts-factory.json) | 49 | Two copies of the pipeline on one canvas. Copy 1 uses Gemini. Copy 2 (node names end in `1`) uses local Ollama. | **Not runnable as exported.** Details below. |
| [`ig-reel-auto-post-retry-robust.json`](workflows/ig-reel-auto-post-retry-robust.json) | 31 | Posts a video to Instagram by sending `adb` taps to an Android phone. | The trigger reaches 10 blind-tap nodes. The screenshot, vision and retry nodes (the "robust" part) are not connected to it. |

## Why it is worth a look

- It shows a whole content pipeline built from free parts: public Reddit JSON, local LLMs (Ollama), a Pexels key, ffmpeg and Whisper. No paid LLM API is used on the Ollama paths.
- It shows several n8n patterns: LLM chains, Code nodes holding real logic, a batch loop, shell and SSH execution, and phone control over `adb`.
- The tests document what is broken, and show how to unit-test n8n Code nodes without running n8n.

## Architecture (viral-shorts-factory-native-ai)

```
0 Chaos Seed ─► 1 Reddit Scraper ─► 2 Filter Viral Posts ─► 3 Vision Analysis (LLM) ─► 4 Script Writer (LLM)
  random subreddit,   hot.json,        3000+ upvotes, not        a 10-word visual          40-50 word script
  hook, music         no login         pinned or NSFW            mood                      with a fixed hook
                                                                                              │
   ┌──────────────────────────────────────────────────────────────────────────────────────────┘
   ▼
5 AI Critic (LLM) ─► 6 Quality Check ─► 7 Scene Splitter (LLM) ─► 8 JSON Parser ─► 9 Split Scenes ─► Loop Batches
  APPROVE/REJECT      always passes        5-6 scenes as JSON       fallback scenes     one item per        │
  (not used yet)      the script on                                 if the JSON is bad  scene               │
                                                                                                           │
   for each scene (loop output)                                                                            │ when all scenes are done
   8 Generate Audio (Piper, over SSH)                                                                      │
   9 Pexels search ─► 10 pick an HD clip ─► 11 download ─► 12/13 merge audio + clip ─► back to the loop    │
                                                                                                           ▼
   14 build the Whisper caption script ─► 15 stitch parts, add music, make captions ─► 16 mix + burn captions ─► 17 archive and clean up
```

The two Code-node steps with real logic are `8. JSON Parser` (strips `<think>` blocks and code fences, caps scenes at 6, maps keywords to search terms, falls back to 5 canned scenes) and `10. Smart Media Picker` (prefers an HD clip at least 720 px wide, makes a placeholder clip if there are no results).

## What you would need to run it

This is read from the nodes, not from a run.

- **n8n.** The exports do not record which version made them. I confirmed three n8n behaviours behind the known problems (the Loop node's output order, the Wait node's defaults, and what Execute Command returns) in the source of n8n 2.6.4.
- **Windows.** The commands use `cmd.exe` and PowerShell (`cd /d`, `copy`, `del`). The folder `C:\reddit vids n8n\satisfying` must exist. For the viral workflow this is on the SSH target.
- **Ollama** with `deepseek-r1:7b`. The IG vision node uses `llava:latest`.
- **Piper** and the voice file `en_US-ryan-high.onnx` at the hard-coded path (viral workflow). The faceless workflow instead calls `generate_voice_kokoro.py`, which is not in this repo.
- **ffmpeg** on the path, and **Python** with `openai-whisper`.
- **A Pexels API key.** Replace `YOUR_PEXELS_API_KEY` in the Authorization header of the Pexels node.
- **n8n credentials** for Ollama and SSH (password login). Credentials are included only as references (id and name), never as values.
- **For the IG workflow:** an Android phone with USB debugging, `adb` on the path, and the folder `C:\phone ss`. Tap positions are for a 1080x2408 screen.

Then import a file with `Import from File` in n8n, fix the credentials, and run it.

## Known problems

Found by reading the exports. None are fixed yet.

- **The manual trigger does not start the whole pipeline in any of the three.** Viral: it connects to nothing. Faceless: it feeds copy 1, whose Code nodes are almost all empty. IG: it reaches 10 of the 30 flow nodes.
- **The critic does not decide anything.** In the viral workflow `6. Quality Check` says "Always approve for now". In faceless copy 2 `Quality Gate1` returns `approved: true` every time. There is no loop back to regenerate a rejected script.
- **The faceless export is missing parts.** Seven of the eight Code nodes in copy 1 are empty, and none of the 8 LLM nodes (4 in each copy) has a prompt. Its scene loop has the `done` and `loop` outputs the wrong way round. `Prep Merge1` reads fields that the Execute Command node before it does not pass on, so it builds a command containing `undefined`.
- **The viral stitch step lists exactly six parts** (`part_1` to `part_6`), but the splitter can return five scenes and the fallback has five.
- **IG:** several Wait nodes are labelled with a time that differs from their setting (for example "Wait 2s" is set to 5 seconds, "Wait 3s" waits 1 second). The vision node gets a screenshot with no instruction, and its answer is not used.
- **Model text goes into shell commands.** Only double quotes and line breaks are replaced, so something like `%USERNAME%` in a script would be expanded by `cmd.exe`. Download links from the Pexels response are also placed into PowerShell commands.
- **Cleanup deletes by wildcard** (`*.txt`, `*.py`, `*.mp3`) in a fixed working folder, and nothing clears leftover `part_*.mp4` files at the start of a run. A failed run can leave parts that the next run stitches in.
- **No schedule trigger.** All three start from a manual trigger.
- **Local details are in the files.** A Windows user folder is hard-coded in 4 values.

Before using any of this, check the terms of Reddit, Pexels, the music sources and Instagram. Automating a personal Instagram account may break its terms.

## Security

No API keys, tokens, passwords or webhook URLs are in the files. The Pexels key is a placeholder. The tests scan for common secret formats and check that every Authorization header is a `YOUR_...` placeholder.

## Tests

No install step and no dependencies. Needs Node's built-in test runner. Written and run on Node 24.

```bash
npm test        # or: node --test
```

- `structure.test.mjs`: valid JSON, unique node names, valid connections, credentials are references only, no secrets.
- `code-nodes.test.mjs`: runs the JavaScript of the Code nodes in a sandbox with mocked n8n globals. It checks things like the upvote filter, JSON parsing and fallbacks, HD clip choice, and that the embedded Python caption script is valid.
- `known-issues.test.mjs`: one test per problem above, named `GAP: ...`. Each states the behaviour we want and is shown as TODO until it is fixed.

Expected result: `fail 0`, with 14 TODO.

## Files

```
workflows/   the three n8n exports
tests/       helpers.mjs, structure.test.mjs, code-nodes.test.mjs, known-issues.test.mjs
```
