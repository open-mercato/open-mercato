# Audit and retire stale GitHub Actions registrations

## Goal
Remove unusable retired workflows from the active GitHub Actions catalog without deleting functioning CI, previews, deployment or release automation.

## Scope
Audit the 17 workflow files on main and release/v0.9.x against live branches, scripts, history and run evidence. Disable the retired registered workflows whose files are already deleted (Develop Release, replaced Canary Release and abandoned evals). Keep historical run logs. Rename the active snapshot display name to Main Snapshot Release while preserving its main trigger and develop npm compatibility channel. Commit an upstream audit report.

## Non-goals and risks
Do not dispatch deployment, release or publish workflows, delete run history, change branch protection/secrets/QA policy, or disable working feature-branch/GitHub-managed workflows. GitHub registration state is an administrative setting, not a file deletion; record exact IDs and read-back evidence. Snapshot release behavior and npm tags remain unchanged.

## Progress

PR: #8614

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Audit and source cleanup

- [x] 1.1 Record evidence-based workflow inventory and update the misleading snapshot display name. — f101d52c0
- [x] 1.2 Validate workflow syntax, snapshot compatibility and source references. — f101d52c0

### Phase 2: Administrative retirement and review

- [x] 2.1 Disable the three confirmed stale registrations and verify their state. — f101d52c0
- [x] 2.2 Run authoritative review, record evidence and publish the completed PR. — 8b616d246 (native COMMENT review 5753458284; no findings; CI pending)

## Evidence

Runner: local. All 17 YAML workflow files parse without errors; an AST comparison proves snapshot config differs only in its display name. Existing preview/release/provenance/snapshot regression suites passed 35/35. No application builds, deployment or release dispatches were needed. Registered workflow IDs238045838,226360510,297198728 were disabled through the authenticated GitHub API and read back as disabled_manually; no other catalog state changed. No run history was deleted.
