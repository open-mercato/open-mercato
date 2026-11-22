# LeanDispatcher feature parity — gap matrix and program plan

**Created:** 2026-11-21
**Status:** Active — Phases 1–5 core implemented; Phase 6 partial; provider-gated items pending
**Source of truth for the comparison:** LeanDispatcher marketing site
(`https://leandispatcher.ertikaz-tech.com/`, feature copy extracted from its production JS
bundle), its App Store listing, and a read-only audit of this repository on 2026-11-21.

## TLDR

Our freight vertical already covers most of LeanDispatcher's commercial and financial
backbone: order lifecycle, contracts and rates, trips, customer-approved abstracts,
invoicing, payments, fleet maintenance, ZATCA e-invoicing, Arabic RTL and RBAC. The gaps are
the **dispatch-product layer**: delivery notes/waybills, the driver workflow, live tracking
and route optimization, customer self-service order intake, automated customer messaging
and driver ratings.

Phase 1 (this change) closes the most visible document gap with a first-class delivery note
and a manual Bayan Naql reference. The remaining phases are ordered below; several depend on
external providers (TGA/Bayan, SMS, maps, telematics) and are explicitly gated.

## How to read the matrix

- **Shipped** — present in this repository and usable today.
- **Partial** — the data/API exists but the product loop or UI is incomplete.
- **Missing** — no implementation found.
- **External gate** — the code can be built, but activation needs a provider account,
  credentials or an approval we do not have.

## Feature matrix

### Orders and dispatch

| LeanDispatcher capability | Our status | Evidence / gap |
|---|---|---|
| Single order creation with cargo, route, dates, price | **Shipped** | `freight_operations` `FreightOrder` + create/edit form |
| Order statuses: confirm → assign → dispatch → deliver → complete → invoice | **Shipped** | `commands/orders.ts` |
| Assign driver + vehicle, availability and overlap checks | **Shipped** | `orders.assign`, `lib/assignment.ts` |
| Bulk order creation from Excel/CSV | **Shipped (Phase 2)** | Customer-scoped dry-run/commit importer |
| Customer-created orders (“External Orders” review queue) | **Shipped (Phase 2)** | Portal submit + `/backend/freight/external-orders` review queue |
| Trips auto-created from orders | **Shipped (Phase 2b)** | Confirming an order auto-creates a linked trip with assignment mirroring; a setting keeps the manual workflow |
| Dispatching to own or contracted fleet | **Partial** | Own fleet assignment exists; subcontractor/carrier master does not |
| Long-term contracts with negotiated per-route rates | **Shipped** | `FreightContract` + `FreightContractRoute` |
| Vehicle types and plates | **Partial** | Plates are first-class and unique; vehicle type is free text |
| Bulk driver/vehicle upload | **Missing** | No import path |
| Products with weight/package units | **Partial** | Catalog has weight/dimensions/units; no package hierarchy; freight cargo is free text |
| Order sealing | **Partial** | Seal number captured on the delivery note; no order/trip seal lifecycle |
| Late/completed trips visually flagged | **Partial** | Statuses exist; no lateness calculation or colour rule |
| Dashboard totals (orders, trips, vehicles, waybills) | **Partial** | Freight/transport/fleet dashboards exist; no waybill KPI yet |

### Delivery notes and compliance

| LeanDispatcher capability | Our status | Evidence / gap |
|---|---|---|
| Delivery note / transport document generated from an order or trip | **Shipped (Phase 1)** | `FreightDeliveryNote`, state machine, API, list/detail, print layout |
| Numbered document with seller, consignee, cargo, lane, driver and vehicle snapshots | **Shipped (Phase 1)** | Snapshots frozen at issue |
| POD/POP reference on the document | **Shipped (Phase 1)** | References and attachment ids; upload UI still missing |
| Bayan Naql waybill number, status and link | **Partial (Phase 1)** | Manual recording; no TGA API submission |
| Direct Bayan/TGA API integration | **External gate** | Needs TGA approval and credentials; adapter seam is ready |
| TGA/Bayan logos on documents | **Intentionally not used** | No authorisation to reproduce official marks |
| Print / hand-over receipt | **Shipped (Phase 1)** | Browser print layout with signature lines |
| Public share link for a document | **Missing** | Attachments/documents have no anonymous share token |

### Driver workflow

| LeanDispatcher capability | Our status | Evidence / gap |
|---|---|---|
| Dedicated driver app (Android/iOS) | **Partial (Phase 3)** | Staff-linked driver PWA at `/backend/driver`; no native shell/offline |
| Driver sees assigned deliveries and navigates to pickup/drop-off | **Partial (Phase 3)** | Assigned orders/trips list exists; navigation links are not shipped |
| Driver changes order status from the road | **Shipped (Phase 3)** | Driver start/deliver actions with ownership checks |
| Driver checklist with required attachments | **Missing** | No checklist model |
| POD/POP photo, signature, voice note or video capture | **Partial** | Fields accept attachment ids; no capture/upload flow |
| Rest breaks / hours of service | **Partial (Phase 3)** | Rest break start/end records; HOS rules not modelled |
| SOS | **Shipped (Phase 3)** | Driver alert with optional geolocation; dispatch notification wiring remains |
| Driver–dispatcher chat and calls | **Partial** | WhatsApp/email hub and call ingestion exist; not wired to freight |
| Driver rating by customer | **Shipped (Phase 5)** | `FreightDriverRating` + portal rate action |

