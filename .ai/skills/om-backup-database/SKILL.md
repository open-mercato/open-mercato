---
name: om-backup-database
description: Operate Open Mercato Enterprise encrypted PostgreSQL backups and isolated recovery with the installed CLI. Use for "back up the database", "verify a backup", "resume backup or restore", "rehearse recovery", "zrób kopię bazy", or "zweryfikuj i odtwórz kopię". Preserve explicit target authorization, key custody and quarantine.
---

# Back Up Database

Create or inspect an encrypted database backup, verify its artifact, or perform an explicitly authorized isolated restore/exercise. Report the actual outcome and retained recovery material. This is an operator skill; it does not implement features, provision infrastructure or change the tracker.

## Inputs

- Requested action: `configure`, `preflight`, `create`, `status`, `verify`, `restore`, `exercise`, or resume of a named existing run.
- Deployment/installation, named libpq source or target service, and absolute operator-owned artifact/output/workspace paths as needed.
- Public recipient-file path for creation; archive identity-file path and independently trusted manifest digest for verification/recovery.
- For recovery: the explicitly authorized target/action and checks-file path when exercising recovery.
- For resume: the original run identifier, exact emitted resume command and its authenticated original custody/settings.
- Resolve available values from the current authorized session. Ask only for missing information that changes the operation; never ask for key bytes or credentials in chat.

## Workflow

0. **Load setup and rules** — read `references/agentic-setup.md` and `references/rules.md` on every invocation.
   This skill uses no tracker operations or agent-pipeline configuration. Its bundled references work without a repository checkout.
1. **Resolve the request.** Distinguish inspection, new backup, isolated recovery and resume before executing anything. A generic backup request does not authorize restore, target writes, plaintext output or key rotation. Reuse specific authorization already given; do not add another approval round for the same target/action.
2. **Discover the installed runtime.** Follow `references/agentic-setup.md`: locate the standalone executable, inspect supported help and actual package/runtime versions, run read-only `configure`, and validate the selected private-file paths. Do not run a build, installation, generation, migration or container startup to make discovery succeed.
3. **Choose the operation below.** Load the referenced procedure and fill its parameters from verified inputs. Keep source and target identities distinct. If the requested capability or a required input is unavailable, report the concrete blocker before any mutation.
4. **Run preflight for database operations.** Use the selected procedure's read-only database checks. Bind recovery to the actual target/artifact and a fresh challenge. Do not treat successful preflight as backup, verification, recovery or permission to change the target.
5. **Execute only the authorized action.** Pass arguments as quoted values/argument arrays. Preserve CLI guards, custody, encryption policy, deadlines, resource limits and exit codes. Use standalone JSON output for automation; keep stdout and stderr separate.
6. **Handle completion or interruption.** Parse the actual exit status and schema-versioned result. Follow the resume procedure only for the matching authorized run. Stop on a trust, identity, quiescence, integrity, lock or confirmation refusal; never bypass it to complete the task.
7. **Report accurately.** Follow `references/reporting.md`. Separate creation, artifact verification, restored data and application-key recovery. Keep local custody and quarantine intact; report remaining operator work without promoting a target or retiring keys.

## Operation routing

| Requested work | Load and follow |
| --- | --- |
| Inspect OS/container defaults and missing prerequisites | `references/agentic-setup.md` — configuration plan |
| Check source readiness or create an encrypted artifact | `references/backup-and-inspection.md` — creation |
| Inspect completed/partial state without resuming it | `references/backup-and-inspection.md` — status |
| Authenticate a completed artifact without target writes | `references/backup-and-inspection.md` — verification |
| Restore into the explicitly selected isolated target | `references/recovery-and-resume.md` — restore |
| Rehearse recovery with declarative checks/canaries | `references/recovery-and-resume.md` — exercise |
| Continue an interrupted create, restore or exercise | `references/recovery-and-resume.md` — resume |
| Produce a sanitized local result or handoff | `references/reporting.md` |

## Hard boundaries

- Honor existing specific user authorization. Obtain missing exact target/action authorization before recovery writes; a backup/verification request supplies none.
- Obtain a fresh CLI target confirmation for each restore/exercise attempt, including resume; authorization never substitutes for that technical guard.
- Treat `--quiesced` as a declaration of an independently enforced stable window, never a mechanism that stops writers. If that window is not established, do not pass it or claim quiesced recovery.
- Keep archive identities, application roots/DEKs and historical versions separate. Pass private file paths to the tool; do not display secret contents.
- Retain prior keys, public-recipient configuration, pre-rotation artifacts, partial journals, workspace identities and quarantined targets according to operator policy. Success never authorizes deletion, promotion or key retirement.
- Never silently retry with `--no-encryption`, change encryption requirements, take over a live lock, rewrite a journal, reset trust, or accept Core's unprotected key-rotation risk.
- Never fabricate a trusted digest by hashing the artifact being verified. Use the original trusted creation result or an independent trusted channel.
- Do not upload backups, database dumps/volumes, keys, identities, private workspace contents or raw logs. Return small sanitized aggregate reports only.
- Do not mutate tracker state, source code, CI, installations, license settings or deployment infrastructure as a side effect of this skill.
- Shared operator rules: `references/rules.md`.

## Automation output

Use the standalone `--json --progress json` contract for automated runs: stdout is the command result and stderr contains independent progress/notices. Never combine them.
Accept success only when the actual exit status and machine result agree. An advisory status checkpoint, partial file or green progress line cannot authorize continuation.
A refused or interrupted operation retains its original state and custody; report it rather than manufacturing a success result or silently starting a different run.

## Completion contract

A completed command is only the assurance that command actually establishes. Check the machine result and, for recovery, its durable report. Preserve `quarantined: true` and `promotionReady: false`. Return actual state, run/artifact/report identifiers, completed checks, remaining limits and an exact safe next action; never infer success from a green terminal line.
