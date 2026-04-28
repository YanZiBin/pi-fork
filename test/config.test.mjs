import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

function createTestableConfigModule() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-fork-config-"));
  const stubPath = path.join(tmpDir, "pi-coding-agent-stub.mjs");
  const modulePath = path.join(tmpDir, "config.testable.ts");
  const sourcePath = path.join(process.cwd(), "src", "config.ts");

  fs.writeFileSync(
    stubPath,
    `export function getAgentDir() { return process.env.PI_FORK_TEST_AGENT_DIR; }\n`,
  );

  const source = fs
    .readFileSync(sourcePath, "utf-8")
    .replace(
      'from "@mariozechner/pi-coding-agent"',
      'from "./pi-coding-agent-stub.mjs"',
    );
  fs.writeFileSync(modulePath, source);

  return {
    moduleUrl: pathToFileURL(modulePath).href,
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
}

test("loadConfig reads pi-fork.extensions and resolves local paths relative to settings files", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-fork-config-fixture-"));
  const agentDir = path.join(tmpDir, "agent");
  const projectDir = path.join(tmpDir, "project");
  const projectSettingsDir = path.join(projectDir, ".pi");
  const { moduleUrl, cleanup } = createTestableConfigModule();

  fs.mkdirSync(agentDir, { recursive: true });
  fs.mkdirSync(projectSettingsDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, "settings.json"),
    JSON.stringify({
      "pi-fork": {
        extensions: ["npm:global-extension", "./global-local"],
      },
    }),
  );
  fs.writeFileSync(
    path.join(projectSettingsDir, "settings.json"),
    JSON.stringify({
      "pi-fork": {
        extensions: ["npm:project-extension", "./project-local"],
      },
    }),
  );

  const previous = process.env.PI_FORK_TEST_AGENT_DIR;
  process.env.PI_FORK_TEST_AGENT_DIR = agentDir;

  try {
    const { loadConfig } = await import(`${moduleUrl}?t=${Date.now()}`);
    assert.deepEqual(loadConfig(projectDir), {
      extensions: [
        "npm:project-extension",
        path.join(projectSettingsDir, "project-local"),
      ],
      costFooter: true,
    });
  } finally {
    if (previous === undefined) delete process.env.PI_FORK_TEST_AGENT_DIR;
    else process.env.PI_FORK_TEST_AGENT_DIR = previous;
    cleanup();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("loadConfig treats null extensions as normal Pi extension loading", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-fork-config-fixture-"));
  const agentDir = path.join(tmpDir, "agent");
  const projectDir = path.join(tmpDir, "project");
  const projectSettingsDir = path.join(projectDir, ".pi");
  const { moduleUrl, cleanup } = createTestableConfigModule();

  fs.mkdirSync(agentDir, { recursive: true });
  fs.mkdirSync(projectSettingsDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, "settings.json"),
    JSON.stringify({
      "pi-fork": {
        extensions: ["npm:global-extension"],
      },
    }),
  );
  fs.writeFileSync(
    path.join(projectSettingsDir, "settings.json"),
    JSON.stringify({
      "pi-fork": {
        extensions: null,
      },
    }),
  );

  const previous = process.env.PI_FORK_TEST_AGENT_DIR;
  process.env.PI_FORK_TEST_AGENT_DIR = agentDir;

  try {
    const { loadConfig } = await import(`${moduleUrl}?t=${Date.now()}-null`);
    assert.deepEqual(loadConfig(projectDir), { extensions: null, costFooter: true });
  } finally {
    if (previous === undefined) delete process.env.PI_FORK_TEST_AGENT_DIR;
    else process.env.PI_FORK_TEST_AGENT_DIR = previous;
    cleanup();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("loadConfig preserves empty extensions array as no child extensions", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-fork-config-fixture-"));
  const agentDir = path.join(tmpDir, "agent");
  const projectDir = path.join(tmpDir, "project");
  const { moduleUrl, cleanup } = createTestableConfigModule();

  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, "settings.json"),
    JSON.stringify({
      "pi-fork": {
        extensions: [],
      },
    }),
  );

  const previous = process.env.PI_FORK_TEST_AGENT_DIR;
  process.env.PI_FORK_TEST_AGENT_DIR = agentDir;

  try {
    const { loadConfig } = await import(`${moduleUrl}?t=${Date.now()}-empty`);
    assert.deepEqual(loadConfig(projectDir), { extensions: [], costFooter: true });
  } finally {
    if (previous === undefined) delete process.env.PI_FORK_TEST_AGENT_DIR;
    else process.env.PI_FORK_TEST_AGENT_DIR = previous;
    cleanup();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("loadConfig allows disabling cost footer", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-fork-config-fixture-"));
  const agentDir = path.join(tmpDir, "agent");
  const projectDir = path.join(tmpDir, "project");
  const projectSettingsDir = path.join(projectDir, ".pi");
  const { moduleUrl, cleanup } = createTestableConfigModule();

  fs.mkdirSync(agentDir, { recursive: true });
  fs.mkdirSync(projectSettingsDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectSettingsDir, "settings.json"),
    JSON.stringify({
      "pi-fork": {
        costFooter: false,
      },
    }),
  );

  const previous = process.env.PI_FORK_TEST_AGENT_DIR;
  process.env.PI_FORK_TEST_AGENT_DIR = agentDir;

  try {
    const { loadConfig } = await import(`${moduleUrl}?t=${Date.now()}-cost-footer`);
    assert.deepEqual(loadConfig(projectDir), { extensions: null, costFooter: false });
  } finally {
    if (previous === undefined) delete process.env.PI_FORK_TEST_AGENT_DIR;
    else process.env.PI_FORK_TEST_AGENT_DIR = previous;
    cleanup();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
