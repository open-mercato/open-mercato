# SPEC-041 — Airtable Import Module

**Date:** 2026-02-24
**Status:** Approved
**Author:** Open Mercato Team

---

## TLDR

Built-in OM module providing a 7-step wizard for one-time migration of data from Airtable bases to Open Mercato. Targets business users (no CLI required). Supports tables, records, relations, users, and attachments with heuristic module matching and pre-generated UUID plan for idempotent, resumable imports.

---

## Overview

The `airtable_import` module lives in `packages/core/src/modules/airtable_import/` and delivers a full-screen wizard at `/backend/airtable-import`. It is available to `admin` and `superadmin` roles by default. Import runs as a background worker via `@open-mercato/queue`.

---

## Problem Statement

Teams migrating from Airtable to Open Mercato currently have no built-in path. Manual imports require developer access, SQL knowledge, and custom scripts — making adoption harder for non-technical users.

---

## Proposed Solution

A 7-step wizard that:
1. **Connects** to Airtable (token + base ID validation)
2. **Analyzes** the base schema via Airtable Metadata API
3. **Maps modules** — heuristic scoring to suggest `customers.people`, `catalog.products`, `sales.orders`, etc. or Custom Entity fallback
4. **Maps fields** — Airtable types → OM custom field types
5. **Configures** options (users, attachments, date handling)
6. **Plans** — one read pass over Airtable, pre-generates UUIDs for every record → `plan_json`; idempotent from here
7. **Transfers** — background worker, 3-pass import (scalars → relations → date restoration) + optional user pass; live SSE log stream

After step 7: a report screen with per-table stats, records requiring attention, retry flow for failed records, and CSV export.

---

## Architecture

```
packages/core/src/modules/airtable_import/
├── index.ts                      # ModuleInfo metadata
├── acl.ts                        # features: airtable_import.view, .manage
├── setup.ts                      # defaultRoleFeatures: admin + superadmin
├── data/
│   ├── entities.ts               # ImportSession MikroORM entity
│   └── validators.ts             # Zod schemas
├── lib/
│   ├── airtable-client.ts        # Airtable REST API client
│   ├── schema-analyzer.ts        # Schema discovery + field type mapping
│   ├── module-matcher.ts         # Heuristic scoring: table → OM module
│   ├── field-transformers.ts     # Value transformation per field type
│   └── importers/
│       ├── customers.ts          # POST /api/customers/people|companies|deals
│       ├── catalog.ts            # POST /api/catalog/products|categories
│       ├── sales.ts              # POST /api/sales/orders|invoices
│       └── custom-entity.ts     # Fallback → Custom Entity records API
├── api/
│   ├── connect/route.ts          # POST: validate token + base ID
│   ├── sessions/route.ts         # GET (list) / POST (create session)
│   └── sessions/[id]/
│       ├── schema/route.ts       # GET: fetch + analyze schema
│       ├── mapping/route.ts      # GET + PUT: read/update mapping
│       ├── execute/route.ts      # POST: enqueue import job
│       ├── retry/route.ts        # POST: retry failed records
│       ├── status/route.ts       # GET: import progress snapshot
│       └── logs/route.ts         # GET: SSE stream of ImportLogEntry
├── backend/
│   └── airtable-import/
│       ├── page.tsx              # Session list + "New import" button
│       └── [id]/page.tsx         # 7-step wizard
└── workers/
    └── import-worker.ts          # Background job: 3-pass import engine
```

---

## Data Models

### `import_sessions` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `tenant_id` | UUID | Multi-tenant isolation |
| `organization_id` | UUID | Org isolation |
| `status` | enum | `draft \| analyzing \| ready \| importing \| done \| failed` |
| `current_step` | int | Active wizard step (1–7) |
| `airtable_token` | text | Encrypted via `TenantDataEncryptionService` |
| `airtable_base_id` | text | |
| `schema_json` | jsonb | Discovered schema (step 2) |
| `mapping_json` | jsonb | User-approved mapping (steps 3–4) |
| `config_json` | jsonb | Import options (step 5) |
| `plan_json` | jsonb | Pre-generated UUIDs per record (step 6) |
| `progress_json` | jsonb | Live progress + `ImportLogEntry[]` logs |
| `report_json` | jsonb | Final report: successes, warnings, errors |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### Key TypeScript Interfaces

