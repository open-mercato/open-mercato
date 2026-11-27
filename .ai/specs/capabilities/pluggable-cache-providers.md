# Capability: pluggable-cache-providers

Deployment operators can select an explicitly registered npm cache provider with its own validated settings, behind the existing `cache` DI service.

## Requirement: App-owned npm provider selection

The platform SHALL select an explicitly registered npm cache provider using deployment configuration and the provider's validated settings. The app declares registrations in `src/providers/cache.ts`. Web, worker, scheduler and maintenance paths initialize the selected provider before use.

### Scenario: Provider unknown to platform source

- WHEN a deployment installs a third-party package, registers the package's loader and settings, and selects its ID
- THEN the server, worker and cache maintenance resolve that provider through the same effective configuration, with no package-specific core change

### Scenario: Invalid explicit selection

- WHEN the selected provider is missing, incompatible, disabled, misconfigured or unavailable
- THEN the affected runtime or operation reports a sanitized failure and never substitutes a local cache

Source: .ai/specs/2026-11-24-pluggable-cache-providers.md

## Requirement: Scoped distributed cache behavior

A provider SHALL preserve documented tenant scope, TTL, enumeration and tag invalidation through the existing cache service.

### Scenario: Remote invalidation

- WHEN one process overwrites a record's tags and another invalidates several tags for the same tenant
- THEN matching current entries are removed once and unrelated entries and other scopes survive. A subsequent read misses a removed entry unless another writer has repopulated it

Source: .ai/specs/2026-11-24-pluggable-cache-providers.md
