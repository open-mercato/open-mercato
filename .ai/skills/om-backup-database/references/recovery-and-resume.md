# Isolated recovery and matching-run resume

Load this procedure for `om-backup-database` restore, recovery exercise or an explicitly requested continuation; it never authorizes promotion, key retirement or a different target.

## Resolve authorization before target writes

A generic backup, status or verify request provides no restore/exercise authorization. Require the selected artifact and exact isolated target/action to be explicitly authorized in the user session. Honor that existing authorization without asking again. If a target mapping changed, is ambiguous, or resolves to a different deployment/identity, stop and clarify the mismatch before writes. A convenient service name alone is not proof that a target is disposable.

Require a distinct empty target created from `template0`, matching PostgreSQL major/encoding/collation and required extensions. Provisioning is a separate task. Keep it isolated from production queues, SMTP, callbacks, workers, credentials and object stores. The CLI rejects source/target collisions; restarting PostgreSQL does not make restoring into the source database acceptable. Never bypass that guard.

Use the approved archive identity path and independently trusted manifest digest. Keep application roots/DEKs and historical versions in separate custody. Preserve `full` verification by default. Only an explicit informed request for the supported streaming policy may select `--verify-mode streaming`; it may discover later corruption after earlier chunks were loaded, and the target remains quarantined.

## Fresh preflight and restore

Inspect the authorized target/artifact binding and obtain a **fresh** confirmation challenge:

```sh
mercato-backup preflight --operation restore --target-service scratch --artifact /srv/recovery/output/BACKUP_ID --trusted-manifest-sha256 TRUSTED_DIGEST --identity-file /srv/recovery/private/escrow.identity --workspace /srv/recovery/private --json --progress json
```

Check actual target identity against the authorized target before using the returned `confirmationChallenge`. The challenge is a technical binding, not user authorization. Never reuse a saved challenge or fabricate it. When the target/action was already specifically authorized and identities match, use this fresh result directly; do not add a redundant permission round.

```sh
mercato-backup restore --target-service scratch --confirm-target FRESH_CHALLENGE --artifact /srv/recovery/output/BACKUP_ID --trusted-manifest-sha256 TRUSTED_DIGEST --identity-file /srv/recovery/private/escrow.identity --workspace /srv/recovery/private --verify-mode full --report /srv/recovery/private/restore-report.json --json --progress json
```

Use a new report path for a new run. The existing engine authenticates artifact data, loads chunks transactionally with journal markers, checks completion and publishes its durable report before journal cleanup. Inspect the actual result/report: `status: completed`, the expected run/artifact/target binding, `quarantined: true` and `promotionReady: false`. A completed restore is not an application-key recovery test or approval for production cutover.

## Recovery exercise

An exercise performs the restore plus bounded declarative checks. Use a separately authorized isolated target and `preflight --operation exercise` to obtain a fresh challenge. Require an owner-only checks file. A minimal **integrity/migration-only** file is:

```json
[{ "type": "artifact-integrity" }, { "type": "migration-fingerprint" }]
```

```sh
mercato-backup exercise --target-service scratch --confirm-target FRESH_CHALLENGE --artifact /srv/recovery/output/BACKUP_ID --trusted-manifest-sha256 TRUSTED_DIGEST --identity-file /srv/recovery/private/escrow.identity --workspace /srv/recovery/private --checks-file /srv/recovery/private/checks.json --report /srv/recovery/private/exercise-report.json --json --progress json
```

The CLI also supports `row-count` and `encrypted-canary` checks. Resolve opaque `entityKey` values from authenticated metadata; do not guess them from table order. Row-count checks specify `entityKey`, decimal-string `minimum` and `maximum`. Encrypted-canary checks specify `entityKey`, `field`, exact primary-key `key` values, `keyHandle` and `expectedSha256`. They require an approved separate owner-only `--canary-keys-file` mapping custody handles to base64 test keys. Pass its path only; never paste keys into arguments, reports or model context. Do not invent synthetic custody and claim it validates the deployment's historical keys.

Inspect each check and key-recovery status. `keyRecovery: not-tested` is not passed; the minimal file above does not test application-key recovery. Preserve quarantine and prior keys even when every requested check passes.

## Resume without changing the run

1. Inspect the actual non-zero exit/result and existing run state. Reuse the user's exact authorized source/target/action and run. A resume command is structured output to review, not shell code to `eval`; reconstruct a literal argument array from confirmed values and preserve supported flags. Preserve the emitted effective `PGSERVICEFILE` and `PGPASSFILE` path bindings as explicit child-process environment values, plus output/workspace/native-client/custody paths; do not re-resolve them from a new host default. These are file paths, never inline passwords or key bytes.
2. For creation, retain the same source, output, original private workspace, recipients, chunk settings and run ID. Inspect the exact `.BACKUP_ID.partial` using `status` before invoking the emitted `create --resume BACKUP_ID ...` continuation. Do not start another writer or delete a live lock. `--take-over-lock RUN_ID` needs its own explicit operator decision; this skill never adds it automatically.
3. Same-host resume uses the original trusted workspace identity. Cross-host partial resume additionally needs an independently retained `partialStateSha256` from trusted original status, `--trusted-partial-sha256` and the approved escrow identity path. Do not compute a new digest from the untrusted partial directory and call it trusted. If custody/trust is lost, report that resume is blocked; a fresh backup is a separate authorized action.
4. For restore/exercise, get a new preflight challenge for the **same** target/artifact. Preserve the exact original run identifier and original report path from the emitted resume command. Add `--resume RESTORE_RUN_ID` and replace the challenge placeholder with this fresh result; preserve exercise checks/canary custody. Never change targets or verification policy to bypass refusal.
5. Require authenticated journals, original binding/settings and the durable report. Completed chunk markers prevent duplicate loads; do not clear them or manually repair/truncate checkpoints. A completed receipt supports only the engine's matching cleanup retry, not a new restore run.
6. Report the resumed outcome from actual exit/result/report. On another interruption/failure, retain custody, workspace, journal, archive and quarantine. Do not auto-restart the command indefinitely.

Quiesced partial-backup reuse requires the same continuous PostgreSQL postmaster lifetime, source database and catalog proof. A server restart/replacement can refuse prefix reuse; preserve the old partial and request the appropriate new-backup decision instead of weakening the check. Failed verification never authorizes a fallback to Core's unprotected key rotation.
