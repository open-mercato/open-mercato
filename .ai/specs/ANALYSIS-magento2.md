# Integration Feasibility Analysis — Magento 2

## Overview
- Magento 2 (Adobe Commerce) is a PHP-based e-commerce platform
- REST + GraphQL APIs
- Hub: `data_sync` (DataSyncAdapter)
- Bundle ID: `sync_magento2`
- Overall Feasibility: **Partial** — significant challenges with EAV, webhooks, auth

## API Analysis
- REST API: `/rest/V1/products`, `/rest/V1/orders`, `/rest/V1/customers`
- GraphQL API available but primarily for storefront (not admin)
- Authentication: OAuth 1.0a (NOT OAuth 2.0) — requires custom signature generation per request (HMAC-SHA256 with nonce/timestamp). NOT compatible with SPEC-045a §8 OAuth 2.0 credential type. Must use `secret` credential type with custom OAuth 1.0a token exchange
- Rate limits: Adobe Commerce Cloud: 300 req/5 min; Self-hosted: configurable/unlimited
- Pagination: Offset-based only (`searchCriteria[currentPage]` + `searchCriteria[pageSize]`). No cursor pagination. Max 300 items/page. Fragile for delta sync — concurrent updates can cause missed/duplicate records at page boundaries
- Delta queries: `searchCriteria[filter_groups][0][filters][0][field]=updated_at&condition_type=gteq&value=2024-01-01` — verbose but functional

## Data Model Mapping
| Magento 2 Concept | Open Mercato Equivalent | Notes |
|-------------------|------------------------|-------|
| Product (Simple/Configurable/Bundle/Grouped/Virtual) | catalog.product + variants | EAV model with 15+ attribute types |
| Category (tree) | catalog.category | Tree via `position` + `parent_id` |
| Customer + EAV attributes | customers.person | Standard fields + custom EAV |
| Order + status/state machine | sales.order | Rich model, custom statuses |
| MSI SourceItem | Multi-warehouse inventory | Per product per warehouse (since 2.3) |

## Webhook Support
- **Magento Open Source: No native webhook support.** Requires polling or 3rd-party module
- **Adobe Commerce (paid):** Limited webhook support via Adobe I/O Events
- Recommendation: Bundle must ship companion Magento PHP module for real-time sync

## Adapter Contract Fit
| Method | Magento 2 API | Feasibility |
|--------|--------------|-------------|
| streamImport (products) | GET /rest/V1/products + searchCriteria | Full — but EAV attribute resolution complex |
| streamImport (orders) | GET /rest/V1/orders + searchCriteria | Full |
| streamImport (customers) | GET /rest/V1/customers/search | Full |
| streamExport (products) | POST/PUT /rest/V1/products | Full — configurable product needs multiple calls |
| streamExport (orders) | POST /rest/V1/orders | Partial — complex |
| streamExport (inventory) | POST /rest/V1/inventory/source-items | Full for MSI |
| verifyWebhook | N/A (no native webhooks) | Gap — requires companion module |

## Bundle Structure
```
sync_magento2/
├── integration.ts          # Bundle definition, apiVersions: [v2.4, v2.3]
├── lib/
│   ├── auth.ts             # OAuth 1.0a signature generation (custom)
│   ├── rate-limiter.ts     # 300 req/5min token bucket
│   ├── eav-resolver.ts     # EAV attribute value resolution and type mapping
│   ├── adapters/
│   │   ├── products.ts     # DataSyncAdapter (bidirectional, EAV-aware)
│   │   ├── categories.ts   # DataSyncAdapter (tree sync)
│   │   ├── customers.ts    # DataSyncAdapter (bidirectional)
│   │   ├── orders.ts       # DataSyncAdapter (primarily import)
│   │   ├── inventory.ts    # DataSyncAdapter (MSI, bidirectional)
│   │   └── webhooks.ts     # WebhookEndpointAdapter (companion module)
│   └── transforms.ts       # EAV → flat field mapping
├── setup.ts
└── i18n/
```

## Credential Configuration
```typescript
credentials: {
  fields: [
    { key: 'baseUrl', label: 'Magento Base URL', type: 'url', required: true },
    { key: 'consumerKey', label: 'Consumer Key', type: 'secret', required: true },
    { key: 'consumerSecret', label: 'Consumer Secret', type: 'secret', required: true },
    { key: 'accessToken', label: 'Access Token', type: 'secret', required: true },
    { key: 'accessTokenSecret', label: 'Access Token Secret', type: 'secret', required: true },
    { key: 'webhookSecret', label: 'Webhook Secret', type: 'secret' },
  ],
}
```

## Feasibility Ratings
| Capability | Rating (1-5) | Notes |
|-----------|-------------|-------|
| Product sync (import) | 3 / Moderate | EAV complexity requires dedicated resolver |
| Product sync (export) | 3 / Moderate | Configurable products need multiple API calls |
| Category sync | 4 / Good | Tree API works well |
| Customer sync | 4 / Good | Standard fields map cleanly |
| Order sync (import) | 4 / Good | Rich order model |
| Order sync (export) | 2 / Difficult | Complex order creation |
| Inventory sync (MSI) | 4 / Good | SourceItem API clean for MSI |
| Real-time sync | 1 / Infeasible | No native webhooks (Open Source) |
| Pricing sync | 3 / Moderate | Tier pricing, special prices, catalog rules |

## Key Challenges
1. **OAuth 1.0a authentication**: SPEC-045a §8 OAuth 2.0 is incompatible. Custom signature generation needed
2. **EAV model complexity**: 15+ attribute types, multi-store values. Dedicated `eav-resolver.ts` required
3. **No native webhooks**: Companion Magento PHP module required for real-time sync
4. **Offset pagination fragility**: No cursor pagination. Nightly full reconciliation recommended
5. **Configurable product complexity**: 4+ API calls per configurable product creation
6. **Multi-store/multi-website**: `storeCode` header per request, N parallel sync runs

## Gaps Summary
- OAuth 1.0a adapter needed (framework only has OAuth 2.0)
- Companion Magento webhook module must be developed
- EAV attribute resolver is significant development effort
- Estimated effort: **6-8 weeks**
