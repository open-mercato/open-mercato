# Stabilize develop: green CI + CodeQL high-severity alert

**Date:** 2026-08-14
**Branch:** `fix/stabilize-develop-ci-security`
**Base:** `develop`
**Trigger:** PR #4840 (`pre-release: stabilization PR`, develop → main) is red on three checks; the same three are red on `develop` itself.

## Goal

Bring `develop` back to a green CI so the pre-release PR #4840 can go out: fix the three failing checks
(`Publish Snapshot`, `CodeQL`, `ephemeral-integration (14/15)`) at their root cause, without weakening any
check, test, or security control.

## Diagnosis

Three independent failures, all reproduced from CI logs and the code-scanning API rather than guessed:

### 1. `Publish Snapshot` — npm rejects provenance from self-hosted runners

```
npm error 422 Unprocessable Entity - PUT https://registry.npmjs.org/@open-mercato%2fwebhooks
- Error verifying sigstore provenance bundle: Unsupported GitHub Actions runner environment:
  "self-hosted". Only "github-hosted" runners are supported when publishing with provenance.
```

`scripts/publish-packages.sh` publishes every package with `npm publish --provenance`. Commit `34bd2d42f`
("Migrate workflows to Blacksmith runners", #5244) moved **every** job in the repo to
`blacksmith-4vcpu-ubuntu-2404`. Blacksmith runners register as `self-hosted`, and npm's sigstore
verification only accepts GitHub-hosted runners, so every publish attempt now fails — all 22 packages.
`Develop Snapshot Release` has been red on every commit since that migration, and the same defect is
latent in `release.yml`: **the next real release would fail the same way**.

Provenance is a supply-chain integrity control, so the fix moves the runner, not the flag: the three
jobs that call `npm publish --provenance` go back to GitHub-hosted `ubuntu-latest`. Every other job
stays on Blacksmith, so the migration's build-speed win is preserved.

### 2. `CodeQL` — 1 high-severity alert: Actions cache poisoning

Alert #188, rule `actions/cache-poisoning/direct-cache`, at `.github/workflows/audit.yml:77`:

> Potential cache poisoning in the context of the default branch due to privilege checkout of untrusted
> code. (schedule) / (workflow_dispatch).

`audit.yml` runs on `schedule`/`workflow_dispatch`, so it always executes with the *default branch's*
workflow definition and cache scope, but its matrix checks out `develop` **and** `main` and then
**writes** a Yarn cache with `actions/cache@v6`. A cache entry produced from the `develop` checkout is
therefore written into the default branch's cache scope, where any other workflow restoring the same
`yarn-${{ runner.os }}-…` key would pick it up. That is exactly the poisoning path CodeQL flags.

The audit only needs to *read* package downloads, never to publish them, so the fix is
`actions/cache/restore@v6` — restore-only. The workflow keeps its warm-cache speed-up (entries written by
`ci.yml` on the default branch are still restored) while no longer writing a cache from a non-default ref.
This is the only open code-scanning alert on `develop`.

### 3. `ephemeral-integration (14/15)` — TC-WF-030 races past the step it asserts

`packages/core/src/modules/workflows/__integration__/TC-WF-030.spec.ts` times out at 20 s. The captured
failure snapshot shows *why*: the run is not stuck, it has gone **too far** — `Start ✓`,
`Cart Validation ✓`, `Customer Information ✓`, and the page is parked on "Waiting for Payment
Confirmation" (`PAUSED`), so the `Customer Information Required` heading the test waits for is gone.

Every transition in the `checkout-demo` definition (`packages/core/src/modules/workflows/workflows.ts`)
has `trigger: 'auto'`, so the background executor walks START → Cart Validation → Customer Information on
its own and parks on the `USER_TASK`. The spec instead clicks "Advance to Next Step" a **fixed two
times**. When the executor completes Cart Validation between the spec's visibility probe and its second
click, that click lands on a stale `RUNNING` render and advances the *server's* current step — which is
already `customer_info` — one step too far, skipping the user task. Whether the executor wins that race
is timing-dependent, which is why the identical tree passed shard 14 on the push run and failed it on the
PR run of the very same SHA (`cdd3f00315`).

The fix drives progression off the instance's server-side `currentStepId` (via the existing
`pollWorkflowInstance` helper) and only clicks "Advance" when the run is genuinely still parked before
`customer_info`, so the manual fallback can no longer overshoot. The assertions the test exists for
(#4179 — reaching Customer Information with no `Order Failed` and no `CALL_WEBHOOK rejected unsafe URL`)
are unchanged and stay strict.

## Scope

- `.github/workflows/snapshot.yml`, `release.yml`, `npm-snapshot-preview.yml` — runner change for the
  provenance-publishing jobs only.
- `.github/workflows/audit.yml` — restore-only Yarn cache.
- `packages/core/src/modules/workflows/__integration__/TC-WF-030.spec.ts` — race-free progression.
- `scripts/__tests__/` — two new guard tests so all three regressions are caught by `yarn test:scripts`
  instead of by a red release.

## Non-goals

- Reverting the Blacksmith migration, or moving any job that does not publish with provenance.
- Touching the `checkout-demo` workflow definition or its page — the product behavior is correct; only
  the test's progression logic races.
- Retuning shard counts, timeouts, or retries to paper over the flake.
- Dependency bumps, unrelated CodeQL rule tuning, or changes to any other red check outside these three.

## Risks

- **Publish jobs on GitHub-hosted runners are slower** than Blacksmith. Accepted: correctness of a signed
  release outranks a few minutes of publish time, and provenance cannot be produced any other way.
- **Restore-only cache in `audit.yml`** means a cold cache when `ci.yml` has not populated the key. The
  audit job installs dependencies either way; the only cost is a slower daily run.
- **TC-WF-030 remains timing-sensitive by nature** (it drives a live background executor). The change
  removes the specific overshoot race; it cannot prove the absence of every future timing issue, so the
  polling helper is given explicit, bounded timeouts that stay inside the spec's 20 s budget.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: npm provenance publishing

- [ ] 1.1 Move the three provenance-publishing jobs to GitHub-hosted runners
- [ ] 1.2 Add a guard test asserting provenance publishes never run on self-hosted runners

### Phase 2: CodeQL cache-poisoning alert

- [ ] 2.1 Make the `audit.yml` Yarn cache restore-only
- [ ] 2.2 Add a guard test asserting no non-default-ref checkout writes an Actions cache

### Phase 3: TC-WF-030 integration flake

- [ ] 3.1 Drive checkout-demo progression off the instance's server-side step

### Phase 4: Validation

- [ ] 4.1 Run the full validation gate and record results
