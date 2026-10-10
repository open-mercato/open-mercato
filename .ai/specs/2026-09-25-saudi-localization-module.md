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
   - `GET /api/saudi_localization/vat-settings` returns the stored values merged with the
     shipped defaults (`15%`, QR on), `isComplete` and the record's `updatedAt`;
   - `PUT /api/saudi_localization/vat-settings` replaces them, validated by zod (VAT-number
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

### Implemented since (invoice integration)

5. **`data/enrichers.ts`** — the payload reaches invoice documents through the
   platform's response-enricher surface, not by reaching into the sales module:
   - `saudi_localization.zatca-invoice-qr` targets `sales:sales_order` (the sales
     order API already opts into that surface, so no core change is needed) and
     adds `_saudi_localization: { zatcaQrPayload, zatcaQrStatus }`;
   - `zatcaQrStatus` is `ready`, `qr_disabled`, `settings_incomplete` or
     `missing_invoice_data`, so a consumer can tell "the operator must open
     settings" apart from "this order has no totals";
   - gated by `saudi_localization.settings.view`, `cacheableOnListHit: false`
     (the payload depends on tenant settings and per-record totals), and
     `enrichMany` reads the settings once per batch instead of per row.

   The payload is computed, never persisted, so reprinting an invoice cannot show
   a stale code.

### Implemented since (Hijri dates)

6. **`lib/saudi/hijri.ts`** — Umm al-Qura dates for display and document output:
   `toHijriDateParts`, `formatHijriDate` and `formatDualCalendarDate`
   (`31/01/2026 (١٢/٠٨/١٤٤٧ هـ)`), read from ICU's `islamic-umalqura` calendar
   rather than a hand-rolled conversion table, with the zone defaulting to
   `Asia/Riyadh` because the calendar day depends on it (`21:30Z` is 12 Sha'ban in
   UTC and 13 Sha'ban in Riyadh). Display only: the QR timestamp and every stored
   value stay Gregorian ISO 8601, and unusable input returns `null` rather than
   throwing on a document-rendering path.

### Implemented since (QR panel)

7. **`widgets/injection/zatca-qr/`** — the QR panel on a sales order, declared for
   `sales.document.detail.order:details` through the module's
   `widgets/injection-table.ts` (the sales module needs no change; it already
   declares that surface). The panel draws the payload with `qrcode`, shows the
   payload text and the order's dual-calendar date, and turns every non-`ready`
   status into a specific message with a link to the settings screen. When the
   image cannot be drawn it still shows the payload — the payload, not the image,
   is the compliance artifact.
8. **Dependency**: `qrcode` (plus `@types/qrcode`) added to the app and to the
   create-app template, matching the version the enterprise package already pins.

### Implemented since (Phase 2 groundwork)

9. **`lib/zatca/xml.ts`** — a writer whose output is already canonical (namespaces on the
   root sorted by prefix, attributes sorted and unprefixed, C14N escaping, `<a></a>`
   instead of `<a/>`, no declaration/comment/indentation). ZATCA hashes the invoice
   *after* canonicalizing it, so producing canonical XML by construction is what keeps
   the hash reproducible; anything the writer cannot represent canonically throws.
10. **`lib/zatca/hash.ts`** — `sha256Hex`, `toZatcaInvoiceHash`, `computeInvoiceHash`,
    `resolvePreviousInvoiceHash` and `INITIAL_PREVIOUS_INVOICE_HASH`. The ZATCA
    convention is Base64 **of the hex digest**, not of the raw 32 bytes; the constant is
    derived at load time and a test asserts it equals the published first-invoice value
    (`NWZlY2Vi…`), so the two cannot drift apart.
11. **`lib/zatca/chain.ts`** — ICV/PIH sequencing behind a store port plus an in-memory
    implementation. The counter is claimed when an invoice is issued (never reused) and
    the hash pointer advances only on commit, so an abandoned issuance cannot make the
    next invoice point at an invoice that does not exist.
12. **`lib/zatca/ubl.ts`** — UBL 2.1 assembly with the element set and ordering taken from
    a working ZATCA implementation: `ProfileID`, `UUID` after `ID` (BR-KSA-03),
    `IssueDate`/`IssueTime` (KSA-25), `InvoiceTypeCode/@name` carrying the KSA-2
    transaction code (`0100000` standard, `0200000` simplified, position 5 = export),
    `AdditionalDocumentReference` for QR/PIH/ICV, `cac:Signature` (BR-KSA-29/30), the
    second `TaxTotal` for BT-110/111 and per-line tax categories with optional exemption
    codes. `buildZatcaInvoiceDocument` returns the pre-hash projection and hash (usable
    before the QR exists); `buildZatcaInvoiceXml` returns the document to send.
13. The invariant that matters is tested from both sides: two final documents differing
    only in their QR payload project to the same hash, and stripping the QR and signature
    blocks back out of a final document reproduces the exact hashed bytes. A standard
    invoice's final document hashes to its projection unchanged.
14. A real defect the new tests caught: `INITIAL_PREVIOUS_INVOICE_HASH` is derived at
    module load, so the hex-shape pattern it depends on had to move above it — a
    temporal-dead-zone crash on import, not a test artifact.

Still open before anything may be called Phase 2 compliant: the XAdES signature and CSID
onboarding, the `UBLExtensions` wrapper the signature lives in, wiring the chain store to
persistence inside the invoice pipeline, and validation against the ZATCA sandbox.

15. **`lib/zatca/chain-store.ts`** — the chain persisted through the platform's
    `module_configs` store (tenant/organization scoped, versioned, cached, no entity
    and no migration for two numbers). A stored value that cannot be read as a chain
    **throws** instead of falling back to "no chain yet": reading a corrupt chain as an
    empty one would hand out counter 1 and the chain-start hash again, forking the
    history ZATCA validates against. `peekNextInvoiceChain` answers "what would the
    next invoice carry" without claiming a counter or moving the chain.
16. **`lib/zatca/order-invoice.ts`** — the sales order → invoice mapping: VAT category
    per line (`S` when taxed; `Z`/`E` only from a ZATCA exemption code; otherwise `O`
    with `VATEX-SA-OOS`, because guessing `Z` for untaxed domestic lines misreports a
    filing), unit code from the line's UoM snapshot, issue timestamp from `placedAt`
    (falling back to `createdAt`) so a reprint cannot move it, and the seller party from
    the VAT settings the QR already reads. `buildZatcaOrderInvoice` returns the input,
    the pre-hash document, the hash, the QR payload and the invoice XML in one call.
17. **Issue date/time fix** — the invoice date and time are formatted in `Asia/Riyadh`
    (assembled from `Intl.DateTimeFormat.formatToParts`, so no locale's separators leak
    into a legal document). A 21:30 UTC invoice is now dated 00:30 the next day in
    Riyadh instead of printing the wrong day in UTC.

18. **`lib/zatca/sales-order-source.ts`** — reads a sales order into the invoice-input
    shape by foreign key id with an explicit decrypting scope (tenant **and**
    organization, never optional): an invoice that mixes organizations is worse than no
    invoice. Uses `findOneWithDecryption`/`findWithDecryption`, because an order can
    carry encrypted fields and a plain read would hand the invoice a ciphertext total.
19. **`POST /api/saudi_localization/zatca/invoice-preview`** — the first real call site for the whole
    Phase 2 stack: it loads the order, peeks the chain (claiming nothing), builds the
    document, and returns `{ status, icv, previousInvoiceHash, invoiceHash, qrPayload,
    xml, preHashXml }` with `preview: true, chainMutated: false` as literal fields in the
    response and the OpenAPI schema. It answers with the same status vocabulary the order
    panel uses (`ready` / `settings_incomplete` / `qr_disabled` / `missing_invoice_data`),
    refuses a simplified invoice while the QR is switched off (and allows a standard one,
    which needs no QR), answers 404 for another organization's order, and 422 with the
    `ZatcaInvoiceError` code when the order itself cannot be invoiced. Guarded by
    `saudi_localization.settings.view`.
20. A defect the route tests caught before it shipped: `ZatcaInvoiceError` is declared in
    `ubl.ts` and only *used* in `order-invoice.ts`, so importing it from the latter made
    `instanceof` throw inside the catch block — every mapping failure would have surfaced
    as a 500 instead of a 422.

21. **`widgets/injection/zatca-invoice-preview/`** — the preview on the order detail, and
    the manual-reporting workflow made concrete: an operator asks for the invoice, reads
    the ICV, the previous hash and the invoice hash, copies or downloads the exact UBL XML
    and files it in the Fatoora portal. Nothing renders until the button is pressed (the
    document is kilobytes of XML, and most visits to an order are not about compliance),
    it needs only the order id (the request decides the rest), and every non-ready status
    explains itself in the same vocabulary as the QR panel.

### Planned

- Wiring the dual-calendar label into invoice, HR and fiscal document templates.
- ZATCA Phase 2 (UBL 2.1 XML, invoice hash, ICV/PIH chain, CSID stamp).
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

`GET /api/saudi_localization/vat-settings` → `{ sellerName, vatRegistrationNumber,
commercialRegistrationNumber, vatRate, invoiceQrEnabled, isComplete, updatedAt }`,
behind `saudi_localization.settings.view`.

`PUT /api/saudi_localization/vat-settings` → the same shape, a full replacement, behind
`saudi_localization.settings.manage`. `400` on validation failure, `409`
`optimistic_lock_conflict` when the expected version header is stale.

Planned: `POST /api/saudi_localization/zatca/submit`, `GET /api/saudi_localization/zatca/submissions`.

Read responses: every `GET /api/sales/orders` payload carries
`_saudi_localization: { zatcaQrPayload, zatcaQrStatus }` for callers holding
`saudi_localization.settings.view`.

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

- **2026-10-10 — the settings screen offered a save it could not perform.** The page
  opened on `saudi_localization.settings.view` while the `PUT` behind it requires
  `settings.manage` (this spec's own split), so a caller holding only `view` — the
  `employee` default role — got a fully editable form whose Save answered
  `403 {"requiredFeatures":["saudi_localization.settings.manage"]}`, showed "Unable to
  save", and reverted on reload; `module_configs` had no `saudi_localization` row as a
  result. `GET` now reports `canManage` (decided by the same `rbacService` call the
  `PUT` guard makes, in the caller's own organization scope, via
  `resolveFeatureCheckContext`), and the screen renders **read-only** for a caller
  without the grant: inputs disabled, no Save control, a note saying why, and a `403`
  that names the missing permission instead of a generic failure. Read access is what
  `settings.view` promises, so nobody loses the screen. `filingFrequency`
  (`monthly` | `quarterly`, optional, default `quarterly`) was added to the record at
  the same time — it is the period the VAT return in
  [`2026-10-09-financial-saudi-plugin.md`](2026-10-09-financial-saudi-plugin.md) is
  built for, and it is a stored tenant setting rather than a constant because ZATCA
  sets the band by turnover.
- **2026-09-27 — the API URLs in this spec were wrong, and so was the code.** The route files
  declared short prefixes (`/saudi/vat-settings`) while the runtime manifest matches
  `metadata.path` verbatim, so every Saudi endpoint answered at `/api/saudi/…` and 404'd at the
  `/api/saudi_localization/…` the pages and this spec assumed. Both sides are corrected: routes
  declare `/<moduleId>/…`, pages call it, and `crud-resource-path.test.ts` now fails when a client
  string or a declared prefix disagrees with the generated manifest.

- **2026-09-25** — Module created with the ZATCA Phase 1 QR payload builder and
  the Saudi VAT primitives, both pure and unit-tested against hand-built vectors.
- **2026-09-25 (settings)** — Seller VAT settings (API + screen) over
  `module_configs`, with zod validation at the byte level, `isComplete` for the
  invoice pipeline, and optimistic locking wired the platform's way
  (`updatedAt` + extension header + the standard 409 body). 55 module tests.
  Invoice integration, Hijri dates and Phase 2 clearance remain scoped.
- **2026-09-25 (invoice integration)** — The ZATCA QR payload now ships on sales
  order responses through a response enricher on `sales:sales_order`, with an
  explicit status (`ready` / `qr_disabled` / `settings_incomplete` /
  `missing_invoice_data`) instead of an absent field. 63 module tests.
  Rendering the payload as a QR image, Hijri dates and Phase 2 clearance remain.
- **2026-09-25 (ZATCA preview endpoint)** — the Phase 2 stack got its first real call
  site: `POST /api/saudi_localization/zatca/invoice-preview` reads a sales order (scoped and
  decrypted), peeks the chain without claiming a counter, and returns the invoice XML,
  the hash and the QR payload — labelled `preview: true, chainMutated: false`. The tests
  caught a latent `instanceof` crash on an error class imported from the wrong module
  (a 500 where a 422 belonged). 157 module tests.
- **2026-09-25 (invoice preview widget)** — The preview endpoint is reachable from the
  sales order detail: an operator can read the ICV, the previous hash and the invoice
  hash, and copy or download the exact UBL XML a Saudi tax invoice would carry, which is
  the manual Fatoora-portal workflow. Nothing is issued and nothing is written. 165
  module tests.
  site: `POST /api/saudi_localization/zatca/invoice-preview` reads a sales order (scoped and
  decrypted), peeks the chain without claiming a counter, and returns the invoice XML,
  the hash and the QR payload — labelled `preview: true, chainMutated: false`. The tests
  caught a latent `instanceof` crash on an error class imported from the wrong module
  (a 500 where a 422 belonged). 157 module tests. Signed XAdES, CSID onboarding, the
  persistent issuance flow and sandbox validation remain.
- **2026-09-25 (Hijri dates)** — Umm al-Qura date helpers (parts, Hijri-only and
  dual-calendar labels) backed by ICU, pinned to `Asia/Riyadh` by default and
  documented as display-only. 75 module tests.
- **2026-09-25 (QR panel)** — The sales order detail now shows the ZATCA QR code
  itself: a widget on `sales.document.detail.order:details` renders the payload
  with `qrcode`, prints it as text, dates it in both calendars, and explains every
  non-ready status. `qrcode` added to the app and template dependencies.
  82 module tests.
- **2026-09-25 (Phase 2 groundwork)** — The deterministic base ZATCA Phase 2 needs: a
  canonical XML writer, the hash convention (Base64 of the hex digest, proven against the
  published first-invoice constant), ICV/PIH sequencing behind a store port, and UBL 2.1
  assembly carrying the sourced business-rule constants (KSA-2 transaction code, BR-KSA-03
  UUID, KSA-25 issue time, QR/PIH/ICV references, BT-110/111 second tax total). The
  QR-exclusion invariant is tested from both sides. 128 module tests (46 new).
