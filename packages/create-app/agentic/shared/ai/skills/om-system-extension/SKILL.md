---
name: om-system-extension
description: Extend core modules using the Universal Module Extension System (UMES). Use when adding columns/fields/filters to existing tables/forms, enriching API responses, intercepting API routes, blocking/validating mutations, replacing UI components, injecting menu items, or reacting to domain events. Triggers on "extend", "add column to", "add field to", "inject into", "intercept", "enrich", "hook into", "customize", "override component", "add menu item", "react to event", "block mutation", "validate before save".
---

# System Extension — UMES Wizard

Extend any core module without modifying its source code — via the Universal Module Extension System (UMES): pick the right mechanism, generate the required files, and wire everything correctly.

## When to use

- Adding data/fields/columns/filters/actions/menus to another module's API or UI, intercepting its API routes, blocking or validating its mutations, replacing its components, or reacting to its domain events.
- Not for building a brand-new module or its own CRUD/data model — start there with the relevant `om-*` builder skill.

## What it contains

The full UMES procedure split by mechanism. Start at [`workflow/decision-tree.md`](workflow/decision-tree.md) to match the goal to the correct mechanism(s), then load the matching workflow file. When multiple mechanisms are needed (add a field/column), follow [`workflow/triad-pattern.md`](workflow/triad-pattern.md). Every code template, spot ID, contract, and rule lives in the `workflow/` files; full type contracts live in `references/extension-contracts.md`.

## Reference map — load what the task needs

| When | Load |
|------|------|
| Every session — match goal → mechanism | [`workflow/decision-tree.md`](workflow/decision-tree.md) |
| Add computed data to another module's API response (§2) | [`workflow/response-enrichers.md`](workflow/response-enrichers.md) |
| Add an editable field or a column to another module's form/table (§3, §4) | [`workflow/widget-fields-columns.md`](workflow/widget-fields-columns.md) |
| Add a filter control + its server-side interceptor (§5) | [`workflow/widget-filters.md`](workflow/widget-filters.md) |
| Add row actions, bulk actions, or a detail-page tab (§6) | [`workflow/widget-actions-tabs.md`](workflow/widget-actions-tabs.md) |
| Inject menu items into sidebar/topbar/profile (§7) | [`workflow/menu-injection.md`](workflow/menu-injection.md) |
| Intercept API routes — before/after hooks (§8) | [`workflow/api-interceptors.md`](workflow/api-interceptors.md) |
| Block/validate mutations before persistence (§9) | [`workflow/mutation-guards.md`](workflow/mutation-guards.md) |
| Replace/wrap/transform-props of UI components (§10) | [`workflow/component-replacement.md`](workflow/component-replacement.md) |
| React to domain events, sync before-event blocking (§11) | [`workflow/event-subscribers.md`](workflow/event-subscribers.md) |
| Coordinate enricher → widget → injection-table (§12) | [`workflow/triad-pattern.md`](workflow/triad-pattern.md) |
| File checklist, post-impl steps, pitfalls, global rules (§13) | [`workflow/wiring-verification.md`](workflow/wiring-verification.md) |
| Full type contracts for every mechanism | [`references/extension-contracts.md`](references/extension-contracts.md) |

## Non-negotiables

- **MUST** run `yarn generate` after adding any extension file — nothing is discovered otherwise.
- **MUST** implement `enrichMany` on Response Enrichers (batch `$in`, no N+1) and namespace added fields under `_<your-module>`; enrichers are additive-only.
- **MUST** use i18n keys for all user-facing strings, set `features` for ACL gating, and make `onSave` endpoints idempotent.
- **MUST** return `{ ok: false, message }` from interceptors/guards — never throw; **MUST NOT** import other modules' entities directly (use EntityManager queries).
- When extending UI and data together, follow the Triad Pattern (enricher → widget → injection-table).
