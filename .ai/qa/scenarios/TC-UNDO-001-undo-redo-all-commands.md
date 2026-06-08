# TC-UNDO-001 — Undo/Redo correctness across all undoable commands

> **Type:** QA verification ticket (single ticket, many scenarios)
> **Area:** Audit logs / Command bus / Undo–Redo
> **Goal:** Confirm that **undo always works** for every command that declares undo support — the entity is returned to its exact pre-command state (all fields, soft-delete flags, relations, custom fields) — and that **redo** re-applies it. Confirm that commands **without** undo support correctly expose no undo affordance.
>
> <!-- INTEGRATION-TEST CANDIDATE (NEXT STAGE):
>   Every scenario row below is a candidate for an automated per-module integration test
>   (`packages/<pkg>/src/modules/<module>/__integration__/...undo.spec.ts`).
>   The "Fields to verify saved/undone" column is the assertion contract for those tests:
>   snapshot the entity before the command, run the command, run undo, assert deep-equality
>   on the listed fields (incl. deleted_at, related collections, custom fields). Redo asserts
>   the post-command state is reproduced. Do NOT write the tests as part of this ticket — this
>   ticket is manual QA first; automation is the next stage once the human pass confirms the
>   field contracts below are accurate per command.
> -->

---

## 1. How undo works (mechanism QA must understand)

All domain writes run through the **Command bus** (`packages/shared/src/lib/commands/command-bus.ts`). Each undoable command:

