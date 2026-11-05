# Usage Telemetry & "Phone Home" Verification

**Date:** 2026-06-04
**Status:** Draft
**Edition:** Enterprise (client ships as OSS package; central admin module is a separate commercial repo)
**Scope:** Outbound usage telemetry client (monorepo OSS package) + central ingestion/admin module (separate npm package, separate repo)

## TLDR
**Key Points:**
- On-premise / self-hosted Open Mercato installs report **aggregate** usage counts to a central Open Mercato instance ("phone home"). This enables transparent enterprise billing verification without Open Mercato needing standing access to a customer's code or database.
- Two deliverables: (1) `@open-mercato/telemetry-client` — a small **OSS** package in this monorepo that collects and sends aggregate metrics; (2) a **central telemetry admin module** shipped as a **separate commercial npm package in a separate repo** that ingests reports and lists every reporting installation.
- The client is **fail-safe and non-blocking by design**: it never runs on a request hot path, never scans user data, and hard-aborts any central call that errors or exceeds **100 ms** so it can never slow down Open Mercato.

**Scope:**
- Aggregate counters only: server IP (hint + observed), instance URL, health/up status, counts of users / organizations / tenants, enabled-modules list, and main-entity record counts for `customers`, `sales`, `catalog`.
- Dual operating mode:
  - **Enterprise mode** — license key present (`OM_LICENSE_KEY`): telemetry enabled by default, report carries the license key for billing verification.
  - **OSS-distribution mode** — no license key, but `OM_ENABLE_TELEMETRY=true`: anonymous distribution observability, report carries no license key.
- Daily scheduled report via a queue worker (with jitter), never synchronous to user traffic.
- Hard kill switch and privacy guarantees (no PII, no row contents, only counts).

**Concerns:**
- Collecting `server IP` and `instanceUrl` is operational metadata, not user PII, but MUST be documented and opt-out-able.
- A misbehaving or slow central endpoint must be provably incapable of degrading the host app — the 100 ms abort budget and worker isolation are the load-bearing mitigations.
- "Enabled by default in enterprise mode" must still honour an explicit kill switch and must be clearly disclosed.

> **Market Reference**: Studied PostHog/Plausible self-host telemetry, Sentry's `SENTRY_BEACON`, Next.js anonymous telemetry, GitLab Service Ping / Seat Link, and Elastic/Sentry "phone home" license check-ins.
> **Adopted**: aggregate-counts-only payload, single daily beacon, hard opt-out env, server-derived IP, and the GitLab "Seat Link" pattern of reporting seat/usage counts for license verification without code access.
> **Rejected**: per-event streaming telemetry, any row-level or free-text payload, blocking the boot or request path on the beacon, and silent always-on collection without an env disclosure.

## Enterprise Availability & Package Split
This feature spans two repositories and three artifacts:

| Artifact | Repo | License | Notes |
|----------|------|---------|-------|
| `@open-mercato/telemetry-client` | this monorepo (`packages/telemetry-client`) | OSS | Collector + sender + daily worker. Present in OSS builds; dormant unless enabled. |
| `telemetry` module wiring | this monorepo (`apps/mercato/src/modules.ts` enable) | OSS | Registers the worker + DI; no business logic of its own. |
| Central telemetry admin module | **separate commercial repo** (e.g. `open-mercato/telemetry-central`) | Proprietary | Ingestion API + admin UI listing all installations. NOT in core, NOT in this monorepo. |

- The **client is OSS** so the OSS distribution can be observed too. It does not require `packages/enterprise`.
- The **central admin module is commercial** and lives in its own repo. This spec defines its ingestion contract and data model but its implementation ships in that repo. It is itself just an Open Mercato instance running a dedicated `telemetry` module.
- No core (`packages/core`) module is added or modified for ingestion.

## Problem Statement
- Open Mercato Enterprise is licensed by usage (seats / tenants / installs). Today there is no transparent, low-trust way to verify on-premise usage without asking customers for database or repository access — which customers reasonably refuse.
- The OSS project has no signal at all about how many installations exist, which modules are used, or at what scale — making roadmap and support prioritisation guesswork.
- Any naive "call home" implementation risks (a) leaking customer data, (b) blocking or slowing the host app when the central endpoint is slow/down, or (c) running silently without disclosure. All three are unacceptable.

