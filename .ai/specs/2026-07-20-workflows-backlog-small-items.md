# Workflows Backlog — Small (S) Items

**Status:** Skeleton — blocked on Open Questions
**Umbrella:** #4251 · **Issues:** #4229 (A1), #4231 (A3), #4234 (A6), #4237/A9b, #4239 (B1)
**Scope:** OSS · `packages/core/src/modules/workflows`, `packages/ui`, `packages/core/src/modules/auth`

---

## TLDR

Five independently-shippable improvements to the workflows module, sized `S` in the Jul 2026 backlog. Research confirms three of them are genuinely small; **two are mis-sized because the code underneath them is different from what the meeting assumed**:

- **A1** (duration input) is blocked by an inconsistent storage contract — the same logical field is `z.string()` ISO-8601 in the validators but written as a *number of milliseconds* by the non-visual editor. A picker cannot be dropped in until we decide the canonical format.
- **A6** (pasted JSON locks editing) is **fixed in the visual editor** (`JsonBuilder`, #2817/#2837) but **still broken in the non-visual editor** — which is the editor we have already decided to retire (A9).
- **A9b** is not "one missing Call API field". The non-visual editor writes at least two structurally wrong shapes (`preConditions` as `string[]` where zod demands `{ruleId, required}[]`; activity `timeout` as a number where zod demands an ISO string). Because the definition validates atomically, either one returns 400 and blocks *the entire save*, including unrelated name/description edits.
- **B1** (role dropdown) is a clean `S` — roles are stored and matched as **name strings** end-to-end, so this is a pure UI swap with no migration.
- **A3** (default roles) is a clean `S` **only** under the "role templates in the UI" reading; the "modules declare roles" reading is a platform change to `auth` + `ModuleSetupConfig`.

---

## Open Questions

**Q1 — A6 and A9b both live in the non-visual editor we plan to delete. Do we fix it, or delete it now?**
The strategic direction recorded in #4237 is to retire the form-based editor. Fixing A6 + A9b is ~1500 lines of throwaway repair. Deleting is ~1900 lines of pure removal (incl. `ActivitiesEditor.tsx`, 342 lines with zero importers). Options:
 - **(a) Delete now** — closes #4234 and #4237/A9b as "resolved by removal". Blocker: the form editor is the only definition-detail surface gated at `workflows.view`; the visual editor requires `workflows.manage`. Retiring it removes read-only definition access for viewers, and drops the `code`-source "Customize" / `code_override` "Reset to code" affordances that only the form page implements today.
 - **(b) Minimal repair, retire later** — fix only the save-blockers (`preConditions` shape, `timeout` type, the controlled-textarea lock) and leave the rest. Keeps viewers working, defers the deletion decision.
 - **(c) Repair A6 only** — the JSON textarea lock is ~10 lines (adopt the existing `JsonBuilder` dirty-flag pattern); leave A9b to the retirement.

**Q2 — A1: what is the canonical stored format for a duration?**
Today: `workflowStep.timeout`, `activityDefinition.timeout`, `signalConfig.timeout`, `userTaskConfig.slaDuration` are `z.string()` (ISO-8601); `subWorkflowConfig.timeoutMs`, `callApiConfig.timeout`, `trigger.debounceMs` are `z.number()` (ms). The non-visual editor writes numbers into the string-typed fields. Options:
 - **(a) ISO-8601 string everywhere** — matches the validators and the meeting's "ISO is fine at API level"; the number-writing editors are already producing invalid payloads, so this is a bug fix. Needs a tolerant read path for definitions already saved with numbers.
 - **(b) Keep both, picker emits per call site** — no migration, but the inconsistency stays and every future field re-litigates it.

**Q3 — A3: where do the role templates come from?**
The chosen reading is a "create role from template" picker in the auth roles admin page. The template list has to live somewhere. Options:
 - **(a) New optional `roleTemplates` on `ModuleSetupConfig`** — each module declares suggested `{ name, description, features[] }`; the picker aggregates across enabled modules. Additive, no new column, no auto-creation. Note this makes A3 a `packages/shared` contract change (additive, so BC-safe).
 - **(b) Hardcoded template list in the auth module** — smallest, but core has to know every module's features, which violates module isolation.

**Q4 — A1 scope: does the shared duration picker ship as a `packages/ui` primitive?**
There is no duration/interval input anywhere in the monorepo, and the only ISO parser is `workflows/lib/duration.ts` (which `packages/ui` cannot import from `packages/core`). A shared `duration-input` primitive means lifting `parseDuration` + writing a serialiser into `packages/shared`. Worth it if B3 (task deadlines, `M→L`) will reuse it — the issue explicitly says it should. Confirm: build it shared now, or workflows-local and lift later?

---

## Confirmed decisions (from kickoff)

- **Scope:** one spec, five phases; each phase is an independently-shippable PR.
- **A3 reading:** role templates in the UI (user-driven "create from template"), *not* modules auto-creating roles.
- **B1 storage:** research resolved this — see below.

## B1 — resolved by research: keep role **names**

Roles are name-strings end-to-end and must stay that way:
- `UserTask.assignedToRoles` is `text[]` of plain strings (`data/entities.ts:512-516`), no FK to `Role`.
- Matching is a Postgres array overlap against **role names** from the JWT (`api/tasks/route.ts:104-108` vs `auth/api/login.ts:142`).
- `Role` rows are strictly per-tenant (`auth/data/entities.ts:54,63`), while code-registered definitions (`lib/code-registry.ts:4-6`) and `examples/*.json` are shared across every tenant — a role UUID is meaningless there.

So B1 is a pure UI change: swap the free-text `Input` for a multi-select fed by a **name-valued** role fetch. The auth module's existing `fetchRoleOptions` (`auth/backend/users/roleOptions.ts:13-39`) is id-valued and stays as-is for user→role assignment.

### As implemented

- **`packages/ui/src/backend/inputs/RoleSelect.tsx`** (new) — follows the `EventSelect` precedent: a shared input that calls the public `/api/auth/roles` endpoint, so workflows never imports auth internals. Exports `fetchRoleNameOptions` (name-valued, superadmin filtered out by default) alongside the `RoleSelect` component.
- **Legacy `NodeEditDialog`** (the default path) uses `<RoleSelect>`; state moved from a comma-joined `string` to `string[]`.
- **`NodeEditDialogCrudForm`** (behind `NEXT_PUBLIC_WORKFLOW_CRUDFORM_ENABLED`) uses `type: 'tags'` + `loadOptions: fetchRoleNameOptions`. Both dialogs land on the same `TagsInput` underneath.
- **`nodeFormTransforms`** — `NodeFormValues.assignedToRoles` is now `string[]`; the comma split/join on both directions is gone. Non-array legacy values hydrate to `[]` rather than being split into characters.
- **`userTaskConfigSchema`** now declares `assignedToRoles` (incidental finding #3) — it previously survived only because the object is not `.strict()`.
- **Seeded default** changed from `assignedToRoles: ['Reviewer']` to `[]` (`visual-editor/page.tsx:551`). `'Reviewer'` is capitalised and matches no real role, so every new user task shipped with an assignment that could never resolve.

**ACL note:** the workflow editor is gated on `workflows.manage`, but `/api/auth/roles` requires `auth.roles.list`. Rather than widen the editor's grants, `fetchRoleNameOptions` returns `[]` on failure (including 403) and `TagsInput` keeps `allowCustomValues`, so an editor without `auth.roles.list` degrades to exactly the previous free-text behaviour. Free text is also the escape hatch for definitions that reference a role not present in the current tenant — required, since code-registered and example definitions are tenant-portable.

**Validation:** `yarn typecheck` (21/21), `yarn lint` (0 errors), `yarn workspace @open-mercato/core test -- workflows` (612 passed), `yarn workspace @open-mercato/ui test` (1639 passed), `yarn generate` (no churn). 14 new tests across `node-form-transforms-roles.test.ts` and `RoleSelect.test.ts`. Runner: local.

---

## Phases (draft — to be filled after the Open Questions gate)

| # | Item | Issue | Est. | Depends on |
|---|------|-------|------|-----------|
| 1 | B1 — role dropdown on USER_TASK | #4239 | S | — · **done** |
| 2 | A1 — shared duration input | #4229 | S→M | Q2, Q4 |
| 3 | A6 — JSON config editing lock | #4234 | XS–S | Q1 |
| 4 | A9b — non-visual editor save-blockers | #4237 | S→M | Q1 |
| 5 | A3 — role templates | #4231 | S | Q3 |

Phase 1 is unblocked and can start immediately.

---

## Incidental findings (candidates for follow-up issues, not this spec)

1. **Task claim endpoint does not verify role membership** — `lib/task-handler.ts:286-300` and `api/tasks/[id]/claim/route.ts:61` never intersect the caller's roles with `task.assignedToRoles`. The UI hides the action (`backend/tasks/page.tsx:291-303`) but the API does not enforce it. Security-relevant; likely `priority-high`.
2. **`calculateDueDate` silently defaults to 1 day** — `lib/step-handler.ts:965-990` is a second, divergent duration parser that ignores `PT30M` and returns 24h with no error. Natural companion to A1/Q2.
3. **`userTaskConfigSchema` does not declare `assignedToRoles`** (`data/validators.ts:130-161`) — the field survives only because the object is not `.strict()`. Should be folded into Phase 1.
4. **`employee` gets zero workflow features** (`workflows/setup.ts:12-14` grants only `admin: ['workflows.*']`) — a default employee cannot see or complete a task assigned to them. Relevant to A3.
5. **`communication_channels` declares a `manager` role that is never created** (`setup.ts:75-81`) — dead config, because `ensureDefaultRoleAcls` only grants to pre-existing roles. Evidence for Q3.
6. **`callApiConfigSchema` is dead code** (`data/validators.ts:174-181`, zero importers) — CALL_API config is entirely unvalidated server-side (`config: z.record(z.string(), z.any())`).
7. **AGENTS.md drift** — `workflows/AGENTS.md` tells agents to edit `components/ActivityEditor.tsx`, which does not exist. Real surfaces are `components/fields/ActivityArrayEditor.tsx` and `components/TransitionsEditor.tsx`.
8. **`JsonBuilder` uses `alert()`** (`packages/ui/src/backend/JsonBuilder.tsx:115-124`), against the DS dialog rules.
