/**
 * Pi Fork Extension
 *
 * Provides one tool:
 *   fork({ task: "..." })
 *
 * The child process receives a temporary JSONL snapshot of the current active
 * session branch, then a final user message containing fork-worker instructions
 * and the requested task. It does not modify the system prompt.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { loadConfig } from "./config.js";
import { runFork } from "./runner.js";
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
      "Give the forked worker a focused, self-contained task. The worker starts from your current session branch context and returns its findings to you.",
  }),
});

interface SessionSnapshotSource {
  getHeader: () => unknown;
  getBranch: () => unknown[];
}

function buildForkSessionSnapshotJsonl(
  sessionManager: SessionSnapshotSource,
): string | null {
  const header = sessionManager.getHeader();
  if (!header || typeof header !== "object") return null;

  const branchEntries = sessionManager.getBranch();
  const lines = [JSON.stringify(header)];
  for (const entry of branchEntries) lines.push(JSON.stringify(entry));
  return `${lines.join("\n")}\n`;
}

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

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "fork",
    label: "Fork",
    description:
      "Delegate a focused task to a worker that is forked from your current session branch context. The worker receives only the task you provide as its new instruction and reports its result back to you.",
    parameters: ForkParams,

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const snapshot = buildForkSessionSnapshotJsonl(ctx.sessionManager);
      if (!snapshot) {
        const result = emptyFailedResult(
          params.task,
          "Cannot fork: failed to snapshot current session context.",
        );
        return {
          content: [{ type: "text" as const, text: getResultSummaryText(result) }],
          details: makeDetails([result]),
          isError: true,
        };
      }

      const result = await runFork({
        cwd: ctx.cwd,
        task: params.task,
        forkSessionSnapshotJsonl: snapshot,
        extensions: loadConfig(ctx.cwd).extensions,
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
