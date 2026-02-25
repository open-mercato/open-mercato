# ANALYSIS-002 — OroCRM Integration Feasibility

| Field | Value |
|-------|-------|
| **Date** | 2026-02-24 |
| **Author** | AI Analysis |
| **Related Specs** | SPEC-045 (Integration Marketplace), SPEC-045a (Foundation), SPEC-045b (Data Sync Hub) |
| **Subject** | OroCRM (open-source, Oro Inc.) |

---

## Executive Summary

OroCRM integration with Open Mercato is **feasible but comes with significant constraints**. The Open Mercato integration framework (SPEC-045 / SPEC-045b) provides all the primitives needed — DataSyncAdapter, delta streaming, field mapping, OAuth 2.0 credentials, bidirectional ID mapping — but OroCRM's API design introduces friction in several areas: no native outgoing webhooks (polling-only delta detection), restrictive rate limits (~100 req/min), JSON:API-specific query syntax, and a complex entity model with overlapping customer concepts. A realistic integration covers **~70-75% of OroCRM's functionality** with reasonable effort; the remaining 25-30% requires workarounds or is impractical.

**Verdict**: Build as an integration bundle (`@open-mercato/sync-orocrm`) with 4-5 entity sync adapters. Expect the initial implementation to take 2-3x longer than the MedusaJS reference bundle due to OroCRM's API complexity.

---

## 1. Entity Mapping Analysis

### 1.1 Direct Mappings (High Confidence)

These entities have clear 1:1 or near-1:1 counterparts between the two systems.

| OroCRM Entity | Open Mercato Entity | Sync Direction | Complexity | Notes |
|---------------|---------------------|----------------|------------|-------|
| **Contacts** | `CustomerEntity` (kind=person) + `CustomerPersonProfile` | Bidirectional | Medium | OroCRM contact has name, email, phone, addresses, birthday. Maps well to person profile. OroCRM's `Contact.accounts` (M2M) maps to `CustomerPersonProfile.companyEntityId` (single FK) — **data loss risk on multi-account contacts**. |
| **Accounts** | `CustomerEntity` (kind=company) + `CustomerCompanyProfile` | Bidirectional | Medium | OroCRM Account aggregates data from Contacts and B2B Customers. Maps to company profile. Fields like `industry`, `employees` (sizeBucket), `website` align. OroCRM's multi-channel aggregation has no Mercato equivalent. |
| **Leads** | `CustomerEntity` (kind=person) + lifecycle stage | Import | Medium | OroCRM Leads are pre-qualification contacts. Map to CustomerEntity with `lifecycleStage = 'lead'`. On conversion to Opportunity, update lifecycle stage. |
| **Opportunities** | `CustomerDeal` | Bidirectional | High | OroCRM Opportunity has pipeline stages, probability, budget, close date — maps well to CustomerDeal. Key differences: OroCRM ties Opportunity to Account + B2B Customer; Mercato ties Deal to multiple people/companies via link tables. |
| **Tasks** | `CustomerActivity` (activityType=task) | Bidirectional | Low | Simple entity mapping. OroCRM Task has subject, description, due date, priority, assignee. |
| **Notes** | `CustomerComment` | Import | Low | OroCRM Notes are text-only. Map to CustomerComment with `body`. |
| **Calls** | `CustomerActivity` (activityType=call) | Import | Low | OroCRM logged calls → Mercato activities. |

### 1.2 Partial Mappings (Medium Confidence)

