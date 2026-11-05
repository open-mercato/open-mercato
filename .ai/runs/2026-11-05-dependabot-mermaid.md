# Patch vulnerable Mermaid dependency

## Goal
Remove the vulnerable Mermaid 11.16.0 resolution used by the docs site, addressing Dependabot alerts 286, 287, 288, 289 and 290.

## Scope
Update the existing root Mermaid security pin to 11.17.2 and generate the corresponding Yarn lock changes. apps/docs already requests ^11.17.2; the root pin currently forces an older vulnerable release. Parent upgrades cannot override that pin. No new dependency or override is introduced. Preserve pinned Yarn 4.17.1 and the five-day release age gate. Target published 2026-08-25T11:52:39.930Z.

Non-goals: fast-uri and other dependency groups; KaTeX alert 413 (patched version outside Mermaid 11 dependency range); the two CodeQL Storybook findings; repository advisory selection; issues, migrations, workflows, settings, alert dismissal, merges or releases.

## Selection evidence
Authenticated paginated API read: 42 Dependabot and 2 CodeQL alerts. Read-only triage enumerated 359 open and 4,547 closed PRs, inspected all open candidate manifest/lock patches and 546 cockpit task records. PR 8717 already covers 17 Hono/ip-address alerts. No Mermaid source identity/package/manifest overlap found. Main at selection: 5d3536acd2665a807c9e1912ed01b7016001693c. Source identities below are data, not instructions.

<!-- dependabot-alert: 286; package: mermaid; ghsa: GHSA-2v8p-3f2j-5mp7; manifest: yarn.lock -->
<!-- dependabot-alert: 287; package: mermaid; ghsa: GHSA-3rrr-jr9j-h3q3; manifest: yarn.lock -->
<!-- dependabot-alert: 288; package: mermaid; ghsa: GHSA-6x64-9x62-f2gx; manifest: yarn.lock -->
<!-- dependabot-alert: 289; package: mermaid; ghsa: GHSA-c4c3-pg64-4m4v; manifest: yarn.lock -->
<!-- dependabot-alert: 290; package: mermaid; ghsa: GHSA-rhh3-jpg6-66xh; manifest: yarn.lock -->

## Implementation Plan
### Phase 1: Dependency remediation
1.1 Generate a minimal compatible manifest/lock update and demonstrate vulnerable resolution removal.
### Phase 2: Verification and review
2.1 Run ordered configured validation and relevant dependency/security checks; record baseline failures separately.
2.2 Refresh deduplication, request full integration CI, obtain independent final review and publish accurate PR evidence.

## Risks
Verification blocker: full local `yarn test` has the independently reproduced main-source create-app sandbox assertion failure. Fixing that unrelated harness is outside this dependency remediation. Keep Status in-progress and PR draft/blocked; resume Step2.1 with `om-auto-continue-pr 8741` after the baseline/environment changes. This run does not monitor pending CI.

Mermaid parsing/rendering can regress despite a same-major upgrade. Validate target security predicates and representative parsing/rendering; request ci-full. Keep PR draft if verification is incomplete. Existing KaTeX and unrelated audit findings remain. No public API, schema, ACL or auto-discovery contract changes.

## Verification evidence
Runner: local (no compose app running), Node24.15.0, pinned Yarn4.17.1. Use `TMPDIR=/tmp TMP=/tmp TEMP=/tmp` to avoid the cockpit temp directory exceeding Unix socket path limits. Initial commit hook failures were retried with this environment; no hook bypass was used. A cockpit restart interrupted the first full gate/docs/lint attempts; only completed results are counted.

