# Integration Feasibility Analysis — Shopify

## Overview
- Shopify is a SaaS e-commerce platform
- Admin REST API + Admin GraphQL API
- Hub: `data_sync` (DataSyncAdapter)
- Bundle ID: `sync_shopify`
- Overall Feasibility: **Full** — best API design of all e-commerce platforms

## API Analysis
- GraphQL API (preferred): cursor pagination, cost-based rate limiting, rich filtering
- REST API: link-header pagination, leaky bucket (40 req/bucket, 2 req/sec refill; 80 on Plus)
- GraphQL rate limit: Cost-based — 1000 points/sec budget. Complex queries cost 30-60 points
- Auth: OAuth 2.0 (public apps) — compatible with SPEC-045a §8. Custom apps: permanent token
- Pagination: Opaque cursor via `after: $cursor` (GraphQL) — perfect DataSyncAdapter fit
- Delta: `updated_at_min` (REST), `query: "updated_at:>'<timestamp>'"` (GraphQL)
- API versioning: Quarterly dated versions (2025-01, 2024-10). Maps to framework `apiVersions`

## Data Model Mapping
| Shopify Concept | Open Mercato Equivalent | Notes |
|----------------|------------------------|-------|
| Product (max 100 variants, 3 options) | catalog.product + variants | Hard variant/option limits |
| Custom/Smart Collection | catalog.category | Smart rules not exportable |
| Customer + tags | customers.person | Tags-based segmentation |
| Order + financial/fulfillment status | sales.order | Rich model, draft orders separate |
| InventoryItem + InventoryLevel | Multi-location inventory | Per location per item |
| Metafields | Custom fields | Key-value per resource |

## Webhook Support — Most Mature
- HMAC-SHA256 signed with client secret via `X-Shopify-Hmac-Sha256`
- `X-Shopify-Webhook-Id` for idempotency
- Max 1000 subscriptions per store
- At-least-once delivery, retry up to 48 hours
- **Mandatory GDPR webhooks**: `shop/redact`, `customers/redact`, `customers/data_request`
- Topics: products, orders, customers, inventory, fulfillments, refunds CRUD

## Adapter Contract Fit
| Method | Shopify API | Feasibility |
|--------|------------|-------------|
| streamImport (products) | GraphQL products query with cursor | Full |
| streamImport (orders) | GraphQL orders query with cursor | Full |
| streamImport (customers) | GraphQL customers query with cursor | Full |
| streamImport (inventory) | GraphQL inventoryLevels + items | Full |
| streamExport (products) | productCreate/productUpdate mutations | Full |
| streamExport (orders) | draftOrderCreate + draftOrderComplete | Partial |
| streamExport (inventory) | inventorySetQuantities mutation | Full |
| streamExport (fulfillments) | fulfillmentCreate mutation | Full |
| verifyWebhook | HMAC-SHA256 via X-Shopify-Hmac-Sha256 | Full |

## Bundle Structure
```
sync_shopify/
├── integration.ts              # apiVersions: [2025-01, 2024-10]
├── lib/
│   ├── client.ts               # GraphQL client with cost-based throttling
│   ├── status-map.ts
│   ├── adapters/
│   │   ├── products.ts         # DataSyncAdapter (bidirectional, GraphQL)
│   │   ├── collections.ts      # DataSyncAdapter (import + membership)
│   │   ├── customers.ts        # DataSyncAdapter (bidirectional)
│   │   ├── orders.ts           # DataSyncAdapter (bidirectional)
│   │   ├── inventory.ts        # DataSyncAdapter (multi-location)
│   │   ├── fulfillments.ts     # DataSyncAdapter (export)
│   │   └── webhooks.ts         # WebhookEndpointAdapter (HMAC-SHA256)
│   ├── transforms.ts           # Tag serialization, metafield handling
│   ├── gdpr.ts                 # Mandatory GDPR webhook handlers
│   └── health.ts
├── subscribers/
│   ├── order-status-changed.ts
│   ├── product-updated.ts
│   ├── inventory-adjusted.ts
│   └── shipment-created.ts
├── workers/
│   ├── outbound-push.ts
│   └── inbound-webhook.ts
└── i18n/
```

## Credential Configuration
```typescript
credentials: {
  fields: [
    { key: 'shopDomain', label: 'Store Domain', type: 'url', required: true },
    { key: 'authMode', label: 'Auth Mode', type: 'select', options: [
      { value: 'oauth', label: 'Shopify App (OAuth)' },
      { value: 'token', label: 'Custom App (Access Token)' },
    ]},
    { key: 'clientId', label: 'App Client ID', type: 'text' },
    { key: 'clientSecret', label: 'App Client Secret', type: 'secret' },
    { key: 'oauthTokens', label: 'Shopify Account', type: 'oauth', oauth: {
      provider: 'shopify', scopes: ['read_products', 'write_products',
      'read_orders', 'write_orders', 'read_customers', 'write_customers',
      'read_inventory', 'write_inventory'], refreshStrategy: 'on-demand',
    }},
    { key: 'accessToken', label: 'Access Token (Custom App)', type: 'secret' },
    { key: 'webhookSecret', label: 'Webhook Secret', type: 'secret' },
  ],
}
```

## Feasibility Ratings
| Capability | Rating (1-5) | Notes |
|-----------|-------------|-------|
| Product sync (import) | 5 / Excellent | GraphQL cursor + updated_at delta |
| Product sync (export) | 5 / Excellent | Mutations + bulk variants |
| Collection sync | 4 / Good | Custom creatable; smart rules not exportable |
| Customer sync | 5 / Excellent | Clean model with cursor |
| Order import | 5 / Excellent | Comprehensive model |
| Inventory sync | 5 / Excellent | Multi-location with absolute set |
| Fulfillment sync | 5 / Excellent | fulfillmentCreate with tracking |
| Real-time sync | 5 / Excellent | Native webhooks, HMAC-SHA256, high reliability |

## Key Challenges
1. **100-variant / 3-option hard limits**: Products exceeding these CANNOT be exported. Must detect, log, truncate
2. **GraphQL cost-based rate limiting**: Custom cost-aware throttler needed (generic token bucket insufficient)
3. **Quarterly API versioning**: apiVersions array needs maintenance every 3 months
4. **GDPR mandatory webhooks**: 3 topics required for app review. Must respond 200 OK within 5s
5. **Smart collections**: Rules not exportable via API. Import membership only

## Gaps Summary
- Custom GraphQL cost-aware rate limiter needed
- GDPR handlers required for compliance
- 100-variant hard limit documented prominently
- Estimated effort: **4-6 weeks**
