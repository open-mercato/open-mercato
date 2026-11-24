# Enterprise managed cloud cache providers (PR 3 of 3)

Source spec: .ai/specs/enterprise/2026-11-24-managed-cloud-cache-providers.md
Spec PR: #10512 (merged)
Depends on: #10527 (OSS provider packages, reuses `@open-mercato/cache-redis-protocol`) → #10513 (v1 host)
Branch: feat/managed-cloud-cache-providers

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr-loop`. Step ids and `Exec` cells are immutable once the plan is committed.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 1 | 1.1 | Azure Managed Redis provider with Enterprise activation gate | dispatch | done | 69d2e07105 |
| 2 | 2.1 | Amazon ElastiCache provider (Valkey, IAM SigV4, TLS) | dispatch | done | 268db6e4f0 |
| 2 | 2.2 | Google Cloud Memorystore provider (Valkey cluster, IAM, TLS) | dispatch | done | 3939ba85b5 |
| 1 | 1.2 | Gate, packaging, container preflight and protected live harness | dispatch | done | b253ee568f |
| 1 | 1.3 | READMEs, runbooks and unverified live evidence | dispatch | done | 538c7cff01 |
| 1 | 1.4 | Extract shared managed-provider kit | dispatch | done | fe572766ae |
| 1 | 1.5 | Client-auth capable TLS test certificates for cluster preflight | dispatch | done | 7b58bdfaea |
| 1 | 1.6 | Record Phase 1 implementation in the spec changelog | dispatch | done | 959b89c9aa |
| 1 | 1.7 | Archive Phase 1 Delta into enterprise capabilities spec | inline | done | (this commit) |

## Goal

Ship separate commercial providers for Azure Managed Redis, Amazon ElastiCache and Google Cloud Memorystore behind the Enterprise activation gate, built on the v1 provider contract and the shared RESP layer, with a protected live harness.

## Verification status

- Unit (Docker-free) and container preflight (TLS + ACL Redis/Valkey, 3-primary TLS Valkey cluster with rotating credentials) pass for every package.
- **Live cloud qualification is blocked**: no approved non-production sandbox or credentials were available. Every advertised profile is recorded `unverified (blocked)` in each package's EVIDENCE.md and excluded from supported claims, per the spec's live-verification gate.

## Non-goals

ElastiCache Memcached profiles (not implemented; listed unverified), OSS-cluster / Enterprise-proxy Azure policies, Memorystore for Redis, the commercial registry publish job.
