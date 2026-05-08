export interface SessionSnapshotSource {
  getHeader: () => unknown;
  getBranch?: () => unknown[];
}

/**
 * Build the child session in curated-context mode.
 *
 * The child receives only the session header so Pi restores the working
 * directory/session metadata, then the explicit task brief is appended as the
 * only user message. Parent branch messages are intentionally excluded to avoid
 * leaking prior tool output, stale hashes, or parent reasoning into execution
 * workers.
 */
export function buildForkSessionSnapshotJsonl(
  sessionManager: SessionSnapshotSource,
): string | null {
  const header = sessionManager.getHeader();
  if (!header || typeof header !== "object") return null;

  return `${JSON.stringify(header)}\n`;
}
