# SPEC-034: Document Parser Module — Schema-Driven AI Extraction with Preview and Human-in-the-Loop Editing

**Date**: 2026-02-22
**Status**: Draft
**Module**: `document_parser` (`packages/core/src/modules/document_parser/`)
**Related**: Issue #574, SPEC-024 (Financial Module / #260), SPEC-029 (InboxOps / #573)

---

## Overview

Add a new `document_parser` module to `@open-mercato/core` that provides schema-driven AI document extraction with multi-provider LLM consensus, PDF page preview, and human-in-the-loop result editing. The module turns uploaded documents (invoices, purchase orders, receipts, contracts, customs forms) into structured, validated data using predefined YAML schemas — with full support for custom schemas per tenant.

**Why this matters:** Every ERP system receives documents from external parties — vendor invoices, bank statements, shipping documents, purchase orders. Today these are manually read and re-keyed into the system. This module automates the extraction using LLM providers while keeping humans in the loop for verification and correction. The YAML-based schema system makes it extensible without code changes — a tenant can define a new document type schema and immediately start extracting structured data from it.

**Relationship to Financial Management Module (#260):** This module is designed as a foundational building block for the Financial Management Module. Extracted vendor invoices feed directly into Accounts Payable (AP invoice creation, three-way matching against POs). Extracted bank statements feed into bank reconciliation. The module is deliberately generic — it extracts structured data from any document type, and downstream modules consume that data.

**Relationship to InboxOps (#573):** Complementary to InboxOps which handles email-to-ERP proposals. Document Parser handles the attachment processing that InboxOps defers to Phase 2. The two modules can integrate: InboxOps receives an email with a PDF invoice attachment -> Document Parser extracts structured data -> InboxOps creates an AP invoice proposal with pre-filled fields.

---

## Architecture

### Core Flow

1. **Upload** — User uploads a document (PDF, image, DOCX) via drag-and-drop dialog or API. The file is stored via the existing `attachments` module.

2. **OCR** — Raw text is extracted from the document using Mistral OCR (or configurable provider). For image-based PDFs, OCR produces searchable text.

3. **Classification** — The `DocumentDetector` scores the text against all registered YAML schemas using weighted pattern matching. Each schema defines detection patterns (regex + weight), required patterns, negative patterns, and a minimum score threshold. The highest-scoring type above threshold wins.

4. **Parallel LLM Extraction** — The document text is sent to multiple LLM providers simultaneously (configurable: Anthropic Claude, Google Gemini, Mistral). Each provider extracts structured data according to the Zod schema generated from the YAML definition. Providers run in parallel for speed.

5. **Consensus Engine** — Results from all providers are compared field-by-field. The consensus engine resolves disagreements using majority voting, confidence scoring, and format validation. Fields where providers disagree are flagged with low confidence. The engine produces a recommendation: `APPROVE` (high confidence across all fields) or `MANUAL_REVIEW` (disagreements detected).

6. **Result Storage** — Two copies are stored: `extractedData` (immutable audit trail of what LLMs returned) and `documentData` (editable working copy for user corrections). Key fields are also written to real indexed columns for fast search and filtering.

7. **Preview & Edit UI** — A detail panel shows the PDF page preview on the left and extracted data sections on the right. Users can edit any field. Sections are dynamically generated from the YAML schema — no UI code changes needed for custom document types.

### System Diagram

```
+-----------------------------------------------------------------+
|                    Document Parser Module                         |
|                                                                   |
|  +----------+  +--------------+  +------------------------+      |
|  |  Upload   |->| OCR Provider |->|  Document Detector     |      |
|  |  Dialog   |  | (Mistral)    |  |  (YAML pattern match)  |      |
|  +----------+  +--------------+  +-----------+------------+      |
|                                              |                    |
|  +----------------------------------------------------------+   |
|  |           Schema Registry (YAML -> Zod -> JSON Schema)    |   |
|  +----------------------------+-----------------------------+   |
|                               |                                  |
|  +----------+  +----------+  +----------+                        |
|  | Claude   |  | Gemini   |  | Mistral  |  <- parallel           |
|  | Provider |  | Provider |  | Provider |    extraction           |
|  +----+-----+  +----+-----+  +----+-----+                        |
|       +----------- -+- -----------+                               |
|                     |                                             |
|  +----------------------------------------------------------+   |
|  |              Consensus Engine                              |   |
|  |  (majority vote, confidence scoring, disagreement          |   |
|  |   detection, APPROVE / MANUAL_REVIEW recommendation)       |   |
|  +----------------------------+-----------------------------+   |
|                               |                                  |
|  +----------------------------------------------------------+   |
|  |  Storage: extractedData (audit) + documentData (edit)      |   |
|  |  Real columns: indexed fields for search/filter            |   |
|  +----------------------------------------------------------+   |
+-----------------------------------------------------------------+
          | events                    | query
   +------+-------+          +-------+----------+
   | Downstream    |          | Detail Panel UI   |
   | Modules       |          | PDF preview +     |
   | (AP, Bank     |          | section editor    |
   |  Reconcile)   |          +------------------+
   +--------------+
```

### Schema-Driven Architecture

Document types are defined entirely in YAML files. Each schema specifies:

```yaml
schema:
  version: "1.0"
  name: "Vendor Invoice"
  documentType: "vendor_invoice"

detection:
  patterns:
    - regex: "invoice|faktura|rechnung"
      weight: 50
    - regex: "VAT|tax.?id|NIP"
      weight: 30
  requiredPatterns:
    - "invoice|faktura|rechnung"
  negativePatterns:
    - regex: "proforma|pro.?forma"
      weight: -20
  minScore: 40

fields:
  invoice_number:
    type: string
    required: true
    description: "Invoice number/identifier"
  invoice_date:
    type: date
    required: true
    description: "Date the invoice was issued"
  seller:
    type: object
    properties:
      name:
        type: string
        required: true
      tax_id:
        type: string
  line_items:
    type: array
    itemSchema:
      description:
        type: string
        required: true
      quantity:
        type: decimal
      gross_amount:
        type: decimal
        required: true
  currency:
    type: string
    required: true

normalization:
  rules:
    - path: "line_items.*.gross_amount"
      transform: decimal_2dp
    - path: "invoice_date"
      transform: iso_date
    - path: "currency"
      transform: uppercase
```

**Predefined schemas** ship with the module:
- Vendor Invoice
- Purchase Order
- Receipt / Proof of Payment
- Bank Statement
- Delivery Note
- Credit Memo

**Custom schemas** can be added per tenant via a settings UI or by placing YAML files in a configurable directory. The `SchemaRegistry` hot-loads them at runtime.

### Key Design Decisions

1. **YAML-first schema system** — Document types are data, not code. Adding a new type requires only a YAML file with detection patterns and field definitions. The system generates Zod schemas, JSON Schema (for structured output APIs), and extraction prompts automatically.

2. **Multi-provider consensus** — Running 2-3 LLM providers in parallel and voting on results dramatically reduces hallucination risk for critical fields (amounts, dates, identifiers). Single-provider mode is supported for cost-sensitive deployments.

3. **Dual data copies** — `extractedData` is the immutable audit trail (what the AI actually returned). `documentData` is the working copy users edit. This preserves provenance while allowing corrections.

4. **Real columns for key fields** — Document number, date, currency, seller, amount, and other frequently-filtered fields are stored as real indexed database columns, not just inside JSONB. This enables fast DynamicTable filtering and sorting.

5. **Schema-driven UI** — The detail panel sections (field groups, tables, nested objects) are generated from the YAML schema definition. Custom document types get a working UI automatically.

---

## Data Models

### ParsedDocument

Table: `parsed_documents`

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| id | uuid PK | no | `gen_random_uuid()` |
| organization_id | uuid | no | tenant scoping |
| tenant_id | uuid | no | tenant scoping |
| name | text | yes | document name |
| document_type | text | yes | detected type (from schema registry) |
| document_type_confidence | numeric | yes | detection confidence 0-100 |
| attachment_id | uuid | yes | FK to attachments module |
| **Processing** | | | |
| processing_status | text | no | `pending` / `processing` / `completed` / `failed` |
| processed_at | timestamptz | yes | |
| processing_result | jsonb | yes | full pipeline result (providers, timings) |
| consensus_confidence | numeric | yes | overall extraction confidence 0-100 |
| consensus_recommendation | text | yes | `APPROVE` / `MANUAL_REVIEW` |
| **Data** | | | |
| raw_text | text | yes | OCR output |
| extracted_data | jsonb | yes | immutable audit copy |
| document_data | jsonb | yes | editable working copy |
| **Real Columns (Indexed)** | | | |
| document_number | text | yes | invoice/PO/receipt number |
| document_date | timestamptz | yes | |
| currency | text | yes | ISO 4217 |
| counterparty_name | text | yes | vendor/customer name |
| counterparty_tax_id | text | yes | tax identification |
| total_amount | numeric(18,4) | yes | total/gross amount |
| **Relations** | | | |
| related_entity_id | uuid | yes | linked ERP record |
| related_entity_type | text | yes | e.g., `ap_invoice`, `sales_order` |
| schema_id | text | yes | which YAML schema was used |
| **Edit Tracking** | | | |
| edited_by | uuid | yes | |
| edited_at | timestamptz | yes | |
| **Standard** | | | |
| created_at | timestamptz | no | |
| updated_at | timestamptz | no | |
| deleted_at | timestamptz | yes | soft delete |
| created_by | uuid | yes | |
| updated_by | uuid | yes | |

**Indexes:** `(tenant_id, organization_id)`, `document_number`, `counterparty_name`, `document_date`, `processing_status`

### ParsedDocumentPage

Table: `parsed_document_pages`

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| id | uuid PK | no | |
| document_id | uuid FK | no | -> parsed_documents |
| page_number | integer | no | |
| storage_path | text | no | path in object store |
| storage_driver | text | no | e.g., `local`, `s3` |
| width | integer | yes | image dimensions |
| height | integer | yes | |
| file_size | integer | yes | bytes |

### DocumentSchema (tenant custom schemas)

Table: `document_schemas`

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| id | uuid PK | no | |
| organization_id | uuid | no | tenant scoping |
| tenant_id | uuid | no | tenant scoping |
| name | text | no | human-readable name |
| document_type | text | no | unique per tenant |
| schema_yaml | text | no | full YAML content |
| is_active | boolean | no | default true |
| created_at | timestamptz | no | |
| updated_at | timestamptz | no | |

---

## API Contracts

### Document CRUD

| Method | Path | Feature | Description |
|--------|------|---------|-------------|
| GET | `/api/document_parser/documents` | `document_parser.view` | List documents (paginated, filterable, searchable) |
| POST | `/api/document_parser/documents` | `document_parser.manage` | Create document (upload + optional auto-extract) |
| GET | `/api/document_parser/documents/:id` | `document_parser.view` | Get document detail with extracted data |
| PUT | `/api/document_parser/documents/:id` | `document_parser.manage` | Update document metadata or extracted data |
| DELETE | `/api/document_parser/documents/:id` | `document_parser.manage` | Soft-delete |

### Extraction

| Method | Path | Feature | Description |
|--------|------|---------|-------------|
| POST | `/api/document_parser/documents/:id/extract` | `document_parser.manage` | Trigger extraction pipeline |
| GET | `/api/document_parser/documents/:id/extract` | `document_parser.view` | Get extraction status and results |
| POST | `/api/document_parser/documents/:id/re-extract` | `document_parser.manage` | Re-run extraction (e.g., after schema update) |

### Schemas

| Method | Path | Feature | Description |
|--------|------|---------|-------------|
| GET | `/api/document_parser/schemas` | `document_parser.view` | List all schemas (predefined + custom) |
| GET | `/api/document_parser/schemas/:type` | `document_parser.view` | Get schema detail |
| POST | `/api/document_parser/schemas` | `document_parser.schemas.manage` | Create custom schema (YAML upload) |
| PUT | `/api/document_parser/schemas/:id` | `document_parser.schemas.manage` | Update custom schema |
| DELETE | `/api/document_parser/schemas/:id` | `document_parser.schemas.manage` | Delete custom schema |
| POST | `/api/document_parser/schemas/validate` | `document_parser.schemas.manage` | Validate YAML schema without saving |

### Table Config

| Method | Path | Feature | Description |
|--------|------|---------|-------------|
| GET | `/api/document_parser/table-config` | `document_parser.view` | Column definitions for DynamicTable |

### List API Response Example

```json
{
  "items": [{
    "id": "uuid",
    "name": "Invoice-2026-0042.pdf",
    "documentType": "vendor_invoice",
    "documentNumber": "FV/2026/0042",
    "documentDate": "2026-02-10T00:00:00Z",
    "counterpartyName": "Acme Supplies Ltd",
    "counterpartyTaxId": "GB123456789",
    "totalAmount": "12450.00",
    "currency": "EUR",
    "processingStatus": "completed",
    "consensusConfidence": 92.5,
    "consensusRecommendation": "APPROVE",
    "createdAt": "2026-02-16T..."
  }],
  "total": 47,
  "page": 1,
  "pageSize": 50,
  "totalPages": 1
}
```

### Extraction Response Example

```json
{
  "ok": true,
  "documentId": "uuid",
  "documentType": "vendor_invoice",
  "documentTypeConfidence": 85,
  "consensus": {
    "recommendation": "APPROVE",
    "overallConfidence": 92.5,
    "data": { "...consensusData" },
    "disagreements": [],
    "providerCount": 3
  },
  "processingTimeMs": 8234
}
```

---

## UI/UX

### New Pages

| Page | Description |
|------|-------------|
| `backend/document-parser/page.tsx` | Document list — DynamicTable with document-specific columns (type, number, date, counterparty, amount, currency, status). ReadOnly columns styled as normal (white). Server-side filtering, sorting, search. |
| `backend/document-parser/schemas/page.tsx` | Schema management — list predefined and custom schemas, create/edit custom schemas with YAML editor and live validation preview |

### Components

| Component | Description |
|-----------|-------------|
| `DocumentUploadDialog` | Drag-and-drop batch upload with category auto-detection, optional AI extraction toggle, real-time progress per file |
| `DocumentDetailPanel` | Right-side sheet with split view: PDF page preview (left) with thumbnail navigation, extracted data sections (right) with inline editing. Sections dynamically generated from YAML schema. |
| `SchemaEditor` | YAML editor with syntax highlighting, live validation, detection pattern tester, field preview |
| `ExtractionStatusBadge` | Color-coded badge showing processing status and confidence level |
| `ConsensusDetailView` | Shows per-provider extraction results and disagreements for debugging |

### DynamicTable Columns

| Column | Width | Type | Notes |
|--------|-------|------|-------|
| Name | 250 | editable link | Clickable, opens detail panel |
| Document Type | 120 | readOnly | Color-coded badge |
| Doc Number | 160 | readOnly | |
| Date | 120 | readOnly | |
| Counterparty | 180 | readOnly | |
| Amount | 120 | readOnly | |
| Currency | 80 | readOnly | |
| Status | 100 | readOnly | Processing status badge |
| Confidence | 80 | readOnly | Percentage with color coding |
| Download | 90 | readOnly | Download link |

**Table Configuration:**
- `readOnlyStyle: 'normal'` — readOnly columns render with white background (not grayed out)
- Server-side filter suggestions via `useFilterSuggestions`
- Server-side sorting and search across document-specific fields
- Perspective support (save/load column layouts)

### Document Detail Panel

Right-side sheet with split view:
- **Left**: PDF page preview with thumbnail navigation
- **Right**: Extracted data in document-type-specific sections

Section types:
- **Flat sections**: key-value pairs (header info, totals)
- **Object sections**: nested objects (seller, buyer)
- **Array sections**: line items, goods

Features: edit mode, save, download, confidence badges, processing status.

---

## Events

```typescript
const events = [
  { id: 'document_parser.document.created', label: 'Document Created', entity: 'parsed_document', category: 'crud' },
  { id: 'document_parser.document.updated', label: 'Document Updated', entity: 'parsed_document', category: 'crud' },
  { id: 'document_parser.document.deleted', label: 'Document Deleted', entity: 'parsed_document', category: 'crud' },
  { id: 'document_parser.extraction.completed', label: 'Extraction Completed', entity: 'parsed_document', category: 'lifecycle' },
  { id: 'document_parser.extraction.failed', label: 'Extraction Failed', entity: 'parsed_document', category: 'lifecycle' },
  { id: 'document_parser.document.approved', label: 'Document Approved', entity: 'parsed_document', category: 'lifecycle' },
  { id: 'document_parser.document.edited', label: 'Document Data Edited', entity: 'parsed_document', category: 'lifecycle' },
] as const
```

The `extraction.completed` event is the primary integration point — downstream modules (AP, bank reconciliation) subscribe to this event to auto-create records from extracted data.

---

## RBAC Features

| Feature | Description |
|---------|-------------|
| `document_parser.view` | View documents and extraction results |
| `document_parser.manage` | Upload, extract, edit, delete documents |
| `document_parser.schemas.view` | View schema definitions |
| `document_parser.schemas.manage` | Create/edit/delete custom schemas |

---

## Commands

| Command ID | Description | Undoable |
|------------|-------------|----------|
| `document_parser.documents.create` | Create document with attachment | Yes (soft-delete) |
| `document_parser.documents.update` | Update metadata (name, type) | Yes (restore previous values) |
| `document_parser.documents.delete` | Soft-delete document | Yes (restore) |
| `document_parser.documents.updateDocumentData` | Update extracted data fields and real columns | Yes (restore previous data) |
| `document_parser.documents.process` | Trigger extraction pipeline | No (idempotent, re-runnable) |
| `document_parser.schemas.create` | Create custom schema | Yes (soft-delete) |
| `document_parser.schemas.update` | Update custom schema | Yes (restore previous YAML) |
| `document_parser.schemas.delete` | Delete custom schema | Yes (restore) |

---

## Search Configuration

Full-text search indexing via `search.ts`:

**Indexed fields:** name, document_type, document_number, document_date, counterparty_name, counterparty_tax_id, currency, total_amount

**Deep indexing:** Walks `documentData` JSONB to index all nested string values.

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `DOCUMENT_PARSER_ENABLED` | `true` | Feature flag |
| `DOCUMENT_PARSER_OCR_PROVIDER` | `mistral` | OCR provider (`mistral` / `tesseract`) |
| `DOCUMENT_PARSER_LLM_PROVIDERS` | `mistral,anthropic` | Comma-separated list of extraction providers |
| `DOCUMENT_PARSER_CONSENSUS_MIN_PROVIDERS` | `2` | Minimum providers for consensus (1 = single-provider mode) |
| `DOCUMENT_PARSER_CUSTOM_SCHEMAS_DIR` | — | Optional directory for file-based custom schemas |
| `MISTRAL_API_KEY` | — | Mistral API key (OCR + extraction) |
| `ANTHROPIC_API_KEY` | — | Anthropic Claude API key (extraction) |
| `GEMINI_API_KEY` | — | Google Gemini API key (extraction) |

---

## Module Files

| File | Export | Purpose |
|------|--------|---------|
| `index.ts` | `metadata` | Module metadata (id: `document_parser`) |
| `acl.ts` | `features` | RBAC features (view, manage, schemas.view, schemas.manage) |
| `setup.ts` | `setup` | Tenant initialization, default role features |
| `events.ts` | `eventsConfig` | Typed event declarations |
| `di.ts` | `register` | DI registrar (services, schema registry, providers) |
| `search.ts` | `searchConfig` | Search indexing configuration |
| `data/entities.ts` | — | ParsedDocument, ParsedDocumentPage, DocumentSchema entities |
| `data/validators.ts` | — | Zod validation schemas |
| `data/schemas/*.yaml` | — | Predefined document type schemas |
| `services/schema-registry.service.ts` | — | Load YAML schemas, generate Zod/JSON Schema |
| `services/document-detector.service.ts` | — | Weighted pattern matching classifier |
| `services/pipeline/orchestrator.ts` | — | Pipeline: OCR -> classify -> extract -> consensus -> store |
| `services/pipeline/consensus.ts` | — | Multi-provider consensus engine |
| `services/providers/mistral.ts` | — | Mistral OCR + extraction provider |
| `services/providers/anthropic.ts` | — | Claude extraction provider |
| `services/providers/gemini.ts` | — | Gemini extraction provider |

---

## Implementation Phases

### Phase 1: Core Engine

- [ ] Scaffold module structure (index.ts, acl.ts, setup.ts, events.ts, di.ts, search.ts)
- [ ] Create MikroORM entities (ParsedDocument, ParsedDocumentPage, DocumentSchema)
- [ ] Implement SchemaRegistry — load YAML schemas, generate Zod/JSON Schema, build extraction prompts
- [ ] Implement DocumentDetector — weighted pattern matching classifier
- [ ] Implement OCR provider (Mistral)
- [ ] Implement LLM extraction providers (Mistral, Claude, Gemini)
- [ ] Implement ConsensusEngine — multi-provider voting and confidence scoring
- [ ] Implement PipelineOrchestrator — OCR -> classify -> extract -> consensus -> store
- [ ] Document CRUD commands (create, update, delete, updateData)
- [ ] Document CRUD API routes with OpenAPI specs
- [ ] Extraction API route (POST trigger + GET status)
- [ ] Database migration
- [ ] Ship predefined schemas: vendor_invoice, purchase_order, receipt, bank_statement, delivery_note, credit_memo

### Phase 2: UI

- [ ] Document list page with DynamicTable (server-side filter/sort/search)
- [ ] DocumentUploadDialog (batch upload, drag-and-drop, auto-extract toggle)
- [ ] DocumentDetailPanel (PDF preview + section editor)
- [ ] Document-type-specific section configs (auto-generated from schemas)
- [ ] Extraction status badges and confidence indicators
- [ ] Table config API endpoint
- [ ] Perspective support (save/load column layouts)

### Phase 3: Custom Schemas

- [ ] DocumentSchema entity and CRUD
- [ ] Schema management page with YAML editor
- [ ] Schema validation endpoint
- [ ] SchemaRegistry hot-reload for custom schemas
- [ ] Detection pattern tester UI

### Phase 4: Integration Points

- [ ] Event emission for downstream modules
- [ ] Integration with Financial Management Module (#260): extracted vendor invoices -> AP invoice creation
- [ ] Integration with InboxOps (#573): email attachment processing
- [ ] Search indexing (fulltext on extracted data)
- [ ] AI tools for MCP (list documents, get extraction results, trigger extraction)
- [ ] Webhook events for external integrations

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `@ai-sdk/anthropic` | Claude extraction provider |
| `@ai-sdk/google` | Gemini extraction provider |
| `@ai-sdk/mistral` | Mistral OCR + extraction |
| `js-yaml` | YAML schema parsing |
| `zod` | Runtime schema generation and validation |
| `pdf-lib` or `pdfjs-dist` | PDF page image extraction |

---

## Risks & Impact Review

#### LLM Provider Unavailability
- **Scenario**: One or more LLM providers (Mistral, Claude, Gemini) are down or rate-limited during extraction
- **Severity**: Medium
- **Affected area**: Document extraction pipeline, processing status stuck in `processing`
- **Mitigation**: Consensus engine works with 1+ providers; configurable timeout per provider (default 30s); pipeline marks document as `failed` with error details if all providers fail; user can re-trigger extraction later
- **Residual risk**: Single-provider extraction has lower confidence; acceptable for non-critical documents

#### OCR Quality on Scanned Documents
- **Scenario**: Poor scan quality leads to garbled OCR text, causing misclassification and extraction errors
- **Severity**: Medium
- **Affected area**: All downstream processing (classification, extraction, real column population)
- **Mitigation**: Confidence scores flag low-quality extractions; `consensusRecommendation: 'MANUAL_REVIEW'` triggers human review; raw_text preserved for debugging
- **Residual risk**: Some documents will require manual data entry; this is expected and the UI supports it

#### JSONB Data Growth
- **Scenario**: `extractedData`, `documentData`, `processingResult` columns grow large for documents with many line items or complex structures
- **Severity**: Low
- **Affected area**: Database storage, query performance on detail view loads
- **Mitigation**: Real columns used for list/filter queries (not JSONB); JSONB only loaded on single-document detail view; list queries select only real columns
- **Residual risk**: Storage costs grow linearly with document count; acceptable at current scale

#### Tenant Data Isolation
- **Scenario**: Cross-tenant data leak via document queries or shared schema registry cache
- **Severity**: Critical
- **Affected area**: All API endpoints, schema registry
- **Mitigation**: Every query filters by `tenantId` and `organizationId`; commands enforce scope; custom schemas are tenant-scoped; predefined schemas are shared but read-only (no tenant data in them)
- **Residual risk**: None — scope enforcement is mandatory in all code paths

#### Concurrent Extraction Requests
- **Scenario**: Multiple users trigger extraction on the same document simultaneously
- **Severity**: Low
- **Affected area**: Document data consistency, wasted LLM API spend
- **Mitigation**: `processingStatus` check before starting extraction (reject if already `processing`); last-write-wins for real columns (acceptable since extraction is idempotent)
- **Residual risk**: Brief race condition window between status check and update; acceptable as extraction produces deterministic results

#### Custom Schema Injection
- **Scenario**: Malicious YAML content in custom schemas causes regex DoS (ReDoS) or extraction prompt injection
- **Severity**: High
- **Affected area**: Schema registry, document detection, LLM extraction prompts
- **Mitigation**: YAML validation endpoint checks regex complexity before saving; extraction prompts are templated with schema fields, not raw YAML content; regex patterns run with timeout; schema YAML size limit enforced
- **Residual risk**: Novel regex patterns may still cause slowdowns; monitoring needed

#### Migration & Deployment
- **Scenario**: Adding new table `parsed_documents` with indexes on a production database
- **Severity**: Low
- **Affected area**: Database migration, deployment downtime
- **Mitigation**: New tables only (no altering existing tables); `CREATE TABLE` and `CREATE INDEX` are non-blocking; migration is additive and backward-compatible
- **Residual risk**: None — no existing data affected

#### API Cost Control
- **Scenario**: Bulk document upload triggers hundreds of parallel LLM extractions, causing unexpected API bills
- **Severity**: Medium
- **Affected area**: LLM provider costs, API rate limits
- **Mitigation**: Extraction is opt-in (toggle in upload dialog); batch uploads queue extractions rather than running all in parallel; configurable concurrency limit; per-tenant extraction budget can be added in future
- **Residual risk**: No hard spending cap in Phase 1; acceptable for initial deployment with manual monitoring

---

## Changelog

### 2026-02-22
- Created SPEC-034 from issue #574
- Renumbered from issue's SPEC-023 (already taken) to SPEC-034

### 2026-02-16
- Initial specification (in issue #574)
- Core flow: Upload -> OCR -> Classification -> Parallel LLM Extraction -> Consensus -> Storage
- Data models: ParsedDocument, ParsedDocumentPage, DocumentSchema
- API contracts: Document CRUD, Extraction trigger/status, Schema management
- UI: Document list with DynamicTable, detail panel with PDF preview + section editor
- Events: 7 typed events including extraction.completed as primary integration point
- RBAC: 4 features (view, manage, schemas.view, schemas.manage)
- Predefined schemas: vendor_invoice, purchase_order, receipt, bank_statement, delivery_note, credit_memo
- Custom schema support per tenant with YAML editor and validation
- 4 implementation phases: Core Engine, UI, Custom Schemas, Integration Points