## Proposed Solution
Ship a tiny OSS client package that, once per day via a queue worker, assembles an **aggregate-counts-only** snapshot and POSTs it to a configured central endpoint under a strict 100 ms total budget with full fail-safe semantics. A separate commercial central module ingests these reports and renders an admin list of installations.

### Operating Modes
| Mode | Trigger | License key in payload | Purpose |
|------|---------|------------------------|---------|
| Enterprise | `OM_LICENSE_KEY` set (and not killed) | Yes | Billing / seat verification |
| OSS-distribution | `OM_ENABLE_TELEMETRY=true`, no license key | No (anonymous `installId` only) | Distribution observability |
| Disabled | neither set, or kill switch on | — | No outbound calls at all |

`env.example` ships with telemetry **off** by default (`OM_ENABLE_TELEMETRY` unset/false, no license key).

### Enablement Resolution (precedence, first match wins)
1. `OM_TELEMETRY_DISABLED=true` → **disabled** (hard kill switch, always wins).
2. `OM_LICENSE_KEY` set → **enterprise mode** (enabled by default; the kill switch above is the only override).
3. `OM_ENABLE_TELEMETRY=true` → **OSS-distribution mode**.
4. otherwise → **disabled**.

### Design Decisions
| Decision | Rationale |
|----------|-----------|
| Aggregate counts only, never row data | Privacy-by-design; nothing identifiable about end users leaves the install |
| Daily queue worker, never request/boot hot path | Beacon cannot affect user-perceived latency or boot time |
| Hard 100 ms total budget with `AbortController` | A slow/broken central endpoint can never slow the host; the worker just records a failed attempt and moves on |
| Fail-safe / fail-open | Any error, timeout, non-2xx, or slow response is swallowed (logged at debug) — telemetry failure is never an app error |
| Client OSS, central commercial & out-of-repo | OSS distribution observability + clean separation; no proprietary ingestion code in the OSS tree |
| Server IP = client hint + server-observed | Client may send a best-effort hint; central server records the authoritative source IP from the request socket |
| License key supplied via `OM_LICENSE_KEY` env | Simplest for on-prem ops; key is hashed/truncated in logs, sent over TLS only |
| Stable `installId` persisted locally | Lets central dedupe installs across IP changes without identifying users |

### Alternatives Considered
| Alternative | Why Rejected |
|-------------|--------------|
| Report on every request / event stream | Hot-path risk + volume; violates "must not slow down OM by any means" |
| Beacon on app boot | Slows cold start; daily worker is sufficient and isolated |
| Put ingestion in `packages/core` or `packages/enterprise` | User requirement: central admin is a separate custom package in a separate repo |
| Ship client only under enterprise | Loses OSS-distribution observability the user explicitly asked for |
| Send raw row samples for "richer" insight | Privacy violation; explicitly out of scope |

## User Stories / Use Cases
- As **Open Mercato (licensor)**, I want aggregate seat/tenant/usage counts from on-prem installs so I can verify enterprise billing without accessing the customer's code or data.
- As an **on-prem operator**, I want telemetry to be transparent, documented, and disableable with a single env flag so I stay in control of what leaves my network.
- As an **OSS maintainer**, I want anonymous distribution counts so I can prioritise roadmap and support.
- As a **platform engineer**, I want a guarantee that the beacon can never slow down or crash the app, even if the central server is down or slow.

## Architecture

