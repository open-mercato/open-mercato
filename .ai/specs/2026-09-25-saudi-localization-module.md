# Saudi Localization Module (ZATCA / VAT / Hijri)

**Status:** Phase 1 implemented (2026-09-25) — ZATCA QR + VAT primitives; settings, API and Hijri planned
**Scope:** app-local module `apps/mercato/src/modules/saudi_localization` (+ create-app template mirror)
**Related:** [`.ai/specs/2026-09-25-arabic-first-rtl-and-saudi-localization.md`](2026-09-25-arabic-first-rtl-and-saudi-localization.md) (program, Phase 3)

## TLDR

Saudi Arabia requires every simplified tax invoice to carry a QR code whose
content is a TLV byte string, Base64-encoded (ZATCA "Fatoora" Phase 1), and
Phase 2 adds cryptographic clearance/reporting on top of the same payload. The
platform had nothing of this: no VAT primitives, no QR, no Hijri dates. This
change ships the exact, dependency-free core those capabilities are built on —
the five-tag QR payload builder and the Saudi VAT helpers (standard rate, VAT
registration number validation, halala rounding) — with vectors that pin the
byte-level encoding.

## Overview

`saudi_localization` owns everything that is true for the Kingdom specifically
and irrelevant elsewhere, so the OSS core stays jurisdiction-neutral:

| Capability | State |
|---|---|
| ZATCA Phase 1 QR payload (5 TLV tags → Base64) | ✅ this change |
| Saudi VAT rate, VAT-number validation, halala rounding | ✅ this change |
| VAT/registration settings (entity + API + UI) | ⏳ next |
| Invoice integration (QR on generated invoices + print view) | ⏳ next |
| ZATCA Phase 2 (UBL 2.1, hash chain, CSID, clearance/reporting) | ⏳ planned |
| Hijri (Umm al-Qura) dates for documents | ⏳ planned |

## Problem Statement

1. **Compliance is a gate, not a feature.** A VAT-registered Saudi company cannot
   issue a simplified tax invoice without the Phase 1 QR. An ERP that cannot
   produce it is unusable regardless of how good the rest is.
2. **The payload is byte-exact or it is wrong.** The QR is read by ZATCA's
   verifier and by consumer apps: tag order, one-byte lengths measured in UTF-8
   bytes, ISO 8601 timestamps with an offset, and two-decimal amounts are all
   part of the contract. A locale-formatted amount ("1,15") or a character-counted
   Arabic name silently produces a code that scans as invalid.
3. **Money rounding has to be explicit.** JavaScript's binary floats make
   `1.005` round to `1.00` under naive multiplication, so invoice totals can be a
   halala off from the VAT authority's arithmetic.

## Proposed Solution

### Implemented in this change

1. **`lib/zatca/qr.ts`** — the Phase 1 payload.
   - `buildZatcaQrTags(invoice)` → the five tags in ZATCA order: seller name,
     VAT registration number, timestamp, invoice total with VAT, VAT total.
   - `encodeZatcaQrTlv(tags)` → TLV bytes (1-byte tag, 1-byte UTF-8 byte length,
     value bytes, 255-byte cap per value).
   - `buildZatcaQrPayload(invoice)` → the Base64 string for the QR code.
   - `encodeBase64(bytes)` → a small pure encoder, so the same code path works in
     the Node invoice pipeline and in a browser preview (no `Buffer`/`btoa`).
   - Typed `ZatcaQrError` with stable codes (`invalid_seller_name`,
     `invalid_vat_number`, `invalid_timestamp`, `invalid_amount`, `empty_value`,
     `value_too_long`) so callers can surface a specific field error.
   - The timestamp is a parameter, never `Date.now()` inside the builder: invoice
     regeneration stays deterministic and the function stays testable.
2. **`lib/saudi/vat.ts`** — Saudi VAT primitives.
   - `SAUDI_STANDARD_VAT_RATE = 0.15`, `SAUDI_VAT_NUMBER_PATTERN`, `isValidSaudiVatNumber`.
   - `formatSaudDecimal` — ZATCA-ready decimal string (two decimals, dot
     separator, no grouping).
   - `roundToHalalas` — half-up rounding on the decimal the caller wrote rather
     than on its binary approximation (the `"1.005e2"` shift).
   - `computeVatFromNet` — net/VAT/gross that add up after rounding.

### Implemented since (settings)

3. **`lib/vat-settings.ts` + `data/validators.ts` + `api/vat-settings/route.ts`** —
   the seller identity as tenant-scoped settings, stored in the platform's
   `module_configs` store through `ModuleConfigService` (no bespoke entity, no
   migration):
   - `GET /api/saudi/vat-settings` returns the stored values merged with the
     shipped defaults (`15%`, QR on), `isComplete` and the record's `updatedAt`;
   - `PUT /api/saudi/vat-settings` replaces them, validated by zod (VAT-number
     pattern, seller name capped at the 255-byte TLV limit, rate 0–1), behind
     `saudi_localization.settings.view|manage`, through the mutation guard;
   - **optimistic locking is on**: the client sends the record's `updatedAt` in
     `x-om-ext-optimistic-lock-expected-updated-at`, the route enforces it with
     `enforceCommandOptimisticLockWithGuards`, and a stale write is refused with
     the platform's standard 409 `optimistic_lock_conflict` body. The settings
     screen renders the unified conflict banner through `useGuardedMutation`.
4. **`backend/saudi/vat-settings/page.tsx`** — the settings screen: seller
   identity, VAT rate and QR toggle, a banner while the identity is incomplete,
   and save-through-`runMutation` (the write path a `CrudForm` would own, wired
   by hand because a singleton has no list/create/delete).

