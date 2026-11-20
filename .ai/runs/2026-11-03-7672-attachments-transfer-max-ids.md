# Execution plan — cap `POST /api/attachments/transfer` at the shared `ATTACHMENT_TRANSFER_MAX_IDS` (adopted from PR #7692)

**Origin:** adopted — reconstructed by `om-auto-continue-pr` on 2026-11-03 because PR #7692 carried no execution plan.
**PR:** #7692 · **Branch:** `fix/7672-attachments-transfer-max-ids` · **Base:** `main`
**Author:** @pgaluszk — this plan interprets their intent; correct it by editing this file or commenting on the PR.

## 🎯 Goal

Merge the 100-id cap on `POST /api/attachments/transfer` now that its prerequisite (batched built-in callers) is on `main`, with the limit read from the single shared constant.

## Scope

- `packages/core/src/modules/attachments/api/transfer/route.ts`, `api/openapi.ts`: use `ATTACHMENT_TRANSFER_MAX_IDS` instead of the literal `100`.
- `api/__tests__/transfer.route.test.ts`, `__integration__/TC-ATT-013.spec.ts`: derive the boundary from the constant.
- `.ai/specs/2026-10-21-attachments-transfer-max-ids.md`, `UPGRADE_NOTES.md`, `apps/docs/docs/api/attachments.mdx`: point at #8571 and the current client helper result.

## Non-goals

- The alternative deprecation path (bridge release) from the spec — only if the maintainer rejects the security exception.
- Any change to the catalog callers or `transferClient.ts` (owned by #8571).
- Follow-up #8574 (product create tab strip on mobile).

## Evidence

| Conclusion | Drawn from | Confidence |
|---|---|---|
| The cap waited for batched callers | Review by @haxiorz 2026-10-20 (major: "Batch the built-in media transfers before enforcing this cap"); spec § Implementation Plan step 1 | high |
| The prerequisite landed | #8571 merged to `main` 2026-11-03 (carries #7728); `attachments/lib/transferLimits.ts` exports `ATTACHMENT_TRANSFER_MAX_IDS = 100` | high |
| The literal must become the constant | Spec § Proposed Solution 1–2 and § Implementation Plan step 2 | high |
| Docs and tests must follow | Spec § Implementation Plan step 5 | high |
| The security label and waiver are still open | Review by @haxiorz 2026-10-20 (blocker); spec § Final Compliance Report | high |

## Assumptions

- `#8571` fully replaces `#7728` as the dependency; references to `#7728` in this PR's docs move to `#8571`.
- The primary path (Emergency Security Exception) stays; the waiver request is the maintainer's step.

## Risks

- Required CI from the fork still needs maintainer approval; local gate is the only evidence until then.
- The `security` label and a named maintainer waiver remain merge blockers outside this run.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Already landed on this PR (reconstructed)

- [x] 1.1 Cap attachmentIds at 100 in the route and OpenAPI schemas with unit and integration coverage — 3d9ca0d5a
- [x] 1.2 Spec, compatibility entry and upgrade note for the exception; merges of `main` — df193d6a8

### Phase 2: Integrate the prerequisite from main

- [x] 2.1 Merge upstream main (carries #8571) — 6e70a6451

### Phase 3: Use the shared limit

- [x] 3.1 Read ATTACHMENT_TRANSFER_MAX_IDS in route.ts and openapi.ts — e585f61c9
- [x] 3.2 Derive test boundaries from ATTACHMENT_TRANSFER_MAX_IDS — 8b0b1b7a9

### Phase 4: Docs follow the landed prerequisite

- [x] 4.1 Point spec, upgrade note and API docs at #8571 — 77f620de7

### Phase 5: Verify

- [x] 5.1 Full validation gate — 862c31b9c
- [ ] 5.2 om-auto-review-pr --autofix pass
