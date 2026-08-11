# SPEC-005: Document Generators

## TLDR
**Key Points:**
- The `@open-mercato/document-generators` module is a reusable document generation engine with built-in PDF and Markdown rendering.
- A user opens the existing document tab in a supported detail view, picks a template, previews it, then downloads the final file.
- Quote/Sales and Orders are the first supported modules; any other entity can be added independently.

**Scope:**
- Universal template registry — class-based singleton, split into **internal** (built-in) and **external** (injected by other modules via code-gen) registries
- Template metadata hierarchy: `module` → `resourceKind` → logical template → `format` (`pdf` | `md`); `documentType` describes the business purpose (`offer`, `invoice`, `contract`)
- Widget passes raw `context.record` to the API — optional `fetchData` hook enriches data server-side (e.g. fetches line items via DI container); `toTemplateData` normalizes afterward
- `GET /api/document-generators/templates` — lists available templates (internal + external) for client-side consumption
- `POST /api/document-generators/generate` — loads a template through the registry, renders its format-specific input through `DocumentRenderer`, records best-effort generation history, and returns the rendered file
- `GET /api/document-generators/documents` — returns tenant- and organization-scoped generation history
- PDF preview via `<Preview>` (iframe with blob URL); Markdown preview as formatted source text
- Widget pattern: tab injection (`quote_pdf_tab`) rather than action button; widgets filter by `resourceKind`
- Template folder convention: `templates/<module>/<entity>/<template-name>/<format>/`, with shared data types at the logical-template level
- Generator plugin (`generators.ts`) enabling other modules to register external templates via `mercato generate registry`

**Concerns:**
- `@react-pdf/renderer` operates server-side only (`renderToBuffer`) — fonts must be accessible on the server; solved via base64-encoded `*.generated.ts` font files
- Large documents may render slowly on the server — async queue may be needed in a later phase
- The render pipeline supports discriminated React-PDF and Markdown sources. Format-specific renderers return neutral `RenderedDocument` values, while history stores `format` + `mime_type` without a schema change.

---

## Overview

The `document_generators` module extends OpenMercato with the ability to generate professional, branded PDF documents from any entity in the system. A "Generate PDF" button can be injected into any detail view — it opens a dialog: template selection → live preview → download.

Templates are organized by module, resource, logical template, and output format: `templates/<module>/<resource>/<template-name>/<format>/`. Shared normalized data types live one level above the format implementations. `GET /api/document-generators/templates` reads two arrays owned by the `TemplateRegistry` singleton: **internal** templates registered from `config/registry.ts`, and **external** templates registered at bootstrap by generated integration code. Widgets filter them with `TemplateFilter` (`resourceKind`, `documentType`, `format`, `tags`).

The widget passes raw `context.record` to the API. `templateRegistry.load()` runs optional `fetchData`, normalizes through `fromRecord`, loads a discriminated template source, and derives filename and resource identity. `DocumentRenderer` receives only `{ format, source, data }`, selects `PdfRenderingService` or `MarkdownRenderingService`, and returns format, MIME type, and bytes. The API route combines that output with filename and resource metadata.

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

1. **Tab widgets** — injected into any module's detail view via `injection-table.ts`. Each widget renders a `TemplatesList` component with `record` and `filter` props. Widget passes raw `context.record` — no client-side mapping.
2. **Backend pages** — `/backend/document-generators` redirects to the module overview at `/overview`; `/overview`, `/templates`, and `/history` are flat sidebar entries in the Document Generators group.
3. **Four API routes**:
   - `GET /api/document-generators/templates` — returns `{ internal: TemplateMeta[], external: TemplateMeta[] }`
   - `POST /api/document-generators/preview` — accepts `{ template_id, data }`, renders the selected format, returns a stream; **zero side effects**
   - `POST /api/document-generators/generate` — accepts `{ template_id, data, resource_kind?, resource_id? }`, renders the selected format and persists generation history on a best-effort basis
   - `GET /api/document-generators/documents` — returns paginated, scoped generation history
