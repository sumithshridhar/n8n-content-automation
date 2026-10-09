// Structure and safety checks for the three workflow exports.
import test from "node:test";
import assert from "node:assert/strict";
import { FILES, load, readWorkflowText } from "./helpers.mjs";

const SECRET_PATTERNS = {
  "Google API key": /AIza[0-9A-Za-z_-]{30,}/,
  "OpenAI-style key": /\bsk-[A-Za-z0-9_-]{16,}/,
  "GitHub token": /\b(ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}/,
  "Slack token": /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  "AWS access key": /\bAKIA[0-9A-Z]{16}\b/,
  "Telegram bot token": /\b\d{8,10}:AA[A-Za-z0-9_-]{30,}/,
  "bearer token": /Bearer\s+[A-Za-z0-9._-]{20,}/,
  "private key": /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  "URL with a password": /https?:\/\/[^/\s:@"']+:[^/\s:@"']+@/,
  "webhook URL": /https?:\/\/[^\s"']*(hooks\.slack\.com|discord(app)?\.com\/api\/webhooks|\/webhook(-test)?\/)/i,
};

for (const key of Object.keys(FILES)) {
  const file = FILES[key];

  test(`${file}: is valid JSON with nodes and connections`, () => {
    const wf = load(key);
    assert.ok(wf.name);
    assert.ok(Array.isArray(wf.nodes) && wf.nodes.length > 0);
    assert.equal(typeof wf.connections, "object");
  });

  test(`${file}: node names are unique`, () => {
    const names = load(key).nodes.map((n) => n.name);
    assert.equal(new Set(names).size, names.length);
  });

  test(`${file}: every connection starts and ends at a node that exists`, () => {
    const wf = load(key);
    const names = new Set(wf.nodes.map((n) => n.name));
    for (const [from, byType] of Object.entries(wf.connections)) {
      assert.ok(names.has(from), `connection from unknown node ${from}`);
      for (const outputs of Object.values(byType)) {
        for (const targets of outputs) {
          for (const t of targets) assert.ok(names.has(t.node), `${from} connects to unknown node ${t.node}`);
        }
      }
    }
  });

  test(`${file}: credentials are references (id and name only), never values`, () => {
    for (const n of load(key).nodes) {
      for (const [type, ref] of Object.entries(n.credentials ?? {})) {
        assert.deepEqual(Object.keys(ref).sort(), ["id", "name"], `${n.name} / ${type}`);
      }
    }
  });

  test(`${file}: no API key, token, password URL or webhook URL in the file`, () => {
    const text = readWorkflowText(key);
    for (const [label, pattern] of Object.entries(SECRET_PATTERNS)) {
      assert.doesNotMatch(text, pattern, `looks like a ${label}`);
    }
  });

  test(`${file}: Authorization headers hold a YOUR_... placeholder`, () => {
    for (const n of load(key).nodes) {
      const p = n.parameters ?? {};
      const headers = [...(p.headerParameters?.parameters ?? []), ...(p.headerParametersUi?.parameter ?? [])];
      for (const h of headers.filter((x) => /^authorization$/i.test(x.name))) {
        assert.match(h.value, /^YOUR_[A-Z0-9_]+$/, `${n.name} has a real-looking Authorization value`);
      }
    }
  });

  test(`${file}: no pinned test data is left in the export`, () => {
    assert.deepEqual(load(key).pinData ?? {}, {});
  });
}

test("the only manual trigger in each workflow is the start of the run", () => {
  for (const key of Object.keys(FILES)) {
    const triggers = load(key).nodes.filter((n) => n.type === "n8n-nodes-base.manualTrigger");
    assert.equal(triggers.length, 1, FILES[key]);
  }
});
