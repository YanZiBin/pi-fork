import test from "node:test";
import assert from "node:assert/strict";
import { buildForkSessionSnapshotJsonl } from "../src/snapshot.ts";
import { buildForkTaskPrompt } from "../src/runner.ts";

test("fork session snapshot uses curated context by excluding parent branch entries", () => {
  const snapshot = buildForkSessionSnapshotJsonl({
    getHeader: () => ({ type: "session", version: 3, id: "parent", cwd: "/repo" }),
    getBranch: () => [
      {
        type: "message",
        id: "user1",
        parentId: null,
        message: { role: "user", content: "secret parent context" },
      },
      {
        type: "message",
        id: "assistant1",
        parentId: "user1",
        message: { role: "assistant", content: [{ type: "text", text: "prior tool output" }] },
      },
    ],
  });

  assert.equal(
    snapshot,
    `${JSON.stringify({ type: "session", version: 3, id: "parent", cwd: "/repo" })}\n`,
  );
  assert.equal(snapshot.includes("secret parent context"), false);
  assert.equal(snapshot.includes("prior tool output"), false);
});

test("fork task prompt tells children to rely only on the curated brief and their own tool results", () => {
  const prompt = buildForkTaskPrompt("Inspect src/index.ts and report findings.");

  assert.match(prompt, /curated task brief/i);
  assert.match(prompt, /do not have access to the parent conversation history/i);
  assert.match(prompt, /your own tool results/i);
  assert.match(prompt, /Do not claim to have read, edited, run, tested, committed, pushed, or verified/i);
  assert.match(prompt, /Inspect src\/index\.ts and report findings\./);
});
