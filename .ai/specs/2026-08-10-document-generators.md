# Document Generators

## TLDR
**Key Points:**
- The `@open-mercato/document-generators` module is a reusable document generation engine with built-in PDF and Markdown rendering.
- A user opens a document tab contributed by the owning domain module, picks a template, previews it, then downloads the final file.
- Sales contributes the first order and quote templates without making the rendering package depend on Sales.

**Scope:**
- Universal template registry — class-based singleton populated by module convention files, with fail-fast duplicate-ID detection
- Template metadata hierarchy: `module` → `resourceKind` → logical template → `format` (`pdf` | `md`); `documentType` describes the business purpose (`offer`, `invoice`, `contract`)
- Widget passes only the source record's identity (`{ id }`) to the API — the `fetchData` hook reloads the record server-side under the request's tenant scope (e.g. fetches line items via DI container); `toTemplateData` normalizes afterward
- `GET /api/document-generators/templates` — lists available templates for client-side consumption
- `GET /api/document-generators/templates/options` — returns the sorted, unique facet values backing the catalogue filter controls
- `POST /api/document-generators/preview` — renders the selected template with zero side effects, for the preview surface
- `POST /api/document-generators/generate` — loads a template through the registry, renders its format-specific input through `DocumentRenderer`, records best-effort generation history, and returns the rendered file
- `GET /api/document-generators/documents` — returns tenant- and organization-scoped generation history
- PDF preview via `<Preview>` (iframe with blob URL); Markdown preview as formatted source text
- Widget pattern: domain-owned tab injection rather than an engine-owned action button; widgets filter by `resourceKind`
- Domain template convention: `<owning-module>/document-generators/templates/<entity>/<template-name>/<format>/`; the engine keeps only `templates/shared/**` as its authoring toolkit
- Generator plugin (`generators.ts`) enabling modules to register templates via `mercato generate registry`

**Concerns:**
- `@react-pdf/renderer` operates server-side only (`renderToBuffer`) — built-in Helvetica avoids filesystem access, font registration, and bundled font assets
- Large documents may render slowly on the server — async queue may be needed in a later phase
- The render pipeline supports discriminated React-PDF and Markdown sources. Format-specific renderers return neutral `RenderedDocument` values, while history stores `format` + `mime_type` without a schema change.

---

## Overview

The `document_generators` module extends OpenMercato with the ability to generate professional, branded documents from any entity in the system. An owning module can inject `TemplatesList` into a detail view to provide template selection, live preview, and download.

Templates live in their owning domain module and are organized by resource, logical template, and output format. `GET /api/document-generators/templates` reads one registry populated at bootstrap from each module's `document-generators.ts`. Widgets filter the resulting list with `TemplateFilter` (`resourceKind`, `documentType`, `format`, `tags`).

The widget passes `{ id: record.id }` — the source record's identity, not the record itself — and takes its `resourceKind` filter from the injection context rather than a hard-coded literal. `templateRegistry.load()` runs optional `fetchData`, normalizes through `fromRecord`, loads an extensible template source, and derives filename and resource identity. `DocumentRenderer` receives only `{ format, source, data }`, selects the registered rendering service from its format map, and returns format, MIME type, and bytes. The API route combines that output with filename and resource metadata.

**Market Reference:** Pandadoc, Qwilr, Proposify are the category leaders. Adopted: live preview before generating, client data personalization. Rejected: drag-and-drop editor (excessive complexity for MVP), cloud storage (files returned directly as a stream).

---

## Problem Statement

OpenMercato does not offer native PDF document generation. Teams must manually create documents in external tools (Word, Canva, Pandadoc), which:
- breaks workflow continuity (data transcribed by hand from the system),
- prevents per-tenant branding,
- leaves no in-system record of generated documents,
- requires a separate integration per document type (quotes, orders, invoices, contracts).

---

## Proposed Solution

An official monorepo package (`packages/document-generators/`) extending OpenMercato via UMES extension points:

1. **Domain-owned tab widgets** — an owning module registers its widget in its own `injection-table.ts`. Each thin widget renders the engine's `TemplatesList` component with `record` and `filter` props.
2. **Backend pages** — `/backend/document-generators` redirects to the module overview at `/overview`; `/overview`, `/templates`, and `/history` are flat sidebar entries in the Document Generators group.
3. **Five API routes**:
   - `GET /api/document-generators/templates` — returns `TemplateMeta[]`
   - `GET /api/document-generators/templates/options` — returns `{ resourceKinds, formats }` facets derived from the caller's authorized subset
   - `POST /api/document-generators/preview` — accepts `{ template_id, data }`, renders the selected format, returns a stream; **zero side effects**
   - `POST /api/document-generators/generate` — accepts `{ template_id, data }`, renders the selected format and persists generation history from server-derived resource identity on a best-effort basis
   - `GET /api/document-generators/documents` — returns paginated, scoped generation history
4. **Live preview** — `PreviewPanel` renders PDF blob URLs in the native browser PDF viewer with an open-in-new-tab fallback; Markdown renders as source text. Native Chromium PDF rendering is incompatible with a sandboxed Blob iframe, so the preview boundary is instead restricted to a Blob created from the authenticated `application/pdf` response protected by `nosniff` and `no-store`. Download calls `POST /generate` separately through `useGuardedMutation` and supports `Cmd/Ctrl+Enter`.
5. **Generator plugin** (`generators.ts`) — `document_generators.templates` plugin enables modules to register templates via `mercato generate registry`.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Templates as code (JSX), not database config | Git-versioned, full typographic control, no visual editor required |
| Widget sends identity, not the record | The framework hands the widget a full record, but sending it would let the browser influence document contents. Built-in widgets send `{ id: record.id }` and every built-in service validates it as `{ id: UUID }`, so the rendered document is built exclusively from server-loaded, tenant-scoped data |
| `fetchData` hook per template (server-side) | Services that need data not available in the widget context (e.g. line items) override `fetchData` to query the DI container before normalization |
| Normalization via `toTemplateData` in `BaseDocumentService` subclass | Each entity's mapping lives in one class — adding a new entity = new service subclass, no changes to existing code |
| Shared template data lives next to the logical template in its owning module | PDF and Markdown variants consume the same normalized business data without moving domain knowledge into the engine |
| `Record<string, unknown>` in route and components | Route and UI components are template-agnostic; type safety lives at the normalizer→template boundary |
| Domain template folder convention `<module>/document-generators/templates/<entity>/<name>/<format>/` | Keeps business ownership primary and format as the final implementation dimension |
| `BaseDocumentService` and neutral contracts live in `@open-mercato/shared/modules/document-generators` | Domain modules can declare entries without importing the optional runtime package |
| Singleton registry with unique template IDs | The engine owns registry mechanics; module-provided templates are injected at bootstrap and duplicate IDs fail explicitly |
| `GET /api/document-generators/templates` endpoint | Client needs the list at runtime to filter and display available templates without bundling the registry |
| `generators.ts` plugin for code-gen | Owning modules declare templates in `document-generators.ts`; `mercato generate registry` produces the bootstrap glue |
| PDF and Markdown authoring/runtime remain in the plugin | `@react-pdf/renderer`, PDF primitives, theme, format dispatch, MIME handling, preview and byte rendering do not move into Sales or shared |
| `resourceKind` identifies compatible source data | Widgets and templates use a canonical resource kind such as `sales.quote`; `module` remains grouping metadata and `documentType` describes the output's business purpose. |
| Resource identity is server-derived | `resourceId()` is required and runs against normalized data returned by scoped `fetchData`; clients never supply history ownership metadata. |
| `resource_label` is encrypted at rest and therefore never sortable | The two properties cannot both hold on one column: `ORDER BY` over ciphertext yields an order the user cannot read. Rather than take on the bounded in-memory sort (`packages/shared/src/lib/query/encrypted-sort.ts`) and its approximate `total`/page boundaries for a list whose natural order is `generated_at DESC`, the field is simply left out of the `sort` allowlist. Adding it later through the documented encrypted-sort path is additive; removing it after clients depend on it would not be. |
| `requiredFeatures` enforced by a dedicated `TemplateAccessPolicy`, not by the registry or each route | One component owns the omit-vs-reject decision, the fail-closed rule and the per-request check cache; the registry stays a pure lookup component and a new route cannot accidentally ship a weaker check. |
| `fromRecord` in registry entry calls `toTemplateData` (server-side) | Template owns its normalization logic — widget is fully decoupled from data shape. Adding a new template for `quotes` requires zero changes to the widget. |
| No `enrichRecord` prop in widgets | Widgets stay thin context adapters; all enrichment (data fetching + normalization) happens server-side via `fetchData` + `toTemplateData` |
| Service filename plus optional per-template override | Existing PDF templates keep service-level filenames; additional formats can provide the correct extension without duplicating normalization |
| Tab widget per entity, not action button | PDF is a contextual view of the record, not a one-shot action |
| Preview via iframe + blob URL, not PDFViewer | Server renders the PDF once (`renderToBuffer`), iframe displays the result — no client-side re-render on every change |
| React-PDF built-in Helvetica | Requires no local assets, font registration, license file, filesystem access, or base64 bundle |
| `renderToBuffer` on the server | Deterministic output, no dependency on client environment |
| Format-specific renderers own output metadata | PDF and Markdown renderers set format and MIME type; routes only dispatch and return `RenderedDocument`. |
| `DocumentRenderer` routes format-specific inputs to renderers | The second implemented renderer provides the concrete shared boundary that was intentionally deferred in the PDF-only phase. |
| Files not stored in object storage | MVP — PDF returned directly as stream |
| Examples live with the documentation app | Working reference sources for external template authors live under `apps/docs/static/examples/document-generators/`; the package contains runtime code only. |

---

## User Stories / Use Cases

- **A salesperson** wants to open a Quote and generate a PDF offer with one click.
- **An operations user** wants to generate a PDF from an Order, Invoice, or any other entity.
- **A user** wants to preview the PDF before downloading to verify the data.
- **A developer** wants to add a new PDF template by writing a React component and one registry entry — no other file changes required.
- **A developer** wants to add PDF generation to any module by creating a widget folder with `toDocumentData()`, `types.ts`, and `templateIds` — fully independent of other widgets.

---

## Architecture

```
shared: neutral Template* contracts + BaseDocumentService
  ↑ imported by the owning domain module

sales/document-generators.ts
  ├── OrdersDocumentService / QuotesDocumentService
  ├── domain templates and translations
  └── sales-owned order/quote widgets
        ↓ yarn generate
document-generators.generated.ts
        ↓ bootstrap register(...)
document-generators: TemplateAccessPolicy → rbacService
  ├── filterAuthorizedTemplates → catalogue + filter options
  └── requireAccess → gate before every load
document-generators: TemplateRegistry
  └── load → DocumentRenderer
        ├── PdfRenderingService → application/pdf bytes
        └── MarkdownRenderingService → text/markdown bytes
              ├── preview/generate API
              └── generation history
```

### Module Structure

```
packages/shared/src/modules/
└── document-generators/
    ├── index.ts
    ├── lib/interfaces.ts
    └── services/
        ├── base-document-service.ts
        ├── index.ts
        └── types.ts

packages/core/src/modules/sales/
├── document-generators.ts
├── document-generators/
│   ├── services/{orders-document-service,quotes-document-service}/
│   └── templates/{orders,quotes}/...
├── widgets/injection/{document-generators-order-tab,document-generators-quote-tab}/
├── widgets/injection-table.ts
└── i18n/*.json

packages/document-generators/
├── modules/document_generators/providers/react-pdf/index.ts # React-PDF dependency adapter
├── modules/document_generators/templates/shared/ # Theme and components toolkit
└── src/modules/document_generators/
    ├── lib/
    │   ├── interfaces.ts            # renderer, loaded-template, UI filter and registry runtime types
    │   ├── template-access-policy.ts # per-template requiredFeatures checks + catalogue filtering
    │   └── template-registry.ts     # register/list/load module templates
    ├── data/
    │   ├── entities.ts              # GeneratedDocument history entity
    │   └── validators.ts            # API schemas
    ├── migrations/                  # Generated migration + snapshot
    ├── services/
    │   ├── index.ts                 # Re-exports all services and their types
    │   ├── pdf-rendering-service/   # PdfRenderInput → DocumentRenderOutput
    │   │   ├── index.ts
    │   │   ├── types.ts             # ReactPdfTemplateSource + PdfRenderInput
    │   │   ├── pdf-rendering-service.ts
    │   │   └── __tests__/
    │   ├── generation-history-service/
    │   │   ├── index.ts
    │   │   ├── generation-history-service.ts
    │   │   └── __tests__/
    │   ├── markdown-rendering-service/ # MarkdownTemplateSource + MarkdownRenderInput live here
    │   └── document-renderer.ts
    ├── components/                  # Public extension components, renderable on any backend route
    │   ├── TemplatesList.tsx        # Fetches templates, shows list + opens PreviewPanel
    │   ├── TemplatesListView.tsx    # Grid of TemplateListItem cards
    │   ├── TemplatesListLoader.tsx  # Loading skeleton
    │   ├── TemplateListItem.tsx     # Single template card
    │   ├── PreviewPanel.tsx         # Fullscreen dialog: fetch blob → Preview + download
    │   ├── Preview.tsx              # iframe rendering blob URL
    │   └── Loader.tsx               # Spinner used in PreviewPanel while fetching
    ├── templates/
    │   ├── shared/
    │   │   ├── components/
    │   │   │   └── Logo.tsx         # OpenMercatoLogo — exported publicly for external templates
    │   │   └── theme.ts             # colors, borders and spacing tokens; no runtime side effects
    ├── utils/                       # Imported through the `.../document_generators/utils` barrel, not by filename
    │   ├── index.ts                 # Stable export surface — a package export path, so files can be renamed freely
    │   ├── downloadBlob.ts          # downloadBlob + revokeObjectUrlAfterNavigation
    │   ├── escape.ts                # escapeInline / escapeTableCell — Markdown escaping for template authors
    │   ├── filename.ts              # buildDocumentFilename(data, prefix, extension)
    │   ├── formatDate.ts            # locale-aware, explicit UTC
    │   ├── formatMoney.ts           # Intl.NumberFormat with currency placement
    │   ├── getFilenameFromResponse.ts # reads Content-Disposition on the client
    │   ├── resolveErrorMessage.ts   # maps a failed render response to user-facing copy
    │   └── groupTemplatesByModule.ts # backend-catalogue only; deliberately outside the barrel
    ├── generators.ts                # GeneratorPlugin for document_generators.templates (code-gen)
    ├── api/
    │   ├── _shared/
    │   │   ├── http.ts              # parseJsonBody + requireOrganization guards
    │   │   └── document-response.ts # RFC 5987 Content-Disposition + no-store/nosniff
    │   └── document-generators/
    │       ├── documents/route.ts   # GET scoped generation history
    │       ├── generate/route.ts    # POST render, persist history, download
    │       ├── preview/route.ts     # POST side-effect-free preview
    │       ├── templates/route.ts   # GET template metadata
    │       └── templates/options/route.ts # GET catalogue filter facets
    ├── hooks/                       # React Query data layer: query keys, URL builders, filter/sort state
    │   ├── templates/{useDocumentTemplates,useDocumentTemplateFilters,useDocumentTemplateOptions}.ts
    │   └── history/{useDocumentHistory,useDocumentHistoryFilters}.ts
    ├── backend/document-generators/ # Route-local UI; each page.tsx is a thin shell + page.meta.ts
    │   ├── page.tsx                 # hidden base route redirecting to /overview
    │   ├── overview/page.tsx        # module overview with navigation cards
    │   ├── templates/               # page.tsx + components/{TemplatesList,TemplatesListTableColumns}.tsx
    │   └── history/                 # page.tsx + components/{HistoryList,HistoryListTableColumns}.tsx
    ├── acl.ts
    └── encryption.ts                # defaultEncryptionMaps for GeneratedDocument.resource_label
```

