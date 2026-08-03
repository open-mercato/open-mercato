---
title: "Keep standalone agentic content in sync with module conventions"
modules: ["create_app","events","cli"]
areas: ["architecture","framework-context"]
topics: ["events","generated-files","package-runtime"]
---

# Keep standalone agentic content in sync with module conventions

**Context**: The monorepo root `AGENTS.md` and related coding conventions evolved to cover task routing, specs, standalone testing, and backward-compatibility rules, while the create-app agentic templates lagged behind.

**Problem**: Newly generated standalone apps started with stale or incomplete agent instructions, so agents operating in those apps missed current workflow expectations and module constraints.

**Rule**: Whenever root agent guidance changes in a way that affects standalone app development or maintenance — module placement, testing, standalone parity, auto-discovery file conventions, CLI commands, `yarn generate` behavior — also update the corresponding content in `packages/create-app/agentic/` (shared AGENTS.md.template, tool-specific rules/hooks).

**Applies to**: `packages/create-app/agentic/shared/`, `packages/create-app/agentic/claude-code/`, `packages/create-app/agentic/codex/`, `packages/create-app/agentic/cursor/`.
