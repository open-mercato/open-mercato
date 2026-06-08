# Execution Plan — QA #2529 follow-up fixes (alinadivante comment 4638514821)

## Goal

Fix the three still-failing / gap items reported by alinadivante in
https://github.com/open-mercato/open-mercato/issues/2529#issuecomment-4638514821,
and add integration coverage for each fixed case, in a single PR.

## Source

QA comment id `4638514821` on issue #2529. Three actionable items:

1. ❌ **Team Member "Team" select prefill** still reproduces. On the team-member
   edit ("Member settings") form the Team select renders as `-` even though the
   member has a saved team (visible in Highlights). Saving another field can
   silently detach the member from its team.
2. ❌ **Company "Domain" field cannot be cleared.** Clearing Domain → save →
   hard reload restores the old value. (Website clears fine; phone/email already
   fixed in #2526.)
3. ⚠️ **Checkout template stale-edit after delete** ends with a raw
   `Template not found` (404) instead of the unified optimistic-lock conflict
   bar when the record was deleted in another tab.

## Root causes (verified read-only)

1. `packages/core/src/modules/staff/components/TeamMemberForm.tsx` (~L306-362):
   the Team field is a custom Radix `<Select>` whose `<SelectValue>` has **no
   children** and the `<Select>` has **no `key`**, so on first render Radix
   cannot derive the selected option's label (closed content → item not mounted)
   and shows the placeholder `—`. The fixed `ResourceCrudForm.tsx` resource-type
   select (confirmed working by QA) renders `selectedOption?.label` as children
   of `<SelectValue>` **and** sets a `key` keyed on value+options. The PR-#2608
   seed-by-id effect already prepends the saved team to `teamOptions`; only the
   display wiring is missing.
2. `packages/core/src/modules/customers/components/formConfig.tsx`:
   `buildCompanyEditPayload` calls `assignClearable` for `primaryEmail`,
   `primaryPhone`, `websiteUrl` but **not** `domain`, so a blanked domain is
   dropped by the base `assign()` (`blankToUndefined` → `undefined`) and never
   transmitted as `null`. The `companyDetailsSchema.domain` validator in
   `data/validators.ts` (L97) is also non-nullable, so an explicit `null` would
   be rejected. The update command already writes `profile.domain = parsed.domain
   ?? null` when `parsed.domain !== undefined` (commands/companies.ts L770).
3. `packages/checkout/src/modules/checkout/commands/templates.ts`: the update
   (L269) and delete (L425) command handlers throw `CrudHttpError(404)` when the
   template is gone **before** any lock check. The shared helper
   `enforceRecordGoneIsConflict` (optimistic-lock-command.ts L213) converts that
   to a structured 409 when the client sent the expected-version header — which
   the `LinkTemplateForm` (CrudForm) already sends and already surfaces via
   `surfaceRecordConflict`. The helper is fail-open (no header → unchanged 404).

## Scope

- `packages/core/src/modules/staff/components/TeamMemberForm.tsx`
- `packages/core/src/modules/customers/data/validators.ts`
- `packages/core/src/modules/customers/components/formConfig.tsx`
- `packages/checkout/src/modules/checkout/commands/templates.ts`
- Unit tests (mandatory) + Playwright integration specs (requested) per module.

## Non-goals

- The other "✅ Fixed" items in the same comment (gateway validation, phone
  clearing, team-role prefill, resource selects, capture method, deal pipeline).
- The broad select-prefill audit candidates in earlier comments (not in the
  target comment; no confirmed repro).
- Touching DB schema (columns already nullable) — no migration.

## Risks

- Team select fix must not regress the team-change side effect (role filtering /
  `selectedTeamId`) — keep the existing `onValueChange` body intact; only add
  `key` + `<SelectValue>` children.
- Domain clearing must not break create flow (base `assign` still lowercases on
  create; `assignClearable` only overrides in the edit builder, mirroring
  websiteUrl).
- Checkout 409 conversion is additive/fail-open; must not change behavior for API
  clients that never send the lock header.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Team Member team select prefill

- [ ] 1.1 Render saved team label in `<SelectValue>` + add remount `key` in TeamMemberForm
- [ ] 1.2 Unit test: TeamMemberForm shows saved team label on edit (component render test)
- [ ] 1.3 Integration spec: team-member edit Team select prefill (Playwright)

### Phase 2: Company Domain clearable

- [ ] 2.1 Make `companyDetailsSchema.domain` clearable (nullable) in validators.ts
- [ ] 2.2 Add `assignClearable(payload, 'domain', …)` + widen `CompanyEditFormValues.domain`
- [ ] 2.3 Unit tests: validator accepts null/'' and edit payload sends `domain: null`
- [ ] 2.4 Integration spec: company domain clear persists (Playwright)

### Phase 3: Checkout template stale-delete conflict

- [ ] 3.1 Import + call `enforceRecordGoneIsConflict` before 404 in update & delete commands
- [ ] 3.2 Integration spec: deleted template + lock header → 409 conflict (not 404)
