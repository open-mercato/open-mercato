# @open-mercato/cache-provider-google-memorystore

**Open Mercato Enterprise** cache provider (`open-mercato/google-memorystore`) for **Google Cloud Memorystore**, built on the shared RESP strategy in `@open-mercato/cache-redis-protocol` and the v1 provider API (`@open-mercato/cache/provider`). Server-only.

> **Commercial package.** Licensed under the [Open Mercato Enterprise license](LICENSE.md). It is `private` in the monorepo, is not part of the public npm publish set or the default app install, and ships only through the commercial distribution channel.
>
> **Support status: no profile is supported yet.** Every profile below is **unverified** until it passes the live gate against an authorized, non-production Memorystore instance (see [Supported matrix](#supported-matrix)). Container preflight is not live evidence.

## Install (commercial channel)

```bash
yarn add @open-mercato/cache-provider-google-memorystore   # from the Enterprise registry
```

Peer: `@open-mercato/cache` (>= 0.11.0). Runtime: `@open-mercato/cache-provider-managed-kit` (private, Enterprise-licensed: activation gate, credential refresh, managed TLS/connection helpers), `@open-mercato/cache-redis-protocol`, `zod`, `google-auth-library` 10.x (Apache-2.0), imported lazily only after the Enterprise gate passes and the cache is first created.

## Enterprise activation

Both flags must be true in every process that uses the cache (web, workers, CLI maintenance):

```bash
OM_ENABLE_ENTERPRISE_MODULES=true
OM_ENABLE_ENTERPRISE_MODULES_CACHE_PROVIDERS=true
```

With the gate closed, selection resolves to a stand-in that never reads settings, never loads `google-auth-library` and never connects; the first cache operation fails with `CacheProviderError` code `unavailable`. No local fallback. The switch is a runtime enable flag only.

## Register and select

```ts
import { readFileSync } from 'node:fs'
import { googleMemorystoreCacheProviderRegistration } from '@open-mercato/cache-provider-google-memorystore'

export const cacheProviders = [
  googleMemorystoreCacheProviderRegistration({
    settings: () => ({
      product: 'valkey',
      clusterMode: 'enabled',
      discoveryEndpoint: { host: process.env.CACHE_MEMORYSTORE_DISCOVERY_HOST, port: 6379 },
      auth: { kind: 'iam' },
      tls: { ca: readFileSync(process.env.CACHE_MEMORYSTORE_SERVER_CA_FILE, 'utf8') },
    }),
  }),
]
```

```bash
CACHE_PROVIDER=open-mercato/google-memorystore
CACHE_PROVIDER_NAMESPACE=prod-ew1-1
```

`googleMemorystoreCacheProviderRegistration` is the package's only supported entry point: the package exports no ungated provider definition (no `provider` or default export). When the host resolves providers with an explicit env (`resolveCacheProvider(registrations, { env })`), pass the same object as `env` to the helper so the Enterprise gate reads it; otherwise the gate reads `process.env` when the cache is initialized.

Identity comes from Google Application Default Credentials (GKE Workload Identity, attached service account, `gcloud` ADC) — never from settings.

## Settings

Strict zod schema discriminated by `product`; each product pins `clusterMode` and `auth.kind`. Unknown keys and unlisted combinations are rejected with field paths only.

| Key | Default | Notes |
|---|---|---|
| `product` | — | Only `"valkey"` (Memorystore for Valkey) |
| `clusterMode` | — | Only `"enabled"` |
| `discoveryEndpoint.host` / `.port` | — / `6379` | Discovery endpoint; shards are discovered with `CLUSTER SLOTS` |
| `auth.kind` | — | Only `"iam"` |
| `auth.credentials` | `application-default` | Only ADC; no key files in settings |
| `auth.reauthIntervalMs` | `600000` | Live re-AUTH cadence (60 s – 30 min) |
| `tls.ca` | — (required) | Instance server CA (PEM) |
| `tls.servername` | — | Name to verify on every shard connection; endpoints are IPs, so set it when the server certificate carries a DNS name. Hostname/IP verification is always on; there is no bypass key |
| tuning | RESP defaults, `maxRetriesPerRequest` = 3 | Extra retries absorb MOVED/ASK and shard reconnects |

### IAM authentication

- The OAuth access token (`https://www.googleapis.com/auth/cloud-platform`) is sent as a single-argument `AUTH <token>`.
- Each token's real expiry comes from the auth client (`credentials.expiry_date` after `getAccessToken()`); tokens are reused until 5 minutes before it (a token without a reported expiry is never reused). Credentials are applied to the seed, every discovered shard connection as it joins and every node reconnect, and a node that becomes ready with an older credential is re-AUTHed. Live connections re-run `AUTH` at most every `reauthIntervalMs` and always by the time the token reaches its refresh point.
- Keys of one namespace share one hash tag (`om:{<namespace>}:…`), so multi-key scripts never cross slots.
- Primary reads only (`scaleReads: master`); `healthcheck()` is non-mutating; `close()` is idempotent; `redact()` hides CA material.

## Supported matrix

| Profile id | Memorystore configuration | Status |
|---|---|---|
| `gcp-valkey-cluster-enabled-iam-tls` (first profile) | Memorystore for Valkey · cluster mode enabled · IAM · TLS with server CA | **Unverified (blocked: no approved sandbox/credentials)** |

Container preflight (not live evidence): a 3-primary `valkey/valkey:8.1` cluster, TLS-only on client and bus ports, ACL with the default user disabled, reached through a single discovery seed, with a rotating fake credential standing in for the IAM token — v1 conformance kit incl. an independent process, authentication on new connections to every shard, live re-AUTH on rotation across all nodes, reconnect after `CLIENT KILL` on all nodes, denied credential, CA + hostname verification, non-mutating healthcheck, idempotent close, gate closed ⇒ zero connections, packed install. A real Memorystore IAM token is not a Valkey ACL password, so this does not exercise Google's IAM AUTH integration.

### Unverified profiles (not in the schema)

- Memorystore for Valkey, cluster mode disabled.
- Memorystore for Redis (primary endpoint, Redis AUTH string, server CA).
- Memorystore for Redis Cluster (discovery endpoint, IAM).
- Any other native auth option or replica-read configuration.

## Limits

- One effective provider per deployment; use a new namespace when switching service/layout.
- Identity, network or service outages make the cache unavailable (no synthetic success, no fallback).
- Failover/resharding may discard recent writes under the service's replication policy.

## Operations

See [RUNBOOK.md](RUNBOOK.md).
