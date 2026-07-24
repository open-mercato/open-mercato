# Pre-Implementation Analysis: Standalone AI Development Harness

> Target spec: `.ai/specs/2026-07-24-standalone-ai-development-harness.md`  
> Analysis date: 2026-07-24 · Read-only implementation audit (the target spec was remediated afterward)

## Executive Summary

The standalone harness needs replacement, not another overlay. A fresh scaffold from the exact `origin/develop` package reproduced four blocking defects: Claude setup can overwrite standalone skill overrides, the installed shared-skill subset is not dependency-closed, all tool entity guards watch a non-canonical path, and enhanced setup removes AI-agent/unified-override guidance. The published packages already contain version-matched `src/` and many package/module `AGENTS.md` files; discoverability through ignored `node_modules` is the missing layer.

Implementation is ready after the target-spec remediations recorded below. The work must remain sliced behind separate gates: context/router content, installer/emission/ownership, and evaluation. No runtime module, HTTP API, entity, event, widget, ACL, notification, or AI registry contract is changed.

## Current-State Evidence

- `packages/create-app/template/AGENTS.md` and `packages/create-app/agentic/shared/AGENTS.md.template` are competing root sources; agentic setup overwrites the former.
- `packages/create-app/src/setup/tools/shared.ts` and `packages/cli/src/lib/agentic-setup.ts` independently hard-code the emitted asset list and already drift.
- `packages/create-app/src/setup/tools/claude-code.ts` creates a directory-level `.claude/skills -> ../.ai/skills` link. A normal online install follows it and overwrites repo-local overrides.
- `packages/create-app/agentic/shared/ai/skills/tiers.json` omits hard dependencies now invoked by shared skills, including `om-auto-implement-spec` and `om-auto-qa-pr`.
- `packages/create-app/agentic/{codex,claude-code,cursor}` guards target `src/modules/*/entities/**`; canonical standalone entities are in `src/modules/*/data/entities.ts`.
- The shell installer requires `sh`, `jq`, and Unix link behavior; automatic callers in the wizard and installed CLI still spawn `sh`.
- Both build scripts copy over an existing `dist/agentic`; deleted assets can remain publishable.
- `@open-mercato/core`, UI, shared, CLI, AI assistant, search, and webhooks package artifacts contain exact source and root/package/module instructions. Existing harness guidance incorrectly sends agents only to `dist/`.
- The current `om-implement-spec` example teaches an obsolete `makeCrudRoute` signature, while a standalone CRUD route must follow the installed contract.

## Backward Compatibility Audit

| # | Contract surface | Impact | Required bridge / assertion |
|---|---|---|---|
| 1 | Auto-discovery conventions | Indirect high risk because generated instructions can teach obsolete paths. | Ban stale `api/<method>/<path>.ts` and `entities/**` examples; assert every frozen convention/export and canonical route/entity path. |
| 2 | Types/interfaces | No runtime type is changed. Harness/fact fields are additive. | Add `sourcePackage`/`sourceVersion`; retain `coreVersion` for one-release compatibility; compile representative generated code against installed types. |
| 3 | Function signatures | No runtime signature is changed, but stale examples can generate invalid code. | Ban the obsolete `makeCrudRoute({ entity, entityId, operations, schema })` form and validate against installed exports. |
| 4 | Import paths | Deep source is for analysis, not a new public import surface. | Guides must use package-public imports from installed AGENTS/types; generated-code typecheck catches deep/monorepo-only imports. |
| 5 | Event IDs | No event is renamed. | A BC case must require deprecation, dual emission, and upgrade notes for rename/removal requests. |
| 6 | Widget spot IDs | No spot is renamed. | A BC case must preserve existing spot/context types and wildcard semantics. |
| 7 | API URLs | No product route is changed. | A BC case must require an OpenAPI deprecation bridge and response compatibility for retirement/rename prompts. |
| 8 | Database schema | No runtime schema change. | A BC case must reject drop/rename/narrowing and retain standard columns; harness initialization must not apply migrations. |
| 9 | DI service names | No DI key is changed. | A BC case must retain the old registration/interface bridge on rename prompts. |
| 10 | ACL feature IDs | No ACL ID is changed. | A BC case must retain the ID or require a role-config migration. |
| 11 | Notification type IDs | No notification ID is changed. | A BC case must require a bridge for rename/removal. |
| 12 | AI IDs/overrides | No runtime registry is changed. | Cases must preserve agent/tool/UI-part IDs, null-disable semantics, override precedence, `allowedTools`, and mutation approval. |
| 13 | CLI commands | `install-skills`, `agentic:init --tool`, and `--force` are stable. New commands/flags are additive. | Keep all current installer flags; add ownership-aware `--update-harness`; keep automatic callers shell-free; test exit behavior. |
| 14 | Generated registry contracts | `.ai/harness/manifest.json` is separate from `.mercato/generated`. | Snapshot `.mercato/generated` exports before/after harness init and require equivalence, including all AI registry exports. |

The change modifies no frozen runtime surface and therefore needs no deprecation bridge or `UPGRADE_NOTES.md`. It does need conservative migration for generated developer files because existing apps may contain user edits.

## Spec Completeness and Remediation

### Blocking gaps found