| OroCRM Entity | Open Mercato Entity | Direction | Complexity | Gap Description |
|---------------|---------------------|-----------|------------|-----------------|
| **Cases** (support tickets) | No direct equivalent | Import only | High | Mercato has no support/ticketing module. Could map to CustomerActivity with `activityType = 'case'` but loses structured fields (priority, resolution, SLA). Would require custom fields or a new module. |
| **Emails** (tracked) | `CustomerActivity` (activityType=email) | Import | Medium | OroCRM tracks full email threads with participants, attachments, threading. Mercato activity is a flat record — thread context and attachments are lost. |
| **Calendar Events** | No direct equivalent | Import only | Medium | Mercato has `PlannerAvailabilityRule` but it's a scheduling system, not a calendar. Calendar events would need custom fields or a new module. |
| **Marketing Lists** | No equivalent | Not feasible | N/A | Mercato has no marketing automation module. |
| **Campaigns** | No equivalent | Not feasible | N/A | Same — no marketing module. |
| **Products** (OroCommerce) | `CatalogProduct` / `CatalogProductVariant` | Bidirectional | High | Only relevant if tenant runs OroCommerce (superset of OroCRM). Product models differ significantly — Oro uses configurable products with variant-level attributes while Mercato uses option schemas. Pricing models are very different (Oro has price lists + customer-specific pricing; Mercato has offers + price kinds). |
| **Orders** (OroCommerce) | `SalesOrder` | Import | Very High | Only for OroCommerce. Order structures differ substantially — Oro's order has subtotals computed via price lists and shipping rules; Mercato uses adjustment-based pricing. Line item mapping requires significant transform logic. |

### 1.3 No Mapping (OroCRM entities with no Mercato equivalent)

| OroCRM Entity | Reason | Recommendation |
|---------------|--------|----------------|
| **Marketing Lists** | No marketing module in Mercato | Out of scope; document as limitation |
| **Email Campaigns** | No marketing module | Out of scope |
| **Channels** (OroCRM data source scoping) | Mercato uses `SalesChannel` differently — it's a commerce concept, not a CRM data-source aggregation | Ignore; use as metadata only |
| **B2B Customers** (OroCommerce) | Overlaps with Accounts; Mercato unifies under CustomerEntity | Merge into company mapping with source annotation |
| **Customer Users** (OroCommerce storefront users) | Mercato auth module has its own User entity | Map to Mercato User only if auth sync is desired (risky) |
| **Shopping Lists / Carts** (OroCommerce) | No equivalent | Out of scope |
| **RFQs / Quotes** (OroCommerce) | `SalesQuote` exists but Oro's RFQ flow is more complex | Partial — map completed quotes only |

---

## 2. Technical Compatibility

### 2.1 Authentication

| Aspect | OroCRM | Open Mercato Framework | Compatible? |
|--------|--------|----------------------|-------------|
| Protocol | OAuth 2.0 | OAuth 2.0 credential type (SPEC-045a §8) | Yes |
| Grant types | Authorization Code (+ PKCE), Client Credentials, Password | Authorization Code + PKCE, Client Credentials | Yes |
| Token lifetime | 1 hour default | Background refresh worker handles renewal | Yes |
| Token storage | N/A (consumer) | Encrypted per-tenant (`IntegrationCredentials`) | Yes |

**Assessment**: Full compatibility. The `oauth` credential type in SPEC-045a supports Authorization Code + PKCE and Client Credentials grants. Background token refresh handles the 1-hour expiry. Client Credentials grant is the best fit for server-to-server sync.

### 2.2 API Protocol

| Aspect | OroCRM | Open Mercato DataSync | Impact |
|--------|--------|----------------------|--------|
| Protocol | REST (JSON:API spec) | Generic REST (adapter handles serialization) | Medium — adapter must parse JSON:API envelope |
| Response format | JSON:API (`{ data: { type, id, attributes, relationships }, included: [...] }`) | Adapter normalizes to flat `Record<string, unknown>` | Adapter complexity: must flatten JSON:API structure |
| Pagination | JSON:API `page[number]` + `page[size]` | Cursor-based (DataSyncAdapter uses string cursors) | **Mismatch** — OroCRM uses offset pagination, not cursors. Adapter must synthesize cursors from page numbers. |
| Filtering | JSON:API `filter[field]=value` | N/A (adapter-internal) | Fine — adapter constructs filters internally |
| Sorting | JSON:API `sort=field,-field` | N/A | Fine |
| Includes (eager-load) | `?include=contacts,owner` | N/A | Fine — useful for reducing API calls |
| Batch operations | Batch API endpoint | Not needed for sync (adapter handles batching) | Optional optimization |

