# Form Module Requirements — dental-os ⇄ Form Studio

**Date**: 2026-05-21
**Status**: Draft for vendor review
**Owner**: dental-os team (ExcelMed)
**Audience**: Form Studio development team

---

## TLDR

dental-os needs an external **form package** to author, deliver, and collect
**patient-facing forms** — primarily **new-patient intake / medical history** and
**consent & legal forms (with e-signature)**. Forms are filled out **by patients in
the customer portal** and **via public anonymous links** (e.g. waiting-room tablet
or QR code). Because these forms collect **special-category health data under GDPR
Art. 9**, the compliance, encryption, and audit requirements below are
**hard requirements**, not nice-to-haves.

This document lists what we need so the Form Studio team can respond to each
requirement with **Yes / Partial / No / Roadmap**, and advise on the preferred
**integration model** (Section 7 lists two candidate models with trade-offs).

---

## 1. Context — what dental-os is

- dental-os is a **multi-tenant dental practice platform** built on the
  **Open Mercato** framework (Next.js App Router, TypeScript, MikroORM, Awilix DI,
  Zod). One deployment serves **many clinics** (tenants/organizations).
- Every piece of data is scoped by **`tenant_id`** and **`organization_id`**.
  A form, a submission, or a template from one clinic must **never** be visible to
  another clinic.
- Patients access the system through a **customer portal** (authenticated) and
  occasionally through **unauthenticated public links**.
- The platform already enforces **per-tenant encryption** of PII, **RBAC** (feature-
  based authorization), and **i18n** (at minimum **Polish + English**).
- The form module is expected to behave as a **first-class citizen** of this
  platform, or to integrate cleanly with it (see Section 7).

> **Primary jobs to be done**
> 1. A clinic builds a "New Patient Medical History" form once and reuses it.
> 2. A patient receives a portal task or a public link, fills it on a phone/tablet,
>    and signs the consent.
> 3. The clinic sees the structured answers + a tamper-evident signed consent
>    record attached to that patient.

---

## 2. Form authoring (clinic-side)

| ID | Requirement | Priority |
|----|-------------|----------|
| FA-1 | A **visual form builder** (no code) usable by clinic staff to create and edit forms. | Must |
| FA-2 | **Reusable templates** — a clinic can clone/version a form (e.g. "Medical History v3"). | Must |
| FA-3 | **Form versioning** — published versions are immutable; submissions must record **which version** was answered. | Must |
| FA-4 | **Field types** at minimum: short/long text, number, date, single-select, multi-select, checkbox, yes/no, file/photo upload, section/heading, static rich-text (instructions), and **signature**. | Must |
| FA-5 | **Conditional logic / branching** (show field B only if answer A = yes) — essential for medical-history follow-ups (e.g. "Are you taking medication?" → list them). | Must |
| FA-6 | **Multi-page / multi-step** forms with progress indication. | Should |
| FA-7 | **Validation rules** per field (required, regex, min/max, date ranges) expressed declaratively. | Must |
| FA-8 | **Repeatable groups** (e.g. add N medications, N allergies). | Should |
| FA-9 | **Field-level metadata** to mark a field as **PII / sensitive** so it can be routed to encryption (see Section 5). | Must |
| FA-10 | Forms and all their labels/help text are **translatable** (PL/EN minimum); a patient sees the form in their language. | Must |
| FA-11 | Pre-defined **dental/medical field library** (allergies, medications, conditions, ICD-style pick lists) would be valuable. | Nice |

---

## 3. Form delivery & filling (patient-side)

| ID | Requirement | Priority |
|----|-------------|----------|
| FD-1 | **Patient portal rendering** — render a form inside our authenticated customer portal, pre-filling known patient data where possible (name, DOB) and binding the submission to the logged-in patient. | Must |
| FD-2 | **Public anonymous links** — generate a shareable link / QR code that opens the form **without login** (waiting-room tablet, pre-visit email). | Must |
| FD-3 | Public links must support **expiry, single-use vs reusable, and per-link tenant scoping**, and must be **revocable**. | Must |
| FD-4 | **Mobile-first / tablet-friendly** rendering; touch signature capture. | Must |
| FD-5 | **Save & resume** a partially completed form (especially long medical histories). | Should |
| FD-6 | **Accessibility** — WCAG 2.1 AA: keyboard navigation, screen-reader labels, sufficient contrast. | Must |
| FD-7 | **Anti-spam / abuse protection** on public links (rate limiting, optional CAPTCHA) without harming UX. | Should |
| FD-8 | Confirmation/receipt to the patient after submission. | Should |
| FD-9 | **Offline-tolerant** filling on a tablet with poor connectivity (buffer + submit on reconnect). | Nice |

---

## 4. Consent, e-signature & legal records

These apply specifically to the **consent & legal** form category.

