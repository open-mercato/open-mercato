# Patch glob, minimatch, and katex transitive dependency vulnerabilities

## Goal

Close three unclaimed open Dependabot alert groups — glob (`>=9, <=14.0.1`), minimatch (`>=7, <11.0.1`), and katex (`>=0.11, <0.18.2`) — by forcing patched transitive copies through the repository's existing root `resolutions` block, with direct manifest ranges untouched.

## Scope

Source identities (deduplication markers):

- `dependabot:open-mercato/open-mercato:541` — GHSA-3g3m-2fjr-6pw4 — glob — fixed 14.0.2
- `dependabot:open-mercato/open-mercato:543` — GHSA-g3hv-75wg-m249 — minimatch — fixed 11.0.1
- `dependabot:open-mercato/open-mercato:413` — GHSA-238p-pmpm-9mq7 — katex — fixed 0.18.2

Root `package.json` `resolutions` changes and a regenerated `yarn.lock` only:

- add `"glob": "14.0.6"` — forces every transitive copy (jest 30 via `@jest/reporters`/`jest-config`/`jest-runtime`, `@figma/code-connect`, `@joshwooding/vite-plugin-react-docgen-typescript`, `react-email`, `rimraf`, `cacache`, `archiver-utils`, `test-exclude`) onto the already-patched direct line (`^14.0.6` stays).
- bump `"minimatch": "10.2.3"` → `"11.0.1"` — the existing resolution pin is itself inside the vulnerable range.
- add `"katex": "0.18.2"` — mermaid 11.17.2 declares `^0.16.47`; no patched mermaid line exists on that range, so the root resolution is the minimal fix (docs-app dev dependency).

No application code, no CI/workflow changes, no alert dismissals, no issue creation, no `npm audit fix --force`, no audit allowlist entries.

## Non-goals

- Every other open alert group is claimed by an existing in-progress PR and stays untouched: fast-uri (#8778), protobufjs (#8857), `@hono/node-server` + postcss-selector-parser (#8946), moment + postcss (#8971), `@humanfs/node` + serialize-javascript (#8982), node-forge (#9283), hono (#9471), CodeQL storybook (#8747), CodeQL tpay (#225, protocol-mandated — blocked, no patch).
- No upgrades of the direct `glob`/`minimatch` consumers, no lockfile-wide deduplication, no dependency-range cleanups.

## Implementation Plan

### Phase 1: Remediation

- 1.1 Pin patched transitive versions in root `resolutions` and regenerate `yarn.lock`.
- 1.2 Prove no vulnerable copies remain: `yarn why` per package and lockfile grep.

### Phase 2: Verification and review

- 2.1 Run the ordered `validation.commands` gate (local runner — no Docker app container) plus `yarn lint`; document real blockers.
- 2.2 Independent review verdict, PR labels, summary comment; ready only on approve.

## Risks

- Forced cross-major/cross-minor transitive bumps touch dev tooling: jest on glob 10/13→14, eslint/testcontainers on minimatch 10→11, docs mermaid on katex 0.16→0.18. The full gate (unit tests, typecheck, both builds, i18n checks) plus lint exercises jest, eslint, and the docs build; katex math rendering inside mermaid diagrams is not covered by any automated test and is disclosed as a residual limitation in the PR body.
- All three pins are single lines in the `resolutions` block; rollback is removing/reverting them and re-running `yarn install`.
- Pinned versions are older than five days (glob 14.0.6: 2026-11-12; minimatch 11.0.1: 2026-10-27; katex 0.18.2: 2026-08-08) — the five-day age gate holds.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Remediation

- [x] 1.1 Pin patched transitive versions in root `resolutions` and regenerate `yarn.lock`. — 8c76f0d3d3
- [x] 1.2 Prove no vulnerable copies remain: `yarn why` per package and lockfile grep. — 8c76f0d3d3

### Phase 2: Verification and review

- [ ] 2.1 Run the ordered `validation.commands` gate (local runner — no Docker app container) plus `yarn lint`; document real blockers.
- [ ] 2.2 Independent review verdict, PR labels, summary comment; ready only on approve.

## Release-line dependency compatibility

The coverage filter uses test-exclude 7.0.2 so it can load the named Glob and Minimatch exports supported by the new dependency graph. Glob 14.0.6 uses minimatch 11.0.5, which satisfies its declared range. KaTeX remains pinned to 0.18.2.
