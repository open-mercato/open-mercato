# Integration Feasibility Analysis — Allegro

## Overview
- Allegro is the dominant marketplace in Poland and CEE
- REST API with OAuth 2.0 + PKCE
- Hub: `data_sync` (DataSyncAdapter)
- Bundle ID: `sync_allegro`
- Overall Feasibility: **Partial** — strong for orders/inventory, challenging for product export

## API Analysis
- REST API: `/sale/offers`, `/order/checkout-forms`, `/sale/offer-events`, `/stock-management/stock`
- Auth: OAuth 2.0 authorization code with PKCE — direct fit for SPEC-045a §8
- Rate limits: ~9000 req/min across all endpoints. Per-user/per-app limits
- Pagination: Cursor-based (`offset` or event `from` parameter with monotonic IDs)
- Delta: Event stream (`/sale/offer-events`, `/order/events`) with monotonic event IDs. Orders: `updatedAt.gte`
- Sandbox: `allegroapi.io` (separate environment)

## Data Model Mapping
| Allegro Concept | Open Mercato Equivalent | Notes |
|----------------|------------------------|-------|
| Offer | catalog.product listing | Seller-created (no shared catalog) |
| Sale.offer | catalog.product + price | Title, description, price, stock, category, params |
| Checkout-form (order) | sales.order | Buyer, delivery, payment info |
| Stock | Multi-warehouse inventory | Per-warehouse via stock-management API |
| Buyer | customers.person | From checkout-form |
| Category Parameters | No direct equivalent | Category-specific required attributes |

## Category Parameters — Biggest Challenge
Allegro requires **category-specific parameters** for every listing:
- Required parameters (Brand, Model for electronics)
- Dictionary parameters (predefined value lists)
- Range parameters (weight, dimensions)
- Discoverable via `GET /sale/categories/{categoryId}/parameters`

Product export needs field mapping widget + parameter validation.

## Real-Time Support
- **No HTTP webhooks** — event polling model
- Event streams: `/sale/offer-events`, `/order/events` with `from` parameter
- Poll at regular intervals (every 60 seconds)
- Events: OFFER_CREATED, OFFER_CHANGED, OFFER_STOCK_CHANGED, ORDER_CREATED

## Bundle Structure
```
sync_allegro/
├── integration.ts
├── lib/
│   ├── client.ts               # OAuth 2.0 + PKCE
│   ├── status-map.ts
│   ├── category-params.ts      # Parameter fetcher + daily TTL cache
│   ├── adapters/
│   │   ├── offers.ts           # DataSyncAdapter (bidirectional)
│   │   ├── orders.ts           # DataSyncAdapter (import + fulfillment export)
│   │   ├── inventory.ts        # DataSyncAdapter (multi-warehouse)
│   │   ├── customers.ts        # DataSyncAdapter (import from orders)
│   │   └── events.ts           # Event stream poller
│   └── transforms.ts
├── widgets/injection/
│   └── category-param-mapping/
├── setup.ts
└── i18n/
```

## Credential Configuration
```typescript
credentials: {
  fields: [
    { key: 'clientId', label: 'App Client ID', type: 'text', required: true },
    { key: 'clientSecret', label: 'App Client Secret', type: 'secret', required: true },
    { key: 'oauthTokens', label: 'Allegro Account', type: 'oauth', oauth: {
      provider: 'allegro', usePkce: true, refreshStrategy: 'background',
      authorizationUrl: 'https://allegro.pl/auth/oauth/authorize',
      tokenUrl: 'https://allegro.pl/auth/oauth/token',
    }},
    { key: 'environment', label: 'Environment', type: 'select', options: [
      { value: 'production', label: 'Production (allegro.pl)' },
      { value: 'sandbox', label: 'Sandbox (allegroapi.io)' },
    ]},
  ],
}
```

## Feasibility Ratings
| Capability | Rating (1-5) | Notes |
|-----------|-------------|-------|
| Order import | 5 / Excellent | Clean API, delta via updatedAt |
| Order export | 3 / Moderate | Fulfillment/shipping status |
| Product/offer import | 4 / Good | Event stream for changes |
| Product/offer export | 2 / Difficult | Category parameter validation |
| Inventory sync | 4 / Good | Stock management API |
| Customer import | 4 / Good | Buyer data from orders |
| Real-time sync | 3 / Moderate | Polling-based (no HTTP webhooks) |
| Pricing sync | 4 / Good | Price in offer data |

## Key Challenges
1. **Category parameter complexity**: Required per category. Shared `marketplace-category-params` utility recommended
2. **No HTTP webhooks**: Polling only. 60-second latency
3. **Offer-centric model**: No shared catalog. Each seller creates own listing
4. **Polish market specificity**: Polish docs, PLN pricing, consumer protection rules
5. **Multi-account**: Some sellers manage multiple accounts

## Gaps Summary
- No HTTP webhook support
- Category parameter widget needed for export
- Event polling adds latency
- Estimated effort: **4-5 weeks**