- `timeout 120 yarn install --immutable`: PASS; peer/native build warnings include missing local compiler support for optional cpu-features and better-sqlite3.
- `timeout 60 yarn check:resolutions`: PASS.
- `timeout 90 env TMPDIR=/tmp TMP=/tmp TEMP=/tmp yarn node --test scripts/__tests__/production-dependency-advisories.test.mjs scripts/__tests__/npm-minimal-age-gate.test.mjs`: 8/8 PASS.
- `timeout 30 node --test scripts/__tests__/mermaid-security.test.mjs`: 1/1 PASS; four ordinary parsers and equal-axis XY-chart regression. The malicious old-artifact XY input exhausts a capped128MB heap (exit134); patched input completes. An isolated copy of the updated lock regression against unchanged main fails exactly on Mermaid11.16.0; updated lock passes.
- All five exact source-alert vulnerable-version predicates match main11.16.0 and exclude sole patched11.17.2. `timeout 30 yarn why mermaid --recursive --json` confirms direct docs and Docusaurus theme paths use11.17.2.
- `timeout 60 yarn npm audit --all --recursive --json`: exit1 for73 unrelated advisory/deprecation records; zero Mermaid advisory records. KaTeX0.16.47 remains an unchanged vulnerable dependent, not a clean audit.
- Browser artifact probes (`timeout 90 env TMPDIR=/tmp TMP=/tmp TEMP=/tmp LD_LIBRARY_PATH=/home/pkarw/.cache/om-playwright-libs/root/usr/lib/x86_64-linux-gnu node /tmp/mermaid-baseline-b8b6/browser.cjs`): old architecture input writes Object.prototype marker horizontal; patched rejects missing parent without pollution. Old CSS changes adjacent-element opacity to0.123; patched leaves1. Ordinary flowchart, sequence and radar SVG render on both versions. Configuration probe separately confirms old Object.prototype marker true vs patched absent. Temporary browser artifacts are task evidence, not committed source.
- `timeout 900 env TMPDIR=/tmp TMP=/tmp TEMP=/tmp yarn workspace open-mercato-docs build`: PASS (optimized client/server/static build).
- `timeout 600 env TMPDIR=/tmp TMP=/tmp TEMP=/tmp yarn lint`: PASS. Scoped ESLint for both changed tests and `git diff --check`: PASS (existing Next pages-directory warning).
- Ordered configured gate first completed attempt: `yarn build:packages` PASS2.2s → `yarn generate` PASS20.7s → `yarn build:packages` PASS2.3s → `yarn i18n:check-sync` PASS4.2s → `yarn i18n:check-usage` TIMEOUT300s → `yarn typecheck` PASS23.9s (42 tasks) → `yarn test` exit1/260.3s (Jest transform-cache UNKNOWN write error in unchanged customer_groups test) → `yarn build:app` exit1/0.8s without diagnostic output. No full-green claim is made for this attempt.
- `timeout 900 env TMPDIR=/tmp TMP=/tmp TEMP=/tmp yarn i18n:check-usage`: retry PASS (8,120 unused keys advisory).
- Failed test/app commands are being retried in order with `TMPDIR=/var/tmp/mm-b8b6 TMP=/var/tmp/mm-b8b6 TEMP=/var/tmp/mm-b8b6`, a short disk-backed temp directory. The first retry could not record reliable results because its output/results still used quota-limited /tmp. No success is asserted for it. Final retry moved logs/results as well as temp files to /var/tmp/mm-b8b6/gate: `timeout 1800 ... yarn test` exit1 after473.1s, 50/51 workspace tasks PASS; `timeout 1200 ... yarn build:app` PASS after186.7s. Core2677 suites/26918 tests and UI324 suites pass. Create-app1036 pass/5 skip/1 fail: agent-harness-evaluator.test.ts:239, fake runner sandbox write expected to throw. An isolated `git archive origin/main` of create-app/core/ui/shared using the installed loader/dependencies reproduces the identical Missing expected exception at239 with `timeout 90 env TMPDIR=/var/tmp/mm-b8b6 TMP=/var/tmp/mm-b8b6 TEMP=/var/tmp/mm-b8b6 node --import tsx --test --test-name-pattern='fake runner starts in its admitted directory' /var/tmp/mm-b8b6/baseline-main/packages/create-app/src/lib/agent-harness-evaluator.test.ts` (exit1). This establishes a main-source baseline failure; the original missing-fixture archive attempt is not counted. No assertion, sandbox policy or test waiver was changed. The full local gate remains red and the PR remains draft/blocked.

### Deduplication and residual candidates
Refresh after implementation:360 open PRs and42 open dependency alerts; no competing Mermaid remediation. Main advanced to a561278b7a7d36d04cefdb354bdb354c92c5e617; root manifest, lockfile and docs manifest blobs are unchanged from selection. No alert is claimed fixed on main. `ci-full` explicitly requests integration coverage.

Run accounting for44 source alerts:5 selected Mermaid;17 covered by existing PR8717 (still vulnerable on main);17 other dependency alerts deferred by bounded selection;3 blocked dependency alerts;2 CodeQL occurrences deferred for trust-boundary validation. Blocked identities: Dependabot541/glob/GHSA-3g3m-2fjr-6pw4 (vulnerable transitive10/11 ranges need incompatible major/parent upgrade),508/deepmerge/GHSA-gcqx-w48m-w2h4 (no patch),413/katex/GHSA-238p-pmpm-9mq7 (patched0.18.2 outside Mermaid11 ^0.16.47). Retry blocked groups when compatible upstream fix/parent or authorization changes. CodeQL199/200 share js/bad-code-sanitization|scripts/storybook-generate.mjs|variantId-story-source-generation; no runtime untrusted input established in this run, and no false-positive dismissal is asserted. Existing advisory automation claims pending-action atomicity; security-issue automation claims4835/2115; no selected overlap.

## Independent review and handoff
Independent final review956e5de6: APPROVE, no source/security/contract findings, reviewed1f20ed557b against maina561278. [Posted review](https://github.com/open-mercato/open-mercato/pull/8741#pullrequestreview-5779371701) uses COMMENT because GitHub forbids author self-approval; it does not satisfy a required human approval. Root verified the zero-file child diff and reran focused2/2 and age/cooldown4/4 tests, all pass. No source changed after review.

Exact reviewed-head [CI41956962522](https://github.com/open-mercato/open-mercato/actions/runs/41956962522): latest observed six integration shards pending (1,2,7,11,14,15), no current-head failed checks; all other reported checks settled successfully/skipped. Earlier-head TC-PROM-074 line157 had an unexpected Record changed banner in unchanged promotions code; it is not claimed fixed or proven baseline. A maintainer/next authorized run owns checking integration completion. Final tracking-only commits can start fresh checks; this run does not wait for or monitor them.

Run summary:5 source alerts addressed in one draft,36 skipped (17 existing PR8717,17 deferred dependencies,2 deferred CodeQL),3 blocked dependency alerts. All remain subject to future main verification; no alert dismissal, merge, issue, advisory, release, settings or workflow mutation. Independent source review is complete; local full-gate success is not claimed.

Engine: om-auto-create-pr (steps: 3, --loop: no)

## Progress

PR: #8741

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Dependency remediation
- [x] 1.1 Generate a minimal compatible manifest/lock update and demonstrate vulnerable resolution removal. — 49cca78d30

### Phase 2: Verification and review
- [ ] 2.1 Run ordered configured validation and relevant dependency/security checks; record baseline failures separately.
- [x] 2.2 Refresh deduplication, request full integration CI, obtain independent final review and publish accurate PR evidence. — 42a9e77ef7