1. `prepare()` captures a **before** snapshot, `captureAfter()` captures an **after** snapshot.
2. `buildLog()` writes an `ActionLog` row (`action_logs` table) holding `command_id`, `command_payload` (incl. the undo payload), `snapshot_before`, `snapshot_after`, `changes_json`, and a unique **`undo_token`**.
3. `undo()` replays the inverse mutation from the stored snapshot and then `markUndone()` sets `execution_state = 'undone'` and **clears `undo_token`** (so the same action can't be undone twice). A mirror trace log is written with reversed snapshots — that mirror is what **redo** undoes.

**Surfaces that trigger undo:**
- **Undo banner / toast** after a mutation — client store keeps the last operations for **60 s** (`LAST_OPERATION_TTL_MS`), auto-dismiss default **10 s** (`NEXT_PUBLIC_OM_UNDO_BANNER_TIMEOUT_MS`), stack limit 20.
- **Version History panel** (`packages/ui/src/backend/version-history/VersionHistoryPanel.tsx`) — per-entry **Undo** / **Redo** buttons.
- **API:** `POST /api/audit_logs/audit-logs/actions/undo` `{ undoToken }`; `POST /api/audit_logs/audit-logs/actions/redo` `{ logId }`; list via `GET /api/audit_logs/audit-logs/actions?undoableOnly=true`.

**Permissions / scope (verify these gates too):**
- `audit_logs.undo_self` (default for `employee`) — undo your **own** actions; `audit_logs.undo_tenant` (admin) — undo anyone's in tenant.
- `audit_logs.redo_self` / `audit_logs.redo_tenant` mirror the above for redo; `audit_logs.view_self` / `view_tenant` gate history visibility.
- **Latest-only rule:** only the **most recent** undoable action for a resource (or actor) can be undone — undoing an older action while a newer one exists returns `400 Undo token not available`.
- **Tenant/org isolation:** undo across a different tenant or organization is rejected.

---

## 2. Invariants to assert on EVERY scenario below

For each command, run: **create state → execute command → UNDO → (then) REDO**. Verify:

| # | Invariant |
|---|-----------|
| I1 | After undo, the entity matches its **pre-command** state on **all** listed fields (incl. `updated_at` behavior, `is_active`, `deleted_at`). |
| I2 | Soft-deleted records are **restored** (`deleted_at = null`) on undoing a delete; created records are **soft-deleted/removed** on undoing a create. |
| I3 | **Related collections** (addresses, tags/assignments, comments, activities, todos, interactions, line items) are restored to their exact prior set — no orphans, no duplicates. |
| I4 | **Custom field values** are restored exactly (added cf removed, removed cf re-added, changed cf reverted). |
| I5 | The action's `undo_token` is consumed after undo (cannot undo twice); the entry shows as **undone** in Version History and offers **Redo**. |
| I6 | **Redo** re-applies the command, reproducing the post-command state; entity, relations, and custom fields match the after-snapshot. |
| I7 | List views, detail views, **search index**, and any cached counts reflect the restored/redone state (undo emits the same CRUD side effects as the original mutation). |
| I8 | Lists/search are tenant- and org-scoped after undo/redo (no cross-tenant leakage). |
| I9 | Undo affordance is **absent** for non-undoable commands (Section 4). |

**Generic field contract by command kind** (applies unless a row notes specifics):
- **create → undo** = remove the record (soft delete / hard remove per entity); **redo re-materializes it with the *same* id** (restores the soft-deleted row, or re-creates it from the after-snapshot reusing the original id) so references and the after-snapshot match exactly — redo MUST NOT mint a new id (issue #2506, invariant I6).
- **update → undo** = restore the **complete before snapshot** of all scalar fields + relations + custom fields.
- **delete → undo** = re-materialize the record from the before snapshot (all scalars, `deleted_at=null`, relations, custom fields).
- **assign/unassign / link/unlink** = toggle the junction row's `deleted_at`.

---

## 3. Undoable commands — scenarios & field contracts

> Legend: ✅ = undo supported. Snapshot = "complete before snapshot of all scalar fields + custom fields" unless noted. Run each as Create/Update/Delete triple where applicable.

### 3.1 customers (reference module — richest relations)
| Command | Entity | Fields to verify saved/undone |
|---|---|---|
| `customers.people.create/update/delete` | Person | entity scalars (name, email, phone, status…), profile, **addresses**, **comments**, **activities**, **todos**, **interactions**, **tagIds**, **company links**, custom fields, `deleted_at` |
| `customers.companies.create/update/delete` | Company | displayName, description + company profile, tags, custom fields, `deleted_at` |
| `customers.deals.create/update/delete` | Deal | full deal snapshot (title, value, stage/pipeline, owner…), custom fields, `deleted_at` |
| `customers.addresses.create/update/delete` | Address | all address fields, `deleted_at` |
| `customers.comments.create/update/delete` | Comment | body, author, links, `deleted_at` |
| `customers.activities.create/update/delete` | Activity | type, payload, timestamps, `deleted_at` |
| `customers.interactions.create/update/delete` | Interaction | snapshot, `deleted_at` |
| `customers.interactions.complete` | Interaction | **status + completedAt** restored to prior values |
| `customers.interactions.cancel` | Interaction | **status + cancelledAt** restored to prior values |
| `customers.personCompanyLinks.create/update/delete` | PersonCompanyLink | role/relationship fields, `deleted_at` |
| `customers.tags.create/update/delete` | Tag | name, color, `deleted_at` |
| `customers.tags.assign / unassign` | TagAssignment | junction `deleted_at` toggled |
| `customers.labels.create` / `labels.assign` / `labels.unassign` | Label / LabelAssignment | label fields / junction `deleted_at` |
| `customers.todos.create` / `todos.unlink` | Todo / TodoLink | todo + link snapshot / link `deleted_at` |
| `customers.dictionaryEntries.create/update/delete` | DictionaryEntry | label, value, order, `deleted_at` |
| `customers.dictionaryKindSettings.upsert` | DictionaryKindSettings | before snapshot, or **deleted if newly created** |
| `customers.entityRoles.create/update/delete` | EntityRole | role fields, `deleted_at` |

### 3.2 auth
| Command | Entity | Fields |
|---|---|---|
| `auth.users.create/update/delete` | User | email, firstName, lastName, phone, status, isActive, **roles**, custom fields, `deleted_at` |
| `auth.roles.create/update/delete` | Role | name, description, **features**, isSystem, `deleted_at` |

### 3.3 catalog
| Command | Entity | Fields |
|---|---|---|
| `catalog.products.create/update/delete` | Product | full product snapshot, custom fields, `deleted_at` |
| `catalog.variants.create/update/delete` | Variant | variant snapshot, `deleted_at` |
| `catalog.categories.create/update/delete` | Category | name, slug, description, **parentId, rootId, treePath, depth, ancestorIds, childIds, descendantIds**, isActive, custom fields, `deleted_at` |
| `catalog.offers.create/update/delete` | Offer | offer snapshot, `deleted_at` |
| `catalog.prices.create/update/delete` | Price | amount, currency, kind, `deleted_at` |
| `catalog.priceKinds.create/update/delete` | PriceKind | snapshot, `deleted_at` |
| `catalog.optionSchemas.create/update/delete` | OptionSchema | snapshot, `deleted_at` |
| `catalog.productUnitConversions.create/update/delete` | ProductUnitConversion | snapshot, `deleted_at` |

### 3.4 sales
| Command | Entity | Fields |
|---|---|---|
| `sales.channels.create/update/delete` | Channel | snapshot, `deleted_at` |
| `sales.shipping-methods.create/update/delete` | ShippingMethod | snapshot, `deleted_at` |
| `sales.payment-methods.create/update/delete` | PaymentMethod | snapshot, `deleted_at` |
| `sales.delivery-windows.create/update/delete` | DeliveryWindow | snapshot, `deleted_at` |
| `sales.tax-rates.create/update/delete` | TaxRate | snapshot, `deleted_at` |
| `sales.notes.create/update/delete` | Note | snapshot, `deleted_at` |
| `sales.payments.create/update/delete` | Payment | full payment snapshot, `deleted_at` |
| `sales.shipments.create/update/delete` | Shipment | full shipment snapshot, `deleted_at` |
| `sales.document-addresses.create/update/delete` | DocumentAddress | address fields, `deleted_at` |
| `sales.tags.create/update/delete` | Tag | name, color, `deleted_at` |
| `sales.returns.create` | Return | return + line adjustments removed, `returned_quantity` restored, order totals recomputed |

### 3.5 staff
| Command | Entity | Fields |
|---|---|---|
| `staff.team-members.create/update/delete` | TeamMember | full snapshot, custom fields, `deleted_at` |
| `staff.team-members.tags.assign / unassign` | TagAssignment | junction `deleted_at` |
| `staff.teams.create/update/delete` | Team | snapshot, `deleted_at` |
| `staff.team-roles.create/update/delete` | TeamRole | snapshot, `deleted_at` |
| `staff.team-member-activities.create/update/delete` | Activity | snapshot, `deleted_at` |
| `staff.team-member-addresses.create/update/delete` | Address | snapshot, `deleted_at` |
| `staff.team-member-comments.create/update/delete` | Comment | snapshot, `deleted_at` |
| `staff.team-member-job-histories.create/update/delete` | JobHistory | snapshot, `deleted_at` |
| `staff.leave-requests.create/update/delete` | LeaveRequest | full snapshot, `deleted_at` |
| `staff.leave-requests.accept` | LeaveRequest | **status + approvalDate** restored |
| `staff.leave-requests.reject` | LeaveRequest | **status + rejectionDate** restored |
| `staff.timesheets.time_entries.create/update/delete` | TimeEntry | snapshot, `deleted_at` |
| `staff.timesheets.time_projects.create/update/delete` | TimeProject | snapshot, `deleted_at` |
| `staff.timesheets.time_project_members.assign / unassign` | ProjectMember | junction `deleted_at` |

### 3.6 resources
| Command | Entity | Fields |
|---|---|---|
| `resources.resources.create/update/delete` | Resource | snapshot, `deleted_at` |
| `resources.resource-types.create/update/delete` | ResourceType | snapshot, `deleted_at` |
| `resources.resource-activities.create/update/delete` | Activity | snapshot, `deleted_at` |
| `resources.resource-comments.create/update/delete` | Comment | snapshot, `deleted_at` |
| `resources.resourceTags.create/update/delete` | Tag | snapshot, `deleted_at` |
| `resources.resourceTags.assign / unassign` | TagAssignment | junction `deleted_at` |

### 3.7 planner
| Command | Entity | Fields |
|---|---|---|
| `planner.availability.create/update/delete` | Availability | snapshot, `deleted_at` |
| `planner.availability.weekly.replace` | AvailabilityWeekly | **complete weekly schedule** restored |
| `planner.availability.date-specific.replace` | AvailabilityDateSpecific | **complete date-specific slot set** restored |
| `planner.availability-rule-sets.create/update/delete` | AvailabilityRuleSet | snapshot, `deleted_at` |

### 3.8 currencies
| Command | Entity | Fields |
|---|---|---|
| `currencies.currencies.create/update/delete` | Currency | code, symbol, precision, isActive, `deleted_at` |
| `currencies.exchange_rates.create/update/delete` | ExchangeRate | rate, pair, effectiveAt, `deleted_at` |

### 3.9 directory
| Command | Entity | Fields |
|---|---|---|
| `directory.organizations.create/update/delete` | Organization | snapshot incl. **reparent** fields, `deleted_at` (note: org rows log with null `organization_id` — verify undo still works for tenant-level rows, ref issue #2398) |

### 3.10 feature_toggles
| Command | Entity | Fields |
|---|---|---|
| `feature_toggles.global.create/update/delete` | FeatureToggle | key, state, description, `deleted_at` |
| `feature_toggles.overrides.changeState` | FeatureToggleOverride | `value` restored, or override deleted/recreated per `before` snapshot |

### 3.11 scheduler
| Command | Entity | Fields |
|---|---|---|
| `scheduler.jobs.create/update/delete` | Job | cron/schedule, payload, enabled, `deleted_at` |

### 3.12 checkout
| Command | Entity | Fields |
|---|---|---|
| `checkout.template.create/update/delete` | Template | snapshot, `deleted_at` |
| `checkout.link.create/update/delete` | Link | snapshot, `deleted_at` |

---

## 4. Commands WITHOUT undo — verify NO undo affordance (negative scenarios)

These intentionally do **not** support undo. Verify no Undo button/banner appears and the API rejects an undo attempt. Do **not** raise bugs for missing undo here.

- **customers:** `pipelines.*`, `pipeline-stages.*` (incl. `reorder`), `settings.save*`, `interaction.recompute_next`
- **dictionaries:** `entries.reorder`, `entries.set_default`
- **directory:** `tenants.create/update/delete`
- **sales:** `settings.save`
- **translations:** `translation.save`, `translation.delete`
- **messages:** all (`compose`, `update_draft`, `reply`, `forward`, `delete_for_actor`, recipients `mark_read/mark_unread/archive/unarchive`, conversation `archive/delete/mark_unread_for_actor`, attachments `link/unlink`, `confirmations.confirm`, `actions.execute/record_terminal`, `tokens.consume`)
- **communication_channels:** all (connect/disconnect/delete channel, deliver/ingest message, reactions, reassign, set-primary, push register/renew/unregister, queue-import-history)
- **checkout:** `transaction.create`, `transaction.updateStatus`
- **currencies:** `fetch-configs`
- **scheduler:** `test.echo`
- **enterprise/security:** all (changePassword, enforcement-policy CRUD, sudo-config CRUD, regenerateRecoveryCodes, removeMfaMethod, resetUserMfa)
- **enterprise/record_locks:** `conflict.accept_incoming`, `conflict.accept_mine`

---

## 5. Cross-cutting scenarios (run once each)

| ID | Scenario | Expected |
|---|---|---|
| X1 | Undo from the **banner/toast** within 60 s | Restores entity; banner dismisses |
| X2 | Undo from **Version History** panel | Entry flips to "undone"; Redo offered |
| X3 | **Redo** an undone action | Re-applies command; matches after-snapshot |
| X4 | **Latest-only:** create A then B on same resource, try to undo A | `400 Undo token not available` |
| X5 | **Double-undo:** undo same token twice | Second attempt rejected (token consumed) |
| X6 | **Permission:** user without `undo_self` | No undo affordance; API 400/403 |
| X7 | **Cross-actor:** non-admin undoes another user's action | Rejected unless `undo_tenant` |
| X8 | **Tenant/org isolation:** undo token from another tenant/org | Rejected |
| X9 | **Bulk operation undo** (DataTable bulk delete) | All affected rows restored via bulk undo tokens |
| X10 | **Custom-field heavy entity** (e.g. Person/Product with cf) create→edit cf→undo | cf values revert exactly |
| X11 | **Relations** (Person with addresses+tags+todos) delete→undo | All related rows restored, none duplicated |
| X12 | **Search/index consistency** after undo | List + global search reflect restored state |

---

## 6. Reporting

For each row, record: entity before / after command / after undo / after redo (key fields), pass/fail per invariant (I1–I9), and any field that did **not** restore. File failures as `bug` + `priority-high` (data-integrity).

**Next stage (automation):** convert confirmed rows into per-module integration tests asserting the field contracts above — see the INTEGRATION-TEST CANDIDATE comment at the top.
