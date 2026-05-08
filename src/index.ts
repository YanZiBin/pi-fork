/**
 * Pi Fork Extension
 *
 * Provides one tool:
 *   fork({ task: "..." })
 *
 * The child process receives a temporary JSONL session header, then a final user
 * message containing fork-worker instructions and the curated task brief. It
 * does not receive the parent conversation branch or modify the system prompt.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { aggregateInclusiveCost, formatForkCostStatus } from "./cost.js";
import { loadConfig } from "./config.js";
import { renderForkCall, renderForkResult } from "./render.js";
import { runFork } from "./runner.js";
import { buildForkSessionSnapshotJsonl } from "./snapshot.js";
import { getResultSummaryText } from "./runner-events.js";
import {
  type ForkDetails,
  type ForkResult,
  emptyUsage,
  isResultError,
} from "./types.js";

const ForkParams = Type.Object({
  task: Type.String({
    description:
      "The task for the fork to complete. Specify what to do and where the fork's decision authority ends — it will surface ambiguities back to you rather than resolve them on your behalf. The fork already knows to return dense, concrete output with snippets and relationships; you only need to call out anything task-specific about the return shape.",
  }),
  model: Type.Optional(
    Type.String({
      description:
        "The model for the fork child process, e.g. 'openai/gpt-5-mini' or 'anthropic/claude-sonnet-4:high'. If omitted, inherits the parent session's model.",
    }),
  ),
  thinking: Type.Optional(
    Type.String({
      description:
        "Thinking level for the fork child: 'off', 'minimal', 'low', 'medium', 'high', 'xhigh'. If omitted, inherits the parent's thinking level.",
    }),
  ),
});

function makeDetails(results: ForkResult[]): ForkDetails {
  return { results };
}

function emptyFailedResult(task: string, message: string): ForkResult {
  return {
    task,
    exitCode: 1,
    messages: [],
    stderr: message,
    usage: emptyUsage(),
    stopReason: "error",
    errorMessage: message,
  };
}

const FORK_COST_STATUS_KEY = "fork-cost";

function updateForkCostStatus(ctx: ExtensionContext): void {
  if (!loadConfig(ctx.cwd).costFooter) {
    ctx.ui.setStatus(FORK_COST_STATUS_KEY, undefined);
    return;
  }

  const stats = aggregateInclusiveCost(ctx.sessionManager.getEntries());
  const status = formatForkCostStatus(stats);
  ctx.ui.setStatus(FORK_COST_STATUS_KEY, status ? ctx.ui.theme.fg("dim", status) : undefined);
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    updateForkCostStatus(ctx);
  });

  pi.on("turn_end", async (_event, ctx) => {
    updateForkCostStatus(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    updateForkCostStatus(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    ctx.ui.setStatus(FORK_COST_STATUS_KEY, undefined);
  });

  pi.registerTool({
    name: "fork",
    label: "Fork",
    description:
      "Spawn an execution-only fork to handle a focused task from a curated task brief. The fork does not inherit the parent conversation history; it relies on the brief and its own tool results. Forks return dense, concrete output: snippets, signatures, relationships, validation evidence, and any adjacent findings worth knowing. Use for focused exploration, implementation, testing, or iteration that would generate context noise.",
    parameters: ForkParams,
    renderCall: renderForkCall,
    renderResult: renderForkResult,

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const snapshot = buildForkSessionSnapshotJsonl(ctx.sessionManager);
      if (!snapshot) {
        const result = emptyFailedResult(
          params.task,
          "Cannot fork: failed to create curated child session header.",
        );
        return {
          content: [{ type: "text" as const, text: getResultSummaryText(result) }],
          details: makeDetails([result]),
          isError: true,
        };
      }

      const config = loadConfig(ctx.cwd);
      const result = await runFork({
        cwd: ctx.cwd,
        task: params.task,
        forkSessionSnapshotJsonl: snapshot,
        extensions: config.extensions,
        environment: config.environment,
        model: params.model ?? config.model,
        thinking: params.thinking ?? config.thinking,
        signal,
        onUpdate,
        makeDetails,
      });

      if (isResultError(result)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Fork ${result.stopReason || "failed"}: ${getResultSummaryText(result)}`,
            },
          ],
          details: makeDetails([result]),
          isError: true,
        };
      }

      return {
        content: [{ type: "text" as const, text: getResultSummaryText(result) }],
        details: makeDetails([result]),
      };
    },
  });
}
