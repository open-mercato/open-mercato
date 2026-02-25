# Integration Feasibility Analyses

Per-integration feasibility analyses evaluating how well external services map to Open Mercato's spec-defined adapter contracts. Each analysis identifies what works, what's missing, what's difficult, and provides effort estimates.

## Data Sync Integrations

| # | Integration | Related Spec | Verdict | Link |
|---|-------------|-------------|---------|------|
| ANALYSIS-002 | OroCRM | [SPEC-045b](../SPEC-045b-data-sync-hub.md) | Feasible with constraints (~70-75% coverage). Import-first, 5-7 weeks. No webhooks, rate limits, complex customer model. | [View](./ANALYSIS-002-orocrm-integration.md) |
| ANALYSIS-003 | Amazon.de (SP-API) | [SPEC-045b](../SPEC-045b-data-sync-hub.md) | Feasible with significant effort (~70% coverage). Auth complexity (LWA+SigV4+RDT), no inventory module, AWS-only notifications. | [View](./ANALYSIS-003-amazon-de-integration.md) |
| ANALYSIS-004 | BambooHR | [SPEC-045b](../SPEC-045b-data-sync-hub.md) | HIGH feasibility (~70-80% coverage). Strong API for employees, time off, benefits, ATS, goals. Prerequisite: HR module. | [View](./ANALYSIS-004-bamboohr-integration.md) |
| ANALYSIS-005 | Shopify | [SPEC-045b](../SPEC-045b-data-sync-hub.md) | GO (~80% coverage). Products, customers, orders map cleanly. Critical gap: no inventory module (multi-location). | [View](./ANALYSIS-005-2026-02-24-shopify-integration.md) |
| ANALYSIS-006 | Allegro.pl | [SPEC-045b](../SPEC-045b-data-sync-hub.md), [SPEC-045c](../SPEC-045c-payment-shipping-hubs.md) | Feasible (~80% coverage, 8.5/10). OAuth, orders, shipping map cleanly. No webhooks (polling only). 11-15 weeks. | [View](./ANALYSIS-006-allegro-pl-integration.md) |
| ANALYSIS-007 | Akeneo PIM | [SPEC-045b](../SPEC-045b-data-sync-hub.md) | Highly feasible (~85% coverage). Delta sync, bulk ops align with DataSyncAdapter. Attribute model mismatch challenge. 5-7 weeks. | [View](./ANALYSIS-007-akeneo-pim-integration.md) |
| ANALYSIS-008 | HubSpot CRM | [SPEC-045b](../SPEC-045b-data-sync-hub.md) | HIGH feasibility (~80-85% coverage). Bidirectional sync for Contacts, Companies, Deals, Activities. ~8 weeks. | [View](./ANALYSIS-008-hubspot-crm-integration.md) |
| ANALYSIS-009 | Magento 2 / Adobe Commerce | [SPEC-045b](../SPEC-045b-data-sync-hub.md) | Feasible with caveats (~85% entity coverage). No inventory module (MSI blocked), EAV complexity, no webhooks in CE. 11-16 weeks. | [View](./ANALYSIS-009-magento2-integration.md) |
| ANALYSIS-012 | eBay | [SPEC-045b](../SPEC-045b-data-sync-hub.md) | Good feasibility. Modern REST APIs map well, item aspects add export complexity. 5-6 weeks. | [View](./ANALYSIS-012-ebay-integration.md) |
| ANALYSIS-015 | MedusaJS | [SPEC-045b](../SPEC-045b-data-sync-hub.md) | Full feasibility — cleanest API. Reference implementation per SPEC-045b. 3-4 weeks. | [View](./ANALYSIS-015-medusajs-integration.md) |
| ANALYSIS-017 | Square (Commerce) | [SPEC-045b](../SPEC-045b-data-sync-hub.md), [SPEC-044](../SPEC-044-2026-02-24-payment-gateway-integrations.md) | Full feasibility — dual hub (payment + data sync). Best-designed marketplace API. 5-6 weeks. | [View](./ANALYSIS-017-square-integration.md) |

## Payment Gateway Integrations

| # | Integration | Related Spec | Verdict | Link |
|---|-------------|-------------|---------|------|
| ANALYSIS-010 | Autopay | [SPEC-044](../SPEC-044-2026-02-24-payment-gateway-integrations.md) | Partial — functional for Polish B2C, no TypeScript SDK, Polish-only docs. 3-4 weeks. | [View](./ANALYSIS-010-autopay-integration.md) |
| ANALYSIS-016 | PayU | [SPEC-044](../SPEC-044-2026-02-24-payment-gateway-integrations.md) | Full for Poland/CEE. REST API v2.1 with OAuth 2.0, multi-currency, BLIK. 3-4 weeks. | [View](./ANALYSIS-016-payu-integration.md) |
| ANALYSIS-018 | Stripe | [SPEC-044](../SPEC-044-2026-02-24-payment-gateway-integrations.md) | Full — best API design, reference gateway implementation. 2-3 weeks. | [View](./ANALYSIS-018-stripe-integration.md) |
| ANALYSIS-044 | Przelewy24 | [SPEC-044](../SPEC-044-2026-02-24-payment-gateway-integrations.md) | Feasible (~70% clean fit, 30% no-op stubs). 2-3 days. | [View](./ANALYSIS-044-przelewy24-integration-feasibility.md) |

## Communication & Notification Integrations

| # | Integration | Related Spec | Verdict | Link |
|---|-------------|-------------|---------|------|
| ANALYSIS-001 | Slack | [SPEC-045d](../SPEC-045d-communication-notification-hubs.md) | Partial — core notifications ready; interactive features need new patterns. 2-3 weeks (notify), 4-5 weeks (bidirectional). | [View](./ANALYSIS-001-slack-integration-feasibility.md) |
| ANALYSIS-011 | Discord | [SPEC-045d](../SPEC-045d-communication-notification-hubs.md) | Full for notifications (webhooks), infeasible for bidirectional (Gateway WebSocket). 1-2 weeks. | [View](./ANALYSIS-011-discord-integration.md) |
| ANALYSIS-013 | Gmail | [SPEC-045d](../SPEC-045d-communication-notification-hubs.md) | Full for send-only, partial for bidirectional (requires GCP Pub/Sub). 2-3 weeks (send), 6-8 weeks (bidirectional). | [View](./ANALYSIS-013-gmail-integration.md) |
| ANALYSIS-045d | WhatsApp | [SPEC-045d](../SPEC-045d-communication-notification-hubs.md) | Partial (~60% covered). Template management, conversation windows, and consent tracking are critical gaps. | [View](./ANALYSIS-045d-whatsapp-integration.md) |

## Storage & Productivity Integrations

| # | Integration | Related Spec | Verdict | Link |
|---|-------------|-------------|---------|------|
| ANALYSIS-014 | Google Docs / Drive / Sheets | [SPEC-045e](../SPEC-045e-storage-webhook-hubs.md), [SPEC-045g](../SPEC-045g-google-workspace.md) | Full for Sheets (already specced), Medium for Drive (no signed URLs), Low for Docs generation. | [View](./ANALYSIS-014-google-workspace-integration.md) |
