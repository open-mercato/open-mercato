# ANALYSIS-008 — HubSpot CRM Integration Feasibility

| Field | Value |
|-------|-------|
| **Related Spec** | SPEC-045 (Integration Marketplace), SPEC-045b (Data Sync Hub) |
| **Provider** | HubSpot CRM |
| **Date** | 2026-02-24 |
| **Verdict** | HIGH feasibility (~80-85% coverage). Strong bidirectional sync for core CRM objects (Contacts, Companies, Deals, Activities). Well-matched adapter contract. Main gaps: no Tickets module in OM, HubSpot search hard cap at 10K results, and pipeline/stage model differences. OAuth 2.0 already spec'd. |

---

## Executive Summary

HubSpot CRM is a dominant CRM platform with a mature, well-documented REST API (v3/v4). Open Mercato's customers module is architecturally similar to HubSpot's CRM object model — both have polymorphic person/company entities, deals with multi-party relationships, extensible activities, and custom fields. The SPEC-045 Integration Marketplace and SPEC-045b Data Sync Hub provide a strong foundation for building a HubSpot integration as an `@open-mercato/sync-hubspot` **bundle module** delivering multiple `data_sync` integrations (contacts, companies, deals, activities, products).

The integration would be implemented as the **first CRM data sync provider**, establishing patterns for future CRM connectors (Salesforce, Pipedrive, etc.).

### Key Strengths
- HubSpot's unified object API (`/crm/v3/objects/{type}`) maps cleanly to the `DataSyncAdapter` contract
- OAuth 2.0 is already spec'd in SPEC-045a §8; HubSpot uses standard authorization code flow
- Delta sync via `hs_lastmodifieddate` filter works with the cursor-based streaming model
- Webhook support covers all core events (creation, property change, deletion, merge)
- Batch APIs (100 records/request) align with the `batchSize` concept in `StreamImportInput`

### Key Challenges
- HubSpot search API hard cap of **10,000 results** requires the CRM Exports API for initial full sync
- HubSpot's deal pipeline/stage model differs from OM's `CustomerDeal.pipelineStage` (string vs structured pipeline object)
- No Tickets module in OM means HubSpot Tickets sync is out of scope without a new module
- HubSpot's association labels (v4) add relational semantics not present in OM's junction tables
- Rate limits (5 req/sec for search, 100-190 req/10sec general) require careful throttling

---

## 2. Entity Mapping — Detailed Analysis

### 2.1 Contacts ↔ CustomerEntity (person)

| HubSpot Field | OM Field | Mapping | Notes |
|---------------|----------|---------|-------|
| `firstname` | `CustomerPersonProfile.firstName` | Direct | |
| `lastname` | `CustomerPersonProfile.lastName` | Direct | |
| `email` | `CustomerEntity.primaryEmail` | Direct | HubSpot uses email as unique identifier |
| `phone` | `CustomerEntity.primaryPhone` | Direct | |
| `jobtitle` | `CustomerPersonProfile.jobTitle` | Direct | |
| `company` | Association to Company | Structural | HubSpot uses association; OM uses `CustomerPersonProfile.company` FK |
| `lifecyclestage` | `CustomerEntity.lifecycleStage` | Transform | HubSpot has fixed lifecycle stages; OM uses dictionary entries |
| `hs_lead_status` | `CustomerEntity.status` | Transform | Needs mapping table |
| `address`, `city`, `state`, `zip`, `country` | `CustomerAddress` | Structural | HubSpot has flat address; OM has multi-address with purpose |
| `createdate` | `CustomerEntity.createdAt` | Direct | |
| `hs_lastmodifieddate` | `CustomerEntity.updatedAt` | Direct (cursor source) | |
| `hubspot_owner_id` | `CustomerEntity.ownerUserId` | Transform | Requires owner↔user ID mapping |
| Custom properties | Custom fields (via `ce.ts`) | Dynamic | Both support extensible fields |

