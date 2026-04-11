# Open Mercato — Design System Audit & Foundation Plan

**Data:** 2026-04-10
**Branch:** develop
**Autor:** Claude (na zlecenie Product/Design Lead)
**Status:** Dokument roboczy

---

> Design system dla Open Mercato: audit 160 stron, 34 modułów, semantic tokens (OKLCH), component library (shadcn/ui + Radix + CVA), governance model. Od fundamentów po metryki adopcji.

---

## Spis treści

### Audit & Foundations

| # | Dokument | Opis |
|---|----------|------|
| 1 | [Audit istniejącego UI](./audit.md) | Audyt 160 stron: architektura, nawigacja, kolory, typografia, spacing, a11y, dark mode |
| 2 | [Design Principles](./principles.md) | 8 zasad projektowych + PR review checklist |
| 3 | [Foundations](./foundations.md) | Tokeny: kolory, typografia, spacing, z-index, border-radius, breakpoints, ikony |
| 4 | [MVP Komponentów](./components.md) | 22 komponentów z priorytetami, statusami i planami migracji |

### Strategy & Planning

| # | Dokument | Opis |
|---|----------|------|
| A | [Executive Summary](./executive-summary.md) | Wnioski, ryzyka, quick wins, kolejność działań |
| B | [Plan na Hackathon](./hackathon-plan.md) | Bloki czasowe PT 9:00 – SO 11:00 |
| C | [Deliverables](./deliverables.md) | Lista wyników po hackathonie |
| D | [Tabela Priorytetów](./priority-table.md) | Macierz spójność × UX × wysiłek |

### Enforcement & Migration

| # | Dokument | Opis |
|---|----------|------|
| E | [Enforcement & Migration Plan](./enforcement.md) | ESLint rules, codemod scripts, migration playbook |
| F | [Success Metrics & Tracking](./metrics.md) | KPI dashboard + ds-health-check.sh |
| G | [Component API Proposals](./component-apis.md) | Props, variants, examples: Alert, StatusBadge, FormField, etc. |
| H | [Migration Risk Analysis](./risk-analysis.md) | 6 ryzyk + macierz prawdopodobieństwo × impact |
| I | [Token Values (Draft)](./token-values.md) | Wartości OKLCH — light/dark mode |
| J | [Migration Mapping Tables](./migration-tables.md) | Tabele zamiany kolorów i typografii + codemod scripts |

### Contributor Experience

| # | Dokument | Opis |
|---|----------|------|
| K | [Module Scaffold & Guardrails](./contributor-guardrails.md) | Szablony stron, anti-patterns, scaffold script |
| L | [Structural Lint Rules](./lint-rules.md) | ESLint v9 plugin — 6 reguł |
| M | [Onboarding Guide](./onboarding-guide.md) | "Your First Module" — krok po kroku |

### Human Layer — Governance

| # | Dokument | Opis |
|---|----------|------|
| N | [Stakeholder Buy-in](./stakeholder-buyin.md) | Persony, argumenty, obiekcje, plan komunikacji |
| O | [Contributor Experience (CX)](./contributor-experience.md) | Mapy podróży, pain points, cheat sheet |
| P | [Champions Strategy](./champions.md) | Ambasadorzy DS: rekrutacja, aktywacja, retencja |
| Q | [Guerrilla Research Plan](./research-plan.md) | PR archaeology, 5-min tests, intercept surveys |
| R | [Decision Log](./decision-log.md) | DR-001 – DR-010: decyzje architektoniczne |
| S | [Success Metrics Beyond Code](./success-metrics-cx.md) | Metryki ludzkie: adopcja, onboarding, satysfakcja |
| T | [Iteration & Feedback](./iteration.md) | Sprinty, RFC process, wersjonowanie, deprecation |

### Coverage Gaps (Supplements)

| # | Dokument | Opis |
|---|----------|------|
| U | [Foundations Gaps — Motion, Type, Icons](./foundations-gaps.md) | Animacje, hierarchia typografii, konwencje ikon |
| V | [Component Specs](./component-specs.md) | Quick reference 21 komponentów + deep specs |
| W | [Content Guidelines + Page Patterns](./content-patterns.md) | Voice & tone, dashboard/wizard patterns |
| X | [Visual Testing + Designer Workflow](./testing-designer.md) | 3-tier visual testing, code-first workflow |
| — | [Coverage Report](./coverage-report.md) | Analiza pokrycia 7-warstwowego frameworka (~87%) |

### Scripts

| Script | Opis |
|--------|------|
| [ds-health-check.sh](../../.ai/scripts/ds-health-check.sh) | Metryki zdrowia DS — uruchamiać co sprint |
| [ds-migrate-typography.sh](../../.ai/scripts/ds-migrate-typography.sh) | Codemod: migracja typografii na tokeny |
| [ds-migrate-colors.sh](../../.ai/scripts/ds-migrate-colors.sh) | Codemod: migracja kolorów na semantic tokens |

---

## Quick Start

1. Zacznij od [Executive Summary](./executive-summary.md) — 2 minuty
2. Przeczytaj [Design Principles](./principles.md) — 5 minut
3. Jeśli budujesz moduł: [Onboarding Guide](./onboarding-guide.md)
4. Jeśli migруjesz kolory: [Migration Tables](./migration-tables.md) + [ds-migrate-colors.sh](../../.ai/scripts/ds-migrate-colors.sh)
5. Pełny kontekst: [Audit](./audit.md) → [Foundations](./foundations.md) → [Components](./components.md)
