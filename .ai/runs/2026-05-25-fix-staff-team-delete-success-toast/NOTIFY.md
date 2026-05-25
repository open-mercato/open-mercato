# Notify — 2026-05-25-fix-staff-team-delete-success-toast

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-05-25T09:46:00Z — run complete
- PR #2051 opened: https://github.com/open-mercato/open-mercato/pull/2051
- Completion comment posted on PR
- All tracking files finalized
- Labels (bug, skip-qa, review) require maintainer to apply (no label-write access to upstream)

## 2026-05-25T09:36:00Z — checkpoint 1 complete
- Steps covered: 1.1 (1aa45ad89) → 2.1 (42abcb811)
- handleDelete structure verified (no try/catch, no flash in success path)
- Integration test shape verified
- Pre-existing typecheck errors in unrelated packages (sync-akeneo, attachments) — not introduced by this run
- Opening PR next

## 2026-05-25T00:00:00Z — run started
- Brief: Fix staff team delete success toast on 409 rejection (issue #2049)
- External skill URLs: none
- Source spec: .ai/specs/2026-05-25-fix-staff-team-delete-success-toast.md
- Steps: 2 (1.1 fix handleDelete, 2.1 add 409 integration test)
- Decision: remove try/catch AND success flash from handleDelete to avoid double-toast on happy path. CrudForm's generic "Item deleted successfully." flash is sufficient.
