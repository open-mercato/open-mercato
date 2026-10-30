# Checkpoint 13 — steps 7.1–7.5 (branding backend + first admin UI)

**Timestamp:** 2026-10-06T16:40:11Z
**Steps covered:** 7.1–7.5 (0046e52eb9 .. bd03b75d25)
**Runner:** local mode (`LANG=en_US.UTF-8`) for build/typecheck/unit/lint; ephemeral env (fresh forced build incl. bd03b75d25, own DB, started 16:36Z) for the UI smoke
**Touched areas:** `lib/brandingStyles.ts` (validation, fixed declaration set, SSR style helper, fuzz suite); `PUT /stores/:id/branding` command (+undo) and `GET preview-branding`; `GET store-channel-bindings/:id/assortment-count`; admin store list + create dialog + edit shell (`/backend/config/ecommerce`, `/backend/config/ecommerce/[id]?tab=…`), store binding-summary enricher; General tab + store-default availability policy card.

| Check | Result | Notes |
|---|---|---|
| `yarn build:packages --force` → `yarn generate` → `yarn build:packages --force` | ✅ | |
| typecheck core | ✅ | |
| `yarn workspace @open-mercato/core test` (FULL) | ✅ 19867 passed | incl. branding fuzz suite (3000 seeded inputs/property), branding route 24, assortment-count 34 |
| `yarn i18n:check-sync` | ✅ | |
| `yarn lint` | ✅ | |
| UI smoke — store list (ephemeral, Playwright) | ✅ | settings hub entry; empty state; row actions Edit/Domains/Channels/Archive |
| UI smoke — create dialog | ✅ | Ctrl+Enter submits (201); duplicate code → 409 shown as field error under Code |
| UI smoke — General tab | ✅ | default locale removed from supported → field error; rename + locales persisted after reload |
| UI smoke — Availability defaults card | ✅ | lead time required with backorders; POST /api/availability/policies 201; hide/backorder/lead persisted after reload |
| UI smoke — Archive | ✅ | confirmation with the 410 warning; status Archived |
| Console | ✅ | only the pre-existing post-login feature-check 401 / dashboard-layout fetch abort |

**Artifacts:** `checkpoint-13-artifacts/` — screenshot-store-list.png, screenshot-store-create-dialog.png, screenshot-store-general-tab.png, screenshot-store-availability-defaults.png, screenshot-store-list-archived.png.

**Low-severity findings for the review pass:** (1) each General-tab card shows Cancel in both its header and footer (embedded CrudForm default); (2) after Archive, the "Last operation" undo banner still offers the previous operation (availability policy create), not the archive; (3) info: form labels are not associated with inputs (platform-wide CrudForm behaviour, not ecommerce-specific).
**Integration (Playwright) tests for admin UI paths:** Step 7.12.