---

## Data Contracts

### Template Registry

A single registry managed by `TemplateRegistry` class (singleton `templateRegistry`):

```ts
// Runtime contract: @open-mercato/document-generators
interface TemplateRegistry {
  register(entries: TemplateEntry[]): void            // called by generated bootstrap; rejects duplicate IDs atomically
  listTemplates(filter?: TemplateFilter, translate?: TranslateFn): TemplateMeta[]
  getTemplateMetadata(id: string, translate?: TranslateFn): TemplateMeta // throws UnknownTemplateError
  listTemplateFilterOptions(templates: TemplateMeta[]): TemplateFilterOptions // required argument — see the facet-scoping rule below
  load({ id, data }, { container, auth, locale, translate }): Promise<LoadedTemplate> // fetchData → load source → normalize → derive metadata
}

// Named failures the routes map to HTTP status codes
class UnknownTemplateError extends Error {}   // thrown by getTemplateMetadata/load → 400 unknown_template
class DuplicateTemplateError extends Error {} // thrown by register; message names both the already-registered
                                              // module and the incoming one, and points authors at namespacing
```

> Sales is registered through `packages/core/src/modules/sales/document-generators.ts`. Generated bootstrap code calls `register(...)`; route files do not import a domain registry for side effects.
> Template IDs use the global `<module>.<template>` namespace. Duplicate registration is intentionally never idempotent: a second registration of the same ID, including the same entry, is treated as an invalid bootstrap graph and fails before the copied registry state is committed.

**Where catalogue data comes from.** Every read method is a pure derivation over the in-memory entry map — there is no database table, no configuration record and no server-side cache behind the catalogue or its filters:

- `listTemplates` filters the registered entries by `resourceKind` / `documentType` / `format` / `tags` and projects each survivor to `TemplateMeta`. When a translator is supplied it resolves `label` and `description` through it, which is what turns the dictionary keys built-in templates register as labels into user-visible strings; external templates registering literal text pass through unchanged.
- `listTemplateFilterOptions` collects the unique `resourceKind` and `format` values of the templates it is handed and sorts each list with `localeCompare`. Nothing else in the metadata becomes a facet.
- `getTemplateMetadata` returns the same safe projection for a single ID and throws `UnknownTemplateError` when it is not registered — this is what the render routes call to read `requiredFeatures` before the access check, so an unknown ID fails as a client error rather than reaching `load`.

> **Facet scoping is enforced by the signature, not by convention.** `listTemplateFilterOptions` takes its template list as a **required** parameter — it has no catalogue-wide default. Every caller must hand it the same authorized subset it renders, which is what the options route does after `TemplateAccessPolicy.filterAuthorizedTemplates`. This is deliberate: an optional parameter defaulting to the entire registered catalogue would let a caller silently reintroduce disclosure of templates the user cannot see, and a comment alone would not stop it. Making the argument required moves that hazard from "reviewers must remember" to "the code does not compile", so no facet can ever be derived from templates the caller has not been authorized for. `TC-DOCUMENT-020` additionally asserts the behavior end to end for a restricted user, so a future refactor that reintroduces a default is caught by a test as well as by the type.

Because the entry map changes only at bootstrap, these derivations are stable for the lifetime of a process. That is what makes the filter facets safe to cache in the browser (`useDocumentTemplateOptions` holds them for 5 minutes) while the catalogue list itself, which varies per filter and per caller, is not cached that way.

> **`globalThis` persistence (required):** `templateRegistry`'s backing state MUST be stored under a stable `globalThis` key (module-local variable as fallback only), not solely in module-local state — the same pattern already used for the ORM entity registry and the shared event bus in this repo (`packages/shared/src/modules/events/factory.ts`). Without this, bootstrap registration and a request/route resolving through a different module instance (dev HMR/Turbopack duplication, or a standalone `create-mercato-app` deployment with multiple server chunks) can see an empty registry with no error — templates silently vanish from `GET /api/document-generators/templates`. This is not a hypothetical: it is the exact failure mode two separate incidents in this codebase already hit for other publishable-package singletons.
```ts
// Neutral declaration contract: @open-mercato/shared/modules/document-generators
interface TemplateMeta {
  id: string
  label: string
  description: string
  module: string       // top-level Medusa module — e.g. 'sales'
  resourceKind: string // framework resource kind — e.g. 'sales.quote' | 'sales.order'
  documentType: string // document kind — e.g. 'offer' | 'invoice' | 'contract'
  format: string
  tags: string[]
  note?: string        // free-text hint about where the template is used; shown as a catalogue column
  requiredFeatures?: string[] // owning-module permissions enforced before fetchData/load
}

interface TemplateDataContext {
  locale: string
  translate?: TranslateFn
}

interface TemplateRegistryEntry {
  fromRecord: (data: unknown, context: TemplateDataContext) => Record<string, unknown>  // locale- and translation-aware mapping of enriched server data
  filename: (input: { data: Record<string, unknown> }) => string
  resourceId: (input: { data: Record<string, unknown> }) => string
  resourceLabel?: (input: { data: Record<string, unknown> }) => string | undefined
  load: () => Promise<DocumentTemplateSource>
  fetchData?: (input: { data: unknown }, ctx: { container: AppContainer; auth: AuthContext | null }) => Promise<unknown>
}

// TemplateEntry = TemplateMeta & TemplateRegistryEntry (full descriptor used in the registry)
type TemplateEntry = TemplateMeta & TemplateRegistryEntry

// What a service passes to this.registerTemplate(). It is per-template only:
// module, resourceKind, normalization, resource identity and fetching are
// contributed by the service in getEntries(), so they are absent here.
// Every entry owns its format-specific filename handler; BaseDocumentService
// provides no filename fallback.
interface DocumentTemplateEntry {
  id: string
  label: string
  description: string
  documentType: string
  format: string
  tags: string[]
  note?: string
  requiredFeatures?: string[]
  filename: (input: { data: Record<string, unknown> }) => string
  load: () => Promise<DocumentTemplateSource>
}

interface DocumentTemplateSource {
  type: string
  [key: string]: unknown
}
```

```ts
// Format-neutral runtime contract: document-generators/lib/interfaces.ts
interface LoadedDocumentTemplateBase {
  data: Record<string, unknown>
  filename: string
  template: { id: string; label: string }
  resource: { kind: string; id: string; label?: string }
}

// pdf-rendering-service/types.ts
interface ReactPdfTemplateSource {
  type: 'react-pdf'
  component: React.ComponentType<{ data: Record<string, unknown> }>
}

// markdown-rendering-service/types.ts
interface MarkdownTemplateSource {
  type: 'markdown'
  render: (data: Record<string, unknown>) => string | Promise<string>
}

interface DocumentRenderInput {
  format: string
  source: DocumentTemplateSource
  data: Record<string, unknown>
}

interface LoadedTemplate extends LoadedDocumentTemplateBase {
  render: DocumentRenderInput
}

interface RenderedDocument {
  buffer: Uint8Array
  filename: string
  format: string
  mimeType: string
  template: LoadedDocumentTemplateBase['template']
  resource: LoadedDocumentTemplateBase['resource']
}

interface TemplateFilter {
  resourceKind?: string
  documentType?: string
  format?: string
  tags?: string[]       // OR logic — matches if template has ANY of the given tags
}
```

Adding a domain template means defining it in the owning module, exporting its entries from `document-generators.ts`, and running `mercato generate registry`. The rendering package changes only when adding an engine-level format, renderer, API, or reusable authoring primitive.

### Template Access Policy

`TemplateMeta.requiredFeatures` is declared by the owning module but enforced by the engine. That enforcement lives in one place — `lib/template-access-policy.ts` — so the registry stays a pure lookup/loading component and every route applies identical rules:

```ts
// document-generators/lib/template-access-policy.ts
type TemplateFeatureAuthorizer = {
  userHasAllFeatures(
    userId: string,
    requiredFeatures: string[],
    scope: { tenantId: string | null; organizationId: string | null },
  ): Promise<boolean>
}

class TemplateAccessPolicy {
  constructor(options: { featureAuthorizer: TemplateFeatureAuthorizer; auth: AuthContext })
  requireAccess(input: { requiredFeatures?: string[] }): Promise<void>            // throws TemplateAccessDeniedError
  filterAuthorizedTemplates(input: { templates: TemplateMeta[] }): Promise<TemplateMeta[]>
}

class TemplateAccessDeniedError extends Error {
  readonly requiredFeatures: string[]
}
```

Behavioral contract:

- **Two modes, one rule.** Read endpoints (`/templates`, `/templates/options`) call `filterAuthorizedTemplates` and silently omit inaccessible templates; render endpoints (`/preview`, `/generate`) call `requireAccess` and reject with `403`. An unauthorized template is therefore invisible rather than discoverable, and a caller who guesses its ID still cannot render it.
- **The authorizer is injected, not imported.** Routes resolve `rbacService` from the request container and pass it in as `featureAuthorizer`. The policy depends on that narrow structural type only, so it is unit-testable without a container and remains swappable through DI.
- **Fail closed.** A template with a non-empty `requiredFeatures` and no `auth.sub` is denied. Only an empty or absent `requiredFeatures` is allowed unconditionally — that is what keeps pre-`requiredFeatures` templates working under the document-generators ACL alone.
- **Scope always comes from the request.** The policy passes `auth.tenantId` / `auth.orgId` into every RBAC check; it never accepts scope from the caller.
- **Checks are deduplicated per request.** `filterAuthorizedTemplates` keys in-flight checks by the sorted `requiredFeatures` set and awaits them with `Promise.all`, so a catalogue of N templates costs one RBAC call per *distinct* feature set, not per template. Cache lifetime is the single call — no cross-request caching, so a permission change takes effect on the next request.
- **Denial detail is deliberate.** `TemplateAccessDeniedError` carries `requiredFeatures`, and the route returns them in the `403` body so the UI can explain which permission is missing. This leaks only the feature IDs of a template the caller already named.

### Template-specific Data Shape

Each logical template defines shared normalized data next to the template in its owning module. Its format implementations consume that same contract. Example: `packages/core/src/modules/sales/document-generators/templates/quotes/sales-offer/types.ts`.

```ts
// templates/sales-offer/types.ts
interface PdfDocumentData {
  document: { number: string; date: string; validUntil?: string }
  client: { name: string; email?: string; company?: string; address?: string }
  seller: { name: string; company: string; email: string; phone?: string }
  lines: Array<{ title: string; description?: string; quantity: number; unitPrice: number; total: number; currency: string }>
  totals: { subtotal: number; tax: number; total: number; currency: string }
  notes?: string
}
```

### Document Services

Each entity has a `DocumentService` class extending `BaseDocumentService`. The service owns template registration, optional server-side data fetching, and normalization for that entity:

```ts
// packages/core/src/modules/sales/document-generators/services/quotes-document-service/quotes-document-service.ts
export class QuotesDocumentService extends BaseDocumentService {
  readonly id = 'quotes'          // globally unique service ID
  readonly label = 'Quotes'
  readonly module = 'sales'
  readonly resourceKind = 'sales.quote'

  constructor() {
    super()
    this.registerTemplate({
      id: 'sales.offer',
      documentType: 'offer',
      format: 'pdf',
      filename: ({ data }) => `offer-${String(data.document.number)}.pdf`,
      load: async () => ({ type: 'react-pdf', component: (await import('...')).default }),
      ...
    })
  }

  // Override to fetch full quote (with line items) from DB via DI container
  override async fetchData({ data }, { container, auth }): Promise<unknown> {
    // resolves SalesQuote from DI and loads it with findOneWithDecryption
    ...
  }

  toTemplateData({ data, locale, translate }: { data: unknown; locale: string; translate: TranslateFn }): Record<string, unknown> { ... }
}
```

`BaseDocumentService` provides:
- `registerTemplate(entry)` — registers a template with required format-specific `filename` and lazy `load` handlers
- `getEntries()` — returns entries with `module`, `resourceKind`, normalization, output metadata, and fetching bound to the service
- `fetchData({ data }, { container, auth })` — default no-op; override to enrich data before normalization with request scope available
- `toTemplateData({ data, locale, translate })` — **abstract**; override to map enriched data using the required request locale and translator
- `resourceId({ data })` — **abstract**; declared once per service rather than per template, because every template of one service describes the same source entity
- `resourceLabel({ data })` — optional override returning `undefined` by default; also service-level, and the generate route falls back to the resource ID when it yields nothing
- each registered template owns its required `filename({ data })`; the service provides no format-specific filename fallback

Because `resourceId` / `resourceLabel` / `fetchData` / `toTemplateData` live on the service while `filename` / `load` live on the entry, `getEntries()` is what merges the two halves into the flat `TemplateEntry` the registry stores — service-level identity and normalization bound to each per-template descriptor.

`formatDate(iso, locale)`, `formatMoney(amount, currency, locale)`, and `buildDocumentFilename(data, prefix, extension)` remain standalone engine utilities, consumed — like `escapeInline` / `escapeTableCell` — from the stable `@open-mercato/document-generators/modules/document_generators/utils` barrel rather than from implementation filenames, so the engine can rename internals without a cross-module import migration. Dates use the locale's natural convention with an explicit UTC time zone; money uses `Intl.NumberFormat` for locale-correct separators, symbols, and currency placement; filenames use normalized `data.document.number` and fall back to `{prefix}.{extension}`. Both render routes resolve the active locale and translator server-side and thread them through `TemplateRegistry.load` → `fromRecord` → `toTemplateData`. Document services build typed `data.labels` during normalization, so PDF and Markdown variants within one service share the same request-scoped fetching, formatting, and translated labels. Built-in template `label` and `description` values are standard dictionary keys resolved by the registry for the templates endpoint and generation history; literal values from external templates remain valid through translator fallback. User-facing route errors return stable codes plus translated messages, while structured server log messages remain stable English operator diagnostics. Translation values remain in the owning module's standard `i18n/<locale>.json` dictionaries; templates do not load private locale files.

### Persisted History Entity

The only database entity this spec introduces is `GeneratedDocument` (table `document_generators_generated_documents`), written by `GenerationHistoryService` after each successful `/generate` call:

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `organization_id` / `tenant_id` | UUID | Always populated from `getAuthFromRequest`; every list query filters by both |
| `resource_kind` / `resource_id` | string / UUID | Server-derived from the loaded template, never client-supplied |
| `resource_label` | string, NOT NULL | Never stored as null — the generate route falls back to `resource_id` when the service derives no label |
| `template_id` / `template_label` | string | Identifies which registered template produced the document |
| `format` | string, default `'pdf'` | Discriminator for future non-PDF formats (`md` today) |
| `mime_type` | string, default `'application/pdf'` | Paired with `format` |
| `generated_by` | UUID | `auth.userId` |
| `generated_at` | timestamp | |
| `attachment_id` | UUID, nullable | Unpopulated until Phase 7 wires stored-file download; also absent from the list DTO until then |
| `created_at` / `updated_at` | timestamp | Repo-standard audit columns |

Full migration and generation-flow detail — including the `down()` rollback and the exact write path — lives in Phase 5 of the Implementation Plan below; this table is the at-a-glance schema reference.

### Encryption

`resource_label` is a cached, GDPR-relevant display label derived from source-entity PII (a customer/company/order name) — the same class of field `customers/encryption.ts` already encrypts for `customer_entity.display_name`. Per this repo's encryption convention, `document_generators` MUST declare a module-level `encryption.ts`:

```ts
// packages/document-generators/src/modules/document_generators/encryption.ts
import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'document_generators:generated_document',
    fields: [{ field: 'resource_label' }], // no hashField — resource_label is not used for exact-match lookups
  },
]
```

No other `GeneratedDocument` field carries source-entity PII: `resource_kind`/`resource_id`/`template_id`/`template_label` are stable identifiers, not free text about a person or organization.

