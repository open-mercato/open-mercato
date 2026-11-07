# Private next-interaction projections

Status: implemented; deployment, live QA and human compatibility approval remain pending.
Subject: #8888. Builds on the owner-only policy in `2026-08-25-crm-channel-shared-visibility.md`.

## Problem

`recomputeNextInteraction` copies a planned private email subject into the parent
CustomerEntity. People/company reads, the next-interactions dashboard and search
can expose that viewer-independent value to readers who cannot read the email.
Historical undo payloads can also restore an old projection after privacy changes.

## Scope and decisions

Keep scheduling, ordering, references, icons and colors unchanged. An explicit
private email contributes no subject (`nextInteractionName = null`) to the shared
projection, including when the current viewer is the owner or can currently read
it through a conversation/channel grant. Those grants are reversible and are not
stable authorization for a viewer-independent stored string. Authorized email
readers continue to see the original subject in the interaction views. Explicit
shared emails, legacy NULL visibility and non-email interactions keep their names.
No admin private-mail bypass is introduced.

Before person/company create-redo, update-undo and delete-undo restore a linked
name, query its current interaction metadata with entity, tenant and organization
scope. Private or unresolved references lose the historical name; manual names
with no reference remain unchanged. Snapshots and private undo payloads stay intact
in storage. A missing reference fails closed even if the old snapshot claimed it
was public; scheduling metadata is retained.

An idempotent, forward-only data migration clears existing names attached to
private or unresolved references. It preserves public/legacy/non-email and manual
names and leaves timestamps alone. It declares the existing query-index rebuild
obligation for customer entities and both profile types. It does not change the
schema, so no ORM snapshot changes are required. Migration SQL treats encrypted
names as opaque values and only clears them; no crypto format or key changes.

## Migration & Backward Compatibility

Response keys and types remain unchanged; private/unresolved shared projection
names become NULL. Clients should use their existing unnamed-interaction fallback
and the authorized interaction endpoints for subjects. Operators apply the data
migration through the normal release process and wait for its declared query-index
rebuilds before restoring access to affected reads. If a separately configured
fulltext/vector provider has indexed these fields, rebuild the affected profile
entities with the existing search reindex operation and verify stale subjects are
gone before reopening search. No startup command, environment setting, dependency,
architecture or permission grant changes. Rollback never restores leaked names.

The compatibility ledger records this security narrowing and requests the emergency
security exception; a named human maintainer must acknowledge the waiver before
merge. Keeping old private names as a compatibility bridge retains the disclosure.

## Validation and limits

- Isolated PostgreSQL fixtures exercise recomputation, ordering, terminal and
  undated rows, organization filtering, legacy/shared/non-email names, revocation,
  no-candidate behavior and idempotent historical cleanup/reindex declarations.
- Plaintext and synthetic opaque ciphertext cases prove redaction is independent
  of the stored representation. They do not claim a live KMS encryption test.
- Real command-handler tests cover person/company undo and redo, current private
  and unresolved linked rows, and date restoration. No seeded records are used.
- Live People list/detail, company detail, dashboard and search API/UI privacy
  verification with two users and real encryption on/off remains a QA merge gate.
  The shared projection is the source for these paths; no new route is introduced.

## Changelog

- 2026-11-07: Added projection redaction, replay checks, historical cleanup and regressions.
