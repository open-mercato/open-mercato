# SPEC-005: Document Generators

## TLDR
**Key Points:**
- The `@open-mercato/document-generators` module is a reusable document generation engine with built-in PDF and Markdown rendering.
- A user opens a document tab contributed by the owning domain module, picks a template, previews it, then downloads the final file.
- Sales contributes the first order and quote templates without making the rendering package depend on Sales.

**Scope:**
- Universal template registry — class-based singleton populated by module convention files, with fail-fast duplicate-ID detection
- Template metadata hierarchy: `module` → `resourceKind` → logical template → `format` (`pdf` | `md`); `documentType` describes the business purpose (`offer`, `invoice`, `contract`)
- Widget passes raw `context.record` to the API — optional `fetchData` hook enriches data server-side (e.g. fetches line items via DI container); `toTemplateData` normalizes afterward
- `GET /api/document-generators/templates` — lists available templates for client-side consumption
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

The widget passes raw `context.record` to the API. `templateRegistry.load()` runs optional `fetchData`, normalizes through `fromRecord`, loads an extensible template source, and derives filename and resource identity. `DocumentRenderer` receives only `{ format, source, data }`, selects the registered rendering service from its format map, and returns format, MIME type, and bytes. The API route combines that output with filename and resource metadata.

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
3. **Four API routes**:
   - `GET /api/document-generators/templates` — returns `TemplateMeta[]`
   - `POST /api/document-generators/preview` — accepts `{ template_id, data }`, renders the selected format, returns a stream; **zero side effects**
   - `POST /api/document-generators/generate` — accepts `{ template_id, data }`, renders the selected format and persists generation history from server-derived resource identity on a best-effort basis
   - `GET /api/document-generators/documents` — returns paginated, scoped generation history
4. **Live preview** — `PreviewPanel` renders PDF blob URLs in the native browser PDF viewer with an open-in-new-tab fallback; Markdown renders as source text. Native Chromium PDF rendering is incompatible with a sandboxed Blob iframe, so the preview boundary is instead restricted to a Blob created from the authenticated `application/pdf` response protected by `nosniff` and `no-store`. Download calls `POST /generate` separately through `useGuardedMutation` and supports `Cmd/Ctrl+Enter`.
5. **Generator plugin** (`generators.ts`) — `document-generators.templates` plugin enables modules to register templates via `mercato generate registry`.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Templates as code (JSX), not database config | Git-versioned, full typographic control, no visual editor required |
| Data from `context.record`, not a fetch | Widget already receives full record from the framework — only `id` is strictly needed when `fetchData` is defined |
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
| `fromRecord` in registry entry calls `toTemplateData` (server-side) | Template owns its normalization logic — widget is fully decoupled from data shape. Adding a new template for `quotes` requires zero changes to the widget. |
| No `enrichRecord` prop in widgets | Widget passes raw `record` only; all enrichment (data fetching + normalization) happens server-side via `fetchData` + `toTemplateData` |
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
    ├── components/
    │   ├── TemplatesList.tsx        # Fetches templates, filters, shows list + opens PreviewPanel
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
    ├── utils/
    │   ├── downloadBlob.ts
    │   └── formatDate.ts
    ├── generators.ts                # GeneratorPlugin for document-generators.templates (code-gen)
    ├── api/
    │   └── document-generators/
    │       ├── documents/route.ts   # GET scoped generation history
    │       ├── generate/route.ts    # POST render, persist history, download
    │       ├── preview/route.ts     # POST side-effect-free preview
    │       └── templates/route.ts   # GET template metadata
    ├── backend/document-generators/
    │   ├── page.tsx                 # hidden base route redirecting to /overview
    │   ├── overview/page.tsx        # module overview with navigation cards
    │   ├── templates/page.tsx       # template overview
    │   └── history/page.tsx         # paginated generation history
    └── acl.ts
