# Phase 27.2 — Playwright browser smoke (resume 2, 2026-05-29)

Live, against the branch dev server on :3100 (admin@acme.com).

- **record-conflict-bar-deal.png** — DETERMINISTIC visual proof of the unified conflict bar.
  Recipe: open a deal detail, edit the Title, advance the deal version out-of-band via the
  API (a second "user"), then Save → `PUT /api/customers/deals` returns **409** and the
  app-wide error-styled **RecordConflictBanner** renders at the top: "Record changed — This
  record was modified by someone else. Refresh and try again." with a Refresh button.
- companies-v2 was also exercised live earlier and produced a real `PUT … 409` (the bar; the
  page's react-query refetch-on-focus makes its single-tab repro flaky — the deal page does
  not refetch-on-focus, giving a stable capture).
- Server-side 409 across crm/catalog/sales is additionally proven by the TC-LOCK-OSS-005..008
  integration specs run green against :3100 (customers 3, catalog 1, sales 3).