1. **Routing was presented as implementation proof.** Read-only Codex/Claude plans cannot prove atomic writes, compilable CRUD, or repaired defects.
2. **The case schema lacked an owner despite requiring one.** Router/context matching and validators had no machine semantics.
3. **External skills were not reproducible.** Pinning `skills` CLI alone does not pin `open-mercato/skills` content.
4. **Generated-file ownership was underspecified.** Normal rerun, clean, force, corrupt manifests, modified files, and pre-manifest apps had no deletion table.
5. **Instruction precedence was ambiguous.** Standalone ownership rules and nearest installed module contracts govern different concerns.
6. **CLI/root snapshots were incomplete.** CLI builds copy agentic source, not create-app build output, so both builds must generate and clean snapshots independently.
7. **Module facts used one core version for every package.** Mixed installed package versions need source-package/version stamps without removing `coreVersion`.
8. **Automatic installer callers remained shell-bound.** Replacing only the package script would not make wizard/CLI setup cross-platform.

### Remediations applied to the target spec

- Split 70/70 deterministic/routing coverage from a fixed 16-case writable implementation/regression matrix with fixtures, allowed writes, and executable oracles.
- Added owner/rule IDs, validator registry IDs, precise subset/glob matching, byte/token budgets, safe result schema, exit codes, timeout semantics, and a fixed release matrix.
- Pinned both installer CLI and external collection commit, required content hashes and machine-readable dependency closure, and moved nonessential loop/issue workflows to opt-in.
- Defined concern-specific instruction precedence and app-root package resolution; stale facts are rejected rather than merely warned.
- Added the ownership state table, atomic manifest finalization, conservative pre-manifest hashes, and additive `--update-harness` behavior.
- Required both build paths to clean and snapshot independently, every automatic caller to invoke Node, and module facts to add `sourcePackage`/`sourceVersion` while preserving `coreVersion`.
- Added semantic assertions covering all 14 BC surfaces and `.mercato/generated` equivalence.

## AGENTS.md Compliance

| Rule | Assessment |
|---|---|
| Standalone-only scope | Satisfied: create-app/CLI emitted assets, scripts, and tests only. Installed framework packages stay read-only. |
| Specs checked before module work | Satisfied: prior standalone harness/fact-sheet specs were reviewed; this spec supersedes them only after acceptance. |
| Reference module for CRUD | `customers` must always be reachable through generated facts/context even when the empty preset does not enable it. |
| Backward compatibility | Audited above across all 14 current categories. |
| Generated files | Module facts remain generated. Builds clean stale artifacts before regeneration; hand editing generated facts is forbidden. |
| Template/CLI parity | One recursive emission contract and byte/tree parity tests are mandatory. |
| Validation runner | Must be selected once for the final configured gate and reported. No database migration is applied. |
| Ask-first surfaces | The user explicitly authorized the standalone harness/PR rewrite. Additive CLI behavior is within scope; no production dependency is added. |

## Risk Assessment

### High

- **Unsafe upgrade overwrites user instructions.** Mitigate with ownership hashes, side-by-side incoming files, exact historical hashes, and no-force early-exit preservation.
- **Installer deletes or duplicates skills.** Make the Node installer the sole owner of canonical/Claude links, preserve unknown paths, use fake-CLI and Windows resolution tests, and never let external failure publish partial state.
- **Guidance produces unsafe runtime code.** Mandatory cases cover scoping, ACL, optimistic locking, atomicity, cursor safety, and every frozen identifier family.
- **Published package stops carrying source/AGENTS.** Add pack/Verdaccio content guards and a clear dist/types degraded mode.

### Medium

- **Live evaluation flakes or changes with models.** Pin the release matrix, use one structured-output retry only, never average away safety failures, and retain deterministic executable oracles.
- **Prompt savings are cosmetic.** Enforce bytes/tokens as well as line/file counts and compare actual accessed context to a baseline.
- **Broad PR reviewability.** Keep phase commits and separate acceptance gates; the app remains usable after each slice.

## Required Test Matrix

1. Root/router/skill reference integrity, line/byte/token budgets, forbidden stale snippets, 70 valid unique cases, and all 14 BC rule IDs.
2. Node installer flags, dependency closure, pinned source, repeated `--skill`, external-before-local ordering, local success on network failure, clean/ignore/legacy behavior, unknown-path preservation, `.cmd` resolution, and Claude per-skill links.
3. Recursive create-app/CLI emission parity for all tool combinations, placeholder and binary handling, fresh/rerun/pre-manifest/modified/unknown/conflict behavior, and path traversal rejection.
4. Clean create-app and CLI build outputs, root/BC snapshot hash parity, no stale deleted assets, and package content guards for exact source/AGENTS.
5. Framework context for customers and an enabled declared package, hoisted/duplicate/mixed-version/missing-source fixtures, safe bounded query, read-only output, and stale-fact rejection.
6. Entity hooks for `data/entities.ts`, correct Cursor payload handling, no setup-time Claude directory link, and no duplicated architecture prose.
7. Fresh standalone scaffold and `agentic:init` parity, offline then fake-online skill installation, framework lookup, generation/typecheck/test/build, and unchanged `.mercato/generated` export contract.
8. Codex 70-case routing, Claude fixed 16-case routing, and 16 disposable writable implementation/regression oracles from the final commit.

## Recommendation

**Ready after spec remediation.** Implement phase-by-phase in the existing isolated worktree. Any attempt to skip ownership-safe migration, exact external pinning, executable implementation oracles, or package-content guards reopens a blocker.