**Feasibility: HIGH** — Core fields map 1:1. Address structure difference is manageable (import primary address, export billing address). Lifecycle stage requires a configurable mapping table. Custom properties map to OM's custom field system.

**Gap: Multi-address** — HubSpot stores a single flat address per contact. OM supports multiple addresses with purpose (billing/shipping). On import, HubSpot address becomes the primary address. On export, only the primary address syncs back.

### 2.2 Companies ↔ CustomerEntity (company)

| HubSpot Field | OM Field | Mapping | Notes |
|---------------|----------|---------|-------|
| `name` | `CustomerEntity.displayName` | Direct | |
| `domain` | `CustomerCompanyProfile.domain` | Direct | HubSpot uses domain as dedup key |
| `industry` | `CustomerCompanyProfile.industry` | Direct | |
| `numberofemployees` | `CustomerCompanyProfile.sizeBucket` | Transform | Numeric → bucket mapping |
| `annualrevenue` | `CustomerCompanyProfile.annualRevenue` | Direct | |
| `phone` | `CustomerEntity.primaryPhone` | Direct | |
| `website` | `CustomerCompanyProfile.websiteUrl` | Direct | |
| `description` | `CustomerEntity.description` | Direct | |
| `hubspot_owner_id` | `CustomerEntity.ownerUserId` | Transform | |
| `lifecyclestage` | `CustomerEntity.lifecycleStage` | Transform | |
| Address fields | `CustomerAddress` | Structural | Same gap as contacts |

**Feasibility: HIGH** — Almost identical data models. The `domain` field as a dedup key aligns well with `matchStrategy: 'custom'` using domain matching.

### 2.3 Deals ↔ CustomerDeal

| HubSpot Field | OM Field | Mapping | Notes |
|---------------|----------|---------|-------|
| `dealname` | `CustomerDeal.title` | Direct | |
| `description` | `CustomerDeal.description` | Direct | |
| `amount` | `CustomerDeal.valueAmount` | Direct | |
| `dealstage` | `CustomerDeal.pipelineStage` | Transform | HubSpot uses stage ID; OM uses string |
| `pipeline` | — | Gap | OM has no multi-pipeline concept on deals |
| `closedate` | `CustomerDeal.expectedCloseAt` | Direct | |
| `hs_deal_stage_probability` | `CustomerDeal.probability` | Direct | |
| `hubspot_owner_id` | `CustomerDeal.ownerUserId` | Transform | |
| `deal_currency_code` | `CustomerDeal.valueCurrency` | Direct | |
| Associated contacts | `CustomerDealPersonLink` | Structural | HubSpot uses associations; OM uses junction table with `participantRole` |
| Associated companies | `CustomerDealCompanyLink` | Structural | Similar pattern |

**Feasibility: MEDIUM-HIGH** — Core deal data maps well. Two significant gaps:

**Gap: Multi-pipeline** — HubSpot supports multiple deal pipelines (e.g., "Sales Pipeline", "Enterprise Pipeline"). OM's `CustomerDeal.pipelineStage` is a flat string. Options:
1. **Concatenate**: Store as `"pipelineName:stageLabel"` in `pipelineStage` — simple but loses structure
2. **Custom field**: Store pipeline ID as a custom field, stage as `pipelineStage`
3. **Future enhancement**: Add a `pipeline` field to `CustomerDeal` (recommended for long-term CRM integrations)

**Gap: Association labels** — HubSpot's v4 associations support labeled relationships (e.g., "Decision Maker", "Budget Holder"). OM's `CustomerDealPersonLink.participantRole` partially covers this but is a single string field vs HubSpot's multi-label system.

### 2.4 Activities ↔ CustomerActivity

| HubSpot Type | OM ActivityType | Mapping | Notes |
|--------------|----------------|---------|-------|
| Calls | `'call'` | Direct | Map `hs_call_body` → `body`, `hs_call_title` → `subject` |
| Emails | `'email'` | Direct | Map `hs_email_subject` → `subject`, `hs_email_text` → `body` |
| Meetings | `'meeting'` | Direct | Map `hs_meeting_title` → `subject`, `hs_meeting_body` → `body` |
| Notes | — | Separate | Map to `CustomerComment` instead (better fit) |
| Tasks | — | Structural | Map to `CustomerTodoLink` (cross-module link) |

