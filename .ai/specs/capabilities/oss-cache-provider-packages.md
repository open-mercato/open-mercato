# Capability: oss-cache-provider-packages

Operators can install an individually qualified open-source engine adapter (`@open-mercato/cache-provider-*`) and select it through the pluggable cache provider extension.

## Requirement: Independent qualified engine adapter

Each listed engine SHALL have its own installable provider package with a supported settings matrix backed by real-engine evidence.

### Scenario: One engine release qualifies

- WHEN one package passes its initial profile, packed installation and evidence checks
- THEN that package can ship on its own and an app can use it through the existing `cache` DI service

### Scenario: An engine or additional profile has insufficient evidence

- WHEN an engine profile fails or skips required conformance
- THEN it is excluded from that package's supported matrix and sibling packages continue through their own release gates

Qualified first profiles (2026-11-24, Testcontainers): Valkey 8.1 standalone ACL+TLS; Redis 7.2 standalone ACL+TLS; KeyDB 6.3.4 standalone ACL+TLS; Memcached 1.6.45 single server; Infinispan 15.2.6 two-node SCRAM/DIGEST+TLS and single node; Apache Ignite 2.17.0 single node in-memory and persistence+auth+TLS. Unverified profiles are listed in each package README.

Source: .ai/specs/2026-11-24-oss-cache-provider-packages.md