**Key Challenge**: OroCRM uses **offset-based pagination** (`page[number]`), not cursor-based. The DataSyncAdapter contract expects string cursors for resumability. The adapter must encode page numbers as cursors (e.g., `cursor = JSON.stringify({ page: 5, updatedAfter: '2026-01-01T00:00:00Z' })`). This works but makes delta detection more complex — you can't simply resume from a cursor if records shift between pages during a long sync.

### 2.3 Delta Detection (Change Tracking)

| Method | OroCRM Support | Feasibility |
|--------|---------------|-------------|
| `updated_at` filtering | Yes — `filter[updatedAt][gt]=2026-01-01` | **Primary strategy**. Filter by last sync timestamp. |
| Webhooks (push) | **No** — no native outgoing webhooks | Not available. Must poll. |
| Event streaming | **No** — no WebSocket/SSE | Not available. |
| Batch delta API | **No** — no dedicated "what changed since X" endpoint | Not available. |
| ETag / If-Modified-Since | Not documented | Unlikely. |

**Assessment**: Delta detection is **polling-only** via `updatedAt` filtering. This is the biggest technical constraint. The adapter must:
1. Store the last sync timestamp as the cursor
2. Query OroCRM with `filter[updatedAt][gt]={cursor}`
3. Page through all results
4. Handle records modified during sync (potential duplicates — idempotency via `externalId` mapping handles this)

This means **no real-time sync**. Minimum practical polling interval: 5-15 minutes (given rate limits).

### 2.4 Rate Limits

| Metric | OroCRM | Impact |
|--------|--------|--------|
| Rate limit | ~100 requests/minute/user | **Severe constraint for large datasets** |
| Batch API | Available (multiple ops per request) | Helps for writes; reads still limited |
| Concurrent connections | Not documented (likely 5-10) | Must serialize requests |

**Impact Analysis**:

| Scenario | Records | API Calls Needed | Time @ 100 req/min |
|----------|---------|-----------------|---------------------|
| Initial full sync: 10K contacts | 10,000 | ~100 (100/page) + includes | ~1 minute |
| Initial full sync: 100K contacts | 100,000 | ~1,000 | ~10 minutes |
| Initial full sync: 1M contacts | 1,000,000 | ~10,000 | ~100 minutes |
| Delta sync: 500 changed contacts | 500 | ~5 | ~3 seconds |
| Full sync: contacts + accounts + opportunities | 50K total | ~500+ | ~5+ minutes |

The rate limiter in `data_sync/lib/rate-limiter.ts` (token-bucket) handles throttling. For initial full syncs of large OroCRM instances (100K+ records), expect multi-hour sync windows.

### 2.5 Data Write-Back (Export to OroCRM)

| Operation | OroCRM API Support | Complexity |
|-----------|--------------------|------------|
| Create Contact | `POST /api/contacts` | Low — standard JSON:API create |
| Update Contact | `PATCH /api/contacts/{id}` | Low — JSON:API partial update |
| Create Account | `POST /api/accounts` | Low |
| Create Opportunity | `POST /api/opportunities` | Medium — requires related Account |
| Create/Update relationships | `POST/PATCH /api/{entity}/{id}/relationships/{rel}` | Medium — JSON:API relationship protocol |
| Delete | `DELETE /api/{entity}/{id}` | Low — but dangerous; should be opt-in |
| Upsert | Batch API with upsert flag | Medium — useful for sync |
| Custom fields | Include in attributes if API-exposed | Medium — must be pre-configured in OroCRM |

**Assessment**: Write-back is supported but requires constructing JSON:API-compliant request bodies (not just flat JSON). The adapter's `streamExport` must transform Mercato entities into JSON:API format with proper `type`, `attributes`, and `relationships` structure.

---

## 3. What Works Well (Low Risk)

