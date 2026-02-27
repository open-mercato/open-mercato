# Integration Feasibility Analysis — eBay

## Overview
- eBay is a global online marketplace
- Modern REST APIs (Inventory, Fulfillment, Account) + legacy SOAP Trading API
- Hub: `data_sync` (DataSyncAdapter)
- Bundle ID: `sync_ebay`
- Overall Feasibility: **Good** — modern APIs map well, item aspects add export complexity

## API Analysis
- REST APIs: Inventory API, Fulfillment API, Account API (target modern)
- Legacy: Trading API (SOAP, deprecated — avoid)
- Auth: OAuth 2.0 authorization code (no PKCE). Compatible with SPEC-045a §8
- Rate limits: **5,000 requests/user/day** (daily quota). Batch up to 25 items/call
- Pagination: Cursor via `after` parameter with `next` link. `total` provided
- Delta: `modifiedDate` filter on inventory; date range on fulfillment
- Sandbox: Fully functional at `api.sandbox.ebay.com`

## Data Model Mapping
| eBay Concept | Open Mercato Equivalent | Notes |
|-------------|------------------------|-------|
| InventoryItem (by SKU) | catalog.product | Title, description, images, condition |
| Offer | Listing configuration | SEPARATE from InventoryItem |
| InventoryItemGroup | catalog.product with variants | Groups variant SKUs |
| Order | sales.order | Via Fulfillment API |
| Buyer | customers.person | May be anonymized |
| ShippingFulfillment | sales.shipment | Tracking upload |
| ItemAspects | No equivalent | Category-specific required attributes |

## Key Model: InventoryItem + Offer Split
eBay separates product data from listing config. Must create BOTH:
1. InventoryItem (product data by SKU)
2. Offer (price, quantity, category, policies)
3. Publish Offer to make live

Dual `SyncExternalIdMapping` required: `product ↔ inventoryItemId` AND `product ↔ offerId`.

## Real-Time Support
- **Platform Notifications (legacy)**: HTTP POST, XML, EndToEndKey verification
- **Commerce Notification API (modern)**: JSON HTTP POST, limited coverage
- **Recommended**: Poll Fulfillment API every 5 min (eBay guidance) + optional notifications

## Bundle Structure
```
sync_ebay/
├── integration.ts
├── lib/
│   ├── client.ts
│   ├── status-map.ts
│   ├── aspects-cache.ts        # Daily TTL cache
│   ├── adapters/
│   │   ├── inventory-items.ts  # DataSyncAdapter
│   │   ├── orders.ts           # DataSyncAdapter
│   │   └── customers.ts        # From order data
│   └── webhooks/
│       └── adapter.ts          # Platform Notifications XML
└── workers/
    ├── order-poller.ts
    └── outbound-push.ts
```

## Credential Configuration
```typescript
credentials: {
  fields: [
    { key: 'clientId', label: 'App ID', type: 'text', required: true },
    { key: 'clientSecret', label: 'Cert ID', type: 'secret', required: true },
    { key: 'oauthTokens', label: 'eBay Account', type: 'oauth', oauth: {
      provider: 'ebay', usePkce: false, refreshStrategy: 'background',
      authorizationUrl: 'https://auth.ebay.com/oauth2/authorize',
      tokenUrl: 'https://api.ebay.com/identity/v1/oauth2/token',
      scopes: ['sell.inventory', 'sell.fulfillment', 'sell.account'],
    }},
    { key: 'marketplace', label: 'Marketplace', type: 'select', options: [
      { value: 'EBAY_US', label: 'eBay US' },
      { value: 'EBAY_DE', label: 'eBay Germany' },
      { value: 'EBAY_PL', label: 'eBay Poland' },
    ]},
  ],
}
```

## Feasibility Ratings
| Capability | Rating (1-5) | Notes |
|-----------|-------------|-------|
| Product import | 4 / Good | Clean endpoints; SKU match; delta |
| Product export | 3 / Moderate | Item + Offer split; aspects validation |
| Order import | 5 / Excellent | Fulfillment API, cursor pagination |
| Fulfillment export | 5 / Excellent | Tracking upload straightforward |
| Pricing | 4 / Good | Price on Offer |
| Customer import | 4 / Good | From orders; email may be anonymized |
| Real-time sync | 3 / Moderate | 5-min polling; XML notifications |
| Multi-marketplace | 3 / Moderate | Marketplace header per call |

## Key Challenges
1. **InventoryItem + Offer split**: Dual entity management + dual SyncExternalIdMapping
2. **Daily rate quota (5K/day)**: Full 5K product pass exhausts quota. Use batch endpoints aggressively
3. **Item Aspects**: Category-specific required attributes. Missing = listing rejection. Field mapping widget essential
4. **Platform Notifications XML**: Non-standard verification (EndToEndKey, not HMAC-SHA256)
5. **Offer lifecycle**: Stock depletion ends listing. Re-publish on replenishment
6. **Fixed Price only**: Inventory API doesn't support auctions
7. **Business policies prerequisite**: Must pre-exist in eBay

## Gaps Summary
- Dual entity management complexity
- Daily rate quota management
- Item aspects widget for export
- XML notification parsing
- Estimated effort: **5-6 weeks**
