# Integration Feasibility Analysis — Akeneo PIM

## Overview
- Akeneo is a Product Information Management system (PHP/Symfony)
- REST API with cursor-based pagination
- Hub: `data_sync` (DataSyncAdapter)
- Bundle ID: `sync_akeneo`
- Overall Feasibility: **Partial** — high effort due to attribute system complexity, CE/EE split

## API Analysis
- REST API: `/api/rest/v1/products`, `/api/rest/v1/categories`, `/api/rest/v1/families`, `/api/rest/v1/attributes`
- Auth: OAuth 2.0 client credentials grant — compatible with SPEC-045a
- Pagination: Cursor-based via `search_after` — maps perfectly to DataSyncAdapter cursor
- Delta: `updated` timestamp filter. Works cleanly
- Rate limits: ~100 requests per 10 seconds per connection
- Media files: Separate endpoint `/api/rest/v1/media-files/{code}/download`

## Data Model Mapping
| Akeneo Concept | Open Mercato Equivalent | Notes |
|---------------|------------------------|-------|
| Product (attribute-based) | catalog.product | 15+ attribute types |
| Family | Attribute set template | Defines which attributes a product uses |
| Category (tree, multiple trees) | catalog.category | Hierarchical, multiple trees |
| Channel | Export context | Defines required attributes/locales for completeness |
| Locale | i18n dimension | Products store values per locale natively |
| Product Model (parent) | catalog.product (configurable) | Variant axes differentiate children |

## Webhook Support
- **CE (Community Edition): No Events API. Polling only**
- **EE (Enterprise Edition): Events API** for product create/update/delete
- EE Events API uses bearer token on outbound delivery
- CE/EE split is architecturally significant for real-time sync

## Feasibility Ratings
| Capability | Rating (1-5) | Notes |
|-----------|-------------|-------|
| Product import | 4 / Good | Cursor pagination excellent; attribute resolution complex |
| Product export | 3 / Moderate | Must sync families/attributes before products |
| Category sync | 4 / Good | Tree structure, multiple trees |
| Family/attribute sync | 3 / Moderate | Must sync before products |
| Media/asset sync | 3 / Moderate | Requires storage_providers hub |
| Channel-scoped sync | 3 / Moderate | Filter by channel for exports |
| Real-time sync (EE) | 4 / Good | Events API works well |
| Real-time sync (CE) | 1 / Infeasible | No webhook support |

## Key Challenges
1. **Attribute system complexity**: 15+ types, channel + locale scoping. Dedicated `attribute-mapper.ts` required
2. **CE vs EE split**: Events API is EE-only. CE is polling-only
3. **Media file handling**: Requires storage_providers hub dependency
4. **Attribute family prerequisite**: Must sync families/attributes before products
5. **Reference entities (EE)**: Enterprise-only feature, adapter must handle gracefully

## Gaps Summary
- CE has no real-time webhook support
- Attribute mapper is significant development effort
- Media sync requires storage_providers hub
- Estimated effort: **5-7 weeks**
