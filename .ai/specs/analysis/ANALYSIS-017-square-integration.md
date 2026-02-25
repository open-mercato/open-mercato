# Integration Feasibility Analysis — Square

## Overview
- Square serves dual roles: **payment gateway** AND **commerce platform**
- REST API with OAuth 2.0 + PKCE
- Hubs: `payment_gateways` (GatewayAdapter) + `data_sync` (DataSyncAdapter)
- Bundle ID: `sync_square` (combines gateway + data sync)
- Overall Feasibility: **Full** — best-designed marketplace API, dual hub fit

## API Analysis
- REST API: Payments, Checkout, Catalog, Inventory, Orders, Customers, Locations
- Auth: OAuth 2.0 authorization code with PKCE — direct SPEC-045a §8 fit
- Rate limits: 10 req/sec per application. Clean, predictable
- Pagination: Cursor-based via `cursor` field. `total_count` provided
- Delta: Catalog uses version-based detection (monotonic integer). Orders/customers: `updated_at`
- Sandbox: Fully functional at `connect.squareupsandbox.com`
- Webhooks: HTTP POST, JSON, HMAC-SHA256 via `X-Square-HMAC-SHA256-Event-Signature`. < 2s latency

## GatewayAdapter Mapping (Payment Gateway)
| Method | Square API | Feasibility |
|--------|-----------|-------------|
| createSession | POST /v2/checkouts → hosted checkout URL | Full |
| capture | POST /v2/payments/{id}/complete | Full — delayed capture |
| refund | POST /v2/refunds | Full — partial and full |
| cancel | POST /v2/payments/{id}/cancel | Full |
| getStatus | GET /v2/payments/{id} | Full |
| verifyWebhook | HMAC-SHA256 on X-Square-HMAC-SHA256-Event-Signature | Full |
| mapStatus | APPROVED→authorized, COMPLETED→captured, CANCELED→cancelled | Full |

## DataSyncAdapter Mapping (Commerce)
| Entity | Square API | Direction | Feasibility |
|--------|-----------|-----------|-------------|
| Products | Catalog API (CatalogItem + Variation) | Bidirectional | High |
| Categories | Catalog API (CatalogCategory) | Bidirectional | High (flat) |
| Inventory | Inventory API (per-location) | Bidirectional | Medium |
| Orders | Orders API (search with updated_at) | Import + export | High |
| Customers | Customers API (search) | Bidirectional | High |

## Catalog Version-Based Delta
Unique: `GET /v2/catalog/info` returns `catalog_version` (monotonic integer). Only sync if version > last stored cursor. More efficient than timestamp-based.

## Webhook Events — Full Coverage
- `payment.created/updated/completed`, `refund.created/updated`
- `order.created/updated`
- `catalog.version.updated`
- `inventory.count.updated`
- `customer.created/updated`
- Delivery: < 2s latency. HTTP POST + JSON + HMAC-SHA256

## Bundle Structure
```
sync_square/
├── integration.ts              # Bundle: gateway + 5 data sync
├── lib/
│   ├── client.ts
│   ├── status-map.ts
│   ├── adapters/
│   │   ├── catalog.ts          # DataSyncAdapter
│   │   ├── inventory.ts        # DataSyncAdapter (multi-location)
│   │   ├── orders.ts           # DataSyncAdapter
│   │   └── customers.ts        # DataSyncAdapter
│   ├── gateway/
│   │   └── adapter.ts          # GatewayAdapter
│   └── webhooks/
│       └── adapter.ts          # WebhookEndpointAdapter
├── subscribers/
│   ├── order-status-changed.ts
│   └── inventory-adjusted.ts
└── workers/
    └── outbound-push.ts
```

## Credential Configuration
```typescript
credentials: {
  fields: [
    { key: 'clientId', label: 'Application ID', type: 'text', required: true },
    { key: 'clientSecret', label: 'Application Secret', type: 'secret', required: true },
    { key: 'oauthTokens', label: 'Square Account', type: 'oauth', oauth: {
      provider: 'square', usePkce: true, refreshStrategy: 'background',
      authorizationUrl: 'https://connect.squareup.com/oauth2/authorize',
      tokenUrl: 'https://connect.squareup.com/oauth2/token',
      scopes: ['MERCHANT_PROFILE_READ', 'PAYMENTS_READ', 'PAYMENTS_WRITE',
               'ORDERS_READ', 'ORDERS_WRITE', 'ITEMS_READ', 'ITEMS_WRITE',
               'INVENTORY_READ', 'INVENTORY_WRITE', 'CUSTOMERS_READ', 'CUSTOMERS_WRITE'],
    }},
    { key: 'environment', label: 'Environment', type: 'select', options: [
      { value: 'production', label: 'Production' },
      { value: 'sandbox', label: 'Sandbox' },
    ]},
    { key: 'webhookSignatureKey', label: 'Webhook Signature Key', type: 'secret' },
    { key: 'primaryLocationId', label: 'Primary Location ID', type: 'text' },
  ],
}
```

## Feasibility Ratings
| Capability | Rating (1-5) | Notes |
|-----------|-------------|-------|
| Payment gateway | 5 / Excellent | GatewayAdapter perfect fit |
| Payment webhooks | 5 / Excellent | HMAC-SHA256, < 2s |
| Catalog import | 5 / Excellent | Cursor + version delta |
| Catalog export | 4 / Good | Batch upsert; modifiers skipped |
| Inventory sync | 4 / Good | Per-location; webhook real-time |
| Order import | 5 / Excellent | Search with date filter |
| Customer sync | 5 / Excellent | Bidirectional, cursor |
| Real-time sync | 5 / Excellent | Webhooks cover all domains |

## Novel Pattern: Gateway + DataSync in One Bundle
Square is the first platform spanning both payment and data sync hubs in one bundle:
- Shared OAuth credentials across both hub types
- Separate `integrationId` per hub for SyncExternalIdMapping isolation
- Demonstrates framework's bundle architecture flexibility
- Reference pattern for future multi-hub integrations

## Key Challenges
1. **Dual hub registration**: `setup.ts` registers in both hubs. SyncExternalIdMapping separated by integrationId
2. **Omnichannel orders**: POS vs online vs manual. Filter by fulfillment type or import with origin metadata
3. **Location-scoped inventory**: Sum across locations or use primaryLocationId
4. **Modifier groups**: POS add-ons have no OM equivalent. Skip with debug log
5. **Token non-expiry**: Square tokens don't expire. Refresh worker handles null expiresAt
6. **Flat categories**: Single-level only

## Gaps Summary
- Modifier groups no OM equivalent
- POS orders need filtering
- Flat categories
- Estimated effort: **5-6 weeks** (payment + data sync)
