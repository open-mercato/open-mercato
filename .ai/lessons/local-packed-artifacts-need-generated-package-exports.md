---
title: "Local packed artifacts need generated package exports before rebuilding"
modules: ["create_app", "cli"]
areas: ["architecture", "testing"]
topics: ["generated-files", "build-output", "package-runtime", "template-sync"]
---

# Local packed artifacts need generated package exports before rebuilding

**Context**: A fresh isolated worktree rebuilt and packed core for a standalone harness controller. Authored source was current, but the worktree had no package-level generated entity exports.

**Problem**: A package build can succeed without optional generated entry points. The resulting archive then lacks the type and runtime targets declared by its package imports, producing standalone `#generated` resolution failures even though the application generator writes its own registries correctly.

**Rule**: Materialize package exports through supported generators before the final package rebuild and pack. Verify every generated type/runtime import target in the archive, including field indexes, rather than treating a successful build or matching authored-source hash as proof of a complete package. Preserve build, generate, rebuild ordering for the local dependency closure.

CLI builds also stage shared agentic assets: rebuild and repack the CLI and create-app after the final owner/runtime/catalog freeze, then compare their emitted payloads. Matching CLI TypeScript sources alone cannot certify staged instructions.

Instruction assertions must likewise target the artifact they describe: source templates can contain placeholders, so test emitted fact pointers and root context through supported scaffold generators.

Scaffold-only environment flags must not leak into controller preparation. Unset `OM_SKIP_EXTERNAL_SKILLS` before installing the pinned external skill collection, and verify its exact revision and directory hashes alongside local skill ownership before any live evaluation. A controller containing only local skills is incomplete; preserve its attempts as diagnostics and prepare a new controller rather than certifying or silently repairing the frozen copy.

**Applies to**: Local packed workspace verification, fresh worktrees, standalone harness controllers, and publishable packages with generated exports.
