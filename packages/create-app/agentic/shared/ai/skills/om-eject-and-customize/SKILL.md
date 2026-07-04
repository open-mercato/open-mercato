---
name: om-eject-and-customize
description: Guide for safely ejecting and customizing core modules. Use when a developer needs to modify a core module's behavior beyond what UMES extensions support, wants to eject a module, or is considering whether to eject vs extend. Triggers on "eject", "customize module", "modify core module", "override module", "fork module", "change built-in", "should I eject".
---

# Eject & Customize

Safely eject a core module into `src/modules/` and make targeted customizations in a standalone
app. Ejecting is a one-way door — always consider UMES extensions first, and treat the ejected
copy as owned code you must maintain across upgrades.

## When to use

- A developer wants to change entity schema, core business logic, or built-in form fields that no UMES extension can reach.
- Someone is weighing "eject vs extend" and needs the decision matrix.
- Not for changes UMES already covers (enrichers, interceptors, guards, component replacement, widget/menu injection, subscribers) — extend instead.

## What it contains

A four-step pipeline: decide & analyze (is ejection justified, what am I taking on) → eject (run
the command, verify `@app` registration) → customize & track (safe/dangerous zones, change log) →
upgrade (merge upstream into the ejected copy). All standalone paths (`src/modules/`,
`node_modules/@open-mercato/core/dist/modules/`) and caveats are preserved in the steps.

## Reference map — load only the step in play

| When | Load |
|------|------|
| Deciding whether to eject, ruling out UMES, pre-ejection analysis, worked scenarios | [`workflow/step-1-decide-and-analyze.md`](workflow/step-1-decide-and-analyze.md) |
| Running `yarn mercato module eject`, verifying registration, what gets copied | [`workflow/step-2-eject.md`](workflow/step-2-eject.md) |
| Customizing safely, avoiding dangerous zones, logging changes | [`workflow/step-3-customize.md`](workflow/step-3-customize.md) |
| Merging upstream changes into an ejected module on package upgrades | [`workflow/step-4-upgrade.md`](workflow/step-4-upgrade.md) |

## Non-negotiables

- **MUST** rule out UMES extensions and document the reason before ejecting; recommend the `om-system-extension` skill first.
- **MUST** run `yarn generate` after ejection and verify the app starts and the module works.
- **MUST** track every change in a customization log and edit only your `src/modules/<module-id>/` copy — never the `node_modules` original.
- **MUST NOT** rename entity tables/columns, event IDs, ACL feature IDs, or DI keys, or remove API routes — adding is safe, renaming/removing is dangerous.
