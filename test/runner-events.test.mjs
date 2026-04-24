import test from "node:test";
import assert from "node:assert/strict";
import {
  getFinalAssistantText,
  getResultSummaryText,
  processPiEvent,
  processPiJsonLine,
} from "../src/runner-events.js";

function makeResult() {
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
  };
}

test("captures final assistant output from agent_end after non-zero tool exit", () => {
  const result = makeResult();
  const message = {
    role: "assistant",
    content: [{ type: "text", text: "The command failed, and that is the finding." }],
    model: "test-model",
    stopReason: "error",
    errorMessage: "Command exited with code 1",
    usage: {
      input: 1,
      output: 2,
      cacheRead: 3,
      cacheWrite: 4,
      totalTokens: 10,
      cost: { total: 0.01 },
    },
    timestamp: 1,
  };

  processPiEvent({ type: "agent_end", messages: [message] }, result);
  result.exitCode = 1;

  assert.equal(result.sawAgentEnd, true);
  assert.equal(result.stopReason, "error");
  assert.equal(result.errorMessage, "Command exited with code 1");
  assert.equal(result.usage.turns, 1);
  assert.equal(getFinalAssistantText(result.messages), "The command failed, and that is the finding.");
  assert.equal(getResultSummaryText(result), "The command failed, and that is the finding.");
});

test("deduplicates assistant messages repeated across event types", () => {
  const message = {
    role: "assistant",
    content: [{ type: "text", text: "Still here" }],
    timestamp: 1,
  };
  const result = makeResult();

  processPiEvent({ type: "message_end", message }, result);
  processPiEvent({ type: "turn_end", message }, result);
  processPiEvent({ type: "agent_end", messages: [message] }, result);

  assert.equal(result.messages.length, 1);
  assert.equal(result.usage.turns, 1);
});

test("invalid JSON lines are ignored", () => {
  const result = makeResult();

  assert.equal(processPiJsonLine("{ nope", result), false);
  assert.equal(result.messages.length, 0);
});
