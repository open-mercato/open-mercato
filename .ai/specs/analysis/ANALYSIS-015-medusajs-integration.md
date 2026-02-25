# Integration Feasibility Analysis — MedusaJS

## Overview
- MedusaJS is a Node.js headless commerce platform (open source)
- REST Admin API (v1 and v2)
- Hub: `data_sync` (DataSyncAdapter)
- Bundle ID: `sync_medusa` (reference implementation per SPEC-045b)
- Overall Feasibility: **Full** — cleanest API of all e-commerce platforms

## API Analysis
- Admin REST API: `/admin/products`, `/admin/orders`, `/admin/customers`, `/admin/inventory-items`
- Auth: API key in `x-medusa-access-token` header (v1) or Bearer token (v2)
- Rate limits: None built-in (self-hosted)
- Pagination: Offset-based (`offset` + `limit`). No cursor pagination
- Delta: `updated_at` filter on most v2 endpoints (not uniform across all)

## Data Model Mapping
| MedusaJS Concept | Open Mercato Equivalent | Notes |
|-----------------|------------------------|-------|
| Product → ProductVariant (1:N) | catalog.product + variants | Clean model, options as key-value pairs |
| Collection / ProductCategory | catalog.category | Collections flat; categories hierarchical |
| Customer + groups | customers.person | Clean model, groups for pricing |
| Order + fulfillment/payment | sales.order | Rich model |
| InventoryItem + InventoryLevel | Multi-location inventory | v2 multi-warehouse |
| Region + PriceList/MoneyAmount | Pricing context | Currency + country scoping |

## Webhook Support
- v2 has native event bus (in-process or Redis-based)
- **NOT zero-code**: Requires installing subscriber module in Medusa backend
- Custom HMAC via shared secret in `X-Medusa-Signature` header
- Events: product/order/customer/inventory CRUD events
- With Redis event bus: reliable persistent subscribers with retry

## Adapter Contract Fit
| Method | MedusaJS API | Feasibility |
|--------|-------------|-------------|
| streamImport (products) | GET /admin/products | Full — clean model |
| streamImport (orders) | GET /admin/orders | Full — rich model |
| streamImport (customers) | GET /admin/customers | Full |
| streamImport (inventory) | GET /admin/inventory-items + levels | Full (v2) |
| streamExport (products) | POST/PUT /admin/products | Full |
| streamExport (orders) | POST /admin/orders | Partial — push fulfillments/status back |
| verifyWebhook | Custom HMAC via X-Medusa-Signature | Full (with subscriber module) |

## Bundle Structure (Reference Implementation — SPEC-045b §5.1)
```
sync_medusa/
├── integration.ts              # apiVersions: [v2 (stable), v1 (deprecated)]
├── lib/
│   ├── auth.ts
│   ├── adapters/
│   │   ├── products.ts         # DataSyncAdapter (bidirectional)
│   │   ├── customers.ts        # DataSyncAdapter (bidirectional)
│   │   ├── orders.ts           # DataSyncAdapter (bidirectional)
│   │   ├── inventory.ts        # DataSyncAdapter (bidirectional)
│   │   └── webhooks.ts         # WebhookEndpointAdapter
│   └── transforms.ts
├── subscribers/
│   ├── order-status-changed.ts
│   ├── product-updated.ts
│   └── shipment-created.ts
├── workers/
│   └── inbound-webhook.ts
└── i18n/
```

## Credential Configuration
```typescript
credentials: {
  fields: [
    { key: 'medusaApiUrl', label: 'Medusa API URL', type: 'url', required: true },
    { key: 'medusaApiKey', label: 'Admin API Key', type: 'secret', required: true },
    { key: 'medusaWebhookSecret', label: 'Webhook Secret', type: 'secret', required: true },
  ],
}
```

## Feasibility Ratings
| Capability | Rating (1-5) | Notes |
|-----------|-------------|-------|
| Product sync (import) | 5 / Excellent | Clean model, straightforward |
| Product sync (export) | 5 / Excellent | Full CRUD API |
| Customer sync | 5 / Excellent | Clean model |
| Order import | 5 / Excellent | Rich order model |
| Order export | 3 / Moderate | Push status/fulfillments back |
| Inventory sync | 5 / Excellent | Multi-warehouse (v2) |
| Pricing sync | 3 / Moderate | Region-scoped pricing complex |
| Real-time sync | 3 / Moderate | Requires subscriber module installation |

## Key Challenges
1. **Subscriber module requirement**: Merchant must install companion package `@open-mercato/medusa-subscriber`
2. **Offset pagination fragility**: `updated_at` filter not uniform. Nightly reconciliation recommended
3. **v1 vs v2 migration**: Incompatible schemas. Doubles adapter code
4. **Price model complexity**: v2 PriceSet → Price with currency/region/rule conditions
5. **Region/channel scoping**: Products scoped to sales channels; prices region-scoped

## Gaps Summary
- Companion subscriber module needed for webhooks
- Offset pagination requires reconciliation
- Estimated effort: **3-4 weeks** (reference implementation)