**Consequence: `resource_label` is not SQL-sortable, and is therefore not offered as a sort field.** Encryption at rest and `ORDER BY` are mutually exclusive on the same column — sorting ciphertext produces an order that is meaningless to the user, and keyset pagination then walks that meaningless sequence. This repository has already hit exactly this and solved it twice: `packages/core/src/modules/customers/api/labels/route.ts` decrypts a bounded candidate set and sorts it in memory (*"`label` is encrypted at rest; SQL can't sort it meaningfully"*), backed by `packages/shared/src/lib/query/encrypted-sort.ts` (`resolveEncryptedSortFields`, `resolveEncryptedSortMaxRows`, `sortRowsInMemory`) and used that way by `customers/api/interactions/route.ts`.

This spec takes the **simpler** of the two available resolutions: `resource_label` is omitted from the `GET /documents` `sort` allowlist, and the Resource column sets `enableSorting: false` on both the backend history page and Phase 6's scoped panel. The rationale is that the in-memory path is not free — it caps the candidate scan at `OM_ENCRYPTED_SORT_MAX_ROWS` and, once that cap is hit, makes `total` and page boundaries approximate for that one sort. That is an API-visible semantic that a history list has no need to take on: the list's natural ordering is `generated_at DESC`, resource-scoped panels are already filtered to a single record, and callers who want to find one record's documents use the `resource_kind` + `resource_id` filters rather than sorting a global list by name. If a user-facing requirement to sort by resource name does appear later, the escape hatch is the documented one — route `resource_label` through `resolveEncryptedSortFields` and the bounded candidate scan, and specify the truncation and pagination semantics in the `GET /documents` contract at that point. Adding a sort field is additive; removing one after clients depend on it is not, which is why the restrictive option is the reversible one.

**Fail closed at bootstrap.** `document_generators`' encryption-map registration must participate in this repo's fail-closed encryption-map discovery: a failure to load `document_generators/encryption.ts` at startup MUST abort startup, not silently register encryption with an incomplete map set. Per `.ai/lessons/system-encryption-map-discovery-must-fail-closed.md`, a silent partial registration here would let `resource_label` persist as plaintext with no error raised anywhere.

---

## API Contracts

### Shared conventions

All five routes are thin HTTP adapters over the registry, the renderer and `GenerationHistoryService`. Three helpers keep their edges identical, and every new route is expected to reuse them rather than re-implement the checks:

- `parseJsonBody(request, t)` — `400 invalid_json` on a malformed body.
- `requireOrganization(auth, t)` — `409 organization_required` when the request has no tenant + organization pair, returning the scope on success.
- `documentResponse(rendered)` — the single place that builds a downloadable response.

**Error envelope.** Failures answer `{ error: <stable code>, message: <translated> }`; `403` additionally carries `requiredFeatures`. Clients branch on `error`, never on prose:

| Code | Status | Raised when |
|---|---|---|
| `invalid_json` | 400 | Body is not valid JSON |
| `invalid_request` | 400 | Body fails `previewSchema` / `generateSchema` |
| `invalid_query` | 400 | A `GET` route receives an empty or malformed query value — a bad filter on `/templates`, or a body failing `listDocumentsSchema` on `/documents` (unknown `sort` field, non-UUID `generated_by`, inverted date range, out-of-range `pageSize`) |
| `unknown_template` | 400 | `template_id` is not registered (`UnknownTemplateError`) |
| `forbidden` | 403 | Caller lacks the template's `requiredFeatures` (`TemplateAccessDeniedError`) |
| `organization_required` | 409 | No active organization on a render request |
| `render_failed` | 500 | The renderer threw; the cause is logged, not returned |

> **No route is exempt from this envelope, `GET /documents` included.** A `listDocumentsSchema` failure answers `400 { error: 'invalid_query', message: <translated> }` exactly like every other route in the table — never untranslated prose in the `error` field, and never an `error` value a client cannot branch on. This is called out explicitly because the implementation on the closed `feat/document-generators` branch diverged here, answering `{ error: 'Invalid query parameters' }` with no stable code and no `message`; that divergence is recorded in the Changelog and must not be reproduced.

**Document responses.** `/preview` and `/generate` share `documentResponse`, so both send `Content-Type: <renderer MIME>`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` and a `Content-Disposition` built for non-ASCII filenames per RFC 5987:

```
attachment; filename="invoice-FV-2026-01.pdf"; filename*=UTF-8''invoice-FV-2026-01.pdf
```

The unquoted `filename` is an ASCII fallback with every non-printable character and quote replaced by `_`; `filename*` carries the percent-encoded UTF-8 original. Preview therefore also sends `attachment` — harmless, because the browser consumes the bytes through a Blob URL rather than a navigation, and the client reads the header back with `getFilenameFromResponse` when saving.

### GET /api/document-generators/templates

Returns all available templates. The global catalogue remains the default; callers may ask the backend to narrow the in-memory registry by template metadata. The result is narrowed a second time by `TemplateAccessPolicy.filterAuthorizedTemplates`: templates whose `requiredFeatures` the caller does not hold are omitted, never rejected, so the response never reveals that they exist.

**Optional query parameters:**
- `resource_kind` — exact resource kind, for example `sales.order`
- `document_type` — exact document type, for example `invoice`
- `format` — exact renderer format, for example `pdf` or `md`
- `tags` — repeatable tag value; multiple values use any-match semantics

**Response:**
```json
[
  {
    "id": "sales.offer",
    "label": "Sales Offer",
    "description": "...",
    "module": "sales",
    "resourceKind": "sales.quote",
    "documentType": "offer",
    "format": "pdf",
    "tags": ["offer", "quote", "sales"],
    "note": "Rendered in the Documents tab on the Quote detail page",
    "requiredFeatures": ["sales.quotes.view"]
  }
]
```

**Errors:**
- `400 invalid_query` — empty or malformed filter value
- `401` — unauthorized

---

### GET /api/document-generators/templates/options

Returns the sorted, unique values used to construct the template catalogue filters without returning template metadata. The route resolves the registry, filters it through `TemplateAccessPolicy`, and derives the facets from that authorized subset with `listTemplateFilterOptions` — see "Where catalogue data comes from" under Data Contracts — so a filter value can never reveal a resource kind or format the caller has no template for.

**Response:**
```json
{
  "resourceKinds": ["sales.order", "sales.quote"],
  "formats": ["md", "pdf"]
}
```

**Errors:**
- `401` — unauthorized

---

### POST /api/document-generators/preview

Renders a PDF for preview — **no side effects** (no logging, no events, no persistence). Used by `PreviewPanel` to populate the iframe.

**Request:**
```json
{
  "template_id": "sales.offer",
  "data": { "id": "<source record UUID>" }
}
```

**Response:** `Content-Type: application/pdf` — binary PDF stream with `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.

**Errors:**
- `400` — invalid JSON, missing `template_id` / `data`, or unknown template ID
- `401` — unauthorized
- `403` — the caller lacks a feature the selected template declares in `requiredFeatures`; body carries `{ error: 'forbidden', message, requiredFeatures }`
- `409` — no active organization
- `500` — render error (preview runs the same `DocumentRenderer` pipeline as `/generate` and can fail the same way, e.g. a template component throwing on unexpected data)

---

### POST /api/document-generators/generate

Generates a PDF and records generation history on a best-effort basis. Used by the download button in `PreviewPanel` and by external modules calling the API directly.

**Request:**
```json
{
  "template_id": "sales.offer",
  "data": { "id": "<source record UUID>" }
}
```

The loaded template must derive `resourceKind`, canonical `resourceId`, and an optional `resourceLabel` from normalized server-side data. The route always attempts to persist history after a successful render and never accepts resource identity from the client.

**Best-effort means an absent row, never a mis-encrypted one.** "Best-effort" only covers the history row being missing after a failed persist — it does not license persisting a row whose `resource_label` failed to encrypt. Per `.ai/lessons/keep-fallible-document-preparation-outside-encryption.md`, the write path must complete preparing `GeneratedDocument` (including encrypting `resource_label`) before entering the best-effort catch around `GenerationHistoryService.create(...)`; that catch must not also be the catch around encryption, or an encryption failure could be silently swallowed while a plaintext row still gets written.

**Mutation guards:** although shaped like a render endpoint, `/generate` has a real write side effect (the `GeneratedDocument` history row) and MUST go through this repo's mutation-guard-registry pattern for non-CRUD writes, classified as a `create` action — collect registered guards plus `bridgeLegacyGuard(container)`, call `runMutationGuards([...guards], input, { userFeatures })` before persisting, merge any `modifiedPayload`, and run the returned `afterSuccessCallbacks` after the history row commits. Follow `packages/core/src/modules/sales/api/quotes/send/route.ts` for the guard-collection and `runMutationGuards` call, but **not** for its `afterSuccessCallbacks` loop: that route's local helper runs each callback with no try/catch, so a guard's `afterSuccess` throwing would surface as an uncaught error after the document was already rendered and the history row already committed — turning a fully successful generation into a client-facing `500`, the opposite of this route's own best-effort persistence guarantee below. Use the try/catch-and-log pattern from `packages/shared/src/lib/crud/factory.ts`'s `runGuardAfterSuccessCallbacks` instead, so a guard failure is logged but never discards an already-rendered document. `/preview` has no persisted side effect and does not need this.

**Response:** `Content-Type: application/pdf` — binary PDF stream with `Content-Disposition: attachment; filename="<derived>"`, `Cache-Control: no-store`, and `X-Content-Type-Options: nosniff`.

**Errors:**
- `400` — invalid input or unknown template ID
- `401` — unauthorized
- `403` — the caller lacks a feature the selected template declares in `requiredFeatures`; body carries `{ error: 'forbidden', message, requiredFeatures }`
- `409` — no active organization
- `500` — render error

### GET /api/document-generators/documents

Returns paginated generation history filtered by the authenticated tenant and organization. Optional `resource_kind`, `resource_id`, `template_id`, `generated_by`, `generated_from`, and `generated_to` query parameters narrow the result. `sort` accepts `template_label`, `format`, `generated_by`, or `generated_at` and defaults to `generated_at`; `sort_direction` accepts `asc` or `desc`. Resource-detail consumers must send both resource filters together so a history panel can never mix records from different source types that happen to share an identifier.

`resource_label` is deliberately **not** in the `sort` allowlist: it is encrypted at rest (see Data Contracts → Encryption), so an `ORDER BY` on it would sort ciphertext. `listDocumentsSchema` rejects it like any other unknown sort field, and both history surfaces set `enableSorting: false` on the Resource column so the UI never offers a sort the server would refuse. Filtering by resource is unaffected — `resource_kind` + `resource_id` are exact-match predicates on unencrypted identifier columns.

**Errors:**
- `400 invalid_query` — the query fails `listDocumentsSchema` (unknown `sort` field including `resource_label`, non-UUID `generated_by`, `generated_from` later than `generated_to`, `pageSize` above 100), answered with the shared `{ error, message }` envelope
- `401` — unauthorized

A request with no active organization answers `200` with an empty page rather than `409`: a history list has nothing to scope to, which is an empty result, not a failed operation.

---

## UMES Extension Points

| Extension Point | Usage |
|----------------|-------|
| **Widget Injection** | Any module's detail view — each widget registers its own injection spot in `injection-table.ts` |
| **Backend Pages** | `/backend/document-generators` — hidden redirect; `/backend/document-generators/overview` — module overview; `/backend/document-generators/templates` — template overview; `/backend/document-generators/history` — generation history |
| **ACL Features** | `document_generators.documents.view`, `document_generators.documents.generate` |

### Access enforcement layers

Access is checked three times, by three different mechanisms, and each layer answers a different question. None of them is redundant: the first two are convenience and defense in depth, only the third is authoritative for a given template.

| Layer | Where | Enforces |
|---|---|---|
| Widget metadata | Owning module's `widgets/injection/<name>/widget.ts` — e.g. `features: ['document_generators.documents.view', 'sales.orders.view']` | Whether the tab renders at all; keeps a user without access from seeing an empty panel |
| Route guard | `metadata.<METHOD>.requireFeatures` on each API route | Whether the endpoint may be called at all — the module-level ACL |
| `TemplateAccessPolicy` | `lib/template-access-policy.ts`, invoked inside every route handler | Whether *this* caller may see or render *this* template, using the owning module's `requiredFeatures` |

Route-guard map — the engine ACL each endpoint requires before its handler runs:

| Route | Required feature |
|---|---|
| `GET /api/document-generators/templates` | `document_generators.documents.view` |
| `GET /api/document-generators/templates/options` | `document_generators.documents.view` |
| `POST /api/document-generators/preview` | `document_generators.documents.view` |
| `POST /api/document-generators/generate` | `document_generators.documents.generate` |
| `GET /api/document-generators/documents` | `document_generators.documents.view` |

Preview is deliberately gated by `view`, not `generate`: it has no persisted side effect, so seeing a document a user is already allowed to read is a read operation. `generate` is the write-shaped permission because it produces a history row.

---

## Fonts

Built-in templates use React-PDF's standard `Helvetica` family. It is available without `Font.register`, local `.ttf` files, generated base64 modules, or build-time processing:

```ts
const styles = StyleSheet.create({
  page: { fontFamily: 'Helvetica' },
})
```

External templates may register their own fonts within the owning module when their requirements and licensing justify the additional assets.

---

## Internationalization (i18n)

The engine ships its own dictionaries at `modules/document_generators/i18n/<locale>.json` in all five supported locales, with **English** as the in-code default passed to `t(key, default)`. Keys are grouped by surface:

| Group | Covers |
|---|---|
| `document_generators.errors.*` | One key per stable API error code — `invalid_json`, `invalid_query`, `invalid_request`, `unknown_template`, `forbidden`, `organization_required`, `render_failed` |
| `document_generators.page.*` | Catalogue page: title, description, load error, filter labels (`filters.resourceKind`, `filters.format`) and the seven `columns.*` headers |
| `document_generators.history.*` | History page: title, description, empty, error, the nine column headers, and `filters.*` for template, generated-by and date range |
| `document_generators.overview.*` | Overview page title/description and its two navigation cards |
| `document_generators.preview.*` | Preview dialog title, frame titles, open-in-new-tab, generic failure message |
| `document_generators.generate.*` | Download button label per format (`button`, `buttonMarkdown`) and the in-progress state |
| `document_generators.templates.*` | Widget-side list heading and loading copy |

Domain translations stay in the owning module's dictionaries — Sales keeps its template labels and descriptions under `sales.documents.templates.*`, resolved by the registry through the request translator. Structured log messages are deliberately not translated; they remain stable English operator diagnostics.

---

## UI/UX

### Widget pattern (any module)

A document tab is injected into detail views via `injection-table.ts` as an **additive entry on Sales' existing, generic `:tabs` spots** — `sales.document.detail.order:tabs` and `sales.document.detail.quote:tabs` (`packages/core/src/modules/sales/widgets/injection-table.ts`). These spots already hold one `kind: 'tab'` entry each for `sales.injection.document-history` (an unrelated change-history timeline); both spots accept multiple array entries that each render as their own tab, so the new document-generation widget is a second, independent entry on the same spot, not a replacement or a new dedicated spot. The tab renders a resource-scoped document panel:

1. **Template list** — card grid fetched from `GET /api/document-generators/templates`, filtered by `TemplateFilter` (`resourceKind`, `documentType`, `format`, `tags`).
2. **Preview dialog** (`PreviewPanel`) — calls `POST /api/document-generators/preview`; PDF uses the native browser viewer with an open-in-new-tab fallback and Markdown is displayed as source text. Chromium cannot render the Blob PDF viewer in a sandboxed iframe, so the Blob is constrained by authenticated access, PDF MIME, `nosniff`, and `no-store`. The format-aware download button and `Cmd/Ctrl+Enter` call `POST /api/document-generators/generate` through `useGuardedMutation`; download Blob URLs are revoked on the next task so browsers can consume the click first.
3. **Source history** (Phase 6) — a compact `DataTable` below the template list calls `GET /api/document-generators/documents` with both `resource_kind` and `resource_id`, showing only documents generated for the current order, quote, or other source record. A successful production download refreshes this table without reloading the detail page.

