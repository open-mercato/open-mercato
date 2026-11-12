# Execution plan — revise the backup/restore spec to enterprise-only, encrypted-by-default, resumable (adopted from PR #8910)

**Origin:** adopted — reconstructed by `om-auto-continue-pr` on 2026-11-06 because PR #8910 carried no execution plan.
**PR:** #8910 · **Branch:** `spec/cli-backup-restore` · **Base:** `main`
**Author:** @pkarw — this plan interprets their intent; correct it by editing this file or commenting on the PR.

## 🎯 Goal
Revise the design-only spec so the backup/restore feature is enterprise-only, encrypts whole backups by default (independent of field-level encryption maps) with an explicit unencrypted option, makes both backup and restore resumable, and shows per-entity progress bars for backup (out) and restore (in).

## Scope
`.ai/specs/enterprise/2026-11-06-cli-backup-restore.md` (moved from `.ai/specs/`) and the crosslink in `.ai/specs/enterprise/2026-07-08-automated-database-backups.md`.

## Non-goals
- No runtime implementation; the PR stays design-only (implementation ships via `om-auto-implement-spec` on its own PR).
- No rewrite of the automated-backups enterprise spec beyond the crosslink/convergence note.
- No change to field-level encryption maps or tenant DEK handling.

## Evidence
| Conclusion | Drawn from | Confidence |
|---|---|---|
| Feature must be enterprise-only | Task goal from @pkarw (cezar task 9551ccae) | high |
| Whole-archive encryption by default, unencrypted opt-in | Task goal | high |
| Backup and restore must be resumable with per-entity progress in/out | Task goal | high |
| Enterprise-only scope must live in `.ai/specs/enterprise/` | `.ai/specs/AGENTS.md` → Never | high |
| Existing spec forbids resume and lives in OSS `packages/cli` | PR diff (839194b35b) | high |

## Assumptions
- "Putting the encryption maps away" means archive encryption is independent of the per-entity field encryption maps; encrypted columns are copied as stored ciphertext.
- "Entity" progress means per database table, labelled with its module/ORM entity where known.
- Code location moves to the planned enterprise `backups` module (`mercato backups …`).

## Risks
- Resumable backups across process death cannot share one PostgreSQL snapshot; the spec must label consistency honestly.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Initial OSS manual backup/restore CLI spec and enterprise crosslink — 839194b35b

### Phase 2: Enterprise-only resumable encrypted redesign

- [x] 2.1 Move the spec to the enterprise specs directory and retarget it to the enterprise backups module — 6524c35743
- [x] 2.2 Specify encryption-by-default whole-archive encryption with an explicit unencrypted option — 6524c35743
- [x] 2.3 Specify resumable chunked backup and journaled resumable restore with honest consistency modes — 6524c35743
- [x] 2.4 Specify per-entity progress bars for backup and restore (TTY, plain, NDJSON) — 6524c35743
- [x] 2.5 Update the automated-backups crosslink, scenario matrix, phasing and changelog — 6524c35743

- [x] Post-review fix: encrypted journal, renderer-only pg_restore, standalone bin, exit table — bf75ed63ee
- [x] Post-review fix: batched pre-data, hash-chain integrity with hash-on-load — 49043c9db9


### Phase 3: Core rotation risk acknowledgment (2026-11-12)

- [x] 3.1 Specify a red fail-closed warning and explicit CLI acknowledgment for Core rotation without Enterprise resumable encrypted backup. — c28d4f5489
- [x] 3.2 Cross-reference the separate Enterprise post-rotation correctness verification design and acceptance coverage. — c28d4f5489
- [ ] 3.3 Validate documentation, review the revised design, and publish the outcome.

## Resume scope — 2026-11-12

User direction: keep key rotation available in Core, but refuse mutating rotation without a fresh explicit risk acknowledgment when Enterprise recovery is unavailable. Write a separate Enterprise-only verification spec, consumed by rotation, with fast data correctness/checksum validation. Both PRs remain design-only. Existing completed work and security decisions remain intact.
