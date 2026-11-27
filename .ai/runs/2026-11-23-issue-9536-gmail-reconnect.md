# Repair a legacy Gmail channel on reconnect

Adopted from PR #10313 on 2026-11-23. The PR targets `main` from `fix/issue-9536-gmail-reconnect` and was authored by @haxiorz.

## Goal and scope

A Gmail reconnect must preserve the original legacy channel and report whether it linked usable credentials. Issue #9536 describes the duplicate-row failure. The PostgreSQL callback tests on this branch cover the row, its history, and its scope.

## Assumptions and risks

The November 22 maintainer review identifies an incorrect success flash after credential linking fails. The callback already supports an error flash. Existing recovery behavior for persisted rows should continue. Live Gmail verification requires a test mailbox and remains a QA gate. Bulk cleanup of earlier duplicates is outside this change.

## Progress

- [x] 1.1 Adopt the scoped legacy row on reconnect and cover the persisted result — 28e4e2e23a
- [x] 2.1 Return an OAuth error when the callback cannot link the credentials and assert both failure cases — 860feb66af