| ID | Requirement | Priority |
|----|-------------|----------|
| CN-1 | **E-signature capture** (drawn signature and/or typed-name + explicit affirmation checkbox). | Must |
| CN-2 | **Tamper-evident signed record** — once signed, the consent (form version + answers + signature + timestamp) is **immutable**; any later change creates a new record, never an in-place edit. | Must |
| CN-3 | **Audit trail** per signed consent: who signed, **UTC timestamp**, IP / device, the **exact form version and content** presented at signing time, and the consent statement text. | Must |
| CN-4 | **Re-consent / expiry** — a consent can be marked as superseded; the system tracks consent **history** per patient. | Should |
| CN-5 | **Exportable signed document** (PDF) reproducing exactly what the patient saw and signed, suitable for legal/regulatory retention. | Must |
| CN-6 | Alignment with **eIDAS** simple electronic signature expectations (we are not asking for qualified signatures, but the record must stand up as evidence). | Should |
| CN-7 | Ability to attach a signed consent to a **patient record** and to a **specific visit/treatment** in dental-os. | Must |

---

## 5. Data protection, GDPR & compliance (hard requirements)

> Medical history and consent data are **special-category personal data (GDPR
> Art. 9)** processed in the **EU**. The module must support our compliance
> obligations; we cannot adopt a module that cannot meet these.

| ID | Requirement | Priority |
|----|-------------|----------|
| DP-1 | **Encryption at rest** for all submission data containing PII / health data. Field-level or record-level, with **per-tenant key isolation**. Plaintext PII must never be persisted unencrypted "for now". | Must |
| DP-2 | **Encryption in transit** (TLS) for all endpoints. | Must |
| DP-3 | **EU data residency** — submission data stored and processed within the EU; clear statement of where data lives. | Must |
| DP-4 | **Right to erasure (Art. 17)** — a documented, callable mechanism to **delete or anonymize** all data for a given patient on request. | Must |
| DP-5 | **Right of access / portability (Art. 15/20)** — export a patient's submissions in a structured, machine-readable format. | Must |
| DP-6 | **Retention policy support** — per-form configurable retention; automatic purge after retention window. | Should |
| DP-7 | **Audit logging** of access to submissions (who viewed/exported what, when). | Must |
| DP-8 | **PII must never leak into logs**, error traces, analytics, or third-party tooling. (We enforce this elsewhere in dental-os and require the same here.) | Must |
| DP-9 | **DPA (Data Processing Agreement)** available; clear sub-processor list. | Must |
| DP-10 | If any AI/LLM features process submission content, that processing must be **disclosed, EU-resident, and opt-in**, and **not used for model training**. | Must |
| DP-11 | **Consent-statement versioning** is retained for the legally required period even if the form is later changed (ties to CN-2/CN-3). | Must |

---

## 6. Security & multi-tenancy

| ID | Requirement | Priority |
|----|-------------|----------|
| SEC-1 | **Strict tenant isolation** — every form, template, submission, file upload, and public link is scoped to one clinic; cross-tenant access is impossible by construction. | Must |
| SEC-2 | **Feature/permission-based authorization (RBAC)** for staff actions (create form, view submissions, export, delete). We use feature flags like `<module>.view` / `<module>.manage`, not role names. | Must |
| SEC-3 | Patient (portal) authentication is **separate** from staff authentication; a portal patient can only see their own submissions. | Must |
| SEC-4 | **File uploads** (e.g. photos of medication boxes) are virus-scanned, size/type-limited, and stored with the same tenant isolation + encryption guarantees. | Should |
| SEC-5 | All write operations are **server-validated** (we use Zod schemas); no trust in client-only validation. | Must |
| SEC-6 | Public-link endpoints are **hardened** (no enumeration of links/submissions, signed/opaque tokens). | Must |

---

## 7. Integration model — **two candidate options (please advise)**

We have not decided how tightly the module integrates with Open Mercato. We would
like the Form Studio team's recommendation. Below are the two models and their
trade-offs **as we see them**.

### Option A — Deep native Open Mercato integration

The form module ships as (or is wrapped as) an **Open Mercato module** and uses the
platform's canonical primitives directly.

- Multi-tenancy via the platform's `tenant_id` / `organization_id` scoping.
- PII encrypted via the platform's **per-tenant encryption maps** (declarative
  field-level encryption with per-tenant DEKs / KMS-backed keys).
- Authorization via the platform's **RBAC feature flags**.
- UI rendered with the platform's portal/admin component system; i18n via the
  platform's translation mechanism.
- Cross-module communication via the platform's **typed event bus** (e.g. emit
  `form.submission.created` that dental-os subscribers consume to attach the
  submission to a patient/visit).
- Storage in the **same database**, governed by the same migrations.

**Pros**: native encryption/tenancy/RBAC/i18n for free; submissions live next to
patient records; single audit/erasure surface; consistent UX; no data duplication.
**Cons**: tighter coupling to Open Mercato APIs and release cadence; vendor must
build to our framework conventions; harder to reuse the module on non-OM stacks.

**What we'd need the vendor to confirm for Option A**: ability to declare entities
with our scoping columns, hook into encryption maps, expose feature flags, emit/
consume events, and render in portal/admin via our component primitives.

### Option B — Standalone module with API + webhook bridge

Form Studio runs largely as its **own service / SaaS**; dental-os integrates via a
**REST API + webhooks**, and we map data into our own entities.

