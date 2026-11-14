# Report actual operator results

Load this reference at the end of `om-backup-database` work, including incomplete or blocked operations; return a small sanitized local summary rather than publishing operational artifacts.

Parse command exit status together with the actual stdout envelope. With `--json`, stdout is one schema-version-1 result; progress/error notices remain independent schema-version-1 records on stderr with `--progress json`. Human-mode failures may have no stdout result. Never concatenate streams, infer success from ANSI/emoji, or require nonempty progress for a read-only command that emitted none.

Use these existing fields when present: `command`, `runId`, `backupId`, `restoreRunId`, `status`, `error.code`, `warnings`, `artifactPath`, `manifestSha256`, `consistency`, `encryption`, `reportPath`, `partialStateSha256`, and the exact emitted `resumeCommand`. For recovery inspect the durable report's target/manifest binding, loaded/expected counts, validation/check results, key-recovery status, quarantine and promotion flags. Preserve unknown/absent fields honestly; never fill them with intended values.

Existing command exit categories are 0 success, 2 usage/input refusal, 3 policy/preflight refusal, 4 integrity/authentication failure, 5 resource/interruption-related engine failure, and 6 recovery validation failure; SIGINT/SIGTERM use 130/143. The actual result's `resumable`/`interrupted` state and authenticated context control continuation; a numeric category alone does not prove safe resume. Preserve unknown codes rather than remapping them to success.

Use a compact report like this, omitting unavailable fields:

```text
Outcome: created / artifact-verified / restored-in-quarantine / exercised / resumable / refused / failed / blocked
Operation and runtime: actual command, installed package/Node/PostgreSQL versions
Scope: authorized service/target, artifact/run IDs, actual consistency and encryption
Evidence: exit code, durable report path, aggregate counts and checks that actually passed
Limits: creation is not verification; artifact verification is not restore or application-key recovery
Retained: archive, original workspace/journal, escrow paths and prior application keys remain private
Next: exact matching resume/preflight action or concrete missing prerequisite
```

Do not expose passwords, URLs with credentials, archive identities, application keys, row values, plaintext canaries, tenant labels, private service-file contents or raw logs. Keep detailed command captures in authorized private storage. Abbreviate local paths in a shared summary when appropriate; retain the exact private command separately so the operator can copy it without a broken quoted path.

Return the report to the user/local workflow. This skill does not post PR comments, create issues, attach evidence or alter labels. Only a separate explicit sharing request may publish a reviewed small sanitized report/screenshot. Never upload archives, backups, database dumps/volumes, identity files, private workspaces or keys.

A refusal caused by missing tooling, commercial rights, trust, custody, target authorization or quiescence is a concrete blocker, not permission to install, lower policy, invent a digest or choose another database. Name the smallest missing prerequisite and preserve state. Do not describe a failed or skipped check as passed.
