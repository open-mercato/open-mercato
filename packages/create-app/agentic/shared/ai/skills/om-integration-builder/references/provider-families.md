# Provider Families

Load this reference to choose provider contracts.

- **Transactional email:** tenant credentials; `IntegrationDefinition`; DI sender and health services; bounded retry/redaction; activation. No generic installed transactional-email adapter exists, so do not invent one.
- **Mailbox/email channel:** installed `communication_channels` hub; `ChannelAdapter`; `integration.ts` with `hub: 'communication_channels'`; DI + setup adapter/health registration; per-user credentials; threading/dedup; webhook/poll convergence. Follow installed `channel_gmail`/`channel_imap` facts and contracts.
- **Shipping:** installed `ShippingAdapter` plus `registerShippingAdapter`; services/rates/labels/tracking; address/package validation; idempotent fulfillment transitions; signed status callbacks. Keep host domain state provider-neutral (`provider-neutral-domain`); the carrier module is optional, so preserve a safe absent-provider path (`optional-provider`).
- **Payment:** installed `GatewayAdapter` plus `registerGatewayAdapter`, `registerWebhookHandler`, and `registerPaymentGatewayDescriptor`; register `verifyWebhook` so the host can reach it; durable idempotency; money/currency exactness; signed webhook reconciliation; concurrency-safe status machine.
- **Data sync:** `DataSyncAdapter`; entity mappings/presets; external IDs; streaming batches/cursors; overlap, progress, cancellation, reconciliation.
- **Webhooks:** inbound verification/replay; outbound Standard Webhooks signing; queued deliveries, retries, logs, status.
- **Import/export:** streaming format adapter; mapping/validation; formula and archive safety; row errors; progress/artifact cleanup.
- **Storage/media:** authorize object/record access (`artifact-authorization`); use scoped keys, signed access, encrypted metadata (`encrypted-storage`), retention, and lifecycle cleanup (`cleanup`).

Combine branches only when the provider genuinely owns them. Keep generic orchestration in the installed host services.