```

---

## Data Contracts

### Template Registry

A single registry managed by `TemplateRegistry` class (singleton `templateRegistry`):

```ts
// Runtime contract: @open-mercato/document-generators
interface TemplateRegistry {
  register(entries: TemplateEntry[]): void            // called by generated bootstrap; rejects duplicate IDs atomically
  listTemplates(): TemplateMeta[]
  load({ id, data }, { container, auth }): Promise<LoadedTemplate> // fetchData → load source → normalize → derive metadata
}
```

> Sales is registered through `packages/core/src/modules/sales/document-generators.ts`. Generated bootstrap code calls `register(...)`; route files do not import a domain registry for side effects.
> Template IDs use the global `<module>.<template>` namespace. Duplicate registration is intentionally never idempotent: a second registration of the same ID, including the same entry, is treated as an invalid bootstrap graph and fails before the copied registry state is committed.
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

// Every DocumentTemplateEntry registered by a service owns its format-specific
// filename handler; BaseDocumentService does not provide a filename fallback.

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
- each registered template owns its required `filename({ data })`; the service provides no format-specific filename fallback

`formatDate(iso, locale)`, `formatMoney(amount, currency, locale)`, and `buildDocumentFilename(data, prefix, extension)` remain standalone engine utilities. Dates use the locale's natural convention with an explicit UTC time zone; money uses `Intl.NumberFormat` for locale-correct separators, symbols, and currency placement; filenames use normalized `data.document.number` and fall back to `{prefix}.{extension}`. Both render routes resolve the active locale and translator server-side and thread them through `TemplateRegistry.load` → `fromRecord` → `toTemplateData`. Document services build typed `data.labels` during normalization, so PDF and Markdown variants within one service share the same request-scoped fetching, formatting, and translated labels. Built-in template `label` and `description` values are standard dictionary keys resolved by the registry for the templates endpoint and generation history; literal values from external templates remain valid through translator fallback. User-facing route errors return stable codes plus translated messages, while structured server log messages remain stable English operator diagnostics. Translation values remain in the owning module's standard `i18n/<locale>.json` dictionaries; templates do not load private locale files.

---

## API Contracts

### GET /api/document-generators/templates

Returns all available templates. The global catalogue remains the default; callers may ask the backend to narrow the in-memory registry by template metadata.

**Optional query parameters:**
- `resource_kind` — exact resource kind, for example `sales.order`
- `document_type` — exact document type, for example `invoice`
- `format` — exact renderer format, for example `pdf` or `md`
- `tags` — repeatable tag value; multiple values use any-match semantics

**Response:**
```json
[
  { "id": "sales.offer", "label": "Sales Offer", "description": "..." },
  { "id": "custom-invoice", "label": "Custom Invoice", "description": "..." }
]
```

**Errors:**
- `400` — invalid empty filter value
- `401` — unauthorized

---

### GET /api/document-generators/templates/options

Returns the sorted, unique values used to construct the template catalogue filters without returning template metadata.

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
  "data": { /* raw context.record */ }
}
```

