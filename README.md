# n8n Content Automation

Three n8n workflows from a Reddit-to-Shorts content pipeline that has run unattended on a scheduler.
Each one solves a different reliability problem: not "can it post a video" but "will it still work at 3am with no one watching."

Exported directly from n8n (`workflow_entity.nodes` / `.connections`), with one hardcoded API key redacted (`YOUR_PEXELS_API_KEY` — drop in your own [Pexels](https://www.pexels.com/api/) key to run it). No other secrets in these files; real credentials live in n8n's separate credential store, not in the workflow JSON.

## 1. [`faceless-yt-shorts-factory.json`](workflows/faceless-yt-shorts-factory.json) — the generator-critic content pipeline

49 nodes. Reddit scraper → viral-post filter → a **generate → critique → regenerate** loop, not a single LLM call:

`Visual Director → Script Writer → AI Critic → Quality Gate` (repeated), then `Scene Splitter → JSON Parser → Split Scenes`, looping batches through TTS audio generation, ASS subtitle generation, a Pexels stock-video search per scene, then FFmpeg-driven stitching, caption burn-in, and archive/cleanup.

The critic isn't decorative — its output actually gates whether a script proceeds or gets regenerated. Model calls split across Google Gemini (script quality needs a stronger model) and four local Ollama roles (Vision, Creative, Critic, Logic) so the routine, high-volume steps don't hit a paid API. `n8n-nodes-base.code` shows up 16 times: most of the actual pipeline logic (parsing, batching, media selection) is hand-written JS, not node config.

## 2. [`viral-shorts-factory-native-ai.json`](workflows/viral-shorts-factory-native-ai.json) — the same pipeline, fully local and remote-executed

26 nodes. Same shape as #1 (scrape → filter → generate/critique/split → TTS → subtitles → stitch), rebuilt with two changes: every LLM call goes through local Ollama models only (no cloud LLM dependency), and every heavy step (`Generate Audio`, `Stitch + Generate ASS`, `Final Mix + ASS Burn`, `Execute Merge`) runs over **SSH** instead of a local `executeCommand`. That split matters: the n8n orchestrator can run on a small always-on box while the actual TTS/video rendering happens on a separate GPU machine it reaches over SSH.

## 3. [`ig-reel-auto-post-retry-robust.json`](workflows/ig-reel-auto-post-retry-robust.json) — vision-verified retry-robust phone automation

31 nodes, `executeCommand` (ADB) driving a real Android phone. Blind coordinate-tapping breaks the moment a UI shifts a few pixels, so this workflow reads the screen back before it decides what to do next:

`Open Instagram → wait for load → tap Create → select video → Capture Screenshot → Read Screenshot → Vision Analysis (local Ollama vision model) → tap Next (attempt 1, then attempt 2 with a wait between) → tap Share (attempt 1, then attempt 2)`.

Every risky tap is paired with a screenshot-and-verify step and a numbered retry, rather than one shot with no fallback — the same pattern that makes the content pipeline itself safe to leave running unattended. (Built for personal-account automation; check a platform's terms before pointing this at an account you don't own.)

## Stack

n8n · LangChain nodes for n8n · Ollama (local LLMs) · Google Gemini · Pexels API · FFmpeg · ADB · SSH

## Import

Each file is a standard n8n workflow export — `Import from File` in the n8n UI, or drag it onto the canvas. You'll need your own credentials wired up (Reddit, Pexels, Ollama endpoint, SSH target) and Ollama models pulled locally.