### Backend pages

- `/backend/document-generators` — navigation-hidden redirect to `/backend/document-generators/overview`, preventing an extra parent level in the sidebar.
- `/backend/document-generators/overview` — module overview with navigation cards for templates and generation history.
- `/backend/document-generators/templates` — catalogue table grouped by owner module, one `DataTable` per module under its own heading. Columns: ID, Label, Resource, Document type, Format, Description, Note. A `FilterBar` above the groups offers **Resource type** and **Format** selects whose options come from `GET /api/document-generators/templates/options` — that endpoint exists precisely so the filter dropdowns do not require downloading the catalogue, and because its facets are derived from the caller's authorized subset, the filter can never offer a value the caller has no template for. Selected values are sent to `GET /templates` as query parameters, so filtering is applied server-side against the registry. Loading and error states render through the same `DataTable` with an empty dataset, keeping one table implementation for every state.
- `/backend/document-generators/history` — organization-wide history table backed by the paginated `GET /api/document-generators/documents` endpoint, at `pageSize` 20. A `FilterBar` offers Template ID (text), Generated by user ID (text) and Generation date (range); applying or clearing a filter, or changing the sort, resets to page 1. The table renders nine columns — Resource, Template, Date, Format, Generated by, Resource type, Resource ID, Template ID, History ID — of which exactly the four the API allowlists for `sort` are sortable (`templateLabel`, `generatedAt`, `format`, `generatedBy`); the remaining five set `enableSorting: false`, so the UI cannot offer a sort the server would reject. **Resource is one of those five**: `resourceLabel` is encrypted at rest and therefore excluded from the API's `sort` allowlist (see Data Contracts → Encryption), so the column displays the label but never offers a sort control — the alternative, a sort header that returns `400 invalid_query`, would be worse than no control at all. Sorting is `manualSorting` against the endpoint, rows are not clickable, and the empty state is a translated message rather than a blank table.

Both tables bind their loading state to React Query's `isFetching` rather than `isLoading`, so a background refetch — including the post-generate invalidation planned in Phase 6 — shows the loading state instead of silently swapping rows underneath the user.

---

## Extending to Other Modules

### Adding a template for an existing entity

1. Add normalized types and the format implementation under the owning module's `document-generators/templates/<entity>/<new-template>/`
2. Call `this.registerTemplate(...)` in the owning module's existing `DocumentService`
3. Export that service's entries from the owning module's root `document-generators.ts`
4. Run `yarn generate`

No other file changes required.

### Adding PDF generation for a new entity (e.g. Shipments)

1. Under Sales, create `document-generators/services/shipments-document-service/` and extend `BaseDocumentService` imported from shared
2. Add the template under `sales/document-generators/templates/shipments/<template-name>/pdf/`, using primitives from `@open-mercato/document-generators/modules/document_generators/providers/react-pdf` and importing toolkit assets directly from `modules/document_generators/templates/shared`
3. Add the service entries to `sales/document-generators.ts`
4. Create the Sales-owned `widgets/injection/<entity>_pdf_tab/` adapter
5. Add its spot entry to `sales/widgets/injection-table.ts` and run `yarn generate`

No changes to existing services or templates required.

### Registering a template from another module

1. Create `document-generators.ts` convention file in the other module exporting a `templates: TemplateRegistryEntry[]` array
2. Run `mercato generate registry` — generates `document-generators.generated.ts` with bootstrap registration
3. The generated bootstrap calls `templateRegistry.register(...)` — templates appear in `GET /api/document-generators/templates`

---

## Risks & Impact Review

Each risk below states severity, the affected area, the mitigation, and what residual risk (if any) remains after that mitigation ships — per this repo's spec checklist.

### Data Integrity

- **Risk:** `renderToBuffer` is synchronous and may be slow for large documents, blocking the request thread.
- **Severity:** Low (MVP scope — single-document, on-demand generation only).
- **Affected area:** `PdfRenderingService`, `/generate` and `/preview` request latency.
- **Mitigation:** Acceptable for MVP given documents are single-record and user-initiated.
- **Residual risk:** Batch/bulk generation is explicitly out of scope for this spec (see "Out of scope for this spec" in the Implementation Plan) and must resolve this through `@open-mercato/queue` when specced; any future move of single-document rendering off the request thread requires a separate asynchronous-download UX decision.

### Tenant & Data Isolation

- **Risk:** A user holding only the document-generators feature could retrieve another module's source-entity data (e.g. an arbitrary quote/order by UUID) if a document service's data-fetch path were not tenant-scoped.
- **Severity:** High (cross-tenant/cross-organization data exposure).
- **Affected area:** `TemplateRegistry.load → fetchData` for every registered `DocumentService`, built-in and third-party.
- **Mitigation:** each template declares its owning-module `requiredFeatures`, enforced by `TemplateAccessPolicy` (`lib/template-access-policy.ts`) against the `rbacService` resolved from the request container. The catalogue and filter-options endpoints omit templates the caller cannot access, while `/generate` and `/preview` call `requireAccess` and fail with `403` before `TemplateRegistry.load()` can invoke `fetchData`. Sales order templates require `sales.orders.view`; quote templates require `sales.quotes.view`. The resulting `AuthContext` is also propagated through `templateRegistry.load → fetchData`; each built-in service validates its local input as `{ id: UUID }`, ignores all other client-supplied record fields, and queries by `id`, `tenant_id`, and `organization_id`. Missing scope, insufficient features, invalid input, inaccessible records, and database failures all reject the render pipeline — raw request data is never used as a fallback.
- **Module-owned `DocumentService` contract:** any module subclassing `BaseDocumentService` from `@open-mercato/shared/modules/document-generators` **must** apply the same tenant scoping in `fetchData`, using the `ctx.auth` argument provided for exactly this purpose.
- **Residual risk:** the contract above is enforced by code review convention only, not by a compiler or test. A third-party `DocumentService` that forgets to filter by `tenant_id`/`organization_id` in `fetchData` would compile, register, and render successfully while leaking cross-tenant data — the framework cannot currently detect this at registration time. **Mitigation required before this is considered closed:** Phase 2 (`BaseDocumentService`) must ship a shared contract test — e.g. `packages/shared/src/modules/document-generators/__tests__/tenant-scoping-contract.test.ts` — that every built-in `DocumentService.fetchData` implementation is required to pass (asserting the resolved query includes both `tenant_id` and `organization_id` predicates from `ctx.auth`), plus an `AGENTS.md` rule pointing third-party service authors at that test as the pattern to replicate. This closes the same class of gap the existing `packages/core/src/__tests__/module-decoupling.test.ts` closes for module coupling, but for tenant isolation instead.

### Sensitive Data & Retention

- **Risk:** generated documents and their history rows carry customer PII (name, email, address) and commercial amounts. Phase 7 additionally persists the rendered bytes themselves as `Attachment` records, extending the PII's lifetime and surface indefinitely.
- **Severity:** Medium (no schema/API leak identified, but no lifecycle story exists either).
- **Affected area:** `GeneratedDocument` history rows (Phase 5) and stored `Attachment` bytes (Phase 7).
- **Mitigation:** none yet — not addressed by Phases 1–7 as currently planned.
- **Residual risk:** if the owning customer record is deleted or a GDPR erasure request is processed, this spec does not currently define whether/how `GeneratedDocument` history rows and Phase 7 attachments are purged or anonymized, nor any retention window. **Before Phase 7 ships**, add an explicit retention/erasure policy here (e.g. cascade-delete `GeneratedDocument`/`Attachment` rows referencing an erased customer, or document why leaving a historical financial record intact post-erasure is acceptable) — this is a data-protection gap, not a nice-to-have.

### Font Loading

- **Risk:** custom font dependencies (filesystem paths, registration, bundled assets) could break server rendering in a new environment.
- **Severity:** Low.
- **Affected area:** PDF template rendering.
- **Mitigation:** Built-in templates use React-PDF's standard Helvetica family, so they do not depend on filesystem paths, generated files, runtime registration, or bundled font assets.
- **Residual risk:** none for built-in templates. External templates that register their own fonts take on this risk themselves and are responsible for their own licensing/asset management.

### Operational

- **Risk:** server bundle weight growth from `@react-pdf/renderer`.
- **Severity:** Low.
- **Affected area:** server build size.
- **Mitigation:** Template entries keep sources lazy through `entry.load()`.
- **Residual risk:** none identified.

### Browser Content Security Policy

- **Risk:** a global `frame-src blob:` CSP directive is broader than the two built-in sales detail routes strictly need.
- **Severity:** Low.
- **Affected area:** app-wide CSP (`apps/mercato/next.config.ts` and the create-app template).
- **Mitigation:** PDF preview bytes come only from the authenticated same-origin preview API and are exposed to the iframe through a local Blob URL; `frame-src blob:` stays global because `TemplatesList` is a public extension component that external modules may render on any backend route, and scoping the directive to the two built-in routes would silently break supported custom injection spots.
- **Residual risk:** any other page rendering an attacker-controlled Blob URL under `frame-src blob:` would also be permitted by this directive; acceptable because the directive doesn't grant network fetch capability and blob content still requires same-origin authenticated retrieval to populate.

---

## Integration Test Coverage

> None of the tests below exist in this repository yet — this table specifies the required coverage each implementing phase must ship, not evidence of coverage already in place.

Every API path and the one RBAC-relevant UI path (backend navigation) must have integration coverage under `packages/core/src/modules/sales/__integration__/document-generators/` (Sales-owned templates/history) and `packages/document-generators/src/modules/document_generators/__integration__/` (engine-owned auth, request validation, and navigation):

| Test | Covers |
|---|---|
| `TC-DOCUMENT-001-sales-templates-listed.spec.ts` | `GET /api/document-generators/templates` returns the registered Sales templates |
| `TC-DOCUMENT-002-sales-template-filter-options.spec.ts` | `GET /api/document-generators/templates/options` returns the filter option lists |
| `TC-DOCUMENT-003-preview-order-invoice.spec.ts` | `POST /api/document-generators/preview` — happy path, order invoice template |
| `TC-DOCUMENT-004-preview-missing-order.spec.ts` | `POST /api/document-generators/preview` — `400`/render failure when the source order doesn't exist |
| `TC-DOCUMENT-005-backend-navigation.spec.ts` | `/backend/document-generators` hidden-redirect → Overview → Templates/History navigation cards |
| `TC-DOCUMENT-006-generate-order-invoice.spec.ts` | `POST /api/document-generators/generate` — happy path, order invoice, response headers + history persistence |
| `TC-DOCUMENT-007-generate-sales-offer.spec.ts` | `POST /api/document-generators/generate` — happy path, quote sales-offer template |
| `TC-DOCUMENT-008-generate-missing-order.spec.ts` | `POST /api/document-generators/generate` — failure path when the source order doesn't exist |
| `TC-DOCUMENT-009-generation-history-records-order.spec.ts` | `GET /api/document-generators/documents` — a successful generate call produces a scoped, visible history row |
| `TC-DOCUMENT-010-template-access-hides-unauthorized.spec.ts` | `GET /api/document-generators/templates` — templates the caller lacks `requiredFeatures` for are omitted from the catalogue |
| `TC-DOCUMENT-011-template-access-forbids-preview.spec.ts` | `POST /api/document-generators/preview` — rejected when the caller lacks the owning module's required feature |
| `TC-DOCUMENT-012-template-access-forbids-generate.spec.ts` | `POST /api/document-generators/generate` — same RBAC enforcement on the production route |
| `TC-DOCUMENT-013-catalogue-requires-auth.spec.ts` | `GET /api/document-generators/templates` — `401` unauthenticated |
| `TC-DOCUMENT-014-preview-requires-auth.spec.ts` | `POST /api/document-generators/preview` — `401` unauthenticated |
| `TC-DOCUMENT-015-generate-requires-auth.spec.ts` | `POST /api/document-generators/generate` — `401` unauthenticated |
| `TC-DOCUMENT-016-history-requires-auth.spec.ts` | `GET /api/document-generators/documents` — `401` unauthenticated |
| `TC-DOCUMENT-017-preview-rejects-invalid-request.spec.ts` | `POST /api/document-generators/preview` — `400 invalid_request` for a body failing the schema and `400 unknown_template` for an unregistered ID, each with a machine-readable code plus a translated message |
| `TC-DOCUMENT-018-generate-rejects-invalid-request.spec.ts` | `POST /api/document-generators/generate` — the same two `400` codes, rejected before the side-effecting part of the route so no history row is written |
| `TC-DOCUMENT-019-template-filter-options-shape.spec.ts` | `GET /api/document-generators/templates/options` — deduplicated, sorted facets that never carry the template list under `items`/`templates` |
| `TC-DOCUMENT-020-template-filter-options-scoped-to-access.spec.ts` | `GET /api/document-generators/templates/options` — facets are derived from the caller's authorized subset only: a restricted user (the `helpers/restricted-document-user.ts` fixture) sees no `resourceKind` or `format` value contributed solely by a template they cannot access. The required `templates` parameter on `listTemplateFilterOptions` makes the catalogue-wide variant uncallable; this test asserts the same guarantee end to end, so a later refactor reintroducing a default is caught behaviorally too |
| `TC-DOCUMENT-021-history-sort-allowlist.spec.ts` | `GET /api/document-generators/documents` — `sort=resource_label` is rejected with `400 invalid_query` in the shared `{ error, message }` envelope (the field is encrypted at rest and deliberately unsortable), each of `template_label` / `format` / `generated_by` / `generated_at` is accepted, and the returned rows carry plaintext `resourceLabel` values, proving the list reads through `findAndCountWithDecryption` rather than raw `em.findAndCount` |

Engine-owned specs should share `__integration__/helpers/document-generators-api.ts` (typed request wrappers and response readers for all five endpoints) and declare `__integration__/meta.ts` with `dependsOnModules: ['document_generators']`; Sales-owned specs should additionally use `helpers/restricted-document-user.ts` to provision a user holding the engine ACL but not the source module's view feature. New coverage should extend those helpers rather than re-issuing raw requests.

