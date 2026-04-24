import { existsSync, readFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";

export interface ForkConfig {
  /**
   * Extensions to load in child fork processes.
   * - null: load normal Pi extensions from settings/auto-discovery
   * - []: load no extensions
   * - non-empty: load only these extension sources
   */
  extensions: string[] | null;
}

const SETTINGS_KEY = "pi-fork";

export const DEFAULT_CONFIG: ForkConfig = {
  extensions: null,
};

function isPackageSource(value: string): boolean {
  return value.startsWith("npm:") || value.startsWith("git:");
}

function resolveConfiguredPath(value: string, baseDir: string): string {
  if (!value) return value;
  if (isPackageSource(value)) return value;
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  if (path.isAbsolute(value)) return value;
  return path.resolve(baseDir, value);
}

function parseExtensions(raw: unknown, baseDir: string): string[] | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (!Array.isArray(raw)) return undefined;

  const extensions: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    extensions.push(resolveConfiguredPath(trimmed, baseDir));
  }
  return extensions;
}

function readNamespacedConfig(settingsPath: string, baseDir: string): Partial<ForkConfig> {
  if (!existsSync(settingsPath)) return {};

  try {
    const raw = JSON.parse(readFileSync(settingsPath, "utf-8")) as Record<string, unknown>;
    const nested = raw[SETTINGS_KEY];
    if (!nested || typeof nested !== "object" || Array.isArray(nested)) return {};

    const config = nested as Record<string, unknown>;
    const extensions = parseExtensions(config.extensions, baseDir);
    return extensions === undefined ? {} : { extensions };
  } catch {
    return {};
  }
}

export function loadConfig(cwd: string): ForkConfig {
  const agentDir = getAgentDir();
  const globalPath = path.join(agentDir, "settings.json");
  const projectSettingsDir = path.join(cwd, ".pi");
  const projectPath = path.join(projectSettingsDir, "settings.json");

  return {
    ...DEFAULT_CONFIG,
    ...readNamespacedConfig(globalPath, agentDir),
    ...readNamespacedConfig(projectPath, projectSettingsDir),
  };
}
