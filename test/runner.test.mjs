import test from "node:test";
import assert from "node:assert/strict";
import { buildChildEnv } from "../src/env.ts";
import { isResultError, isResultSuccess, normalizeCompletedResult } from "../src/types.ts";

function envObject(entries) {
  const env = {};
  for (const [key, value] of entries) {
    Object.defineProperty(env, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return env;
}

function makeResult(overrides = {}) {
  return {
    task: "repro",
    exitCode: -1,
    messages: [],
    stderr: "",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      contextTokens: 0,
      turns: 0,
    },
    ...overrides,
  };
}

test("normalizeCompletedResult treats agent_end with final assistant output as success", () => {
  const result = makeResult({
    exitCode: 1,
    stopReason: "error",
    errorMessage: "Command exited with code 1",
    stderr: "Command exited with code 1",
    sawAgentEnd: true,
    messages: [
      {
        role: "assistant",
        content: [{ type: "text", text: "No matches found; exit code 1 was expected." }],
        timestamp: 1,
      },
    ],
  });

  normalizeCompletedResult(result, false);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stopReason, undefined);
  assert.equal(result.errorMessage, undefined);
  assert.equal(isResultSuccess(result), true);
  assert.equal(isResultError(result), false);
});

test("normalizeCompletedResult keeps aborts as errors without semantic completion", () => {
  const result = makeResult({
    exitCode: 130,
    stderr: "",
  });

  normalizeCompletedResult(result, true);

  assert.equal(result.exitCode, 130);
  assert.equal(result.stopReason, "aborted");
  assert.equal(result.errorMessage, "Fork was aborted.");
  assert.equal(result.stderr, "Fork was aborted.");
  assert.equal(isResultSuccess(result), false);
  assert.equal(isResultError(result), true);
});

test("buildChildEnv overlays configured values onto inherited env", () => {
  const parentEnv = {
    INHERITED: "parent",
    OVERRIDE: "parent",
  };

  assert.deepEqual(
    buildChildEnv({ OVERRIDE: "configured", EMPTY: "" }, parentEnv, "linux"),
    {
      INHERITED: "parent",
      OVERRIDE: "configured",
      EMPTY: "",
      PI_OFFLINE: "1",
    },
  );
  assert.deepEqual(parentEnv, {
    INHERITED: "parent",
    OVERRIDE: "parent",
  });
});

test("buildChildEnv preserves PI_OFFLINE invariant after configured env", () => {
  assert.deepEqual(
    buildChildEnv(
      {
        PI_OFFLINE: "0",
        OTHER: "configured",
      },
      {
        PI_OFFLINE: "parent",
      },
      "linux",
    ),
    {
      PI_OFFLINE: "1",
      OTHER: "configured",
    },
  );
});

test("buildChildEnv applies Windows overrides case-insensitively", () => {
  assert.deepEqual(
    buildChildEnv(
      {
        path: "configured-path",
        pi_offline: "0",
      },
      {
        PATH: "parent-path",
        Pi_Offline: "parent-offline",
        KEEP: "parent",
      },
      "win32",
    ),
    {
      path: "configured-path",
      KEEP: "parent",
      PI_OFFLINE: "1",
    },
  );
});

test("buildChildEnv preserves __proto__ as an own env variable", () => {
  const childEnv = buildChildEnv(
    envObject([["__proto__", "configured-proto"]]),
    envObject([
      ["__proto__", "parent-proto"],
      ["KEEP", "parent"],
    ]),
    "win32",
  );

  assert.deepEqual(
    childEnv,
    envObject([
      ["KEEP", "parent"],
      ["__proto__", "configured-proto"],
      ["PI_OFFLINE", "1"],
    ]),
  );
  assert.equal(Object.getOwnPropertyDescriptor(childEnv, "__proto__")?.value, "configured-proto");
});