Not required to have a dedicated test at this stage (tracked against the corresponding Implementation Plan phase, not a gap in Phases 1–5's required coverage): Markdown-format preview/generate/download (Phase 4.7 shares the order-invoice fixture path but has no `TC-DOCUMENT-*` of its own), Phase 6's resource-scoped history panel (its own verification evidence is specified inline under Phase 6 below), and Phase 7/8, which have no tests specified because those phases are not started.

---

## Implementation Plan

> **Status: nothing in this list is implemented in this repository.** `packages/document-generators/` does not exist on `develop`. Phases 1–4.8 and 5 were previously designed and coded on the now-closed, unmerged `feat/document-generators` branch (PR #5170) — that PR was closed for implementation-quality problems, not design problems, so the phase content below is the target to build against, not a description of shippable code. Do not resurrect or cherry-pick commits from the closed branch; implement fresh against this spec. See "Implementation Status" below for per-phase tracking.

### Phase 1 — Foundation (Planned)

1. Package scaffold (`package.json`, `build.mjs`, `tsconfig.json`)
2. `acl.ts` with `document_generators.documents.view`, `document_generators.documents.generate`
3. `setup.ts` with `defaultRoleFeatures`
4. Module `index.ts`

### Phase 2 — Templates & Registry (Planned)

1. Shared `document-generators` contracts plus the engine-owned `lib/template-registry.ts`
2. `BaseDocumentService` in `@open-mercato/shared/modules/document-generators`
3. Sales-owned `QuotesDocumentService`, local validation, and `sales.offer` registration through `sales/document-generators.ts`
4. Generated bootstrap registration in the engine-owned registry
5. `templates/shared/theme.ts` + `templates/shared/components/Logo.tsx` — shared design tokens and brand components exported publicly
6. Sales-owned `document-generators/templates/quotes/sales-offer/` with shared types plus PDF implementation using React-PDF's built-in Helvetica family

### Phase 3 — API (Planned)

1. `GET /api/document-generators/templates` — returns `TemplateMeta[]`, narrowed by optional metadata filters
2. `GET /api/document-generators/templates/options` — returns the facet lists (`resourceKinds`, `formats`) backing the catalogue filter controls, so the filter UI never has to download the catalogue
3. `POST /api/document-generators/preview` — side-effect-free rendering for the iframe
4. `POST /api/document-generators/generate` — rendering, download headers, identity verification, and best-effort history
5. `GET /api/document-generators/documents` — scoped, paginated generation history

All five routes export `metadata` (with `requireAuth` and `requireFeatures`) and `openApi`; the guard each one applies is listed in "Access enforcement layers" above.

### Phase 4 — UI Components (Planned)

1. `components/TemplatesList.tsx` — fetches templates via `GET /api/document-generators/templates` through `useDocumentTemplates`, which sends `TemplateFilter` as query parameters so the registry is narrowed server-side; renders the card list and its loading/error states. (The catalogue table on the backend templates page is a different, route-local component that happens to share the name.)
2. `components/TemplatesListView.tsx`, `TemplatesListLoader.tsx`, `TemplateListItem.tsx` — list sub-components
3. `components/PreviewPanel.tsx` — fullscreen dialog: previews through `POST /preview`; download calls `POST /generate`
4. `components/Preview.tsx` — iframe rendering a blob URL
5. `components/Loader.tsx` — spinner
6. `utils/downloadBlob.ts` — triggers browser file download
7. Sales-owned `widgets/injection/document-generators-quote-tab/` — a thin adapter passing `record={{ id: record.id }}` and `filter={{ resourceKind: ctx.resourceKind }}`, both taken from the injection context; its `widget.ts` metadata declares `features: ['document_generators.documents.view', 'sales.quotes.view']`
8. Sales-owned `widgets/injection-table.ts` adds this widget as an entry on the `sales.document.detail.quote:tabs` spot

### Phase 4.5 — External Template Code-Gen (Planned)

1. `generators.ts` — `document_generators.templates` GeneratorPlugin (module-id-based key, matching the convention used by every existing `GeneratorPlugin`, e.g. `webhooks.sources`, `security.mfa-providers`)
2. Convention file pattern: `document-generators.ts` in consuming module exports `templates: TemplateRegistryEntry[]`
3. `mercato generate registry` produces `document-generators.generated.ts` that calls `register(...)`

### Phase 4.6 — Orders Built-in Template (Planned)

1. Sales-owned `OrdersDocumentService` (`resourceKind: 'sales.order'`) with local validation
2. Sales-owned `document-generators/templates/orders/order-invoice/` with PDF and Markdown implementations
3. `sales/document-generators.ts` exports order and quote entries to the generated registry
4. Sales-owned `widgets/injection/document-generators-order-tab/` filters by `sales.order`
5. `sales/widgets/injection-table.ts` adds this widget as a second entry on the `sales.document.detail.order:tabs` spot, alongside the existing `sales.injection.document-history` entry
6. Complete working invoice example for external template authors (`document-generators.ts`, service, template, widget, injection-table) lives under `apps/docs/static/examples/document-generators/` and is described in the Document Generators docs section

### Phase 4.7 — Markdown Output (Planned)

1. Required, extensible `format` metadata plus optional per-template filename overrides — the pipeline must never infer PDF from a missing format
2. `MarkdownTemplateSource`, `MarkdownRenderInput`, and `MarkdownRenderingService`, colocated in the Markdown engine folder
3. `DocumentRenderer` shared by the preview and generate routes, with a format-to-renderer map and a format-neutral `DocumentRenderInput`
4. Built-in template layout `<logical-template>/<format>/`, keeping normalized data types at the logical-template level
5. `sales.order-invoice-markdown` on `OrdersDocumentService`, sharing the order fetch, normalization, resource identity, and history pipeline with the PDF invoice
6. Markdown source preview and format-aware downloading in `PreviewPanel`
7. `escapeInline` / `escapeTableCell` in the utils barrel. Markdown output interpolates customer names, addresses and free-text notes into a structural format, so a template that emits them raw lets source data alter the document's structure — the built-in invoice escapes every interpolated value, and any Markdown template author is expected to do the same. PDF has no equivalent hazard because React-PDF renders text nodes, not markup.

### Phase 4.8 — Template Access Policy (Planned)

Templates may load records owned by another module, so the engine ACL alone is not a sufficient authorization boundary. This phase adds the owning-module permission check as one component rather than repeating it per route.

1. Optional `requiredFeatures?: string[]` on `TemplateMeta` and `DocumentTemplateEntry`; Sales order templates declare `sales.orders.view`, quote templates declare `sales.quotes.view`
2. `lib/template-access-policy.ts` carrying `TemplateAccessPolicy`, the structural `TemplateFeatureAuthorizer` type, and `TemplateAccessDeniedError` — see "Template Access Policy" under Data Contracts for the full behavioral contract
3. Policy construction from `container.resolve('rbacService')` plus the request `auth` in the four template-facing routes (`/templates`, `/templates/options`, `/preview`, `/generate`; `/documents` reads history rows, not templates, and needs no policy): read endpoints filter, render endpoints call `requireAccess` and map `TemplateAccessDeniedError` to a `403` `forbidden` body carrying `requiredFeatures`
4. Engine ACL IDs `document_generators.documents.view` / `document_generators.documents.generate` following the repo's `<module>.<resource>.<action>` convention, with the route guards split so only `/generate` requires the write-shaped feature

**Verification required:** `lib/__tests__/template-access-policy.test.ts` must cover the omit-vs-reject split, the fail-closed path for a missing subject, the empty-`requiredFeatures` allowance and the per-feature-set check deduplication; `TC-DOCUMENT-010/011/012` must cover catalogue omission, preview rejection and generate rejection end-to-end against a restricted user fixture.

### Phase 5 — History & Backend Page (Planned)

#### Files to add

| File | Description |
|------|-------------|
| `data/entities.ts` | `GeneratedDocument` entity — `id`, `organization_id`, `tenant_id`, `resource_kind`, `resource_id`, `resource_label` (NOT NULL), `template_id`, `template_label`, `format` (default `'pdf'`), `mime_type` (default `'application/pdf'`), `generated_by`, `generated_at`, `attachment_id` (nullable — populated in Phase 7), plus the repo-standard `created_at` / `updated_at`. Table `document_generators_generated_documents` |
| `data/validators.ts` | Zod schemas for the whole module: `previewSchema` / `generateSchema` accept only template identity + a passthrough `data` object; `listTemplatesSchema` validates catalogue filters; `listDocumentsSchema` defaults `page=1` and `pageSize=20` (max 100), requires `generated_by` to be a UUID, allowlists `sort` (`template_label`, `format`, `generated_by`, `generated_at` — deliberately excluding the encrypted `resource_label`) and `sort_direction`, and refines `generated_from <= generated_to` |
| `services/generation-history-service/` | Scoped creation plus filtered, sorted, paginated listing of generation history. Returns `GeneratedDocumentDto` — `id`, `resourceKind`, `resourceId`, `resourceLabel`, `templateId`, `templateLabel`, `format`, `generatedBy`, `generatedAt` (ISO string). `mime_type` and `attachment_id` are persisted but not exposed; Phase 7 must add `attachment_id` to this DTO before a stored-file download can work |
| `api/document-generators/documents/route.ts` | Paginated history endpoint with resource/template/user/date filters and allowlisted sorting; returns the envelope `{ items, total, page, pageSize }` and answers `200` with an empty page — not `409` — when the request has no active organization, because a history list has nothing to scope to rather than a failed operation to report; exports `openApi` + `metadata` |
| `hooks/history/useDocumentHistory.ts`, `hooks/history/useDocumentHistoryFilters.ts` | React Query data layer for history: query key, URL builder, `readApiResultOrThrow` fetch, plus filter/sort/pagination state bound to `FilterBar` and `DataTable` |
| `backend/document-generators/history/components/HistoryList.tsx`, `HistoryListTableColumns.tsx` | Route-local history table and its column definitions, consuming the hooks above |
| `backend/document-generators/templates/components/TemplatesList.tsx`, `TemplatesListTableColumns.tsx` | Route-local catalogue table grouped by owning module — distinct from the public `components/TemplatesList.tsx` extension component despite the shared name |
| `hooks/templates/useDocumentTemplates.ts`, `useDocumentTemplateFilters.ts`, `useDocumentTemplateOptions.ts` | React Query data layer for the catalogue: filter values are sent as query parameters, so template filtering is applied server-side; `useDocumentTemplateOptions` fetches `GET /templates/options` (cached for 5 minutes, since the registry only changes on redeploy) and `useDocumentTemplateFilters` turns those facets into `FilterBar` definitions |
| `backend/document-generators/**/page.meta.ts` | Per-page `requireFeatures`, `pageGroup`, `pageOrder` (900/901/902), `navHidden` on the base route, and breadcrumbs |
| `migrations/Migration20260809121904_document_generators.ts` | Generated migration accompanied by the module snapshot |

> **Format-agnostic by design.** The entity is named `GeneratedDocument` and carries `format` + `mime_type` discriminators. `BaseDocumentService` is format-neutral in shared; the plugin owns both `PdfRenderingService` and `MarkdownRenderingService`, including their dependencies and output metadata.

#### Files to update

| File | Change |
|------|--------|
| `api/document-generators/generate/route.ts` | Persist the neutral render result through `GenerationHistoryService` after a successful render, using only canonical template-derived resource identity |
| `acl.ts` | Add `document_generators.documents.generate` feature |
| `setup.ts` | Add `document_generators.documents.generate` to `superadmin` + `admin` role features |
| `backend/document-generators/page.tsx` | Navigation-hidden compatibility redirect to the overview route |
| `backend/document-generators/overview/page.tsx` | Module overview with cards linking to the template list and generation history |
| `backend/document-generators/templates/page.tsx` | Thin page shell delegating catalogue rendering to its route-local `components/TemplatesList.tsx` |
| `backend/document-generators/history/page.tsx` | Thin history page shell delegating the filtered, sortable table to route-local `components/HistoryList.tsx` and `hooks/history/**` |
| `i18n/*.json` | Engine dictionaries in all five shipped locales. The history surface alone spans `document_generators.history.{title,description,empty,error,id,resource,resourceKind,resourceId,template,templateId,format,generatedBy,generatedAt}` plus `history.filters.*`; the catalogue, overview, preview and error surfaces add their own groups. English is the default-value language — the four Polish defaults in this spec's i18n table predate the module's own dictionaries |

#### Data flow

```
Widget → POST /generate { template_id, data }
         ├── parseJsonBody → 400 invalid_json
         ├── generateSchema.safeParse → 400 invalid_request
         ├── requireOrganization(auth) → 409 organization_required
         ├── resolveTranslations() → required active locale + request translator
         ├── TemplateAccessPolicy.requireAccess(meta.requiredFeatures) → 403 forbidden   [Phase 4.8]
         ├── templateRegistry.load(..., { locale, translate }) → LoadedTemplate + canonical resource identity
         ├── DocumentRenderer.render(template.render) → RenderedDocument
         ├── GenerationHistoryService.create(GeneratedDocument { format, mime_type, ... }) [best effort]
         └── documentResponse(rendered) → document stream (pdf or md)

GET /api/document-generators/documents?resource_kind=X&resource_id=Y&page=1&pageSize=20
    └── findAndCountWithDecryption(em, GeneratedDocument,
          { tenant_id, organization_id, [resource_kind, resource_id, template_id, generated_by, generated_at range] },
          { orderBy: <allowlisted field> <direction>, limit, offset })   // resource_label decrypted on read
    └── { items: GeneratedDocumentDto[], total, page, pageSize }
```

#### Key implementation notes

- Use `createRequestContainer()` from `@open-mercato/shared/lib/di/container` to get `em` in the generate route
- Use `getAuthFromRequest(request)` from `@open-mercato/shared/lib/auth/server` to get `generated_by`, resolved as `auth.userId ?? auth.sub` so a token carrying only the subject claim still records an author
- `GenerationHistoryService` is constructed with plain `new` per request from the request-scoped `em`, deliberately not registered in DI and deliberately not built on `makeCrudRoute`: history rows are written directly by `/generate` and never reach the query index a CRUD route would read. This is a conscious exception to the module-services-through-DI convention — keep the constructor a single `EntityManager` so it stays trivially testable. **This exception requires explicit sign-off at code-review time.** Root `AGENTS.md` states *"Use DI (Awilix) to inject services; avoid `new`-ing directly"* without qualification, and the only precedent in this repository is loose and dissimilar, so the reviewer of Phase 5 must either confirm the reasoning above still holds against the code as built or require registration in DI — and record which, rather than letting the deviation pass unremarked because the spec mentioned it
- `resourceId()` is required for every registered template and derives the canonical source ID after server-side fetching and normalization
- `resource_kind`, `resource_id`, and `resource_label` are never accepted by `POST /generate`; the registry derives all three values, and an unavailable label falls back to the canonical resource ID
- `GET /documents` must always filter by both `tenant_id` and `organization_id` — use `getAuthFromRequest` for tenant scoping
- **`GenerationHistoryService.listAndCount` must read through `findAndCountWithDecryption`** (`packages/shared/src/lib/encryption/find.ts`), never raw `em.findAndCount`. `resource_label` is encrypted at rest, so a raw read hands ciphertext straight into `GeneratedDocumentDto.resourceLabel` and the history table renders it. This is the repo-wide rule from root `AGENTS.md` — *"Use `findWithDecryption`/`findOneWithDecryption` instead of `em.find`/`em.findOne`"* — and `findAndCountWithDecryption` is the helper matching this call shape, so the paginated envelope keeps its `total` while every returned row is decrypted. The single-row write path is unaffected: `/generate` prepares and encrypts the entity before persisting (see the best-effort ordering rule under `POST /generate`)
- The history table keeps two indexes: `(organization_id, resource_kind, resource_id)` for resource lookup — the source-scoped read Phase 6 depends on — and the composite b-tree index `(tenant_id, organization_id, generated_at DESC)` — a plain multi-column index whose last column carries a descending sort order, not an expression index — for the newest-first scoped list. It does not keep a redundant index on `organization_id` alone. The resource index intentionally omits `tenant_id`: it is a lookup accelerator, never the isolation boundary, which `GenerationHistoryService` always enforces in the `where` clause
- The initial table-creation migration defines `down()` by dropping the generated-documents table, so a pre-release rollback removes the table and its indexes together
- DB migration was generated with `yarn db:generate`; the migration and module snapshot are committed together, while unrelated module output is discarded

#### Format extensibility boundary

The design supports two concrete formats through a format-neutral dispatch boundary:

- Shared declares only the extensible `DocumentTemplateSource { type: string; [key: string]: unknown }` contract.
- `LoadedDocumentTemplateBase` carries normalized data, filename, template identity, and resource identity independently of a renderer.
- PDF-specific source and input types live in `pdf-rendering-service/types.ts`; Markdown-specific types live in `markdown-rendering-service/types.ts`.
- `DocumentRenderer` selects engines through a format-to-renderer map without teaching the template registry or API routes about concrete formats.
- `RenderedDocument` and `GeneratedDocument` are format-neutral, so history does not require a schema change for another output type.

Adding DOCX later requires a colocated DOCX source/input type, a DOCX rendering service, one renderer-map entry, and a UI preview/download decision. Shared contracts and `TemplateRegistry` remain unchanged. DOCX generation itself remains outside this spec's scope.

### Phase 6 — Source-scoped History in Detail Widgets (Planned)

Expose the history already captured in Phase 5 where users work with the source record. The existing Sales-owned order and quote document widgets gain a compact history section below the template cards; other source widgets can adopt the same composition without introducing a new injection spot or changing the host module.

#### UI composition

1. Extend the existing data layer rather than extracting a new one — Phase 5 already separated fetching from rendering. `DocumentHistoryQuery`, `buildDocumentHistoryUrl` and `documentHistoryQueryKey` in `hooks/history/useDocumentHistory.ts` gain optional `resourceKind` / `resourceId`, emitted as `resource_kind` / `resource_id`; both must be part of the query key so a scoped list never reads another record's cached page. The backend history page keeps its existing unfiltered behavior and page size by simply omitting them.
2. Promote the history table from `backend/document-generators/history/components/HistoryList.tsx` to module-level `components/`, so a widget rendered outside the backend route tree can import it. It takes optional `resourceKind`, `resourceId` and `pageSize`; the backend page keeps rendering it with no resource filters. Move its column builder alongside it and let the caller select the visible subset.
3. Add an internal `ResourceDocumentsPanel` composing `TemplatesList` with the resource-filtered history list, plus an optional `onGenerated` callback threaded through `TemplatesList` → `PreviewPanel`. Invoke it after the generated bytes have been accepted and the download has been initiated; preview-only requests must not refresh history because they have no persistence side effect. **Refresh through the query cache, not a hand-rolled token:** the callback invalidates `documentHistoryQueryKey` for the current resource, and React Query refetches the mounted list. The earlier `refreshToken` counter in this phase predates the hooks layer and is no longer needed — a monotonic prop would duplicate cache invalidation the data layer already provides. A refresh remains an attempt, not a guarantee of a new row, because Phase 5 persistence stays best-effort.
4. Replace the direct `TemplatesList` usage in `document-generators-order-tab/widget.client.tsx` and `document-generators-quote-tab/widget.client.tsx` with `ResourceDocumentsPanel`, passing the canonical widget context pair: `resourceKind` and `record.id`.
5. The scoped table shows four of the nine columns the backend history page renders: Template, Format, Generated by, and Generated at. It omits the other five — Resource, Resource type, Resource ID, History ID, and **Template ID** — because in a single-record context the first four are constant and the fifth duplicates the Template label the user just picked; a machine-readable template ID belongs on the organization-wide page, not in a per-record panel. Sortability follows the same rule as that page: only the four fields the API allowlists for `sort` may be sortable, so of the visible columns all four qualify. The encrypted `resourceLabel` is excluded from that allowlist and is in any case not among the columns this panel renders, so the restriction costs the scoped view nothing. It uses `DataTable`, `formatDateTime`, translated copy, pagination, and the standard loading/error/empty states; `pageSize` defaults to 10 and remains at or below 100.
6. Phase 6 is read-only. Rows have no download action until Phase 7 supplies an `attachment_id`; generating another document remains the only mutation and continues through the existing authenticated, feature-gated API route.

#### Data and isolation contract

```text
Order/quote detail widget
  -> ResourceDocumentsPanel { resourceKind, resourceId }
     -> TemplatesList -> PreviewPanel -> POST /generate { template_id, data: { id } }
          on success -> invalidate documentHistoryQueryKey({ resourceKind, resourceId, ... })
     -> HistoryList -> useDocumentHistory({ resourceKind, resourceId, page, pageSize: 10 })
          -> GET /documents?resource_kind=<kind>&resource_id=<id>&page=1&pageSize=10
             -> GenerationHistoryService.listAndCount
                filters tenant_id + organization_id + resource_kind + resource_id
```

- The browser-provided filters are narrowing inputs only. They never replace the authenticated `tenant_id` and `organization_id` predicates enforced by `GenerationHistoryService`.
- Both source filters are mandatory for the detail-widget variant. Missing `resourceKind` or `resourceId` suppresses the request and renders no cross-resource fallback.
- A resource history refresh must preserve the current page when it is still valid and fall back to the last valid page after deletions or future retention work reduce the result count.
- No schema, migration, event, or new API route is required. The existing `document_generators.documents.view` guard and history endpoint remain authoritative.

#### Frontend architecture contract

| Surface | Server root | Client islands | Data owner | Notes |
| --- | --- | --- | --- | --- |
| Sales order/quote detail PDF tab | Existing sales detail host | Existing injection widget, `ResourceDocumentsPanel`, `TemplatesList`, resource-aware `HistoryList`, `PreviewPanel` | Document Generators APIs | No page-root or provider change; the widget remains lazy at its Phase 4.6 injection-table entry on the `sales.document.detail.order:tabs` / `sales.document.detail.quote:tabs` spots, which becomes a frozen contract surface once shipped (BACKWARD_COMPATIBILITY.md §6) — Phase 6 must not rename or move it. |
| `/backend/document-generators/history` | Existing generated backend route | Existing `DocumentGenerationHistoryPage` and the promoted shared `HistoryList` | `GET /api/document-generators/documents` | Retains organization-wide behavior by omitting resource filters. The promotion in step 2 is a move, not a fork — one table serves both surfaces. |

| `"use client"` file | Reason | Heavy dependencies / guardrail |
| --- | --- | --- |
| `components/ResourceDocumentsPanel.tsx` | Composes the template list with the scoped history list and invalidates the history query after a successful generate | Small orchestration island; holds no fetched data of its own and imports no renderer or PDF dependency. |
| `components/HistoryList.tsx` (promoted from the history route directory) | Pagination and DataTable state; fetching stays in `hooks/history/**` | Reuses existing DataTable; keep resource-specific column selection memoized and the file below 300 LOC. |
| Existing order/quote widget clients | Injection host adapters | Remain thin context adapters; no data fetching or duplicated table logic. |

- Budget: zero new page-root client components, zero global providers, zero heavy browser libraries at a page/provider root, and zero touched client files above 300 LOC.
- Verification evidence: hook tests asserting that `resourceKind` / `resourceId` reach both the request URL and the query key, and that the post-generate invalidation targets the scoped key only; component tests for empty/loading/error states and pagination; self-contained Playwright coverage that creates and cleans up order/quote fixtures, generates a document from each PDF tab, and observes the persisted row without a page reload on the normal successful-persistence path; a negative case proving another source record's history is absent; `yarn check:client-boundaries` plus the package typecheck/test gate. A successful generate response with no row must remain a valid outcome when best-effort persistence fails.

### Phase 7 — Attachment Storage (Planned)

Uses the existing core `attachments` module — no custom storage infrastructure needed.

1. Create the `pdfDocuments` attachment partition (private, non-public) the first time `/generate` needs it, via a lazy idempotent-create call to `POST /api/attachments/partitions` mirroring `ensureDefaultPartitions`'s pattern (`packages/core/src/modules/attachments/lib/partitions.ts`). There is no existing precedent in this repo for a module registering a new partition from its own `setup.ts` — only the two hardcoded defaults (`productsMedia`, `privateAttachments`) are seeded that way — so this phase does not introduce that as a new pattern; it reuses the partitions API the same way any other caller would.
2. After successful render in `POST /generate`, upload the PDF buffer to `POST /api/attachments` (multipart, partition: `pdfDocuments`, `entityId: 'document_generators:document'`, `recordId: rendered.resource.id` — the wire fields are camelCase; `entity_id`/`record_id` only name the underlying DB columns)
3. Store the returned identifier in the existing nullable `GeneratedDocument.attachment_id` column introduced with Phase 5; Phase 7 requires no additional history-table migration unless the attachment contract itself changes
4. `GET /api/document-generators/documents` history response includes `attachment_id` — client builds download URL as `/api/attachments/file/{attachment_id}`
5. Download button in the widget uses the stored attachment URL when `attachment_id` is present, falls back to on-demand `POST /generate` render otherwise

#### Tenant & data isolation (mandatory)

The `private` partition flag is **necessary but not sufficient** — cross-organization isolation of a stored PDF is enforced by the `organization_id` / `tenant_id` **on the `Attachment` record itself**, not by the partition. The core download route (`GET /api/attachments/file/{id}`) checks `attachment.tenantId === auth.tenantId && attachment.organizationId === auth.orgId` (fail-closed via `isSameScope`; superadmin exempt).

Therefore the upload in step 2 **must** persist the request's `organization_id` and `tenant_id` (derived from `getAuthFromRequest`) onto the attachment record. Requirements:

- The generated PDF contains customer data and amounts; it must never be retrievable from another tenant/organization.
- If the upload omits the scope, the record is either unreachable for regular users (fail-closed 403) or, worse, over-exposed — both are defects. Verify the core `POST /api/attachments` contract actually stamps `organization_id`/`tenant_id` from auth; if it does not, pass them explicitly.
- Every successful production render attempts to write a `GeneratedDocument` using template-derived resource identity (see Phase 5). The same auth scope used there must match the attachment scope so history and file stay consistent.
- This extends the render-path mitigation described in **Tenant & Data Isolation** above: the same `auth`-derived scope now covers data fetch → render → stored file → download.

### Phase 8 — Advanced Templates (Planned)

1. Template versioning — record which template version was used at generation time; archived versions remain renderable
2. Draft watermark — render a "DRAFT" overlay when the source resource is not in a final status

### Out of scope for this spec

> **Product decision, recorded 2026-08-18 — not spec hygiene.** Dropping **Email delivery** and the **Auto-generation trigger** from the initial deliverable is a deliberate call about what this feature ships as, not a tidy-up of the document. Both were drafted as Phase 8/9 items, both are things a user would plausibly expect from "document generators", and cutting them narrows what the first release does. The decision was proposed by @adeptofvoltron in the 2026-08-15 architectural pass and accepted by the spec's author @kriss145 on 2026-08-17, who asked that it be written down as a decision rather than absorbed as a review nit — this paragraph is that record. The reasoning is that each is an independently shippable capability with its own integration surface, and shipping the registry/render/history core first gives both of them a stable base to build on; the cost is that manual download stays the only delivery path until a follow-up spec lands. Re-opening this is a product call, not a spec edit.

The following were previously drafted as Phase 8/9 items in this document. Each is an independently shippable capability, not an incremental extension of the render-registry-history mechanism this spec covers, and each carries its own design surface (a notification/SMTP integration, a public unauthenticated access model, a queue-worker batch contract, an event-subscriber contract, an aggregate-identity model) that deserves its own spec, review, and phasing rather than a sub-bullet here:

- **Email delivery** — send a generated document directly to a recipient email from the widget.
- **Shareable public link** — a time-limited, unauthenticated URL for previewing a document. This is architecturally the opposite of the "resource identity is always server-derived, access always authenticated and scoped" posture established in Phases 5–7 and needs its own threat model, not a bullet point.
- **Bulk generation** — generate documents for multiple records in one action via `@open-mercato/queue`.
- **Auto-generation trigger** — emit `document_generators.document.generated` and generate a document automatically on a domain event (e.g. quote accepted). This is event-subscriber automation, unrelated to template versioning or watermarking.
- **Aggregate documents (one document about N records)** — a consolidated statement or summary covering many source records, e.g. a periodic customer statement over a period's orders. **This is not the same item as "Bulk generation" above**, and the two are easy to confuse because both involve the word "multiple": bulk generation turns 12 orders into 12 documents and preserves the 1:1 model — its problem is *throughput*, solved by a queue worker; an aggregate document turns 12 orders into 1 document and breaks that model — its problem is *identity*, since nothing in this spec can express "about 12 records". The 1:1 assumption is load-bearing in at least seven places here: `TemplateRegistryEntry.resourceId()` returns exactly one id; history stores exactly one `resource_kind` / `resource_id` pair per row; Phase 6's scoped panel filters on that pair supplied together; `resource_label` is an encrypted label for one record and would have to mean something like "customer + period"; the `:tabs` widget entry point launches from a record detail, which an aggregate has none of; `buildDocumentFilename` derives the name from `data.document.number`; and Phase 7's attachment link passes `recordId: rendered.resource.id`. Per @kriss145's 2026-08-17 assessment, the sub-spec for this should be written **after** this one ships, so it can state precisely what it changes against working code rather than against a moving target.

Each of the above should be written up as its own `{date}-{title}.md` spec under `.ai/specs/` when work on it starts, referencing this spec for the registry/rendering/history contracts it builds on.

---

---

## Migration & Backward Compatibility

**Nothing in this feature has been released, so there is nothing to migrate from and no bridge to build.** `packages/document-generators/` does not exist on `develop`; no route, template ID, ACL feature, widget ID, package export, or database table described in this spec has ever been published from this repository. Per `BACKWARD_COMPATIBILITY.md`, the deprecation protocol applies to *contract surfaces that have shipped* — none of these have, so an implementer must **not** write deprecation shims, compatibility re-exports, dual-key translation windows, or dual-emit events for them. Shipping a re-export of an export that never existed is dead code a future reviewer would then have to defend under the deprecation protocol.

What follows is therefore not a migration plan but the set of **target contracts** this build must land on. Several of them are the product of iterations on the closed `feat/document-generators` branch (PR #5170); the decisions survive, the transitional machinery does not.

**Ownership split.** Sales owns `OrdersDocumentService`, `QuotesDocumentService`, their validators and snapshots, the order/quote templates, the two detail widgets, and the `sales.documents.templates.*` translations, contributing them through `sales/document-generators.ts`. The engine package contains no domain directory and resolves no Sales entity. Format mechanics stay in `@open-mercato/document-generators`: `@react-pdf/renderer`, PDF primitives, theme/logo, the Markdown and PDF renderers, the preview/generate routes, MIME and filename output, and history. Domain templates consume the plugin-owned React-PDF dependency through `modules/document_generators/providers/react-pdf`; reusable theme and components live under `modules/document_generators/templates/shared` and are imported directly.

**Where the neutral contracts live.** Neutral template contracts and `BaseDocumentService` ship in `@open-mercato/shared/modules/document-generators` from the first commit, and owning modules import them from there. They are deliberately **not** also re-exported from the `@open-mercato/document-generators` package root: a domain module must be able to declare templates without importing the optional runtime package, and a second import path for the same symbols would create two contract surfaces to keep stable instead of one.

**Namespacing and identifiers.** Built-in template IDs use the global `<module>.<template>` namespace — `sales.order-invoice`, `sales.order-invoice-markdown`, `sales.offer` — so third-party modules can register in their own namespace without colliding. Engine ACL features are `document_generators.documents.view` and `document_generators.documents.generate`. Resource kinds are `sales.order` and `sales.quote`. The generator-plugin key is `document_generators.templates`, matching the module-id convention every other `GeneratorPlugin` follows. Getting these right in the first commit is the whole point of fixing them here: each becomes a frozen or stable contract surface the moment it ships.

**Registry contract.** One `register` method taking a flat `TemplateEntry[]`, with no `registerInternal` / `registerExternal` split and no grouped response. The registry validates each batch before mutating and rejects every duplicate ID, including a byte-identical re-registration — a duplicate global ID means an invalid generated bootstrap or module graph and must fail application startup rather than silently shadow or drop a template. Duplicate diagnostics name both the already-registered module and the incoming one, and point authors at namespacing.

**Optional fields that are optional by design, not for compatibility.** `TemplateMeta.requiredFeatures` and `DocumentTemplateEntry.requiredFeatures` are optional because a template that reads only its own module's data legitimately needs no cross-module feature; a template that loads records owned by another module must declare that module's view feature, and the engine enforces it server-side before any data loader runs. `TemplateLoadContext.translate` and `TemplateDataContext.translate` are optional because external callers invoking `TemplateRegistry.load` directly may have no request translator; when it is absent, `BaseDocumentService` returns the label key rather than selecting a locale or loading a second dictionary. The built-in preview and generate routes always supply the translator from `resolveTranslations()`, and new document services are expected to do the same.

**Contracts that are required, not optional.** `POST /generate` never accepts client-supplied `resource_kind`, `resource_id`, or `resource_label`; `TemplateRegistryEntry.resourceId` and `LoadedDocumentTemplateBase.resource.id` are required, and the template derives all three values from scoped server data. Every `DocumentTemplateEntry` supplies its own `filename` handler — there is no service-level fallback, so filename, `format`, and `load` stay colocated and a multi-format service cannot accidentally reuse a PDF extension for another renderer. `buildDocumentFilename` remains a convenience helper, not a required one.

**Database.** The initial migration creates `document_generators_generated_documents` and its indexes; its `down()` drops them together. There are no deployed rows, no stored ACL grants, and no persisted role configuration referencing any identifier above, so nothing has to be back-filled or renamed.

**What becomes a contract surface once this ships.** After the first release, the following fall under `BACKWARD_COMPATIBILITY.md` and can no longer be changed without the deprecation protocol: the five API route paths and their request/response envelopes, the stable error codes, the template IDs and resource kinds, the two ACL feature IDs, the `sales.document.detail.order:tabs` / `.quote:tabs` widget entries, the `@open-mercato/shared/modules/document-generators` contract exports and the `.../document_generators/utils` barrel, the `document_generators.templates` generator-plugin key, and the `GeneratedDocument` table schema. Implementers should treat the first merge, not this document, as the moment the freeze starts.

## Design Compliance Report — 2026-08-10

> This section evaluates the *design* below against the repo's rules, in preparation for implementation — it is not a report on shipped code, since nothing in this spec has been implemented in this repository (see "Implementation Status").

### Compliance Matrix

| Rule | Status | Notes |
|------|--------|-------|
| No direct ORM relationships between modules | ✅ | History stores resource and attachment identifiers as scalar IDs |
| Filter by organization_id | ✅ | Engine history and Sales-owned data loading use authenticated scope |
| Validate inputs with Zod | ✅ | Generate, preview, and history-list inputs use module validators |
| API routes export openApi | ✅ | All five routes must export OpenAPI metadata |
| Module code in `packages/<name>/` | ✅ | `packages/document-generators/` |
| defaultRoleFeatures in setup.ts | ✅ | |
| Never hardcode user-facing strings | ✅ | All via useT() |
| Generated migrations | ✅ | Entity migration and snapshot must be produced by `yarn db:generate`, not written by hand |
| ACL separation | ✅ | `view` and `generate` permissions are declared and assigned to default roles |
| Embedded lists use `DataTable` and `apiCall` | ✅ | Planned Phase 6 promotes and extends the existing `HistoryList` and its `hooks/history/**` data layer; it does not introduce a custom table or raw fetch path |
| Engine remains decoupled from Sales | ✅ | Sales owns its services, templates, widget adapters and i18n; the engine owns only format/runtime mechanics and reusable UI/toolkit surfaces |
| Frontend client boundary is explicit | ✅ | Planned Phase 6 adds one small orchestration island, keeps widget adapters thin, adds no page-root client component or global provider, and defines hydration/interactivity evidence |

### Non-Compliant / Pending

- _None._

### Verdict

**Design complies with the checklist above for Phases 1–6; none of it is implemented in this repository yet.** Phase 6's design reuses the (also not-yet-built) scoped history service, API, and `DataTable`; it adds no persistence or public host contract and includes explicit client-boundary, tenant-isolation, and integration-test requirements to satisfy once Phase 5 is implemented.

### Design Review — 2026-08-11

A design-time review of Phase 6's plan against Phase 5's plan, conducted while this spec's phases were believed complete on the (since-closed) `feat/document-generators` branch. Kept as a record of that review; re-verify against actual code once each phase is implemented in this repository.

- **Reviewer**: Codex with independent fresh-context scope-cohesion audit
- **Security**: Passed — resource filters only narrow authenticated tenant/organization scope, and missing source identity fails closed without an organization-wide fallback.
- **Performance**: Passed — the embedded list is paginated at 10 rows, reuses the indexed history query, and adds no eager global provider or page-root bundle.
- **Cache**: N/A — Phase 6 uses direct scoped reads and generation-triggered refresh; no cache is introduced.
- **Commands**: N/A — Phase 6 adds no mutation; generation continues through the existing route and history remains best-effort.
- **Risks**: Passed — the spec explicitly distinguishes a refresh attempt from guaranteed persistence and covers stale requests, pagination, and cross-resource isolation.
- **Verdict**: Approved as design — Phase 6 is cohesive with Phase 5 and the existing detail-widget workflow; a separate specification would duplicate the same contracts. Approval is of the plan, not of any implementation.

## Implementation Status

**Every phase below is Not Started in this repository.** `packages/document-generators/` does not exist on `develop`; no line of this feature's code has landed here. Phases 1–4.8 and 5 were previously designed and implemented on the unmerged `feat/document-generators` branch (PR #5170), which was closed on 2026-08-14 for implementation-quality problems in that code, not for problems with the design — so the "Prior design work" column below records design/spec history on that closed branch, not code present in this repository. Treat every phase as a fresh implementation task against the spec text above; do not resurrect or cherry-pick commits from the closed branch.

| Phase | Status | Prior design work (closed PR #5170, not in this repo) | Notes |
|-------|--------|------|-------|
| Phase 1–4.7 | Not Started | 2026-08-12 | Registry, render pipeline, preview/download UI, decentralized Sales templates, and Markdown output |
| Phase 4.8 — Template Access Policy | Not Started | 2026-08-14 | `requiredFeatures` on template metadata, `TemplateAccessPolicy` extracted to `lib/`, catalogue filtering, `403` on render routes, corrected engine ACL IDs and per-route guards |
| Phase 5 — History & Backend Page | Not Started | 2026-08-10 | GeneratedDocument persistence, scoped history endpoint, server-derived resource identity, ACL, backend DataTable, unit and integration coverage |
| Rendering service refactor | Not Started | 2026-08-12 | Shared source and format values are extensible strings; registry prepares format-neutral input; concrete source/input types are colocated with their rendering services; `DocumentRenderer` dispatches through a renderer map |
| Phase 6 — Source-scoped History in Detail Widgets | Not Started | — | Planned; reuses the Phase 5 endpoint and entity without schema changes |
| Phase 7 — Attachment Storage | Not Started | — | Planned |
| Phase 8 — Advanced Templates | Not Started | — | Planned; template versioning + draft watermark only — email/sharing/bulk-generation/auto-trigger moved to "Out of scope for this spec" for their own future specs |

---

## Changelog

| Date | Author | Summary |
|------|--------|---------|
| 2026-08-14 | Codex | Added optional source-module `requiredFeatures` to template declarations and scoped RBAC enforcement before template data loading; filtered catalogue/options by effective access, required Sales order/quote view features, and corrected the unreleased document-generator ACL IDs to `document_generators.documents.view` / `.generate`. |
| 2026-08-14 | Codex | Namespaced the unreleased Sales template IDs as `sales.order-invoice`, `sales.order-invoice-markdown`, and `sales.offer`. Preserved the intentional strict bootstrap invariant that every duplicate ID, including an identical re-registration, fails atomically; diagnostics now identify both modules and direct authors to global module namespacing. |
| 2026-08-12 | Codex | Decentralized domain ownership: moved Sales services/templates/widgets/i18n into `sales`, moved neutral contracts and `BaseDocumentService` into `shared`, retained PDF/Markdown engines and dependencies in the plugin, and registered Sales entries through the existing generated bootstrap. |
| 2026-05-06 | Krzysztof Polak | Spec created — Phases 1–4 designed |
| 2026-05-07 | Krzysztof Polak | Initial compliance report added |
| 2026-05-08 | Krzysztof Polak | Spec updated to match implementation: widget renamed to `quote_pdf_tab` (tab, not action); `PdfGeneratorDrawer` replaced by `TemplatesList` + `PreviewPanel` + `Preview` + `Loader` + `downloadBlob`; data mapper moved to `data/quote-detail/`; `GET /api/document-generators/templates` endpoint added; globalThis-based dual registry (`template-registry.ts`) documented; `generators.ts` plugin (Phase 4.5) added |
| 2026-05-08 | Krzysztof Polak | `templateIds` filtering replaced by `TemplateFilter { category, tags, moduleId }` — templates declare `category`, `tags[]`, `moduleId` at registration; `TemplatesList` accepts `filter` prop instead of `templateIds`; OR logic for tags |
| 2026-05-08 | Krzysztof Polak | `fromRecord` mapper moved from `data/quote-detail/document-data.ts` into each `TemplateRegistryEntry` — template owns its own data mapping; widget passes raw `record` to `TemplatesList`; `document-data.ts` removed; `TemplatesList` resolves mapper from globalThis registry on template selection |
| 2026-05-09 | Krzysztof Polak | Normalization moved server-side: `POST /generate` now accepts `{ template_id, record }` instead of `{ template_id, data }`; `loadTemplate(id, record)` calls `entry.fromRecord(record)` server-side; client no longer needs registry import side effect; template folder convention changed to `templates/<module>/<entity>/templates/<name>/` + `templates/<module>/<entity>/data/`; `QuoteWidgetRecord` exported publicly from package root |
| 2026-05-09 | Krzysztof Polak | Phase 5 implementation plan detailed — files to create/modify, data flow, key implementation notes added to spec; `attachment_id` nullable column added to `PdfGeneratedDocument` (now populated in Phase 7) |
| 2026-05-09 | Krzysztof Polak | Attachment Storage (now Phase 7) rewritten — replaces custom S3/GCS storage with existing core `attachments` module; uses `POST /api/attachments` + `pdfDocuments` partition; download via `/api/attachments/file/{attachment_id}`; no custom storage infrastructure needed |
| 2026-05-09 | Krzysztof Polak | Introduced `BaseDocumentService` base class — `registerTemplate()`, `getEntries()`, `formatDate()` centralised; `QuotesDocumentService` and `OrdersDocumentService` as subclasses; `normalizeRecord` per service replaces standalone `normalize-record.ts` files; `config/registry.ts` uses single `registerInternal([...spread])` call to avoid array clobber; built-in `order-invoice` template added (`OrderInvoiceDocument`); `order_pdf_tab` widget added; `examples/` reference folder added; `scaffold-pdf-templates` skill added; sandbox example PDF implementation removed (superseded by built-in) |
| 2026-05-17 | Krzysztof Polak | **Template metadata hierarchy**: `moduleId` → `module` + `entity`; `category` → `documentType`. `BaseDocumentService` now requires `module` and `entity` abstract fields. Widget filters simplified to `{ entity: 'quotes' }` / `{ entity: 'orders' }`. `TemplateFilter` updated accordingly. `note?: string` field added to `DocumentTemplateEntry` and `TemplateMeta` — free-text description of where the template is used; surfaced as a column on the backend page. |
| 2026-05-17 | Krzysztof Polak | **Split `/generate` into `/preview` and `/generate`** — `POST /api/document-generators/preview` renders PDF with zero side effects (used by `PreviewPanel`); `POST /api/document-generators/generate` is the production endpoint with full side effects (logging, events, future persistence) and accepts optional `resource_kind`, `resource_id`, `resource_label` forward-compatible with Phase 5. Common render logic extracted to `lib/render-pdf.ts`. Download button in `PreviewPanel` calls `/generate`; iframe preview calls `/preview`. Backend page restructured: templates grouped by `module` first, then Internal/External sub-sections; External always visible with empty state when none registered; page title changed to "Available templates". |
| 2026-05-17 | Krzysztof Polak | **Server-side data fetching via `fetchData` hook** — `BaseDocumentService` gains optional `fetchData({ data }, { container })` method called before normalization; `QuotesDocumentService` overrides it to load full quote with line items via raw SQL + DI container (resolves the missing-line-items limitation); `OrdersDocumentService` gains billing address enrichment. **API body field renamed**: `POST /generate` now accepts `data` (was `record`). **`normalizeRecord` renamed to `toTemplateData`** with `{ data }` input shape for consistency. **`filename` method added** to `BaseDocumentService` — derives the PDF download filename from normalized data; `Content-Disposition` header set from the returned value. **`enrichRecord` prop removed** from `PreviewPanel` and `TemplatesList` — no client-side enrichment; widgets pass raw `record` only. **`TemplateEntry` type introduced** (`TemplateMeta & TemplateRegistryEntry`). **`TemplateRegistry` interface** extracted to `interfaces.ts`. **`getMetas()` renamed to `listTemplates()`**. Error handling hardened in `PreviewPanel` (catches promise rejection) and generate route (catches JSON parse errors). QuotePage color scheme updated. |
| 2026-08-08 | Krzysztof Polak | Marked the "Raw SQL in QuotesDocumentService" pending item as resolved — `SalesQuote`/`SalesQuoteLine` are now in DI and loaded via `findOneWithDecryption` (2026-06-11); the raw-SQL workaround was removed, so the ORM layer is no longer bypassed. Pending list is now empty. |
| 2026-08-09 | Krzysztof Polak | Attachment Storage (now Phase 7) — added a mandatory **Tenant & data isolation** subsection: the `private` partition flag alone does not isolate stored PDFs across organizations; the upload must persist `organization_id`/`tenant_id` (from `getAuthFromRequest`) onto the `Attachment` record, since the core download route enforces scope via `isSameScope` (fail-closed, superadmin exempt). Extends the render-path isolation through storage and download. |
| 2026-08-09 | Krzysztof Polak | Phase 5 — renamed the history entity `PdfGeneratedDocument` → `GeneratedDocument` and added `format` (default `'pdf'`) + `mime_type` discriminator columns, so the persistence/history/storage layers are format-agnostic (future `.docx`/`.md` support needs a renderer, not a schema change). Only the data layer is generalized — the render pipeline stays PDF-only; module/package/API/ACL names stay `document_generators`. Table: `document_generators_generated_documents`. |
| 2026-08-09 | Codex | Completed Phase 5 and synchronized the API contract: clients send only `resource_kind` + `resource_id`; `resource_label` is derived from normalized data by the document service and falls back to `resource_id`. Added scoped history persistence/listing, backend history UI, ACL, validators, and regression/integration coverage. |
| 2026-08-09 | Codex | Replaced the mixed `lib/render-pdf.ts` helper with a focused `PdfRenderingService`: routes load templates explicitly, `load()` returns a discriminated `DocumentTemplateSource`, and the service renders an already prepared `LoadedPdfTemplate` into a neutral `RenderedDocument`. Format and MIME remain renderer-owned; `LoadedDocumentTemplateBase` provides the shared seam for a future DOCX variant without a placeholder implementation. Added canonical resource-id derivation and mismatch rejection for history integrity. |
| 2026-08-10 | Codex | Synchronized the normative architecture, API, UI, Phase 5, compliance, and extension sections with the completed implementation. Clarified the deliberately partial format-neutral boundary and the concrete work required for a future DOCX renderer. |
| 2026-08-10 | Codex | Reorganized concrete services into owner folders with local barrels and tests while keeping `base-document-service.ts` flat. Added service-local UUID input schemas for built-in order/quote rendering and made fetch failures fail closed so raw client records can never become PDF source data. |
| 2026-08-10 | Codex | Made locale a required breaking contract across render routes, `TemplateRegistry.load`, `fromRecord`, `BaseDocumentService.toTemplateData`, and `formatDate`; built-in and example documents now format every date with the active request locale and cannot silently fall back to Polish formatting. |
| 2026-08-11 | Codex | Split the combined backend screen into flat Overview, Available templates, and Generation history sidebar pages. The navigation-hidden base route redirects to Overview, which provides cards to both functional pages; history uses the existing paginated API. |
| 2026-08-11 | Codex | Added Markdown as the second output format for `OrdersDocumentService`: `order-invoice-markdown` shares order fetching and normalization with the PDF invoice, renders through `MarkdownRenderingService`, previews as text, downloads as `.md`, and records `format: md` history. Reorganized built-in templates to `<logical-template>/<format>/` while retaining the optional `templates/shared` library for reusable template assets. |
| 2026-08-11 | Codex | Localized built-in Order Invoice and Sales Offer documents through the standard module dictionaries. Render routes now pass the request translator through `TemplateRegistry.load` and `BaseDocumentService`; services build typed `data.labels`, with PDF and Markdown invoice variants sharing the exact same label object. Added optional translator context fields for external-call compatibility and en/pl regression coverage. |
| 2026-08-11 | Codex | Removed client-supplied resource identity from the unreleased generate contract. `resourceId()` and loaded resource IDs are now required; every successful production render attempts history persistence using canonical server-derived kind/id/label. Documented the intentionally global `frame-src blob:` required by extensible `TemplatesList` placements. |
| 2026-08-11 | Codex | Added planned Phase 6 for source-scoped generation history inside the existing order/quote PDF-tab widgets. The phase reuses the scoped history endpoint and DataTable, refreshes after successful generation, adds no schema or route, and moves Attachment Storage, Email & Sharing, and Advanced Templates to Phases 7–9. |
| 2026-08-13 | Codex | Replaced the bundled Inter family with React-PDF's built-in Helvetica. Removed local TTF and generated base64 assets, build-time font generation, runtime registration side effects, and the now-unused `glob` dependency; synchronized built-in templates, examples, and authoring documentation. |
| 2026-08-13 | Codex | Completed request-scoped localization of the document surface: template labels/descriptions and persisted history labels resolve through existing metadata fields, API errors use stable codes plus translated messages, currency uses `Intl.NumberFormat`, and dates use each locale's natural convention in UTC. Removed three dead keys across all locales and corrected the format-neutral templates-page fallback; internal structured log messages remain stable English diagnostics. |
| 2026-08-13 | Codex | Simplified the unreleased template registry to a single `register`/flat-list contract, added atomic duplicate-ID rejection, updated generated bootstrap registration, API/UI consumers, integration coverage, docs, and removed the now-unused internal/external section translations. |
| 2026-08-13 | Codex | Made `filename` a required template-level handler and removed the service-level fallback, keeping filename, format, and loader ownership together for PDF, Markdown, and future formats. Updated Sales registrations, shared contracts/tests, examples, and docs. |
| 2026-08-13 | Codex | Added the stable `modules/document_generators/utils` barrel and package export. Utilities are consumed from the directory contract rather than implementation filenames, allowing internal file renames without cross-module import migrations or deprecation bridges. |
| 2026-08-15 | Claude | Applied `om-spec-writing` architectural review findings: dropped the legacy `SPEC-005` title prefix; split the former Phase 8 (Email & Sharing) and the Phase 9 auto-generation-trigger item out into an explicit "Out of scope for this spec" list — each is an independently shippable capability that needs its own spec, not a sub-bullet here — renumbering the remaining template-versioning/draft-watermark work to Phase 8; added a `500` render-error case to `POST /preview`'s error contract to match `/generate`, since both share the same `DocumentRenderer` pipeline; restructured `Risks & Impact Review` so every risk states severity, affected area, mitigation, and residual risk; added a required follow-up mitigation for the tenant-scoping contract — a shared `fetchData` contract test, not just documented convention — as the residual risk on cross-tenant data isolation; added a new "Sensitive Data & Retention" risk entry flagging the missing GDPR erasure/retention story for `GeneratedDocument` history rows and Phase 7 attachments; and added a "Persisted History Entity" table under Data Contracts as a single at-a-glance schema reference. |
| 2026-08-15 | Claude | Applied `om-pre-implement-spec` findings (see `.ai/specs/analysis/ANALYSIS-2026-08-10-document-generators.md`, verified against the actual current codebase, not the source PR): required `templateRegistry` to persist via a stable `globalThis` key, per two direct repo precedents for exactly this failure mode; added a `document_generators/encryption.ts` declaring `defaultEncryptionMaps` for the GDPR-relevant `resource_label` field; corrected the widget-injection section — the spec previously claimed reuse of an "existing frozen PDF-oriented injection ID" that does not exist; the real spots are Sales' generic `sales.document.detail.order:tabs` / `sales.document.detail.quote:tabs`, today occupied only by an unrelated history widget, and the new widget is an additive second entry on each; required `/generate`'s history-persistence side effect to go through the mutation-guard-registry pattern (`runMutationGuards`/`bridgeLegacyGuard`), following `sales/api/quotes/send/route.ts`; corrected Phase 7's attachment upload field names to the real camelCase wire contract (`entityId`/`recordId`) and replaced its unsupported "seed the partition in `setup.ts`" step with a lazy runtime creation call, since no module in this repo creates a new attachment partition from `setup.ts` today; renamed the generator-plugin key from `document-generators.templates` to `document_generators.templates` to match the module-id-based convention every other `GeneratorPlugin` uses; and added an "Integration Test Coverage" section mapping the 16 existing `TC-DOCUMENT-*` integration specs to the API/UI surface each covers. |
| 2026-08-17 | Claude | Documented the template access layer that shipped in PR #5170 after this spec's last update: added a "Template Access Policy" contract section (omit-vs-reject split, injected `rbacService` authorizer, fail-closed rule, per-request check deduplication, `TemplateAccessDeniedError.requiredFeatures`), added `lib/template-access-policy.ts` to the module structure and architecture diagram, added the missing `403` case to `/preview` and `/generate`, recorded that the catalogue and filter-options endpoints return only the caller's authorized subset, added the three-layer enforcement model plus the route→feature guard map (including why `/preview` is gated by `view` rather than `generate`), and added Phase 4.8 with its unit and `TC-DOCUMENT-010/011/012` verification evidence. Also completed the Integration Test Coverage table with the three specs added after the 16-test snapshot — `TC-DOCUMENT-017` (preview client-error codes), `TC-DOCUMENT-018` (generate client-error codes, asserted to fail before the history write) and `TC-DOCUMENT-019` (filter-options facet shape) — and documented the shared `__integration__` helper and `meta.ts` conventions those specs build on. |
| 2026-08-17 | Claude | Synchronized Phase 5 and Phase 6 with the component and data-layer refactors that landed after Phase 5 was written. Phase 5: recorded the `hooks/**` React Query layer and the route-local `HistoryList`/`TemplatesList` tables as implemented files, corrected the entity column list (`created_at`/`updated_at`, `resource_label` NOT NULL), documented the `{ items, total, page, pageSize }` envelope and the `GeneratedDocumentDto` (flagging that Phase 7 must add `attachment_id` to it), documented the `200`-empty-page answer when no organization is active, stated the deliberate non-DI/non-`makeCrudRoute` instantiation of `GenerationHistoryService`, replaced the stale i18n key list, and fixed two factual errors in the data-flow diagram — the missing request guards plus the Phase 4.8 access gate, and a `GET /documents` query shown scoped by `organization_id` alone while the notes below required both predicates. Phase 6: rewrote steps 1–3 around the existing hooks — extend `useDocumentHistory` with `resourceKind`/`resourceId` in both URL and query key, promote `HistoryList` to module level, and **drop the `refreshToken` counter in favour of invalidating `documentHistoryQueryKey`**, which the data layer already provides — and updated the frontend-architecture rows, verification evidence and compliance note accordingly. Also corrected Phase 4's claim that `TemplateFilter` is applied client-side (it is sent as query parameters) and disambiguated the two same-named `TemplatesList` components. |
| 2026-08-17 | Claude | Completed the `utils/` inventory: the module structure listed 2 of 9 files, omitting the barrel that is the actual cross-module import contract. Recorded all nine with their exported helpers, noted that `groupTemplatesByModule` sits outside the barrel on purpose, stated in Document Services that engine utilities are consumed from the `.../document_generators/utils` export path rather than by filename, and added Phase 4.7 step 7 covering the Markdown escaping helpers and why structural escaping is required for Markdown output but not for React-PDF. |
| 2026-08-17 | Claude | Described the backend list behavior the structure sections implied but never specified. "Backend pages" now covers both tables end to end: the catalogue's `FilterBar` (Resource type + Format) fed by `GET /templates/options` and applied server-side, its seven columns and module grouping; and the history page's three filters, `pageSize` 20, page reset on filter/sort change, nine columns, and the rule that exactly the five fields the API allowlists for `sort` are sortable while the other four set `enableSorting: false` — so the UI cannot offer a sort the server would reject. Recorded that both tables bind their loading state to `isFetching`, which is what makes Phase 6's post-generate invalidation visible instead of silent. Added the previously unlisted `GET /templates/options` to Phase 3 and noted that all five routes export `metadata` + `openApi`. Closed the gap in Phase 6 step 5, whose column set accounted for eight of nine columns: `templateId` is now explicitly omitted from the scoped panel, with the reasoning, and the scoped table inherits the same sortable-field rule. |
| 2026-08-17 | Claude | Completed the registry read contract, which listed three of its five methods. Added the real signatures for `listTemplates(filter?, translate?)`, `getTemplateMetadata(id, translate?)` and `listTemplateFilterOptions(templates?)`, plus a "Where catalogue data comes from" subsection: catalogue and facet reads are pure derivations over the in-memory entry map with no table, record or server-side cache behind them; the translator is what resolves registered dictionary keys into visible labels; facets are the unique `resourceKind` / `format` values sorted with `localeCompare`; and `getTemplateMetadata` is what lets an unknown ID fail as a client error before `load`. Flagged as a normative warning that `listTemplateFilterOptions` defaults to the **entire** catalogue while the route passes the authorized subset — a caller omitting the argument silently reintroduces disclosure of templates the user cannot see, and nothing currently prevents it. Tied the bootstrap-only mutability of the registry to the 5-minute client cache on the facets. |
| 2026-08-17 | Claude | Corrected the widget data contract, which the spec asserted in four places: widgets send `{ id: record.id }` and take `resourceKind` from the injection context, they do not forward the raw record — restated in the TLDR, Overview, both affected Design Decisions rows, the `/preview` and `/generate` request examples, and Phase 4's widget step, with the security rationale (the browser must not be able to influence document contents) made explicit. Replaced the Internationalization section, which still listed four Polish-defaulted keys that no longer match the module's own English-defaulted dictionaries, with the real per-surface key groups and the domain-vs-engine split. |
| 2026-08-17 | Claude | Completed the declaration contracts: added `note?: string` to `TemplateMeta` (already surfaced as a catalogue column), defined `DocumentTemplateEntry` — referenced four times but never specified — and explained why it carries only per-template fields while identity and normalization come from the service, documented the service-level `resourceId` / `resourceLabel` on `BaseDocumentService` and the role of `getEntries()` in merging both halves into a flat `TemplateEntry`, and declared the named `UnknownTemplateError` / `DuplicateTemplateError` the routes map to status codes. |
| 2026-08-17 | Claude | Added an "API Contracts → Shared conventions" section: the three edge helpers every route reuses (`parseJsonBody`, `requireOrganization`, `documentResponse`), the full stable error-code table with the status each maps to, and the RFC 5987 `Content-Disposition` contract with its ASCII fallback — including the consequence that `/preview` also sends `attachment`. Flagged as a known inconsistency that `GET /documents` alone answers with untranslated prose in the `error` field instead of a stable code. Expanded the `GET /templates` response example from three fields to the real `TemplateMeta`, named the `invalid_query` code in its error list, and added `api/_shared/**` plus the previously missing `templates/options/route.ts` to the module structure. |
| 2026-08-17 | Claude | Reworked every "Done"/✅ status claim into "Planned"/"Not Started": `packages/document-generators/` does not exist anywhere in this repository, and the prior implementation this spec was synced against (2026-08-17 sync above) lived only on the closed, unmerged `feat/document-generators` branch (PR #5170), closed by Bernard for implementation-quality problems in that code, not for problems with the design. Changed every Phase 1–5/4.5–4.8 heading from `✅` to `(Planned)`; added a status callout at the top of the Implementation Plan and rewrote the Implementation Status table so every phase reads "Not Started," with a "Prior design work (closed PR #5170, not in this repo)" column replacing the old Date column so those dates aren't mistaken for work done here; renamed Phase 5's "Implemented files"/"Updated files" to "Files to add"/"Files to update"; reframed "Final Compliance Report" as "Design Compliance Report" and its Verdict to state the design (not any implementation) is compliant; relabeled the Phase 6 review as a "Design Review" of a plan, not of shipped code; and reframed "Integration Test Coverage" as required coverage each phase must ship rather than coverage already in place. No normative content (contracts, decisions, risk mitigations) changed — only the status framing. |
| 2026-08-17 | Claude | Applied the three findings from the re-run `om-pre-implement-spec` audit (`.ai/specs/analysis/ANALYSIS-2026-08-10-document-generators.md`): `/generate`'s "Mutation guards" paragraph now explicitly excludes `sales/api/quotes/send/route.ts`'s `afterSuccessCallbacks` loop from the "follow this reference" instruction, since that loop has no per-callback try/catch and could turn a successful render into a client-facing `500` — points implementers to `packages/shared/src/lib/crud/factory.ts`'s try/catch-and-log version instead; the Encryption section now states `document_generators/encryption.ts` must participate in fail-closed bootstrap discovery, per `.ai/lessons/system-encryption-map-discovery-must-fail-closed.md`; and `/generate`'s contract now states best-effort persistence covers an absent history row only, never one written with an unencrypted `resource_label`, per `.ai/lessons/keep-fallible-document-preparation-outside-encryption.md`. |
| 2026-08-18 | Claude | Applied the ten findings from the 2026-08-18 `om-auto-review-pr` re-review of head `e82d52daa`. **Blocker:** `resource_label` was required to be encrypted at rest while the same column was offered as a SQL-sortable field in the `GET /documents` allowlist, the backend history table and Phase 6's scoped panel — `ORDER BY` over ciphertext sorts nothing a user can read. Resolved by dropping `resource_label` from the `sort` allowlist rather than adopting the bounded in-memory sort (`packages/shared/src/lib/query/encrypted-sort.ts`), whose `OM_ENCRYPTED_SORT_MAX_ROWS` cap would make `total` and page boundaries approximate for a list whose natural order is `generated_at DESC`; the decision, its rationale and the escape hatch if the requirement returns are recorded in Data Contracts → Encryption and as a Design Decisions row, and the Resource column now sets `enableSorting: false` on both history surfaces. **Majors:** Phase 5's read path now specifies `findAndCountWithDecryption` instead of raw `em.findAndCount`, which would have rendered ciphertext into the history table; "Migration & Backward Compatibility" was rewritten for a from-scratch build — it prescribed deprecation re-exports for root exports that never shipped, so it now states that no released surface exists, keeps the closed branch's decisions as target contracts, and lists what becomes a frozen contract surface at first merge instead; `GET /documents`'s error envelope is specified as `400 invalid_query` with a translated message rather than recorded as a "known inconsistency" the client cannot branch on; and the stale `document-generators-decoupling.test.ts` reference now points at the real `packages/core/src/__tests__/module-decoupling.test.ts`. **Minors:** converted Phase 4.7 and 4.8's step lists from past-tense completed-work prose to the noun form every other phase uses; brought the TLDR scope list and Proposed Solution up to the five-route reality (`/templates/options` and `/preview` were missing); recorded the Email-delivery and auto-generation-trigger descoping as an explicit product decision with its provenance rather than as spec hygiene, per @kriss145's 2026-08-17 ask; made `listTemplateFilterOptions`' `templates` parameter **required** so a caller can no longer derive facets from the entire catalogue and silently disclose templates the user cannot see, with `TC-DOCUMENT-020` asserting the same guarantee behaviorally; and added a fifth "Out of scope" bullet distinguishing aggregate documents (one document about N records — an identity problem) from the already-parked bulk generation (N documents — a throughput problem), enumerating the seven places the 1:1 assumption is load-bearing, per @kriss145's 2026-08-17 follow-up. **Nits:** corrected "expression index" to composite b-tree index with a descending trailing column, and flagged `GenerationHistoryService`'s deliberate non-DI construction as requiring explicit sign-off at code-review time, closing the last open item from the `om-pre-implement-spec` audit. Added `TC-DOCUMENT-020` and `TC-DOCUMENT-021` to the required integration coverage. |
