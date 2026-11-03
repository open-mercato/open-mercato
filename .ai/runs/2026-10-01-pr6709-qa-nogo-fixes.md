# PR #6709 — fixes for the QA NO-GO at `0feffecc3`

Adopted by `om-auto-continue-pr` on 2026-10-01. The PR had no execution plan; this one covers only the
resume that answers the [QA NO-GO](https://github.com/open-mercato/open-mercato/pull/6709#issuecomment-5932544171).

## Goal

Fix the five defects the manual QA filed against this branch, each with regression tests, on the PR branch itself.
The defects live only in code this PR adds, so they cannot be fixed on `develop`.

## Evidence

- QA verdict comment (NO-GO, 2026-10-01) and issues #6804, #6805, #6806, #6807, #6808.

## Non-goals

- The "by design" part of #6804: editing or deactivating a shared group still changes the terms of every member,
  whatever their organization (groups are tenant-scoped, spec §15 OQ2). This needs a product decision.
- Store existence checks on policy writes (#6805 "related"). A policy for a product the catalog does not have is
  inert, so the product lookup stays on the check route only.
- #6728 (route writes through commands) stays a waived follow-up.
- Low-severity UI notes from the QA report (delete confirm counts, raw UUIDs in the availability UI).

## Assumptions

- #6804: refusing the delete with a 409 is preferred over retiring only the in-scope memberships, because a
  deleted group must not keep live memberships.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: QA defects

- [x] 1.1 #6804 group delete refuses members outside the caller organizations — 412bd45bc, 64d4a5886
- [x] 1.2 #6806 inactive policy wins over a future preorder date — a1a087d5f
- [x] 1.3 #6805, #6807, #6808 variant validation, selected org on reads, bad id / int overflow — b40c7d7bd

### Phase 2: Verification

- [x] 2.1 Full validation gate — see the PR handoff comment
- [x] 2.2 Review pass and PR handoff — ae2ad3238
