# Runbook — Amazon ElastiCache cache provider (Enterprise)

Protected live verification and operations for `@open-mercato/cache-provider-aws-elasticache`. A profile is **supported only after** this runbook's live job passes against an authorized non-production deployment and its redacted evidence is published.

## 1. Prerequisites (environment owner)

- An approved **non-production** ElastiCache replication group per profile: engine and version, node type, cluster mode disabled, in-transit encryption enabled, region. Record them in the release record (not in Git).
- An IAM-enabled ElastiCache user (user id == user name, lowercase) in a user group attached to the replication group, with the least-privilege access string, e.g. `on ~om:* resetchannels -@all +@read +@write +@keyspace +@scripting +@transaction +@connection -@dangerous`.
- An IAM role for the runner allowing `elasticache:Connect` on **that replication group and that user only**.
- A runner inside the VPC (or with an approved network path) to the primary endpoint.
- A dedicated namespace prefix (`OM_CACHE_LIVE_NAMESPACE_PREFIX`, 1–24 chars) and synthetic data only.
- Separate authorization for failover, node replacement, scaling or credential rotation drills.

Never paste credentials, tokens or endpoints with secrets into chat, Git, PRs, command arguments or artifacts.

## 2. Profile `aws-valkey-node-cmd-disabled-iam-tls`

| Variable | Required | Meaning |
|---|---|---|
| `OM_CACHE_LIVE_PROFILE` | yes | `aws-valkey-node-cmd-disabled-iam-tls` |
| `OM_CACHE_LIVE_AWS_PRIMARY_HOST` | yes | Primary endpoint host |
| `OM_CACHE_LIVE_AWS_USER_ID` | yes | IAM-enabled ElastiCache user id |
| `OM_CACHE_LIVE_AWS_REPLICATION_GROUP_ID` | yes | Signing resource |
| `OM_CACHE_LIVE_AWS_REGION` | yes | Region |
| `OM_CACHE_LIVE_NAMESPACE_PREFIX` | yes | Isolated namespace prefix |
| `OM_CACHE_LIVE_AWS_PORT` | no | Default `6379` |
| `OM_CACHE_LIVE_AWS_CA_FILE` | no | CA bundle path when required |
| `OM_CACHE_LIVE_EVIDENCE_DIR` / `OM_CACHE_LIVE_RUNNER_REF` | no | Evidence location / job reference |

AWS credentials: the job's role via OIDC federation or instance/task role (SDK default chain).

## 3. Run (protected job only)

```bash
yarn workspace @open-mercato/cache-provider-aws-elasticache test:live
```

- No profile → skipped. Missing variables or an endpoint unreachable from the runner (DNS, refused/unreachable, timeout; checked at test collection) → every live test registered as **skipped**, never passed; `blocked` evidence with `missing:<names>` or `network:<kind>` (variable **names** only).
- Readiness probe failure → every live test **fails** (never green). Evidence `blocked` only for an unavailable environment (`credentials:unavailable`, `network:*`); `failed` for settings errors, auth rejections from a reachable endpoint (`auth:WRONGPASS`/`auth:NOAUTH`/`auth:NOPERM`), TLS verification errors and anything else.
- Ready → probe + full v1 conformance kit in an isolated namespace; per-test totals recorded; `passed` only when every test ran and passed.

Manual drills (approval required): connection older than the 15-minute token lifetime keeps working (re-AUTH), reconnect after forced disconnect, user without `elasticache:Connect` is denied, failover to a new primary, redaction of failing output.

## 4. Evidence and promotion

Evidence `<profile>.json`: package, version, profile id, status, stable reason code, date, runner reference, test totals — nothing else. Attach engine version and client versions (`ioredis`, `@smithy/signature-v4`, `@aws-sdk/credential-provider-node`). Promote only on `passed` with zero failed/skipped. Re-run after SDK, signing, routing or wire changes.

Current record: `aws-valkey-node-cmd-disabled-iam-tls` — **unverified (blocked: no approved sandbox/credentials)**, 2026-11-24.

## 5. Cleanup

Keys are removed per namespace by the tests. After an aborted run, delete `om:{<prefix>-*}:*` with an admin user or confirm TTL expiry; record the result.

## 6. Rollout and rollback

1. Confirm `elasticache:Connect`, security groups and DNS from every web/worker/CLI host.
2. Deploy with both Enterprise flags, `CACHE_PROVIDER=open-mercato/aws-elasticache` and a new `CACHE_PROVIDER_NAMESPACE`.
3. Watch readiness and redacted `[cache] provider open-mercato/aws-elasticache:` warnings.
4. Rollback by restoring the previous `CACHE_PROVIDER`/namespace; then expire only the abandoned namespace.

## 7. Troubleshooting

| Symptom | Likely cause |
|---|---|
| `unavailable` — "not activated" | Enterprise flag missing in that process |
| `unavailable` — "could not obtain a credential from AWS IAM" | No role/credentials in the SDK default chain |
| `WRONGPASS` in redacted warnings | Wrong `userId`/`replicationGroupId`/region, user not IAM-enabled, or missing `elasticache:Connect` |
| `timeout` at initialization | Security group, VPC routing, DNS or TLS name mismatch |
