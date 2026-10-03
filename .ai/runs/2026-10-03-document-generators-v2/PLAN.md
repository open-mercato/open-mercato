# Document Generators implementation

Source doc: .ai/specs/2026-08-10-document-generators.md
Source spec: .ai/specs/2026-08-10-document-generators.md
Spec PR: https://github.com/open-mercato/open-mercato/pull/5323
Branch: feat/document-generators-v2
Base: develop (7f0ebf6539)
Status: in-progress
Engine: om-auto-create-pr-loop (steps: 35, --loop: no)

## Tasks

Authoritative status table. The first non-done row is the resume point. Step IDs and Exec placements are immutable. Commit hashes are reconciled at checkpoints to avoid self-referential commit hashes.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 1 | 1.1 | Package scaffold and module metadata | dispatch | done | 1a830e59d |
| 1 | 1.2 | ACL setup and engine translations | dispatch | done | 1d67c0f9d |
| 2 | 2.1 | Shared template contracts and base service | dispatch | done | 129c8e2e4 |
| 2 | 2.2 | Template registry | dispatch | done | 69f48e8e9 |
| 2 | 2.3 | Template authorization policy | dispatch | done | 6c2724a9f |
| 2 | 2.4 | Generator discovery and bootstrap | dispatch | done | 2c729fb9e |
| 3 | 3.1 | PDF rendering adapter | dispatch | done | 42a05aba2 |
| 3 | 3.2 | Markdown renderer and format dispatch | dispatch | done | f4e0fd28c |
| 3 | 3.3 | Document utility barrel | dispatch | done | e894f7283 |
| 3 | 3.4 | PDF authoring toolkit | dispatch | done | 1f0e7bd9e |
| 4 | 4.1 | Quote data service | dispatch | done | fad1ca91f |
| 4 | 4.2 | Sales offer PDF template | dispatch | done | 53ecc0ab7 |
| 4 | 4.3 | Order data service | dispatch | done | 18bf8a26a |
| 4 | 4.4 | Order PDF and Markdown templates | dispatch | done | 0ec18287c |
| 5 | 5.1 | API validators and response helpers | dispatch | done | 23ae21dca |
| 5 | 5.1-review-fix | Selected organization scope resolution | inline | done | 8e2c5c917 |
| 5 | 5.2 | Template catalogue and facet endpoints | dispatch | done | 7d5ff252c |
| 5 | 5.3 | Preview endpoint | dispatch | done | aa784f1bc |
| 5 | 5.4 | History entity encryption and migration | dispatch | done | 145b7c2dc |
| 5 | 5.5 | History persistence and read service | dispatch | done | ed19020b3, 05cf126d8 |
| 5 | 5.6 | Generate endpoint and mutation guards | dispatch | done | cbc9d9275 |
| 5 | 5.7 | History endpoint | dispatch | done | 59d63226c |
| 6 | 6.1 | React Query data hooks | dispatch | done | f518ea49f |
| 6 | 6.2 | Template cards and preview dialog | dispatch | done | 5e6d83919 |
| 6 | 6.2-review-fix | Allow Blob PDF preview frames in CSP | inline | done | — |
| 6 | 6.3 | Backend overview and catalogue pages | dispatch | done | ffde74b0e |
| 6 | 6.4 | Shared history table and backend page | dispatch | done | 4dee2f319 |
| 6 | 6.5 | Sales document tabs and scoped history | dispatch | done | 10c8138ca |
| 7 | 7.1 | Core integration and browser coverage | dispatch | done | fe02a4262 |
| 8 | 8.1 | Retention and erasure contract | inline | done | 20f82cad2 |
| 8 | 8.2 | Private attachment persistence | inline | done | 201594092 |
| 8 | 8.3 | Stored document download | inline | done | c506a70f9 |
| 9 | 9.1 | Template versioning | inline | done | — |
| 9 | 9.2 | Draft watermark | inline | done | — |
| 10 | 10.1 | Documentation examples and harness coverage | inline | done | — |
| 10 | 10.2 | Full validation and design system verification | inline | todo | — |
| 10 | 10.3 | Authoritative review and UI evidence | inline | todo | — |

