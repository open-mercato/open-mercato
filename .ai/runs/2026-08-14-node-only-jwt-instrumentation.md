# Node-only JWT instrumentation execution plan

## Goal

Remove the Edge Runtime warnings emitted by the application instrumentation hook while preserving the fail-fast JWT secret policy for Node.js web servers.

Source doc: `.ai/specs/2026-04-29-telemetry-and-otel.md`

## Scope

- Keep the monorepo app and standalone create-app template instrumentation sources synchronized.
- Load the Node-only JWT helper only when Next.js identifies the Node.js runtime.
- Preserve the production-build skip and immediate process termination for an unsafe production secret.
- Add regression coverage for app/template parity and the Edge-safe universal instrumentation source.

## Non-goals

- Change JWT validation, signing, token migration, or secret-strength semantics.
- Change telemetry initialization behavior.
- Change APIs, database structure, UI, dependencies, or scaffold modes.

## Implementation Plan

### Phase 1: Runtime isolation and regression coverage

1. Move the JWT startup check behind the Node runtime boundary in both instrumentation entrypoints without weakening fail-fast termination.
2. Add focused create-app tests that lock app/template parity and prevent unsupported direct Node API access from returning to the universal hook.

### Phase 2: Verification and delivery

1. Run targeted tests plus the configured validation gate in the repository-selected runner mode.
2. Complete the authoritative PR review/autofix pass and finalize the ready PR with verification evidence.

## Risks

- A misplaced runtime guard could skip the JWT policy in the Node server; focused source-contract tests and the application build cover the intended branch shape.
- Moving the auth import could change initialization order; the implementation keeps the check before telemetry and awaits the Node-only import.
- The change touches auth startup behavior, so the PR remains high-risk despite its narrow code footprint.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Runtime isolation and regression coverage

- [x] 1.1 Isolate the JWT startup check to the Node runtime without weakening fail-fast termination — eca5e8e80
- [x] 1.2 Add app/template parity and Edge-safety regression coverage — eca5e8e80

### Phase 2: Verification and delivery

- [x] 2.1 Run targeted validation and the configured full validation gate — eca5e8e80
- [ ] 2.2 Complete the authoritative review pass and finalize the PR
