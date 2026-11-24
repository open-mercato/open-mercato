# @open-mercato/cache-provider-aws-elasticache

**Open Mercato Enterprise** cache provider (`open-mercato/aws-elasticache`) for **Amazon ElastiCache**, built on the shared RESP strategy in `@open-mercato/cache-redis-protocol` and the v1 provider API (`@open-mercato/cache/provider`). Server-only.

> **Commercial package.** Licensed under the [Open Mercato Enterprise license](LICENSE.md). It is `private` in the monorepo, is not part of the public npm publish set or the default app install, and ships only through the commercial distribution channel.
>
> **Support status: no profile is supported yet.** Every profile below is **unverified** until it passes the live gate against an authorized, non-production ElastiCache deployment (see [Supported matrix](#supported-matrix)). Container preflight is not live evidence.

## Install (commercial channel)

```bash
yarn add @open-mercato/cache-provider-aws-elasticache   # from the Enterprise registry
```

Peer: `@open-mercato/cache` (>= 0.11.0). Runtime: `@open-mercato/cache-provider-managed-kit` (private, Enterprise-licensed: activation gate, credential refresh, managed TLS/connection helpers), `@open-mercato/cache-redis-protocol`, `ioredis` 6.x, `zod`, `@smithy/signature-v4` 5.x and `@aws-sdk/credential-provider-node` 3.x (both Apache-2.0). Both AWS modules are imported lazily, only after the Enterprise gate passes and the cache is first created.

## Enterprise activation

The provider is inert unless **both** flags are true in every process that uses the cache (web server, workers, CLI maintenance):

```bash
OM_ENABLE_ENTERPRISE_MODULES=true
OM_ENABLE_ENTERPRISE_MODULES_CACHE_PROVIDERS=true
```

With the gate closed, selection resolves to a stand-in that never reads your settings, never loads the AWS SDK and never connects; the first cache operation fails with `CacheProviderError` code `unavailable` and an actionable message. There is **no fallback** to a local cache. The switch is a runtime enable flag only; entitlement is governed by your Enterprise agreement.

## Register and select

```ts
import { readFileSync } from 'node:fs'
import { awsElastiCacheCacheProviderRegistration } from '@open-mercato/cache-provider-aws-elasticache'

export const cacheProviders = [
  awsElastiCacheCacheProviderRegistration({
    settings: () => ({
      engine: 'valkey',
      deployment: 'node-based',
      clusterMode: 'disabled',
      host: process.env.CACHE_ELASTICACHE_PRIMARY_HOST, // primary endpoint
      auth: {
        kind: 'iam',
        userId: process.env.CACHE_ELASTICACHE_USER_ID,          // IAM-enabled user (id == name, lowercase)
        replicationGroupId: process.env.CACHE_ELASTICACHE_RG_ID, // signing resource
        region: process.env.AWS_REGION,
      },
    }),
  }),
]
```

```bash
CACHE_PROVIDER=open-mercato/aws-elasticache
CACHE_PROVIDER_NAMESPACE=prod-euw1-1
```

AWS credentials come from the SDK default chain (environment, web identity/IRSA, ECS task role, EC2 instance profile, SSO, shared profile) — never from settings.

## Settings

Strict zod schema discriminated by `engine`; each engine variant pins `deployment`, `clusterMode` and `auth.kind`. Unknown keys and unlisted combinations are rejected with field paths only.

| Key | Default | Notes |
|---|---|---|
| `engine` | — | Only `"valkey"` |
| `deployment` | — | Only `"node-based"` |
| `clusterMode` | — | Only `"disabled"` (writable primary endpoint) |
| `host` / `port` | — / `6379` | Primary endpoint |
| `auth.kind` | — | Only `"iam"` |
| `auth.userId` | — | Lowercase ElastiCache user id (must equal the user name for IAM users) |
| `auth.replicationGroupId` | — | Lowercase replication group id used as the SigV4 signing resource |
| `auth.region` | — | e.g. `eu-west-1` |
| `auth.credentials` | `default-chain` | Only the SDK default chain; no keys in settings |
| `auth.reauthIntervalMs` | `600000` | Live re-AUTH cadence (60 s – 30 min) |
| `tls.ca` / `tls.servername` | system trust / `host` | TLS is mandatory; hostname verification always on; no bypass key |
| tuning | as RESP library | `connectTimeoutMs`, `commandTimeoutMs`, `maxRetriesPerRequest`, `batchSize`, `maxValueBytes` |

### IAM authentication

- Token = SigV4 presigned `GET http://<replicationGroupId>/?Action=connect&User=<userId>` for service `elasticache`, `X-Amz-Expires=900`, without the `http://` scheme; sent as `AUTH <userId> <token>`.
- Tokens are re-signed 5 minutes before their 15-minute expiry; every reconnect uses a fresh token and all live connections re-run `AUTH` every `reauthIntervalMs` (well inside ElastiCache's 12-hour IAM connection limit).
- Signing is deterministic for fixed credentials and clock and is unit-tested against an independent SigV4 implementation.
- Primary reads only; `healthcheck()` is a non-mutating `PING`; `close()` is idempotent; `redact()` hides the user id and CA material.

## Supported matrix

| Profile id | ElastiCache configuration | Status |
|---|---|---|
| `aws-valkey-node-cmd-disabled-iam-tls` (first profile) | Valkey · node-based · cluster mode disabled · IAM · TLS | **Unverified (blocked: no approved sandbox/credentials)** |

Container preflight (not live evidence): `valkey/valkey:8.1` TLS-only with an ACL user whose password rotates through a fake token source standing in for IAM — v1 conformance kit incl. an independent process, live re-AUTH on rotation, reconnect with the rotated credential, denied credential, CA + hostname verification, non-mutating healthcheck, idempotent close, gate closed ⇒ zero connections, packed install.

### Unverified profiles (not in the schema)

- Valkey node-based cluster mode **enabled** (configuration endpoint) and Valkey **Serverless** (`ResourceType=ServerlessCache` signing).
- Redis OSS: node-based cluster mode disabled/enabled and Serverless.
- ACL user/password (least-privilege RBAC user group) profiles.
- Memcached node-based (Auto Discovery) and Serverless (TLS, 16 KB command limit) — require the CAS bucket design and a Memcached protocol client; no Memcached protocol package is merged yet.

## Limits

- One effective provider per deployment; switch namespace when switching service or layout.
- Identity, network or ElastiCache outages make the cache unavailable (no synthetic success, no fallback).
- Failover may discard recent writes under the replication policy.

## Operations

See [RUNBOOK.md](RUNBOOK.md).
