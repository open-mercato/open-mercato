# Durable authentication lifecycle audit

> **Program.** G1b of the [GDPR-ready deployments program](../../GDPR/2026-11-15-gdpr-ready-deployments-program.md), issue #8593. Enterprise `security` owns the history and retention. Any OSS producer seams require written DEC-2 carrier approval.

## TLDR

Persist scoped evidence for logout, password changes and completed resets, and applicable MFA changes. The security audit survives a collector outage after a successful operation and has its own scheduled retention. Sign-in attempt history and threshold alerts keep their separate owners.

## Problem statement

The baseline has auth and MFA events and sign-in/alert proposals. An emitted event or threshold alert is not a durable receipt proving that each sensitive operation occurred. The umbrella requires evidence for the underlying operations with a dedicated lifetime.

## Proposed solution

The staff `auth`, `customer_accounts` and Enterprise `security` mutation owners provide committed receipts for staff and portal logout, password change and reset completion, and each shipped MFA enrollment, removal, reset/recovery and bypass. Include controller-initiated operations and list which MFA methods are shipped before claiming coverage. The authenticated scope comes from the owning operation. Use a stable producer occurrence id. No receipt is based on raw request or event payloads and no delivered notification stands in for proof.

When protection is configured, use an approved transaction-aware optional seam for a durable owner receipt in the same transaction as the operation, or enqueue the receipt through an owner outbox written in that transaction. A committed receipt never depends on the collector being available. A failed operation cannot record successful evidence. Document how logout still clears credentials and safely revokes the session according to its owning contract when the store itself is unavailable. An emergency exception requires owner and maintainer approval under the program compatibility rules and must surface an observable incomplete audit state. Legacy OSS without the Enterprise carrier reports the history as unavailable. Do not silently switch an activated protected collector to a best-effort event.

## Architecture and data models

The producer accesses only its own state or an approved transaction-aware DI seam. The collector owns a scoped append-only `security_authentication_audit_events` store whose rows contain a UUID, tenant id, authoritative optional organization id, occurrence time, source/occurrence id, closed operation kind, outcome and actor/target opaque identifiers. Uniqueness across tenant, producer and occurrence id makes redelivery a no-op. Retain no password, hash, recovery code, token, email address, IP/user agent or request body in this store. Unconsumed receipts are not expired by normal history cleanup. Register the daily `security.authentication_lifecycle_history` record retention set owned by `security`, with a default of 365 days and a 90-day floor. Honor its scoped retention guard and holds. Stop and report the retention gap if its runner or owner receipt is unavailable.

Classify the history table as C5 `retention_bounded` against `security.authentication_lifecycle_history` in the owner’s `privacy.ts`. Register the matching C5 `retentionBounds` declaration and owner handler with exactly the same scope, cutoff, held/unsettled state, runner status and row-eligibility rules as actual deletion. Under DEC-9, extend the security-owned `securityPrivacyTableReader` and add the scoped C8 `tableExports` entry for the same table. Include its validated fields in scope and forbid foreign-tenant, borrowed-owner or generic table reads. Use an existing owner outbox where possible. A new owner receipt table ships with C5 `runtime_state` classification and a C8 runtime-state exclusion plus its owner scan/cleanup contract. Pending receipt state is observable and settled receipts are removed by their owner. Unclassified storage or incomplete evidence keeps program closure open.

Expose history only through an owner service with an explicit feature, trusted scope and organization enforcement. An organization-restricted reader cannot see tenant-wide rows unless its authorized scope permits them. Any API/UI beyond the program's current plan needs its own accepted contract and integration tests.

## Delta

### Capability: authentication-lifecycle-audit

#### ADDED Requirement: Durable, bounded authentication history

- WHEN a named operation commits and its collector is temporarily unavailable
- THEN the scoped receipt remains durable and the next collector pass imports it once
- WHEN another tenant or an unauthorized organization reader requests evidence
- THEN the operation's actor, target and occurrence remain inaccessible
- WHEN a settled row is past its configured retention cutoff
- THEN the owner’s scheduled pass deletes it only if no applicable hold or unresolved receipt prevents expiry

## Migration & Backward Compatibility

Add only the protected collector, store, feature and scoped receipt seams. Existing event names, payloads, signatures and routes continue. Any changed failure handling must follow the compatibility contract and its required operator migration notes. No historical evidence is synthesized from absent receipts.

## Risks and failure modes

A state change and receipt in separate transactions can leave permanent audit gaps. Keep the durable confirmation at the operation boundary and test the post-commit interruption. A compromised history reader could infer activity across organizations. Enforce owner scope on every query. Retention must account for pending receipts and holds so deletion cannot falsely complete. The Phase 7 evidence names any accepted scope exception.

## Implementation plan and acceptance

1. Inventory the real successful operation paths and shipped MFA variants with their owners. Obtain any written edition, route or failure-handling approvals required by the program. Ship the transaction-aware receipt, collection and idempotency before claiming durable coverage.
2. Deliver the additive migration and restrictive feature. Wire scheduled retention through the D3 base runner, then test default, audited scope, expiry and hold behavior. Test the actual C5 classification, effective bound, durable owner receipt state and C8 reader/exclusion scope, including missing reader or unconsumed receipt evidence. Document the audit and its availability in the G5 breach runbook.
3. TC-PRIVACY-AUTH-AUDIT-001 drives each applicable staff, portal and MFA operation through its real entry point. Exercise committed receipt with collector failure, duplicate deliveries and refused operations, scoped historical reads and scheduled expiry with current, held and unconsumed evidence preserved. Each integration test creates and cleans up its own tenants, organizations, users, credentials and records. Phase 7 requires all applicable operation families or written upstream disposition naming a narrower scope.

## Final compliance report

Design only. The proposed owner-local seams and Enterprise collector await the program’s approval and delivery gates. G1 and G2 retain their existing coverage and precedence.

## Changelog

### 2026-11-18

- Added a dedicated lifecycle evidence and retention carrier to close the security audit coverage gap.
