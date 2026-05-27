# Notify — 2026-05-27-crud-sql-query-optimizations

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-05-27T15:30:00Z — run started

- Brief: analyze CRUD API SQL queries across modules; implement first two BC quick wins; file GitHub issues for the rest.
- External skill URLs: none.
- Module scope: customers (CRM), sales, catalog, staff, resources, workflows, plus other modules with CRUD routes (currencies, auth, directory).
- Plan classification: **Spec-implementation run** — multi-phase work spanning analysis, two implementation Steps, and issue creation.
- Branch: `feat/crud-sql-query-optimizations` off `origin/develop` (latest at `da89d7530`).
- Two implementation steps chosen:
  - Step 2.1 — push DB-level pagination to currencies + exchange-rates list routes (highest-impact bug-grade fix; clear OOM/perf risk on large tables).
  - Step 2.2 — parallelize entity + profile decryption fetch in customers people `afterList` (highest-traffic CRM list endpoint).
- Other catalogued wins (C–J in PLAN.md) deferred to GitHub issues per user request.
