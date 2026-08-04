---
title: "Tool-scoped regeneration commands must not be blocked by unrelated existing files"
modules: ["cli"]
areas: ["module-data","architecture"]
topics: ["command-pattern","data-scoping","regeneration"]
---

# Tool-scoped regeneration commands must not be blocked by unrelated existing files

**Context**: `yarn mercato agentic:init --tool=<tool>` is meant to support incremental setup of one coding tool at a time, including retroactive setup from the splash screen.

**Problem**: A broad "any agentic file exists" guard causes false positives. Existing `.codex` files should not block adding Cursor, and existing Cursor files should not block adding Claude Code.

**Rule**: When a CLI/setup command supports scoped tool selection, preflight "already configured" checks must be scoped to the selected tool's own files, not the union of all tool outputs.

**Applies to**: `packages/cli/src/lib/agentic-init.ts` and any future tool-scoped bootstrap or regeneration commands.