**Feasibility: MEDIUM-HIGH** — Activity types map well because `CustomerActivity.activityType` is extensible (free text). The adapter can register HubSpot-specific types. Notes map better to `CustomerComment`. Tasks map to `CustomerTodoLink` but require an external task system or a new task entity.

**Gap: Task management** — HubSpot Tasks have `hs_task_status` (NOT_STARTED, IN_PROGRESS, COMPLETED, DEFERRED), priority, due date, and reminders. OM's `CustomerTodoLink` is just a reference link — it doesn't store task state. Options:
1. **Import-only**: Import HubSpot tasks as read-only activities with status in metadata
2. **TodoLink**: Store the HubSpot task ID in `CustomerTodoLink` and deep-link back to HubSpot
3. **Future enhancement**: Build a lightweight task entity in the customers module

### 2.5 Products ↔ CatalogProduct

| HubSpot Field | OM Field | Mapping | Notes |
|---------------|----------|---------|-------|
| `name` | `CatalogProduct.title` | Direct | |
| `description` | `CatalogProduct.description` | Direct | |
| `price` | `CatalogProductPrice.unitPriceNet` | Structural | HubSpot has single price; OM has multi-tier pricing |
| `hs_sku` | `CatalogProduct.sku` | Direct | |
| `hs_url` | — | Custom field | No direct OM equivalent |
| `hs_cost_of_goods_sold` | — | Custom field | No direct OM equivalent |
| `tax` | `CatalogProduct.taxRate` | Direct | |
| Custom properties | Custom fields | Dynamic | |

**Feasibility: MEDIUM** — Basic product sync is straightforward. Significant model differences:
- HubSpot products are flat (no variants, no categories, no offers)
- OM products have variants, multi-tier pricing, channel-scoped offers, categories
- On import: HubSpot product → OM simple product with one variant and one price
- On export: OM product → HubSpot product using default variant's default price

**Gap: Line Items** — HubSpot Line Items link products to deals with quantity/price overrides. OM handles this via `SalesOrderLine`. Syncing deal-level line items requires bridging the deals↔sales modules which adds complexity.

### 2.6 Unmappable HubSpot Objects

| HubSpot Object | OM Equivalent | Status |
|----------------|---------------|--------|
| **Tickets** | None | No tickets/issues module in OM. Would require a new module. |
| **Quotes** | `SalesQuote` | Possible but complex — HubSpot Quotes are tightly coupled to Deals and have a unique approval workflow. |
| **Lists/Segments** | None | No contact segmentation concept in OM. Tags provide partial coverage. |
| **Workflows** | `workflows` module | Different paradigm — HubSpot workflows are marketing automation; OM workflows are business process orchestration. Not worth syncing. |
| **Custom Objects** | Custom entities (`ce.ts`) | Theoretically possible but requires dynamic schema mapping. Phase 2+ feature. |

---

## 3. Adapter Contract Fit — DataSyncAdapter

### 3.1 streamImport() — HubSpot → Open Mercato

| Aspect | Assessment | Details |
|--------|------------|---------|
| **Delta cursor** | Works | Use `hs_lastmodifieddate` as cursor. Filter: `GT` operator with timestamp. |
| **Streaming** | Works | Paginate with `after` parameter (offset-based). Each page = one `ImportBatch`. |
| **Batch size** | Works | HubSpot supports `limit` up to 200 per page (search) or 100 (list). |
| **Resume** | Works | Persist `after` cursor + `hs_lastmodifieddate` filter for resumability. |
| **Total estimate** | Partial | Search API returns `total` count but capped at 10,000. No reliable total for larger datasets. |
| **Action detection** | Works | Use `SyncExternalIdMapping` to determine create vs update. `hash` via property values. |

