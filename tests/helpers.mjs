// Shared helpers for the workflow tests. Built-in Node modules only.
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));

export const FILES = {
  faceless: "faceless-yt-shorts-factory.json",
  viral: "viral-shorts-factory-native-ai.json",
  ig: "ig-reel-auto-post-retry-robust.json",
};

export const readWorkflowText = (key) => readFileSync(join(here, "..", "workflows", FILES[key]), "utf8");
export const load = (key) => JSON.parse(readWorkflowText(key));

export function node(workflow, name) {
  const found = workflow.nodes.find((n) => n.name === name);
  if (!found) throw new Error(`no node named ${JSON.stringify(name)}`);
  return found;
}

export const codeOf = (workflow, name) => node(workflow, name).parameters.jsCode ?? "";

/** Every string value anywhere in a parsed workflow (decoded, so escapes are resolved). */
export function* allStrings(value) {
  if (typeof value === "string") yield value;
  else if (Array.isArray(value)) for (const v of value) yield* allStrings(v);
  else if (value && typeof value === "object") for (const v of Object.values(value)) yield* allStrings(v);
}

/** Names reachable from `start` over normal ("main") connections. */
export function reachableFrom(workflow, start) {
  const next = new Map();
  for (const [from, byType] of Object.entries(workflow.connections)) {
    for (const outputs of byType.main ?? []) {
      for (const target of outputs) next.set(from, [...(next.get(from) ?? []), target.node]);
    }
  }
  const seen = new Set();
  const stack = [start];
  while (stack.length) {
    const name = stack.pop();
    if (seen.has(name)) continue;
    seen.add(name);
    stack.push(...(next.get(name) ?? []));
  }
  return seen;
}

/** Targets wired to one output index of a node. */
export function targetsOf(workflow, name, outputIndex) {
  return (workflow.connections[name]?.main?.[outputIndex] ?? []).map((t) => t.node);
}

/**
 * Runs the JavaScript of an n8n Code node ("run once for all items") in a sandbox.
 *
 *   items   what the node receives: [{ json: {...} }, ...]
 *   nodes   output of other nodes for $("Node name"): { "Node name": [{ json }] }
 *   random  replaces Math.random so picks are repeatable (default: always the first)
 *
 * Only the n8n globals these workflows use are provided. The result is converted to
 * plain JSON so it can be compared with assert.deepEqual.
 */
export function runCode(code, { items = [], nodes = {}, random = () => 0 } = {}) {
  const inputApi = { all: () => items, first: () => items[0], last: () => items[items.length - 1], item: items[0] };
  const $ = (name) => {
    const out = nodes[name];
    if (!out) throw new Error(`Node '${name}' hasn't been executed`);
    return { first: () => out[0], last: () => out[out.length - 1], all: () => out, item: out[0] };
  };
  const sandboxMath = Object.create(Math);
  sandboxMath.random = random;
  const context = vm.createContext({ $input: inputApi, $, items, Math: sandboxMath, Buffer, console });
  const body = vm.runInContext(`(function () {\n${code}\n})`, context);
  const result = body();
  return result === undefined ? undefined : JSON.parse(JSON.stringify(result));
}

/**
 * A known gap: assert the behaviour we want. If it does not hold yet, the test is
 * reported as TODO (with the reason) and the run still passes. When the gap is fixed
 * the test passes as a normal test; rename it then.
 */
export function gap(name, reason, fn) {
  test(`GAP: ${name}`, async (t) => {
    try {
      await fn();
      t.diagnostic("this gap looks fixed: rename the test");
    } catch (error) {
      if (error?.code !== "ERR_ASSERTION") throw error;
      t.todo(reason);
    }
  });
}