## Goal

Deliver the complete Document Generators spec in a separate implementation PR, including PDF/Markdown rendering, Sales templates, authorization, history, private storage, versioning, draft watermark, tests and browser evidence.

## Scope

New document-generators workspace; neutral shared contracts; Sales-owned integrations; additive generator/bootstrap wiring; docs and standalone template/harness wiring as required. All source-spec phases remain in scope.

## Non-goals

Email delivery, public sharing links, bulk generation, event-triggered generation and aggregate documents remain outside this spec. No old PR #5170 implementation is resurrected or cherry-picked.

## Decisions and risks

- Existing feat/document-generators is the closed implementation; use a fresh v2 branch from synchronized develop.
- User approved retention without automatic expiry; deleting source data deletes generated files and anonymizes history. Template versions are defined in code, latest by default with explicit older-version selection and used version recorded in history.
- Renderer dependency is explicitly required by the authorized spec. No local database migration application is authorized.
- History service constructor exception requires explicit final review signoff per spec.
- Review sign-off required: `GenerationHistoryService` is constructed with `new GenerationHistoryService(em)` per request (spec constructor exception, deliberately not in DI); the Step 10.3 reviewer must confirm this or require DI registration.
- Source statuses and attachment APIs must be verified against current develop before dependent code.
- User-facing and shared/schema changes require risk-high, needs-qa; automatic QA evidence does not grant qa-approved.
- Runner: local (no running Docker app). Node 24.13.1, Yarn 4.17.1.

## Implementation Plan

### Step 1.1: Package scaffold and module metadata

Add package/build/tsconfig/Jest wiring and module metadata using current workspace conventions. Keep runtime optional; add scaffold checks.

### Step 1.2: ACL setup and engine translations

Declare documents.view/generate features and role defaults; seed engine dictionaries in all shipped locales, with tests.

### Step 2.1: Shared template contracts and base service

Implement neutral contracts and BaseDocumentService as specified; require filenames and canonical identity; test normalization/binding.

### Step 2.2: Template registry

Implement globalThis registry, atomic duplicate rejection, filtered localized projections, required authorized facets and scoped loading; test each contract.

### Step 2.3: Template authorization policy

Use rbacService with auth scope, fail closed, omit/reject split, per-feature-set request cache; test wildcard delegation and missing subject.

### Step 2.4: Generator discovery and bootstrap

Add type-only generator plugin document_generators.templates, module convention scanning and bootstrap wiring; run generator and test deterministic discovery/disabled module.

### Step 3.1: PDF rendering adapter

Add specified server-only React-PDF dependency, adapter and PdfRenderingService with Helvetica; test bytes and errors.

### Step 3.2: Markdown renderer and format dispatch

Add MarkdownRenderingService and neutral DocumentRenderer map; test unsupported formats and rendered MIME/bytes.

### Step 3.3: Document utility barrel

Add locale-aware date/money, safe filenames and response filename parsing, blob lifecycle and Markdown escaping with tests.

### Step 3.4: PDF authoring toolkit

Add reusable PDF theme/logo toolkit and tests; follow design tokens without changing governance files.

### Step 4.1: Quote data service

Add Sales-owned QuotesDocumentService with strict id validation, scoped decrypted fetch, normalized localized data and tenant contract tests.

### Step 4.2: Sales offer PDF template

Add quote offer PDF and namespaced Sales declaration with required source features and translated labels.

### Step 4.3: Order data service

Add Sales-owned OrdersDocumentService with scoped decrypted fetch and normalized invoice data; test identity, amounts and scoping.

### Step 4.4: Order PDF and Markdown templates

Add invoice variants sharing normalized data, escaped Markdown and required filenames; register with Sales-owned declaration.

### Step 5.1: API validators and response helpers

Implement strict request/query schemas, shared translated error codes, organization guards, RFC5987 filenames and no-store/nosniff responses.