**Critical limitation**: The search API's **10,000 result hard cap** means initial full sync for accounts with >10K contacts/companies/deals cannot use the search endpoint. Two workarounds:

1. **CRM Exports API** — Async bulk export, generates CSV/JSON files. No result limit. Best for initial full sync.
2. **List all endpoint** — `GET /crm/v3/objects/{type}` with pagination. Returns all records but cannot filter by modified date efficiently.

**Recommended approach**: Use CRM Exports API for initial full sync, then switch to search-by-`hs_lastmodifieddate` for delta syncs (which rarely exceed 10K changes between runs).

### 3.2 streamExport() — Open Mercato → HubSpot

| Aspect | Assessment | Details |
|--------|------------|---------|
| **Batch create** | Works | `POST /crm/v3/objects/{type}/batch/create` — 100 records per request |
| **Batch update** | Works | `POST /crm/v3/objects/{type}/batch/update` — 100 records per request |
| **ID mapping** | Works | Store HubSpot `id` ↔ OM `id` in `SyncExternalIdMapping` |
| **Error handling** | Works | Batch endpoints return per-item success/error in response |
| **Rate limiting** | Needs care | 100-190 req/10sec. With 100 items/batch, ~1000-1900 items/10sec throughput. |

### 3.3 getMapping() — Field Mapping

| Aspect | Assessment | Details |
|--------|------------|---------|
| **Static mapping** | Works | Define default mappings per entity type (contacts, companies, deals) |
| **Dynamic discovery** | Works | HubSpot Properties API (`GET /crm/v3/properties/{type}`) returns all properties including custom ones |
| **Transform functions** | Works | Built-in transforms: `centsToDecimal`, `timestampToDate`, `lowercase` etc. |
| **Custom property mapping** | Works | Admin maps HubSpot custom properties to OM custom fields via mapping UI |

### 3.4 validateConnection()

| Check | Method | Notes |
|-------|--------|-------|
| Auth valid | `GET /crm/v3/objects/contacts?limit=1` | Quick ping with minimal data |
| Scopes sufficient | Check OAuth scopes in token response | HubSpot returns granted scopes |
| API version | Check `X-HubSpot-API-Version` header | Informational |

---

## 4. Authentication Fit

SPEC-045a §8 defines OAuth 2.0 credential type with authorization code + PKCE flow, encrypted token storage, and background refresh worker.

| SPEC-045a Feature | HubSpot Support | Notes |
|-------------------|-----------------|-------|
| Authorization code flow | Yes | Standard `/oauth/v3/authorize` endpoint |
| PKCE | Not required | HubSpot uses standard client_secret |
| Token refresh | Yes | 30-minute access token, long-lived refresh token |
| Scope granularity | Yes | Per-object read/write scopes |
| Re-auth detection | Yes | Returns `401` on expired/revoked tokens |
| Token storage | Compatible | Store `access_token`, `refresh_token`, `expires_at` in `IntegrationCredentials` |

**Alternative: Private Apps** — For single-account integrations, HubSpot offers static access tokens via Private Apps (no expiry, no refresh needed). The adapter should support both auth modes:

```typescript
credentials: {
  fields: [
    { key: 'authMode', label: 'Authentication Mode', type: 'select', required: true,
      options: [
        { value: 'oauth', label: 'OAuth 2.0 (recommended for multi-account)' },
        { value: 'private_app', label: 'Private App Token (simpler, single account)' },
      ]},
    // OAuth fields (conditional)
    { key: 'clientId', label: 'Client ID', type: 'text', required: false },
    { key: 'clientSecret', label: 'Client Secret', type: 'secret', required: false },
    // Private App fields (conditional)
    { key: 'accessToken', label: 'Access Token', type: 'secret', required: false },
  ],
}
```

**Feasibility: HIGH** — OAuth 2.0 flow is already designed in the spec. Private App token support adds a simpler alternative.

---

## 5. Webhook Integration

HubSpot webhooks enable real-time sync (push-based) complementing the polling-based delta sync.

