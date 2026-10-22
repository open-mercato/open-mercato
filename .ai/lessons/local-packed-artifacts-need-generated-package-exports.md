---
title: "Verify generated exports and complete context in packed artifacts"
modules: ["create_app", "cli"]
areas: ["architecture", "testing"]
topics: ["generated-files", "build-output", "package-runtime", "template-sync", "preset-applicability", "instruction-context-closure"]
---

# Verify generated exports and complete context in packed artifacts

**Context**: A fresh isolated worktree rebuilt and packed core for a standalone harness controller. Authored source was current, but the worktree had no package-level generated entity exports.

**Problem**: A package build can succeed without optional generated entry points. The resulting archive then lacks the type and runtime targets declared by its package imports, producing standalone `#generated` resolution failures even though the application generator writes its own registries correctly.

**Rule**: Materialize package exports through supported generators before the final package rebuild and pack. Verify every generated type/runtime import target in the archive, including field indexes, rather than treating a successful build or matching authored-source hash as proof of a complete package. Preserve build, generate, rebuild ordering for the local dependency closure.

CLI builds also stage shared agentic assets: rebuild and repack the CLI and create-app after the final owner/runtime/catalog freeze, then compare their emitted payloads. Matching CLI TypeScript sources alone cannot certify staged instructions.

Instruction assertions must likewise target the artifact they describe: source templates can contain placeholders, so test emitted fact pointers and root context through supported scaffold generators.

Scaffold-only environment flags must not leak into controller preparation. Unset `OM_SKIP_EXTERNAL_SKILLS` before installing the pinned external skill collection, and verify its exact revision and directory hashes alongside local skill ownership before any live evaluation. A controller containing only local skills is incomplete; preserve its attempts as diagnostics and prepare a new controller rather than certifying or silently repairing the frozen copy.

Measure required context separately from observed optional reads before changing a harness ceiling. An extra selected skill can make an observed run exceed its budget even when every mandatory owner fits. Conversely, prove an unavoidable minimum from the task, owning instructions, visible fact projections and fixed oracle before calibrating an impossible ceiling. Measure all presets and keep safety, write, refusal and semantic checks unchanged.

For specification-only reference planning, audit every conditional workflow step against the authorized read set. An introductory phase exception does not resolve a later unconditional blueprint, contracts or implementation-reference requirement. Scope each conflicting condition explicitly while retaining actual implementation duties; verify both branches before approving the owner change. Include every required branch, including UI page/navigation design, in the complete context proof; a reserve calculated from an omitted branch is not usable headroom. Put capability-only mapping qualifiers before specialist matching in the root, so future capability names do not select implementation procedures before the narrower owner is read. After root wording compaction, scan its literal test consumers and run every declared focused file; a narrow owner suite can miss a guard introduced by a shared specification. Preserve each semantic assertion when updating its obsolete spelling.

Validate the full catalog on a fresh fully enabled controller. For reduced presets, preserve their actual failures and check each missing fact against the intentionally disabled module set; do not invent inactive facts or call a failed full-catalog probe a pass. Fresh applicable-preset payload, link, root and pinned-skill proofs remain required.

**Applies to**: Local packed workspace verification, fresh worktrees, standalone harness controllers, and publishable packages with generated exports.
