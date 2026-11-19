# CRUD response cache encryption

> **Program.** B9 of the [GDPR-ready deployments program](2026-11-15-gdpr-ready-deployments-program.md), issue #8593. The proposed OSS carrier requires the program’s written DEC-2 approval.

## TLDR

The CRUD factory can send decrypted response bodies to its cache backend. B9 protects new cached values with scoped tenant keys, removes the old plaintext namespace before production cutover and prevents an in-flight read from refilling the cache after erasure invalidation. The application continues to use its authorized database response when a cache entry cannot be read or written safely.

## Problem statement

The CRUD response cache is opt-in through `ENABLE_CRUD_API_CACHE`. The factory reads and writes the cached payload in `packages/shared/src/lib/crud/factory.ts`, while the cache package owns storage, expiry and tag invalidation. Authorization at HTTP read time does not protect decrypted bodies retained in the configured backend. The factory’s original key includes the request path and serialized filters. The cache wrapper hashes its physical keys but writes the input key to a separate clear metadata record. Encrypting only the response value leaves that metadata exposed.

## Proposed solution

Wrap only CRUD factory response values, after the trusted authenticated tenant, effective organization scope and canonical cache key are known. Encrypt the complete serialized payload and any cache metadata that may carry response data through the shared tenant-encryption service using its authenticated envelope and A3’s scoped key resolution. Authenticate the canonical response cache key and scope as associated data, or include them inside the authenticated envelope and compare them before returning a hit. Before calling the cache DI interface, derive a versioned opaque identifier using a domain-separated keyed digest of the full canonical response cache key with tenant key material. Every cache operation and its clear metadata receives only that opaque identifier. Preserve scope and result partitioning encoded in the canonical key. Raw keys and tag metadata carry no path, filter, response value or clear cache key. Diagnose counts and safe failure reasons without printing the original key. Bypass caching for an unscoped response or unavailable key. A wrong scope/key, unsupported envelope version, corrupted payload or decryption failure produces a miss and permits no plaintext cache write. The normal authorized response, TTL and tag invalidation behavior continue. Evict unreadable entries through the owner and refill from the authoritative read path after key rotation.

## Architecture and data models

The shared CRUD owner defines the versioned namespace and cache value codec, and calls the existing cache DI interface. The cache package owns namespace-scoped cleanup for each supported backend. Validate the selected driver and do not mistake a memory fallback for the requested persistent store. The runtime envelope stores its version and authenticated ciphertext using the shared crypto format with no duplicate clear payload. No SQL table, file format or public HTTP API is added. The internal cleanup returns aggregate remaining/matching key counts and never returns payloads, keys or tagged identifiers. An unsupported or indeterminate count stops the cutover.

### Late cache fill after erasure invalidation

The cache package owns an additive optional admission and invalidation capability on the existing cache DI instance for the protected CRUD namespace. Other cache consumers keep their current methods and behavior. Use one opaque generation per tenant and protected namespace, shared across all organization and resource variants that could contain the tenant's erased data. Keep the generation independent of tenant encryption-key rotation. Sampling the generation requires a confirmed authenticated tenant and the verified selected backend. Capture it before opening the database snapshot or issuing the first authoritative list/detail read for a potential fill. When a caller already holds an older snapshot or cannot prove when the candidate response was read, serve the ordinary authorized response and skip the fill.

Bind the captured generation, canonical key and scope to the authenticated payload. The owner publishes a fill only through a backend-atomic compare-and-set that tests the captured generation and writes its encrypted value and metadata/tag membership together with respect to invalidation. A generation mismatch discards that fill without writing any entry or companion metadata. A separate generation recheck followed by an ordinary `set` has a race and does not satisfy this contract. Cache hits read and validate the entry against the current generation before serving it. Generation metadata contains opaque values only. On missing or reset generation state establish a fresh non-reusable generation under the same fence, so a delayed fill or a prior entry cannot become current after reset.

For each C4 invalidation, extend the shared CRUD invalidation path after the domain write commits. The cache owner advances the generation and removes the affected tenant's protected values and companion metadata under the same serialization boundary as fill. Reuse existing tags and namespace ownership for cleanup, including tenant-wide collection entries, affected organization entries and prior-key versions. A conservative tenant-wide invalidation is allowed for B9 so equivalent list/detail keys share the same fence, without clearing another tenant or another cache workload. If the generation advances but removal fails, older entries remain ineligible for hits. The owner must report incomplete invalidation and retry the physical cleanup before DEC-15 absence can pass. If the advance cannot be established, C4's required cache side effect remains incomplete. A reader without a verifiable fence bypasses caching. If an isolated node can still serve pre-invalidation entries, the topology has an open readiness gap until those nodes are fenced off or their stores are reconciled.

Each enabled backend must prove this ordering across every live reader and invalidator. One in-process memory backend can coordinate only processes sharing that instance. A composition using separate process-local stores needs positive all-writer coordination proof or must keep the protected CRUD namespace disabled. Apply the same rule to SQLite and JSON-file deployments with isolated local storage and Redis arrangements that cannot establish atomicity across their affected keys. Use the enabled backend's supported coordination, then prove it in the applicable supported topology. Unavailable, unsupported or ambiguous capability produces an authorized database response with no cache hit or fill. Merely disabling new cache writes does not prove that historical copies were removed.

## Delta

