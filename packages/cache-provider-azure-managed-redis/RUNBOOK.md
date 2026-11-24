# Runbook — Azure Managed Redis cache provider (Enterprise)

Protected live verification and operations for `@open-mercato/cache-provider-azure-managed-redis`. A profile is **supported only after** this runbook's live job passes against an authorized non-production instance and its redacted evidence is published.

## 1. Prerequisites (environment owner)

- An approved **non-production** Azure Managed Redis instance per profile; record SKU, Redis version, clustering policy and region in the release record (not in Git).
- A runner with approved network reachability to the data-plane endpoint (private endpoint/VNet as required).
- A Microsoft Entra identity (managed identity or workload identity federation) with a **data access** assignment restricted to the test instance. Do **not** use client secrets or access keys for this profile.
- A dedicated isolated namespace prefix (`OM_CACHE_LIVE_NAMESPACE_PREFIX`, 1–24 chars) and synthetic data only.
- Separate authorization for anything paid or disruptive (failover, reboot, scaling, rotation drills).

Never paste secrets, tokens, connection strings or certificate material into chat, Git, PRs, command arguments or artifacts.

## 2. Profile `azure-nonclustered-entra-tls`

| Variable | Required | Meaning |
|---|---|---|
| `OM_CACHE_LIVE_PROFILE` | yes | `azure-nonclustered-entra-tls` |
| `OM_CACHE_LIVE_AZURE_HOST` | yes | Data-plane host name |
| `OM_CACHE_LIVE_AZURE_IDENTITY` | yes | `managed-identity`, `workload-identity` or `default` |
| `OM_CACHE_LIVE_NAMESPACE_PREFIX` | yes | Isolated namespace prefix |
| `OM_CACHE_LIVE_AZURE_PORT` | no | Default `10000` |
| `OM_CACHE_LIVE_AZURE_CLIENT_ID` | no | User-assigned identity client id |
| `OM_CACHE_LIVE_AZURE_OBJECT_ID` | no | Principal object id (else read from the token) |
| `OM_CACHE_LIVE_AZURE_CA_FILE` | no | CA bundle path when not publicly trusted |
| `OM_CACHE_LIVE_EVIDENCE_DIR` | no | Where the evidence JSON is written (default `$TMPDIR/om-cache-live-evidence`) |
| `OM_CACHE_LIVE_RUNNER_REF` | no | Job/run reference recorded in evidence (falls back to `GITHUB_RUN_ID`) |

Azure Identity reads its standard variables (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_FEDERATED_TOKEN_FILE`, …) from the protected job's secret store / federation.

## 3. Run (protected job only — never on public PR jobs)

```bash
yarn workspace @open-mercato/cache-provider-azure-managed-redis test:live
```

Behaviour:

- No profile requested → the live suite is skipped.
- Missing variables → one test records `blocked` evidence and prints the **names** of the missing variables only.
- Identity/network/TLS failure in the readiness probe → evidence `blocked` with a stable code (e.g. `cache-provider:unavailable`); live tests are counted as not run; the profile stays unverified.
- Ready → readiness probe + the full v1 conformance kit in an isolated namespace; per-test totals are written to evidence.

Additional drills to run and record manually in the same job (each requires approval): token refresh across a live connection older than one token lifetime, reconnect after a forced client disconnect, denied credential (identity without data access), graceful shutdown, log redaction of a failing run.

## 4. Evidence and promotion

Evidence file `<profile>.json` contains only: package, version, profile id, status, stable reason code, date, runner reference, test totals. Attach it plus engine version, SKU and client versions (`ioredis`, `@azure/identity`) to the release record. Promote a profile in `README.md` only on `passed` with zero failed and zero skipped tests. Re-run after any change to the SDK, auth flow, routing or wire behaviour.

Current record: `azure-nonclustered-entra-tls` — **unverified (blocked: no approved sandbox/credentials)**, 2026-11-24.

## 5. Cleanup

Tests remove their keys by namespace. If a run aborts, delete keys matching `om:{<prefix>-*}:*` with an admin identity, or rely on the conformance TTLs and verify expiry. Record any leftover cleanup in the release record.

## 6. Production rollout and rollback

1. Verify identity and network reachability from every web/worker/CLI host first (run the readiness probe with a scratch namespace).
2. Deploy with both Enterprise flags, `CACHE_PROVIDER=open-mercato/azure-managed-redis` and a **new** `CACHE_PROVIDER_NAMESPACE`.
3. Watch readiness and `[cache] provider open-mercato/azure-managed-redis:` warnings (connection errors are rate-limited and redacted).
4. Rollback: unset `CACHE_PROVIDER` (stock strategy) or select the previous provider/namespace; then expire or remove only the abandoned namespace.

## 7. Troubleshooting

| Symptom | Likely cause |
|---|---|
| `unavailable` — "not activated" | One of the Enterprise flags is missing in that process |
| `unavailable` — "could not obtain a credential from Microsoft Entra (…)" | Identity not available on the host or not federated |
| `WRONGPASS`/auth errors in redacted warnings | Data access assignment missing or wrong `objectId` |
| `timeout` at initialization | Network path/private endpoint/DNS or TLS name mismatch |
| `invalid_settings` with field paths | Schema rejected a key (e.g. unsupported clustering policy) |
