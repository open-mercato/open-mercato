# Audit and retire stale GitHub Actions registrations

## Goal
Remove unusable retired workflows from the active GitHub Actions catalog without deleting functioning CI, previews, deployment or release automation.

## Scope
Audit the 17 workflow files on main and release/v0.9.x against live branches, scripts, history and run evidence. Disable the retired registered workflows whose files are already deleted (Develop Release, replaced Canary Release and abandoned evals). Keep historical run logs. Rename the active snapshot display name to Main Snapshot Release while preserving its main trigger and develop npm compatibility channel. Commit an upstream audit report.

## Non-goals and risks
Do not dispatch deployment, release or publish workflows, delete run history, change branch protection/secrets/QA policy, or disable working feature-branch/GitHub-managed workflows. GitHub registration state is an administrative setting, not a file deletion; record exact IDs and read-back evidence. Snapshot release behavior and npm tags remain unchanged.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Audit and source cleanup

- [ ] 1.1 Record evidence-based workflow inventory and update the misleading snapshot display name.
- [ ] 1.2 Validate workflow syntax, snapshot compatibility and source references.

### Phase 2: Administrative retirement and review

- [ ] 2.1 Disable the three confirmed stale registrations and verify their state.
- [ ] 2.2 Run authoritative review, record evidence and publish the completed PR.
