# App Infrastructure Providers

Keep process-wide infrastructure registrations together in `src/providers/`. The Open Mercato monorepo uses `apps/mercato/src/providers/`. Standalone apps use `src/providers/` relative to their own `package.json`.

| Family | App registration | Shipped source |
|---|---|---|
| Cache | `src/providers/cache.ts` exports `cacheProviders`. Select an npm provider with `CACHE_PROVIDER`. | [Cache registry](../../src/providers/cache.ts) |
| Queue | The planned `src/providers/queue.ts` exports `queueProviders`. The design uses `QUEUE_STRATEGY`. | [Queue registration preview](../../src/providers/queue.example.ts) |
| KMS | The planned `src/providers/kms.ts` exports `kmsDrivers`. The design uses `OM_KMS_DRIVER`. | [KMS registration preview](../../src/providers/kms.example.ts) |

The `.example.ts` files show the convention while the queue and KMS host contracts are in development. Check the installed host before activating a preview.

## Registration and bootstrap

1. Install the provider's npm package as an app dependency. Keep adapter code, SDKs, settings validation, health and lifecycle in that package.
2. Register the provider in its typed family registry using explicit lazy npm loaders with literal import specifiers. Keep each family file server-only and side-effect-free. Read deployment settings inside the registration callback, after the host selects the provider.
3. Run `yarn generate` after adding, moving, or removing a registration file. Treat `.mercato/generated/` as read-only output.
4. Resolve selected registrations through early infrastructure bootstrap shared by the web app, workers, scheduler, and CLI. CLI commands that need only infrastructure can invoke that step directly. Keep stock selection behavior and reject an invalid explicit selection before connecting.

`src/modules.ts` activates business modules. Infrastructure registrations use their family file and the installed host contract. Do not scan installed packages or use an environment value as an import specifier.
