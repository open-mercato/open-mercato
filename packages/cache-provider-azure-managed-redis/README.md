# @open-mercato/cache-provider-azure-managed-redis

**Open Mercato Enterprise** cache provider (`open-mercato/azure-managed-redis`) for **Azure Managed Redis**, built on the shared RESP strategy in `@open-mercato/cache-redis-protocol` and the v1 provider API (`@open-mercato/cache/provider`). Server-only.

> **Commercial package.** Licensed under the [Open Mercato Enterprise license](LICENSE.md). It is `private` in the monorepo, is not part of the public npm publish set or the default app install, and ships only through the commercial distribution channel.
>
> **Support status: no profile is supported yet.** Every profile below is **unverified** until it passes the live gate against an authorized, non-production Azure Managed Redis instance (see [Supported matrix](#supported-matrix)). Container preflight is not live evidence.

## Install (commercial channel)

```bash
yarn add @open-mercato/cache-provider-azure-managed-redis   # from the Enterprise registry
```

Peer: `@open-mercato/cache` (>= 0.11.0). Runtime: `@open-mercato/cache-provider-managed-kit` (private, Enterprise-licensed: activation gate, credential refresh, managed TLS/connection helpers), `@open-mercato/cache-redis-protocol`, `zod`, `@azure/identity` 4.x (MIT). `@azure/identity` is imported lazily, only after the Enterprise gate passes and the cache is first created.

## Enterprise activation

The provider is inert unless **both** flags are true in every process that uses the cache (web server, workers, CLI maintenance such as `yarn generate` structural purge and `mercato configs cache structural`):

```bash
OM_ENABLE_ENTERPRISE_MODULES=true
OM_ENABLE_ENTERPRISE_MODULES_CACHE_PROVIDERS=true
```

With the gate closed, selection resolves to a stand-in that never reads your settings, never imports `@azure/identity` and never connects; the first cache operation fails with `CacheProviderError` code `unavailable` and an actionable message. There is **no fallback** to memory/local cache. The environment switch is only a runtime enable flag; entitlement is governed by your Enterprise agreement.

## Register and select

Add the registration to the app's `src/providers/cache.ts`, then run `yarn generate`. The package's `/registration` entry loads the adapter only when selected and enabled.

```ts
import { readFileSync } from 'node:fs'
import { azureManagedRedisCacheProviderRegistration } from '@open-mercato/cache-provider-azure-managed-redis/registration'

export const cacheProviders = [
  azureManagedRedisCacheProviderRegistration({
    settings: () => ({
      clusteringPolicy: 'non-clustered',
      host: process.env.CACHE_AZURE_REDIS_HOST, // <name>.<region>.redis.azure.net
      auth: {
        kind: 'entra',
        identity: 'managed-identity',
        clientId: process.env.CACHE_AZURE_REDIS_CLIENT_ID, // user-assigned identity, optional
      },
      tls: process.env.CACHE_AZURE_REDIS_CA_FILE ? { ca: readFileSync(process.env.CACHE_AZURE_REDIS_CA_FILE, 'utf8') } : {},
    }),
  }),
]
```

```bash
CACHE_PROVIDER=open-mercato/azure-managed-redis
CACHE_PROVIDER_NAMESPACE=prod-weu-1
```

`azureManagedRedisCacheProviderRegistration` is the package's only supported entry point: the package exports no ungated provider definition (no `provider` or default export). When the host resolves providers with an explicit env (`resolveCacheProvider(registrations, { env })`), pass the same object as `env` to the helper so the Enterprise gate reads it; otherwise the gate reads `process.env` when the cache is initialized.

The variable names are examples; the package reads no application env itself (Azure Identity reads its own standard `AZURE_*` variables).

## Settings

Strict zod schema (`settings` export); unknown keys are rejected; errors report field paths only.

| Key | Default | Notes |
|---|---|---|
| `clusteringPolicy` | — (required) | Only `"non-clustered"` is accepted |
| `host` | — (required) | Cache data-plane host name |
| `port` | `10000` | Azure Managed Redis TLS port |
| `auth.kind` | — (required) | Only `"entra"` |
| `auth.identity` | `default` | `default` (DefaultAzureCredential), `managed-identity`, `workload-identity`. No client secrets or access keys in settings |
| `auth.clientId` | — | GUID of a user-assigned managed identity / workload identity app |
| `auth.objectId` | from token `oid` | Principal object id used as the Redis username |
| `auth.reauthIntervalMs` | `600000` | Live re-AUTH cadence (60 s – 30 min) |
| `tls.ca` | system trust | PEM, only when the endpoint is not publicly trusted |
| `tls.servername` | `host` | Override for private endpoints; hostname verification is always on |
| `connectTimeoutMs` / `commandTimeoutMs` / `maxRetriesPerRequest` / `batchSize` / `maxValueBytes` | 5000 / 2000 / 1 / 500 / 8 MiB | Same bounds as the RESP library |

There is **no** `rejectUnauthorized`, plain-TCP or certificate-bypass option.

### Authentication behaviour

- Token scope `https://redis.azure.com/.default`; username = principal object id, password = access token.
- Tokens are cached until 5 minutes before expiry and shared by concurrent callers.
- Credentials are applied to the initial connection and every reconnect. Live connections re-run `AUTH` at most every `reauthIntervalMs` and always by the time the cached token reaches its refresh point (expiry minus 5 minutes), where a new token is fetched first, so they never outlive their token.
- Identity failures surface as `CacheProviderError('unavailable')` naming the identity source only; driver/SDK messages are kept as a non-enumerable cause and are never logged by the host.
- Reads always go to the primary; `healthcheck()` is a non-mutating `PING`; `close()` is idempotent; `redact()` hides identity ids and CA material.

## Supported matrix

| Profile id | Azure configuration | Status |
|---|---|---|
| `azure-nonclustered-entra-tls` (first profile) | Non-clustered policy · Microsoft Entra · TLS | **Unverified (blocked: no approved sandbox/credentials)** |

Container preflight (not live evidence) for the first profile: `redis:7.2` TLS-only with an ACL user whose password rotates through a fake token source standing in for Entra — v1 conformance kit incl. an independent process, live re-AUTH on rotation, reconnect with rotated credential after `CLIENT KILL`, denied credential, CA + hostname verification, non-mutating healthcheck, idempotent close, gate closed ⇒ zero connections, packed install. See `EVIDENCE.md` in the release record for totals.

### Unverified profiles (not in the schema)

- OSS clustering policy (discovery + slot routing) — needs a cluster client profile and live qualification.
- Enterprise clustering policy (proxy, narrower multi-key command set) — the tag-invalidation scripts must be proven on the proxy first.
- Access-key authentication (with rotation and reconnect).
- Active geo-replication / cross-region consistency.

## Limits

- One effective cache provider per deployment; switching service or layout requires a new `CACHE_PROVIDER_NAMESPACE`.
- Identity or network outages make the cache unavailable (no synthetic success, no local fallback).
- Failover may discard recent writes under the service's replication policy.

## Operations

See [RUNBOOK.md](RUNBOOK.md) for the protected live verification job, required access, evidence recording and rollback.