| SPEC-045 Feature | HubSpot Support | Notes |
|-------------------|-----------------|-------|
| Object creation | `object.creation` | Contacts, Companies, Deals, Tickets, Products |
| Property change | `object.propertyChange` | Per-property subscriptions |
| Deletion | `object.deletion` | Soft delete (archive) |
| Merge | `object.merge` | Record deduplication events |
| Association change | `object.associationChange` | Link/unlink events |

**Webhook delivery**: HubSpot batches up to 100 events per request, with 10 concurrent requests per account. Events include `objectId`, `propertyName`, `propertyValue`, `occurredAt`.

**Integration pattern**: Webhook events trigger immediate delta sync for the affected record instead of waiting for the next scheduled poll. This fits the `webhook_endpoints` hub (SPEC-045e) or can be handled within the data_sync adapter.

**Gap: Webhook registration** — HubSpot webhook subscriptions are registered per-app (not per-account). Public OAuth apps register subscriptions at the app level and they apply to all installed accounts. This means the Open Mercato admin cannot selectively subscribe to events via the UI — subscriptions are configured at the app developer level. For Private Apps, webhook subscriptions require HubSpot developer portal access.

---

## 6. Rate Limiting Fit

SPEC-045b defines a token-bucket rate limiter (`rate-limiter.ts`). HubSpot's limits:

| Tier | Burst (10 sec) | Daily | Search (per sec) |
|------|----------------|-------|------------------|
| Free/Starter | 100 | 250,000 | 5 |
| Professional | 190 | 625,000 | 5 |
| Enterprise | 190 | 1,000,000 | 5 |

**Configuration for rate limiter**:
```typescript
const hubspotRateLimiter = createRateLimiter({
  maxTokens: 90,          // Conservative: 90% of burst limit
  refillRate: 9,          // 9 tokens per second (90 per 10 sec)
  searchMaxTokens: 4,     // 4 search requests per second (below 5 limit)
  searchRefillRate: 4,
})
```

**Feasibility: HIGH** — The spec's rate limiter can be parameterized per HubSpot subscription tier. The daily limit should be tracked and surfaced in the admin UI.

---

## 7. Bundle Module Design

Following the MedusaJS bundle pattern from SPEC-045a §1.2:

```
packages/core/src/modules/sync_hubspot/
├── integration.ts          # Bundle + 5 integrations
├── index.ts
├── di.ts                   # Register adapters + health check
├── lib/
│   ├── shared.ts           # HubSpot API client, auth, rate limiter
│   ├── contacts-adapter.ts
│   ├── companies-adapter.ts
│   ├── deals-adapter.ts
│   ├── activities-adapter.ts
│   └── products-adapter.ts
├── workers/
│   └── hubspot-webhook.ts  # Process incoming HubSpot webhooks
├── api/
│   └── post/hubspot/webhook.ts  # Webhook receiver endpoint
└── i18n/
    ├── en.ts
    └── pl.ts
```

**Bundle declaration**:

| Integration ID | Entity Type | Direction | Priority |
|----------------|-------------|-----------|----------|
| `sync_hubspot_contacts` | `customers.person` | Bidirectional | P0 |
| `sync_hubspot_companies` | `customers.company` | Bidirectional | P0 |
| `sync_hubspot_deals` | `customers.deal` | Bidirectional | P1 |
| `sync_hubspot_activities` | `customers.activity` | Import | P1 |
| `sync_hubspot_products` | `catalog.product` | Bidirectional | P2 |

---

## 8. What Works Well (No Issues)