### Component Flow
```
┌─────────────────────────── Open Mercato install (host) ───────────────────────────┐
│                                                                                    │
│  queue: "telemetry-report" (daily, jitter)                                         │
│        │                                                                           │
│        ▼                                                                           │
│  TelemetryReportWorker ──► TelemetryCollector ──► reads aggregate COUNTs only      │
│        │                     (em count(), enabled modules registry, health probe)  │
│        ▼                                                                           │
│  TelemetrySender (AbortController, 100ms total budget, fail-open)                   │
│        │  POST /api/telemetry/report  (TLS)                                         │
└────────┼───────────────────────────────────────────────────────────────────────────┘
         │ (fire-and-forget; any error/timeout/non-2xx is swallowed)
         ▼
┌─────────────────── Central Open Mercato instance (separate commercial repo) ───────┐
│  telemetry module:                                                                  │
│    POST /api/telemetry/report  → validate (zod) → record observed source IP →       │
│                                  upsert Installation + append InstallationReport     │
│    Backend admin UI: DataTable of installations (last seen, mode, counts, health)   │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### Why the worker, not a subscriber or middleware
- A queue worker runs off the request path on the host's existing queue infrastructure (`@open-mercato/queue`), so collection and the outbound call never touch user-facing latency.
- The worker is **idempotent** and self-rescheduling (daily). A missed run simply means a missing daily data point — no retry storm, no backlog pressure.

### Commands & Events
- No write Commands on the host (read-only collection).
- Optional client-local event for observability: `telemetry.report.sent` / `telemetry.report.skipped` (host-local, not broadcast).
- Central module (separate repo) uses standard `makeCrudRoute`-style ingestion + `createModuleEvents` (`telemetry.installation.reported`).

### Fail-Safe Contract (load-bearing)
The sender MUST guarantee all of the following:
1. **Total budget 100 ms.** A single `AbortController` aborts the fetch at `OM_TELEMETRY_TIMEOUT_MS` (default `100`). DNS + connect + TLS + response must all fit; otherwise the attempt is abandoned.
2. **Fail-open.** Any thrown error, `AbortError`, non-2xx status, or unreachable host resolves the send as `skipped`/`failed` and is logged at `debug` only. It is never rethrown into the worker as a job failure that would retry aggressively.
3. **No host coupling.** Collection uses lightweight `COUNT` queries with their own short timeout; if any count query is slow or fails, that field is reported as `null`, not blocking the rest.
4. **No hot path.** Nothing in this feature executes during HTTP request handling, SSR, or app boot.
5. **Single flight per day.** A local "last reported at" marker (cache/kv) prevents duplicate sends if the worker is triggered more than once.

## Data Models

### Client side (host) — local state only
No new business entities on the host. One small persisted key (via DI cache / kv) for:

#### `TelemetryLocalState` (Singular, local kv)
- `installId`: string (UUID v4, generated once, persisted) — stable anonymous installation id
- `lastReportedAt`: ISO string | null
- `lastStatus`: `'sent' | 'skipped' | 'failed'`

### Wire contract — `TelemetryReport` (Singular)
The exact POST body. All numeric fields are **counts**; any field that cannot be computed within budget is `null`.
```ts
export type TelemetryReport = {
  installId: string                 // stable anonymous install id (UUID)
  mode: 'enterprise' | 'oss'        // resolved operating mode
  licenseKey: string | null         // present only in enterprise mode
  sentAt: string                    // ISO timestamp (client clock)
  instance: {
    url: string | null              // OM_TELEMETRY_INSTANCE_URL or derived APP_URL
    serverIpHint: string | null     // best-effort client hint; central also records observed IP
    version: string | null          // app/package version
    edition: 'oss' | 'enterprise'
  }
  health: {
    status: 'up' | 'degraded'       // from local readiness probe (best-effort, budgeted)
  }
  counts: {
    users: number | null
    organizations: number | null
    tenants: number | null
    customers: number | null        // main entity of customers module
    salesOrders: number | null      // main entity of sales module
    catalogProducts: number | null  // main entity of catalog module
  }
  enabledModules: string[]          // module ids from the runtime registry
}
```

### Central side (separate commercial repo) — for reference, implemented there
These live in the central `telemetry` module, not in this monorepo. Included so the ingestion contract is unambiguous.

#### `Installation` (Singular)
- `id`: string (UUID)
- `install_id`: string (unique; from report `installId`)
- `mode`: `'enterprise' | 'oss'`
- `license_key_hash`: string | null (hashed, never stored raw)
- `instance_url`: string | null
- `last_server_ip`: string | null (server-observed, authoritative)
- `last_ip_hint`: string | null (client-reported hint)
- `last_health`: `'up' | 'degraded'`
- `last_version`: string | null
- `last_seen_at`: timestamp
- `created_at` / `updated_at`

#### `InstallationReport` (Singular, append-only history)
- `id`: string (UUID)
- `installation_id`: string (FK → `Installation.id`)
- `mode`, `license_key_hash`
- `observed_ip`: string (from request socket)
- `counts_json`: jsonb (the `counts` block)
- `enabled_modules`: jsonb (string[])
- `reported_at`: timestamp (server clock)
- `created_at`

> Cross-module rule: central `Installation` ↔ `InstallationReport` use FK id only (no ORM relation across module boundaries). Central module owns both.

## API Contracts

### Outbound (client → central)
- `POST {OM_TELEMETRY_ENDPOINT}/api/telemetry/report`
- Auth: none required for OSS mode; enterprise mode carries `licenseKey` in body. TLS required (HTTPS endpoint).
- Headers: `Content-Type: application/json`, `User-Agent: open-mercato-telemetry/<version>`
- Body: `TelemetryReport` (above)
- Timeout: hard-aborted at `OM_TELEMETRY_TIMEOUT_MS` (default `100`).
- Client treats any response other than `2xx` (and any timeout) as a no-op.

### Inbound (central ingestion — implemented in separate repo, contract defined here)
- `POST /api/telemetry/report`
- Validation: zod schema mirroring `TelemetryReport`; reject (`400`) malformed bodies.
- Behaviour: derive `observed_ip` from request socket; `upsert Installation` by `install_id`; append `InstallationReport`; hash `licenseKey` → `license_key_hash`.
- Response: `202 Accepted` with `{ ok: true }` (fast, no heavy work inline; defer enrichment to a worker if needed).
- MUST export `openApi`.
- Rate limiting / abuse protection at the edge (out of scope for client; noted for central impl).

### Central admin UI (separate repo)
- `GET /backend/telemetry` — `DataTable` of installations: `installId`, `mode`, `instanceUrl`, `lastServerIp`, `lastHealth`, counts, `lastSeenAt`. Standard `DataTable` + `apiCall` patterns; `acl.ts` feature `telemetry.view`.

## Internationalization (i18n)
- Client: only `[internal]`-prefixed debug logs — no user-facing strings.
- Central admin UI (separate repo): standard `useT()` keys under `telemetry.*` (column headers, health labels, empty state). No hardcoded strings.

## Configuration
All client behaviour is env-driven. `env.example` ships telemetry **off**.

| Env var | Default | Purpose |
|---------|---------|---------|
| `OM_ENABLE_TELEMETRY` | unset (off) | Enables OSS-distribution mode when no license key is present |
| `OM_LICENSE_KEY` | unset | Presence enables enterprise mode (telemetry on by default) and is sent for billing verification |
| `OM_TELEMETRY_DISABLED` | unset (off) | Hard kill switch; when `true`, no outbound calls regardless of other flags |
| `OM_TELEMETRY_ENDPOINT` | `https://telemetry.openmercato.com` | Central ingestion base URL |
| `OM_TELEMETRY_TIMEOUT_MS` | `100` | Total outbound budget; fetch aborted past this |
| `OM_TELEMETRY_INTERVAL_HOURS` | `24` | Reporting cadence (worker reschedule) |
| `OM_TELEMETRY_INSTANCE_URL` | unset → derive from `APP_URL` | Reported `instance.url` |
| `OM_TELEMETRY_IP_HINT` | unset | Optional explicit server IP hint; otherwise best-effort/none |

