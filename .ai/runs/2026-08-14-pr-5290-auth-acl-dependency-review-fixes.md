# Execution Plan: PR #5290 review response — auth ACL dependency declarations

> **Adopted plan.** PR #5290 was opened by `om-auto-fix-issue`, which does not write a
> tracking plan. `om-auto-continue-pr` reconstructed this plan on 2026-08-14 from the PR
> body, the `om-auto-review-pr` CHANGES REQUESTED verdict on head `0521fd5`, and the
> branch history, then continued from Phase 1. Evidence for every phase is named inline.

## Goal

Clear the CHANGES REQUESTED verdict on [PR #5290](https://github.com/open-mercato/open-mercato/pull/5290)
so the `auth` slice (spec §6.4) of the ACL dependency bundles rollout can move on to merge.
The review raised one minor finding and two nits; all three are addressed here.

## Scope

- **Minor 1** — `auth.users.create` / `auth.users.edit` read `GET /api/auth/roles` for their
  Roles field but do not declare `auth.roles.list`. Either declare the edge or document the
  omission as deliberate; spec table and code must agree.
- **Nit 1** — the same two forms read `GET /api/dashboards/widgets/catalog`
  (`dashboards.admin.assign-widgets`); spec §6.4 does not say the cross-module edge was
  considered.
- **Nit 2** — the spec's `Status:` header still reads `in-implementation (customers module
  — this PR)` while later phases have landed.

## Non-goals

- No change to runtime RBAC semantics — `dependsOn` stays advisory metadata (spec §8).
- No new feature ids, no `setup.ts` `defaultRoleFeatures` change, no `sync-role-acls` run.
- No other module's `§6.x` section — this PR owns `auth` only.

## Decision on Minor 1

**Declare the dependency** rather than document it as soft. Verified against the code:

- `backend/users/roleOptions.ts:19-37` — `fetchRoleOptions` calls `/api/auth/roles` and
  returns `[]` on a non-ok response, with no toast and no error state.
- `backend/users/create/page.tsx:259` — the Roles field is a `tags` field whose
  `loadOptions` is that function.
- `backend/users/[id]/edit/page.tsx:202-210` — existing role names are resolved through the
  same endpoint; on failure the seeded options keep raw role ids as labels.

The endpoint feeds a **write** field, so a grant of `auth.users.create`/`auth.users.edit`
without `auth.roles.list` produces exactly the silent partial-access failure of spec §1.
This is materially stronger than the `auth.users.list` case (a filter that degrades), which
stays a documented soft dependency.

## Decision on Nit 1

**Leave soft, document it.** `dashboards/api/widgets/catalog.ts:8-10` gates the catalog on
`dashboards.admin.assign-widgets`; both user forms surface an inline
"Unable to load dashboard widgets…" message on failure and save the user record regardless.
Dashboard-widget assignment is a separate administrative concern many operators
legitimately lack, so declaring the edge would warn on an intended configuration.

## Risks

- Low. Advisory metadata only; no runtime authorization path reads `dependsOn`.
- The new edge makes `AclEditor` warn on grants that were previously silent. That is the
  intended behavior of the feature, and diagnostics never block a save (spec §4.6).

## Implementation Plan

### Phase 1: Address the review findings

- 1.1 Add `auth.roles.list` to `dependsOn` for `auth.users.create` / `auth.users.edit`; extend
      the module test with the new edges and their diagnostics; record the enacted rows, the
      soft `dashboards.admin.assign-widgets` edge, and a refreshed rollout status in the spec

### Phase 2: Validate and finalize

- 2.1 Full `.ai/agentic.config.json` validation gate, PR body/table refresh, review-response
      comment, resume summary

## Progress

PR: #5290

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Address the review findings

- [x] 1.1 Add `auth.roles.list` to `dependsOn` for `auth.users.create` / `auth.users.edit`; extend the module test; update spec §6.4 and the status line — 847c800cd

### Phase 2: Validate and finalize

- [x] 2.1 Full validation gate, PR body/table refresh, review-response comment, resume summary — gate green (`yarn test` red only on the documented Windows baseline: 5 core / 2 cli / 1 shared / 1 ui / 1 queue / create-app symlink suites, identical set to a clean tree, zero auth failures)

## External References

- `om-auto-review-pr` verdict comment on PR #5290 (2026-08-14, by @pkarw) — the source of all
  three findings. Its local-validation fallback rationale (fork CI is `action_required`) is
  adopted: this run also validates locally and says so.
