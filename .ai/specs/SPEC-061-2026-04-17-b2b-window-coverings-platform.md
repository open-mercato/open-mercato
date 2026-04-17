# SPEC-061: B2B Window Coverings Platform (Rolety / Żaluzje / Moskitiery / Drzwi)

## TLDR

**Key Points:**
- Umbrella spec for a B2B platform dedicated to made-to-measure window coverings (plisy, rolety, moskitiery, żaluzje, drzwi, verticale) built on Open Mercato.
- Delivers a stepper-based product **configurator**, a **width × height pricing matrix** engine with fabric groups & surcharges, customer-portal ordering with **PDF quote/order generation**, a **sales Kanban**, and **production work orders** — reusing existing `customers`, `catalog`, `sales`, `customer_accounts`, `portal`, `workflows`, and `auth` modules.

**Scope:**
- New module: `configurator` (stepper UI + dimension validation rules + configuration persistence on sales line items).
- `catalog` extension: `PricingMatrix`, `FabricGroup`, `SurchargeRule` + matrix-based price resolver.
- New module: `production_orders` (generate, print, status-track work orders from confirmed sales orders).
- `sales` extensions: Kanban UI (statuses: `submitted → confirmed → production → shipping → closed`), status history tab already exists (SPEC-059), order PDF generator.
- `customer_accounts` / `portal` extensions: B2B registration (NIP), per-customer discount %, portal order history with PDF.
- `customers` extension: `discount_percent`, `segment`, `assigned_employee_id` custom fields.
- Admin: pricing-matrix CSV upload, surcharge rule editor, dimension validation rules editor, company data for PDF branding.

**Out of scope (MVP):**
- Online payments, ERP integration, shipment tracking, invoicing, multi-language, mobile app, B2C.

**Concerns:**
- Matrix × fabric group × surcharge × customer discount creates a non-trivial pricing pipeline — needs a single deterministic resolver with audit.
- Dimension validation must be per-product (min/max, warning thresholds) and extensible (new product families shouldn't require code changes).
- PDF generation pipeline is new to the platform; must be reusable (quote + order + production order).

## Open Questions *(STOP — waiting for answers)*

Please answer before I proceed to Research/Design. Keep answers short.

- **Q1 — Delivery shape**: Do you want **(A) one umbrella SPEC-061 with implementation phases**, or **(B) umbrella SPEC-061 + 4 child SPECs (061a configurator, 061b pricing-matrix, 061c b2b-portal-ordering+pdf, 061d production-orders)**? (B is more granular, easier to parallelize; A is faster to read.)
- **Q2 — OSS vs. Enterprise**: Is this commercial (→ `.ai/specs/enterprise/SPEC-ENT-*`) or open-source (→ `.ai/specs/SPEC-*`)? Current draft assumes **OSS**.
- **Q3 — Target app**: Should new modules live in `packages/core/src/modules/` (shipped for all installations) or in `apps/mercato/src/modules/` (app-specific only)? Configurator/production-orders feel app-specific; pricing-matrix feels core. Confirm split.
- **Q4 — Pricing matrix granularity**: Is the matrix **per product** (one matrix per SKU/variant), **per fabric group** (one matrix shared by all fabrics in group I–V), or **per product × fabric group** combination? This changes the data model materially.
- **Q5 — Dimension grid rounding**: When exact (width, height) is not on a grid cell, do we **(A) round up to next cell**, **(B) linearly interpolate**, or **(C) reject with error**? Industry default is (A) — confirm.
- **Q6 — Surcharge stacking order**: When multiple surcharges apply (e.g., `+30% kaseta okleina`, `+50% lakier RAL`, `-8% prowadnice ALU`), are they **(A) additive on base** (base × (1 + 0.30 + 0.50 − 0.08)) or **(B) multiplicative** (base × 1.30 × 1.50 × 0.92)? Matters for the final price.
- **Q7 — Customer discount application**: Is the per-customer discount applied **after surcharges** (on gross line total) or **only on base price** (before surcharges)? Also: does it stack with promotions (SPEC-055) or take precedence?
- **Q8 — Configuration persistence**: Should a saved configuration be **(A) frozen JSON on the sales line item** (historical fidelity, simpler) or **(B) a reusable `ProductConfiguration` entity** referenced by line items (enables templates/re-order from history)?
- **Q9 — Kanban vs. workflows module**: Should the Kanban be **(A) a bespoke view on `sales_order.status`** (simpler) or **(B) driven by the `workflows` module** (flexible, reusable)? Existing `sales` already has statuses — confirm whether we extend them or introduce a parallel pipeline.
- **Q10 — Production order model**: Is a production order **(A) one-per-sales-order** (simpler), **(B) one-per-line-item** (per-product work order), or **(C) flexible grouping** (admin selects lines to batch)? Spec section 3.1 implies C is desired — confirm.
- **Q11 — PDF engine**: Brief mentioned React PDF / Gutenberg. Open Mercato has no PDF generator today. Preference: **(A) `@react-pdf/renderer`** (React, declarative), **(B) Puppeteer/Playwright HTML→PDF** (leverages existing UI), **(C) `pdfkit`** (imperative)? (B) reuses our React UI and has lowest template-duplication cost.
- **Q12 — B2B identity**: NIP-based registration — does the system need **VAT / VIES validation** at registration, or is NIP just a text field? Also: should registration require admin approval before first login (common in B2B)?
- **Q13 — Roles**: Do you need the 3 roles (`admin`, `sprzedaż`, `produkcja`) as **new ACL features** on top of existing `auth` roles, or mapped to existing `superadmin/admin/employee`? Recommend new features (`sales.*`, `production.*`) but reuse role infrastructure.
- **Q14 — Tenancy**: Single-tenant install (one company running the shop) or multi-tenant (platform for many window-covering manufacturers)? Affects whether we add a tenant isolation layer on top of existing `organization_id`.

---

## Overview *(to be filled after Open Questions resolved)*
## Problem Statement
## Proposed Solution
## User Stories
## Architecture
## Data Models
## API Contracts
## i18n
## UI/UX
## Configuration
## Migration & Compatibility
## Implementation Plan
## Risks & Impact Review
## Final Compliance Report

## Changelog
### 2026-04-17
- Initial skeleton with Open Questions gate.
