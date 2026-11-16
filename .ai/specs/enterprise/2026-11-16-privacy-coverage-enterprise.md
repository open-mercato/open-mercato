# Privacy coverage: enterprise modules

> **Program:** a coverage spec of [`../2026-11-15-gdpr-ready-deployments-program.md`](../2026-11-15-gdpr-ready-deployments-program.md) (tracker open-mercato/open-mercato#8593), for the enterprise modules `sso`, `security`, `agent_orchestrator` and `record_locks`.
> **Builds on:** [`../2026-11-16-privacy-data-class-contract.md`](../2026-11-16-privacy-data-class-contract.md) and [`../2026-11-16-privacy-subject-erasure.md`](../2026-11-16-privacy-subject-erasure.md), including their addenda, and [`../2026-11-16-privacy-table-coverage.md`](../2026-11-16-privacy-table-coverage.md). The governance module's own rows are covered in [`2026-11-16-privacy-dsr-engine.md`](2026-11-16-privacy-dsr-engine.md).
> **Verified at** `main` @ `08dada9624` by reading each module's entities, services and its own rules; nothing was run. The contents of agent spans and tool-call columns, the layout of offloaded traces, and how a human's decision is written on a proposal were not read.
> **Written autonomously.** No question was put to a person; the choices are listed under Resolved assumptions.

Extends: .ai/specs/2026-11-16-privacy-data-class-contract.md
Extends: .ai/specs/2026-11-16-privacy-subject-erasure.md

## 📝 TLDR

When a staff user is deleted, their single-sign-on identity, their MFA secrets and recovery codes, their step-up sessions and their record locks all stay. The one subscriber that was meant to remove the SSO identity reads a field the event does not carry. Agent runs hold whatever was fed to an agent about a customer and whatever it answered, copied into a dozen places, in rows the module's own rules say must never be changed. **Proposed (future):** for `sso`, `security` and `record_locks`, a data class each: a staff user's identities, secrets and sessions are deleted outright, after every other class has run and only once the run has confirmed it will not be refused. For `agent_orchestrator`, this document sets out what erasing a customer would have to clear and puts the question to a person, because it means changing audit records.

**Not in this spec:** the sign-in log and known devices of the 11-13 spec, which are added to the `security` class when they are built; repairing the broken subscriber, which is required and specified in program package A9.

**Checked on 2026-11-16: the SSO subscriber deletes nothing.** It passes an undefined user id into one update and two delete statements (`sso/subscribers/user-deleted-cleanup.ts:25-33`). MikroORM 7.1.14 turns an undefined condition into `"user_id" is null` — `ignoreUndefinedInQuery` is off by default and the repo does not set it — and `user_id` is `not null` on all three tables, so each statement matches zero rows. The statements were generated against a stubbed connection; no database was used. So deleting a user removes no other user's rows, and it also removes none of the deleted user's: identity, role grants and deactivations stay. Sign-in repairs the identity on the next attempt with that subject (`accountLinkingService.ts:80-84`); nothing removes the grants or deactivations. The characterization test in Phase 1 freezes this, and must fail if the config ever sets `ignoreUndefinedInQuery`, because that setting would turn the same code into a delete of every row.

**The subscriber must be fixed.** The requirement is in the program spec under [A9 — required fix](../2026-11-15-gdpr-ready-deployments-program.md#a9--required-fix): read `id`, send no statement without one, clean up the rows earlier deletions left, and test with the payload the event really carries. The `sso` class in this spec does not replace that fix. The class runs only in an erase run; an ordinary user deletion relies on the subscriber.

## 📝 Resolved assumptions (autonomous defaults)

| # | Question | Chosen | Rationale |
|---|---|---|---|
| 1 | SSO identities, role grants, MFA methods, recovery codes, challenges, step-up sessions | Hard-deleted, as the last classes to run | They are credentials and links for one account. Soft deletion leaves the secret in the table. Deleting them before the run is sure to finish could leave a live administrator with no second factor. |
| 2 | Agent records about a customer | Not decided. Option A, the default: nothing is cleared; the records are reported as retained evidence and bounded by a retention period the module gains. Option B: content is cleared from every store listed below | ⚠ NEEDS HUMAN CONFIRMATION. The module's rules make runs, spans, tool calls, corrections and evaluation results append-only. The content is copied into evaluation cases, guardrail evidence, context bundles, artifacts and offloaded traces; clearing some and not others is worse than clearing none. |
| 3 | A staff user who triggered, was assigned, corrected or decided | Left as an id | Who acted is the audit record. |
| 4 | An agent's own account | The run is refused in pre-flight | It is a service account. Deleting it through the person route would break the agent and remove nothing about a person. |
| 5 | Delegation grants a user gave to an agent | Revoked, and kept | A grant is the evidence of the authority an agent acted under. Revoking stops it working; the row stays. |
| 6 | Record locks | The user's lock rows are deleted. Conflict rows, which involve a second user, are left to the module's clean-up, which is changed to remove rows instead of hiding them | Deleting a conflict would drop the other person's pending conflict. |
| 7 | SSO rows with no tenant | Matched by user id and by organization, after the owner's pre-flight check has confirmed that the user belongs to the tenant | Every SSO table has an organization. Without the owner's check, a run for one tenant naming another tenant's user would delete that user's identities. |

## 📝 Problem Statement

| Module | What it holds about a person | Linked by | Today |
|---|---|---|---|
| `sso` | Identity: subject, email, name, groups, external id; role grants; deactivations; the provisioning log with external ids | `user_id` on the first three; by value in the log. Tenant may be empty on every table | Identities are soft-deleted when unlinked. Grants and deactivations are deleted only by the subscriber that never runs correctly (`sso/subscribers/user-deleted-cleanup.ts:11-33`) |
| `security` | MFA methods with the TOTP secret in clear, an email for email codes, passkey data; recovery-code hashes; challenges; step-up sessions with their token in clear | `user_id` | Methods are soft-deleted; recovery codes are marked used and kept; challenges are never deleted; expired step-up sessions have a clean-up nothing calls |
| `agent_orchestrator` | See the list of stores below | A customer by the process's subject type and id — processes about their deal, order or claim, the common case, do not name them. A staff user by ids, one of them inside a JSON column. Runs have no user column | Five kinds of row are append-only by the module's rules (`agent_orchestrator/AGENTS.md:169-229`). Full traces are offloaded to object storage, whose service can upload and download and cannot delete (`lib/trace/artifactStore.ts:50-59`). No retention exists |
| `record_locks` | The locking user, their address, who released | `locked_by_user_id` | Rows are soft-deleted after days and never removed (`record_locks/lib/recordLockService.ts:49-51, 1404-1413`) |

- **No module here has an encryption map** except `agent_orchestrator`.
- **A SCIM-provisioned person always has a user**, so no new subject kind is needed.
- **`agent_principals.user_id` is the agent's own account**, a real row in the users table.
- **Where agent content lives.** Run input and output; proposal payloads; corrections' proposed and corrected values; evaluation cases' input and expected output, copied from runs and corrections (`agent_orchestrator/data/entities.ts:468-499`); evaluation results' and guardrail checks' evidence; tool-call summaries and span attributes (`:309, 351-354`); context-bundle sources and their payload references (`:1203-1228`); run artifacts (`:1716-1720`); session outcomes; a process's label, title, input and facets; offloaded traces.
- **Reference-only columns elsewhere**: who enforced an MFA policy, who configured step-up, who created a SCIM token.
- **Fixtures exist.** SCIM creates identities with no identity provider (`sso/__integration__/api/TC-SSO-003-scim-user-lifecycle.spec.ts`), and agent processes have API tests (`agent_orchestrator/__integration__/TC-AGENT-CASELOAD-010.spec.ts`).

## 📝 Proposed Solution

### Classes

| Class | Subject kinds | Group | On erasure |
|---|---|---|---|
| `sso.identities` | `auth:user` | Credentials | Identities, role grants and deactivations **deleted** outright, soft-deleted rows included. Provisioning-log entries for that user **deleted** |
| `security.credentials` | `auth:user` | Credentials | MFA methods, recovery codes, challenges and step-up sessions **deleted** outright |
| `record_locks.locks` | `auth:user` | Records | The user's lock rows **deleted** |
| `agent_orchestrator.principals` | `auth:user` | Records | Refuses in pre-flight when the user is an agent's account. Otherwise: grants the user gave are **revoked** and **retained** as evidence; their ids elsewhere stay |
| `agent_orchestrator.records` | `customers:person` | Records | Option A: **retained** as evidence. Option B: see below |

Exports follow the same finds, with secrets left out: an MFA method by type, label and date; an identity by provider and the identifiers it holds; an agent process about a customer by its agent, dates and outcome, with its content.

`agent_orchestrator.principals` is separate from `.records` so that a staff user's erasure does not wait for the open question about customers' content.

### The agent's own account

`agent_orchestrator.principals` implements the erasure addendum's read-only check. For a user who is an agent's principal it refuses, naming the agent, and the run does not start for that subject.

### Agent records about a customer

**Option A — the default.** Nothing is changed by an erasure. The class exports the customer's processes and reports them as retained evidence. The module gains a retention period for finished processes and everything under them, as a retention set for the enterprise engine, so that "retained" has an end.

**Option B.** An erasure clears content, and only content, in every store listed in the problem statement, for processes whose subject is the customer; rows, ids, timings and outcomes stay. It needs:

- the module's guide to name each append-only kind and the one exception;
- a delete operation on the trace storage service;
- storage keys kept on the row until the deletion of their object is confirmed, so that a re-run can still find them;
- evaluation cases derived from the cleared runs to be cleared or withdrawn from evaluation sets.

Either way, a process about the customer's deal, order or claim is not found by the customer's id.

### Record-lock clean-up

The module's existing clean-up removes the rows it now only hides, thirty days after hiding them.

### Design decisions

| Decision | Rationale |
|---|---|
| Hard delete for credentials, last | See assumption 1. |
| Two agent classes | A staff user's erasure must not depend on the undecided question. |
| Grants are revoked, not deleted | See assumption 5. |
| The refusal is a pre-flight check | A class that runs among many cannot make the run "change nothing" once others have acted. |
| Rows with no tenant need the owner's confirmation first | See assumption 7. |

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| Clear only run input and output | The same content is in evaluation cases, evidence, bundles, artifacts and traces. |
| Delete agent runs | Evaluation history and cost accounting depend on them. |
| Soft-delete credentials, as today | The secret stays in the table. |
| Delete a user's delegation grants | See assumption 5. |
| Delete conflict rows with the user's locks | They belong to two people. |
| Match SSO rows by user id alone | See assumption 7. |

### Known limits

- A customer mentioned in a run that belongs to a process about someone else is not found.
- A run with no process is tied to nobody.
- A staff user's id inside a JSON column is left where it is.
- A customer's data in a process about their deal, order or claim is not reached by either option.

## 📝 Delta

### Capability: privacy-coverage-enterprise

#### ADDED Requirement: Export of enterprise records
The system SHALL include in a staff user's export their single-sign-on identities, the kinds of MFA they have set up, and their record locks, and in a customer's export the agent processes run about them.

##### Scenario: MFA
- WHEN a user with a TOTP method is exported
- THEN the method's type and date appear and its secret does not

#### MODIFIED Requirement: Erasure of a staff user's credentials and identities
The system SHALL, when a staff user is erased, delete their single-sign-on identities and grants, their MFA methods, recovery codes, challenges and step-up sessions, and their record locks, leaving no row, and SHALL do so only after the run has confirmed that no class refuses.

##### Scenario: Identity
- WHEN a user with an SSO identity is erased
- THEN no identity, grant or deactivation row for them exists, including soft-deleted ones

##### Scenario: MFA secret
- WHEN a user with MFA is erased
- THEN no method, recovery code, challenge or step-up session of theirs exists

##### Scenario: Refused elsewhere
- WHEN another class refuses the user in pre-flight
- THEN their MFA methods and identities are untouched

##### Scenario: Another tenant's user
- WHEN a run for one tenant names a user of another
- THEN the owner's check stops it and no identity is deleted

Frozen by: `packages/enterprise/src/modules/sso/__tests__/user-deleted-cleanup.characterization.test.ts`

#### ADDED Requirement: An agent's account
The system SHALL refuse to erase a user that is an agent's own account, before anything is changed.

##### Scenario: Refused
- WHEN erasure is requested for an agent's account
- THEN nothing changes and the run names the agent

#### ADDED Requirement: Agent records about a customer
The system SHALL export the agent processes run about a customer, and on erasure SHALL report them as retained evidence.

##### Scenario: Retained
- WHEN a customer with an agent process is erased
- THEN the process is unchanged and the run reports it as retained

## 📝 Architecture

- `sso`, `security`, `record_locks`: `privacy.ts`, a handler under `lib/privacy/`, its registration, table declarations — including the reference-only columns — and the group each class runs in.
- `agent_orchestrator`: two classes; the pre-flight check; under option A, a retention set.
- `record_locks`: the clean-up's second step.

| Touchpoint | Mechanism | Absent |
|---|---|---|
| Run → enterprise classes | The data-class registry | Module disabled by its flag: no class |
| SSO class → "is this user in the tenant" | The owner's pre-flight check, which runs before any class acts | The run does not start |
| `agent_orchestrator` → a customer | Its own process table's subject columns | — |

## 📝 Data Models

No new table or column under option A. Indexes on `user_id` where a class looks up by it and none exists; each step lists them.

## 📝 API Contracts

- Uses the erasure addendum's read-only check, the two groups and the `evidence` reason. Adds no contract member.
- No route changes.

## 📝 Edge Cases & Failure Scenarios

| Case | Behaviour |
|---|---|
| An identity with no tenant | Matched by user id; see assumption 7 |
| A user provisioned by SCIM and deleted here | The identity provider may provision them again; the docs say erasure must be mirrored there |
| A grant the user gave to an agent | Revoked; the agent can no longer act under it |
| A conflict between the erased user and a colleague | Left; removed by the clean-up thirty days after it is hidden |
| A lock currently held by the user | Deleted; the record becomes unlocked |
| A first-group class fails | The account stays locked and its MFA and identities intact; a re-run continues |
| A step-up session in use | Deleted; the next protected action asks again |
| A customer with processes in two organizations | Both are found within the tenant |

## 📝 Migration & Backward Compatibility

Additive. Record-lock rows hidden more than thirty days ago start being removed; nothing reads them. The agent module's rules are unchanged under option A.

## 📋 Phasing

Each class ships its export and erase together.

| Phase | Outcome | Depends on |
|---|---|---|
| 1 | The characterization of the SSO subscriber; record-lock clean-up | — |
| 2 | `sso`, `security`, `record_locks`, and `agent_orchestrator.principals` | Erasure spec, Phase 3, and its addendum |
| 3 | `agent_orchestrator.records` under option A, with the module's retention set | The record-retention spec; the engine |
| — | Option B | A person's decision on assumption 2 |

## 📋 Implementation Plan

### Phase 1
1. **Characterize** what the SSO subscriber does when a user is deleted today, with a second user's identity present: no row of either user changes. Assert the generated condition is `"user_id" is null`. Commit alone. The fix is required by program package A9, which turns this test into its regression test.
2. The second clean-up step in `record_locks`. Unit tests with a clock.

### Phase 2
1. One step per module: the class with its group, tables, export sections with secrets left out, the erase, and the table declarations. Unit tests per outcome: soft-deleted rows; an identity with no tenant; another tenant's user; a refusal elsewhere.
2. `agent_orchestrator.principals`: the pre-flight check; revoking grants. Unit tests.
3. Integration tests TC-PRIVACY-ENT-001 and 002.

### Phase 3
1. `agent_orchestrator.records`: export, and the retained report. The retention set for finished processes.
2. Integration test TC-PRIVACY-ENT-003; the declared tables leave the coverage baseline; fixtures join the verification suite.
3. Archive this Delta into `.ai/specs/capabilities/privacy-coverage-enterprise.md` if that directory has been adopted by then.

| File | Action |
|---|---|
| `packages/enterprise/src/modules/{sso,security,agent_orchestrator,record_locks}/{privacy.ts,lib/privacy/*,di.ts}` | Create / modify |
| `packages/enterprise/src/modules/record_locks/lib/recordLockService.ts` | Modify |
| `packages/enterprise/src/modules/sso/__tests__/user-deleted-cleanup.characterization.test.ts` | Create |
| `packages/enterprise/src/modules/{security,sso,agent_orchestrator}/__integration__/TC-PRIVACY-ENT-00{1,2,3}.spec.ts` | Create |

## 🧪 Integration Coverage

In the enterprise test environment. After a user is erased their own routes are unobservable, so the tests check by direct query.

| Test | Covers |
|---|---|
| TC-PRIVACY-ENT-001 | A user with an MFA method and a record lock is exported: both appear, with no secret. After erasure a direct query finds no method, recovery code, challenge, step-up session or lock row of theirs |
| TC-PRIVACY-ENT-002 | A user provisioned through SCIM, with the existing fixture, is erased: no identity or grant row remains, and a second user's identity is untouched. Erasure of an agent's account is refused before anything changes |
| TC-PRIVACY-ENT-003 | A customer with an agent process, created through the module's API, is exported with the process; after erasure the process is unchanged and reported as retained |

## 📝 Risks & Impact Review

#### A customer's data stays in agent records
- **Scenario**: Under option A, an erased customer's details remain in runs, evaluation cases and traces.
- **Severity**: High
- **Affected area**: erasure completeness
- **Mitigation**: Reported as retained; bounded by the module's new retention period; assumption 2 puts the alternative to a person.
- **Residual risk**: Until the retention period passes, the data is there.

#### An administrator is left without a second factor
- **Scenario**: MFA and identities are deleted and the run then stops.
- **Severity**: High
- **Affected area**: the account being erased
- **Mitigation**: The pre-flight check; these classes run last; the account is locked first.
- **Residual risk**: A failure inside the credentials group; a re-run continues, with the account locked meanwhile.

#### A provider re-creates the user
- **Scenario**: The identity provider still lists the person and provisions them again.
- **Severity**: Medium
- **Affected area**: SSO tenants
- **Mitigation**: The docs; the dry run notes that the user is provisioned by SCIM.
- **Residual risk**: Outside the product.

#### A lock is deleted under someone's hands
- **Scenario**: The erased user held a lock at that moment.
- **Severity**: Low
- **Affected area**: one record
- **Mitigation**: The user is being removed; nobody else held it.
- **Residual risk**: None.

## Final Compliance Report — 2026-11-16

- **Reviewed:** root `AGENTS.md`, `.ai/specs/AGENTS.md`, the agent orchestrator's guide as reported by the research.

| Rule | Status | Notes |
|---|---|---|
| Enterprise scope in the enterprise specs directory | Compliant | — |
| No cross-module table access | Compliant | Each class in its own module |
| The agent module's append-only rule | Compliant under option A | Option B would need a documented exception |
| Tenant scoping | Compliant, with a stated rule | Rows with no tenant are matched by a tenant-checked user id |
| Integration coverage | Compliant | Three tests, using existing fixtures |

**Verdict:** Phases 1 and 2 approved as a design. Phase 3 follows option A unless a person chooses B.

## Changelog

### 2026-11-16
- SSO subscriber checked: it matches zero rows rather than every row. The opening note and Phase 1 step 1 now state the verified behaviour.
- The opening note now says the subscriber must be fixed and points to the requirement in the program spec.
- Written autonomously with resolved assumptions.
- Revised after independent review. Credentials and identities are deleted last, behind a read-only check, because deleting them before the owner could refuse would leave a live administrator without a second factor. Matching SSO rows with no tenant by user id alone was unsafe and now depends on the owner's confirmation and the organization. The agent module is split in two: a class for staff users, which refuses an agent's account in pre-flight and revokes grants instead of deleting them, and a class for customers, whose default is now to retain and report — the first draft's list of content to clear missed evaluation cases, evidence, context bundles, artifacts and more, and the storage service cannot delete. Conflict rows are left, since they involve a second user. Tests use the SCIM and agent fixtures that exist. A characterization of the SSO subscriber comes first, because it may be deleting far more than intended today.
