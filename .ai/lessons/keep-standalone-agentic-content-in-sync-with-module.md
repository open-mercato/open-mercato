---
title: "Keep standalone agentic content in sync with module conventions"
modules: ["create_app","documents","events","cli"]
areas: ["architecture","framework-context"]
topics: ["auto-discovery","events","generated-files","package-runtime","session-export","testing"]
---

# Keep standalone agentic content in sync with module conventions

**Context**: The monorepo root `AGENTS.md` and related coding conventions evolved to cover task routing, specs, standalone testing, and backward-compatibility rules, while the create-app agentic templates lagged behind.

**Problem**: Newly generated standalone apps started with stale or incomplete agent instructions, so agents operating in those apps missed current workflow expectations and module constraints.

**Rule**: Whenever root agent guidance or a bundled local skill changes in a way that affects standalone app development or maintenance — module placement, testing, standalone parity, auto-discovery file conventions, CLI commands, `yarn generate` behavior, or harness-native session export — also update the corresponding content in `packages/create-app/agentic/` (shared AGENTS.md.template, tool-specific rules/hooks/skills). Harness-native retrieval must use a bounded, explicit helper and trusted active-request identifiers; it must never discover sessions by crawling local history.

When an enabled package-backed module adds a generated fact sheet, add or expand a harness case whose prompt makes that module fact necessary and lists `.ai/guides/modules/<id>.md` in `context.required`. Putting the fact sheet only in `allowedExtra` makes it available but does not prove an agent reads it, so the emitted-fact coverage guard must continue to reject that state.

**Applies to**: `packages/create-app/agentic/shared/`, `packages/create-app/agentic/claude-code/`, `packages/create-app/agentic/codex/`, `packages/create-app/agentic/cursor/`.
