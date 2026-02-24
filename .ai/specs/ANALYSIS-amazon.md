# Integration Feasibility Analysis — Amazon (SP-API)

## Overview
- Amazon Selling Partner API (SP-API) for marketplace integration
- REST API with complex dual authentication (LWA OAuth + AWS SigV4)
- Hub: `data_sync` (DataSyncAdapter)
- Bundle ID: `sync_amazon`
- Overall Feasibility: **Partial** — highest complexity of all 20 platforms, most constrained rate limits

## API Analysis
- REST API: Regional endpoints (`sellingpartnerapi-na.amazon.com`, `-eu`, `-fe`)
- Auth: **Dual authentication** — Login With Amazon (LWA) OAuth 2.0 + AWS Signature V4. Requires IAM Role ARN + AWS credentials
- Rate limits: **Extremely restrictive** — Orders: 1 req/60s restore (burst 20). Catalog: 2 TPS. Feeds: 1 req/2min
- Pagination: Cursor via `NextToken` — maps to framework cursor
- Delta: `LastUpdatedAfter` on orders. Reports API for bulk data
- Sandbox: Not fully functional. Real Seller Central account needed

## Critical Architecture Issues

### Dual Authentication (LWA + SigV4)
Every call requires:
1. LWA access token (OAuth 2.0) — framework's `oauth` credential handles this
2. AWS SigV4 signed `Authorization` header — requires IAM credentials

Most complex auth among all 20 platforms.

### SQS-Only Notifications
Events delivered ONLY to AWS SQS or EventBridge — NOT HTTP. No `WebhookEndpointAdapter` mapping without SQS.

### Shared Catalog Model
Sellers DON'T own product pages. Manage listing attributes (price, stock, condition) against shared ASINs.

## Data Model Mapping
| Amazon Concept | Open Mercato Equivalent | Notes |
|---------------|------------------------|-------|
| ASIN | SyncExternalIdMapping | Amazon-assigned shared ID |
| Seller SKU | catalog.variant.sku | Seller-assigned |
| Parent/Child ASIN | catalog.product/variant | Variation grouping |
| Order | sales.order | Clean mapping |
| Buyer (masked) | customers.person | Proxy email; RDT for real PII |
| FBA Inventory | Virtual warehouse | External warehouse concept |

## Reports API for Bulk Operations
Direct API calls are rate-limited. Async Reports API required:
1. POST /reports → submit request
2. Poll GET /reports/{reportId} → wait (15-90 min)
3. GET /reports/documents/{docId} → S3 presigned URL
4. Download + parse tab-delimited → stream batches

Cursor must encode multi-phase state: `{ phase, reportId, rowOffset }`

## Bundle Structure
```
sync_amazon/
├── integration.ts
├── lib/
│   ├── client.ts               # SP-API with LWA + SigV4
│   ├── lwa-token.ts            # LWA token management
│   ├── sigv4.ts                # AWS Signature V4
│   ├── adapters/
│   │   ├── orders.ts           # DataSyncAdapter
│   │   ├── listings.ts         # DataSyncAdapter
│   │   └── inventory.ts        # DataSyncAdapter
│   ├── report-processor.ts     # Async report pipeline
│   └── feed-submitter.ts       # Feed upload + monitoring
└── workers/
    ├── order-poller.ts         # Delta poll (rate limited)
    ├── report-requester.ts
    ├── feed-processor.ts
    └── sqs-consumer.ts         # Optional enterprise
```

## Feasibility Ratings
| Capability | Rating (1-5) | Notes |
|-----------|-------------|-------|
| Order import | 4 / Good | LastUpdatedAfter delta; NextToken cursor |
| Listing import | 3 / Moderate | Snapshot only; no catalog authority |
| Listing export | 3 / Moderate | PATCH for sync; Feeds for bulk |
| FBA inventory | 3 / Moderate | Inventory API; virtual warehouse |
| Fulfillment export | 4 / Good | Shipping confirmation straightforward |
| Real-time notifications | 1 / Infeasible | SQS/EventBridge only |
| Multi-marketplace | 2 / Difficult | Per-region limits + configuration |
| Customer import | 3 / Moderate | PII requires RDT (extra API call) |

## Key Challenges
1. **Dual auth (LWA + SigV4)**: Most complex auth. STS temp credentials + SigV4 signing
2. **Extreme rate limits**: Orders at 1/60s. Bulk requires Reports API (15-90 min)
3. **SQS-only notifications**: No HTTP webhooks. Requires AWS setup by tenant
4. **Shared catalog**: Can only manage listing attributes, not product pages
5. **RDT for buyer PII**: Per-order request (60s expiry). Doubles API budget
6. **Feed processing delays**: 15min to hours. No synchronous bulk write
7. **Product-type JSON Schemas**: Category-specific listing validation
8. **Sandbox limitations**: Real Seller Central account needed

## Gaps Summary
- SQS infrastructure outside framework scope
- AWS SigV4 implementation required
- Rate limits prevent real-time use
- Reports API adds significant latency
- Estimated effort: **8-10 weeks** (highest of all 20 platforms)
