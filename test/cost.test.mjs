import test from "node:test";
import assert from "node:assert/strict";
import { aggregateInclusiveCost, formatForkCostStatus } from "../src/cost.ts";

test("aggregateInclusiveCost sums assistant cost plus fork tool-result cost", () => {
  const stats = aggregateInclusiveCost([
    {
      type: "message",
      message: {
        role: "assistant",
        usage: {
          input: 100,
          output: 20,
          cacheRead: 30,
          cacheWrite: 40,
          totalTokens: 190,
          cost: { total: 1.1114 },
        },
      },
    },
    {
      type: "message",
      message: {
        role: "toolResult",
        toolName: "fork",
        details: {
          results: [
            {
              usage: {
                input: 10,
                output: 2,
                cacheRead: 3,
                cacheWrite: 4,
                contextTokens: 19,
                turns: 1,
                cost: 0.1234,
              },
            },
            {
              usage: {
                input: 5,
                output: 1,
                turns: 2,
                cost: 0.2222,
              },
            },
          ],
        },
      },
    },
  ]);

  assert.equal(stats.main.cost, 1.1114);
  assert.equal(stats.main.input, 100);
  assert.equal(stats.forks.cost, 0.3456);
  assert.equal(stats.forks.input, 15);
  assert.equal(stats.forks.turns, 3);
  assert.equal(stats.forkResults, 2);
  assert.equal(stats.total.cost.toFixed(4), "1.4570");
  assert.equal(stats.total.input, 115);
  assert.equal(formatForkCostStatus(stats), "\x1b[2mforks +$0.346\x1b[22m");
  assert.equal(formatForkCostStatus(stats)?.replace(/\x1b\[[0-9;]*m/g, ""), "forks +$0.346");
});

test("formatForkCostStatus hides footer text when there is no fork cost", () => {
  const stats = aggregateInclusiveCost([
    {
      type: "message",
      message: {
        role: "assistant",
        usage: { input: 1, output: 1, cost: { total: 0.5 } },
      },
    },
  ]);

  assert.equal(stats.total.cost, 0.5);
  assert.equal(formatForkCostStatus(stats), undefined);
});

test("aggregateInclusiveCost ignores malformed fork details", () => {
  const stats = aggregateInclusiveCost([
    { type: "message", message: { role: "toolResult", toolName: "fork", details: {} } },
    { type: "message", message: { role: "toolResult", toolName: "fork", details: { results: [{}] } } },
    { type: "message", message: { role: "toolResult", toolName: "read", details: { results: [{ usage: { cost: 1 } }] } } },
  ]);

  assert.equal(stats.forks.cost, 0);
  assert.equal(stats.total.cost, 0);
  assert.equal(stats.forkResults, 0);
});
