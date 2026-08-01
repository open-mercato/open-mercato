# Feature Specs — {{PROJECT_NAME}}

Specs document business feature design decisions. Source of truth for what was built and why.

## What belongs here

- New domain features (inventory management, order flow, customer portal, etc.)
- Data model decisions (entity design, relationships, indexing strategy)
- API contract definitions for custom endpoints
- Integration design (external services, webhooks, import/export)

## What does NOT belong here

Framework-level decisions belong in the Open Mercato core repo. If you're unsure,
it's almost certainly an app-level decision.

## Naming convention

{YYYY-MM-DD}-{slug}.md
Example: 2026-03-01-inventory-module.md

## Workflow

1. Route every new application, multi-module feature, or non-trivial business slice through `om-spec-writing` and `.ai/guides/spec-delivery.md`.
2. After invoking the skill, create the skeleton from `SPEC-000-template.md`; keep it `Draft` while blocking questions or incomplete contracts remain.
3. Set `Ready for implementation` only after the final compliance report and requirement traceability pass and the user approves implementation.
4. Implement through `om-implement-spec` (local) or `om-auto-implement-spec` (PR), one dependency-ordered phase at a time; update the Changelog, acceptance evidence, and phase state as work lands.