- We call the vendor API to list forms, generate public links, fetch submissions.
- The vendor fires **webhooks** on submission/signature; we ingest and store the
  parts we need on our side.
- The vendor enforces its own tenancy/encryption/residency; we map our clinic →
  vendor "workspace/tenant".

**Pros**: clean separation; vendor owns the builder UX and upgrades independently;
faster to adopt; reusable across stacks.
**Cons**: **data lives in two places** (compliance/erasure must be coordinated on
both sides — see DP-4/DP-7); we must build an ingestion + mapping layer; tenant
mapping and access control must be airtight; PII crosses a service boundary
(needs DPA + EU residency, DP-9/DP-3); webhook security and replay handling on us.

**What we'd need the vendor to confirm for Option B**: a documented, versioned REST
API + webhook contract; per-tenant API credentials and workspace isolation; signed
webhooks; bulk export and **per-patient delete/anonymize** API (for DP-4); rate
limits; sandbox environment.

> **Decision pending.** Please indicate which model Form Studio supports today,
> which is recommended, and the effort/limitations of each. Hybrids are welcome
> (e.g. vendor-hosted builder, self-hosted rendering + storage).

---

## 8. Integration touch-points dental-os needs (model-agnostic)

Regardless of Option A or B, dental-os must be able to:

| ID | Requirement | Priority |
|----|-------------|----------|
| INT-1 | **Bind a submission to a patient** in dental-os (by patient ID for portal flows; by matching/identity rules for anonymous flows). | Must |
| INT-2 | **Notify dental-os** when a form is submitted/signed (event or webhook) so we can update tasks, attach records, trigger workflows. | Must |
| INT-3 | **Trigger a form to a patient** programmatically (create a portal task / generate a public link from a dental-os workflow, e.g. "send intake before first visit"). | Must |
| INT-4 | **Read structured answers** in a stable, typed schema for downstream use (populate medical alerts, allergy flags). | Must |
| INT-5 | **Map answers → dental-os fields** (e.g. allergies answer updates the patient's allergy list). Mapping should be configurable. | Should |
| INT-6 | **Idempotent ingestion** — re-delivered events/webhooks must not create duplicates. | Must |
| INT-7 | A **sandbox / test mode** for development without touching production data. | Must |

---

## 9. Non-functional requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| NFR-1 | **i18n**: Polish and English at launch; ability to add locales. | Must |
| NFR-2 | **Performance**: portal/public form first paint < ~2s on mobile; submission ack < ~1s. | Should |
| NFR-3 | **Availability**: target ≥ 99.9%; status page; maintenance windows communicated. | Should |
| NFR-4 | **Browser/device support**: current Chrome/Safari/Firefox/Edge; iOS Safari + Android Chrome for tablets/phones. | Must |
| NFR-5 | **Versioned, documented API** (if Option B) with backward-compatibility policy. | Must |
| NFR-6 | **Observability**: we can trace a submission end-to-end without exposing PII. | Should |
| NFR-7 | **Licensing / pricing model** clear (per tenant? per submission? per seat?) and compatible with multi-clinic SaaS. | Must |
| NFR-8 | **Support & SLA**, security contact, and **vulnerability disclosure** process. | Should |

---

## 10. Open questions for the Form Studio team

1. Which **integration model** (Section 7) do you support today, and which do you
   recommend for a GDPR-regulated, multi-tenant dental SaaS?
2. How is **encryption at rest** handled, and can keys be **isolated per tenant**?
   Can encryption be scoped at the **field level** for PII (FA-9 / DP-1)?
3. Where is data **stored/processed** geographically? Can EU residency be guaranteed
   (DP-3)?
4. What is your **right-to-erasure** mechanism (DP-4) and how is it exposed (UI /
   API)? Does it cover backups?
5. How are **public anonymous links** secured, expired, and revoked (FD-2/FD-3,
   SEC-6)?
6. What is the **legal/audit standing** of your e-signature records (CN-2/CN-3/CN-5),
   and can we export a signed PDF of exactly what the patient saw?
7. Do you support **conditional logic**, **multi-step**, **repeatable groups**, and
   **save & resume** (FA-5/FA-6/FA-8/FD-5)?
8. Is there a **DPA** and a current **sub-processor list** (DP-9)? Any AI processing
   of submissions (DP-10)?
9. What does **submission/webhook** delivery look like — schema, retries, signing,
   idempotency (INT-2/INT-6)?
10. **Pricing, SLA, sandbox, and security disclosure** process (NFR-7/NFR-8/INT-7)?

---

## 11. How to respond

For each requirement ID above, please mark one of:
**Yes (in product)** · **Partial (limitations — describe)** · **No** · **Roadmap (with ETA)**.
Flag anything that is **not possible** in your architecture so we can assess fit
early — the **Section 5 (GDPR)** and **Section 6 (multi-tenancy)** items are
**gating** for us.

---

## Changelog

| Date | Change |
|------|--------|
| 2026-05-21 | Initial requirements draft for Form Studio vendor review. Scope: patient-facing intake/medical-history + consent/legal forms; portal + public-link delivery; both integration models documented for vendor advice. |