| Capability | Why It Works |
|------------|-------------|
| **Contact/Account sync** | Clear entity mapping, standard CRUD fields, both systems have similar concepts |
| **OAuth 2.0 authentication** | Full compatibility with SPEC-045a credential types |
| **Credential management** | Encrypted per-tenant storage with background refresh handles OroCRM's token lifecycle |
| **Field mapping UI** | `SyncMapping` entity + admin UI supports customizable field-to-field mapping |
| **Operation logging** | `IntegrationLog` captures all API interactions for debugging |
| **Scheduled sync** | Scheduler integration (SPEC-045b §6.1) handles periodic polling since OroCRM lacks webhooks |
| **ID mapping** | `SyncExternalIdMapping` handles local-to-OroCRM ID resolution for bidirectional sync |
| **Error resilience** | Item-level error logging + cursor-based resume handles partial failures gracefully |

---

## 4. What's Difficult (High Risk / High Effort)

### 4.1 No Webhook Support — Polling Only

**Problem**: OroCRM has no outgoing webhook system. The only way to detect changes is polling via `updatedAt` filters.

**Impact**:
- No real-time sync capability
- Minimum 5-15 minute sync delay (bounded by rate limits)
- Polling wastes API calls when nothing has changed
- Deleted records are invisible — `updatedAt` filtering only catches creates/updates

**Workaround**:
- Use scheduled sync (cron every 5-15 minutes) via the scheduler widget
- For deletions: periodic full reconciliation job (compare all IDs, mark missing as deleted)
- Rate-limit-aware polling intervals
- Consider OroCRM message queue consumers if self-hosted (requires PHP-side development)

**Effort**: High. The reconciliation logic for deletions alone is a significant piece of work.

### 4.2 JSON:API Protocol Overhead

**Problem**: OroCRM uses the JSON:API specification, which wraps all data in `{ data: { type, id, attributes, relationships }, included: [...] }` envelopes. This is not a simple REST API.

**Impact**:
- Adapter must parse JSON:API responses into flat records for the `ImportItem.data` format
- Adapter must construct JSON:API request bodies for exports (not just flat JSON)
- Relationship handling requires separate API calls or `?include=` parameters
- Error responses follow JSON:API error format

**Effort**: Medium. Requires a JSON:API client library or a custom serializer/deserializer. Recommend using an existing library like `kitsu` or `devour-client`.

### 4.3 Offset Pagination vs. Cursor-Based Sync

**Problem**: OroCRM uses offset-based pagination (`page[number]`). The DataSyncAdapter contract is designed for cursor-based streaming.

**Impact**:
- Must synthesize cursors from `{ page, updatedAfter }` tuples
- During long syncs, records may shift between pages (new records inserted, causing duplicates or gaps)
- No guarantee of consistency across pages for large result sets

**Workaround**:
- Encode composite cursor: `JSON.stringify({ page: N, since: 'ISO-timestamp' })`
- Use `sort=updatedAt` to stabilize page order
- Rely on idempotent upsert (via `SyncExternalIdMapping`) to handle duplicates
- After initial sync, delta syncs are small enough that pagination drift is negligible

**Effort**: Medium.

### 4.4 Rate Limits Constraining Initial Sync

**Problem**: ~100 requests/minute means a 100K-record initial sync takes ~100 minutes of API time.

**Impact**:
- First-time sync of large OroCRM instances will take hours
- Progress bar and ETA calculations must account for throttling waits
- Sync window may span overnight for very large datasets

**Workaround**:
- Use `?include=` to reduce total API calls (fetch contacts with accounts in one call)
- Use the Batch API where possible
- Token-bucket rate limiter (`rate-limiter.ts`) with configurable rate
- Allow admin to configure rate limits per integration (some self-hosted instances may have higher limits)
- Run initial sync during off-peak hours via scheduler

**Effort**: Low (infrastructure exists), but UX challenge for admin expectations.

### 4.5 Complex Customer Model Mapping

**Problem**: OroCRM has 5 customer-like entities (Account, Contact, B2B Customer, Customer, Customer User). Open Mercato has a unified `CustomerEntity` with `kind` (person/company) + profiles.

