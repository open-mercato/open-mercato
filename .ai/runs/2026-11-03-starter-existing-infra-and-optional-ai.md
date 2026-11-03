# Starter: optional AI and reusable existing infrastructure

## Goal
Let setup proceed without an LLM key and reuse the matching Mercato infrastructure started by earlier tooling instead of treating it as foreign port owners.

## Scope and non-goals
Starter provider prompt, Compose discovery/read-only adoption, actionable port-conflict guidance, regression tests and related docs/spec. Diagnose the bootstrap module-facts warnings; change only a proven bootstrap logging defect if it is small and covered. Doctor was confirmed working by the operator and stays unchanged. Never kill unrelated processes or delete volumes. The operator chose explicit confirmation to continue using pre-existing services; otherwise print yarn om stop guidance. Add the requested greenfield existing-user refusal side quest and investigate the reported runtime diagnostics.

## Implementation plan
1. Make AI provider configuration optional with an interactive skip and non-interactive continuation; keep existing configured-provider synchronization.
2. Discover and verify existing matching Mercato containers across Compose project identity changes, reuse healthy services, retain readiness checks and diagnose incompatible/foreign owners.
3. Verify meaningful regressions and real read-only discovery on an already-running stack; apply appropriate validation and automated review.

## Risks
A container name or open port alone cannot establish compatible ownership. Preserve existing secrets, mounts and database credentials; do not automatically repoint services or stop another project's stack. Runtime migrations are not part of test execution without approval.

## Progress

PR: #8612

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Implementation

- [x] 1.1 Make the provider step optional and add regression coverage. — 191f8c57f
- [x] 1.2 Discover and reuse existing Mercato infrastructure with regression coverage. — 191f8c57f
- [x] 1.3 Resolve port guidance and module-facts warning diagnosis; update docs/spec. — 191f8c57f
- [x] 1.4 Require an explicit greenfield reset flag and correct Next development environment. — 191f8c57f

- [x] 1.5 Make the diagnostics Retry action recover the runtime instead of reloading stale state. — 1e55286bd

### Phase 2: Verification and publication

- [x] 2.1 Run relevant validation and real read-only discovery checks. — 191f8c57f
- [ ] 2.2 Run authoritative review and publish the completed PR.

## Diagnostic findings

- Module-facts: the first package build precedes generation, so no module registry exists yet; the warning is repeated per discovered module and affects AI documentation facts, not runtime authentication. Imported search constants are intentionally reported when static extraction cannot prove their IDs. No metadata warnings were suppressed.
- Greenfield: automatic --reinstall dates to PR #422 (2026-01-29), later moved from package.json into scripts/dev.mjs by #1141. The user requested explicit reset opt-in despite that history.
- Dev CSP: Next dev inherited NODE_ENV=production from the CLI's shared server environment. Set development on the Next child only; production CSP keeps its restrictions.
- localStorage warning reproduces on host Node 26; supported Node 24 does not emit it in the same native-global probe. No global warning suppression added.
- Destination-stream error: the supplied log exposes React's generic writable-stream error wrapper without the underlying stream failure. No unproven streaming patch added.

## Validation evidence

Runner: local. 567 starter/dev-runtime Node tests, 16 standalone setup tests and 75 CLI command tests passed. CLI suite also passed with supported Node 24. Mirrored dev runtime and infra-preflight files are byte-identical; template-sync and diff checks passed. Live read-only Docker discovery identified the existing four Mercato services across checkout identities and returned their actual names/states. No live services were stopped/restarted and no database migrations/resets were run. Full workspace validation is delegated to current-head GitHub CI; no claim of a fully green pipeline before it completes.

Runtime Retry follow-up: two failing click regressions reproduced the reload-only behavior. The new path invokes the existing restart control, retains old errors until a new generation becomes ready, and surfaces denied recovery. Banner tests 33/33 and runtime action/state tests 48/48 pass. Browser QA remains required; no live runtime was restarted during tests.