### Capability: crud-response-cache-encryption

#### MODIFIED Requirement: Protected cached CRUD responses

- WHEN a scoped authorized CRUD response is cached with a usable tenant key
- THEN direct backend inspection sees an encrypted envelope and an identical authorized request can obtain the existing cache-hit behavior
- WHEN an entry is copied to another scope or key, tampered with, or read without the proper key
- THEN the request uses the authorized database path and the backend receives no plaintext payload
- WHEN an old writer can refill the plaintext namespace or a backend cannot establish an empty old namespace
- THEN deployment keeps CRUD caching disabled on every replica and reports pending legacy purge
- WHEN a request read old data and erasure invalidation completes before it attempts publication
- THEN the cache rejects that fill and stores no value or companion metadata from the stale response

## Migration & Backward Compatibility

Existing cache enablement, TTL, authorization and HTTP semantics continue. In the upgrade window disable CRUD caching fleet-wide and drain legacy writers. Use the cache owner’s namespace-scoped cleanup to remove only old CRUD response entries in all configured backends. Verify every tenant and the legacy global scope, including clear metadata-only records and hashed value-only survivors if the process failed between payload and metadata writes. Use owner tag/index evidence when independently complete. Missing metadata is not evidence of absence. When a backend cannot distinguish legacy CRUD orphans, keep CRUD caching disabled until a verified expiry bound or owner-approved maintenance of the affected cache store establishes their removal. Record the gap and avoid flushing unrelated workloads as routine cleanup. Verify the old keyspace cannot be refilled before enabling the new namespace. Disabling caching alone does not purge old entries. During rollback keep caching disabled until a compatible writer is available. `UPGRADE_NOTES.md` documents the ordering, supported cleanup and remaining evidence. A deployment with no legacy CRUD cache entries follows the same empty-keyspace check.

## Risks and failure modes

An old writer can reintroduce plaintext after a purge. The all-replica drain and verification are mandatory for cutover. An in-flight request can hold a pre-erasure response in memory and attempt to cache it after invalidation. Generation-bound publication prevents that in-flight fill from creating a new retained copy. A fill begun after invalidation still needs an authoritative source snapshot. When a query projection, replica or enricher can lag after erasure, use its verified fresh read path or bypass protected caching for that source until freshness is proven. G6 treats unverified upstream freshness as a separate DEC-15 gap. An already running authorized response may finish with its earlier snapshot. That response is outside the post-invalidation cache-hit claim. Treat interrupted or unsupported backend cleanup as incomplete. Loss of key or fence availability reduces cache hits and shifts load to ordinary database reads. Backend failures and wrong scope use the same miss behavior, with bounded aggregate diagnostics and no personal payloads.

## Implementation plan and acceptance

1. Characterize ordinary HTTP payloads, scoped key and tag behavior, and cache hit/miss headers. Deliver the codec, key-scope check, protected writer and invalidator parity after A3. Add the namespace generation, atomic admission and scoped invalidation. Unit fixtures exercise key, scope and generation mismatches, decoding failures, metadata/tag atomicity, generation reset, invalidation uncertainty and fallback without cache operations when the key or safe fence is unavailable.
2. Deliver scoped legacy cleanup, cutover checks and operator notes. Verify interruption and repeated cleanup, rejecting an unsupported backend or active old writer and preserving unrelated namespace entries.
3. TC-PRIVACY-CACHE-001 runs against memory and each supported persistent cache strategy: Redis, SQLite and JSON-file. Record the actual active strategy and reject an unintended fallback. Validate all-writer process drain separately for memory. Create owned tenants, organizations and scoped CRUD fixtures through the API and remove them and their cache entries in teardown. Warm a response with separate planted payload and query markers. Inspect its raw value, physical keys, tags and companion metadata, requiring authenticated ciphertext for the payload and no clear copy of either marker in any persisted field, then verify hit, wrong-key and wrong-scope misses, no plaintext writes, and ordinary invalidation following erasure without manually clearing the new namespace. Seed old plaintext and raw-key metadata in tenant and global scopes, including a value-only orphan and prove durable scoped purge before enabling the replacement. G6 uses this at-rest evidence separately from its post-erasure checks under DEC-15.
4. Extend TC-PRIVACY-CACHE-001 with a controlled barrier on a cache miss that captures its generation and reads the old response, then pauses before backend publication. Invalidate through the real erasure path and wait for completed cache side effects. Release the paused request and assert its publication was rejected. Inspect the target backend for the exact marker-bearing entry and companion metadata/tag membership before cleanup. Repeat the same authenticated request and assert the erased data cannot return as a hit. Exercise the opposite ordering to prove that when the fill wins first, the committed invalidation removes it. Check independently that another tenant's hit survives both races. Use two processes/clients for a supported cross-process backend, and verify bypass for topologies that cannot coordinate them. Assert fence error and physical deletion failure do not record a successful erasure cache side effect.

## Final compliance report

Design only. B9 preserves the cache and HTTP contracts while using shared DI, tenant scoping and encryption. Rollout depends on A3 key access, confirmed storage backend support, test evidence and written carrier approval.

## Changelog

### 2026-11-18

- Added B9 to address the plaintext CRUD cache requirement and define separate raw-storage and erasure evidence.

### 2026-11-19

- Specify and test backend admission fencing for delayed fills that race erasure invalidation.
