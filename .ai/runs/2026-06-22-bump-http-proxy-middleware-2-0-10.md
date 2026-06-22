# Execution Plan — bump http-proxy-middleware 2.0.9 → 2.0.10 (migrate #3489 to develop)

## Goal

Re-create the Dependabot dependency bump from closed PR #3489 (which targeted `main`)
as a fresh PR against `develop`, bumping `http-proxy-middleware` from 2.0.9 to 2.0.10.
The 2.0.10 release hardens proxy-table matching to prevent a routing-bypass
(security) issue.

## Scope

- `yarn.lock` only — update the resolved version + checksum for the
  `http-proxy-middleware@npm:^2.0.9` descriptor.

### Non-goals

- No `package.json` range changes (the `^2.0.9` semver range already permits 2.0.10).
- No source/code changes; no behavior changes.
- No other dependency updates.

## Source

- Closed PR: https://github.com/open-mercato/open-mercato/pull/3489 (base `main`, CLOSED).
- Upstream changelog: http-proxy-middleware v2.0.10 — "fix(router): harden
  proxy-table matching (exact host for host+path keys, prefix-only path matching)
  to prevent routing bypass".

## Implementation Plan

### Phase 1: Apply lockfile bump

- Update the `http-proxy-middleware@npm:^2.0.9` lock entry to version 2.0.10 and
  its new checksum (matching the upstream PR diff), then run `yarn install` to
  confirm the lockfile resolves consistently.

### Phase 2: Validate

- Run `yarn install --mode=skip-build` (immutable check) to ensure the lockfile is
  internally consistent and no other entries drift. Deps-only change → no unit
  tests apply; this is the relevant gate.

## Risks

- **Lockfile drift:** running `yarn install` could touch unrelated entries. Mitigate
  by applying the exact known checksum from the upstream PR and verifying the diff
  stays limited to the single descriptor.
- **Transitive impact:** http-proxy-middleware is a patch bump within the same
  major; the new version only hardens routing — low blast radius. It is used by dev
  tooling/proxying, not customer-facing runtime.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Apply lockfile bump

- [ ] 1.1 Bump http-proxy-middleware lock entry to 2.0.10 and verify lockfile consistency

### Phase 2: Validate

- [ ] 2.1 Confirm immutable `yarn install` passes and diff is limited to yarn.lock