### Tracking and routing

| LeanDispatcher capability | Our status | Evidence / gap |
|---|---|---|
| Live fleet map (“Eagle Eye”) | **Partial (Phase 4)** | Leaflet board at `/backend/transport/tracking` over latest positions |
| GPS/telematics ingestion, geofencing | **Partial (Phase 4)** | Position ingestion + store; geofences/retention remain |
| Route optimization and ETAs | **Partial (Phase 4)** | Local Haversine + optional OSRM estimate API; multi-stop optimization and geocoding remain |
| Predictive operational alerts | **Missing** | Dashboards only |
| Real-time status visibility for staff | **Partial** | SSE/DOM event bridge exists; freight events are not marked for broadcast |

### Customer experience

| LeanDispatcher capability | Our status | Evidence / gap |
|---|---|---|
| Customer portal to raise and schedule orders | **Shipped (Phase 2)** | Portal submit endpoint + External Orders queue |
| Customer order approval queue (“External Orders”) | **Shipped (Phase 2)** | Submitted → approved/rejected review queue at `/backend/freight/external-orders` |
| Customer tracking link | **Shipped (Phase 5)** | `/track/<token>` public status page + copy action |
| Customer views contracts and invoices | **Missing** | Program spec aspires to it; only abstracts shipped |
| Customer approves/disputes trip abstracts | **Shipped** | `api/portal/freight/abstracts/*` + portal pages |
| Automated customer SMS/WhatsApp on delivery time, bill, waybill | **Partial** | WhatsApp adapter + notifications exist; no freight subscriber, no SMS adapter |
| Instant document sharing via SMS/WhatsApp/link | **Partial (Phase 5)** | Order tracking links ship; public delivery-note links and messaging remain |
| Driver rating / feedback | **Shipped (Phase 5)** | 1–5 star rating after delivery, portal display |
| Multilingual customer/driver app (AR/EN/UR/HI/ZH) | **Partial** | App serves en/ar; module dictionaries have de/es/ko/pl; no UR/HI/ZH |

### Finance, inventory and platform

| LeanDispatcher capability | Our status | Evidence / gap |
|---|---|---|
| ZATCA e-invoicing (Phase 2 issuance, VAT) | **Shipped** | `saudi_localization` + financial posting; signing/CSID gated |
| Invoices, receipts, credit/debit notes, receipt vouchers | **Partial** | Sales invoices + credit memos + AP; freight has no credit/debit-note path; no receipt voucher document |
| Automatic billing and settlement | **Shipped** | Freight abstracts → sales invoice → payments → AR aging |
| Customer statements | **Shipped** | `financial` AR statements |
| Inventory, warehouses | **Shipped** | Core `wms` (inventory, lots, movements, locations) |
| Purchasing / purchase orders | **Missing** | WMS phase 2 is still draft; no procurement module |
| Sales | **Shipped** | Core `sales` |
| Expenses | **Partial** | AP vendor-invoice expense lines; no expense-claim module |
| Fleet maintenance / fuel / insurance / violations | **Shipped** | `fleet_operations` |
| 11 currencies / multi-currency | **Partial** | 11 seeded currencies incl. SAR; FX still posts at rate 1 |
| Per-user permissions | **Shipped** | Role + user ACLs, feature wildcards |
| Customisable field labels | **Partial** | Custom fields carry labels; built-in UI labels are not tenant-renamable |
| API integrations with ERPs | **Shipped** | API keys, OpenAPI, webhooks, `data_sync` |
| Secure cloud hosting | **Platform** | Deployment concern, not a module feature |
| Modular build | **Shipped** | Module system |

## Phase plan

### Phase 1 — Delivery notes and Bayan Naql reference (shipped in this change)

- `FreightDeliveryNote` entity + migration + snapshot.
- Create from a confirmed/executed spot order or a freight trip.
- Draft → issued → delivered / cancelled state machine with optimistic locking.
- Seller, driver and vehicle snapshots frozen at issue.
- POD/POP reference and receiver capture.
- Manual Bayan Naql number/status/link recording; cancellation blocked while the external
  waybill is live.
- Numbering prefix setting, ACL feature, events, six-locale i18n, list/detail pages, print
  layout, order and trip detail panels, unit + integration coverage.

### Phase 2 — Order intake parity (shipped 2026-11-21)

1. Bulk order import (CSV/XLSX) with dry-run → commit, mirroring the contract-rate importer.
2. Customer/portal order submission with a staff “External Orders” review queue
   (`submitted` → `approved`/`rejected`), reusing portal auth and RBAC.
