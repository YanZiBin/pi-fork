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

The tool starts an isolated child `pi` process with a temporary JSONL snapshot of
the current active session branch. The child receives the requested task as the
final user message. The extension does not modify the system prompt and does not
use agent definition files.

## Context Shape

For a forked child, the LLM context is roughly:

```text
System:
  Normal Pi system prompt

Messages:
  Current active branch rebuilt from temporary JSONL
  User: You are running in a forked Pi worker process...
        Task:
        <task>
```

This keeps the expensive prefix stable:

```text
normal system prompt + forked session context
```

Only the final task message changes per fork.

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

## Manual Check

From this directory:

```bash
pi -e .
```

Then ask Pi to use the `fork` tool with a task.
