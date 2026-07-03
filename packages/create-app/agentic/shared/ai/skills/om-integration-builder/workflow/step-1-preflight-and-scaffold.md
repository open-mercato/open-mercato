# Step 1 — Pre-flight, category, scaffold, and registration

Read `../references/standalone-layout.md` first — it decides where the module goes and how it builds.

## 1.1 Pre-flight

Before writing any code:

1. **Identify the external service** (Stripe, DHL, SendGrid, S3, etc.).
2. **Read the hub's adapter contract** — load `../references/adapter-contracts.md` for the full type definitions.
3. **Read the reference implementation** — `gateway-stripe` is the canonical example. It is **not on disk** in a standalone app; read it on GitHub (`open-mercato/open-mercato` → `packages/gateway-stripe/`) or at <https://docs.open-mercato.dev>.
4. **Check existing local integrations** — `ls src/modules/` for any `gateway_*`, `carrier_*`, `sync_*`, `channel_*`, `storage_*` modules already present.
5. **Read the external service's API docs** — understand auth, endpoints, webhooks, status models.
6. **Check for an SDK** — prefer official SDKs over raw HTTP (`stripe`, `@aws-sdk/client-s3`, etc.); add it as a dependency in the app `package.json`.

## 1.2 Determine the hub category

Match the external service to ONE hub category:

| Category | Hub Module | Adapter Contract | Module prefix | Example module id |
|----------|-----------|-----------------|----------------|-------------------|
| `payment` | `payment_gateways` | `GatewayAdapter` | `gateway_` | `gateway_stripe`, `gateway_paypal` |
| `shipping` | `shipping_carriers` | `ShippingAdapter` | `carrier_` | `carrier_dhl`, `carrier_inpost` |
| `data_sync` | `data_sync` | `DataSyncAdapter` | `sync_` | `sync_medusa`, `sync_shopify` |
| `communication` | `communication_channels` | `ChannelAdapter` | `channel_` | `channel_whatsapp`, `channel_twilio` |
| `storage` | `storage_hubs` | `StorageAdapter` | `storage_` | `storage_s3`, `storage_gcs` |
| `webhook` | `webhook_endpoints` | `WebhookEndpointAdapter` | `webhook_` | `webhook_zapier` |

**Module id**: `<prefix>_<provider>` in snake_case (e.g. `gateway_stripe`).

If the service spans multiple categories (e.g. MedusaJS does products + customers + orders),
use an **Integration Bundle** — see `step-2-core-files.md` § Bundle.

## 1.3 Scaffold the module tree

Create the module under `src/modules/<module_id>/`:

```
src/modules/<module_id>/
├── index.ts                          # module metadata
├── integration.ts                    # Integration Marketplace registration (CRITICAL)
├── acl.ts                            # RBAC features
├── setup.ts                          # tenant init, default role features
├── di.ts                             # DI registrar (Awilix)
├── data/
│   └── validators.ts                 # Zod schemas
├── lib/
│   ├── client.ts                     # SDK/HTTP client factory
│   ├── shared.ts                     # shared helpers, status maps
│   ├── health.ts                     # health check implementation
│   ├── status-map.ts                 # provider status → unified status
│   ├── webhook-handler.ts            # webhook signature verification
│   └── adapters/
│       └── v<version>.ts             # versioned adapter implementation
├── workers/
│   └── webhook-processor.ts          # async webhook processing worker
├── widgets/
│   ├── injection-table.ts            # widget-to-slot mappings
│   └── injection/<widget-name>/
│       ├── widget.ts                 # widget metadata
│       └── widget.client.tsx         # React component
├── i18n/
│   ├── en.ts                         # English translations (code)
│   ├── en.json                       # English translations (data)
│   └── ...                           # other locales
└── __tests__/
    └── *.test.ts
```

## 1.4 Register the module

Register the provider in the app-root registry `src/modules.ts` (see
`../references/standalone-layout.md` § 2). If the module is auto-discovered under
`src/modules/`, run the generator to wire it; otherwise add the registry entry explicitly.

Then run the generators so `integration.ts`, widgets, and workers are discovered:

```bash
yarn generate                 # discover integration.ts, widgets, workers; update generated files
```

Proceed to `step-2-core-files.md`.
