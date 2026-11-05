# Issue #3805 — direct mutation approval bypass

## Plan

1. Read-only triage and caller analysis; recheck concurrency before claiming.
2. Add boundary regression tests and demonstrate failure on the old route.
3. Reject mutation tools at the direct HTTP boundary; preserve internal execution.
4. Document the security compatibility exception; validate, commit, review, publish if authorized.

## om-verify-in-repo

Proceed: #3805 is a real, still-unfixed bug at the inspected fork of main. The direct tools/execute route invokes executeTool after authentication and ACL loading; executeTool checks tool features and input then calls the handler without approval. The issue is open and unassigned, with no in-progress label and only a September 19 claim. All-state PR search, cross-reference timeline, and origin/main commit search found no matching implementation; search hits were unrelated PR bodies. This is code-based confirmation before running a regression.

## om-root-cause

Summary: The direct tool HTTP endpoint invokes mutation handlers without the agent mutation approval protocol.

Root cause: POST /api/ai_assistant/tools/execute loads the registry and calls executeTool at api/tools/execute/route.ts:63. lib/tool-executor.ts:89 calls tool.handler after only feature and input checks. Unlike lib/agent-tools.ts:275, this entry point never calls prepareMutation and has no agent or pending-action context. This permits an authenticated caller with write features to bypass the approval and tenant policy control plane; inferred from code, then reproduced by boundary tests.

Files to change:
- packages/ai-assistant/src/modules/ai_assistant/api/tools/execute/route.ts — reject registered isMutation tools before executeTool.
- packages/ai-assistant/src/modules/ai_assistant/api/tools/execute/__tests__/route.test.ts — real registry/executor boundary regressions.
- packages/ai-assistant/src/modules/ai_assistant/i18n/{en,de,es,ko,pl}.json — localized refusal message.
- .ai/specs/2026-10-31-issue-3805-direct-tool-mutation-approval.md — contract and migration record.
- BACKWARD_COMPATIBILITY.md and UPGRADE_NOTES.md — required security exception and client/operator migration disclosure.

Approach: Guard only the direct HTTP boundary after tool loading. The shared executeTool also serves agent-tools' policy-permitted non-destructive writes and in-process/MCP transports, so rejecting all mutations there would break current internal callers. Confirm-required agent calls stage via prepareMutation; approved confirms invoke the handler through pending-action-executor. Keep those paths untouched and run their regressions.

Risks: The endpoint's previously successful mutation behavior becomes HTTP 403. A compatibility bridge would retain the bypass, so the emergency security exception requires disclosure and named maintainer sign-off before merge. Reads, legacy tools without mutation metadata, existing ACL/input checks, and approved chat/object/confirm flows must remain intact. Mutation metadata correctness remains an existing tool-author obligation.

## om-fix input

— PREVIOUS STEP (om-root-cause) said —
Summary: The direct tool HTTP endpoint invokes mutation handlers without the agent mutation approval protocol.

Root cause: POST /api/ai_assistant/tools/execute loads the registry and calls executeTool at api/tools/execute/route.ts:63. lib/tool-executor.ts:89 calls tool.handler after only feature and input checks. Unlike lib/agent-tools.ts:275, this entry point never calls prepareMutation and has no agent or pending-action context. This permits an authenticated caller with write features to bypass the approval and tenant policy control plane; inferred from code, then reproduced by boundary tests.

Files to change:
- packages/ai-assistant/src/modules/ai_assistant/api/tools/execute/route.ts — reject registered isMutation tools before executeTool.
- packages/ai-assistant/src/modules/ai_assistant/api/tools/execute/__tests__/route.test.ts — real registry/executor boundary regressions.
- packages/ai-assistant/src/modules/ai_assistant/i18n/{en,de,es,ko,pl}.json — localized refusal message.
- .ai/specs/2026-10-31-issue-3805-direct-tool-mutation-approval.md — contract and migration record.
- BACKWARD_COMPATIBILITY.md and UPGRADE_NOTES.md — required security exception and client/operator migration disclosure.

Approach: Guard only the direct HTTP boundary after tool loading. The shared executeTool also serves agent-tools' policy-permitted non-destructive writes and in-process/MCP transports, so rejecting all mutations there would break current internal callers. Confirm-required agent calls stage via prepareMutation; approved confirms invoke the handler through pending-action-executor. Keep those paths untouched and run their regressions.

Risks: The endpoint's previously successful mutation behavior becomes HTTP 403. A compatibility bridge would retain the bypass, so the emergency security exception requires disclosure and named maintainer sign-off before merge. Reads, legacy tools without mutation metadata, existing ACL/input checks, and approved chat/object/confirm flows must remain intact. Mutation metadata correctness remains an existing tool-author obligation.


## Validation evidence

Runner: local. No running compose app was found; one fallback compose probe could not interpolate its required environment. An initial attempt against ancestor dependencies failed on incompatible signal-exit/esbuild versions. Clean isolated dependencies then produced the results below without any tracked dependency change. Short disk temporary storage avoids tmpfs quota and UNIX-socket path-length failures.

