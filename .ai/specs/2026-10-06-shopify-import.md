# Shopify import

| Field | Value |
| --- | --- |
| Date | 2026-10-06 |
| Status | Partial — import slice |
| Issue | [#607](https://github.com/open-mercato/open-mercato/issues/607) |
| Related | [ANALYSIS-005](analysis/ANALYSIS-005-2026-02-24-shopify-integration.md), [SPEC-045b](implemented/SPEC-045b-data-sync-hub.md) |

## TLDR

`@open-mercato/sync-shopify` imports products, customers, and orders from the Shopify Admin GraphQL API into catalog, CRM, and sales. Inventory, metafields, webhooks, and export stay out of this slice.

## Overview

Issue #607 asks for catalog, price, inventory, customer, and order sync. The February 2026 analysis said products, customers, and orders already map onto Open Mercato, and that the missing piece was a connector package. This spec covers that connector's first import path.

## Problem Statement

Operators running a Shopify storefront have no way to pull products, customers, or orders into Open Mercato. The example module only registers a fake `sync_shopify` id so the external-id widget has something to render.

## Proposed Solution

One data-sync integration, `sync_shopify`, with a Dev Dashboard Client ID and client secret. The client exchanges those for a short-lived Admin API token and refreshes it before expiry. A run walks one entity type (`products`, `customers`, or `orders`) with Shopify cursor pagination. Each record is upserted by Shopify GID:

- products and variants land on `CatalogProduct` / `CatalogProductVariant`, with a regular price when the tenant has a non-promotion price kind
- customers go through `customers.people.create` / `customers.people.update`
- orders go through `sales.orders.create` once; a second run skips an order that already has an external-id mapping

The cursor is one run's page position, not a change log, so `persistsSharedCursor` is false. A finished run starts from the top next time. An interrupted run resumes from its own cursor.

## Architecture

```
packages/sync-shopify/src/modules/sync_shopify/
  integration.ts    marketplace registration
  di.ts             DataSyncAdapter + health check
  lib/client.ts     Admin GraphQL client, *.myshopify.com only
  lib/importer.ts   catalog writes and customer/order commands
  lib/adapter.ts    streamImport
  lib/preset.ts     OM_INTEGRATION_SHOPIFY_* env bootstrap
```

Credentials: `shopDomain`, `clientId`, `clientSecret`, optional `apiVersion` (default `2026-07`). A stored `accessToken` is still accepted when the client credentials are absent, so an older saved row keeps working until it is replaced.

Env preset, applied from `setup.ts` and `yarn mercato sync_shopify configure-from-env`:

- `OM_INTEGRATION_SHOPIFY_SHOP_DOMAIN`
- `OM_INTEGRATION_SHOPIFY_CLIENT_ID`
- `OM_INTEGRATION_SHOPIFY_CLIENT_SECRET`
- `OM_INTEGRATION_SHOPIFY_API_VERSION` (optional)
- `OM_INTEGRATION_SHOPIFY_FORCE` (optional overwrite)

The app version needs `read_products`, `read_customers`, and `read_orders`, and the app must be installed on the shop. The client credentials grant only works when the app and the shop belong to the same Dev Dashboard organization. The issued token lasts 24 hours; the process cache refreshes it one minute before expiry.

## Data Models

No new tables. External ids are stored on the existing sync mapping:

| Shopify GID | Internal type |
| --- | --- |
| Product | `catalog_product` |
| ProductVariant | `catalog_product_variant` |
| Customer | `customer_person` (customer entity id) |
| Order | `sales_order` |

Shopify prices are stored as both net and gross on the catalog price row because the shop payload does not say whether the amount includes tax. Order lines are imported as gross.

## API Contracts

No new HTTP routes. Runs use the existing `POST /api/data_sync/run` with `providerKey: shopify`.

## Risks & Impact Review

| Risk | Severity | Area | Mitigation | Residual |
| --- | --- | --- | --- | --- |
| A resumed full walk re-applies every product and customer | Medium | data sync | Upserts are keyed by GID. Orders that already mapped are skipped | Product edits in Open Mercato are overwritten on the next product run |
| Catalog price treats the Shopify amount as both net and gross | Medium | catalog | Documented. Tax-accurate prices need a later tax mapping | Prices can disagree with a tax-excluded price kind |
| Order import does not update an existing order | Medium | sales | Skip is explicit in the item payload (`already_imported`) | Later Shopify edits (refunds, edits) are not pulled |
| Orders imported before their products have lines without a catalog link | Low | sales | The line still carries the title, quantity, and price | Re-running orders does not backfill the link |
| Client secret can mint a token that reads the whole shop | High | credentials | The secret is a secret credential. Issued tokens stay in process memory. The client accepts only `*.myshopify.com` and strips the secret from token-endpoint errors | A leaked secret is a full read of products, customers, and orders until it is rotated |

## Out of scope

Inventory and locations, collections, metafields, webhooks, export back to Shopify, and installing the connector on a shop outside the Dev Dashboard organization. Those remain on #607.

## Follow-ups

This pull request stops at the import slice above. Later slices, in the order they unblock #607:

1. Inventory quantities and locations, written through the existing WMS models.
2. Collections and product metafields.
3. Incremental updates. Webhooks so a later Shopify edit is not a full walk, and an order update instead of skipping an order that already mapped.
4. Export from Open Mercato back to Shopify.
5. OAuth install for a shop that is not in the same Dev Dashboard organization as the app. The client credentials grant cannot do that.

A Shopify App Store listing is not one of those slices. The grant in this package only works for a shop in the same organization, which matches a merchant who already runs Open Mercato and connects their own store. A public listing is a separate product: an authorization-code install, a protected-customer-data review because the import stores name, email, and phone, the mandatory privacy webhooks, and a Shopify review. It is worth doing only if merchants should discover and install Open Mercato from the Shopify App Store. Until that is the goal, the install path stays the Dev Dashboard app plus the credentials on this integration.

## Final Compliance Report

- Connector lives in its own workspace package and registers a `DataSyncAdapter`.
- Provider env bootstrap stays in the package (`setup.ts` + CLI), not in core.
- Batch cancellation returns before yielding the abandoned page.
- Tests cover the client, name/order mapping, pagination, and cancellation. They do not hit Shopify or the database.

## Changelog

- 2026-10-06 — Import slice for products, customers, and orders.
- 2026-10-06 — Credentials are a Dev Dashboard Client ID and client secret. The client exchanges them for a short-lived Admin API token.
- 2026-10-06 — Follow-ups recorded for inventory, metafields, webhooks, export, and OAuth. A Shopify App Store listing stays a later product decision, not the next slice.