**Impact**:
- Must decide which OroCRM entity maps to which Mercato entity type
- OroCRM Contact can belong to **multiple Accounts** (M2M). Mercato person has a single `companyEntityId` (one company). **Data loss on multi-account contacts**.
- OroCRM Account aggregates data from multiple channels. Mercato company profile is a single record.
- B2B Customer vs. Account distinction may confuse mapping configuration

**Recommended Mapping**:
```
OroCRM Contact    → CustomerEntity (kind=person) + CustomerPersonProfile
OroCRM Account    → CustomerEntity (kind=company) + CustomerCompanyProfile
OroCRM Lead       → CustomerEntity (kind=person, lifecycleStage='lead')
OroCRM B2B Cust   → CustomerEntity (kind=company) [merged with Account if same]
```

**Multi-account resolution**: Use the "primary" account from OroCRM. Store secondary account references in custom fields or activity log.

**Effort**: High (mapping logic + conflict resolution).

### 4.6 Activity Association Model Differences

**Problem**: OroCRM's activity system (calls, tasks, emails, notes, calendar events) uses **cross-cutting associations** — any activity can be linked to any entity type via a dynamic association mechanism. Mercato's `CustomerActivity` is scoped to a single `entityId` (customer) + optional `dealId`.

**Impact**:
- OroCRM activity linked to both a Contact AND an Opportunity: Mercato can store `entityId` (contact) + `dealId` (opportunity) — works for this specific case
- OroCRM activity linked to an Account (company): maps to `entityId` of the company customer
- OroCRM activity linked to a Case: no direct mapping — Cases don't exist in Mercato
- OroCRM activity linked to a Lead: maps to `entityId` of the lead-person
- Multi-entity associations: OroCRM activity linked to 3 contacts — Mercato activity has one `entityId` — **data loss**

**Effort**: Medium (single-association mapping works for most cases; edge cases lose context).

---

## 5. What's Missing (Not Feasible Without New Modules)

| OroCRM Feature | Status in Mercato | Effort to Add | Recommendation |
|----------------|-------------------|---------------|----------------|
| **Support Cases / Tickets** | No module | High (new module) | Out of scope for initial integration. Document as limitation. Consider mapping to activities with extended metadata. |
| **Marketing Lists** | No module | Very High | Out of scope. OroCRM marketing is tightly coupled to its own list engine. |
| **Email Campaigns** | No module | Very High | Out of scope. Requires marketing module + email provider integration. |
| **Calendar Events** | No calendar module | Medium (extend planner or new module) | Import as activities with `activityType='calendar_event'`. Lose recurrence rules and attendee management. |
| **Sales Processes** (workflow-driven) | Workflows module exists | Medium | Could map OroCRM sales process states to Mercato workflow instances. Requires custom workflow definition matching OroCRM's B2B sales flow. Not automatic. |
| **Channel-scoped aggregation** | SalesChannel is commerce-only | Low impact | Not needed — Mercato doesn't aggregate CRM data by channel. Ignore. |
| **Zendesk integration** (via OroCRM) | No Zendesk module | N/A | OroCRM's Zendesk sync is internal to OroCRM. Not relevant for Mercato integration. |
| **Mailchimp integration** (via OroCRM) | No Mailchimp module | N/A | Same — internal to OroCRM. |
| **Custom entity types** (user-created via OroCRM admin) | Mercato has custom fields but not custom entities | Medium | Can sync custom field values if the target Mercato entity exists. Cannot auto-create new entity types. Must pre-map. |

---

## 6. Bidirectional Sync Challenges

### 6.1 Conflict Resolution

| Scenario | Challenge | Recommended Strategy |
|----------|-----------|---------------------|
| Same contact updated in both systems between syncs | Which version wins? | **Last-write-wins** with configurable "source of truth" per entity type. Admin chooses: OroCRM-primary or Mercato-primary. |
| Contact created in both systems with same email | Duplicate detection | Match by email (`matchStrategy: 'email'`). If matched, merge. If not, create. |
| Deal/Opportunity value changed in both | Financial data conflict | **Source-of-truth wins**. No merge — one system is authoritative for deal values. |
| Record deleted in OroCRM, updated in Mercato | Deletion vs. update conflict | Deletion wins only if OroCRM is source of truth. Otherwise, flag for manual review. |

