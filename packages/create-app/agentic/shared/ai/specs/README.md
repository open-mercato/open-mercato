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

SPEC-{number}-{YYYY-MM-DD}-{slug}.md
Example: SPEC-001-2026-03-01-inventory-module.md

## Workflow

1. Before coding any significant feature, check for an existing spec
2. If none: create from SPEC-000-template.md, review with team, then code
3. After implementation: update the spec's Changelog and Acceptance Criteria