4. **Live preview** — `PreviewPanel` renders PDF blob URLs in a native iframe and Markdown as source text; download calls `POST /generate` separately.
5. **Generator plugin** (`generators.ts`) — `document-generators.templates` plugin enables other modules to register external templates via `mercato generate registry`.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Templates as code (JSX), not database config | Git-versioned, full typographic control, no visual editor required |
| Data from `context.record`, not a fetch | Widget already receives full record from the framework — only `id` is strictly needed when `fetchData` is defined |
| `fetchData` hook per template (server-side) | Services that need data not available in the widget context (e.g. line items) override `fetchData` to query the DI container before normalization |
| Normalization via `toTemplateData` in `BaseDocumentService` subclass | Each entity's mapping lives in one class — adding a new entity = new service subclass, no changes to existing code |
| Shared template data lives in `templates/<module>/<entity>/<name>/types.ts` | PDF and Markdown variants of one logical template consume the same normalized business data |
| `Record<string, unknown>` in route and components | Route and UI components are template-agnostic; type safety lives at the normalizer→template boundary |
| Template folder convention `templates/<module>/<entity>/<name>/<format>/` | Keeps business ownership primary and format as the final implementation dimension |
| `BaseDocumentService` base class for PDF document services | Centralizes template registration and entry construction; subclasses provide identity, normalization, optional fetching, filename, and resource metadata |
| `config/registry.ts` aggregates all internal services in one `registerInternal([...])` call | `registerInternal` replaces the array — multiple calls would clobber each other; all built-in services must be spread into a single call |
| Singleton registry with separate internal/external arrays | Internal templates ship with the module; external templates are injected at bootstrap from generated code without global state |
| `GET /api/document-generators/templates` endpoint | Client needs the list at runtime to filter and display available templates without bundling the registry |
| `generators.ts` plugin for code-gen | External modules declare templates in `document-generators.ts`; `mercato generate registry` produces the bootstrap glue |
| `resourceKind` identifies compatible source data | Widgets and templates use a canonical resource kind such as `sales.quote`; `module` remains grouping metadata and `documentType` describes the output's business purpose. |
| `fromRecord` in registry entry calls `toTemplateData` (server-side) | Template owns its normalization logic — widget is fully decoupled from data shape. Adding a new template for `quotes` requires zero changes to the widget. |
| No `enrichRecord` prop in widgets | Widget passes raw `record` only; all enrichment (data fetching + normalization) happens server-side via `fetchData` + `toTemplateData` |
| Service filename plus optional per-template override | Existing PDF templates keep service-level filenames; additional formats can provide the correct extension without duplicating normalization |
| Tab widget per entity, not action button | PDF is a contextual view of the record, not a one-shot action |
| Preview via iframe + blob URL, not PDFViewer | Server renders the PDF once (`renderToBuffer`), iframe displays the result — no client-side re-render on every change |
| Fonts as base64 `*.generated.ts` per font | Works on the server (no filesystem path issues); tree-shakeable per font |
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
<any module>/:id (detail view)
  └── [Widget Injection: <module>_pdf_tab]
        ↓ tab renders
  <ModulePdfTabWidget>
    └── TemplatesList(record, filter)
          ├── GET /api/document-generators/templates → TemplateMeta[] (filtered by TemplateFilter)
          ├── TemplatesListView → TemplateListItem (click to select)
          └── PreviewPanel(template, record)
                ├── POST /preview { template_id, data }
                │     └── registry.load → LoadedPdfTemplate
                │           └── PdfRenderingService.render → RenderedDocument → iframe
                └── POST /generate { template_id, data, resource_kind?, resource_id? }
                      ├── registry.load → LoadedPdfTemplate
                      ├── PdfRenderingService.render → RenderedDocument
                      ├── GenerationHistoryService.create (best effort)
                      └── application/pdf attachment
```

### Module Structure

```
packages/document-generators/
└── src/modules/document_generators/
    ├── config/
    │   └── registry.ts              # Single registerInternal([...all services]) call
    ├── lib/
    │   ├── interfaces.ts            # registry, loaded source, and rendered result contracts
    │   ├── types.ts                 # TemplateId (derived from REGISTRY)
    │   └── template-registry.ts     # register/list/load internal and external templates
    ├── data/
    │   ├── entities.ts              # GeneratedDocument history entity
    │   └── validators.ts            # API schemas
    ├── migrations/                  # Generated migration + snapshot
    ├── services/
    │   ├── index.ts                 # Re-exports all services and their types
    │   ├── base-document-service.ts # PDF template entry construction
    │   ├── pdf-rendering-service/   # LoadedPdfTemplate → RenderedDocument
    │   │   ├── index.ts
    │   │   ├── pdf-rendering-service.ts
    │   │   └── __tests__/
    │   ├── generation-history-service/
    │   │   ├── index.ts
    │   │   ├── generation-history-service.ts
    │   │   └── __tests__/
    │   ├── quotes-document-service/
    │   │   ├── index.ts
    │   │   ├── quotes-document-service.ts
    │   │   ├── validators.ts
    │   │   └── __tests__/
    │   └── orders-document-service/
    │       ├── index.ts
    │       ├── orders-document-service.ts
    │       ├── validators.ts
    │       └── __tests__/
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
    │   │   ├── theme.ts             # colors, borders, spacing + Inter font registration (side-effect import)
    │   │   └── fonts/
    │   │       ├── Inter-Regular.ttf
    │   │       ├── Inter-Regular.generated.ts   # base64 data URI (build-generated)
    │   │       └── ...
    │   └── sales/
    │       ├── quotes/sales-offer/
    │       │   ├── types.ts         # shared normalized offer data
    │       │   └── pdf/              # SalesOfferDocument, CoverPage, QuotePage
    │       └── orders/order-invoice/
    │           ├── types.ts         # shared normalized invoice data
    │           ├── pdf/index.tsx    # OrderInvoiceDocument
    │           └── markdown/index.ts# renderOrderInvoiceMarkdown
    ├── widgets/
    │   ├── injection-table.ts       # spot → widget mapping (quotes + orders)
    │   └── injection/
    │       ├── quote_pdf_tab/
    │       │   ├── widget.ts        # id: document_generators.injection.quote_pdf_tab
    │       │   └── widget.client.tsx# filter: { resourceKind: 'sales.quote' }
    │       └── order_pdf_tab/
    │           ├── widget.ts        # id: document_generators.injection.order_pdf_tab
    │           └── widget.client.tsx# filter: { resourceKind: 'sales.order' }
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

Two separate registries managed by `TemplateRegistry` class (singleton `templateRegistry`):

```ts
// lib/interfaces.ts — TemplateRegistry interface
interface TemplateRegistry {
  registerInternal(entries: TemplateEntry[]): void   // called ONCE by config/registry.ts — replaces array
  registerExternal(entries: TemplateEntry[]): void   // called by bootstrap (generated code) — replaces array
  listTemplates(): { internal: TemplateMeta[]; external: TemplateMeta[] }
  load({ id, data }, { container, auth }): Promise<LoadedTemplate> // fetchData → load source → normalize → derive metadata
}
```

