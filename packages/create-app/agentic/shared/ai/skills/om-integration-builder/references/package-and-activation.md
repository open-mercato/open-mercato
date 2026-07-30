# Package and Activation

Load this reference to choose provider ownership before creating files.

1. **App-specific (default):** create `src/modules/<provider>/`, add `index.ts`, `integration.ts`, `di.ts`, the installed typed host adapter when one exists, `acl.ts`/`setup.ts` when features or bootstrap are needed, validators, transport services, and health; activate it as `{ id: '<provider>', from: '@app' }` in `src/modules.ts` and run generation/typecheck/focused tests in this app. A detached client seam alone is never a production registration.
2. **Reusable (explicit user requirement):** create a separate publishable package/repository with compatible peer/runtime dependencies, public exports, build/prepack, and compiled discovery output. Add its packed artifact to the standalone app as a dependency and activate it in `src/modules.ts`.
3. Do not create `packages/*` or add workspace configuration inside a standalone app unless the user explicitly approves that architecture change. Ask before adding the reusable provider's production dependency.
4. Persist credentials/state/logs/mappings through generic integration/data-sync services; do not duplicate host tables.
5. If env bootstrap is needed, implement a provider-prefixed preset inside provider `setup.ts` and an idempotent rerun CLI.
6. Test missing provider configuration as `unconfigured`/degraded, not a crash or secret leak.

An app-owned `integration.ts` may export singular `integration`/`bundle` definitions or plural `integrations`/`bundles` arrays. Prefer the singular form for one provider and keep any default export aligned with it; generation normalizes both forms. Run `yarn generate` and `yarn typecheck` so the generated registry proves that exact export shape.

For payment providers, implement `GatewayAdapter`, register it with `registerGatewayAdapter`, make its verified webhook path reachable with `registerWebhookHandler`, and publish UI capabilities with `registerPaymentGatewayDescriptor`. For shipping providers, implement `ShippingAdapter` and call `registerShippingAdapter`. Transactional email over SMTP has no equivalent installed generic adapter: register the app-owned sender and exact health service in DI instead. Mailbox providers use the separate installed `communication_channels` `ChannelAdapter` path described in `provider-families.md`.

On the reusable branch, record the supported host/framework version range and test package exports from a fresh standalone consumer. Do not impose packed-consumer work on the local-module branch.