### Planned

- Invoice integration: attach the payload to generated invoices and to the print
  view, and store the payload with the invoice so a reprint is byte-identical.
- Phase 2: UBL 2.1 XML, invoice hash, previous-invoice-hash chain, ICV counter,
  CSID-backed cryptographic stamp, and a clearance/reporting submission pipeline
  with an audit-trail entity.
- Hijri dates through ICU's `islamic-umalqura` calendar for display and output.

## Architecture

```
apps/mercato/src/modules/saudi_localization/
  index.ts                  module metadata (registered in apps/mercato/src/modules.ts)
  lib/saudi/vat.ts          rate, VAT-number validation, halala rounding, breakdown
  lib/zatca/qr.ts           Phase 1 TLV + Base64 payload
  lib/__tests__/            unit tests (git-vectored + independent decoders)
```

Purity is the design constraint: the module holds no entity, no DI registration
and no request handler yet, so it can be imported by the invoice pipeline, by a
CLI backfill, or by a client-side print preview without pulling in the app
runtime. Only `TextEncoder`/`TextDecoder` are used from the platform — no
`Buffer`, no `btoa`, no crypto — which keeps the code identical on the server and
in the browser.

The module is mirrored into the create-app template the way every app module is
(sources ship, `enabledModules` registration is stripped by the
`TEMPLATE_DISABLED_MODULE_IDS` transform), so a scaffold carries it disabled.

## Data Models

None in this change: the settings live in the platform's shared
`module_configs` table (module id `saudi_localization`, key `vat`, tenant-scoped),
which already provides the version column the settings screen uses.

Planned: `saudi_einvoice_submission` (`invoice_id`, `uuid`, `icv`, `invoice_hash`,
`previous_invoice_hash`, `status`, `submitted_at`, `cleared_at`, `response_jsonb`).
Amounts and hashes are stored as text to preserve ZATCA's exact serialization.

## API Contracts

`GET /api/saudi/vat-settings` → `{ sellerName, vatRegistrationNumber,
commercialRegistrationNumber, vatRate, invoiceQrEnabled, isComplete, updatedAt }`,
behind `saudi_localization.settings.view`.

`PUT /api/saudi/vat-settings` → the same shape, a full replacement, behind
`saudi_localization.settings.manage`. `400` on validation failure, `409`
`optimistic_lock_conflict` when the expected version header is stale.

Planned: `POST /api/saudi/zatca/submit`, `GET /api/saudi/zatca/submissions`.

## Integration Coverage

- **This change:** no route, endpoint or UI path exists yet, so no Playwright
  case applies. The encoding contract is pinned by unit tests:
  `lib/__tests__/zatca-qr.test.ts` (hand-built TLV vector, independent TLV reader,
  Base64 cross-check against `Buffer` at every padding length, UTF-8 byte counting
  for Arabic, error codes) and `lib/__tests__/saudi-vat.test.ts` (VAT number
  shapes, halala rounding, breakdown consistency, rejected inputs).
- **Settings phase:** integration tests for the settings endpoints plus one UI
  path (set the VAT number, generate an invoice, read the QR back).
- **Phase 2:** a stubbed ZATCA endpoint for the submission pipeline and a
  sandbox validation run before any production claim.

## Risks & Impact Review

| Risk | Severity | Area | Mitigation | Residual |
|---|---|---|---|---|
| The strict VAT-number rule (`3` + 13 digits + `3`) rejects a legitimate number | Medium | Compliance | Single validator (`isValidSaudiVatNumber`) used everywhere; a wrong number fails loudly at invoice generation instead of producing a rejected QR; relaxing it is a one-line change with tests | A number outside the documented shape cannot be issued until the rule is adjusted |
| Half-up rounding at the halala differs from ZATCA's per-line arithmetic | Medium | Money | `gross` is derived from the rounded `vat` so invoice lines always add up; the policy is documented in the module | Totals must be reconciled on the ZATCA sandbox; a halala difference is possible on multi-line invoices |
| The 255-byte TLV cap truncates nothing — it throws | Low | Data | Explicit `value_too_long` error naming the limit; sellers are not truncated silently | A 128-character Arabic seller name cannot be encoded |
| A hand-rolled Base64 encoder could be subtly wrong | Low | Encoding | Cross-checked against `Buffer.from(...).toString('base64')` at every padding length | None known |
| Phase 1 QR alone is mistaken for ZATCA compliance | Medium | Compliance | The spec separates Phase 1 (generation) from Phase 2 (clearance/reporting) and the docs will say which is present | Product messaging risk, not technical |

## Final Compliance Report

- Additive only: a new app-local module folder, one `enabledModules` entry, one
  template transform entry and the template mirror. No core package is touched, no
  API, DB schema or public contract changes, no new dependency.
- `BACKWARD_COMPATIBILITY.md`: the module has no contract surface yet; when the
  settings API lands it is additive (new routes, new ACL features).
- Validation for this change: module unit tests, `yarn typecheck`, `yarn lint`,
  `yarn generate`, `yarn template:sync`, repo-wide guards.

## Changelog

- **2026-09-25** — Module created with the ZATCA Phase 1 QR payload builder and
  the Saudi VAT primitives, both pure and unit-tested against hand-built vectors.
- **2026-09-25 (settings)** — Seller VAT settings (API + screen) over
  `module_configs`, with zod validation at the byte level, `isComplete` for the
  invoice pipeline, and optimistic locking wired the platform's way
  (`updatedAt` + extension header + the standard 409 body). 55 module tests.
  Invoice integration, Hijri dates and Phase 2 clearance remain scoped.