```typescript
type ImportSessionStatus = 'draft' | 'analyzing' | 'ready' | 'importing' | 'done' | 'failed'

interface StepMetrics {
  startedAt: string
  finishedAt?: string
  durationMs?: number
  throughputRps?: number
  batchCount: number
  failedBatches: number
}

interface ImportLogEntry {
  ts: string             // ISO timestamp
  level: 'info' | 'warn' | 'error'
  table?: string         // scoped to airtableTableId
  message: string
}

interface RecordProgress {
  status: 'pending' | 'done' | 'failed' | 'needs_attention'
  omId?: string
  error?: string
}

interface ImportProgress {
  tables: Record<string, {
    total: number
    done: number
    failed: number
    needsAttention: number
    records: Record<string, RecordProgress>
    metrics: StepMetrics
  }>
  currentTable: string | null
  startedAt: string
  pass: 1 | 2 | 3 | 4
  logs: ImportLogEntry[]
}
```

---

## API Contracts

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/airtable-import/connect` | Validate token + base ID |
| GET | `/api/airtable-import/sessions` | List sessions (tenant-scoped) |
| POST | `/api/airtable-import/sessions` | Create new session |
| GET | `/api/airtable-import/sessions/:id/schema` | Fetch + analyze Airtable schema |
| GET | `/api/airtable-import/sessions/:id/mapping` | Get current mapping |
| PUT | `/api/airtable-import/sessions/:id/mapping` | Update mapping |
| POST | `/api/airtable-import/sessions/:id/execute` | Enqueue import worker |
| POST | `/api/airtable-import/sessions/:id/retry` | Retry failed records |
| GET | `/api/airtable-import/sessions/:id/status` | Live progress snapshot |
| GET | `/api/airtable-import/sessions/:id/logs` | SSE stream of log entries |

All routes export `openApi` per core convention. All routes guarded by `requireFeatures: ['airtable_import.manage']`.

---

## Heuristic Module Matcher

Scoring: `score = name_points + critical_field_points + supporting_field_points`

| Score | Status | UX |
|-------|--------|----|
| > 70 | ✅ Certain | One-click accept |
| 40–70 | ⚡ Probable | Suggestion with confirmation |
| < 40 | ❓ Unknown | No suggestion — manual pick |

Fallback when no module exceeds 40 pts: `Custom Entity`.

---

## Import Engine — Three-Pass Strategy

```
Pass 1 — scalar fields (all records without relations)
Pass 2 — relations (linked records, after ID mapping)
Pass 3 — date restoration (SQL UPDATE created_at / updated_at)
Pass 4 — users (optional, if enabled in config)
```

Idempotency: `INSERT ... ON CONFLICT (id) DO NOTHING` using pre-generated UUIDs from `plan_json`.

Traceability: every imported record gets a custom field `airtable_id` storing the original Airtable record ID.

---

## UI/UX

- **Session list** (`/backend/airtable-import`): DataTable with status badges, session name, base name, progress, created date, row actions
- **Wizard** (`/backend/airtable-import/:id`): 7-step stepper, each step a separate view, steps 1–6 freely navigable, step 7 one-way
- **Step 7 live view**: progress bar + SSE log stream (`EventSource` → `GET /api/.../logs`), no polling
- **Report**: stat cards (imported / warnings / errors / duration), per-table table, retry button, CSV export

---

## Security & RBAC

- Feature: `airtable_import.manage` (required for all write operations), `airtable_import.view` (list/status)
- Default roles: `admin` + `superadmin` get both features
- Airtable token encrypted at rest via `TenantDataEncryptionService`
- All queries filtered by `tenant_id` + `organization_id`
- SQL patch for date restoration executed by worker (direct DB access, not public API)

---

## Risks & Impact Review

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Airtable API rate limits (5 req/s) | Medium | Built-in rate limiting with backoff in `airtable-client.ts` |
| Large bases (100k+ records) | Medium | Batched processing (100 records/batch), resumable via `plan_json` |
| Cyclic table relations | Low | Topological sort with cycle detection; both tables in pass 2 |
| Storage not configured (attachments) | Low | Warning in step 5, option to skip attachments |
| Token leakage | Low | Encrypted at rest, never logged, masked in UI |

---

## Out of Scope (v1)

- Continuous sync (ongoing)
- Airtable view imports (Gallery, Calendar, Kanban)
- Record revision history import
- Comment import
- Re-import from CSV file
- AI-assisted mapping

---

## Implementation Reference

See:
- `docs/plans/2026-02-24-airtable-import-design.md` — full design document
- `docs/plans/2026-02-24-airtable-import-plan.md` — task-by-task implementation plan

---

## Changelog

### 2026-02-24
- Initial specification — derived from design doc and brainstorming session