Precedence for enablement is the ordered list in **Enablement Resolution** above (kill switch → license → enable flag → off).

## UI/UX
- Host app: no UI. Telemetry status is observable only via debug logs / local kv.
- Central (separate repo): a single backend `DataTable` page listing installations, guarded by `telemetry.view`. Uses DS primitives (`StatusBadge` for health, `DataTable`, `EmptyState`); no hardcoded status colors.

## Migration & Compatibility
- Host: no DB migration (local kv only). Purely additive new OSS package + worker registration. Backward compatible; dormant unless enabled.
- Central: migrations live in the separate repo.
- Contract surface: `TelemetryReport` wire type is a new STABLE contract; future fields MUST be additive (nullable) per `BACKWARD_COMPATIBILITY.md`.

## Implementation Plan

### Phase 1: Client package skeleton (`@open-mercato/telemetry-client`)
1. Scaffold `packages/telemetry-client` (package.json, tsconfig, AGENTS.md) following monorepo package conventions.
2. Implement `resolveTelemetryMode()` (enablement precedence) with unit tests covering all four precedence branches.
3. Implement local kv state (`installId` generation + persistence, `lastReportedAt`) via DI cache.

### Phase 2: Collector (aggregate, budgeted, fail-soft)
1. Implement `TelemetryCollector` reading counts via lightweight `em` `COUNT` queries for users/orgs/tenants/customers/salesOrders/catalogProducts, each with a short per-query timeout; failed/slow query → `null`.
2. Read `enabledModules` from the runtime module registry.
3. Read health from the local readiness probe (best-effort; `up`/`degraded`).
4. Assemble `TelemetryReport`. Unit tests assert no row/PII data and graceful `null` on count failure.