### 6.2 Deletion Propagation

OroCRM's API does not expose deleted records (no `deletedAt` filter, no trash endpoint). Detecting deletions requires:
1. Full ID reconciliation: fetch all IDs from OroCRM, compare with `SyncExternalIdMapping`, mark missing as deleted
2. This is expensive (requires listing all entity IDs periodically)
3. Recommend: run reconciliation weekly, not on every sync cycle

### 6.3 Recommended Sync Topology

```
                    OroCRM (Source of Truth for CRM)
                         │
                    ┌─────┴─────┐
                    │  Import   │  (scheduled every 5-15 min)
                    │  Adapter  │
                    └─────┬─────┘
                          │
                    Open Mercato
                          │
                    ┌─────┴─────┐
                    │  Export   │  (on-demand or scheduled)
                    │  Adapter  │
                    └─────┬─────┘
                          │
                    OroCRM (receives updates)
```

**Recommendation**: Start with **import-only** (OroCRM → Mercato). Add export (Mercato → OroCRM) as Phase 2 after import is proven stable.

---

## 7. Proposed Integration Bundle Structure

```
packages/integrations/sync_orocrm/
├── integration.ts              # Bundle definition (category: 'data_sync', hub: 'data_sync')
├── index.ts
├── di.ts                       # Register adapters
├── lib/
│   ├── orocrm-client.ts        # JSON:API HTTP client with rate limiting
│   ├── json-api-parser.ts      # JSON:API → flat record normalizer
│   ├── json-api-serializer.ts  # Flat record → JSON:API request body
│   ├── adapters/
│   │   ├── contacts.ts         # DataSyncAdapter for contacts ↔ CustomerEntity(person)
│   │   ├── accounts.ts         # DataSyncAdapter for accounts ↔ CustomerEntity(company)
│   │   ├── opportunities.ts    # DataSyncAdapter for opportunities ↔ CustomerDeal
│   │   ├── leads.ts            # DataSyncAdapter for leads ↔ CustomerEntity(person, lead)
│   │   └── activities.ts       # DataSyncAdapter for tasks+calls+notes → CustomerActivity
│   ├── transforms/
│   │   ├── contact-transform.ts
│   │   ├── account-transform.ts
│   │   └── opportunity-transform.ts
│   └── reconciliation.ts       # Full-ID reconciliation for deletion detection
├── data/
│   └── validators.ts
├── backend/
│   └── orocrm/
│       └── page.tsx            # OroCRM-specific config page
├── widgets/
│   └── injection/
│       └── config/
│           └── widget.client.tsx  # Connection test + entity selection UI
└── i18n/
    ├── en.ts
    └── pl.ts
```

### 7.1 Adapter Count & Priority

| # | Adapter | Entity Type | Priority | Direction |
|---|---------|-------------|----------|-----------|
| 1 | Contacts | `customers.person` | P0 | Bidirectional |
| 2 | Accounts | `customers.company` | P0 | Bidirectional |
| 3 | Opportunities | `customers.deal` | P1 | Bidirectional |
| 4 | Leads | `customers.person` (lifecycle=lead) | P1 | Import |
| 5 | Activities | `customers.activity` | P2 | Import |

---

## 8. Effort Estimation

| Component | Effort | Notes |
|-----------|--------|-------|
| JSON:API client + parser/serializer | 3-5 days | Core infrastructure; consider existing libraries |
| OAuth 2.0 credential setup | 1 day | Framework handles most of it (SPEC-045a) |
| Contact adapter (import + export) | 3-4 days | Including address sync, multi-account resolution |
| Account adapter (import + export) | 2-3 days | Simpler entity mapping |
| Opportunity adapter (import + export) | 3-4 days | Complex relationships (account + contact links) |
| Lead adapter (import only) | 1-2 days | Subset of contact adapter |
| Activities adapter (import only) | 2-3 days | Multiple activity types, association mapping |
| Deletion reconciliation worker | 2-3 days | Full-ID comparison + deletion propagation |
| Admin UI (config, mapping review) | 2-3 days | Widget injection + mapping customization |
| Integration tests | 3-5 days | Mock OroCRM API responses, E2E sync flows |
| **Total** | **22-32 days** | ~5-7 developer weeks |

