# Integration Feasibility Analysis — HubSpot

## Overview
- HubSpot is a SaaS CRM platform
- CRM v3 REST API
- Hub: `data_sync` (DataSyncAdapter), `webhook_endpoints` (WebhookEndpointAdapter)
- Bundle ID: `sync_hubspot`
- Overall Feasibility: **Excellent** — best framework fit of all CRM platforms

## API Analysis
- CRM v3: `/crm/v3/objects/contacts`, `/crm/v3/objects/companies`, `/crm/v3/objects/deals`
- Search: POST `/crm/v3/objects/{objectType}/search` with filters, sorts, pagination
- Auth: Private App token (Bearer) or OAuth 2.0 authorization code — compatible with SPEC-045a §8
- Pagination: Cursor-based via opaque `after` token — direct DataSyncAdapter fit
- Delta: `lastmodifieddate` filter in search API. Epoch milliseconds
- Rate limits: 100 req/10s (all tiers). Search: additional 4 req/s sub-limit
- Associations API: Separate endpoint for object relationships

## Data Model Mapping
| HubSpot Object | Open Mercato Entity | Mapping Quality |
|---------------|--------------------|----|
| Contact | Person | Excellent — first/last name, email, phone |
| Company | Company | Excellent — name, domain, industry |
| Deal | Deal | Good — pipeline stage mapping needed |
| Task | Activity (type: task) | Good |
| Call | Activity (type: call) | Good |
| Email | Activity (type: email) | Good |
| Meeting | Activity (type: meeting) | Good |
| Note | Activity (type: note) | Good |
| Product | catalog.product | Moderate — minimal properties |

## Webhook Support — Available on ALL Tiers
- Configured at App level (not per-portal)
- Events: creation/deletion/propertyChange for contacts, companies, deals
- HMAC-SHA256 signature in `X-HubSpot-Signature` or `X-HubSpot-Signature-v3`
- Batch delivery: events arrive in arrays
- Property-change events only include changed value — full object fetch needed

## Bundle Structure
```
sync_hubspot/
├── integration.ts                     # Bundle + 6 integrations
├── lib/
│   ├── auth.ts                        # Private App token + OAuth 2.0
│   ├── rate-limiter.ts                # 100 req/10s, 4 search req/s
│   ├── schema-introspector.ts         # Custom properties + pipelines
│   ├── associations.ts                # Batch association resolver
│   ├── adapters/
│   │   ├── contacts.ts                # DataSyncAdapter: Contact ↔ Person
│   │   ├── companies.ts               # DataSyncAdapter: Company ↔ Company
│   │   ├── deals.ts                   # DataSyncAdapter: Deal ↔ Deal
│   │   ├── activities.ts              # DataSyncAdapter: activities ↔ Activity
│   │   ├── products.ts                # DataSyncAdapter: Product → catalog.product
│   │   └── webhooks.ts                # WebhookEndpointAdapter
│   └── shared.ts
├── widgets/injection/
│   └── stage-mapping/                 # Deal stage mapping UI widget
├── setup.ts
└── i18n/
```

## Feasibility Ratings
| Capability | Rating (1-5) | Notes |
|-----------|-------------|-------|
| Contact/Person sync | 5 / Excellent | Cursor pagination, delta filter, webhooks all tiers |
| Company sync | 5 / Excellent | Domain deduplication needs mapping decision |
| Deal sync | 4 / Good | Pipeline stage mapping required |
| Activity sync | 4 / Good | Multiple engagement types map well |
| Product sync | 3 / Moderate | Minimal properties. No variants |
| Real-time sync | 5 / Excellent | HMAC-SHA256 webhooks on all tiers |

## Key Challenges
1. **Rate limits at scale**: 100K contact sync at search sub-limit (4/s) takes ~2 min + association lookups
2. **Association model (N+1)**: Contact-company relationships need separate batch API calls
3. **Custom properties**: Large portals have hundreds. Schema introspection, cached in IntegrationState
4. **Pipeline stage mapping**: Portal-specific text IDs. Configuration widget required
5. **Webhook property sparseness**: Changed value only → additional API call to fetch full object
6. **Non-standard query patterns**: Search uses POST, millisecond epoch, separate filter group logic

## Gaps Summary
- Stage mapping widget required for deal sync
- Association resolver adds API overhead
- Schema introspection caching needed
- Estimated effort: **4-5 weeks**
