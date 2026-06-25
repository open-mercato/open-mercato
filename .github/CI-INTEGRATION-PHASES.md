# CI Integration Phases

This document describes the proposed phased integration-test model for Open Mercato CI.

Status: design only. The current workflow behavior is unchanged until the linked spec is implemented.

Spec: [`.ai/specs/2026-06-05-phased-integration-ci.md`](../.ai/specs/2026-06-05-phased-integration-ci.md)<br>
Tracking issue: [#2588](https://github.com/open-mercato/open-mercato/issues/2588)

## Goals

- Keep normal PR habits unchanged: open a PR, push commits, wait for CI.
- Let maintainers request more integration coverage with one label.
- Always run the full suite before release.
- Keep standalone app coverage explicit without making every PR pay full standalone cost.

## Phases

| Phase | Runs when | What it runs |
|---|---|---|
| `baseline` | Every PR, including forks | Static gates plus affected integration specs that are not explicitly marked extended |
| `extended` | Non-fork PR with `extended-integration` label | Baseline plus tagged expensive regression suites such as undo, CrudForm matrix, optimistic-lock matrix, custom fields, queue/realtime, long request tests |
| `full` | Pushes to `develop`/`main`, shared fail-closed paths, every PR targeting `main` | All monorepo integration specs, sharded, with coverage |
| `standalone-sentinel` | Trusted PRs touching standalone-impact paths | Minimal installed-package/create-app smoke coverage |
| `standalone-full` | Develop snapshot/release pipeline, release PRs to `main`, and PRs explicitly dispatched with `NPM Snapshot Preview` | Full standalone app integration coverage |

## Maintainer Label

Use `extended-integration` when a trusted PR should run the extended phase before merge.

This label is additive. It does not replace `review`, `qa`, `merge-queue`, `needs-qa`, or `skip-qa`.

Adding or removing the label should rerun CI automatically once implemented.

## Release PR Rule

Every PR targeting `main` is treated as release-critical:

- monorepo integration phase: `full`
- standalone evidence: `standalone-full`
- no label required

This protects release PRs from relying on a maintainer remembering to add `extended-integration`.

## Fork Rule

Fork PRs run safe baseline checks only.

They must not run privileged npm snapshot publishing or trusted standalone flows. If a fork-originated change needs release/full standalone evidence, a maintainer should replay it from a trusted branch before merge.

## Package Preview Dispatch

Package publication previews are opt-in:

| Dispatch path | Workflow | Effect |
|---|---|---|
| Manual workflow dispatch, `gh workflow run`, or `om-auto-publish-pr` | `package-previews.yml` | Publishes pkg.pr.new previews for all public packages without publishing to npm |
| Manual workflow dispatch | `npm-snapshot-preview.yml` | Publishes the legacy npm canary snapshot and runs standalone-full validation |

Both preview workflows require a PR number and are restricted to trusted same-repository PR branches because they publish artifacts and use write-capable workflow credentials. Label triggers and comment slash-command routers are intentionally avoided: GitHub Actions creates workflow runs for every matching label/comment event before job-level filtering can happen, which clutters PR checks with skipped or no-op entries.

## Standalone-Impact Paths

The standalone sentinel should run for trusted PRs that touch:

- `packages/create-app/**`
- `packages/cli/src/lib/resolver.ts`
- `packages/cli/src/lib/testing/**`
- `packages/cli/src/lib/generators/**`
- public package `package.json` / `exports`
- `packages/create-app/template/**`
- bootstrap files consumed by standalone apps

## Safety Defaults

- Missing test metadata means `baseline`.
- Malformed test metadata includes the spec and warns.
- Unknown changed paths fall back to broader coverage.
- Release PRs to `main` always run full coverage.
- Full standalone remains required before release.
