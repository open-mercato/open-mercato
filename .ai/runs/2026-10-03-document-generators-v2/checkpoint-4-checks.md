🤖 `om-auto-continue-pr-loop` — checkpoint 4 verification

Steps 4.1–4.4 (fad1ca91f through 0ec18287c) complete. Runner: local (Node 24.13.1 / Yarn 4.17.1). Touched areas: Sales-owned document services, offer/invoice templates, Sales i18n, core package dependency wiring.

| Check | Result |
|---|---|
| Sales document-generators Jest (services, normalization, Markdown template, registration) + module-decoupling | ✅ 6 suites / 63 tests |
| document-generators package Jest | ✅ 10 suites / 38 tests |
| `packages/core` typecheck | ✅ exit 0 |
| `packages/shared`, `packages/document-generators`, `packages/core` builds | ✅ |
| `yarn i18n:check-sync` | ✅ all locale files in sync |
| `yarn i18n:check-usage` | ✅ advisory only (pre-existing unused keys) |
| `yarn generate` (run by Step 4.2/4.4 executors) | ✅ generated registry imports `sales/document-generators.ts`; generated files untracked |
| End-to-end Node ESM smoke from built `dist`: Sales convention file → `fromRecord` → `load()` → engine `DocumentRenderer` | ✅ `sales.offer` PDF 3,630 B, `sales.order-invoice` PDF 3,712 B, `sales.order-invoice-markdown` 381 B `text/markdown`; canonical resource id and sanitized filenames (`offer-Q-1-2026.pdf`, `invoice-O-7.pdf`, `invoice-O-7.md`) |
| Real `renderToBuffer` of offer + invoice with and without optional sections (executor scratch script) | ✅ all `%PDF` |
| UI / browser verification | ⏭ skipped — no UI or route touched in this window (server-side services and templates only) |

Notes:
- Jest in `packages/core` cannot load ESM `@react-pdf/renderer`; PDF rendering is verified by the dist smoke above, the registration test mocks the renderer.
- Decisions: Sales depends on `@open-mercato/document-generators` as peer + dev dependency (same pattern as optional `@open-mercato/ai-assistant`); seller block comes from the document's own `SalesChannel`; invoice totals include shipping and surcharge so rows reconcile; engine helpers imported through `/index` barrel paths because the package `exports` map does not resolve bare directories.
