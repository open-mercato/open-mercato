# Open Mercato — Design System Audit & Foundation Plan

**Date:** 2026-04-10
**Branch:** develop
**Author:** Claude (commissioned by Product/Design Lead)
**Status:** Working document

---

> Design system for Open Mercato: audit of 160 pages, 34 modules, semantic tokens (OKLCH), component library (shadcn/ui + Radix + CVA), governance model. From foundations to adoption metrics.

---

## Table of contents

### Audit & Foundations

| # | Document | Description |
|---|----------|-------------|
| 1 | [Existing UI Audit](./audit.md) | Audit of 160 pages: architecture, navigation, colors, typography, spacing, a11y, dark mode |
| 2 | [Design Principles](./principles.md) | 8 design principles + PR review checklist |
| 3 | [Foundations](./foundations.md) | Tokens: colors, typography, spacing, z-index, border-radius, breakpoints, icons |
| 4 | [Component MVP](./components.md) | 22 components with priorities, statuses, and migration plans |

### Strategy & Planning

| # | Document | Description |
|---|----------|-------------|
| A | [Executive Summary](./executive-summary.md) | Conclusions, risks, quick wins, action sequence |
| B | [Hackathon Plan](./hackathon-plan.md) | Time blocks FRI 9:00 – SAT 11:00 |
| C | [Deliverables](./deliverables.md) | List of deliverables after the hackathon |
| D | [Priority Table](./priority-table.md) | Consistency x UX x effort matrix |

### Enforcement & Migration

| # | Document | Description |
|---|----------|-------------|
| E | [Enforcement & Migration Plan](./enforcement.md) | ESLint rules, codemod scripts, migration playbook |
| F | [Success Metrics & Tracking](./metrics.md) | KPI dashboard + ds-health-check.sh |
| G | [Component API Proposals](./component-apis.md) | Props, variants, examples: Alert, StatusBadge, FormField, etc. |
| H | [Migration Risk Analysis](./risk-analysis.md) | 6 risks + probability x impact matrix |
| I | [Token Values (Draft)](./token-values.md) | OKLCH values — light/dark mode |
| J | [Migration Mapping Tables](./migration-tables.md) | Color and typography replacement tables + codemod scripts |

### Contributor Experience

| # | Document | Description |
|---|----------|-------------|
| K | [Module Scaffold & Guardrails](./contributor-guardrails.md) | Page templates, anti-patterns, scaffold script |
| L | [Structural Lint Rules](./lint-rules.md) | ESLint v9 plugin — 6 rules |
| M | [Onboarding Guide](./onboarding-guide.md) | "Your First Module" — step by step |

### Human Layer — Governance

| # | Document | Description |
|---|----------|-------------|
| N | [Stakeholder Buy-in](./stakeholder-buyin.md) | Personas, arguments, objections, communication plan |
| O | [Contributor Experience (CX)](./contributor-experience.md) | Journey maps, pain points, cheat sheet |
| P | [Champions Strategy](./champions.md) | DS ambassadors: recruitment, activation, retention |
| Q | [Guerrilla Research Plan](./research-plan.md) | PR archaeology, 5-min tests, intercept surveys |
| R | [Decision Log](./decision-log.md) | DR-001 – DR-010: architectural decisions |
| S | [Success Metrics Beyond Code](./success-metrics-cx.md) | Human metrics: adoption, onboarding, satisfaction |
| T | [Iteration & Feedback](./iteration.md) | Sprints, RFC process, versioning, deprecation |

### Coverage Gaps (Supplements)

| # | Document | Description |
|---|----------|-------------|
| U | [Foundations Gaps — Motion, Type, Icons](./foundations-gaps.md) | Animations, typography hierarchy, icon conventions |
| V | [Component Specs](./component-specs.md) | Quick reference for 21 components + deep specs |
| W | [Content Guidelines + Page Patterns](./content-patterns.md) | Voice & tone, dashboard/wizard patterns |
| X | [Visual Testing + Designer Workflow](./testing-designer.md) | 3-tier visual testing, code-first workflow |
| — | [Coverage Report](./coverage-report.md) | 7-layer framework coverage analysis (~87%) |

### Scripts

| Script | Description |
|--------|-------------|
| [ds-health-check.sh](../../.ai/scripts/ds-health-check.sh) | DS health metrics — run every sprint |
| [ds-migrate-typography.sh](../../.ai/scripts/ds-migrate-typography.sh) | Codemod: migrate typography to tokens |
| [ds-migrate-colors.sh](../../.ai/scripts/ds-migrate-colors.sh) | Codemod: migrate colors to semantic tokens |

---

## Quick Start

1. Start with [Executive Summary](./executive-summary.md) — 2 minutes
2. Read [Design Principles](./principles.md) — 5 minutes
3. If building a module: [Onboarding Guide](./onboarding-guide.md)
4. If migrating colors: [Migration Tables](./migration-tables.md) + [ds-migrate-colors.sh](../../.ai/scripts/ds-migrate-colors.sh)
5. Full context: [Audit](./audit.md) → [Foundations](./foundations.md) → [Components](./components.md)