### Phase 3: Sender (100 ms fail-open beacon)
1. Implement `TelemetrySender` with `AbortController` total budget (`OM_TELEMETRY_TIMEOUT_MS`, default 100), TLS-only endpoint, fail-open on error/timeout/non-2xx.
2. Update local kv `lastStatus`/`lastReportedAt`. Unit tests: simulate slow endpoint (>100ms) → aborted + `failed`; non-2xx → `failed`; success → `sent`; all without throwing.

### Phase 4: Daily worker + wiring
1. Add `workers/telemetry-report.ts` (`metadata.queue = 'telemetry-report'`, idempotent, single-flight per day, reschedule with jitter per `OM_TELEMETRY_INTERVAL_HOURS`).
2. DI registration; enable package in `apps/mercato/src/modules.ts`. Run `yarn generate`.
3. Add all env vars to `apps/mercato/.env.example` (telemetry off by default) with comments.

### Phase 5: Tests, docs, disclosure
1. Integration test (host): worker run with a mock central endpoint — asserts payload is counts-only, license key present only in enterprise mode, and that a >100ms / erroring mock never fails the worker. Colocate under `packages/telemetry-client/src/.../__integration__/`.
2. Docs in `apps/docs`: what is collected, why, how to disable (`OM_TELEMETRY_DISABLED`), the 100 ms guarantee, and the dual OSS/enterprise modes. Transparency/disclosure page.
3. Central ingestion + admin module: tracked as a separate issue/PR in the separate commercial repo (contract per this spec).

### File Manifest (host monorepo only)
| File | Action | Purpose |
|------|--------|---------|
| `packages/telemetry-client/package.json` | Create | OSS package manifest |
| `packages/telemetry-client/AGENTS.md` | Create | Package agent guide |
| `packages/telemetry-client/src/lib/mode.ts` | Create | `resolveTelemetryMode()` enablement precedence |
| `packages/telemetry-client/src/lib/state.ts` | Create | Local kv (`installId`, `lastReportedAt`) |
| `packages/telemetry-client/src/lib/collector.ts` | Create | Aggregate, budgeted, fail-soft collection |
| `packages/telemetry-client/src/lib/sender.ts` | Create | 100 ms fail-open beacon |
| `packages/telemetry-client/src/lib/types.ts` | Create | `TelemetryReport` wire contract + zod schema |
| `packages/telemetry-client/src/modules/telemetry/workers/telemetry-report.ts` | Create | Daily worker |
| `packages/telemetry-client/src/modules/telemetry/di.ts` | Create | DI registration |
| `packages/telemetry-client/src/.../__integration__/telemetry-report.spec.ts` | Create | Fail-safe + counts-only integration coverage |
| `apps/mercato/src/modules.ts` | Modify | Enable telemetry package |
| `apps/mercato/.env.example` | Modify | Document env flags (off by default) |
| `apps/docs/**` | Modify | Disclosure + configuration docs |

### Integration Coverage (Required)
- Worker assembles a report containing only aggregate counts (no row data / PII) — asserted by schema + explicit field check.
- Enterprise mode (`OM_LICENSE_KEY` set) → `mode: 'enterprise'`, `licenseKey` present.
- OSS mode (`OM_ENABLE_TELEMETRY=true`, no key) → `mode: 'oss'`, `licenseKey: null`.
- Kill switch (`OM_TELEMETRY_DISABLED=true`) → no outbound call attempted.
- Mock central endpoint that sleeps >100 ms → send aborts, worker still completes successfully (no throw, no retry storm).
- Mock central endpoint returning `500` / unreachable → swallowed; `lastStatus: 'failed'`, worker succeeds.
- Count-query failure for one entity → that count is `null`, rest of report intact.

## Risks & Impact Review

### Data Integrity Failures
- Collection is read-only `COUNT` queries; no writes on the host, so no partial-write or transaction risk. A crash mid-collection just yields no report that cycle.

### Cascading Failures & Side Effects
- The only downstream is the central endpoint. The 100 ms abort + fail-open contract ensures a slow/broken central never blocks or retries into the host. No host module depends on telemetry output.

### Tenant & Data Isolation Risks
- Counts are **global per install** (cross-tenant aggregate totals), not per-tenant rows — no tenant data leaves the install. No row contents, names, emails, or free text are ever read. The collector is explicitly forbidden from selecting columns other than `COUNT(*)`.

