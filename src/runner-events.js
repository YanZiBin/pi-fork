/**
 * Helpers for parsing Pi JSON mode events and summarizing fork results.
 */

const MAX_TOOL_PREVIEW_CHARS = 1200;
const MAX_TOOL_ARGS_PREVIEW_CHARS = 300;
const MAX_STORED_TOOL_EXECUTIONS = 25;

function getSeenMessageSignatures(result) {
  if (!Object.prototype.hasOwnProperty.call(result, "__seenMessageSignatures")) {
    Object.defineProperty(result, "__seenMessageSignatures", {
      value: new Set(),
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
  return result.__seenMessageSignatures;
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
    .join(",")}}`;
}

function truncateMiddle(text, maxChars) {
  if (typeof text !== "string" || text.length <= maxChars) return text;
  const keep = Math.max(0, maxChars - 15);
  const head = Math.ceil(keep / 2);
  const tail = Math.floor(keep / 2);
  return `${text.slice(0, head)}\n… truncated …\n${text.slice(text.length - tail)}`;
}

function truncateTail(text, maxChars) {
  if (typeof text !== "string" || text.length <= maxChars) return text;
  return `… truncated …\n${text.slice(text.length - maxChars)}`;
}

function truncateInline(text, maxChars) {
  if (typeof text !== "string") return "";
  const singleLine = text.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxChars) return singleLine;
  return `${singleLine.slice(0, Math.max(0, maxChars - 1))}…`;
}

function formatCount(n) {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function stringifyPreview(value, maxChars) {
  if (value === undefined) return "";
  if (typeof value === "string") return truncateMiddle(value, maxChars);

  try {
    return truncateMiddle(JSON.stringify(value), maxChars);
  } catch {
    return "";
  }
}

function shortPath(value) {
  if (typeof value !== "string" || !value) return "...";
  return value.replace(/^\/home\/[^/]+/, "~");
}

function formatToolCallPreview(toolName, args) {
  if (!args || typeof args !== "object") return toolName || "tool";

  switch (toolName) {
    case "bash": {
      const command = typeof args.command === "string" ? args.command : "...";
      return `bash $ ${truncateInline(command, 80)}`;
    }
    case "read": {
      const filePath = shortPath(args.path || args.file_path);
      const offset = args.offset;
      const limit = args.limit;
      const range = offset !== undefined || limit !== undefined ? `:${offset ?? 1}${limit !== undefined ? `-${(offset ?? 1) + limit - 1}` : ""}` : "";
      return `read ${filePath}${range}`;
    }
    case "write":
      return `write ${shortPath(args.path || args.file_path)}`;
    case "edit":
      return `edit ${shortPath(args.path || args.file_path)}`;
    case "ls":
      return `ls ${shortPath(args.path || ".")}`;
    case "find":
      return `find ${truncateInline(stringifyPreview(args.pattern || "*", 60), 60)} in ${shortPath(args.path || ".")}`;
    case "grep":
      return `grep ${truncateInline(stringifyPreview(args.pattern || "", 60), 60)} in ${shortPath(args.path || ".")}`;
    case "fork": {
      const task = typeof args.task === "string" ? args.task : stringifyPreview(args, 80);
      return `fork ${truncateInline(task, 80)}`;
    }
    default: {
      const argsPreview = truncateInline(stringifyPreview(args, 70), 70);
      return argsPreview ? `${toolName} ${argsPreview}` : toolName || "tool";
    }
  }
}

function extractTextFromContent(content) {
  if (!Array.isArray(content)) return "";

  const parts = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    if (part.type === "text" && typeof part.text === "string") {
      parts.push(part.text);
    } else if (part.type === "image") {
      parts.push("[image]");
    }
  }

  return parts.join("\n").trim();
}

function extractResultText(toolResult) {
  if (!toolResult || typeof toolResult !== "object") return "";

  const contentText = extractTextFromContent(toolResult.content);
  if (contentText) return truncateTail(contentText, MAX_TOOL_PREVIEW_CHARS);

  if (typeof toolResult.text === "string") {
    return truncateTail(toolResult.text.trim(), MAX_TOOL_PREVIEW_CHARS);
  }

  if (typeof toolResult.message === "string") {
    return truncateTail(toolResult.message.trim(), MAX_TOOL_PREVIEW_CHARS);
  }

  return "";
}

function updateAssistantMetadata(result, message) {
  if (!message || message.role !== "assistant") return;
  if (!result.provider && message.provider) result.provider = message.provider;
  if (!result.model && message.model) result.model = message.model;
  if (message.stopReason) result.stopReason = message.stopReason;
  if (message.errorMessage) result.errorMessage = message.errorMessage;
}

function sanitizeAssistantMessage(message) {
  const sanitized = { ...message };
  delete sanitized.thinking;
  delete sanitized.reasoning;
  delete sanitized.reasoning_content;

  if (Array.isArray(message.content)) {
    sanitized.content = message.content
      .filter((part) => part?.type !== "thinking")
      .map((part) => {
        if (!part || typeof part !== "object") return part;
        const cleanPart = { ...part };
        delete cleanPart.thinking;
        delete cleanPart.reasoning;
        delete cleanPart.reasoning_content;
        return cleanPart;
      });
  }

  return sanitized;
}

function addAssistantMessage(result, message) {
  if (!message || message.role !== "assistant") return false;

  const sanitizedMessage = sanitizeAssistantMessage(message);
  updateAssistantMetadata(result, sanitizedMessage);

  const signature = stableStringify(sanitizedMessage);
  const seen = getSeenMessageSignatures(result);
  if (seen.has(signature)) return false;
  seen.add(signature);

  result.messages.push(sanitizedMessage);

  result.usage.turns++;
  const usage = message.usage;
  if (usage) {
    result.usage.input += usage.input || 0;
    result.usage.output += usage.output || 0;
    result.usage.cacheRead += usage.cacheRead || 0;
    result.usage.cacheWrite += usage.cacheWrite || 0;
    result.usage.cost += usage.cost?.total || 0;
    result.usage.contextTokens = usage.totalTokens || 0;
  }

  return true;
}

function addAssistantMessages(result, messages) {
  if (!Array.isArray(messages)) return false;
  let changed = false;
  for (const message of messages) {
    if (addAssistantMessage(result, message)) changed = true;
  }
  return changed;
}

function maxActivityOrder(result) {
  const orders = [];
  if (typeof result?.thinking?.activityOrder === "number") orders.push(result.thinking.activityOrder);
  if (Array.isArray(result?.toolExecutions)) {
    for (const tool of result.toolExecutions) {
      if (typeof tool?.activityOrder === "number") orders.push(tool.activityOrder);
    }
  }
  return orders.length > 0 ? Math.max(...orders) : 0;
}

function nextActivityOrder(result) {
  if (!Object.prototype.hasOwnProperty.call(result, "__activityOrder")) {
    Object.defineProperty(result, "__activityOrder", {
      value: maxActivityOrder(result),
      enumerable: false,
      configurable: false,
      writable: true,
    });
  }
  result.__activityOrder += 1;
  return result.__activityOrder;
}

function ensureToolExecutions(result) {
  if (!Array.isArray(result.toolExecutions)) result.toolExecutions = [];
  return result.toolExecutions;
}

function findToolExecution(result, event) {
  const toolExecutions = ensureToolExecutions(result);
  const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : undefined;

  let tool = toolCallId
    ? toolExecutions.find((entry) => entry.toolCallId === toolCallId)
    : undefined;

  if (!tool) {
    const totalBefore = typeof result.toolExecutionCount === "number"
      ? result.toolExecutionCount
      : toolExecutions.length;
    result.toolExecutionCount = totalBefore + 1;
    tool = {
      toolCallId: toolCallId || `unknown-${result.toolExecutionCount}`,
      toolName: typeof event.toolName === "string" ? event.toolName : "tool",
      status: "running",
      updates: 0,
      activityOrder: nextActivityOrder(result),
    };
    toolExecutions.push(tool);
    while (toolExecutions.length > MAX_STORED_TOOL_EXECUTIONS) {
      toolExecutions.shift();
    }
  }

  if (typeof event.toolName === "string") tool.toolName = event.toolName;
  if (Object.prototype.hasOwnProperty.call(event, "args")) {
    tool.argsPreview = stringifyPreview(event.args, MAX_TOOL_ARGS_PREVIEW_CHARS);
    tool.displayText = formatToolCallPreview(tool.toolName, event.args);
  }

  if (!tool.displayText) tool.displayText = tool.toolName;

  return tool;
}

function processToolExecutionEvent(event, result) {
  const tool = findToolExecution(result, event);

  switch (event.type) {
    case "tool_execution_start":
      tool.status = "running";
      tool.isError = false;
      tool.latestText = "";
      return true;

    case "tool_execution_update": {
      tool.status = "running";
      tool.isError = false;
      tool.updates = (tool.updates || 0) + 1;
      const latestText = extractResultText(event.partialResult);
      if (latestText) tool.latestText = latestText;
      return true;
    }

    case "tool_execution_end": {
      tool.status = event.isError ? "error" : "completed";
      tool.isError = Boolean(event.isError);
      const latestText = extractResultText(event.result);
      if (latestText) tool.latestText = latestText;
      return true;
    }

    default:
      return false;
  }
}

function ensureThinking(result) {
  if (!result.thinking || typeof result.thinking !== "object") {
    result.thinking = { status: "running", chars: 0, activityOrder: nextActivityOrder(result) };
  }
  if (typeof result.thinking.chars !== "number") result.thinking.chars = 0;
  if (typeof result.thinking.activityOrder !== "number") {
    result.thinking.activityOrder = nextActivityOrder(result);
  }
  return result.thinking;
}

function processMessageUpdateEvent(event, result) {
  const assistantEvent = event.assistantMessageEvent;
  if (!assistantEvent || typeof assistantEvent !== "object") return false;

  switch (assistantEvent.type) {
    case "thinking_start": {
      const thinking = ensureThinking(result);
      if (thinking.status === "completed") {
        thinking.chars = 0;
        thinking.activityOrder = nextActivityOrder(result);
      }
      thinking.status = "running";
      return true;
    }

    case "thinking_delta": {
      const thinking = ensureThinking(result);
      thinking.status = "running";
      if (typeof assistantEvent.delta === "string") {
        thinking.chars += assistantEvent.delta.length;
      }
      return true;
    }

    case "thinking_end": {
      const thinking = ensureThinking(result);
      thinking.status = "completed";
      if (typeof assistantEvent.content === "string") {
        thinking.chars = assistantEvent.content.length;
      }
      return true;
    }

    default:
      return false;
  }
}

export function processPiEvent(event, result) {
  if (!event || typeof event !== "object") return false;

  switch (event.type) {
    case "message_update":
      return processMessageUpdateEvent(event, result);

    case "message_end":
      return addAssistantMessage(result, event.message);

    case "turn_end":
      return addAssistantMessage(result, event.message);

    case "agent_end":
      result.sawAgentEnd = true;
      return addAssistantMessages(result, event.messages);

    case "tool_execution_start":
    case "tool_execution_update":
    case "tool_execution_end":
      return processToolExecutionEvent(event, result);

    default:
      return false;
  }
}

export function processPiJsonLine(line, result) {
  if (!line.trim()) return false;

  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return false;
  }

  return processPiEvent(event, result);
}

export function getFinalAssistantText(messages) {
  if (!Array.isArray(messages)) return "";

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || message.role !== "assistant" || !Array.isArray(message.content)) {
      continue;
    }

    for (const part of message.content) {
      if (part?.type === "text" && typeof part.text === "string" && part.text.length > 0) {
        return part.text;
      }
    }
  }

  return "";
}

function getLatestRelevantToolExecution(result) {
  const toolExecutions = Array.isArray(result?.toolExecutions) ? result.toolExecutions : [];
  if (toolExecutions.length === 0) return undefined;

  for (let i = toolExecutions.length - 1; i >= 0; i--) {
    if (toolExecutions[i]?.status === "running") return toolExecutions[i];
  }

  return toolExecutions[toolExecutions.length - 1];
}

function formatToolStatusIcon(tool) {
  if (tool?.status === "running") return "…";
  if (tool?.status === "error") return "×";
  return "✓";
}

function formatThinkingProgress(result) {
  const thinking = result?.thinking;
  if (!thinking || typeof thinking !== "object") return "";
  const icon = thinking.status === "running" ? "…" : "✓";
  const chars = typeof thinking.chars === "number" ? thinking.chars : 0;
  const label = chars > 0 ? `thinking ${formatCount(chars)} chars` : "thinking...";
  return `${icon} ${label}`;
}

function getActivityOrder(item, fallback) {
  return typeof item?.activityOrder === "number" ? item.activityOrder : fallback;
}

function formatToolProgress(result) {
  const toolExecutions = Array.isArray(result?.toolExecutions) ? result.toolExecutions : [];
  const lines = [];

  const toShow = toolExecutions.slice(-10);
  const totalTools = typeof result?.toolExecutionCount === "number"
    ? Math.max(result.toolExecutionCount, toolExecutions.length)
    : toolExecutions.length;
  const skipped = Math.max(0, totalTools - toShow.length);
  if (skipped > 0) lines.push(`... ${skipped} earlier tool call${skipped === 1 ? "" : "s"}`);

  const activities = [];
  const thinkingProgress = formatThinkingProgress(result);
  if (thinkingProgress) {
    activities.push({ order: getActivityOrder(result.thinking, 0), text: thinkingProgress });
  }
  toShow.forEach((tool, index) => {
    activities.push({
      order: getActivityOrder(tool, index + 1),
      text: `${formatToolStatusIcon(tool)} ${tool.displayText || tool.toolName || "tool"}`,
    });
  });
  activities.sort((a, b) => a.order - b.order);
  for (const activity of activities) lines.push(activity.text);

  const activeTool = getLatestRelevantToolExecution(result);
  if (activeTool?.latestText) {
    lines.push(activeTool.latestText);
  }

  return lines.join("\n").trim();
}

export function getForkProgressText(result) {
  const finalText = getFinalAssistantText(result?.messages);
  if (finalText) return finalText;

  const toolProgress = formatToolProgress(result);
  if (toolProgress) return toolProgress;

  if (typeof result?.errorMessage === "string" && result.errorMessage.trim()) {
    return result.errorMessage.trim();
  }

  return "(running...)";
}

export function getResultSummaryText(result) {
  const finalText = getFinalAssistantText(result?.messages);
  if (finalText) return finalText;

  if (typeof result?.errorMessage === "string" && result.errorMessage.trim()) {
    return result.errorMessage.trim();
  }

  const isError =
    (typeof result?.exitCode === "number" && result.exitCode > 0) ||
    result?.stopReason === "error" ||
    result?.stopReason === "aborted";

  if (isError && typeof result?.stderr === "string" && result.stderr.trim()) {
    return result.stderr.trim();
  }

  return "(no output)";
}
