# Create, inspect and verify a backup

Load this procedure for `om-backup-database` source preflight, creation, status or offline verification; replace every example value with confirmed operator inputs before execution.

Examples use an installed `mercato-backup`. Substitute the already built checkout prefix established during runtime discovery when appropriate. Pass arguments literally; paths, service names and custody files below are examples, not defaults. No command here authorizes changing deployment settings or starting/stopping writers.

## Source preflight and creation

1. Confirm the selected source service and output/workspace/recipient paths are authorized. A backup request authorizes creation only within its selected scope; it does not authorize recovery writes or a readable archive.
2. Check the source before creation:

```sh
mercato-backup preflight --operation create --source-service source --json --progress json
```

Preflight checks source capability/metadata; it does not create a backup or prove quiescence. If it refuses, preserve its error and resolve that prerequisite rather than changing policy or privileges automatically.

3. Use encrypted creation with the approved public recipients. Include independent recovery custody. Pass `--quiesced` **only** after the operator-enforced stable writer window is established:

```sh
mercato-backup create --source-service source --output /srv/recovery/output --workspace /srv/recovery/private --recipients-file /srv/recovery/private/recipients --quiesced --json --progress json
```

Omit `--quiesced` only when an ordinary snapshot backup is the authorized goal and no stable window was claimed. If the user requested a quiesced recovery point or protected rotation prerequisite, a missing stable window blocks that goal; never quietly downgrade it. Record the returned consistency unchanged (`single-snapshot`, `quiesced`, or `multi-snapshot`). Do not claim that an ordinary or interrupted multi-snapshot artifact is a quiesced recovery point.

4. Preserve the returned `backupId`, `artifactPath`, `manifestSha256`, consistency and encryption. Retain the creation digest through the user's trusted channel independently of mutable archive storage. If requested, `--report /absolute/private/new-report.json` writes the existing command envelope to a new private report path; never overwrite an existing report.
5. Verify the created artifact when that step is requested/within the authorized backup acceptance workflow and the approved recovery identity is available. Otherwise report **created, not verified**, name the missing verification prerequisite, and retain everything. Do not silently read or invent an escrow identity.

Creation copies stored database values, including application ciphertext; it does not recover application keys. Coverage excludes external files/attachments/object stores, Vault state, Redis, WAL and cluster-global roles. Unsupported relation/type/snapshot conditions refuse rather than grant partial whole-database assurance. Do not suppress exclusions or widen claims.

## Status is inspection, not resume

Inspect a completed artifact or the exact existing partial directory:

```sh
mercato-backup status /srv/recovery/output/BACKUP_ID --json --progress json
mercato-backup status /srv/recovery/output/.BACKUP_ID.partial --workspace /srv/recovery/private --json --progress json
```

Supply the original workspace or approved `--identity-file` for decrypted per-entity state when authorized. For a complete artifact, supply its independently trusted `--trusted-manifest-sha256` when available. Without custody, public aggregate checkpoints remain advisory; observed metadata/digests never establish trust. State inspection does not repair a torn journal, remove a lock or authorize resumed writes.

Keep entity labels and raw status output private. Return only necessary identifiers, aggregate counts, consistency, actual state and the safe next action. A reported `resumable` state is not `completed` and does not itself authorize continuing the run.

## Offline artifact verification

Require the original trusted creation digest or another independent trusted digest and the approved archive identity path. A digest computed from the artifact under inspection is not an independent trust anchor. Verify without a database target:

```sh
mercato-backup verify --artifact /srv/recovery/output/BACKUP_ID --trusted-manifest-sha256 TRUSTED_DIGEST --identity-file /srv/recovery/private/escrow.identity --workspace /srv/recovery/private --json --progress json
```

Validate that `TRUSTED_DIGEST` is the expected 64-character SHA-256 hex value before invocation. The current `verify` command performs full artifact integrity verification, including schema inspection with matching PostgreSQL tools; it does not perform a database restore. Never label this application-level or key-recovery verification. Restore's `--verify-mode` option is a separate recovery policy, not a way to weaken this verification.

A missing/damaged chunk, wrong digest, bad identity or schema failure is non-zero. Preserve the artifact and custody. Do not repair the source archive, substitute an observed digest, retry without encryption, or continue to restore after verification refusal.

## Output and plaintext policy

For automation use `--json --progress json`, capturing stdout and stderr separately. Parse the single stdout result and every nonempty stderr line; both streams use schema version 1. Status/preflight may produce no progress records on success. Never merge streams or parse colors/emojis as evidence.

Default progress is a human TTY panel or append-only plain output. `--progress plain`, `--progress none`, `NO_COLOR` presence (including empty) and `TERM=dumb` preserve the same command semantics; none mode suppresses live progress, not actionable failures. Existing-schema `phase.changed` records carry error/warning notices in JSON progress mode; no human prompts/banners belong in that stream.

Never add `--no-encryption` to recover from an error. If the user specifically authorized readable whole-database output and existing policy permits it, preserve the CLI's explicit confirmation requirement: JSON progress never prompts, so it needs explicit `--confirm-unencrypted`. `OM_BACKUP_REQUIRE_ENCRYPTION=true` still refuses plaintext even with confirmation; do not override that policy. State the confidentiality loss and preserve the returned `UNENCRYPTED` warning.
