# Notify — 2026-08-06-harness-assert-module-facts-required

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-08-06T06:39:27Z — run started
- Brief: implement #4603 — assert the module facts the catalog only allows.
- External skill URLs: none

## 2026-08-06T06:39:27Z — decision: twelve modules, not eleven
- Measuring the shipped set (production `selectModuleFactSheets`, 49 sheets on an emitted controller)
  finds `design_system` as a twelfth sheet with no `context.required` reference. It post-dates the
  #4602 audit, so #4603 does not list it. Handled here because Step 2.2's guard cannot be tightened
  without accounting for it.

## 2026-08-06T06:39:27Z — decision: ten cases, two exemptions
- `api_docs` and `design_system` are exempt: neither ships a `data/` directory, entity, or migration,
  so there is no schema an agent could duplicate. Both keep their existing `allowedExtra` reference.