**Response:** `Content-Type: application/pdf` — binary PDF stream with `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.

**Errors:**
- `400` — invalid JSON, missing `template_id` / `data`, or unknown template ID
- `401` — unauthorized
- `409` — no active organization

---

### POST /api/document-generators/generate

Generates a PDF and records generation history on a best-effort basis. Used by the download button in `PreviewPanel` and by external modules calling the API directly.

**Request:**
```json
{
  "template_id": "sales.offer",
  "data": { /* raw context.record — at minimum { id } when fetchData is defined */ }
}
```

The loaded template must derive `resourceKind`, canonical `resourceId`, and an optional `resourceLabel` from normalized server-side data. The route always attempts to persist history after a successful render and never accepts resource identity from the client.

**Response:** `Content-Type: application/pdf` — binary PDF stream with `Content-Disposition: attachment; filename="<derived>"`, `Cache-Control: no-store`, and `X-Content-Type-Options: nosniff`.

**Errors:**
- `400` — invalid input or unknown template ID
- `401` — unauthorized
- `409` — no active organization
- `500` — render error

### GET /api/document-generators/documents

Returns paginated generation history filtered by the authenticated tenant and organization. Optional `resource_kind`, `resource_id`, `template_id`, `generated_by`, `generated_from`, and `generated_to` query parameters narrow the result. `sort` accepts `resource_label`, `template_label`, `format`, `generated_by`, or `generated_at`; `sort_direction` accepts `asc` or `desc`. Resource-detail consumers must send both resource filters together so a history panel can never mix records from different source types that happen to share an identifier.

---

## UMES Extension Points

| Extension Point | Usage |
|----------------|-------|
| **Widget Injection** | Any module's detail view — each widget registers its own injection spot in `injection-table.ts` |
| **Backend Pages** | `/backend/document-generators` — hidden redirect; `/backend/document-generators/overview` — module overview; `/backend/document-generators/templates` — template overview; `/backend/document-generators/history` — generation history |
| **ACL Features** | `document_generators.view`, `document_generators.generate` |

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

| Key | Default |
|-----|---------|
| `document_generators.generate.button` | `Generuj PDF` |
| `document_generators.template.select` | `Wybierz szablon` |
| `document_generators.preview.title` | `Podgląd dokumentu` |
| `document_generators.generate.generating` | `Generowanie...` |

---

## UI/UX

### Widget pattern (any module)

A document tab (retaining its existing frozen PDF-oriented injection ID) is injected into detail views via `injection-table.ts`. The tab renders a resource-scoped document panel:

1. **Template list** — card grid fetched from `GET /api/document-generators/templates`, filtered by `TemplateFilter` (`resourceKind`, `documentType`, `format`, `tags`).
2. **Preview dialog** (`PreviewPanel`) — calls `POST /api/document-generators/preview`; PDF uses the native browser viewer with an open-in-new-tab fallback and Markdown is displayed as source text. Chromium cannot render the Blob PDF viewer in a sandboxed iframe, so the Blob is constrained by authenticated access, PDF MIME, `nosniff`, and `no-store`. The format-aware download button and `Cmd/Ctrl+Enter` call `POST /api/document-generators/generate` through `useGuardedMutation`; download Blob URLs are revoked on the next task so browsers can consume the click first.
3. **Source history** (Phase 6) — a compact `DataTable` below the template list calls `GET /api/document-generators/documents` with both `resource_kind` and `resource_id`, showing only documents generated for the current order, quote, or other source record. A successful production download refreshes this table without reloading the detail page.

### Backend pages

- `/backend/document-generators` — navigation-hidden redirect to `/backend/document-generators/overview`, preventing an extra parent level in the sidebar.
- `/backend/document-generators/overview` — module overview with navigation cards for templates and generation history.
- `/backend/document-generators/templates` — template overview grouped by owner module.
- `/backend/document-generators/history` — history table backed by the paginated `GET /api/document-generators/documents` endpoint.

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

### Data Integrity

- **Slow render**: `renderToBuffer` is synchronous and may be slow for large documents. Acceptable for MVP; Phase 8 moves bulk generation to `@open-mercato/queue`, while any future move of single-document rendering requires a separate asynchronous-download UX decision.

### Tenant & Data Isolation

- **Risk exists and is mitigated.** Both built-in document services (`QuotesDocumentService`, `OrdersDocumentService`) query tenant-scoped records: `sales_quotes`, `sales_quote_lines`, `sales_orders`, `CustomerEntity`, `CustomerAddress`. A user with `document_generators.view` could otherwise retrieve data from a different tenant by submitting an arbitrary UUID.
- **Mitigation:** `getAuthFromRequest` is called in both route handlers (`/generate`, `/preview`). The resulting `AuthContext` is propagated through `templateRegistry.load → fetchData` via `ctx.auth`; the loaded template is then passed to `PdfRenderingService.render`. Each built-in service validates its local input as `{ id: UUID }`, ignores all other client-supplied record fields, and queries by `id`, `tenant_id`, and `organization_id`. Missing scope, invalid input, inaccessible records, and database failures all reject the render pipeline — raw request data is never used as a fallback.
- **Module-owned `DocumentService` contract:** any module subclassing `BaseDocumentService` from `@open-mercato/shared/modules/document-generators` **must** apply the same tenant scoping in `fetchData`. The `ctx.auth` argument is available for exactly this purpose. Implementations that ignore it are considered a security defect.

### Font Loading

- Built-in templates use React-PDF's standard Helvetica family, so they do not depend on filesystem paths, generated files, runtime registration, or bundled font assets.

### Operational

- `@react-pdf/renderer` adds weight to the server bundle. Template entries keep sources lazy through `entry.load()`.

### Browser Content Security Policy

- PDF preview bytes come only from the authenticated same-origin preview API and are exposed to the iframe through a local Blob URL.
- `frame-src blob:` remains in the app-wide CSP because `TemplatesList` is a public extension component that external modules may render on any backend route. Limiting the directive to the two built-in sales detail routes would silently break supported custom injection spots.
- The create-app template must retain the same directive and rationale as `apps/mercato/next.config.ts`.

---

## Implementation Plan

### Phase 1 — Foundation ✅

1. Package scaffold (`package.json`, `build.mjs`, `tsconfig.json`)
2. `acl.ts` with `document_generators.view`, `document_generators.generate`
3. `setup.ts` with `defaultRoleFeatures`
4. Module `index.ts`

### Phase 2 — Templates & Registry ✅

1. Shared `document-generators` contracts plus the engine-owned `lib/template-registry.ts`
2. `BaseDocumentService` in `@open-mercato/shared/modules/document-generators`
3. Sales-owned `QuotesDocumentService`, local validation, and `sales.offer` registration through `sales/document-generators.ts`
4. Generated bootstrap registration in the engine-owned registry
5. `templates/shared/theme.ts` + `templates/shared/components/Logo.tsx` — shared design tokens and brand components exported publicly
6. Sales-owned `document-generators/templates/quotes/sales-offer/` with shared types plus PDF implementation using React-PDF's built-in Helvetica family

### Phase 3 — API ✅

1. `GET /api/document-generators/templates` — returns `TemplateMeta[]`
2. `POST /api/document-generators/preview` — side-effect-free rendering for the iframe
3. `POST /api/document-generators/generate` — rendering, download headers, identity verification, and best-effort history
4. `GET /api/document-generators/documents` — scoped, paginated generation history

### Phase 4 — UI Components ✅

1. `components/TemplatesList.tsx` — fetches templates via `GET /api/document-generators/templates`, applies `TemplateFilter` client-side, renders card list
2. `components/TemplatesListView.tsx`, `TemplatesListLoader.tsx`, `TemplateListItem.tsx` — list sub-components
3. `components/PreviewPanel.tsx` — fullscreen dialog: previews through `POST /preview`; download calls `POST /generate`
4. `components/Preview.tsx` — iframe rendering a blob URL
5. `components/Loader.tsx` — spinner
6. `utils/downloadBlob.ts` — triggers browser file download
7. Sales-owned `widgets/injection/document-generators-quote-tab/` — filter: `{ resourceKind: 'sales.quote' }`
8. Sales-owned `widgets/injection-table.ts` — injection spot mapping

### Phase 4.5 — External Template Code-Gen ✅

1. `generators.ts` — `document-generators.templates` GeneratorPlugin
2. Convention file pattern: `document-generators.ts` in consuming module exports `templates: TemplateRegistryEntry[]`
3. `mercato generate registry` produces `document-generators.generated.ts` that calls `register(...)`

### Phase 4.6 — Orders Built-in Template ✅

1. Sales-owned `OrdersDocumentService` (`resourceKind: 'sales.order'`) with local validation
2. Sales-owned `document-generators/templates/orders/order-invoice/` with PDF and Markdown implementations
3. `sales/document-generators.ts` exports order and quote entries to the generated registry
4. Sales-owned `widgets/injection/document-generators-order-tab/` filters by `sales.order`
5. `sales/widgets/injection-table.ts` contributes the existing order detail spot
7. Complete working invoice example for external template authors (`document-generators.ts`, service, template, widget, injection-table) lives under `apps/docs/static/examples/document-generators/` and is described in the Document Generators docs section

### Phase 4.7 — Markdown Output ✅

1. Added required, extensible `format` metadata and optional per-template filename overrides. The pipeline never infers PDF from a missing format.
2. Added `MarkdownTemplateSource`, `MarkdownRenderInput`, and `MarkdownRenderingService` colocated in the Markdown engine folder.
3. Added `DocumentRenderer` shared by preview and generate routes, with a format-to-renderer map and format-neutral `DocumentRenderInput`.
4. Reorganized built-in templates to `<logical-template>/<format>/` while keeping normalized data types at the logical-template level.
5. Added `sales.order-invoice-markdown` to `OrdersDocumentService`; it shares the order fetch, normalization, resource identity, and history pipeline with the PDF invoice.
6. Added Markdown source preview and format-aware downloading in `PreviewPanel`.

### Phase 5 — History & Backend Page ✅

#### Implemented files

| File | Description |
|------|-------------|
| `data/entities.ts` | `GeneratedDocument` entity — `id`, `organization_id`, `tenant_id`, `resource_kind`, `resource_id`, `resource_label`, `template_id`, `template_label`, `format` (default `'pdf'`), `mime_type` (default `'application/pdf'`), `generated_by`, `generated_at`, `attachment_id` (nullable — populated in Phase 7). Table `document_generators_generated_documents` |
| `data/validators.ts` | Zod schemas: `generateSchema` accepts only template identity + data; `listDocumentsSchema` supports scoped history filters, date ranges, and sorting |
| `services/generation-history-service/` | Scoped creation plus filtered, sorted, paginated listing of generation history |
| `api/document-generators/documents/route.ts` | Paginated history endpoint with resource/template/user/date filters and allowlisted sorting; exports `openApi` + `metadata` |
| `migrations/Migration20260809121904_document_generators.ts` | Generated migration accompanied by the module snapshot |

> **Format-agnostic by design.** The entity is named `GeneratedDocument` and carries `format` + `mime_type` discriminators. `BaseDocumentService` is format-neutral in shared; the plugin owns both `PdfRenderingService` and `MarkdownRenderingService`, including their dependencies and output metadata.

#### Updated files

| File | Change |
|------|--------|
| `api/document-generators/generate/route.ts` | Persist the neutral render result through `GenerationHistoryService` after a successful render, using only canonical template-derived resource identity |
| `acl.ts` | Add `document_generators.generate` feature |
| `setup.ts` | Add `document_generators.generate` to `superadmin` + `admin` role features |
| `backend/document-generators/page.tsx` | Navigation-hidden compatibility redirect to the overview route |
| `backend/document-generators/overview/page.tsx` | Module overview with cards linking to the template list and generation history |
| `backend/document-generators/templates/page.tsx` | Thin page shell delegating catalogue rendering to its route-local `components/TemplatesList.tsx` |
| `backend/document-generators/history/page.tsx` | Thin history page shell delegating the filtered, sortable table to route-local `components/HistoryList.tsx` and `hooks/history/**` |
| `i18n/*.json` | New keys: `document_generators.history.title`, `document_generators.history.resource`, `document_generators.history.template`, `document_generators.history.generatedBy`, `document_generators.history.generatedAt`, `document_generators.history.empty` |

#### Data flow

```
Widget → POST /generate { template_id, data }
         ├── resolveTranslations() → required active locale
         ├── templateRegistry.load(..., { locale }) → LoadedTemplate + canonical resource identity
         ├── DocumentRenderer.render(template.render) → RenderedDocument
         ├── GenerationHistoryService.create(GeneratedDocument { format, mime_type, ... }) [best effort]
         └── returns PDF stream

GET /api/document-generators/documents?resource_kind=X&resource_id=Y&page=1&pageSize=20
    └── em.find(GeneratedDocument, { organization_id, [resource_kind, resource_id] }, { orderBy: generated_at DESC })
```

#### Key implementation notes

- Use `createRequestContainer()` from `@open-mercato/shared/lib/di/container` to get `em` in the generate route
- Use `getAuthFromRequest(request)` from `@open-mercato/shared/lib/auth/server` to get `auth.userId` for `generated_by`
- `resourceId()` is required for every registered template and derives the canonical source ID after server-side fetching and normalization
- `resource_kind`, `resource_id`, and `resource_label` are never accepted by `POST /generate`; the registry derives all three values, and an unavailable label falls back to the canonical resource ID
- `GET /documents` must always filter by both `tenant_id` and `organization_id` — use `getAuthFromRequest` for tenant scoping
- The history table keeps the resource lookup index and uses `(tenant_id, organization_id, generated_at DESC)` for the newest-first scoped list; it does not keep a redundant index on `organization_id` alone
- The initial table-creation migration defines `down()` by dropping the generated-documents table, so a pre-release rollback removes the table and its indexes together
- DB migration was generated with `yarn db:generate`; the migration and module snapshot are committed together, while unrelated module output is discarded

#### Format extensibility boundary

The implementation supports two concrete formats through a format-neutral dispatch boundary:

- Shared declares only the extensible `DocumentTemplateSource { type: string; [key: string]: unknown }` contract.
- `LoadedDocumentTemplateBase` carries normalized data, filename, template identity, and resource identity independently of a renderer.
- PDF-specific source and input types live in `pdf-rendering-service/types.ts`; Markdown-specific types live in `markdown-rendering-service/types.ts`.
- `DocumentRenderer` selects engines through a format-to-renderer map without teaching the template registry or API routes about concrete formats.
- `RenderedDocument` and `GeneratedDocument` are format-neutral, so history does not require a schema change for another output type.

Adding DOCX later requires a colocated DOCX source/input type, a DOCX rendering service, one renderer-map entry, and a UI preview/download decision. Shared contracts and `TemplateRegistry` remain unchanged. DOCX generation itself remains outside this spec's implemented scope.

### Phase 6 — Source-scoped History in Detail Widgets (Planned)

Expose the history already captured in Phase 5 where users work with the source record. The existing Sales-owned order and quote document widgets gain a compact history section below the template cards; other source widgets can adopt the same composition without introducing a new injection spot or changing the host module.

#### UI composition

1. Extract the fetch/table behavior in `components/HistoryList.tsx` into a reusable resource-aware form with optional `resourceKind`, `resourceId`, `pageSize`, and `refreshToken` inputs. The backend history page keeps its existing unfiltered behavior and page size.
2. Add an internal `ResourceDocumentsPanel` that composes `TemplatesList` with the resource-filtered history list. It owns a monotonic refresh token and increments it only after `POST /generate` succeeds.
3. Add an optional `onGenerated` callback through `TemplatesList` → `PreviewPanel`. Invoke it after the generated bytes have been accepted and the download has been initiated; preview-only requests must not refresh history because they have no persistence side effect. The callback requests a refresh but does not guarantee a new row, because Phase 5 history persistence remains best-effort.
4. Replace the direct `TemplatesList` usage in `document-generators-order-tab/widget.client.tsx` and `document-generators-quote-tab/widget.client.tsx` with `ResourceDocumentsPanel`, passing the canonical widget context pair: `resourceKind` and `record.id`.
5. The scoped table shows Template, Format, Generated by, and Generated at. It omits Resource, Resource type, Resource ID, and History ID because those values are redundant in a single-record context. It uses `DataTable`, `formatDateTime`, translated copy, pagination, and the standard loading/error/empty states; `pageSize` defaults to 10 and remains at or below 100.
6. Phase 6 is read-only. Rows have no download action until Phase 7 supplies an `attachment_id`; generating another document remains the only mutation and continues through the existing authenticated, feature-gated API route.

#### Data and isolation contract

```text
Order/quote detail widget
  -> ResourceDocumentsPanel { resourceKind, resourceId }
     -> TemplatesList -> POST /generate { template_id, data: { id } }
     -> HistoryList -> GET /documents?resource_kind=<kind>&resource_id=<id>&page=1&pageSize=10
                         -> GenerationHistoryService.listAndCount
                            filters tenant_id + organization_id + resource_kind + resource_id
```

- The browser-provided filters are narrowing inputs only. They never replace the authenticated `tenant_id` and `organization_id` predicates enforced by `GenerationHistoryService`.
- Both source filters are mandatory for the detail-widget variant. Missing `resourceKind` or `resourceId` suppresses the request and renders no cross-resource fallback.
- A resource history refresh must preserve the current page when it is still valid and fall back to the last valid page after deletions or future retention work reduce the result count.
- No schema, migration, ACL, event, or new API route is required. The existing `document_generators.view` guard and history endpoint remain authoritative.

#### Frontend architecture contract

| Surface | Server root | Client islands | Data owner | Notes |
| --- | --- | --- | --- | --- |
| Sales order/quote detail PDF tab | Existing sales detail host | Existing injection widget, `ResourceDocumentsPanel`, `TemplatesList`, resource-aware `HistoryList`, `PreviewPanel` | Document Generators APIs | No page-root or provider change; the widget remains lazy at its existing frozen injection spot. |
| `/backend/document-generators/history` | Existing generated backend route | Existing `DocumentGenerationHistoryPage` and shared `HistoryList` | `GET /api/document-generators/documents` | Retains organization-wide behavior by omitting resource filters. |

| `"use client"` file | Reason | Heavy dependencies / guardrail |
| --- | --- | --- |
| `components/ResourceDocumentsPanel.tsx` | Owns refresh state shared by template generation and history | Small orchestration island; no renderer or PDF dependency imported directly. |
| `components/HistoryList.tsx` | Fetching, pagination, and DataTable state | Reuses existing DataTable; keep resource-specific column selection memoized and the file below 300 LOC. |
| Existing order/quote widget clients | Injection host adapters | Remain thin context adapters; no data fetching or duplicated table logic. |

- Budget: zero new page-root client components, zero global providers, zero heavy browser libraries at a page/provider root, and zero touched client files above 300 LOC.
- Verification evidence: component tests for filtered URLs, empty/loading/error states, pagination, and refresh-token behavior; self-contained Playwright coverage that creates and cleans up order/quote fixtures, generates a document from each PDF tab, and observes the persisted row without a page reload on the normal successful-persistence path; a negative case proving another source record's history is absent; `yarn check:client-boundaries` plus the package typecheck/test gate. A successful generate response with no row must remain a valid outcome when best-effort persistence fails.

### Phase 7 — Attachment Storage (Planned)

Uses the existing core `attachments` module — no custom storage infrastructure needed.

1. Create `pdfDocuments` attachment partition (private, non-public) via `POST /api/attachments/partitions` or seeded in `setup.ts`
2. After successful render in `POST /generate`, upload the PDF buffer to `POST /api/attachments` (multipart, partition: `pdfDocuments`, `entity_id: 'document_generators:document'`, `record_id: rendered.resource.id`)
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

### Phase 8 — Email & Sharing (Planned)

1. Send PDF directly to a recipient email from the widget — attach generated PDF or include storage URL
2. Shareable link — time-limited public URL for previewing a document without login
3. Bulk generation — generate PDFs for multiple records in a single action via queue worker

### Phase 9 — Advanced Templates (Planned)

1. Template versioning — record which template version was used at generation time; archived versions remain renderable
2. Draft watermark — render a "DRAFT" overlay when the source resource is not in a final status
3. Auto-generation trigger — emit `document_generators.document.generated` event on resource status change (e.g. quote accepted)

---

---

## Migration & Backward Compatibility

The unreleased implementation was decentralized before merge. Sales now owns `OrdersDocumentService`, `QuotesDocumentService`, their validators and snapshots, the order/quote templates, the two detail widgets, and the corresponding `sales.documents.templates.*` translations. It contributes namespaced template IDs and unchanged resource kinds through `sales/document-generators.ts`. The engine package no longer contains a domain directory or resolves any Sales entity.

Neutral template contracts and `BaseDocumentService` moved to `@open-mercato/shared/modules/document-generators`; owning modules import them directly from shared. The previous root exports from `@open-mercato/document-generators` remain as deprecated compatibility re-exports for at least one minor version, while the old internal service/type paths are no longer used by first-party code. Format mechanics stay in `@open-mercato/document-generators`: `@react-pdf/renderer`, PDF primitives, theme/logo, Markdown/PDF renderers, preview/generate routes, MIME/filename output, and history. Domain templates consume the plugin-owned React-PDF dependency through `modules/document_generators/providers/react-pdf`, while reusable theme and components remain under `modules/document_generators/templates/shared` and are imported directly. Built-in templates use React-PDF's standard Helvetica family and ship no local font assets.

No database migration is required. Before the first release, the built-in template IDs were namespaced as `sales.order-invoice`, `sales.order-invoice-markdown`, and `sales.offer` so third-party modules can use their own namespace without colliding with Sales. No deployed history rows or published template-ID contract exists to migrate. Resource kinds (`sales.order`, `sales.quote`), API routes, ACL features, and injection spot IDs remain unchanged. The widget implementation IDs are unreleased and move from the engine namespace to the owning Sales namespace.

`TemplateLoadContext.translate` and `TemplateDataContext.translate` are additive optional fields. Existing external template registrations and direct `TemplateRegistry.load` callers that provide only `locale` continue to compile and run. The built-in preview and generate routes always provide the request translator returned by `resolveTranslations()`. `BaseDocumentService` retains a key-returning compatibility fallback only for legacy callers that omit the translator; it does not select a locale or load a second dictionary. New document services should build user-facing labels with the supplied translator and include them in normalized template data.

The unreleased generate contract no longer accepts client-supplied `resource_kind` or `resource_id`; both are derived by the template from scoped server data. `TemplateRegistryEntry.resourceId` and `LoadedDocumentTemplateBase.resource.id` are required accordingly. No released compatibility bridge is necessary because the package and route are introduced by this unmerged feature PR.

No released template ID, route, or public contract is removed or renamed. Domain translations move from `document_generators.documents.*` to `sales.documents.templates.*`; the feature is still on an unmerged PR, so a dual-key compatibility window is unnecessary.

The unreleased registry contract is simplified before merge from separate `registerInternal` / `registerExternal` methods and a grouped response to one `register` method and a flat `TemplateMeta[]` response. The registry validates each batch before mutation and rejects every duplicate ID instead of silently shadowing or dropping templates. This strict fail-fast is intentional even for an otherwise identical entry: registering the same global ID twice indicates an invalid generated bootstrap or module graph and must prevent application startup. Built-in IDs use the `<module>.<template>` namespace to minimize accidental third-party collisions, and duplicate diagnostics identify both the registered and incoming modules.

The unreleased `BaseDocumentService.filename()` fallback is also removed before merge. Every `DocumentTemplateEntry` requires its own `filename` handler so output naming stays colocated with `format` and `load`; multi-format services cannot accidentally reuse a PDF extension for another renderer. `buildDocumentFilename` is only a convenience helper—template authors remain free to provide any custom naming function.

## Final Compliance Report — 2026-08-10

### Compliance Matrix

| Rule | Status | Notes |
|------|--------|-------|
| No direct ORM relationships between modules | ✅ | History stores resource and attachment identifiers as scalar IDs |
| Filter by organization_id | ✅ | Engine history and Sales-owned data loading use authenticated scope |
| Validate inputs with Zod | ✅ | Generate, preview, and history-list inputs use module validators |
| API routes export openApi | ✅ | All four routes export OpenAPI metadata |
| Module code in `packages/<name>/` | ✅ | `packages/document-generators/` |
| defaultRoleFeatures in setup.ts | ✅ | |
| Never hardcode user-facing strings | ✅ | All via useT() |
| Generated migrations | ✅ | Entity migration and snapshot were produced by the repository generator |
| ACL separation | ✅ | `view` and `generate` permissions are declared and assigned to default roles |
| Embedded lists use `DataTable` and `apiCall` | ✅ | Planned Phase 6 refactors the existing `HistoryList`; it does not introduce a custom table or raw fetch path |
| Engine remains decoupled from Sales | ✅ | Sales owns its services, templates, widget adapters and i18n; the engine owns only format/runtime mechanics and reusable UI/toolkit surfaces |
| Frontend client boundary is explicit | ✅ | Planned Phase 6 adds one small orchestration island, keeps widget adapters thin, adds no page-root client component or global provider, and defines hydration/interactivity evidence |

### Non-Compliant / Pending

- _None._

### Verdict

**Compliant for implemented Phases 1–5 and approved for planned Phase 6.** Phase 6 reuses the existing scoped history service, API, and `DataTable`; it adds no persistence or public host contract and includes explicit client-boundary, tenant-isolation, and integration-test requirements.

### Review — 2026-08-11

- **Reviewer**: Codex with independent fresh-context scope-cohesion audit
- **Security**: Passed — resource filters only narrow authenticated tenant/organization scope, and missing source identity fails closed without an organization-wide fallback.
- **Performance**: Passed — the embedded list is paginated at 10 rows, reuses the indexed history query, and adds no eager global provider or page-root bundle.
- **Cache**: N/A — Phase 6 uses direct scoped reads and generation-triggered refresh; no cache is introduced.
- **Commands**: N/A — Phase 6 adds no mutation; generation continues through the existing route and history remains best-effort.
- **Risks**: Passed — the spec explicitly distinguishes a refresh attempt from guaranteed persistence and covers stale requests, pagination, and cross-resource isolation.
- **Verdict**: Approved — Phase 6 is cohesive with Phase 5 and the existing detail-widget workflow; a separate specification would duplicate the same contracts.

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 1–4.7 | Done | 2026-08-12 | Registry, render pipeline, preview/download UI, decentralized Sales templates, and Markdown output |
| Phase 5 — History & Backend Page | Done | 2026-08-10 | GeneratedDocument persistence, scoped history endpoint, server-derived resource identity, ACL, backend DataTable, unit and integration coverage |
| Rendering service refactor | Done | 2026-08-12 | Shared source and format values are extensible strings; registry prepares format-neutral input; concrete source/input types are colocated with their rendering services; `DocumentRenderer` dispatches through a renderer map |
| Phase 6 — Source-scoped History in Detail Widgets | Not Started | — | Planned; reuses the Phase 5 endpoint and entity without schema changes |
| Phase 7 — Attachment Storage | Not Started | — | Planned |
| Phase 8 — Email & Sharing | Not Started | — | Planned |
| Phase 9 — Advanced Templates | Not Started | — | Planned |

---

## Changelog

| Date | Author | Summary |
|------|--------|---------|
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