### Migration & Deployment Risks
- Additive only; dormant unless explicitly enabled. No host migration. Zero-downtime.

### Operational Risks
- Telemetry failures are intentionally invisible to operators except in debug logs — acceptable because telemetry is non-critical by design. Storage growth is on the central side (separate repo concern).

### Risk Register

#### Central endpoint slow or down degrades host app
- **Scenario**: Central `/api/telemetry/report` hangs, errors, or responds slower than 100 ms.
- **Severity**: High (if mishandled) → reduced to Low by design.
- **Affected area**: host queue worker only.
- **Mitigation**: single `AbortController` total budget (default 100 ms); fail-open swallow of all errors/timeouts/non-2xx; worker never marks the job as a hard failure that would retry aggressively; collection isolated from request path.
- **Residual risk**: a single missing daily data point on the central dashboard — acceptable.

#### Accidental data leakage in payload
- **Scenario**: A future change adds a field that includes user data.
- **Severity**: Critical.
- **Affected area**: privacy / compliance.
- **Mitigation**: zod wire schema is counts-only; integration test asserts the payload shape and forbids non-count fields; collector restricted to `COUNT` queries + module registry + health; code-review gate on any payload change; disclosure docs enumerate every field.
- **Residual risk**: requires deliberate violation past tests + review.

#### Silent always-on collection (trust)
- **Scenario**: Operator unaware telemetry is enabled (enterprise default-on).
- **Severity**: Medium.
- **Affected area**: customer trust / compliance.
- **Mitigation**: documented disclosure page; `OM_TELEMETRY_DISABLED` hard kill switch; startup debug log line stating mode; `env.example` defaults off for OSS.
- **Residual risk**: enterprise default-on is intentional for billing verification and is disclosed in the license terms.

#### License key exposure
- **Scenario**: License key logged or sent insecurely.
- **Severity**: High.
- **Affected area**: licensing integrity.
- **Mitigation**: TLS-only endpoint; key never logged (truncated/hashed in any debug output); central stores only `license_key_hash`.
- **Residual risk**: depends on operator using an HTTPS `OM_TELEMETRY_ENDPOINT` — enforced by rejecting non-HTTPS endpoints in the sender.

## Final Compliance Report — 2026-06-04

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/core/AGENTS.md` (API routes, workers, openApi, modules)
- `packages/queue/AGENTS.md` (worker contract)
- `packages/cache/AGENTS.md` (DI-resolved kv state)
- `packages/shared/AGENTS.md` (boolean parsing, i18n)
- `packages/ui/AGENTS.md` (central admin DataTable — separate repo)
- `.ai/specs/AGENTS.md` / `.ai/specs/enterprise/README.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | Central entities use FK ids only; host has no entities |
| root AGENTS.md | Filter by organization_id | N/A (host) | Host reports global aggregate counts only, no per-tenant exposure |
| root AGENTS.md | No raw `fetch` in app/UI code | Compliant | Sender is infra-level outbound beacon (not UI); central admin UI uses `apiCall` |
| root AGENTS.md | Boolean parsing via `parseBooleanWithDefault` | Compliant | Env flag parsing uses shared boolean helper |
| packages/core/AGENTS.md | API routes MUST export `openApi` | Compliant | Central ingestion route exports `openApi` (separate repo) |
| packages/queue/AGENTS.md | Idempotent worker, use worker contract | Compliant | Daily idempotent, single-flight worker |
| root AGENTS.md | No hardcoded user-facing strings | Compliant | Client logs `[internal]`-prefixed; central UI uses `useT()` |
| BACKWARD_COMPATIBILITY.md | New contract surfaces additive/stable | Compliant | `TelemetryReport` fields nullable + additive-only going forward |
| .ai/ds-rules.md | No hardcoded status colors | Compliant | Central UI uses `StatusBadge` for health |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | `TelemetryReport` matches outbound + inbound + central entities |
| API contracts match UI/UX section | Pass | Admin DataTable columns map to `Installation` fields |
| Risks cover all write operations | Pass | Only writes are central-side; covered |
| Commands defined for all mutations | Pass | Host is read-only; central uses standard CRUD |
| Failure modes covered | Pass | 100 ms budget + fail-open enumerated and tested |

### Non-Compliant Items
None.

### Verdict
- **Fully compliant**: Approved — ready for implementation (host client in this monorepo; central admin tracked in its separate commercial repo per the defined contract).

## Changelog
### 2026-06-04
- Initial specification.