| Feature | Why It Works |
|---------|-------------|
| **Contact/Company CRUD sync** | Near-identical data models, standard REST API |
| **OAuth 2.0 authentication** | Already spec'd in SPEC-045a §8, HubSpot uses standard flow |
| **Delta sync via modified date** | `hs_lastmodifieddate` filter with GT operator = cursor-based streaming |
| **Batch operations** | 100 records/request aligns with `batchSize` concept |
| **Operation logging** | All HubSpot API responses include request IDs for correlation |
| **Health check** | Simple `GET /crm/v3/objects/contacts?limit=1` validates auth + connectivity |
| **ID mapping** | HubSpot uses numeric IDs, easy to store in `SyncExternalIdMapping` |
| **Custom property discovery** | Properties API returns full schema for dynamic mapping UI |
| **Credential encryption** | Private App tokens and OAuth tokens fit `IntegrationCredentials` |
| **Webhook event processing** | Batch delivery model (up to 100 events/request) is efficient |
| **Owner/user mapping** | Owners API provides email-based matching to OM users |
| **Tags** | HubSpot doesn't have tags per se, but OM tags can map to HubSpot list membership |

---

## 9. What's Difficult (Requires Extra Work)

### 9.1 Initial Full Sync (>10K Records)

**Problem**: HubSpot search API caps results at 10,000. Accounts with more contacts/companies cannot do initial full sync via search.

**Solution**: Use HubSpot's CRM Exports API for initial sync:
1. Trigger async export: `POST /crm/v3/exports` with object type + properties
2. Poll for completion: `GET /crm/v3/exports/{exportId}`
3. Download CSV/JSON result file
4. Stream through `DataSyncAdapter` as `ImportBatch` items

**Effort**: ~3-4 days. Requires implementing CSV/JSON file parsing in the adapter's `streamImport()` method with a two-mode approach (export API for initial, search API for delta).

### 9.2 Pipeline/Stage Mapping

**Problem**: HubSpot deals have structured pipelines (separate entity with stages as children). OM's `CustomerDeal.pipelineStage` is a flat string.

**Solution**:
1. On import: Fetch pipeline/stage names via `GET /crm/v3/pipelines/deals`, store as `"Pipeline Name > Stage Name"` in `pipelineStage`
2. Maintain a cached pipeline→stage lookup table per tenant
3. On export: Reverse-lookup the pipeline ID and stage ID from the concatenated string

**Effort**: ~2 days. The mapping table needs to be refreshed when pipelines change.

**Long-term recommendation**: Add a `pipeline` field to `CustomerDeal` entity to properly support multi-pipeline CRMs.

### 9.3 Association Labels

**Problem**: HubSpot v4 associations support labeled relationships (e.g., Contact↔Company with label "Decision Maker"). OM's junction tables (`CustomerDealPersonLink.participantRole`) only store a single role string.

**Solution**: Map the primary HubSpot association label to `participantRole`. Log additional labels as metadata or ignore them.

**Effort**: ~1 day. Acceptable data loss for labels beyond the primary one.

### 9.4 Lifecycle Stage Mapping

**Problem**: HubSpot has fixed lifecycle stages (`subscriber`, `lead`, `marketingqualifiedlead`, `salesqualifiedlead`, `opportunity`, `customer`, `evangelist`, `other`). OM uses tenant-defined dictionary entries.

**Solution**: Provide a configurable mapping table in the integration settings. Admin maps each HubSpot stage to an OM dictionary entry. Seed default entries on integration enable.

**Effort**: ~2 days. Needs a mapping UI widget (UMES injection).

### 9.5 Webhook Subscription Management

**Problem**: HubSpot webhook subscriptions are app-level (not account-level for OAuth apps). The admin cannot selectively subscribe/unsubscribe via the OM UI.

**Solution**:
- For **Private Apps**: Use `POST /webhooks/v3/{appId}/subscriptions` to manage subscriptions programmatically
- For **OAuth Apps**: Subscriptions must be pre-configured at the app developer level. Document this as a setup requirement.

**Effort**: ~2 days for Private App webhook management. OAuth webhook management is a documentation task.

### 9.6 Merge Event Handling

**Problem**: When HubSpot merges two contacts, the losing record is archived and the winning record absorbs data. The `object.merge` webhook includes both IDs but the adapter must handle deduplication in OM.

**Solution**: On merge event:
1. Look up both external IDs in `SyncExternalIdMapping`
2. If both exist in OM: merge OM records (or mark the loser as inactive)
3. Update the ID mapping to point to the winning record

