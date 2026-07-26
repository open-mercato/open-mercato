# Execution Plan — sync-akeneo redirect tests must not hit real DNS

**Date:** 2026-07-25
**Slug:** akeneo-redirect-tests-dns
**Branch:** fix/4515-akeneo-redirect-tests-dns
**Issue:** #4515
**Type:** test-only fix (unblocks a red `develop`)

## Goal

Make `develop` green again. The `test` job fails on
`packages/sync-akeneo/src/modules/sync_akeneo/__tests__/client.test.ts`: three redirect-hop
tests added by #3954 build the client without the suite's DNS stub, so they perform a real
`node:dns` lookup of the fixture host `tenant.cloud.akeneo.com`, which does not resolve
anywhere (`NXDOMAIN` from `8.8.8.8` and `1.1.1.1`). The lookup rejects inside
`resolveSafeOutboundUrl` before the mocked `fetch` is reached, so the assertions see a DNS
error instead of the expected `302` rejection.

## Scope

- Route the three `akeneo client security › does not automatically follow redirects …` tests
  through the file's existing `createTestAkeneoClient()` helper (which injects
  `lookupHost: publicAkeneoLookupHost` and `fetchImpl: global.fetch`), exactly like every
  other test in the suite.
- No production code changes. The redirect-hop SSRF guard from #3954 is correct — it was
  simply never reached by these three tests.

### Non-goals

- Not touching `packages/shared/src/lib/url-safety.ts` or the client's redirect handling.
- Not weakening the assertions: they still pin that a `302` surfaces as an error rather than
  being followed.

## Root cause

`createAkeneoClient(validCredentials)` (lines 194, 209, 236) bypasses the stubbed resolver.
`url-safety.ts` then calls the real `lookup()` and raises `dns_resolution_failed`. #3954's own
green `test` run is dated 2026-07-07 while the branch merged 2026-07-25 — nothing in the test
changed, the outside world did, which is exactly why a unit test must not depend on a third
party's DNS zone.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: Fix

- [x] 1.1 Route the three redirect tests through `createTestAkeneoClient()`
- [x] 1.2 Verify the suite locally (31/31, was 3 failed / 28 passed)

### Phase 2: PR finalization

- [x] 2.1 Open PR, validation gate, summary comment
