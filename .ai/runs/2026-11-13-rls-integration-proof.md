# Enterprise RLS integration proof

Source doc: .ai/specs/enterprise/2026-11-12-row-level-security.md

## Goal

Complete the specification's authorized Phase 0 with repeatable disposable-database integration tests and published verification evidence.

## Scope

The latest committed spec is the assumed target because the request names no spec. Phase 0 already contains the connection adapter and operator proof. Automate that proof, verify fixture cleanup, and fix asynchronous teardown hazards. Phases 1–2 explicitly require a separate activation design and remain deferred. No application activation, production schema, public contracts, dependencies, or UI changes.

## Implementation Plan

### Phase 1: Repeatable integration evidence

1.1 Add bounded automated PostgreSQL integration execution with explicit disposable-database opt-in and fixture cleanup assertions.
1.2 Drain concurrent work before teardown, close pools before removing scope wrappers, and update operator/spec documentation.

### Phase 2: Verify and publish

2.1 Run unit tests, harness typecheck, real PostgreSQL integration checks, and the ordered repository gate with the local runner.
2.2 Review the complete diff, fix findings, and publish results as PR comments. No UI screenshot is applicable to the infrastructure-only scope.

## Risks

The test URL must identify a disposable PostgreSQL database with schema/role creation privileges. Tests create random fixtures and remove only their fixtures. Full-repository checks may expose environment or baseline failures; report them separately from targeted proof results. The prototype does not provide application-wide isolation.

## Progress

PR: #9424

> Convention: `- [ ]` pending, `- [x]` done. Append a commit SHA when a step lands. Do not rename step titles.

### Phase 1: Repeatable integration evidence

- [x] 1.1 Add bounded automated PostgreSQL integration execution with explicit disposable-database opt-in and fixture cleanup assertions. — 4349cbf789
- [x] 1.2 Drain concurrent work before teardown, close pools before removing scope wrappers, and update operator/spec documentation. — 4349cbf789

### Phase 2: Verify and publish

- [ ] 2.1 Run unit tests, harness typecheck, real PostgreSQL integration checks, and the ordered repository gate with the local runner.
- [ ] 2.2 Review the complete diff, fix findings, and publish results as PR comments.
