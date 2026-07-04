---
name: om-troubleshooter
description: Diagnose and fix common issues in Open Mercato standalone apps. Use when encountering errors, unexpected behavior, modules not loading, widgets not appearing, migrations failing, build errors, or any "it doesn't work" situation. Triggers on "error", "not working", "broken", "fix", "debug", "why isn't", "can't", "fails", "crash", "missing", "404", "500", "module not found", "widget not showing".
---

# Troubleshooter

Diagnose and fix common issues in Open Mercato standalone apps: identify symptoms, check common causes, propose the fix, verify.

## When to use

- Something in a standalone app "doesn't work": route 404s, 500s, blank pages, missing widgets, failing migrations, build/type errors, DB connection failures.
- Not for building new features from scratch — start there with the relevant `om-*` builder skill.

## What it contains

A layered diagnostic method: identify the failing layer, check generated files, then jump to the matching problem-area file. Start with [`workflow/diagnostic-flow.md`](workflow/diagnostic-flow.md) — it holds the layer-routing table, the "check generated files" first pass, the propose-before-fixing rule (read-only vs mutating actions), and the non-negotiable rules.

## Reference map — load what the task needs

| When | Load |
|------|------|
| Every session — routing, propose-before-fixing, rules | [`workflow/diagnostic-flow.md`](workflow/diagnostic-flow.md) |
| Module not discovered, route 404, page 404 | [`workflow/module-issues.md`](workflow/module-issues.md) |
| "Column/table does not exist", stale schema, unexpected migrations | [`workflow/entity-migration-issues.md`](workflow/entity-migration-issues.md) |
| API route 404 / 500 / 401 / 403 | [`workflow/api-route-issues.md`](workflow/api-route-issues.md) |
| Blank page, empty DataTable, broken icons, CrudForm not saving | [`workflow/ui-widget-issues.md`](workflow/ui-widget-issues.md) |
| `yarn build` / typecheck failures, "module not found" imports | [`workflow/build-type-issues.md`](workflow/build-type-issues.md) |
| Enricher / widget injection / interceptor / component replacement not working | [`workflow/extension-issues.md`](workflow/extension-issues.md) |
| Connection refused, slow queries | [`workflow/database-issues.md`](workflow/database-issues.md) |
| "Fix everything" reset sequence + common-error lookup table | [`workflow/quick-diagnostics.md`](workflow/quick-diagnostics.md) |
| Copy-paste diagnostic command reference | [`references/diagnostic-commands.md`](references/diagnostic-commands.md) |

## Non-negotiables

- **Propose before fixing**: present root cause + exact fix, then wait for explicit confirmation before any **mutating** action. Only read-only diagnostics run without asking — see the read-only/mutating table in `workflow/diagnostic-flow.md`.
- **NEVER** edit files in `.mercato/generated/` or `node_modules/`.
- **NEVER** assume — verify with actual error output (server logs, browser console); fix the root cause, not the symptom.