> **Critical**: `registerInternal` replaces the entire internal array. All built-in services must be combined into one call in `config/registry.ts`:
> ```ts
> templateRegistry.registerInternal([
>   ...quotesService.getEntries(),
>   ...ordersService.getEntries(),
> ])
> ```

```ts
// lib/interfaces.ts
interface TemplateMeta {
  id: string
  label: string
  description: string
  module: string       // top-level Medusa module — e.g. 'sales'
  resourceKind: string // framework resource kind — e.g. 'sales.quote' | 'sales.order'
  documentType: string // document kind — e.g. 'offer' | 'invoice' | 'contract'
  format?: 'pdf' | 'md' // omitted legacy entries default to PDF
  tags: string[]
}

interface TemplateDataContext {
  locale: string
  translate?: TranslateFn
}

interface TemplateLoadContext {
  container: AppContainer
  auth: AuthContext | null
  locale: string
  translate?: TranslateFn
}

interface TemplateRegistryEntry {
  fromRecord: (data: unknown, context: TemplateDataContext) => Record<string, unknown>  // locale- and translation-aware mapping of enriched server data
  filename: (input: { data: Record<string, unknown> }) => string
  resourceId?: (input: { data: Record<string, unknown> }) => string | undefined
  resourceLabel?: (input: { data: Record<string, unknown> }) => string | undefined
  load: () => Promise<DocumentTemplateSource>
  fetchData?: (input: { data: unknown }, ctx: { container: AppContainer; auth: AuthContext | null }) => Promise<unknown>
}

// TemplateEntry = TemplateMeta & TemplateRegistryEntry (full descriptor used in the registry)
type TemplateEntry = TemplateMeta & TemplateRegistryEntry

interface LoadedDocumentTemplateBase {
  data: Record<string, unknown>
  filename: string
  template: { id: string; label: string }
  resource: { kind: string; id?: string; label?: string }
}

interface ReactPdfTemplateSource {
  type: 'react-pdf'
  component: React.ComponentType<{ data: Record<string, unknown> }>
}

interface MarkdownTemplateSource {
  type: 'markdown'
  render: (data: Record<string, unknown>) => string | Promise<string>
}

type DocumentTemplateSource = ReactPdfTemplateSource | MarkdownTemplateSource

interface LoadedPdfTemplate extends LoadedDocumentTemplateBase {
  format: 'pdf'
  source: ReactPdfTemplateSource
}

interface LoadedMarkdownTemplate extends LoadedDocumentTemplateBase {
  format: 'md'
  source: MarkdownTemplateSource
}

type LoadedTemplate = LoadedPdfTemplate | LoadedMarkdownTemplate

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
  format?: 'pdf' | 'md'
  tags?: string[]       // OR logic — matches if template has ANY of the given tags
}
```

Adding a built-in template = one object in `config/registry.ts`. Adding an external template (from another module) = define a `document-generators.ts` convention file and run `mercato generate registry`.

### Template-specific Data Shape

Each logical template defines shared normalized data in `templates/<module>/<resource>/<name>/types.ts`. Its format implementations consume that same contract. Example for `sales-offer`:

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
// services/quotes-document-service/quotes-document-service.ts
export class QuotesDocumentService extends BaseDocumentService {
  readonly id = 'quotes'          // globally unique service ID
  readonly label = 'Quotes'
  readonly module = 'sales'
  readonly resourceKind = 'sales.quote'

