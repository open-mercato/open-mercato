# Execution plan — bump @grpc/grpc-js 1.14.3 → 1.14.4 (migrate #3022 to develop)

## Overview

Dependabot PR [#3022](https://github.com/open-mercato/open-mercato/pull/3022) bumps the
transitive dependency `@grpc/grpc-js` from 1.14.3 to 1.14.4, but it targets `main`. The
team's integration branch is `develop`, so the bump must land there first. This run
recreates the identical `yarn.lock` change on a `develop`-based branch, opens a PR against
`develop`, and closes the original `main`-targeted #3022.

The 1.14.4 release fixes two security advisories:

- GHSA-5375-pq7m-f5r2 — server crash on malformed requests.
- GHSA-99f4-grh7-6pcq — client/server crash on malformed compressed messages.

`@grpc/grpc-js` is a transitive dependency (resolved via `^1.11.1`/`^1.13.2` ranges), so
the only change required is the single resolution/checksum entry in `yarn.lock`.

### Goal

Land the `@grpc/grpc-js` 1.14.4 security patch on `develop` and close the `main`-targeted #3022.

### Scope

- `yarn.lock` only — bump the `@grpc/grpc-js` resolution + checksum to 1.14.4.

### Non-goals

- No `package.json` change (the dep is transitive; no direct version pin exists).
- No application code changes.
- Do not merge — the PR goes through normal review/merge-queue.

### Risks

- Patch-level bump of a transitive networking dependency; behavior change is limited to the
  two crash fixes in the advisories. Lockfile validated with `yarn install --immutable`.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Recreate bump on develop

- [ ] 1.1 Apply identical `@grpc/grpc-js` 1.14.4 resolution/checksum to `yarn.lock`
- [ ] 1.2 Validate lockfile with `yarn install --immutable`

### Phase 2: Ship + close original

- [ ] 2.1 Open PR against `develop`, normalize labels (`dependencies`, `skip-qa`, `review`)
- [ ] 2.2 Close original #3022 with a pointer to the develop PR