| Configured command (ordered) | Result | Evidence / limitation |
|---|---|---|
| yarn build:packages | PASS | All package builds completed. |
| yarn generate | FAIL | CLI workspace link targets parent tree without built dist/bin.js. |
| yarn build:packages | PASS | Second ordered pass completed. |
| yarn i18n:check-sync | PASS | All five locales synchronized. |
| yarn i18n:check-usage | PASS | No missing keys; existing unused-key warnings advisory. |
| yarn typecheck | FAIL | Core reports missing #generated/entities.ids.generated and related generated artifacts. |
| yarn test | FAIL | web-research-exa ts-jest cannot use TypeScript 7 compiler API; stops root test gate. |
| yarn build:app | FAIL | Parent-linked telemetry dist/nextjs-config.js is absent. |

The regression suite invokes the real HTTP route, registry, executor, Zod parser, and ACL matcher. Four cases were observed failing against the old route before the fix, then reproduced using clean dependencies: ordinary caller, superadmin, forged approval, and loading-time registration. The restored fixed source passes all 1801 package tests. Supplemental changed-file TypeScript validation uses the package config with explicit changed TS entry points and their full imports, Jest/Node types, noEmit, and incremental=false. Native compatibility-context-budget tests pass with unchanged caps and a 117-byte appended compatibility entry; existing policy text is byte-preserved.

## om-fix output

Status: ready
Files changed:
- packages/ai-assistant/src/modules/ai_assistant/api/tools/execute/route.ts
- packages/ai-assistant/src/modules/ai_assistant/api/tools/execute/__tests__/route.test.ts
- packages/ai-assistant/src/modules/ai_assistant/lib/__tests__/direct-execution-approval-paths.test.ts
- packages/ai-assistant/src/modules/ai_assistant/i18n/en.json
- packages/ai-assistant/src/modules/ai_assistant/i18n/de.json
- packages/ai-assistant/src/modules/ai_assistant/i18n/es.json
- packages/ai-assistant/src/modules/ai_assistant/i18n/ko.json
- packages/ai-assistant/src/modules/ai_assistant/i18n/pl.json
- .ai/analysis/issue-3805.md
- .ai/specs/2026-10-31-issue-3805-direct-tool-mutation-approval.md
- BACKWARD_COMPATIBILITY.md
- UPGRADE_NOTES.md

Summary: Direct HTTP execution rejects mutation tools before their handler runs. Keeping the guard at this boundary preserves ordinary read tools and existing policy-controlled internal execution, including confirmation staging and approved mutations.

Tests: Old route: four boundary tests fail because the handler runs; six other boundary tests pass. Fixed route: 42 focused tests and all 132 AI-assistant suites / 1801 tests pass directly on clean dependencies. Package build, scoped changed-file/dependency TypeScript check, translation sync/usage, native compatibility context budget, instruction budget, and diff check pass. Full local configured gate ran in order: build:packages PASS, generate FAIL (workspace CLI symlink points to a parent tree without built CLI), build:packages PASS, i18n:check-sync PASS, i18n:check-usage PASS (unused keys advisory), typecheck FAIL (missing generated registry imports), test FAIL (other packages use ts-jest against TypeScript 7 without its JS API), build:app FAIL (parent-linked telemetry dist missing). No checks were weakened or skipped.

Breaking changes: STABLE direct mutation API behavior becomes 403. Emergency Security Exception steps 1–3 requested; client/operator migration, audit guidance, and named human maintainer waiver pending before merge are documented. No shared executor signature, schema, or internal caller changes.

## om-open-pr input

om-open-pr #3805 --handoff om-auto-review-pr

— PREVIOUS STEP (om-fix) said —
Status: ready
Files changed:
- packages/ai-assistant/src/modules/ai_assistant/api/tools/execute/route.ts
- packages/ai-assistant/src/modules/ai_assistant/api/tools/execute/__tests__/route.test.ts
- packages/ai-assistant/src/modules/ai_assistant/lib/__tests__/direct-execution-approval-paths.test.ts
- packages/ai-assistant/src/modules/ai_assistant/i18n/en.json
- packages/ai-assistant/src/modules/ai_assistant/i18n/de.json
- packages/ai-assistant/src/modules/ai_assistant/i18n/es.json
- packages/ai-assistant/src/modules/ai_assistant/i18n/ko.json
- packages/ai-assistant/src/modules/ai_assistant/i18n/pl.json
- .ai/analysis/issue-3805.md
- .ai/specs/2026-10-31-issue-3805-direct-tool-mutation-approval.md
- BACKWARD_COMPATIBILITY.md
- UPGRADE_NOTES.md

Summary: Direct HTTP execution rejects mutation tools before their handler runs. Keeping the guard at this boundary preserves ordinary read tools and existing policy-controlled internal execution, including confirmation staging and approved mutations.

Tests: Old route: four boundary tests fail because the handler runs; six other boundary tests pass. Fixed route: 42 focused tests and all 132 AI-assistant suites / 1801 tests pass directly on clean dependencies. Package build, scoped changed-file/dependency TypeScript check, translation sync/usage, native compatibility context budget, instruction budget, and diff check pass. Full local configured gate ran in order: build:packages PASS, generate FAIL (workspace CLI symlink points to a parent tree without built CLI), build:packages PASS, i18n:check-sync PASS, i18n:check-usage PASS (unused keys advisory), typecheck FAIL (missing generated registry imports), test FAIL (other packages use ts-jest against TypeScript 7 without its JS API), build:app FAIL (parent-linked telemetry dist missing). No checks were weakened or skipped.

Breaking changes: STABLE direct mutation API behavior becomes 403. Emergency Security Exception steps 1–3 requested; client/operator migration, audit guidance, and named human maintainer waiver pending before merge are documented. No shared executor signature, schema, or internal caller changes.
