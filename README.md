# Pi Fork

Cache-friendly fork tool for Pi.

## Installation

Install the extension with Pi:

```bash
pi install git:github.com/elpapi42/pi-fork
```

After installation, start or restart Pi. The extension registers the `fork` tool
for use in your Pi sessions.

## Usage

`pi-fork` provides one tool:

```json
{ "task": "Review the migration and report risks." }
```

The tool starts an isolated child `pi` process with a temporary JSONL session
header and a curated task brief as the final user message. The child does not
receive the parent conversation branch. The extension does not modify the system
prompt and does not use agent definition files.

## Context Shape

Fork children run in curated-context mode. The LLM context is roughly:

```text
System:
  Normal Pi system prompt

Messages:
  User: You are an execution-only fork of the main agent.
        You do not have access to the parent conversation history.
        Rely only on the curated task brief and your own tool results...
        Curated task brief:
        <task>
```

The parent agent is responsible for writing a clear task brief with the working
directory, goal, relevant files, constraints, stop conditions, validation
requirements, and expected output format. The child should not infer file
contents, command output, diffs, commit hashes, test results, or remote state
from prior parent context because that context is not provided.

## Recursive Forks

Add optional config under `pi-fork` in `~/.pi/agent/settings.json` or
`.pi/settings.json` to control child extension loading:

```json
{
  "pi-fork": {
    "extensions": null
  }
}
```

`extensions` is tri-state:

- `null` or omitted: load normal Pi extensions from settings and auto-discovery.
- `[]`: load no extensions in fork children.
- non-empty array: load only those extension sources in fork children.

Example:

```json
{
  "pi-fork": {
    "extensions": ["npm:pi-claude-bridge"]
  }
}
```

Local extension paths are resolved relative to the settings file directory:
`~/.pi/agent` for global settings and `.pi` for project settings.

If `pi-fork` itself is listed in `pi-fork.extensions`, child processes will load
the `fork` tool too.

## Fork Environment

Add optional environment variables under `pi-fork.environment` in
`~/.pi/agent/settings.json` or `.pi/settings.json`:

```json
{
  "pi-fork": {
    "environment": {
      "MY_EXTENSION_MODE": "fork",
      "SERVICE_BASE_URL": "https://example.test"
    }
  }
}
```

Fork children still inherit the parent Pi process environment. The resolved
`environment` map is overlaid on top, so configured variables add or override
child env vars while omitted variables continue to inherit normally. Project
settings override global settings; on Windows, that override is case-insensitive.
`PI_OFFLINE` is always forced to `"1"` for fork children and cannot be
overridden by `pi-fork.environment`.

Invalid entries are ignored: non-string values, empty variable names, names
containing `=`, and keys or values containing null bytes. Empty string values are
allowed.

This does not change the parent agent environment, add per-call env config,
isolate children from inherited env, unset inherited variables, or provide secret
masking/auditing.

## Fork Cost Footer

By default, `pi-fork` adds an extra dimmed footer status line with fork cost:

```text
forks +$0.123
```

The fork cost comes from completed fork tool results, including forks spawned by
forks. Disable the extra footer line with:

```json
{
  "pi-fork": {
    "costFooter": false
  }
}
```

## Manual Check

From this directory:

```bash
pi -e .
```

Then ask Pi to use the `fork` tool with a task.
