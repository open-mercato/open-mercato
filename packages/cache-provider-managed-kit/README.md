# @open-mercato/cache-provider-managed-kit

> **Commercial package.** Licensed under the [Open Mercato Enterprise license](LICENSE.md). It is `private` in the monorepo, is not part of the public npm publish set or the default app install, and ships only through the commercial distribution channel, as a dependency of the official managed cache providers.

Shared building blocks for the official Open Mercato managed cloud cache providers:

- `@open-mercato/cache-provider-azure-managed-redis`
- `@open-mercato/cache-provider-aws-elasticache`
- `@open-mercato/cache-provider-google-memorystore`

Applications do not depend on this package directly; install a provider package.

## Runtime surface (`@open-mercato/cache-provider-managed-kit`)

| Area | Exports |
|---|---|
| Enterprise activation gate | `ENTERPRISE_MODULES_ENV` (`OM_ENABLE_ENTERPRISE_MODULES`), `ENTERPRISE_CACHE_PROVIDERS_ENV` (`OM_ENABLE_ENTERPRISE_MODULES_CACHE_PROVIDERS`), `OFFICIAL_MANAGED_CACHE_PROVIDER_IDS`, `isOfficialManagedCacheProviderId`, `isEnterpriseCacheProviderActivationEnabled`, `assertEnterpriseCacheProviderActivation`, `enterpriseActivationError`, `gateEnterpriseCacheProvider`, `createDisabledEnterpriseCacheProvider`, `defineEnterpriseCacheProviderRegistration`, `ENTERPRISE_DISABLED_CONFIG`, `isEnterpriseDisabledConfig` |
| Short-lived credentials | `createCachedCredentialsProvider` (reuse until expiry minus skew, single-flight refresh, sanitized `unavailable` failures, `invalidate()`), types `ManagedAccessToken`, `ManagedAccessTokenSource` |
| Managed RESP connections | `createManagedRespProvider` (gate first, then per-connection AUTH with refreshed tokens and periodic re-auth), `managedHostSchema`, `managedPortSchema`, `managedTlsSchema`, `managedTlsWithCaSchema`, `managedTuningShape`, `MANAGED_REAUTH_LIMITS`, `toRespTls`, `redactManagedTls`, `redactManagedTuning` |

Both flags must be truthy for an official managed provider to load, parse settings or connect. The switch is a runtime enable flag, not a license.

## Workspace-only testing surface (`@open-mercato/cache-provider-managed-kit/testing`)

Test support used by the provider packages' suites. It lives in `test-support/`, is resolved through workspace jest/TypeScript mappings and is **not** included in the packed tarball.

| Module | Purpose |
|---|---|
| `testing/gate` | `defineEnterpriseGateSuite` — web, worker and maintenance gate checks for a provider |
| `testing/packaging` | `defineCommercialPackagingSuite`, `COMMERCIAL_CACHE_PACKAGES` — private, Enterprise-licensed, out of the default app, template and public dependency graphs |
| `testing/live`, `testing/live-readiness` | Protected live harness (`OM_CACHE_LIVE_PROFILE`) and its readiness/evidence checks |
| `testing/preflight`, `testing/file-credential` | Container preflight with a rotating file credential standing in for the cloud identity, including the packed-install check |

## License

See [LICENSE.md](LICENSE.md).
