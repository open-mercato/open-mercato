# Run Plan — 2026-07-27-workflows-ux-phase0

**Branch:** `feat/workflows-ux-phase0` · **Base:** `develop` · **Owner:** pat-lewczuk
**Source spec:** `.ai/specs/2026-07-26-workflows-ux-redesign.md` (Phase 0 — trust repair)
**Companion:** `.ai/specs/2026-07-26-workflows-ux-redesign-user-stories.md` · **Visual refs:** `.ai/mockups/workflows-ux-redesign/index.html`
**Umbrella issue:** #4251 · **Closes:** #4229, #4231, #4232, #4239 (partial editor-consolidation groundwork for #4237)

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr-loop`. Step ids are immutable once a Step has a commit.

| Phase | Step | Title | Status | Commit |
|-------|------|-------|--------|--------|
| 1 | 1.1 | Land redesign spec, story catalog, and HTML mockups | done | 494ba36ec |
| 2 | 2.1 | SEND_EMAIL honest stub result and error propagation | done | b87fb2b0d |
| 2 | 2.2 | Fix retry-policy field-name drift in ActivitiesEditor and TransitionsEditor | done | 4261372e2 |
| 2 | 2.3 | Default workflows role grants for employee in module setup | done | 8c4521a5e |
| 3 | 3.1 | Problems list panel in visual editor and formatted save errors | done | 2a6b9b9eb |
| 3 | 3.2 | Per-node error badges on the canvas | done | 1f95b7e23 |
| 3 | 3.3 | Inline invalid-JSON feedback in ActivitiesEditor config textarea | done | 2c05a0d6e |
| 4 | 4.1 | DurationInput primitive in packages/ui with tests | done | c15d25fa0 |
| 4 | 4.2 | Adopt DurationInput in legacy Node/Edge dialogs | done | 0eccd7584 |
| 4 | 4.3 | Adopt DurationInput in CrudForm dialog path | done | c91235342 |
| 5 | 5.1 | Roles multiselect for user-task assignment in both dialogs | done | 55ae2a282 |
| 6 | 6.1 | CrudForm parity: waitForTimer node support | done | f5c47a354 |
| 6 | 6.2 | CrudForm parity: slaDuration field and alert removal | done | 87180ca47 |
| 6 | 6.3 | CrudForm parity: full i18n of both CrudForm dialogs | done | 5d3664822 |
| 6 | 6.4 | Flip CrudForm dialog default on via parseBooleanWithDefault | done | 5d48ecc99 |
| 6 | 6.4-review-fix | Update TC-WF-007 integration spec for CrudForm-default dialogs | done | ede714698 |
| 7 | 7.1 | Instance detail and canvas status colors to DS tokens | done | 630232cbf |
| 7 | 7.2 | Fix pre-existing sort-comparator guard violation in agents-budget script | done | 5927f65d7 |
| 3 | 3.1-ds-fix | Problems panel raw buttons to Button primitive (DS pass) | done | 277c05bfb |
| 5 | 5.1-review-fix | Retry role lookup on transient failure; StepsEditor retry-policy type rename | done | c0c2f037c |
| 6 | 6.3-review-fix | Update duration adoption tests for i18n key rendering | done | b931f3322 |

## Goal

Ship Phase 0 ("trust repair") of the workflows UX redesign: eliminate the silent-failure class in the visual editor, replace the worst free-text inputs (ISO durations, comma-separated roles), fix data-honesty bugs (SEND_EMAIL stub, retry-policy drift), grant sane default role access, and make the CrudForm dialog variant the default authoring surface — all additive, with the legacy path kept as rollback.

## Scope

- `packages/core/src/modules/workflows/` — visual editor page, Node/Edge dialogs (legacy + CrudForm), ActivitiesEditor, TransitionsEditor, StepsEditor, nodeFormTransforms, status-colors, activity-executor (SEND_EMAIL only), setup.ts, i18n locales (en/pl/es/de).
- `packages/ui/src/backend/inputs/DurationInput.tsx` — new shared primitive.
- `.ai/specs/` + `.ai/mockups/workflows-ux-redesign/` — the redesign documents this PR implements Phase 0 of.

## Non-goals

- Deleting the legacy dialogs (spec Phase 1+; flag flip only here).
- Activity Registry, context ledger, Work Inbox, test runner, agent-step contract (spec Phases 1–5).
- Parallel fork/join config UI (absent from both dialog variants today — not a parity regression).
- `apps/mercato/.env.example` changes (would trigger the create-app template-sync duty; the flag is documented in the PR body and spec instead).
- Command output schemas, portal task APIs, engine changes beyond SEND_EMAIL honesty.

## Risks

- **Flag flip (6.4)** changes the default node/edge editing surface. Mitigation: parity steps 6.1–6.3 land first; rollback is `NEXT_PUBLIC_WORKFLOW_CRUDFORM_ENABLED=false`; legacy dialogs untouched.
- **Role lookup ACL (5.1):** editors without `auth.roles.list` get a 403 on the lookup; component degrades to free-text entry preserving current behavior. Existing definitions storing role names render as free-text chips.
- **SEND_EMAIL result change (2.1):** `sent` flips `true→false` on the no-service path — additive output field semantics; checked `examples/` and checkout-demo for `sent === true` assertions before landing.
- **Default role grants (2.3):** existing tenants need `yarn mercato auth sync-role-acls` to pick up the new grants (noted in PR body).
- **i18n gate:** every new UI string is a 4-locale change with real translations (`i18n:check-sync` is strict on parity, flatness, sort order).

## External References

- None (`--skill-url` not provided). Redesign research citations live in the source spec.

## Implementation Plan

### Phase 1 — Documents

**1.1 Land redesign spec, story catalog, and HTML mockups**
- Copy `.ai/specs/2026-07-26-workflows-ux-redesign.md`, `.ai/specs/2026-07-26-workflows-ux-redesign-user-stories.md`, and `.ai/mockups/workflows-ux-redesign/` (5 files) from the source session into the branch verbatim.
- Commit type: `docs(workflows)`.

### Phase 2 — Data honesty (engine + config)

**2.1 SEND_EMAIL honest stub**
- `lib/activity-executor.ts:519-551`: guard only `container.resolve('emailService')` with try/catch; a real `send()` failure must propagate to the retry loop. No-service fallback returns `{ sent: false, to, subject, via: 'console', reason: 'no-email-service' }` + `logger.warn`.
- Tests in `lib/__tests__/activity-executor.test.ts`: no service → `sent:false`; service throws → rejects.

**2.2 Retry-policy drift fix**
- `components/ActivitiesEditor.tsx:24-27,59-62,244-270` and `components/TransitionsEditor.tsx:24-27,115-118,494-520`: rename `retryDelay`→`initialIntervalMs`, `backoffMultiplier`→`backoffCoefficient`, add `maxIntervalMs` input — canonical quadruple per `activityRetryPolicySchema` (`data/validators.ts:198-203`).
- i18n: add `workflows.form.initialIntervalMs`, `.backoffCoefficient`, `.maxIntervalMs` (or reuse existing edgeEditor keys), delete stale `workflows.form.retryDelay`/`.backoffMultiplier` — all four locales.
- Test in `data/__tests__/validators.test.ts`: `activityRetryPolicySchema` rejects `{ retryDelay, backoffMultiplier }` (strict), accepts the canonical quadruple.

**2.3 Default role grants**
- `setup.ts:12-14`: add `employee: ['workflows.view', 'workflows.view_tasks', 'workflows.tasks.view', 'workflows.tasks.claim', 'workflows.tasks.complete', 'workflows.instances.view']` (verify `dependsOn` closure against `acl.ts`; `__tests__/acl-dependencies.test.ts` guards).

### Phase 3 — Kill silent validation (#4232)

**3.1 Problems list + formatted save errors**
- `backend/definitions/visual-editor/page.tsx:299-366,422-431`: hold full `allErrors` (with `nodeId`/`edgeId` from `validateWorkflowGraph` + Zod issues) in state; render a dismissible problems panel (DS Alert list) with click-to-select-node/edge; Validate and Save populate it instead of truncating to one flash line. Save rejects go through `formatWorkflowValidationError(result.result, …)` (`lib/format-validation-error.ts`).
- i18n keys for panel strings, four locales. Unit test for the error-collection helper (extract to a small pure function).

**3.2 Per-node error badges**
- Derive `Set<nodeId>` of erroring nodes from the problems state; thread `hasError` through `WorkflowGraph`/`WorkflowGraphImpl` node data to `WorkflowNodeCard` → render `border-status-error-border` + badge. Stop discarding `'error'` status in `components/nodes/UserTaskNode.tsx:32`.
- Component test asserting the badge renders when `hasError` is set.

**3.3 ActivitiesEditor JSON feedback**
- `components/ActivitiesEditor.tsx:315-336`: keep raw textarea text in local state; on parse failure show inline `text-status-error-text` hint (i18n key) instead of silently dropping input; commit parsed JSON only when valid.

### Phase 4 — Duration picker (#4229)

**4.1 DurationInput primitive**
- New `packages/ui/src/backend/inputs/DurationInput.tsx`: `{ value?: string; onChange(v: string); allowRaw?: boolean }` — number input + unit select (seconds/minutes/hours/days) serializing to the ISO subset `parseDuration` accepts (`PT5M`, `P1D`…); auto-switch to raw text mode when incoming value contains `{{`, uses the simple form, combines multiple units, or fails to parse — never make an existing definition uneditable. i18n via `useT()`.
- Unit tests: serialize/parse round-trips, raw-mode fallback, template passthrough.

**4.2 Adopt in legacy dialogs**
- Swap in at `NodeEditDialog.tsx` (step timeout :598-613, signal timeout :1431-1455, WAIT_FOR_TIMER duration :1461-1490, inline WAIT activity :1120-1152) and `EdgeEditDialog.tsx:804-812`. Numeric-ms fields stay as-is (no format unification in Phase 0).

**4.3 Adopt in CrudForm path**
- `components/fields/ActivityArrayEditor.tsx:248-261` and `NodeEditDialogCrudForm.tsx:294-300,416-422` (custom CrudField component wrapping DurationInput). Wire format unchanged (ISO string) — no transform changes.

### Phase 5 — Role dropdown (#4239)

**5.1 Roles multiselect**
- New `components/fields/RolesMultiSelect.tsx` in the workflows module: fetches `apiCall('/api/auth/roles?pageSize=100&search=…')` (mirrors `auth/backend/users/[id]/edit/page.tsx:396` pattern); on 403/error degrades to free-text chip entry; unknown stored values preserved as chips.
- Wire into legacy `NodeEditDialog.tsx:643-653` and CrudForm variant (`NodeEditDialogCrudForm.tsx:310-316` custom field); drop the comma-split in `lib/nodeFormTransforms.ts:246,260` for the new component path (wire shape stays `string[]`). i18n, four locales. Component test with mocked apiCall (success + 403 degradation).

### Phase 6 — CrudForm parity + flag flip

**6.1 waitForTimer support**
- `NodeEditDialogCrudForm.tsx`: add `waitForTimer` group (duration XOR until, using DurationInput + datetime field); add `waitForTimer` cases to `lib/nodeFormTransforms.ts` `nodeToFormValues`/`formValuesToNodeUpdates` with `isValidDurationString` validation mirroring legacy `NodeEditDialog.tsx:1461-1490`. Transform unit test.

**6.2 slaDuration + alert removal**
- Surface `slaDuration` as a real field (DurationInput) in the user-task group; keep `assignmentRule`/`escalationRules` passthrough intact. Replace `window.alert` (`NodeEditDialogCrudForm.tsx:78-82`) with a flash/inline notice via the DS system.

**6.3 Full i18n of CrudForm dialogs**
- Route every label/group/description/placeholder in `NodeEditDialogCrudForm.tsx` + `EdgeEditDialogCrudForm.tsx` through `useT()`; add keys to en/pl/es/de with real translations; fix the hardcoded throw in `lib/nodeFormTransforms.ts:341-347` to an i18n-resolvable error. Add both files to `components/__tests__/dialog-ds-compliance.test.ts` `dialogFiles`.

**6.4 Flag flip**
- `backend/definitions/visual-editor/page.tsx:664,669`: replace `=== 'true'` with `parseBooleanWithDefault(process.env.NEXT_PUBLIC_WORKFLOW_CRUDFORM_ENABLED, true)` from `@open-mercato/shared/lib/boolean` — CrudForm becomes default, `false` restores legacy. Update `__integration__/TC-WF-CRUDFORM-001.spec.ts` gating if it assumes the old default.

### Phase 7 — DS tokens

**7.1 Status colors to DS tokens**
- `lib/status-colors.ts`: add `STEP_STATUS_STYLES` record using `var(--status-*-bg/-border/-text)` values; replace the hex switch in `backend/instances/[id]/page.tsx:299-349` with the lookup; migrate raw hex in the same file family touched this run: `WorkflowNodeCard.tsx:42` (`border-[#0080FE]` → ring/primary tokens), node handle `!bg-[#0080FE]` (7 files under `components/nodes/`), `WorkflowGraphImpl.tsx:73,110,190` canvas/minimap colors → `var(--border)`/`var(--muted-foreground)`. Extend `checkout-demo-ds-tokens.test.ts`-style guard or `dialog-ds-compliance.test.ts` to cover the touched files.
