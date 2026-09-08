---
title: "Windows `.cmd` wrappers must not be spawned directly in Node dev scripts"
modules: ["create_app"]
areas: ["module-data","architecture","debugging"]
topics: ["command-pattern","dev-runtime","package-runtime"]
---

# Windows `.cmd` wrappers must not be spawned directly in Node dev scripts

**Context**: The dev runtime introduced direct `spawn('yarn.cmd', args)` calls on Windows in `scripts/dev.mjs`.

**Problem**: On Windows, direct `spawn()` of `.cmd` wrappers can fail with `spawn EINVAL`, even when the same command works through `execFileSync` or an interactive shell. This broke `yarn dev` before package-build planning even started.

**Rule**: In Node-based runtime scripts, never call `spawn()` directly on `*.cmd` / `*.bat` wrappers. Route them through a Windows-aware helper that converts the invocation into a shell command, and mirror the same fix in `packages/create-app/template/scripts/**`. Add or update script-level tests that cover the Windows command-resolution branch so CI protects the behavior.

**Applies to**: `scripts/dev.mjs`, `packages/create-app/template/scripts/dev.mjs`, and any future script runner that launches Yarn, npm, pnpm, Turbo, or other Windows command wrappers.
