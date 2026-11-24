# OSS cache provider packages (PR 2 of 3)

Source spec: .ai/specs/2026-11-24-oss-cache-provider-packages.md
Spec PR: #10512 (merged)
Depends on: #10513 (v1 provider host) — this PR is stacked on `feat/pluggable-cache-providers`
Branch: feat/oss-cache-provider-packages

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr-loop`. Step ids and `Exec` cells are immutable once the plan is committed.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 2 | 2.1 | Shared RESP cache strategy library for Redis-protocol providers | dispatch | done | b78aa57036 |
| 2 | 2.2 | Valkey provider package (standalone ACL + TLS) | dispatch | done | 58563616aa |
| 2 | 2.3 | Redis provider package (standalone ACL + TLS, Redis 7.2) | dispatch | done | 726b9bbfd7 |
| 2 | 2.4 | KeyDB provider package (standalone ACL + TLS) | dispatch | done | 9f8d8c4b14 |
| 2 | 2.5 | Memcached protocol client and CAS bucket provider | dispatch | done | 244dbb1ac1 |
| 2 | 2.6 | Memcached real-engine qualification, packed install and evidence | dispatch | done | 335688fb9a |
| 2 | 2.7 | Infinispan Hot Rod provider with versioned tag index | dispatch | done | 5d3056e960 |
| 2 | 2.8 | Infinispan real-engine qualification, decoder guard and evidence | dispatch | done | f3fad2fef8 |
| 2 | 2.9 | Apache Ignite 2.x thin-client provider | dispatch | done | 71bf574275 |
| 2 | 2.10 | Ignite real-engine qualification, packed install and evidence | dispatch | done | 6e66a0c5c4 |
| 2 | 2.11 | Pin apache-ignite-client transitive dependencies | inline | done | dbfeb5ef85 |
| 2 | 2.12 | Normalize container test scripts and record independent re-verification | inline | done | (this commit) |
| 2 | 2.13 | Archive Delta into capabilities spec | inline | todo | — |

## Goal

Ship one independently installable `@open-mercato/cache-provider-*` package per OSS engine, each qualified on its first profile against the real engine in Testcontainers, with a packed install into a fresh app and published evidence.

## Execution model

Each engine (Redis-protocol family, Memcached, Infinispan, Ignite) was built by an independent cezar child task in its own worktree on top of the PR 1 host, then merged here with `--no-ff` (lockfile regenerated per merge). The root re-ran every container suite sequentially on one Docker host before opening the PR (`checkpoint-1-checks.md`).

## Qualified first profiles

| Package | Image | Profile | Container tests |
|---|---|---|---|
| cache-redis-protocol | valkey/valkey:8.1 cluster (3 primaries) | protocol-level cluster, slot migration, reconnect | 19/19 |
| cache-provider-valkey | valkey/valkey:8.1 | standalone, ACL + TLS | 32/32 |
| cache-provider-redis | redis:7.2 | standalone, ACL + TLS, stock coexistence | 33/33 |
| cache-provider-keydb | eqalpha/keydb:arm64_v6.3.4 | standalone, ACL + TLS | 32/32 |
| cache-provider-memcached | memcached:1.6.45-alpine | single server, CAS buckets | 44/44 |
| cache-provider-infinispan | quay.io/infinispan/server:15.2.6.Final | 2-node cluster SCRAM/DIGEST + TLS; single node | 44/44 |
| cache-provider-ignite | apacheignite/ignite:2.17.0-arm64 | single node in-memory; persistence + auth + TLS | 50/50 |

## Unverified profiles (excluded from supported matrices)

Valkey/Redis replica failover and Redis Cluster provider schemas, KeyDB active-active, mutual TLS, other engine versions (Valkey 7.2/8.0/9.x, Redis 7.4/8.x); Memcached multi-server, SASL, TLS; Infinispan topologyUpdates routing, SCRAM-SHA-384/512, >2 nodes, >5k entries/tenant; Ignite multi-node/backups/failover, mTLS, amd64 image.

## Non-goals

Changing the v1 host contract (PR 1), Enterprise managed providers (PR 3), publishing packages.

## Risks

- Upstream client defects: infinispan@0.16.3 decoder truncation (patched at load, pinned exactly); apache-ignite-client 1.0.0 (2018) declares `latest` deps (pinned via resolutions).
- Grid engines (Infinispan, Ignite) are sensitive to Docker host contention; run container suites sequentially.
