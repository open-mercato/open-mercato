# Configurable default quote validity (#8140)

## TLDR
Sales administrators will configure the default quote validity per organization. Quotes without a usable valid-until date and sends without an explicit number will use the same setting, initially 14 days.

## Resolved assumptions (autonomous defaults)
- Use the existing organization-scoped SalesSettings entity, command, and configuration page; a setting is one of the issue’s accepted outcomes.
- Preserve the current 1–365 day bound, explicit send overrides, and future valid-until suggestions.
- Deliver one cohesive setting; additional dialog extension mechanisms are outside this issue.

## Problem Statement
The dialog and send schema independently default to 14 and customizers cannot configure either together. The issue is an unbuilt feature on main after #7603.

## Proposed Solution
Add defaultQuoteValidityDays to sales settings and expose a guarded settings API and configuration field. Share fallback and date-suggestion helpers between server and client.

## Overview and Architecture
Extend existing SalesSettings, sales.settings.save, and /backend/config/sales. No new service, dependency, or cross-module relation. A pure sales/lib/quoteValidity helper owns the historical default (14), accepted range (1–365), and date-suggestion calculation. The existing exported page helper remains available as a re-export.

## Data Models
Add sales_settings.default_quote_validity_days integer NOT NULL DEFAULT 14. Existing rows retain behavior. Include a reversible sales-only migration and the module snapshot; do not apply to a developer database. SalesSettings already has updatedAt. No sensitive fields are added.

## API Contracts
GET /api/sales/settings/quote-validity returns { defaultQuoteValidityDays, updatedAt: string|null }. Authenticated users need either sales.settings.manage or sales.quotes.manage; reuse RBAC wildcard-aware helpers. Scope is derived from authenticated tenant and selected organization, never caller body.
PUT on that route requires sales.settings.manage; accepts { defaultQuoteValidityDays: integer 1..365 }, runs route mutation guards and sales.settings.save, and returns the same shape. The settings command preserves formats/statuses on omitted values and checks optimistic-lock headers against the loaded settings row. Existing command callers may continue omitting the new field. The first write creates the normal SalesSettings row.
POST /api/sales/quotes/send resolves the setting only when validForDays is omitted. Explicit values retain existing coercion/validation, including rejection of null/0/out-of-range values. Keep quoteSendSchema’s public output shape and historical default for direct schema callers; the route supplies the scoped configured fallback before parsing. Mutation guards see the effective validated value. Existing authentication, scoping, cancellation, token/email ordering and conflict protections remain intact.

## UI/UX
Add a Quote validity section to Sales configuration using shared CrudForm, existing section styling, number field and i18n. Load/error states use shared components; save retains server errors. CrudForm initialValues include updatedAt for automatic conflict headers; conflicts use the shared surfaceRecordConflict flow. Reload the setting after save and organization changes, discarding stale loads.
Opening Send to customer resolves current organization settings before showing the dialog. A usable future quote validUntil still suggests remaining rounded-up days (capped at 365); missing/expired/invalid dates use the setting. Failed settings reads surface the existing translated load error and leave the dialog closed, avoiding a silently different default. The input retains its current behavior with its empty-value fallback replaced by the loaded default. Dialog Escape and Cmd/Ctrl+Enter remain supported.

## Frontend Architecture Contract
Sales config remains a server page; only the new small form component is client-side for state/API interaction. The existing detail page remains a client component, importing only the pure helper (no ORM/server settings code). No new providers, global listeners, polling, bundle dependencies, or parallel page copies. Added work is one GET per dialog open and one GET for the config section; no per-render requests. Verify hydration, field editing, save/reload, keyboard controls and the scoped send request. Compare production build output when available; no intentional route/bundle/RAM budget increase beyond this small form and helper.

## Edge Cases and Failure Scenarios
- Absent settings row: 14; creating/updating unrelated settings must preserve the current value.
- Explicit API duration always wins; server default never guesses from validUntil (existing behavior).
- Stale settings version: 409 conflict without write; browser surfaces shared conflict UI.
- Organization change or document navigation during async load: ignore stale response.
- Missing scope/unauthenticated/forbidden: reject, with no write.
- Setting changes do not rewrite existing quote dates, and opening/canceling a dialog writes nothing.

## Research
Odoo also provides a company-specific Default Quotation Validity with per-document override ([official documentation](https://www.odoo.com/documentation/master/applications/sales/sales/sales_quotations/create_quotations.html)). We adopt only that narrow default/override relationship, retaining Open Mercato’s existing quote behavior and settings machinery.

## Migration & Backward Compatibility
Additive schema, route and optional command input only. Old clients, command inputs, locale keys, page helper import and explicit send values remain supported. No renames or deprecations; no UPGRADE_NOTES migration is necessary beyond normal additive migrations. SQL rollback removes only the setting and returns behavior to 14; changing the configured value back to 14 reverses the product change without data loss to quote records.

## Risks & Impact Review
Medium: incorrect scope could leak/default across organizations; mitigate server-derived scope and tests. Medium: changing the shared command could reset existing settings; update only supplied fields and regress omitted-value saves. Low: failed/stale read could show the wrong default; reject load failure and ignore obsolete responses. No production dependencies, workflow changes, or release/pipeline changes.

## Integration Coverage
Self-contained TC-SALES-8140 fixtures create/clean quotes and restore organization settings. Cover GET/PUT default/persistence/invalid input/stale token, send omitted versus explicit values with persisted validUntil, dialog fallback after changing to 30, future validUntil precedence, and settings save/reload. Unit tests cover pure date/default boundaries, command preservation/locking, route scoping/guards/error paths and the omitted-value send branch. Runtime uses the owned native ephemeral runner after the parent grants its serialized QA slot.

## Final Compliance Report
Scope is one setting entirely inside sales. Uses existing commands, guarded mutations, scoped reads and shared UI clients/forms; no shared UI edits. The additive migration contains no unrelated SQL. All new copy is present in each sales locale. Spec audit, full configured validation, review and live QA are pending and must be reported honestly before ready promotion.

## Changelog
- 2026-11-04: Autonomous design for #8140; implementation and validation pending.

## Implementation Plan
### Phase 1: Scoped setting
1. Add the field/migration/snapshot and extend the existing settings command without resetting omitted fields.
2. Add read/write API and settings UI with validation, authorization, scoping and optimistic locking.
### Phase 2: Send integration
3. Resolve the shared setting in the dialog and omitted-value send path while retaining existing date/explicit-value precedence.
4. Add regression and self-contained integration coverage; run configured validation, independent review, and live UI proof before publishing ready.
