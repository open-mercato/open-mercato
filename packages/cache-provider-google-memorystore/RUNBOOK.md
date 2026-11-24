# Runbook — Google Cloud Memorystore cache provider (Enterprise)

Protected live verification and operations for `@open-mercato/cache-provider-google-memorystore`. A profile is **supported only after** this runbook's live job passes against an authorized non-production instance and its redacted evidence is published.

## 1. Prerequisites (environment owner)

- An approved **non-production** Memorystore for Valkey instance with cluster mode enabled, IAM authentication and in-transit encryption; record Valkey version, shard count, replicas and region in the release record (not in Git).
- The instance's server CA certificate, delivered through the approved runtime channel (file path for the job).
- A service account / GKE workload identity with the Memorystore data-plane connect permission on **that instance only** (`roles/memorystore.dbConnectionUser` or the documented equivalent).
- A runner with approved network reachability (PSC endpoint / VPC) to the discovery endpoint and all shard addresses.
- A dedicated namespace prefix (`OM_CACHE_LIVE_NAMESPACE_PREFIX`, 1–24 chars) and synthetic data only.
- Separate authorization for scaling (resharding), failover or permission-revocation drills.

Never paste tokens, key files or CA material into chat, Git, PRs, command arguments or artifacts.

## 2. Profile `gcp-valkey-cluster-enabled-iam-tls`

| Variable | Required | Meaning |
|---|---|---|
| `OM_CACHE_LIVE_PROFILE` | yes | `gcp-valkey-cluster-enabled-iam-tls` |
| `OM_CACHE_LIVE_GCP_DISCOVERY_HOST` | yes | Discovery endpoint address |
| `OM_CACHE_LIVE_GCP_SERVER_CA_FILE` | yes | Path to the server CA PEM |
| `OM_CACHE_LIVE_NAMESPACE_PREFIX` | yes | Isolated namespace prefix |
| `OM_CACHE_LIVE_GCP_DISCOVERY_PORT` | no | Default `6379` |
| `OM_CACHE_LIVE_GCP_TLS_SERVERNAME` | no | Name to verify on shard certificates |
| `OM_CACHE_LIVE_EVIDENCE_DIR` / `OM_CACHE_LIVE_RUNNER_REF` | no | Evidence location / job reference |

Identity: Application Default Credentials of the job (workload identity federation or attached service account).

## 3. Run (protected job only)

```bash
yarn workspace @open-mercato/cache-provider-google-memorystore test:live
```

- No profile → skipped. Missing variables → `blocked` evidence naming missing variable **names** only.
- Readiness probe failure (ADC, permission, network, TLS) → `blocked` with a stable code; live tests not run; profile stays unverified.
- Ready → probe + full v1 conformance kit in an isolated namespace; per-test totals recorded.

Manual drills (approval required): connections older than one token lifetime keep working (re-AUTH), new shard connections after a scale-out authenticate, identity without the connect role is denied, failover, redaction of failing output. Confirm the server certificate is verified with the configured name on every shard.

## 4. Evidence and promotion

Evidence `<profile>.json`: package, version, profile id, status, stable reason code, date, runner reference, test totals only. Attach Valkey version and client versions (`ioredis`, `google-auth-library`). Promote only on `passed` with zero failed/skipped. Re-run after SDK, auth, routing or wire changes.

Current record: `gcp-valkey-cluster-enabled-iam-tls` — **unverified (blocked: no approved sandbox/credentials)**, 2026-11-24.

## 5. Cleanup

Tests delete keys per namespace (all keys of a namespace live on one hash slot). After an aborted run, delete `om:{<prefix>-*}:*` on the owning shard(s) with an admin identity or confirm TTL expiry; record the result.

## 6. Rollout and rollback

1. Confirm ADC, permission and network reachability to the discovery endpoint **and every shard** from all web/worker/CLI hosts.
2. Deploy with both Enterprise flags, `CACHE_PROVIDER=open-mercato/google-memorystore` and a new `CACHE_PROVIDER_NAMESPACE`.
3. Watch readiness and redacted `[cache] provider open-mercato/google-memorystore:` warnings.
4. Rollback by restoring the previous `CACHE_PROVIDER`/namespace; then expire only the abandoned namespace.

## 7. Troubleshooting

| Symptom | Likely cause |
|---|---|
| `unavailable` — "not activated" | Enterprise flag missing in that process |
| `unavailable` — "could not obtain a credential from Google Application Default Credentials" | No ADC on the host |
| `WRONGPASS`/`NOAUTH` in redacted warnings | Missing connect permission on the instance |
| `timeout` / `CLUSTERDOWN` | Network path to a shard, TLS name mismatch, or resharding in progress |
