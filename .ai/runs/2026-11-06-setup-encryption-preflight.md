# Setup encryption compatibility preflight

Status: in-progress
Source doc: .ai/specs/2026-07-19-unified-starter-package.md

## Goal

Before setup mutates a reused database, establish read-only compatibility with stored encryption using existing KMS/decryption helpers. Follow-up to #8613, forked from 9d3b3b30f. The current isolated task branch is intentional; do not modify the original PR branch.

## Scope

Setup mutation boundaries in monorepo, standalone template, and starter. Read-only inventory, authenticated decryption, redacted failure, tests, spec and operator guidance. No key creation/rotation, ciphertext rewrites, dependencies, shared database initialization, base merge, or automation policy changes.

## Implementation Plan

### Phase 1: Design

1.1 Trace setup writes and persisted encryption formats; specify empty/plaintext and unsupported-store policy.

### Phase 2: Guard

2.1 Implement isolated read-only scanner using existing cryptographic helpers and wire every setup mutation boundary.
2.2 Add meaningful cryptographic and no-mutation tests for successful/rejected reuse and new databases.

### Phase 3: Verification and publication

3.1 Run focused tests, then configured validation in order; document concrete blockers.
3.2 Review compatibility/security and publish evidence and resumable handoff on the new PR.

## Risks

A preflight snapshot cannot prevent concurrent application writes or later external key rotation. Incomplete inventory, unknown encrypted stores, permissions, limits and unavailable dependencies must reject rather than imply compatibility. Standalone built-helper resolution must be tested. Full gate requires an independent dependency install in this worktree.

## Progress

PR: #8908

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Design

- [x] 1.1 Trace setup writes and persisted encryption formats; specify empty/plaintext and unsupported-store policy. — e3e0ebb5e

### Phase 2: Guard

- [ ] 2.1 Implement isolated read-only scanner using existing cryptographic helpers and wire every setup mutation boundary.
- [ ] 2.2 Add meaningful cryptographic and no-mutation tests for successful/rejected reuse and new databases.

### Phase 3: Verification and publication

- [ ] 3.1 Run focused tests, then configured validation in order; document concrete blockers.
- [ ] 3.2 Review compatibility/security and publish evidence and resumable handoff on the new PR.