**Effort**: ~2 days. Merge logic is CRM-specific and needs careful handling.

---

## 10. What's Missing (Gaps Requiring New OM Features)

### 10.1 Tickets Module — NOT FEASIBLE without new module

HubSpot Tickets (support tickets with pipeline/stage workflows) have no equivalent in OM. The customers module handles CRM entities but not issue tracking.

**Impact**: Cannot sync HubSpot Tickets. This is acceptable for a CRM integration (tickets are a Service Hub feature, not core CRM).

**Future**: A `tickets` or `support` module could be added later, enabling a `sync_hubspot_tickets` integration.

### 10.2 Contact Lists/Segments — NOT FEASIBLE without new concept

HubSpot Lists (now Segments) provide dynamic/static contact grouping based on filter criteria. OM has `CustomerTag` for grouping but no dynamic segmentation engine.

**Impact**: Cannot sync HubSpot list membership. Tags provide a rough equivalent for static lists.

**Workaround**: Import HubSpot list names as tags, assign contacts accordingly. No dynamic re-evaluation.

### 10.3 Custom Objects — DEFERRED (Phase 2+)

HubSpot Custom Objects require dynamic schema discovery and mapping to OM's `ce.ts` custom entity system. This is technically possible but adds significant complexity.

**Impact**: Custom HubSpot objects won't sync in Phase 1.

### 10.4 Marketing Workflows — OUT OF SCOPE

HubSpot workflows are marketing automation (email sequences, lead nurturing). OM's workflow module is business process orchestration (approvals, multi-step operations). Different paradigms, not worth bridging.

### 10.5 Timeline Events — PARTIALLY FEASIBLE

HubSpot Timeline Events allow pushing custom events to record timelines. OM's `CustomerActivity` can receive these (as custom activity types), but pushing OM activities as HubSpot timeline events requires creating an event template via the HubSpot developer portal first.

**Impact**: Import works; export requires manual template setup in HubSpot.

---

## 11. Effort Estimation

### Phase 1 — Core CRM Sync (P0)

| Task | Effort | Notes |
|------|--------|-------|
| Bundle module scaffolding | 1 day | `integration.ts`, `di.ts`, shared client |
| HubSpot API client + auth (OAuth + Private App) | 3 days | Token refresh, rate limiter, error handling |
| Contacts adapter (bidirectional) | 4 days | streamImport, streamExport, getMapping, validateConnection |
| Companies adapter (bidirectional) | 3 days | Similar to contacts, less field complexity |
| Initial full sync (CRM Exports API) | 3 days | Async export + file parsing + streaming |
| Field mapping defaults + transforms | 2 days | Lifecycle stage, owner, address transforms |
| Integration tests | 3 days | Mock HubSpot API, test all sync scenarios |
| **Phase 1 Total** | **~19 days** | |

### Phase 2 — Deals + Activities (P1)

| Task | Effort | Notes |
|------|--------|-------|
| Deals adapter (bidirectional) | 4 days | Pipeline mapping, multi-party associations |
| Activities adapter (import) | 3 days | Calls, emails, meetings → CustomerActivity |
| Notes → CustomerComment mapping | 1 day | |
| Webhook receiver + event processing | 3 days | Real-time sync complement |
| Merge event handling | 2 days | Deduplication logic |
| **Phase 2 Total** | **~13 days** | |

### Phase 3 — Products + Polish (P2)

| Task | Effort | Notes |
|------|--------|-------|
| Products adapter (bidirectional) | 3 days | Simple product sync (no variants) |
| Lifecycle stage mapping UI widget | 2 days | UMES injection for config |
| Pipeline mapping UI widget | 2 days | UMES injection for config |
| Admin documentation | 1 day | Setup guide, troubleshooting |
| **Phase 3 Total** | **~8 days** | |

### Total Estimated Effort: ~40 days (8 weeks)

---

## 12. Prerequisites

