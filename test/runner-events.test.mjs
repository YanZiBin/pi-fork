import test from "node:test";
import assert from "node:assert/strict";
import {
  getFinalAssistantText,
  getForkProgressText,
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

test("captures child tool execution progress for live fork updates", () => {
  const result = makeResult();

  assert.equal(
    processPiEvent(
      {
        type: "tool_execution_start",
        toolCallId: "call_1",
        toolName: "read",
        args: { path: "src/index.ts" },
      },
      result,
    ),
    true,
  );

  assert.deepEqual(result.toolExecutions, [
    {
      toolCallId: "call_1",
      toolName: "read",
      status: "running",
      updates: 0,
      argsPreview: '{"path":"src/index.ts"}',
      displayText: "read src/index.ts",
      isError: false,
      latestText: "",
    },
  ]);
  assert.equal(getForkProgressText(result), "… read src/index.ts");

  assert.equal(
    processPiEvent(
      {
        type: "tool_execution_update",
        toolCallId: "call_1",
        toolName: "read",
        args: { path: "src/index.ts" },
        partialResult: { content: [{ type: "text", text: "file contents so far" }] },
      },
      result,
    ),
    true,
  );

  assert.equal(result.toolExecutions[0].updates, 1);
  assert.equal(result.toolExecutions[0].latestText, "file contents so far");
  assert.equal(getForkProgressText(result), "… read src/index.ts\nfile contents so far");
});

test("captures child thinking progress metadata without storing thinking text", () => {
  const result = makeResult();

  assert.equal(
    processPiEvent(
      {
        type: "message_update",
        assistantMessageEvent: { type: "thinking_start" },
      },
      result,
    ),
    true,
  );
  assert.deepEqual(result.thinking, { status: "running", chars: 0 });
  assert.equal(getForkProgressText(result), "… thinking...");

  processPiEvent(
    {
      type: "message_update",
      assistantMessageEvent: { type: "thinking_delta", delta: "abc" },
    },
    result,
  );
  processPiEvent(
    {
      type: "message_update",
      assistantMessageEvent: { type: "thinking_delta", delta: "defg" },
    },
    result,
  );
  assert.deepEqual(result.thinking, { status: "running", chars: 7 });
  assert.equal(getForkProgressText(result), "… thinking 7 chars");

  processPiEvent(
    {
      type: "message_update",
      assistantMessageEvent: { type: "thinking_end", content: "final thinking" },
    },
    result,
  );
  assert.deepEqual(result.thinking, { status: "completed", chars: 14 });
  assert.equal(getForkProgressText(result), "→ thinking 14 chars");
});

test("strips raw thinking blocks from stored assistant messages", () => {
  const result = makeResult();
  const message = {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "private chain of thought" },
      { type: "text", text: "Public answer" },
    ],
    thinking: "top-level private thinking",
    reasoning_content: "provider private reasoning",
    timestamp: 1,
  };

  processPiEvent({ type: "message_end", message }, result);
  processPiEvent({ type: "agent_end", messages: [message] }, result);

  assert.equal(result.messages.length, 1);
  assert.equal(getFinalAssistantText(result.messages), "Public answer");
  const serialized = JSON.stringify(result.messages);
  assert.doesNotMatch(serialized, /private chain of thought/);
  assert.doesNotMatch(serialized, /top-level private thinking/);
  assert.doesNotMatch(serialized, /provider private reasoning/);
  assert.deepEqual(result.messages[0].content, [{ type: "text", text: "Public answer" }]);
});

test("fork progress prefixes activity rows with the child tool name", () => {
  const result = makeResult();

  processPiEvent(
    {
      type: "tool_execution_start",
      toolCallId: "call_1",
      toolName: "bash",
      args: { command: "npm test" },
    },
    result,
  );
  processPiEvent(
    {
      type: "tool_execution_end",
      toolCallId: "call_1",
      toolName: "bash",
      result: { content: [{ type: "text", text: "pass" }] },
      isError: false,
    },
    result,
  );
  processPiEvent(
    {
      type: "tool_execution_start",
      toolCallId: "call_2",
      toolName: "fork",
      args: { task: "inspect the renderer" },
    },
    result,
  );
  processPiEvent(
    {
      type: "tool_execution_end",
      toolCallId: "call_2",
      toolName: "fork",
      result: { content: [{ type: "text", text: "done" }] },
      isError: false,
    },
    result,
  );

  assert.equal(getForkProgressText(result), "→ bash $ npm test\n→ fork inspect the renderer\ndone");
});

test("fork progress prefers final assistant output over tool progress", () => {
  const result = makeResult();

  processPiEvent(
    {
      type: "tool_execution_start",
      toolCallId: "call_1",
      toolName: "bash",
      args: { command: "npm test" },
    },
    result,
  );
  processPiEvent(
    {
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Tests pass." }],
        timestamp: 1,
      },
    },
    result,
  );

  assert.equal(getForkProgressText(result), "Tests pass.");
});

test("bounds stored child tool execution history", () => {
  const result = makeResult();

  for (let i = 0; i < 30; i++) {
    processPiEvent(
      {
        type: "tool_execution_start",
        toolCallId: `call_${i}`,
        toolName: "read",
        args: { path: `src/${i}.ts` },
      },
      result,
    );
  }

  assert.equal(result.toolExecutionCount, 30);
  assert.equal(result.toolExecutions.length, 25);
  assert.equal(result.toolExecutions[0].toolCallId, "call_5");
  assert.equal(result.toolExecutions.at(-1).toolCallId, "call_29");
  assert.match(getForkProgressText(result), /\.\.\. 20 earlier tool calls\n… read src\/20\.ts/);
});

test("invalid JSON lines are ignored", () => {
  const result = makeResult();

  assert.equal(processPiJsonLine("{ nope", result), false);
  assert.equal(result.messages.length, 0);
});
