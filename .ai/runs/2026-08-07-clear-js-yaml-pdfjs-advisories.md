# Clear the js-yaml and pdfjs-dist high-severity advisories

## Goal

Make `node scripts/audit-ci.mjs --severity high` pass again on `develop` by bumping the three
dependencies that currently carry high-severity advisories, so the `audit` CI job stops failing
every pull request that touches a package manifest.

## Context

The `audit` job in `.github/workflows/ci.yml` runs only when `audit-scope` detects a change to a
`package.json` or a lockfile, and it audits the **whole** resolved dependency graph. Three advisories
published against the graph currently make it fail:

| Package | Vulnerable range | Advisory |
| --- | --- | --- |
| `js-yaml` | `>=3.0.0 <3.15.1` | [GHSA-5p4m-2wfm-xmqj](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj) (CVE-2026-59870) |
| `js-yaml` | `>=4.0.0 <4.3.1` | [GHSA-5p4m-2wfm-xmqj](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj) (CVE-2026-59870) |
| `pdfjs-dist` | `>=5.6.83 <6.2.108` | [GHSA-hq66-cqwq-w95j](https://github.com/advisories/GHSA-hq66-cqwq-w95j) |

The root `resolutions` block already pins `js-yaml` at `3.15.0` / `4.3.0` — the fixes for the previous
round of advisories — and both pins are now themselves vulnerable, so the audit cannot be satisfied by
a plain `yarn up`. `pdfjs-dist` is a first-party dependency declared at `^6.1.200` in three manifests.

Because the gate is coarse (any manifest change triggers a full-graph audit) and deliberately fails
closed, this backlog blocks unrelated pull requests — PR #5064, for example, only edited a `scripts.test`
entry in `packages/create-app/package.json`. Fixing the graph is the correct unblock; weakening the gate
is not.

## Scope

- Bump the `js-yaml` pins inside the root `resolutions` block, reusing the existing descriptor keys.
- Bump the `pdfjs-dist` range in `package.json`, `packages/core/package.json` and `apps/mercato/package.json`.
- Refresh `yarn.lock` via `yarn install`.

## Non-goals

- No CI workflow changes and no softening of the audit gate.
- No unrelated dependency bumps — `fast-uri`, `undici`, `brace-expansion`, `ip-address` and
  `socket.io-parser` are covered by PR #5085 on its own branch.
- No backport to `main` in this run; that belongs to the `main` advisory tracking issue #4945.
- No change to any application code — the `pdfjs-dist` bump stays within the same major.

## Implementation Plan

### Phase 1: Bump the vulnerable dependencies

- 1.1 Bump the five `js-yaml` descriptor pins in the root `resolutions` block to `3.15.1` / `4.3.1`,
  leaving the descriptor keys untouched so no dead key is introduced (issue #5098).
- 1.2 Bump `pdfjs-dist` from `^6.1.200` to `^6.2.108` in `package.json`, `packages/core/package.json`
  and `apps/mercato/package.json`.
- 1.3 Run `yarn install` and review the resulting `yarn.lock` delta for unrelated churn.

  Note from execution: the resolutions bump alone was not enough. `@eslint/eslintrc` declares
  `js-yaml@^4.3.0`, a descriptor none of the five pinned keys covers, and `4.3.0` still satisfies it —
  so `yarn install` happily kept the vulnerable resolution and the audit still failed. Rather than add a
  sixth descriptor-keyed pin (more of exactly the debt issue #5098 is about), the stale
  `"js-yaml@npm:^4.3.0"` lockfile entry was dropped so `yarn install` re-resolved it; it now shares the
  `4.3.1` entry.

### Phase 2: Verify

- 2.1 Confirm `node scripts/audit-ci.mjs --severity high` reports zero advisories at high or above.
- 2.2 Run the configured validation gate, with attention to the `attachments` module tests that
  exercise `pdfjs-dist` (`packages/core/src/modules/attachments/lib/__tests__/textExtraction.test.ts`).

## Risks

- **Lockfile conflict with PR #5085.** That PR is in `merge-queue` and also rewrites `yarn.lock`.
  Whichever lands second needs a `yarn install` re-resolution rather than a hand-merged lockfile.
- **`pdfjs-dist` minor bump.** `6.1.200 → 6.2.108` is in-major, and the only first-party consumers are
  `packages/core/src/modules/attachments/lib/{textExtraction,pdfProcessing,ocrService}.ts`; the module's
  tests cover the extraction path.
- **Advisory database drift.** The audit result is a function of the graph *and* the advisory database at
  run time, so a new advisory published mid-run can still fail CI on an unrelated package. That is the
  gate working as designed, not a regression of this change.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Bump the vulnerable dependencies

- [x] 1.1 Bump the `js-yaml` resolutions pins to 3.15.1 / 4.3.1 — cafcc7aa7
- [x] 1.2 Bump `pdfjs-dist` to `^6.2.108` in the three manifests — cafcc7aa7
- [x] 1.3 Refresh `yarn.lock` with `yarn install` — cafcc7aa7

### Phase 2: Verify

- [x] 2.1 Confirm the high-severity audit passes — cafcc7aa7
- [ ] 2.2 Run the validation gate, including the attachments tests