| Prerequisite | Status | Notes |
|--------------|--------|-------|
| SPEC-045a Foundation (Registry, Credentials, Logs) | Required | Must be implemented first |
| SPEC-045b Data Sync Hub | Required | `DataSyncAdapter` contract, sync engine, mapping UI |
| OAuth 2.0 credential type (SPEC-045a §8) | Required | HubSpot OAuth flow |
| `packages/scheduler` integration | Recommended | For scheduled periodic sync |
| Progress module (SPEC-004) | Recommended | For sync progress UI |

---

## 13. Risks

### Critical

| Risk | Impact | Mitigation |
|------|--------|------------|
| **10K search cap during delta sync** | If >10K records change between sync runs (rare but possible after bulk updates), delta sync misses records | Fall back to CRM Exports API when search returns exactly 10K results. Add warning in operation logs. |

### High

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Rate limit exhaustion** | Large accounts with 500K+ contacts hit daily limits during sync | Respect rate limits via token bucket. Spread sync across hours. Add daily limit tracking with pause-and-resume. |
| **HubSpot API version changes** | HubSpot deprecates endpoints (v1 Lists sunset April 2026) | Use latest API versions. Declare `apiVersions` in `integration.ts`. Monitor HubSpot changelog. |
| **Data loss on merge** | Losing record data may not fully transfer to winner | Log all merge events. Provide admin notification for manual review. |

### Medium

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Association timestamp gap** | Changes to associations may not update `hs_lastmodifieddate`, causing delta sync to miss association changes | Supplement polling with webhook subscriptions for `associationChange` events. |
| **Custom property drift** | Admin adds custom properties in HubSpot after initial mapping | Periodic schema discovery (via Properties API) to detect new properties. Notify admin of unmapped fields. |
| **Concurrent sync conflicts** | Bidirectional sync creates update loops (OM→HubSpot→webhook→OM) | Use `SyncExternalIdMapping` hash to detect self-originated changes. Skip re-import of just-exported records. |

---

## 14. Comparison with Similar Integrations

| Aspect | HubSpot | OroCRM (ANALYSIS-002) | MedusaJS (SPEC-045b ref) |
|--------|---------|----------------------|--------------------------|
| Auth | OAuth 2.0 + Private Apps | API key + OAuth | API key |
| Delta sync | `hs_lastmodifieddate` filter | `updatedAt` filter | `updated_since` param |
| Webhooks | Yes (batched, per-app) | No | Yes (per-event) |
| Batch API | 100 records/request | No batch API | No batch API |
| Rate limits | 100-190/10sec, 5/sec search | 10/sec (typical) | Self-hosted (unlimited) |
| Result cap | 10,000 (search) | None | None |
| Custom objects | Yes (Enterprise) | Yes | No |
| Overall fit | ~80-85% | ~70-75% | ~90% |

---

## 15. Verdict & Recommendations

### Verdict: HIGH FEASIBILITY (~80-85% coverage)

HubSpot CRM is an excellent candidate for the first CRM data sync integration. The data models align well with Open Mercato's customers module, the API is mature and well-documented, and the SPEC-045 framework provides all necessary infrastructure.

### Recommendations

1. **Implement as a bundle module** (`sync_hubspot`) with 5 integrations following the MedusaJS pattern
2. **Phase the rollout** — contacts/companies first (highest value, simplest mapping), then deals/activities, then products
3. **Support both auth modes** — OAuth 2.0 for marketplace distribution, Private App token for single-account deployments
4. **Use CRM Exports API for initial full sync** — avoids the 10K search cap
5. **Combine polling + webhooks** — scheduled delta sync as primary, webhooks for real-time complement
6. **Plan a `CustomerDeal.pipeline` field enhancement** — needed for proper multi-pipeline CRM support (HubSpot, Salesforce, Pipedrive all use structured pipelines)
7. **Skip Tickets, Lists, Custom Objects, Workflows** — out of scope for CRM data sync; can be added later as separate integrations
8. **Implement bidirectional loop detection** — critical for avoiding update ping-pong in bidirectional sync
