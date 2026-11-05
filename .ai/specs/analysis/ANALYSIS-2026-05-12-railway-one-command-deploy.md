# Pre-Implementation Analysis: Railway One-Command Deployment

## Executive Summary

The specification is ready for implementation after the 2026-06-03 live Railway verification and the 2026-06-04 maintainer decision to support both Git-backed and local uploads. The implementation is additive, but must treat the new CLI command and state-file schema as stable contracts once shipped.

## Backward Compatibility

### Violations Found

| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|--------------|
| 1 | CLI commands | The new command becomes a stable public contract after release. | Warning | Add it without renaming existing commands and keep future flags additive. |
| 2 | Generated files | No generated registry contract is needed for deployment. | Warning | Register `deploy` as a bootstrap-free built-in CLI module instead of changing generator output. |

### Missing BC Section

The specification includes a Migration & Backward Compatibility section and correctly classifies the change as additive.

## Spec Completeness

### Missing Sections

| Section | Impact | Recommendation |
|---------|--------|---------------|
| Explicit phasing | Progress cannot be mapped directly to implementation phases. | Treat CLI foundation, Railway orchestration, template/runtime, tests, and docs as implementation phases. |

### Incomplete Sections

| Section | Gap | Recommendation |
|---------|-----|---------------|
| Integration tests | The proposed `.ai/qa` executable-test location conflicts with `.ai/qa/AGENTS.md`. | Put executable Railway tests under `packages/cli/src/lib/deploy/railway/__integration__/`. |
| Healthcheck | Some examples omit the repository's `src/` app root. | Implement at `src/app/api/healthz/route.ts` in the app and create-app template. |
| Workspace selection | Selecting the first workspace can be unsafe in shared CI accounts. | Persist the selected workspace and document that v1 uses the first accessible workspace. |

## AGENTS.md Compliance

### Violations

| Rule | Location | Fix |
|------|----------|-----|
| Executable integration tests must not live in `.ai/qa/tests`. | Testing strategy | Use the CLI package `__integration__` directory and metadata gating. |
| Standalone template changes require standalone verification. | Template requirements | Run create-app tests in addition to CLI tests and builds. |
| Public CLI contracts are stable. | Command surface | Keep implementation additive and document the state schema version. |

## Risk Assessment

### High Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Railway GraphQL schema drift | Deployment can stop at any provisioning step. | Keep operations isolated, surface raw GraphQL errors, and test request shapes with mocked transport. |
| Secret leakage in env values or logs | Account or provider credentials can be exposed. | Use a shared value scanner/redactor for dry-run output, verbose responses, and logs. |

### Medium Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Ambiguous mutation outcomes | Duplicate paid resources can be created. | Never retry mutations blindly; persist each successful resource immediately and lookup before recreation. |
| Local upload archive includes private files | Local secrets can leave the machine. | Require a Railway CLI preflight and ship `.railwayignore`. |
| Git deploy builds stale code | Production differs from the local checkout. | Require a clean worktree and a branch that is not ahead of its upstream. |

### Low Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Committed Railway IDs reveal resource identifiers | Low-value metadata becomes public. | Store no secrets and support `--no-track`. |

## Gap Analysis

### Critical Gaps (Block Implementation)

- None after the live Phase 0 verification and maintainer approval in issue #2414.

### Important Gaps (Should Address)

- Test discovery paths must follow the current Jest and Playwright configuration.
- The implementation should avoid adding a WebSocket production dependency; HTTP log polling is an acceptable fallback.
- The scaffold copier does not preserve executable bits, so Railway start commands should invoke scripts through `sh`.

### Nice-to-Have Gaps

- Explicit workspace selection can be added later as an additive flag.
- A schema-refresh developer command can follow after the initial implementation.

## Remediation Plan

### Before Implementation (Must Do)

1. Register deployment as a bootstrap-free built-in CLI command.
2. Keep all Railway operations behind a typed client and injectable dependencies.

### During Implementation (Add to Spec)

1. Record actual test locations and the final healthcheck path.
2. Add implementation status and validation evidence.

### Post-Implementation (Follow Up)

1. Run the gated live Railway test with a dedicated sandbox account.
2. Consider an additive `--workspace` flag after multi-workspace dogfooding.

## Recommendation

Ready to implement.
