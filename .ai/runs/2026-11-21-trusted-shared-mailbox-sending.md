# Trusted shared mailbox sending

Source doc: .ai/specs/2026-11-21-trusted-shared-mailbox-sending.md

## Goal

Let a trusted in-process caller send through a colleague's connected mailbox and supply a Gmail From display name.

## Scope

Add an optional send policy, preserve actor attribution and mailbox credentials, and cover authorization and Gmail MIME conversion. Reassignment is tracked in #10270.

## Implementation Plan

### Phase 1 — Shared sending

1. Add the optional policy and keep the public HTTP ownership checks.
2. Keep the channel owner's OAuth scope and recheck attachment access as the persisted sender.
3. Normalize Gmail display names and cover the converted and transmitted MIME headers.
4. Archive the capability and run targeted validation and the configured gate.

## Progress

- [x] Step 1 — Add the optional authorization policy and authorize only in process.
- [x] Step 2 — Verify attachment and credential scopes.
- [x] Step 3 — Support Gmail display names and verify the transmitted MIME header.
- [x] Step 4 — Archive the capability and add PostgreSQL regression coverage for scope denial.

The targeted unit tests and Playwright discovery run locally. The hosted CI gate runs the build, PostgreSQL scope tests and HTTP integration suite. The Windows package build hit its memory limit and Docker is unavailable locally.