3. Auto-create a draft freight trip (and optionally a delivery note) when an order is
   confirmed, with a setting to keep the manual workflow.
4. Publish the missing order fields in the list projection (POD received-by/at, notes,
   requested delivery, invoice number) and enforce the documented POD rule on `complete`.

### Phase 3 — Driver workflow (PWA core shipped 2026-11-22)

1. Driver identity: link `transport_drivers` to a staff user or a new driver credentials
   model; decide staff-user vs dedicated driver auth with the product owner.
2. Driver console (mobile-first PWA) or native shell: assigned trips, navigation links,
   status updates, rest breaks, SOS.
3. Checklist templates with required attachments per item.
4. POD/POP capture (photo, signature, document) writing attachment ids.
5. Driver notifications through push (devices + APNS/FCM/Expo already exist).

### Phase 4 — Tracking and routing (core shipped 2026-11-22)

1. Telematics ingestion adapter (provider-agnostic, SSRF-safe webhooks), vehicle positions,
   trip actuals and odometer reconciliation.
2. Operations map board (“Eagle Eye”) over Leaflet, with vehicle/trip filters and last-seen
   state.
3. Geofence and lateness alerts; mark freight events `clientBroadcast` for live refresh.
4. Route optimization/ETA adapter behind a provider interface (Google Routes, OSRM or
   equivalent); keep the provider choice and key external.

### Phase 5 — Customer experience

1. Portal order creation, tracking, contract/invoice views and delivery-note download.
2. Tokenised public tracking page for customers without a portal account.
3. Automated event-driven customer messages (SMS/WhatsApp) for assignment, dispatch,
   delivery ETA and waybill sharing; requires an SMS provider and template management.
4. Document share links with expiring tokens.
5. Driver rating and customer feedback on delivered orders.

### Phase 6 — Remaining parity and polish

1. Freight credit/debit notes and receipt vouchers, reusing the sales credit-memo contract.
2. Add SAR (and the other Gulf currencies LeanDispatcher lists) to the currency seed.
3. Purchasing/PO and a lightweight expense-claim module, or an explicit decision to use AP
   vendor invoices only.
4. Product/package links on freight orders (catalog product + package units).
5. Bulk driver/vehicle import.
6. Tenant-renamable built-in labels and additional locales (UR/HI/ZH) if the market needs
   them.

## External gates

| Gate | Needed for | Owner |
|---|---|---|
| TGA Bayan API approval, credentials and sandbox | Direct waybill issuance/cancellation | Business/compliance |
| SMS provider account (e.g. Unifonic/Msegat/Twilio) | Automated customer messages | Business + new provider package |
| Maps/routing provider key | Geocoding, ETAs, route optimization | Business |
| Telematics provider selection | Live GPS, geofencing | Business |
| Native app vs PWA decision | Driver mobile surface | Product |
| Local legal confirmation | Any statutory document wording | Counsel |

## Recommendation

The core dispatch loop (intake → trip → delivery note → tracking → rating) is now in place.
The next slice is Phase 6: freight credit/debit notes, purchasing/expenses, product/package
links and bulk driver/vehicle import. Geofencing and predictive alerts complete Phase 4, and
the provider-gated work (TGA Bayan, SMS, maps key, telematics) should start only once the
corresponding business approvals are in hand.

## Changelog

- **2026-11-21** — Initial matrix and phase plan; Phase 1 delivery notes implemented.
- **2026-11-21 (later)** — Phase 2 shipped: bulk order import with dry-run/commit, customer
  portal order submission, external-order review queue, order `source`/`submitted_at`.
  Auto-created trips and the POD-on-complete fix remain in Phase 2b. Validation: TC-FREIGHT-011
  and TC-FREIGHT-012 pass; typecheck, lint, i18n sync, unit tests and the app build are green.
- **2026-11-22** — Phase 3 PWA core shipped: staff-linked driver identity, `/backend/driver`
  workspace, start/deliver, rest breaks, SOS, manifest/service worker. Phase 4 core shipped:
  vehicle position ingestion, Leaflet tracking board with late flags, local/OSRM routing
  estimate. TC-FREIGHT-013 and TC-TRANSPORT-014 pass.
- **2026-11-22 (later)** — Phase 2b shipped: optional auto-trip on confirm with assignment
  mirroring, POD gate on completion, delivered-order POD update. Phase 5 core shipped: public
  tracking token/page, driver ratings in the portal. Phase 6 partial: SAR added to the currency
  seed. TC-FREIGHT-015/016/017 cover the new paths.
- **2026-11-22 (validation)** — Final slice verified: TC-FREIGHT-015/016/017 pass; new
  `deliveryNote`/`orderImport`/`documentNumber` and transport `routing` unit suites pass;
  `yarn typecheck`, `yarn lint`, `yarn i18n:check-sync` and `yarn build:app` are green. Lint
  surfaced a conditional `useCallback` in the order-detail tracking-link action, now moved above
  the loading/error early returns.