### Step 5.1-review-fix: Selected organization scope resolution

`getAuthFromRequest` applies the organization switcher cookie only for super-admins, so `requireOrganization` resolves scope through the Directory-owned `organizationScopeService.resolveForRequest` (shared `OrganizationScopeService` contract, no core dependency), refuses rejected selections, and projects the selected organization onto the auth passed to source services and RBAC.

### Step 5.2: Template catalogue and facet endpoints

Implement metadata/OpenAPI and authorized filtered catalogue/options endpoints with route tests.

### Step 5.3: Preview endpoint

Implement view-guarded render endpoint, source-feature checks before load and zero side effects; test invalid identity, source scope and errors.

### Step 5.4: History entity encryption and migration

Add GeneratedDocument, encryption map, indexes, generated migration plus snapshot; preserve immutable history timestamps.

### Step 5.5: History persistence and read service

Implement safe encryption preparation/write ordering and decrypted scoped paging; follow spec constructor exception and record explicit review signoff.

### Step 5.6: Generate endpoint and mutation guards

Implement generate feature, source ACL, canonical identity, rendering, mutation guards and best-effort history; isolate after-success callback errors.

### Step 5.7: History endpoint

Implement scoped filters, four sortable fields, empty missing-org response and translated invalid_query contract with OpenAPI/tests.

### Step 6.1: React Query data hooks

Add typed catalogue/facet/history queries, filter state and resource-aware keys; test query URL/key separation.

### Step 6.2: Template cards and preview dialog

Add reusable list/loading/error states, PDF blob iframe, Markdown text preview, keyboard controls and guarded generation/download.

### Step 6.2-review-fix: Allow Blob PDF preview frames in CSP

The preview dialog renders PDF bytes through a same-origin Blob URL in an iframe; the app-wide CSP only allowed `frame-src 'self'` plus Stripe, so the browser would block the preview. Add `blob:` to `frame-src` in `apps/mercato/next.config.ts` and the create-app template, as the spec's Browser Content Security Policy section prescribes.

### Step 6.3: Backend overview and catalogue pages

Add thin page shells, metadata, redirect, overview links and grouped filterable catalogue using shared backend components.

### Step 6.4: Shared history table and backend page

Add reusable history table, filters, paging and server sorting; encrypted label remains unsortable.

### Step 6.5: Sales document tabs and scoped history

Add lazy order/quote widget injection and ResourceDocumentsPanel; identity-only inputs, scoped invalidation after download and no cross-source fallback.

### Step 7.1: Core integration and browser coverage

Implement self-contained TC-DOCUMENT-001 through 021 plus Phase6 scoped-history tests; fixtures clean up their own records. Authored only; execution deferred until the user approves a running app with the migration applied (reduced validation mode).

### Step 8.1: Retention and erasure contract

Resolve user-requested retention decision before dependent storage implementation; update spec and implement covered lifecycle policy/tests.

### Step 8.2: Private attachment persistence

Lazily provision pdfDocuments, upload with authenticated tenant/org, link attachment_id and test failure/cleanup behavior without changing source scope.

### Step 8.3: Stored document download

Expose attachment_id in history and stored download action with on-demand fallback; test tenant/org download denial and lifecycle.

### Step 9.1: Template versioning

After user confirms public selection contract, implement immutable code versions, archived render selection and history version recording with tests.

### Step 9.2: Draft watermark

Derive finality from server-side Sales status semantics; implement translated draft watermark and test final/draft outputs.

### Step 10.1: Documentation examples and harness coverage

Add author docs and working example, template sync and standalone harness coverage, and update spec implementation tracking accurately.

### Step 10.2: Full validation and design system verification

Run configured gate in exact order, full integration/create-app suites and DS guardian; record checkpoint/final evidence and fix failures.

### Step 10.3: Authoritative review and UI evidence

Run om-auto-review-pr autofix loop then om-auto-qa-pr; attach real screenshots and complete PR labels/report without claiming manual QA approval.