  constructor() {
    super()
    this.registerTemplate({
      id: 'sales-offer',
      documentType: 'offer',
      format: 'pdf',
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
- `registerTemplate(entry)` — registers a lazy-loaded template
- `getEntries()` — returns entries with `module`, `resourceKind`, normalization, output metadata, and fetching bound to the service
- `fetchData({ data }, { container, auth })` — default no-op; override to enrich data before normalization with request scope available
- `toTemplateData({ data, locale, translate })` — **abstract**; override to map enriched data using the required request locale and translator
- `filename({ data })` — returns `'document.pdf'` by default; override for document-specific names
- a registered template may provide its own `filename({ data })` when its extension differs from the service default

`formatDate(iso, locale)` remains a standalone utility with no default locale. Both render routes resolve the active locale and translator server-side and thread them through `TemplateRegistry.load` → `fromRecord` → `toTemplateData`. Document services build typed `data.labels` during normalization, so PDF and Markdown variants within one service share the same request-scoped fetching, formatting, and translated labels. Translation values remain in the owning module's standard `i18n/<locale>.json` dictionaries; templates do not load private locale files.

---

## API Contracts

### GET /api/document-generators/templates

Returns all available templates split by source.

**Response:**
```json
{
  "internal": [{ "id": "sales-offer", "label": "Sales Offer", "description": "..." }],
  "external": [{ "id": "custom-invoice", "label": "Custom Invoice", "description": "..." }]
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
  "template_id": "sales-offer",
  "data": { /* raw context.record */ }
}
```

**Response:** `Content-Type: application/pdf` — binary PDF stream.

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
  "template_id": "sales-offer",
  "data": { /* raw context.record — at minimum { id } when fetchData is defined */ },
  "resource_kind": "sales.quote",
  "resource_id": "quote_01ABC"
}
```

> `resource_kind` and `resource_id` are optional. When both are present and match the identity derived by the loaded template, the route attempts to persist history. `resource_label` is not accepted from the client; it is derived server-side and falls back to the canonical resource ID.

**Response:** `Content-Type: application/pdf` — binary PDF stream with `Content-Disposition: attachment; filename="<derived>"`.

**Errors:**
- `400` — invalid input, unknown template ID, or supplied resource identity does not match the loaded document
- `401` — unauthorized
- `409` — no active organization
- `500` — render error

### GET /api/document-generators/documents

Returns paginated generation history filtered by the authenticated tenant and organization. Optional `resource_kind` and `resource_id` query parameters narrow the result.

---

## UMES Extension Points

| Extension Point | Usage |
|----------------|-------|
| **Widget Injection** | Any module's detail view — each widget registers its own injection spot in `injection-table.ts` |
| **Backend Pages** | `/backend/document-generators` — hidden redirect; `/backend/document-generators/overview` — module overview; `/backend/document-generators/templates` — template overview; `/backend/document-generators/history` — generation history |
| **ACL Features** | `document_generators.view`, `document_generators.generate` |

---

## Fonts

Fonts live in `templates/shared/fonts/`. Each `.ttf` file has a corresponding `*.generated.ts` file (excluded from git, generated by `build.mjs`) containing a base64 `data:font/truetype` URI.

Templates import individual font files for tree-shaking:

```ts
import InterRegular from '../shared/fonts/Inter-Regular.generated'
```

`build.mjs` generates `*.generated.ts` files before esbuild compilation. No Next.js configuration required — `.ttf` files are never imported directly by the app.

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

A document tab (retaining its existing frozen PDF-oriented injection ID) is injected into detail views via `injection-table.ts`. The tab renders `TemplatesList`:

1. **Template list** — card grid fetched from `GET /api/document-generators/templates`, filtered by `TemplateFilter` (`resourceKind`, `documentType`, `format`, `tags`).
2. **Preview dialog** (`PreviewPanel`) — calls `POST /api/document-generators/preview`; PDF uses the existing iframe and Markdown is displayed as source text. The format-aware download button calls `POST /api/document-generators/generate`.

### Backend pages

- `/backend/document-generators` — navigation-hidden redirect to `/backend/document-generators/overview`, preventing an extra parent level in the sidebar.
- `/backend/document-generators/overview` — module overview with navigation cards for templates and generation history.
- `/backend/document-generators/templates` — template overview grouped by owner module and internal/external source.
- `/backend/document-generators/history` — history table backed by the paginated `GET /api/document-generators/documents` endpoint.

---

## Extending to Other Modules

### Adding a new built-in template for an existing entity

1. Add shared normalized types in `templates/<module>/<entity>/<new-template>/types.ts` and a format implementation under `<format>/`
2. Call `this.registerTemplate(...)` in the existing entity's `DocumentService` constructor
3. Spread the service's entries in the single `registerInternal([...])` call in `config/registry.ts` — it is already there

No other file changes required.

### Adding PDF generation for a new entity (e.g. Shipments)

1. Create `services/shipments-document-service/` with `shipments-document-service.ts`, `validators.ts`, `index.ts`, and colocated tests; extend `BaseDocumentService`
2. Add template component in `templates/sales/shipments/<template-name>/pdf/`
3. Add the new service to the spread in `config/registry.ts`:
   ```ts
   templateRegistry.registerInternal([
     ...quotesService.getEntries(),
     ...ordersService.getEntries(),
     ...shipmentsService.getEntries(),  // ← add here
   ])
   ```
4. Create `widgets/injection/<entity>_pdf_tab/` with `widget.ts` and `widget.client.tsx`
5. Add slot entry to `widgets/injection-table.ts`

No changes to existing services or templates required.

### Registering an external template from another module

1. Create `document-generators.ts` convention file in the other module exporting a `templates: TemplateRegistryEntry[]` array
2. Run `mercato generate registry` — generates `document-generators.generated.ts` with bootstrap registration
3. The generated bootstrap calls `templateRegistry.registerExternal(...)` — templates appear in `GET /api/document-generators/templates` under `external`

---

## Risks & Impact Review

### Data Integrity

- **Slow render**: `renderToBuffer` is synchronous and may be slow for large documents. Acceptable for MVP; Phase 2 can move to `@open-mercato/queue`.

### Tenant & Data Isolation

- **Risk exists and is mitigated.** Both built-in document services (`QuotesDocumentService`, `OrdersDocumentService`) query tenant-scoped records: `sales_quotes`, `sales_quote_lines`, `sales_orders`, `CustomerEntity`, `CustomerAddress`. A user with `document_generators.view` could otherwise retrieve data from a different tenant by submitting an arbitrary UUID.
- **Mitigation:** `getAuthFromRequest` is called in both route handlers (`/generate`, `/preview`). The resulting `AuthContext` is propagated through `templateRegistry.load → fetchData` via `ctx.auth`; the loaded template is then passed to `PdfRenderingService.render`. Each built-in service validates its local input as `{ id: UUID }`, ignores all other client-supplied record fields, and queries by `id`, `tenant_id`, and `organization_id`. Missing scope, invalid input, inaccessible records, and database failures all reject the render pipeline — raw request data is never used as a fallback.
- **Custom `DocumentService` contract:** any external module implementing `BaseDocumentService` **must** apply the same tenant scoping in `fetchData`. The `ctx.auth` argument is available for exactly this purpose. Implementations that ignore it are considered a security defect.

### Font Loading

- `*.generated.ts` files are gitignored and must be regenerated after `build.mjs`. Dev mode requires either running the build or having the files pre-generated. Mitigation: `build.mjs` always regenerates them before esbuild.

### Operational

- `@react-pdf/renderer` adds weight to the server bundle. Template entries keep sources lazy through `entry.load()`.

---

## Implementation Plan

### Phase 1 — Foundation ✅

1. Package scaffold (`package.json`, `build.mjs`, `tsconfig.json`)
2. `acl.ts` with `document_generators.view`, `document_generators.generate`
3. `setup.ts` with `defaultRoleFeatures`
4. Module `index.ts`

### Phase 2 — Templates & Registry ✅

1. `lib/interfaces.ts`, `lib/types.ts`, `lib/template-registry.ts` — class-based registry with `registerInternal` / `registerExternal` / `load`
2. `services/base-document-service.ts` — abstract base class
3. `services/quotes-document-service/` — `QuotesDocumentService`, local input validation, and `sales-offer` template registration
4. `config/registry.ts` — single `registerInternal([...])` call
5. `templates/shared/fonts/` + font build pipeline in `build.mjs`
6. `templates/shared/theme.ts` + `templates/shared/components/Logo.tsx` — shared design tokens and brand components exported publicly
7. `templates/sales/quotes/sales-offer/` — shared `types.ts` plus PDF implementation under `pdf/`

### Phase 3 — API ✅

1. `GET /api/document-generators/templates` — returns `{ internal: TemplateMeta[], external: TemplateMeta[] }`
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
7. `widgets/injection/quote_pdf_tab/` — `widget.ts`, `widget.client.tsx` — filter: `{ resourceKind: 'sales.quote' }`
8. `widgets/injection-table.ts` — injection spot mapping

### Phase 4.5 — External Template Code-Gen ✅

1. `generators.ts` — `document-generators.templates` GeneratorPlugin
2. Convention file pattern: `document-generators.ts` in consuming module exports `templates: TemplateRegistryEntry[]`
3. `mercato generate registry` produces `document-generators.generated.ts` that calls `registerExternal(...)`

### Phase 4.6 — Orders Built-in Template ✅

1. `services/orders-document-service/` — `OrdersDocumentService` (`resourceKind: 'sales.order'`), local input validation, and `order-invoice` template
2. `templates/sales/orders/order-invoice/` — shared `types.ts` plus PDF implementation under `pdf/`
3. `services/index.ts` updated — exports built-in document and rendering/history services
4. `config/registry.ts` updated — single `registerInternal([...quotesService, ...ordersService])` call
5. `widgets/injection/order_pdf_tab/` — `widget.ts`, `widget.client.tsx` — filter: `{ resourceKind: 'sales.order' }`
6. `widgets/injection-table.ts` updated — added `sales.document.detail.order:tabs` slot
7. Complete working invoice example for external template authors (`document-generators.ts`, service, template, widget, injection-table) lives under `apps/docs/static/examples/document-generators/` and is described in the Document Generators docs section
8. `scaffold-pdf-templates` Claude Code skill added — guides generation of the full integration layer for external modules

### Phase 4.7 — Markdown Output ✅

1. Added optional `format` metadata (`pdf` default for legacy entries) and optional per-template filename overrides.
2. Added discriminated `MarkdownTemplateSource`, `LoadedMarkdownTemplate`, and `MarkdownRenderingService`.
3. Added `DocumentRenderer` shared by preview and generate routes, with render-only input separated from template metadata.
4. Reorganized built-in templates to `<logical-template>/<format>/` while keeping normalized data types at the logical-template level.
5. Added `order-invoice-markdown` to `OrdersDocumentService`; it shares the order fetch, normalization, resource identity, and history pipeline with the PDF invoice.
6. Added Markdown source preview and format-aware downloading in `PreviewPanel`.

### Phase 5 — History & Backend Page ✅

#### Implemented files

| File | Description |
|------|-------------|
| `data/entities.ts` | `GeneratedDocument` entity — `id`, `organization_id`, `tenant_id`, `resource_kind`, `resource_id`, `resource_label`, `template_id`, `template_label`, `format` (default `'pdf'`), `mime_type` (default `'application/pdf'`), `generated_by`, `generated_at`, `attachment_id` (nullable — populated in Phase 6). Table `document_generators_generated_documents` |
| `data/validators.ts` | Zod schemas: extended `generateSchema` (adds `resource_kind`, `resource_id`) + `listDocumentsSchema` (query params) |
| `services/generation-history-service/` | Scoped creation and paginated listing of generation history |
| `api/document-generators/documents/route.ts` | Paginated history endpoint, filterable by `resource_kind` and `resource_id`; exports `openApi` + `metadata` |
| `migrations/Migration20260809121904_document_generators.ts` | Generated migration accompanied by the module snapshot |

> **Format-agnostic by design.** The entity is named `GeneratedDocument` (not `PdfGeneratedDocument`) and carries a `format` + `mime_type` discriminator so the persistence/history/storage layers work unchanged when non-PDF outputs are added later. Only the result and data layers are generalized now; `PdfRenderingService`, `BaseDocumentService`, and `@react-pdf/renderer` stay PDF-only. The module, package, API paths, and ACL features remain `document_generators`-named.

#### Updated files

| File | Change |
|------|--------|
| `api/document-generators/generate/route.ts` | Verify optional client resource identity against the loaded template and persist the neutral render result through `GenerationHistoryService` after a successful render |
| `acl.ts` | Add `document_generators.generate` feature |
| `setup.ts` | Add `document_generators.generate` to `superadmin` + `admin` role features |
| `backend/document-generators/page.tsx` | Navigation-hidden compatibility redirect to the overview route |
| `backend/document-generators/overview/page.tsx` | Module overview with cards linking to the template list and generation history |
| `backend/document-generators/templates/page.tsx` | Template list moved from the module root without changing its API contract |
| `backend/document-generators/history/page.tsx` | Dedicated history page with a paginated `DataTable` fetched from `GET /api/document-generators/documents` |
| `i18n/*.json` | New keys: `document_generators.history.title`, `document_generators.history.resource`, `document_generators.history.template`, `document_generators.history.generatedBy`, `document_generators.history.generatedAt`, `document_generators.history.empty` |

#### Data flow

```
Widget → POST /generate { template_id, data, resource_kind, resource_id }
         ├── resolveTranslations() → required active locale
         ├── templateRegistry.load(..., { locale }) → LoadedPdfTemplate + canonical resource identity
         ├── PdfRenderingService.render() → RenderedDocument
         ├── verify optional client resource identity
         ├── GenerationHistoryService.create(GeneratedDocument { format, mime_type, ... }) [best effort]
         └── returns PDF stream

GET /api/document-generators/documents?resource_kind=X&resource_id=Y&page=1&pageSize=20
    └── em.find(GeneratedDocument, { organization_id, [resource_kind, resource_id] }, { orderBy: generated_at DESC })
```

#### Key implementation notes

- Use `createRequestContainer()` from `@open-mercato/shared/lib/di/container` to get `em` in the generate route
- Use `getAuthFromRequest(request)` from `@open-mercato/shared/lib/auth/server` to get `auth.userId` for `generated_by`
- `resource_kind` and `resource_id` are optional in `POST /generate` — PDF still renders without them; a history record is saved only when both are present
- `resource_label` is derived server-side through the template registry after normalization; callers cannot spoof it, and an unavailable label falls back to `resource_id`
- `GET /documents` must always filter by `organization_id` — use `getAuthFromRequest` for tenant scoping
- DB migration was generated with `yarn module:db:generate document-generators`; the migration and snapshot are committed together

#### Format extensibility boundary

The implementation supports two concrete formats through a shared dispatch boundary:

- `DocumentTemplateSource` is a discriminated union of `{ type: 'react-pdf', component }` and `{ type: 'markdown', render }`.
- `LoadedDocumentTemplateBase` carries normalized data, filename, template identity, and resource identity independently of a renderer.
- `PdfRenderingService` accepts only `LoadedPdfTemplate` and owns PDF rendering plus `format: 'pdf'` and `mimeType: 'application/pdf'`.
- `MarkdownRenderingService` accepts only `LoadedMarkdownTemplate` and returns UTF-8 bytes with `format: 'md'` and `mimeType: 'text/markdown; charset=utf-8'`.
- `DocumentRenderer` selects format renderers without putting format switches in API routes.
- `RenderedDocument` and `GeneratedDocument` are format-neutral, so history does not require a schema change for another output type.

Adding DOCX later would require a new source variant, `LoadedDocxTemplate`, a DOCX rendering service, one dispatch branch, and a UI preview/download decision. DOCX generation itself remains outside this spec's implemented scope.

### Phase 6 — Attachment Storage (Planned)

Uses the existing core `attachments` module — no custom storage infrastructure needed.

1. Create `pdfDocuments` attachment partition (private, non-public) via `POST /api/attachments/partitions` or seeded in `setup.ts`
2. After successful render in `POST /generate`, upload the PDF buffer to `POST /api/attachments` (multipart, partition: `pdfDocuments`, `entity_id: 'document_generators:document'`, `record_id: resource_id`)
3. Store returned `attachment_id` in `GeneratedDocument.attachment_id` (new nullable column, added via `yarn mercato db:generate`)
4. `GET /api/document-generators/documents` history response includes `attachment_id` — client builds download URL as `/api/attachments/file/{attachment_id}`
5. Download button in the widget uses the stored attachment URL when `attachment_id` is present, falls back to on-demand `POST /generate` render otherwise

#### Tenant & data isolation (mandatory)

The `private` partition flag is **necessary but not sufficient** — cross-organization isolation of a stored PDF is enforced by the `organization_id` / `tenant_id` **on the `Attachment` record itself**, not by the partition. The core download route (`GET /api/attachments/file/{id}`) checks `attachment.tenantId === auth.tenantId && attachment.organizationId === auth.orgId` (fail-closed via `isSameScope`; superadmin exempt).

Therefore the upload in step 2 **must** persist the request's `organization_id` and `tenant_id` (derived from `getAuthFromRequest`) onto the attachment record. Requirements:

- The generated PDF contains customer data and amounts; it must never be retrievable from another tenant/organization.
- If the upload omits the scope, the record is either unreachable for regular users (fail-closed 403) or, worse, over-exposed — both are defects. Verify the core `POST /api/attachments` contract actually stamps `organization_id`/`tenant_id` from auth; if it does not, pass them explicitly.
- A history record (`GeneratedDocument`) is only written when `resource_kind` and `resource_id` are both present (see Phase 5); its label is derived server-side. The same auth scope used there must match the attachment scope so history and file stay consistent.
- This mirrors the Phase 1 render-path mitigation (see **Tenant & Data Isolation** above): the same `auth`-derived scope now extends from data fetch → render → stored file → download.

### Phase 7 — Email & Sharing (Planned)

1. Send PDF directly to a recipient email from the widget — attach generated PDF or include storage URL
2. Shareable link — time-limited public URL for previewing a document without login
3. Bulk generation — generate PDFs for multiple records in a single action via queue worker

### Phase 8 — Advanced Templates (Planned)

1. Template versioning — record which template version was used at generation time; archived versions remain renderable
2. Draft watermark — render a "DRAFT" overlay when the source resource is not in a final status
3. Auto-generation trigger — emit `document_generators.document.generated` event on resource status change (e.g. quote accepted)

---

---

## Migration & Backward Compatibility

`TemplateLoadContext.translate` and `TemplateDataContext.translate` are additive optional fields. Existing external template registrations and direct `TemplateRegistry.load` callers that provide only `locale` continue to compile and run. The built-in preview and generate routes always provide the request translator returned by `resolveTranslations()`. `BaseDocumentService` retains a key-returning compatibility fallback only for legacy callers that omit the translator; it does not select a locale or load a second dictionary. New document services should build user-facing labels with the supplied translator and include them in normalized template data.

No template ID, route, import path, renderer contract, or existing normalized business-data field is removed or renamed. Built-in `OrderInvoiceData` and `PdfDocumentData` gain the required `labels` field because their bundled renderers now consume localized labels from normalized data.

## Final Compliance Report — 2026-08-10

### Compliance Matrix

| Rule | Status | Notes |
|------|--------|-------|
| No direct ORM relationships between modules | ✅ | History stores resource and attachment identifiers as scalar IDs |
| Filter by organization_id | ✅ | History creation/listing and built-in data loading use authenticated scope |
| Validate inputs with Zod | ✅ | Generate, preview, and history-list inputs use module validators |
| API routes export openApi | ✅ | All four routes export OpenAPI metadata |
| Module code in `packages/<name>/` | ✅ | `packages/document-generators/` |
| defaultRoleFeatures in setup.ts | ✅ | |
| Never hardcode user-facing strings | ✅ | All via useT() |
| Generated migrations | ✅ | Entity migration and snapshot were produced by the repository generator |
| ACL separation | ✅ | `view` and `generate` permissions are declared and assigned to default roles |

### Non-Compliant / Pending

- _None._

### Verdict

**Compliant for Phases 1–5.** Phase 5 includes the generated entity migration, organization + tenant scoped history service, validated API contracts, ACL separation, backend history table, and regression coverage.

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 1–4.6 | Done | 2026-05-17 | Registry, render pipeline, preview/download UI, code generation, quote and order templates |
| Phase 5 — History & Backend Page | Done | 2026-08-10 | GeneratedDocument persistence, scoped history endpoint, server-derived resource identity, ACL, backend DataTable, unit and integration coverage |
| Rendering service refactor | Done | 2026-08-10 | `load()` returns a discriminated template source; registry prepares `LoadedPdfTemplate`; `PdfRenderingService` owns PDF format/MIME and renders neutral `RenderedDocument` |
| Phase 6 — Attachment Storage | Not Started | — | Planned |

---

## Changelog

| Date | Author | Summary |
|------|--------|---------|
| 2026-05-06 | Krzysztof Polak | Spec created — Phases 1–4 designed |
| 2026-05-07 | Krzysztof Polak | Initial compliance report added |
| 2026-05-08 | Krzysztof Polak | Spec updated to match implementation: widget renamed to `quote_pdf_tab` (tab, not action); `PdfGeneratorDrawer` replaced by `TemplatesList` + `PreviewPanel` + `Preview` + `Loader` + `downloadBlob`; data mapper moved to `data/quote-detail/`; `GET /api/document-generators/templates` endpoint added; globalThis-based dual registry (`template-registry.ts`) documented; `generators.ts` plugin (Phase 4.5) added |
| 2026-05-08 | Krzysztof Polak | `templateIds` filtering replaced by `TemplateFilter { category, tags, moduleId }` — templates declare `category`, `tags[]`, `moduleId` at registration; `TemplatesList` accepts `filter` prop instead of `templateIds`; OR logic for tags |
| 2026-05-08 | Krzysztof Polak | `fromRecord` mapper moved from `data/quote-detail/document-data.ts` into each `TemplateRegistryEntry` — template owns its own data mapping; widget passes raw `record` to `TemplatesList`; `document-data.ts` removed; `TemplatesList` resolves mapper from globalThis registry on template selection |
| 2026-05-09 | Krzysztof Polak | Normalization moved server-side: `POST /generate` now accepts `{ template_id, record }` instead of `{ template_id, data }`; `loadTemplate(id, record)` calls `entry.fromRecord(record)` server-side; client no longer needs registry import side effect; template folder convention changed to `templates/<module>/<entity>/templates/<name>/` + `templates/<module>/<entity>/data/`; `QuoteWidgetRecord` exported publicly from package root |
| 2026-05-09 | Krzysztof Polak | Phase 5 implementation plan detailed — files to create/modify, data flow, key implementation notes added to spec; `attachment_id` nullable column added to `PdfGeneratedDocument` (populated in Phase 6) |
| 2026-05-09 | Krzysztof Polak | Phase 6 rewritten — replaces custom S3/GCS storage with existing core `attachments` module; uses `POST /api/attachments` + `pdfDocuments` partition; download via `/api/attachments/file/{attachment_id}`; no custom storage infrastructure needed |
| 2026-05-09 | Krzysztof Polak | Introduced `BaseDocumentService` base class — `registerTemplate()`, `getEntries()`, `formatDate()` centralised; `QuotesDocumentService` and `OrdersDocumentService` as subclasses; `normalizeRecord` per service replaces standalone `normalize-record.ts` files; `config/registry.ts` uses single `registerInternal([...spread])` call to avoid array clobber; built-in `order-invoice` template added (`OrderInvoiceDocument`); `order_pdf_tab` widget added; `examples/` reference folder added; `scaffold-pdf-templates` skill added; sandbox example PDF implementation removed (superseded by built-in) |
| 2026-05-17 | Krzysztof Polak | **Template metadata hierarchy**: `moduleId` → `module` + `entity`; `category` → `documentType`. `BaseDocumentService` now requires `module` and `entity` abstract fields. Widget filters simplified to `{ entity: 'quotes' }` / `{ entity: 'orders' }`. `TemplateFilter` updated accordingly. `note?: string` field added to `DocumentTemplateEntry` and `TemplateMeta` — free-text description of where the template is used; surfaced as a column on the backend page. |
| 2026-05-17 | Krzysztof Polak | **Split `/generate` into `/preview` and `/generate`** — `POST /api/document-generators/preview` renders PDF with zero side effects (used by `PreviewPanel`); `POST /api/document-generators/generate` is the production endpoint with full side effects (logging, events, future persistence) and accepts optional `resource_kind`, `resource_id`, `resource_label` forward-compatible with Phase 5. Common render logic extracted to `lib/render-pdf.ts`. Download button in `PreviewPanel` calls `/generate`; iframe preview calls `/preview`. Backend page restructured: templates grouped by `module` first, then Internal/External sub-sections; External always visible with empty state when none registered; page title changed to "Available templates". |
| 2026-05-17 | Krzysztof Polak | **Server-side data fetching via `fetchData` hook** — `BaseDocumentService` gains optional `fetchData({ data }, { container })` method called before normalization; `QuotesDocumentService` overrides it to load full quote with line items via raw SQL + DI container (resolves the missing-line-items limitation); `OrdersDocumentService` gains billing address enrichment. **API body field renamed**: `POST /generate` now accepts `data` (was `record`). **`normalizeRecord` renamed to `toTemplateData`** with `{ data }` input shape for consistency. **`filename` method added** to `BaseDocumentService` — derives the PDF download filename from normalized data; `Content-Disposition` header set from the returned value. **`enrichRecord` prop removed** from `PreviewPanel` and `TemplatesList` — no client-side enrichment; widgets pass raw `record` only. **`TemplateEntry` type introduced** (`TemplateMeta & TemplateRegistryEntry`). **`TemplateRegistry` interface** extracted to `interfaces.ts`. **`getMetas()` renamed to `listTemplates()`**. Error handling hardened in `PreviewPanel` (catches promise rejection) and generate route (catches JSON parse errors). QuotePage color scheme updated. |
| 2026-08-08 | Krzysztof Polak | Marked the "Raw SQL in QuotesDocumentService" pending item as resolved — `SalesQuote`/`SalesQuoteLine` are now in DI and loaded via `findOneWithDecryption` (2026-06-11); the raw-SQL workaround was removed, so the ORM layer is no longer bypassed. Pending list is now empty. |
| 2026-08-09 | Krzysztof Polak | Phase 6 — added a mandatory **Tenant & data isolation** subsection: the `private` partition flag alone does not isolate stored PDFs across organizations; the upload must persist `organization_id`/`tenant_id` (from `getAuthFromRequest`) onto the `Attachment` record, since the core download route enforces scope via `isSameScope` (fail-closed, superadmin exempt). Extends the Phase 1 render-path isolation through storage and download. |
| 2026-08-09 | Krzysztof Polak | Phase 5 — renamed the history entity `PdfGeneratedDocument` → `GeneratedDocument` and added `format` (default `'pdf'`) + `mime_type` discriminator columns, so the persistence/history/storage layers are format-agnostic (future `.docx`/`.md` support needs a renderer, not a schema change). Only the data layer is generalized — the render pipeline stays PDF-only; module/package/API/ACL names stay `document_generators`. Table: `document_generators_generated_documents`. |
| 2026-08-09 | Codex | Completed Phase 5 and synchronized the API contract: clients send only `resource_kind` + `resource_id`; `resource_label` is derived from normalized data by the document service and falls back to `resource_id`. Added scoped history persistence/listing, backend history UI, ACL, validators, and regression/integration coverage. |
| 2026-08-09 | Codex | Replaced the mixed `lib/render-pdf.ts` helper with a focused `PdfRenderingService`: routes load templates explicitly, `load()` returns a discriminated `DocumentTemplateSource`, and the service renders an already prepared `LoadedPdfTemplate` into a neutral `RenderedDocument`. Format and MIME remain renderer-owned; `LoadedDocumentTemplateBase` provides the shared seam for a future DOCX variant without a placeholder implementation. Added canonical resource-id derivation and mismatch rejection for history integrity. |
| 2026-08-10 | Codex | Synchronized the normative architecture, API, UI, Phase 5, compliance, and extension sections with the completed implementation. Clarified the deliberately partial format-neutral boundary and the concrete work required for a future DOCX renderer. |
| 2026-08-10 | Codex | Reorganized concrete services into owner folders with local barrels and tests while keeping `base-document-service.ts` flat. Added service-local UUID input schemas for built-in order/quote rendering and made fetch failures fail closed so raw client records can never become PDF source data. |
| 2026-08-10 | Codex | Made locale a required breaking contract across render routes, `TemplateRegistry.load`, `fromRecord`, `BaseDocumentService.toTemplateData`, and `formatDate`; built-in and example documents now format every date with the active request locale and cannot silently fall back to Polish formatting. |
| 2026-08-11 | Codex | Split the combined backend screen into flat Overview, Available templates, and Generation history sidebar pages. The navigation-hidden base route redirects to Overview, which provides cards to both functional pages; history uses the existing paginated API. |
| 2026-08-11 | Codex | Added Markdown as the second output format for `OrdersDocumentService`: `order-invoice-markdown` shares order fetching and normalization with the PDF invoice, renders through `MarkdownRenderingService`, previews as text, downloads as `.md`, and records `format: md` history. Reorganized built-in templates to `<logical-template>/<format>/` while retaining the optional `templates/shared` library for reusable template assets. |
| 2026-08-11 | Codex | Localized built-in Order Invoice and Sales Offer documents through the standard module dictionaries. Render routes now pass the request translator through `TemplateRegistry.load` and `BaseDocumentService`; services build typed `data.labels`, with PDF and Markdown invoice variants sharing the exact same label object. Added optional translator context fields for external-call compatibility and en/pl regression coverage. |