---

## 9. Risk Matrix

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Rate limit blocks initial sync of large instances | High | Medium | Configurable rate, off-peak scheduling, batch API |
| Multi-account contacts lose data | Medium | Medium | Store secondary accounts in custom fields; document limitation |
| Deleted records not detected promptly | High | Low | Weekly reconciliation job; document delay |
| OroCRM API version breaks adapter | Medium | High | API versioning in integration.ts; pin to tested version |
| JSON:API parsing edge cases | Medium | Medium | Comprehensive test suite against OroCRM sandbox |
| Bidirectional conflict corruption | Low | High | Start import-only; add export after validation |
| OroCRM custom fields not synced | Medium | Low | Document: custom fields require manual mapping configuration |
| Performance degradation on large syncs | Medium | Medium | Streaming architecture handles this; rate limiter prevents overload |

---

## 10. Recommendations

### Do First (MVP)
1. **Import-only bundle** with contacts + accounts + opportunities adapters
2. **Client Credentials** OAuth flow (simplest server-to-server auth)
3. **Scheduled sync** every 15 minutes (safe for rate limits)
4. **Admin UI** for connection setup + entity selection + mapping review

### Do Later (Phase 2)
5. **Bidirectional sync** for contacts and accounts (with source-of-truth config)
6. **Lead and activity import** adapters
7. **Deletion reconciliation** worker (weekly schedule)
8. **Export adapter** for deals → opportunities

### Don't Do
9. **Marketing features** — no Mercato equivalent; not worth building
10. **Calendar sync** — better served by Google/Microsoft calendar integrations directly
11. **Auth/user sync** — too risky; SCIM/SSO is a separate concern (SPEC-ENT-004)
12. **OroCommerce product/order sync** — fundamentally different data models; build as separate bundle if needed

---

## 11. Comparison with Other CRM Integrations

| Factor | OroCRM | HubSpot (hypothetical) | Salesforce (hypothetical) |
|--------|--------|----------------------|--------------------------|
| API style | JSON:API (verbose) | REST (simple JSON) | REST + SOQL |
| Webhooks | None | Yes (subscriptions) | Yes (outbound messages) |
| Rate limits | ~100/min (restrictive) | 100/10s private apps | 100K/day (generous) |
| Delta detection | Polling only | Webhooks + search API | CDC (Change Data Capture) |
| Auth | OAuth 2.0 | OAuth 2.0 + API key | OAuth 2.0 |
| Entity complexity | High (5 customer types) | Medium (3 object types) | High (highly customizable) |
| Integration effort | 5-7 weeks | 3-4 weeks | 4-6 weeks |
| Documentation | Adequate | Excellent | Excellent |
| Community | Small | Large | Very large |

OroCRM integration is harder than a typical SaaS CRM due to the lack of webhooks and restrictive rate limits. The open-source/self-hosted nature means instances vary in configuration, making it harder to guarantee adapter compatibility across all deployments.

---

## 12. Conclusion

OroCRM integration is **achievable** with the Open Mercato integration framework. The DataSyncAdapter contract, OAuth 2.0 credentials, field mapping, and scheduled sync infrastructure cover all the essential requirements. The main challenges are:

1. **No webhooks** → polling-only, 5-15 minute sync delay minimum
2. **Rate limits** → large initial syncs take hours
3. **JSON:API overhead** → adapter needs custom serialization layer
4. **Complex customer model** → multi-account contacts lose data in mapping
5. **No marketing module** → 25-30% of OroCRM features have no Mercato target

**Start with import-only, 3 core entity adapters, and grow from there.** The infrastructure is sound; the complexity is in OroCRM's API surface, not in the framework.
