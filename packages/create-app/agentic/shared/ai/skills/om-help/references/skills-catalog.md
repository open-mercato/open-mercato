# Skills Catalog — Standalone App

> All skills available in a `create-mercato-app` project, organized by category.  
> Load this file when answering "what skill should I use?" or "what comes next?".

## Table of Contents

- [Building Your App](#building-your-app)
- [Extending & Customizing](#extending--customizing)
- [Troubleshooting & Maintenance](#troubleshooting--maintenance)
- [PR & Code Quality](#pr--code-quality)
- [Migration](#migration)

---

## Building Your App

Skills for creating new functionality in your standalone Open Mercato application.

| Skill | Trigger / When to use | Preceded by | Followed by |
|-------|----------------------|-------------|-------------|
| `om-help` | "what now?", "which skill?", "next steps?", "how do I X?", orientation | — | any |
| `om-data-model-design` | Designing entities, relationships, migrations, encryption maps for PII | — | `om-spec-writing` or `om-module-scaffold` |
| `om-spec-writing` | Writing a spec before building a non-trivial feature | `om-data-model-design` | `om-module-scaffold` or `om-implement-spec` |
| `om-module-scaffold` | Creating a new module with entity, routes, pages, ACL, DI | `om-spec-writing` or `om-data-model-design` | `om-integration-tests` |
| `om-implement-spec` | Implementing an existing spec phase-by-phase | `om-spec-writing` | `om-integration-tests` |
| `om-backend-ui-design` | Designing admin pages, CRUD forms, data tables | — | `om-implement-spec` or `om-module-scaffold` |
| `om-integration-builder` | Building a payment, shipping, or data-sync integration provider | `om-spec-writing` | `om-integration-tests` |
| `om-integration-tests` | Writing or running Playwright integration tests | `om-module-scaffold` or `om-implement-spec` | `om-code-review` |

---

## Extending & Customizing

Skills for modifying or extending behavior without touching core module source.

| Skill | Trigger / When to use | Preceded by | Followed by |
|-------|----------------------|-------------|-------------|
| `om-system-extension` | Add columns/fields/filters to existing tables, enrich API responses, intercept routes, inject menu items, replace UI components | — | `om-code-review` |
| `om-eject-and-customize` | When UMES extensions aren't enough and you need to modify core module source directly | — | `om-code-review` |
| `om-trim-unused-modules` | Slim down the app by disabling modules you don't use | — | `om-code-review` |

---

## Troubleshooting & Maintenance

| Skill | Trigger / When to use | Preceded by | Followed by |
|-------|----------------------|-------------|-------------|
| `om-troubleshooter` | Errors, module not loading, widgets not appearing, migration failures, build errors, "it doesn't work" | — | `om-code-review` (after fix) |

---

## PR & Code Quality

| Skill | Trigger / When to use | Preceded by | Followed by |
|-------|----------------------|-------------|-------------|
| `om-code-review` | Review before merging — architecture, security, DS, conventions | any impl skill | `om-auto-create-pr` |
| `om-auto-create-pr` | Ship work as a GitHub PR end-to-end | `om-code-review` | `om-auto-review-pr` |
| `om-auto-continue-pr` | Resume an in-progress PR started by `om-auto-create-pr` | — | `om-auto-review-pr` |
| `om-auto-create-pr-loop` | Long multi-step implementation with step-level resumability | — | `om-auto-review-pr` |
| `om-auto-continue-pr-loop` | Resume a PR started by `om-auto-create-pr-loop` | — | `om-auto-review-pr` |
| `om-auto-review-pr` | Automated PR review + approve/request-changes | `om-auto-create-pr` | — |
| `om-auto-fix-issue` | Fix a GitHub issue end-to-end | — | `om-auto-create-pr` |
| `om-prepare-issue` | Capture a feature to build later — write the spec, ship a docs-only spec PR, open a tracking issue | `om-spec-writing` | `om-implement-spec` |

---

## Migration

| Skill | Trigger / When to use | Preceded by | Followed by |
|-------|----------------------|-------------|-------------|
| `om-auto-upgrade-0.4.10-to-0.5.0` | Upgrade app from Open Mercato 0.4.10 → 0.5.0 | — | `om-code-review` |

---

## Notes

- **preceded-by / followed-by** are suggestions, not hard constraints.
- `om-troubleshooter` is always a valid entry point when something is broken.
- `om-system-extension` should be tried before `om-eject-and-customize` — ejecting makes upgrades harder.
- `om-help` is always the right starting point when you're unsure.
