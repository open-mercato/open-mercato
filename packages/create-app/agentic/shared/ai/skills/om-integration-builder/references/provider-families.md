# Provider Families

Load this reference to choose provider contracts.

- **Email:** tenant or per-user credential scope; mailbox/send adapters; connection/health; message threading/dedup; inbound webhook/poll convergence.
- **Shipping:** services/rates/labels/tracking; address/package validation; idempotent fulfillment transitions; signed status callbacks.
- **Payment:** payment/session/refund adapter; durable idempotency; money/currency exactness; signed webhook reconciliation; concurrency-safe status machine.
- **Data sync:** `DataSyncAdapter`; entity mappings/presets; external IDs; streaming batches/cursors; overlap, progress, cancellation, reconciliation.
- **Webhooks:** inbound verification/replay; outbound Standard Webhooks signing; queued deliveries, retries, logs, status.
- **Import/export:** streaming format adapter; mapping/validation; formula and archive safety; row errors; progress/artifact cleanup.
- **Storage/media:** scoped keys, signed access, metadata, encryption/retention, cleanup.

Combine branches only when the provider genuinely owns them. Keep generic orchestration in the installed host services.
