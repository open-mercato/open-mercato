# Handoff — 2026-06-04-crudform-integration-tests

**Last updated:** 2026-06-04T21:45:00Z
**Foundation branch:** feat/crudform-integration-tests (off origin/develop @ 0bd8b3aab)
**Master ledger:** `.ai/runs/2026-06-04-crudform-integration-tests/MODULE-LEDGER.md` (this branch is authoritative)

## PRs shipped this session (all green + verified vs live :3000)
- **#2548** — foundation: harness + `OM_INTEGRATION_CRUDFORM_EXTENSION_TESTS_DISABLED` flag + jest unit
  tests + currencies reference spec + `.ai/qa/AGENTS.md` docs. Base develop. (currencies = A5)
- **#2551** — resources (A1): scalars + custom fields (text/integer/select/boolean). Stacked on #2548.
- **#2553** — staff (A2): scalars + multiselect (role_ids/tags) + 6-kind custom fields. Stacked on #2548.

## How to continue (per-module recipe — proven 3×)
1. `git checkout feat/crudform-integration-tests && git checkout -b feat/crudform-tests-<module>`
2. Dispatch a research subagent: read the module's `api/**` + `data/validators.ts` + `ce.ts`/fieldsets
   + `setup.ts` (seedDefaults vs seedExamples), and **live-probe :3000** (admin@acme.com/secret) to
   get exact create/update bodies + response JSON. Confirm `?id=` vs `?ids=` for read-back.
3. Write `packages/<pkg>/src/modules/<module>/__integration__/TC-<MOD>-CRUDFORM-001.spec.ts` using
   `runCrudFormRoundTrip` (override `readById` when the list ignores `?id=`); add `meta.ts` if missing.
4. Verify: `BASE_URL=http://localhost:3000 OM_INTEGRATION_MODULES=<module> npx playwright test --config .ai/qa/tests/playwright.config.ts TC-<MOD>-CRUDFORM-001 --retries=0`
5. Also confirm skip: re-run with `OM_INTEGRATION_CRUDFORM_EXTENSION_TESTS_DISABLED=1` → 1 skipped.
6. `yarn typecheck` (cached, fast). Commit, push, open PR with **base = feat/crudform-integration-tests**.
   Claim (assignee + in-progress + comment), label `review` + `skip-qa`, summary, release lock.
7. Update the ledger (this branch) with the PR number.

## Next up (Tier-A remaining): A3 catalog (multichoice CF), A4 customers (inline + dict), A6 auth
(roles[]+ACL+CF), A7 sales channels, A8 workflows (metadata.* dot-path #2503). Then Tier B/C — see ledger.

## Recurring contract gotchas (confirmed)
- Many core list routes ignore `?id=` and require **`?ids=`** for single-record read-back (resources, staff).
- Request bodies camelCase; responses snake_case. org/tenant injected from token — don't send them.
- Custom fields submit as `cf_<key>`; responses vary (`customValues` bare / top-level `cf_` / `customFields[]`)
  — the harness resolver handles all. PUT is partial — omitted CFs are retained.
- No optimistic-lock header needed on these makeCrud PUTs. Single-element multi-text CF can collapse to a scalar.
- Don't rely on seedExamples data (e.g. capacity units, demo teams) — create your own fixtures.

## Environment
- Live app on :3000 (admin@acme.com/secret) used for verification. API-only specs (`request` fixture) — no browser.
- Worktree: `.ai/tmp/auto-create-pr/crudform-integration-tests-20260604-220428` (created this run).
- Stacked PRs retarget base develop after #2548 merges.
