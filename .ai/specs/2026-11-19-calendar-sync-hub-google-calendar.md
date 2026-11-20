# Calendar Sync Hub + Google Calendar Provider

| Field | Value |
|-------|-------|
| **Status** | Draft (rev 3.34) — pkarw re-review of `03d104d5` (discovery fencing, retry eligibility) addressed; awaiting re-review on PR #10009 |
| **Created** | 2026-11-19 |
| **Builds on** | [CRM Calendar](./2026-06-11-crm-calendar.md), [Configurable Calendar Event Types](./2026-09-28-configurable-calendar-event-types.md), [Calendar Event Type Extensions](./2026-09-28-calendar-event-type-extensions.md), [CRM Email Integration](./implemented/2026-05-27-crm-email-integration.md), [Email Integration Foundation](./2026-05-21-email-integration-foundation.md) |
| **Reuses** | `communication_channels` hub OAuth flow + token refresh, `@open-mercato/channel-gmail` Google OAuth client, `customers` interaction/person commands + `syncOrigin`, `findPeopleByAddresses`, `hashForLookup`, the `communication_channels` adapter-registry pattern (`registerChannelAdapter`) |
| **Reference implementations** | `packages/create-app/template/src/modules/example_customers_sync` (two-way interaction sync, `syncOrigin` loop-breaker, queue workers); `packages/core/src/modules/communication_channels/lib/registry.ts` (`registerChannelAdapter`: throws on duplicate, returns unregister) |
| **New code** | `packages/core/src/modules/calendar_sync` (provider-neutral hub), `@open-mercato/google-auth` (library), `@open-mercato/channel-google-calendar` (first provider; module `channel_google_calendar`, provider key `google_calendar`) |
| **Scope** | OSS |

## TLDR

**Key Points:**
- **Provider-neutral calendar sync.** A new core hub, `calendar_sync`, owns everything provider-neutral: tables, the placement engine, sharing one CRM record for a meeting several users attend, privacy redaction, people creation and promotion, two-way orchestration, settings, APIs and UI. Providers implement a small **`CalendarProviderAdapter`** contract. **Google Calendar** is the first adapter. Outlook / Microsoft 365, CalDAV (iCloud, Fastmail) or booking tools can be added later without touching the hub's tables or logic.
- **Connecting.** A user connects a calendar in **Profile → Communication channels**. The connection goes through the existing hub OAuth flow; for Google it reuses Gmail's tenant OAuth client by default.
- **Every event is imported, in one of two places.**
  - An event with ≥1 CRM Person among its attendees, and not private, becomes a `CustomerInteraction` (customer timelines, two-way sync).
  - Every other event becomes a hub-owned **external calendar event**, shown on the CRM calendar through the customers extension point `calendar:customers.item-sources`. This covers internal meetings, personal blocks, **private events**, **focus time** and **out-of-office**.
- **Private events** show full details only to the owner. Everyone else sees a server-redacted **"Busy"** block.
- **People.**
  - An organization setting **auto-creates CRM People** from unknown attendees (default off).
  - When it is off, users **create a person** or **link an existing customer** from the event; the event is then promoted to an interaction.
  - A person created later is linked to the meeting automatically.
- **One meeting, one CRM record.** When several connected users attend the same meeting, even across providers, the copies are deduplicated by the meeting's iCalendar UID (`iCalUID`) into **one** interaction. Exactly one primary link writes content.
- **Meeting links.** First-class `meetingUrl` / `meetingProvider` / `meetingDetails` fields on `CustomerInteraction`. Google Meet links can be generated when creating CRM events.

**Scope.** The work is split into three parts.

| Part | Contents |
|---|---|
| **A — customers (provider-independent)** | meeting fields + Join, person-email matcher DI service, `includeLinked` filter, calendar item-source extension point, participant "Create person", email-only composer filters |
| **B — `calendar_sync` hub** | `communication_channels` prerequisites (client-config fallback, a `channel.connected` event from both connect paths, a `lifecycle_generation` column bumped by every lifecycle write, a mailbox guard scoped by `channelType`, cross-type primary rejection), provider contract + registry, connections, link and external-event store, placement + shared-meeting identity, redacted events API, people creation and promotion, outbound orchestration, change-notification webhook + renewal, settings, UI widgets |
| **C — Google provider** | `@open-mercato/google-auth` extraction (Gmail re-exports), OAuth channel adapter, Google `CalendarProviderAdapter` (API client, normalize/denormalize, watch, Meet) |

**Concerns:**
- **Team visibility.** Importing everything turns the CRM calendar into a team availability view. Mitigations: busy-only redaction for private events, and a per-user "share event details" switch.
- **Auto-created people.** Auto-creation can add colleagues or vendors as customers. Mitigations: it is off by default, excluded domains (with a warning when empty), a per-event attendee cap, resource/self exclusion.
- **Matching gap.** Person matching scans ≤ 500 recent people on encrypted tenants (`findPeopleByAddresses`). Missed matches stay external until linked or created. The 2026-09-04 email blind index removes this.
- **Contract surface.** The provider contract becomes a public, versioned surface (`calendar-provider.v1`). It must be designed for at least Google, Microsoft Graph and CalDAV from day one (see Provider Contract → fit check).

## Resolved Assumptions

| # | Question | Decision | Decided by | Why |
|---|----------|----------|------------|-----|
| R1 | One spec or split? | One spec, Parts A / B / C, 9 phases | autonomous default | Shared identity, link table and loop-breaker; parts stay separately mergeable |
| R2 | Meaning of "push and pull" | Two-way sync; change notifications **and** polling for provider → CRM | autonomous default | Goal 4 needs writes; notifications alone are unreliable |
| R3 | Which events are imported | **All.** Placement: ≥1 CRM Person and not private → interaction; otherwise → external event | requester (rev 2) | Full availability without breaking the mandatory customer link |
| R4 | Several matched invitees | One interaction; first match = `entity`, others in `linkedEntities` | autonomous default | "Linked with an event" |
| R5 | Unknown attendees | Org setting auto-creates People (default off); otherwise manual "Create person" / "Link to existing customer" | requester (rev 2) | Requested |
| R6 | Which CRM events go to the provider | Opt-in per event in the editor; on by default for meeting/event kinds | autonomous default | Explicit intent before invitations go out |
| R7 | Meeting-link providers | Conference capability per provider adapter (Google → Meet); provider-neutral meeting fields | autonomous default | Teams and Zoom fit the same seam |
| R8 | Google connection model | Separate `google_calendar` connection, reusing Gmail's OAuth client via fallback | autonomous default | Calendar must not depend on Gmail |
| R9 | Which calendars | Primary only; keyed by `externalCalendarId` | autonomous default | Smallest useful scope |
| R10 | Private events | Owner sees details; others see Busy; never auto-promoted; owner may "Add to CRM" | requester (rev 2) | Requested |
| R11 | Focus time / out-of-office | Imported as external kinds; working-location and birthday events skipped | requester (rev 2) + autonomous | Requested |
| R12 | Where non-customer events live | Hub-owned external event store, rendered via the customers item-source extension point | autonomous default | A nullable customer link touches 37 files and changes a response contract |
| R13 | Reuse for future providers | **Provider-neutral `calendar_sync` hub in core + `CalendarProviderAdapter` contract now**; Google is a thin adapter | requester delegated (rev 3), recommended option | Tables are a frozen contract; renaming provider-named tables later costs migrations + deprecation |
| R14 | Same meeting seen by several connected users | Deduplicated by `(organization, iCalUID, instance)` into one interaction; one primary link writes content | autonomous default (rev 3) | Prevents duplicate interactions per attendee; works across providers because the iCalendar UID is RFC 5545 standard |

> **Open maintainer decision (non-blocking):** the scope-cohesion review returned **SPLIT** (see Changelog → Review). Part A is useful without any provider and can be lifted into an amendment of the [CRM Calendar](./2026-06-11-crm-calendar.md) spec. Parts B and C could also be separate specs, joined by the provider contract. The parts are labelled for that purpose.

## Overview

The CRM Calendar (2026-06-11) renders `CustomerInteraction` records and deferred external sync to "the integrations framework as a future provider package". Sales users plan their day in external calendars. Without sync, the CRM calendar shows neither customer meetings booked elsewhere nor the user's real availability, and meetings planned in the CRM never reach invitees. Google Calendar is the first provider; Microsoft 365 is the obvious second. This spec therefore builds the provider-neutral hub once, following the existing hub pattern (`communication_channels` for messaging, `data_sync` for imports).

> **Market Reference**:
> - **Nylas** and **Cronofy** (unified calendar APIs) normalize Google, Microsoft and CalDAV into one event model with per-provider drivers. **Adopted:** a normalized event model and a narrow provider contract. **Rejected:** depending on a third-party SaaS for core CRM data.
> - **Twenty CRM** (open source) uses a provider-agnostic calendar channel with per-provider drivers, imports all events, has "metadata only" vs "share everything" visibility, and optional contact auto-creation. **Adopted:** full import, busy-only mode, optional auto-create.
> - **Odoo** (open source) does two-way sync and email matching. **Adopted.**
> - **HubSpot** and **Salesforce Einstein Activity Capture** log meetings only when attendees match contacts. **Adopted** as the interaction placement rule. Salesforce also deduplicates a meeting logged by several reps. **Adopted** as R14.
> - **Pipedrive** adds video links through provider apps. **Adopted:** a per-adapter conference capability.

### Existing building blocks (verified in code)

| Block | Location | Reuse |
|-------|----------|-------|
| Google OAuth client | `packages/channel-gmail/src/modules/channel_gmail/lib/oauth.ts` | Moved to `@open-mercato/google-auth`; Gmail re-exports |
| Generic OAuth initiate/callback, state, token storage | `communication_channels/api/{post,get}/oauth/[provider]/…`, `lib/oauth-state.ts`, `lib/oauth-client-config.ts` | Each calendar provider is also a `ChannelAdapter` (OAuth only) |
| Token refresh | `communication_channels/lib/credential-refresh.ts` → `refreshCredentialsIfNeeded` | The hub gets a fresh token before every adapter call |
| Adapter registry pattern | `communication_channels/lib/registry.ts` → `registerChannelAdapter` (throws on duplicate, returns an unregister function); `data_sync/lib/adapter-registry.ts` (globalThis-backed map) | `registerCalendarProviderAdapter` follows `registerChannelAdapter` semantics |
| Connect UI | `/backend/profile/communication-channels`, spot `profile:communication-channels:connect` | Each provider contributes a connect widget |
| Interaction/person commands with `syncOrigin` | `customers/commands/{interactions,people}.ts` | All CRM writes; loop-breaker |
| People by email | `customers/lib/findPeopleByAddresses.ts` | Wrapped in a DI service |
| Person create dialog | `customers/components/detail/CreatePersonDialog.tsx` | Participant "Create person" (customers side) |
| Calendar extension host pattern | `customers/extension-points.ts` → `calendarEventTypes`, `calendarEventTypePanel` | Mirrored for item sources |
| Lookup hash | `@open-mercato/shared/lib/encryption/aes` → `hashForLookup(value, context)` | Attendee-email hashes |
| Editor injection | `CalendarEventEditor` = `CrudForm` (`crud-form:customers.customer_interaction` + `:fields`), widget `onAfterSave` | Sync toggles widget |

## Problem Statement

1. Meetings booked in an external calendar are invisible in the CRM calendar and on customer timelines.
2. The CRM calendar shows no real availability, so conflict warnings miss most double-bookings.
3. Meetings scheduled in the CRM do not reach external calendars or invitees.
4. No meeting link can be attached or generated from the CRM.
5. Invitees are not connected to CRM People.
6. Every future calendar provider would otherwise re-implement the same placement, privacy, identity and sync logic.

## Proposed Solution

### Layering

| Layer | Owns | Knows nothing about |
|-------|------|---------------------|
| `customers` (Part A) | interactions, people, meeting fields, calendar UI, item-source extension point | providers, sync |
| `calendar_sync` hub (Part B) | connections, event links, external events, placement, shared-meeting identity, redaction, promotion, auto-create, outbound orchestration, notifications endpoint, settings, sync UI | any provider API |
| `channel-google-calendar` (Part C) | Google OAuth (via the hub OAuth flow), Google Calendar REST, normalize/denormalize, watch channels, Meet | customers, placement, privacy |
| `communication_channels` | OAuth, credentials, token refresh | calendars (only the `channel.connected` event and the type-scoped guards change) |

`calendar_sync` is a **soft-optional consumer of `customers`** (`tryResolve`). When `customers` is absent, everything is placed as external.

### Placement rule (hub, applied to every normalized event)

```
event.kind ∈ {working_location, birthday, other}            → skip ('event_type')
event ended before import lookback                          → skip ('before_lookback')
event.isSeriesMaster and provider-owned series              → skip ('series_master'); instances are placed
shared = existing link in the org with the same meeting key (icalUid, instanceKey) on ANOTHER connection,
         else (instances only) a CRM-owned series-master link with the same icalUid
if shared.placement = 'interaction'                         → ATTACH (re-elect primary if this link outranks it; see Shared meetings)
if event.kind ∈ {focus_time, out_of_office}                 → EXTERNAL
if event.isPrivate                                          → EXTERNAL (private; never auto-promoted)
if link.auto_promote_suppressed_at and attendee hashes unchanged since suppression → EXTERNAL (stays non-customer)
matched = matchPeopleByEmails(eligible attendees)
autoCreate = matched = ∅ and settings.auto_create_enabled and 0 < eligible ≤ settings.auto_create_max_attendees
if matched ≠ ∅ or autoCreate:
    RESERVE the primary link (unique primary-per-meeting index; on violation → ATTACH to the winner)
    if autoCreate:   # only the reserve winner ever creates People
        for each eligible unmatched attendee IN ASCENDING attendeeEmailHash ORDER (deadlock-free),
        under pg_advisory_xact_lock(org, attendeeEmailHash):
            re-match that email; create the Person only if still unmatched
    CREATE the interaction (customers command, reserved id) → FINALIZE (attach siblings, add their participants)
    if no Person resulted (all creations skipped/failed) → release the reservation and place EXTERNAL
else → EXTERNAL (kind meeting if other attendees exist, else event)
```

*Eligible attendee*: not a resource, not self, valid email, and domain not in the organization's `auto_create_excluded_domains`. The domain filter applies to auto-creation only.

### Shared meetings (R14)

- **Meeting key** = `(organization_id, ical_uid, instance_key)`. Provider adapters MUST supply `icalUid`; all three target protocols expose it (Google `iCalUID`, Graph `iCalUId`, CalDAV `UID`). An event without one gets a synthetic key `provider:<providerKey>:<connectionId>:<externalId>`, **stored in the `ical_uid` column** (so every index sees it), and is never shared. External event ids are only unique **within one calendar**, so the key includes the connection: two calendars returning the same local id for unrelated UID-less events are always placed independently.
- **`instance_key` canonical form.** Adapters MUST build it with the hub helper `buildInstanceKey({ originalStart, allDay, timezone })`, exported with the contract, so keys are byte-equal across providers:
  - `''` for non-recurring events and for series masters;
  - timed instances: original start converted to UTC, second precision, `YYYY-MM-DDTHH:mm:ssZ`;
  - all-day instances: `YYYY-MM-DD`.
  - Each provider's source is converted to this form: Google `originalStartTime.dateTime` / `.date`, Graph `originalStart` (DateTimeOffset), CalDAV `RECURRENCE-ID` (TZID / `VALUE=DATE`).
- **Interaction-placed meeting.** At most **one primary link**, ranked: (1) the organizer's own connection, (2) the CRM-origin link, (3) the earliest linked.
  - Other connections' links are **attached**: they share the `interaction_id`, have `is_primary = false`, and only maintain their own user's participant entry and RSVP via `customers.interactions.update` (`syncOrigin`). **Watermark rule:** every hub write to an interaction, from any link, advances the **primary** link's `synced_interaction_updated_at` to the interaction's new `updatedAt` in the **bookkeeping transaction run right after the customers command commits**. The gap between the two commits is covered by a **pending-write marker**. The `beforeTransactionalWrite` guard writes the marker on the **current** primary link **inside the command's own transaction**, after the per-interaction lock and the version check. If the interaction has no primary, the guard writes no marker and bookkeeping is a no-op. The marker has two fields:
  - `pending_write_hash`: `syncedFieldsHash` of the row **as it will be stored**. The guard takes the locked row, applies the hub's changes, and runs them through `customerInteractionAccess.toStoredSyncedFields(...)`, a Part A DI method that reuses the customers validators and normalization (title trim, `canonicalCalendarTimezone`, participant shape), so the hash matches what the command actually persists. Bookkeeping and recovery hash the stored, decrypted row with the same helper.
  - `pending_write_was_pristine`: whether the locked row was **effectively pristine** (predicate below) before this write. For `customers.interactions.create` (no prior row) it is `true`, and the hash is `syncedFieldsHash(toStoredSyncedFields(createInput))`.
  - The marker commits only if the write commits, and hub writers set it strictly one after another. The latest committed hub write always owns the marker.
  - **Effectively pristine** is the single predicate used **everywhere** pristine-ness or a CRM-side change is checked: the guard, bookkeeping, recovery, the demotion check, the first-apply-as-primary check, the **conflict rule**, and the **CRM-only-change** check. Every inbound apply first runs recovery under the per-interaction lock, then evaluates these checks in the same locked transaction. It is true when `row.updatedAt = link.synced_interaction_updated_at`, **or** when `link.pending_write_hash IS NOT NULL AND syncedFieldsHash(toStoredSyncedFields(row)) = link.pending_write_hash AND link.pending_write_was_pristine`.
    - The second clause recognises a hub write whose bookkeeping has not run yet. When hub write W2 locks the row after W1 committed but before W1's bookkeeping (the normal case for parallel inbound jobs on a shared meeting), W2 still sees the row as pristine, and W2's bookkeeping then advances the watermark to W2's `updatedAt`.
    - A user CRM edit fails both clauses, so it stays visible. Clause 2 is sound because `StoredSyncedFields` covers the interaction's **complete user-editable surface**, not just the fields the hub writes: `interactionType`, `title`, `body`, `status`, `scheduledAt`, `occurredAt`, `durationMinutes`, `allDay`, `timezone`, `location`, `meetingUrl`, `meetingProvider`, `meetingDetails`, `participants`, `linkedEntities`, `entityId`, `dealId`, `ownerUserId`, `visibility`, `priority`, `recurrenceRule`, `recurrenceEnd`, `reminderMinutes`, `guestPermissions`, plus the custom-field values. A user edit to any of them changes the hash.
  - **Recovery:** if bookkeeping never runs (crash, lost lease), the next apply finds `interaction.updatedAt > synced_interaction_updated_at`. It advances the watermark to the current `updatedAt` and clears the marker **only when** the stored row hashes to `pending_write_hash` **and** `pending_write_was_pristine` is true. Otherwise it only clears the marker, so a user edit preceding the hub write is never absorbed. So it neither reports a fake CRM edit nor pushes an echo to the provider. Attendee RSVP updates therefore never look like CRM edits (pristine checks and the conflict rule stay correct).
  - **Eligibility:** a link whose copy is private (`is_private = true`) is **never eligible** to *become* primary, whatever its rank. The single exception is an organizer primary whose copy turns private on a non-pristine interaction: it stays primary with content writes frozen (see Private organizer copy).
  - **Primary swap mechanics:** Postgres checks the partial unique indexes per statement, so a swap is two-phase inside one transaction: clear `is_primary` on the old primary, flush, then set it on the new one (the trap documented in `communication_channels/lib/connect-channel.ts`). Every swap (re-election or handover) copies **only** the interaction-level facts `synced_interaction_updated_at`, `pending_write_hash` and `pending_write_was_pristine` to the new primary. Each link keeps its own `external_updated_at` and `content_hash`, which describe *its* calendar copy. On its **first apply as primary**, a link uses **its own** change signal (`event.updatedAt > link.externalUpdatedAt`, or a `content_hash` change) and the normal conflict rule. Genuine provider changes, such as the organizer moving the meeting, are applied (or resolved last-writer-wins against a concurrent CRM edit). An unchanged copy never overwrites a CRM edit. Only a link with **no watermark of its own** (never applied) falls back to pristine-only.
  - **Re-election while `promoting`:** re-election is deferred while the current primary is `promoting`. The attaching link is stored as attached, and the winner's finalize runs the election over all attached links.
  - **Re-election on attach:** when an attaching *eligible* link outranks the current primary (for example, the organizer connects after an attendee's copy was promoted), it **becomes primary** in the same transaction (the old primary is demoted to attached). Its copy is then applied as content subject to the first-apply-as-primary rule (own change signal + normal conflict rule).
  - **Private organizer copy:**
    - If the organizer's copy is private when it **attaches**, it attaches as a participant only and contributes no content.
    - If the organizer's existing primary copy **turns** private, the demotion check runs **once, on that transition** (`is_private` false → true), not on every apply.
      - Pristine → demote.
      - Not pristine → the link **stays primary**, so no attendee's copy can start writing content. Its content writes are **frozen** (`last_error = 'privacy_changed_kept'`, owner warned) until the copy becomes non-private again.
    - After an admin undo of a demotion, the restore advances the primary's watermark to the restored interaction's `updatedAt` and records the current `is_private`, so the organizer's next unchanged sync does not re-demote it.
- **CRM-pushed meetings (UID window).** When a CRM-origin link is created (the editor turns push on), the hub assigns its meeting key **in the same transaction**: `ical_uid = <hex(sha256(idempotency key))[0..32]>@open-mercato` (the key is `<link id>:<insert_generation>`), `instance_key = ''`, as primary. When the adapter has `clientSuppliedIcalUid`, the insert sends that UID. When it implements `predictIcalUid`, the predicted UID is used as the key instead. Either way, colleagues' invitations already match and their inbound sync attaches. **In every case** the hub overwrites `ical_uid` with the UID the provider actually returns from the insert. A provider without either (Graph) holds a provisional synthetic key until then. If the returned UID differs from the key and collides with a primary created in the window (a colleague's copy promoted first), the hub **merges**:
  - the CRM-origin interaction survives;
  - the colleague-side links attach to it, with their linked persons unioned into `linkedEntities`;
  - the duplicate interaction is deleted via `customers.interactions.delete` (`syncOrigin`);
  - then the primary key is updated.
  The merge is a resumable sequence of separate transactions, so it never awaits a customers command while holding a lock:
  - **(1)** One locked hub transaction takes both interactions' advisory locks in ascending id order. It moves the links: the duplicate's primary is cleared first, so the unique index is never violated. It **updates the surviving primary's `ical_uid` to the provider UID in the same transaction**, so no other inbound event can reserve a second interaction for that key in the meantime. It stamps `merged_from_interaction_id = <duplicate id>` and `state_changed_at = now()` on the moved links, so the resumer's staleness clock measures the merge itself, which is what steps (2) and (3) need to resume.
  - **(2)** `customers.interactions.update` unions the linked persons into the surviving interaction (it locks through its guard).
  - **(3)** `customers.interactions.delete` removes the duplicate (`syncOrigin`; it locks through its guard).
  - **(4)** A hub transaction holding the surviving interaction's lock clears `merged_from_interaction_id` on the moved links. This is not the duplicate's bookkeeping: the duplicate has no primary.
  - **Resumer:** the stale-state sweep finds links whose `merged_from_interaction_id` is older than `OM_CALENDAR_SYNC_STALE_STATE_MINUTES` (by `state_changed_at`). It re-runs the remaining steps, which are idempotent: a union already applied is a no-op, and an already-deleted duplicate is skipped. Each step takes the locks as described.
- **Series attach.** An incoming recurring instance (`instance_key ≠ ''`) with no exact match also looks for a link with the same `ical_uid` and `instance_key = ''` whose placement is `interaction` (a **CRM-owned series master**). If found, the instance link attaches to that series interaction: its user is added once as a participant, and every instance link of that connection points to the same interaction. A colleague whose provider materializes a CRM-pushed series per instance therefore never creates per-instance duplicates. The same applies on the **organizer's own connection**: modified instances of a CRM-pushed series come back as separate events with the same `iCalUID`, and they attach to the series interaction as non-primary instance links. Re-election only compares links of *other* connections, so the series master stays primary.
- **Content and pushes.** Content changes (title, time, description, attendees, meeting) are applied **only from the primary link**, so stale attendee copies can never overwrite the organizer's version. Outbound pushes also go only through the primary.
- **Primary handover.** When the primary link is unlinked (disconnect, event deleted from that calendar), the next candidate becomes primary in the same transaction.
  - **Candidates** (for handover and re-election alike): only eligible links whose `(ical_uid, instance_key)` equals the interaction's **own meeting key**. For a series interaction that means `instance_key = ''` (series-master links); occurrence links attached through Series attach are **never** candidates and never write content to a series interaction. They only maintain their user's participant entry.
  - The hub copies the interaction-level facts (`synced_interaction_updated_at`, `pending_write_hash`, `pending_write_was_pristine`) from the old primary to the new one in the same transaction, and the new primary's first apply uses its own change signal (Primary swap mechanics), so the handover never fakes a CRM edit or a conflict and never drops a genuine provider change.
  - If no candidate remains, the interaction stays as normal CRM history with no primary.
- **External-placed meeting** (no customer). Each attendee's connection keeps its **own** external row; it is that user's availability, with that user as owner. When the meeting is promoted, every external sibling with the same key is attached to the one new interaction in the same promote job.
- **Privacy.** A private copy never writes content (see Eligibility). A connection whose copy is private but whose sibling is already an interaction attaches as a participant only. When the private copy is the **organizer's**, the demotion rule runs; an attendee's private copy alone never demotes.
- **First-import race.** Two connections can see a brand-new shared meeting in the same tick. A **unique partial index** on `(organization_id, ical_uid, instance_key) WHERE is_primary AND placement = 'interaction' AND deleted_at IS NULL` guarantees at most one primary per meeting. The placement transaction inserts the primary link (reserving the interaction id) **before** calling the customers create command. On a unique violation, the loser rolls back and re-runs placement as **ATTACH** to the winner. Because the reservation happens first, the loser never reaches the create command or People auto-creation, so it creates no duplicate interaction and no duplicate People. **Attach while the winner is still `promoting`:** the loser stores its link as attached (non-primary, the winner's `interaction_id`) but skips its own `customers.interactions.update`, because the interaction may not exist yet. The winner's **finalize** step adds the participants of *every* link attached to that interaction, whatever state it was in when attached. If the winner's reservation is **released** (no Person resulted), the release step explicitly re-places every link attached to it: each gets its own external row, built from its latest normalized copy (`adapter.getEvent` when not cached), exactly like demotion step (c). Nothing waits for the provider to resend an unchanged event, which incremental sync would not do.
- **Concurrent auto-creation across meetings:** two *different* new meetings with the same new prospect are serialized per attendee by `pg_advisory_xact_lock(hashtext(org_id || attendee_email_hash))`. Locks are always taken in ascending hash order, so two meetings sharing prospects in a different order cannot deadlock. Each re-matches inside the lock, so one email yields one Person.

### Transitions

- **Promotion (external → interaction):**
  - when attendees change so that a match exists;
  - when a person whose email is an attendee is created or updated (the subscriber);
  - when a user chooses "Create person" or "Link to existing customer" (`promote { entityId }`);
  - when the owner chooses "Add to CRM" (required for private events).
- **User deletes an interaction (CRM-side delete) — state machine:**
  - **Handler:** the **only** handler of `customers.interaction.deleted` is a hub subscriber, and it acts only when `syncOrigin` is **not** `calendar_sync`.
  - **Staleness guard:** in one hub transaction it first takes the **per-interaction lock** `pg_advisory_xact_lock(hashtext('calendar_sync:interaction:' || :interactionId))`. The undo restore handler and the sweep safety net take the same lock first, so the three are fully serialized and none acts on a state another is about to change. It then re-reads the interaction including soft-deleted rows (`findOneWithDecryption` with `deletedAt` visible) and the owning link. During a delete flow the owning link is identified by the **owning-delete key** below, not by `is_primary`, because the delete-flow unlink clears `is_primary`.
    - Interaction **live**: the delete was already undone, so this delivery is superseded. It is a **no-op**.
    - Interaction **deleted**: it proceeds only when this deletion has not been handled yet, that is, when the owning link's `deletion_marker` differs from the interaction's current `deletedAt`. A re-delivery of an already-handled deletion is a no-op; a re-delete after an undo has a new `deletedAt` and is handled.
  - **Safety net:** when the stale-state sweep finds a `deleting` link with `state_changed_at < now() − OM_CALENDAR_SYNC_STALE_STATE_MINUTES` whose interaction is live, it takes the per-interaction lock and runs **exactly the undo restore handler's `deleting` branch**. That restores the owning link (or gives it the disconnect outcome when its connection is paused), clears `deletion_marker`, and runs the generic marker restore for colleague links. A link can therefore never stay stuck in `deleting`, and colleagues are never left detached.
  - When it proceeds, it:
    1. Picks the **owning link**: the interaction's primary link if `push_enabled` and (`origin = 'crm'` or `is_organizer`); the CRM then owns the provider event. It moves it with a compare-and-set (`UPDATE … SET state = 'deleting', deletion_marker = :deletedAt WHERE id = ? AND state = 'linked'`), keeps `interaction_id`, and enqueues outbound **after** commit.
    2. **Detaches** every other link with this `interaction_id` and `state NOT IN ('unlinked','deleting')`: each is re-placed as external from its latest normalized copy (the user's availability stays on the calendar), gets `auto_promote_suppressed_at`, and records `detached_from_interaction_id`.
  - **Worker (owning link):**
    - It acts on a soft-deleted interaction **only when the link is `deleting`**. A pending outbound job that meets a soft-deleted interaction while the link is still `linked` is a **no-op**: the handler has not committed yet and will enqueue its own job. So the worker can never run "before the handler".
    - With the connection `active`, it deletes or cancels the provider event, then performs the **delete-flow unlink** with a compare-and-set: `UPDATE … SET state = 'unlinked', unlink_reason = 'crm_delete', is_primary = false WHERE id = ? AND state = 'deleting' AND state_changed_at = :readAt`. `interaction_id` is kept, there is **no handover** (the interaction is deleted), and no external row is created.
    - The worker's post-provider-call transaction takes the per-interaction lock first, like every hub writer. If the CAS fails because undo restored the link meanwhile, the provider event is already gone. The worker then applies the **CRM-only outcome** in that same locked transaction: owning link `unlinked` / `crm_delete` with push off; colleague links that undo re-attached are detached again and their markers cleared.
    - With the connection **not** `active`, the worker exits without provider calls and the link stays `deleting`. Reactivation re-enqueues it; this includes the undo of a channel disconnect **or** delete, which emits `channel.connected`.
    - **Abandonment:** a `deleting` link that cannot complete is abandoned by the sweep. This covers a connection inactive since `connection.status_changed_at < now() − OM_CALENDAR_SYNC_DELETE_ABANDON_DAYS`, or the link itself `deleting` for longer than that window on **any** connection (a permanent provider error such as `403`). The sweep runs one compare-and-set: `UPDATE … SET state = 'unlinked', unlink_reason = 'provider_delete_abandoned', is_primary = false WHERE id = ? AND state = 'deleting' AND state_changed_at = :readAt`. It uses the `(state, state_changed_at)` index, and the hub emits `calendar_sync.connection.failed` (reason `provider_delete_abandoned`).
  - **`unlink_reason`:** every unlink records one of `crm_delete`, `provider_delete_abandoned`, `disconnect`, `channel_deleted`, `provider_cancelled`, `sweep`, `not_organizer`. Only `crm_delete` and `provider_delete_abandoned` take part in undo.
  - **Undo:** undoing the delete emits `customers.interaction.created`.
    - **Single handler, fixed order:** one hub subscriber on that event handles every restore. It first takes the per-interaction lock, the same one the delete handler and the safety net use, then re-reads the interaction (`findOneWithDecryption`) and **no-ops** when it is soft-deleted or missing. That covers a stale `created` delivery arriving after a quick re-delete; the re-delete's own handler owns the state then.
    - **Owning-delete key:** it first looks up the owning link: `interaction_id = :id AND (state = 'deleting' OR (state = 'unlinked' AND unlink_reason IN ('crm_delete','provider_delete_abandoned')))`. There is at most one by construction, because only the primary can be owning; if several match, it takes the latest `state_changed_at`.
    - It branches on **link state only**, never on connection status:
      - **`deleting`** (provider event never touched; colleague copies alive). If the connection is `active`, `requires_reauth` or `error` (still the user's live connection), it does a CAS (`WHERE state = 'deleting'`) back to `linked` primary. If the connection is `paused` (disconnected or channel-deleted), the CAS instead gives the link the **disconnect outcome**: `unlinked`, `unlink_reason = 'disconnect'` (or `'channel_deleted'` when the connection's `paused_reason = 'channel_deleted'`), `is_primary = false`. A dead connection's link is never made primary; a later reconnect on the same channel re-attaches it through the `(connection_id, external_event_id)` reuse. Either way, it then runs the **generic marker restore**, which re-attaches the colleague links. No provider write is needed. If the CAS loses (the worker unlinked first), re-read and take the matching `unlinked` branch.
      - **`unlinked` + `crm_delete`** (provider event deleted, colleague copies cancelled with it): restore **the CRM record only**.
        - The owning link stays `unlinked`, with `push_enabled` set to false.
        - Colleague links are **not** re-attached: their markers are cleared, and their external rows go when the provider's cancellations arrive.
        - The interaction has no primary until the user re-enables push (see below).
      - **`unlinked` + `provider_delete_abandoned`** (the provider event and colleague copies are still live; only the owning connection is gone): the owning link stays `unlinked` with push off. The **generic marker restore** re-attaches the colleague links and elects a primary among them.
      - **No owning link** (demotion, or delete of a meeting the CRM did not own): generic marker restore only.
  - **Re-enabling push after a CRM-only restore:**
    - To put the meeting back on calendars, the user turns "Add to Google Calendar" on again in the editor.
    - **Precondition:** the identity reset below applies **only** to `unlink_reason = 'crm_delete'`, where the old provider event is confirmed gone. For `provider_delete_abandoned`, the old event may still be live. Re-enable there requires the owning connection to be `active` again (409 `connection_inactive` otherwise) and keeps the identity: the link is re-linked to its interaction and patched, never duplicated. On reactivation, abandoned rows are re-evaluated. Interaction still deleted → back to `deleting`, completing the delete. Interaction live → re-linked as attached, then re-election.
    - `event_link.update` reuses the owning link, bumps `insert_generation`, and **clears the old provider identity** (`external_event_id`, `external_series_id`, `external_version`, `external_updated_at`, `content_hash`, `conference_pending`, `html_link`, `unlink_reason`). It assigns a fresh key, sets the link `linked` primary, and enqueues outbound.
    - The worker sees no `external_event_id`, so it **inserts** a new provider event (new client id and UID) with new invitations. Colleagues' new copies attach through the new key. Their old `unlinked` rows don't block that, thanks to the `state <> 'unlinked'` index predicate.
  - **Not reversible by undo:** an executed provider delete is not undone automatically. This matches the stance that external provider writes are not reversible by undo, and the editor states it.
- **Missing or deleted interaction (any path):**
  - Undoing a hub-created interaction (`customers.interactions.create` undo hard-removes the row and emits no `deleted` event), or any other out-of-band removal, can leave links pointing at a missing row.
  - Apply, RSVP and attach **skip** links in `state = 'deleting'` and links whose interaction is soft-deleted; those belong to the user-delete flow.
  - Whenever apply, RSVP, attach or outbound finds a non-owning link whose interaction is **hard-missing**, or soft-deleted without a `deleting` sibling (an out-of-band delete), it treats the link as detached: it re-places the link as external from its latest normalized copy, clears `is_primary`, and sets `auto_promote_suppressed_at`. When the row is soft-deleted, it also sets `detached_from_interaction_id`, so undo can restore the link. The removal is therefore not silently undone by re-import.
- **Demotion (interaction → external):**
  - **When:** the organizer's copy becomes private **and** the interaction is sync-pristine (`origin = 'provider'` and **effectively pristine** per the Watermark rule predicate).
  - **How:** it runs as one `demote` job, the reverse of promote's finalize:
    - **(a)** in one hub (`calendar_sync`) database transaction, mark every link whose `interaction_id` equals the interaction (primary, attached and series-instance links alike) `state = 'demoting'` and record `detached_from_interaction_id`;
    - **(b)** `customers.interactions.delete` (undoable, `syncOrigin`);
    - **(c)** for every link marked in (a), set `placement = 'external'`, clear `interaction_id` and `is_primary`, and upsert that connection's own `CalendarExternalEvent` from its latest normalized copy (refetched via `adapter.getEvent` if needed). Each attendee keeps their own availability row, and no link points at a deleted interaction.
  - **Recovery:** resumable from `demoting`.
  - **Undo:** undoing `customers.interactions.delete` re-creates the row and emits **`customers.interaction.created`** (the delete command's undo uses `emitCrudUndoSideEffects({ action: 'created' })`; `customers.interaction.reverted` is only emitted by the complete/cancel undos). The single `customers.interaction.created` restore handler (see User deletes an imported interaction → Undo for its branch order) checks idempotently for links with `detached_from_interaction_id = payload.id` **that are still `placement = 'external'` and `state <> 'unlinked'`**. A colleague copy cancelled meanwhile (`provider_cancelled`) is never re-attached; cancellation also clears its marker. Links re-promoted since the demotion have had the marker cleared, so an old undo can never pull links off a newer live interaction. If any qualify, it restores them to `placement = 'interaction'`, re-elects the primary, soft-deletes their external rows, and clears `detached_from_interaction_id`. For any other `created` event it is a no-op (one indexed point lookup).
  - **Who can undo:** demotion is executed by `system:calendar_sync`, so undoing it is another actor's action and requires `audit_logs.undo_tenant` (admins only). The **user-facing reversal** is making the event non-private again in the provider, after which normal placement re-promotes it, or the owner's "Add to CRM".
  - **Otherwise** (not pristine) the interaction is kept, `last_error = 'privacy_changed_kept'` is set, and the owner is warned.
- Interactions are never demoted because people disappear (history is preserved).

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Provider-neutral hub in core (`calendar_sync`) now** | Roughly 70% of the logic is provider-neutral: placement, privacy, identity, people, outbound orchestration, UI. Tables are a FROZEN contract surface, so provider-named tables would force a migration + deprecation when the second provider arrives. Mirrors `communication_channels` / `data_sync`. |
| **Narrow `CalendarProviderAdapter` + normalized event model** | Providers translate protocol to `NormalizedCalendarEvent` and back; they never see CRM concepts. The contract was fit-checked against Google, Microsoft Graph and CalDAV. |
| **Providers are also `ChannelAdapter`s (`channelType: 'calendar'`) for OAuth** | Reuses OAuth, credentials, refresh, reauth and connect UI (goal 1). The hub keys connections by `communication_channels` channel id. Non-OAuth providers (CalDAV app passwords) use `validateCredentials` on the same hub. |
| **Hub never polled by `communication_channels`** | Calendar `ChannelAdapter`s declare `realtimePush: true` and implement no `fetchHistory`; message methods throw `[internal]`. |
| **Shared-meeting identity by iCalendar UID + single primary writer** | One customer meeting = one CRM record, even with several connected attendees on different providers. A single writer removes cross-copy write conflicts. |
| **Two homes for imported events** (interaction vs hub external store) | Customer timelines, projections, deals and AI tools assume a customer (37 files). Non-customer availability is a provider mirror, purged on disconnect and after retention. |
| **Customers item-source extension point** (`calendar:customers.item-sources`) | Customers never imports the hub. The hub is one source; any module can be another. |
| **Server-side redaction** | Details never reach non-owners' browsers. |
| **Private events never auto-promote** | Customer timelines cannot be redacted per viewer. |
| **People via `customers.people.create` with `syncOrigin`** | Audit, undo, events, indexing; tagged `source` for review. |
| **Attendee-email hashes on the link row** | Encrypted attendees stay searchable by `hashForLookup`. They cover external and interaction placements, so people created later are linked either way. |
| **Org settings in a hub-owned, org-scoped table (`calendar_sync_settings`)** | One auto-create policy for all providers, per organization. `ModuleConfigService` was rejected: its rows, unique index (`module_configs_scoped_unique (module_id, name, tenant_id)`) and cache are **tenant**-scoped, so organizations in one tenant would overwrite each other's policy, and `setValue` flushes on its own EntityManager (no compare-and-set inside a caller transaction). |
| **All CRM writes via customers commands with `syncOrigin: 'calendar_sync'`** | Loop-breaker for every provider at once. |
| **Opt-in push recorded by the editor widget** | Deterministic outbound; API/workflow-created interactions never leak. |
| **Client-supplied external ids where the provider allows** | Idempotent inserts per idempotency key `<link id>:<insert_generation>` (Google: `id` = hex digest of that key). Providers without client ids (Graph) use `transactionId` (Graph's idempotency field) or a search on the hub id stored in provider extended properties. The adapter owns this; the hub only requires idempotency. |
| **Provider-owned recurring series materialized as instances; CRM-owned series pushed as an RRULE master** | Provider RRULE/EXDATE/override semantics exceed the CRM expander subset. |
| **Shared `@open-mercato/google-auth`; client-config fallback to Gmail** | No provider-to-provider import. Gmail's credentials form and rows stay untouched. |

### Alternatives Considered

| Alternative | Why rejected |
|-------------|--------------|
| Google-only package now (rev 2) | A second provider copies placement, privacy, identity and people logic, or forces a later refactor with table renames (FROZEN surface) and the deprecation process |
| Middle ground: one Google package with provider-neutral table names | Avoids renames, but a second provider still copies the logic and would have to import the Google package's internals |
| Nullable `CustomerInteraction.entity` | 37 files and a response-contract change; mixes personal availability into CRM history |
| Third-party unified calendar API (Nylas / Cronofy) | External SaaS dependency for core CRM data; per-seat cost; data residency |
| Per-attendee duplicate interactions (no shared identity) | The same customer meeting appears N times on timelines |
| Client-side redaction | Leaks details to every browser |
| Unconditional auto-create | Floods the CRM; the requester asked for an option |

## User Stories / Use Cases

| As | I want to | So that | Delivered by |
|----|-----------|---------|--------------|
| A sales rep | connect my Google Calendar and see all my events in the CRM calendar | conflict warnings reflect my real availability | Phases 3, 4, 7 |
| A sales manager | see colleagues' private appointments as Busy | I can plan without seeing private details | Phase 4 |
| A sales rep | have customer meetings appear on customer timelines with meeting links | I can join and keep history from the CRM | Phases 2, 4 |
| Two reps | attend the same customer meeting with both calendars connected | the customer has one meeting record listing both of us | Phase 4 |
| An admin | enable auto-creation of People, excluding our domains | new prospects become People automatically | Phase 5 |
| A sales rep | create a person or link an existing customer from an imported meeting | the meeting moves onto the right timeline | Phases 2, 5 |
| A sales rep | schedule a CRM meeting with "Add Google Meet link" | the invitee gets an invitation with a working link | Phases 6, 7 |
| A platform developer | add Microsoft 365 by writing one adapter package | placement, privacy, people and UI work unchanged | Provider Contract |

## Architecture

```
      Google / (future) Microsoft Graph / CalDAV
            ▲ REST                    │ change notifications
            │                         ▼
  ┌─────────┴──────────────┐   /api/calendar_sync/webhook/[provider]  (public)
  │ channel-google-calendar│          │ adapter.parseNotification → enqueue inbound:<connectionId>
  │  ChannelAdapter (OAuth)│          ▼
  │  CalendarProviderAdapter ◄──── calendar_sync hub (core) ─────────────────────────────────────┐
  │  google-auth           │   registry: registerCalendarProviderAdapter                          │
  └────────────────────────┘   data: CalendarConnection, CalendarEventLink, CalendarExternalEvent │
                               engine: placement · shared-meeting identity · redaction · conflict │
                               workers: inbound-sync, outbound-sync, promote, notifications-renew,│
                                        horizon-roll (+retention), poll-tick                      │
                               subscribers: communication_channels.channel.connected/disconnected/deleted → lifecycle reconcile job
                                            customers.interaction.* → outbound
                                            customers.person.created/updated → promote / link
                               api: connections, settings, events (redacted), events/[id]/promote,
                                    interactions/[id]/link, webhook/[provider]
                               widgets: calendar item source · external details panel · editor field widget
                                        · user settings page · org settings page
                                    │ tryResolve('customerPersonEmailMatcher'), commandBus('customers.*')
                                    ▼
  communication_channels (+fallback keys, channel.connected,      customers (Part A)
   type-scoped mailbox guard, cross-type primary rejection)        + meeting fields, matcher, includeLinked,
                                                                   item-source extension point, Create person
```

### Inbound flow

1. **Triggers:** a webhook, a poll tick (`OM_CALENDAR_SYNC_POLL_INTERVAL`), "Sync now", or a connect.
2. **Coalesce and lock:** the `calendar-sync-inbound` queue is built with `coalesceBy: (p) => \`connection:${p.connectionId}\`` (`@open-mercato/queue` coalescing: a burst of triggers runs once, and a trigger landing mid-run still gets one follow-up run). Across processes the worker takes a **lease**, not a row lock held across network calls: a short transaction runs `UPDATE … SET sync_lease_until = now() + interval '5 minutes', sync_lease_owner = :me, lease_epoch = lease_epoch + 1 WHERE id = ? AND status = 'active' AND deleted_at IS NULL AND (sync_lease_until IS NULL OR sync_lease_until < now())`. A lease can only be acquired on an **active, non-deleted** connection. Each acquisition increments `lease_epoch` (a monotonically increasing fencing token), and the job keeps the epoch it acquired. Renewals, cursor writes and the final clear add `AND sync_lease_owner = :me AND lease_epoch = :epoch`, so a stalled worker whose lease was taken over can no longer write.
   - **The lease is also bound to the channel's lifecycle generation.** `communication_channels.lifecycle_generation` (Phase 1 step 3b) is bumped by every channel lifecycle write (connect/reconnect, disconnect, delete, their undos, reauth marks), never by a token refresh. The acquisition transaction first locks the connection row (`SELECT … FOR UPDATE`), **then** reads the channel row `FOR SHARE`, and runs the acquiring `UPDATE` only when the channel is `connected`, not deleted, and its `lifecycle_generation` equals the connection's `channel_generation` (the generation the connection was last reconciled against). Otherwise it acquires nothing and enqueues the lifecycle reconcile. Taking the connection first keeps the global lock order (connection → channel) that the fence, the reconcile and the worker's reauth transition use, so acquisition cannot deadlock with a stalled worker marking reauth. The job keeps that generation as `:generation`. A disconnect followed by a reconnect that **both** commit before any reconcile runs therefore still invalidates every lease taken before them, even though the persisted channel is `connected` again and the connection never left `active`.
   - Zero rows updated means another worker holds the lease, so this one exits. The lease is renewed per page and cleared at the end. No database connection or row lock is held during provider calls. The job payload is only `{ connectionId }`. The mode comes from the persisted **traversal** (see step 6): an unfinished traversal is always continued in its own mode; otherwise the run is `full` when `full_resync_requested_at` is set or the cursor is missing, else `incremental`. Workers stay idempotent (queue `AGENTS.md`).
   - **Fencing scope.** The lease fence covers **everything an inbound job mutates**, not only cursor writes: link and placement changes, external rows, attach, auto-promote decisions taken while applying a page, the full-sync sweep, and customers writes. The separate `promote` job holds no lease and is not fenced by it; it is serialized by its per-meeting coalescing key, the primary-per-meeting unique index, and the per-interaction lock below.
   - **The fence check** is `SELECT lease_epoch FROM calendar_sync_connections WHERE id = ? AND sync_lease_owner = :me AND lease_epoch = :epoch AND status = 'active' AND deleted_at IS NULL FOR SHARE`, followed in the same transaction by a re-read of the channel row `FOR SHARE` requiring `lifecycle_generation = :generation AND status = 'connected' AND deleted_at IS NULL`. It aborts when either read comes back empty, and on a generation mismatch it also enqueues the lifecycle reconcile. Renewals and cursor writes carry the same conditions (they run inside a fence-checked transaction). Locks are always taken connection first, then channel, in every hub transaction that touches both (acquisition, fence, reconcile, the worker's reauth transition with `markChannelRequiresReauth`). Every transaction that runs a fence or a fresh-statement re-check runs at **READ COMMITTED** (the Postgres default): all hub transactions **and** the customers command transaction that runs the fence through `ctx.beforeTransactionalWrite`, since the fresh-statement re-checks and the re-read-after-lock fences rely on it. It is not left to the server default: hub transactions open with an explicit `isolationLevel: READ COMMITTED`, and the hub's `beforeTransactionalWrite` guard (which runs inside the customers transaction the hub cannot configure) asserts `current_setting('transaction_isolation') = 'read committed'` and throws an `[internal]` error otherwise, so a deployment with `default_transaction_isolation = 'repeatable read'` fails loudly instead of reading stale snapshots; under REPEATABLE READ those re-checks would not see concurrent commits. A setup row is always locked last (connection → channel → setup row: the attempt start, the discovery commit fence, connection creation, the closing rate-limit/other-error `UPDATE`s, the reconcile transaction's setup-row deletes (removed channel, backstop) and `/setups/retry` all follow it; the attempt start's guarded insert of a new row is invisible to others until commit), so none of them can deadlock with another. A transaction that may call `markChannelRequiresReauth` takes the channel row `FOR NO KEY UPDATE` instead of `FOR SHARE` from the start, so two such transactions never deadlock on a share-to-exclusive upgrade; a channel lifecycle write locks only the channel row.
   - `FOR SHARE` blocks a concurrent lease takeover or revocation (an `UPDATE` of the row) until the checking transaction ends. A takeover is therefore either visible before the mutation (abort), or waits until after it (the old worker's mutation is still valid). The same holds for the channel row: a disconnect, delete or reconnect is either visible to the fence (generation changed → abort) or commits after the mutation, which then happened before the lifecycle change and is handled by the reconcile like any pre-existing data.
   - **Revocation on leaving `active`:** every transition of a connection out of `active` revokes the lease **in the same `UPDATE`** that changes the status: `SET status = :new, status_changed_at = now(), lease_epoch = lease_epoch + 1, sync_lease_owner = NULL, sync_lease_until = NULL, cleanup_attempts = 0`.
     - **External transitions are level-triggered, never edge-triggered.** The channel lifecycle events (`channel.connected`, `channel.disconnected`, `channel.deleted`, and the `connected` emitted by their undo) are persistent and retryable, so they can arrive late, repeated or out of order. A handler therefore **never applies the transition its event names**. Every lifecycle event, including `channel.requires_reauth`, only enqueues the **lifecycle reconcile job**. It runs on queue `calendar-sync-lifecycle`, `coalesceBy: (p) => \`channel:${p.channelId}\``. Its payload is `{ channelId, tenantId, organizationId }`, with no intent, which fits queue `AGENTS.md` rule 4: recompute from state. Every lookup is tenant-scoped, never by bare id. Channels are read by `(id, tenant_id)`, and connections by `(channel_id, tenant_id)`, each using its own stored `organization_id`. A connection's organization can legitimately differ from its channel's (a channel without an organization is pinned to the user's home organization), so neither read filters on the event's organization. In **one transaction**, that job:
       1. locks the `CalendarConnection` row(s) of the channel `FOR UPDATE`, in ascending `id` order;
       2. re-reads the **current** `CommunicationChannel` row `FOR SHARE`. That blocks any concurrent channel lifecycle write until this transaction commits, so the decision and the write are serialized with the channel state they are based on;
       3. derives the **desired** connection state from that persisted channel state:

          | Channel row now (checked in this order) | Desired connection state |
          |---|---|
          | channel row **not found** (hard-deleted) or `deleted_at` set | `paused`, `paused_reason = 'channel_deleted'` |
          | `status = 'requires_reauth'` (including a reconnect whose credentials failed to persist, which also sets `is_active = false`) | `requires_reauth` (non-destructive: no cleanup) |
          | `status = 'error'` | `error` with `last_error = 'channel_error'` (non-destructive; the error belongs to the channel, so it clears when the channel returns to `connected`) |
          | `status = 'disconnected'` | `paused`, `paused_reason = 'disconnect'` |
          | `status = 'connected'`, not deleted | `active` when the connection is `paused`, `requires_reauth`, or `error` with `last_error = 'channel_error'`. A connection in a **sync** `error` (any `last_error` other than `channel_error`/`organization_required`) stays `error` (see below). A connection in `error`/`organization_required` stays there **until pinned** by the pinning rule (below). After a successful pin, its status is then derived from this table as if it were `paused`. |

       4. applies the transition only if desired ≠ current. **Every** transition away from `active`, and **every** transition into `paused` (whatever the previous state), bumps `lease_epoch` and clears the lease owner in that same `UPDATE`. The value returned by that `UPDATE` is the `:revocationEpoch` the cleanup fence uses. Entering `active` reactivates.
       5. **Generation catch-up:** whenever the channel's `lifecycle_generation` differs from the connection's `channel_generation`, the same `UPDATE` sets `channel_generation = :channelGeneration` and, **even when the status does not change** (desired = current = `active`), applies the full revocation set (`lease_epoch = lease_epoch + 1, sync_lease_owner = NULL, sync_lease_until = NULL`) and resets `cleanup_attempts` to 0 (clearing `sync_lease_until` lets the inbound run enqueued below acquire immediately instead of waiting out the revoked lease's expiry; the cleanup cap is per epoch, so a `paused` connection whose epoch moved gets a fresh cleanup budget). When the connection is `active` after the `UPDATE`, the reconcile then enqueues the coalesced inbound job, so the sync that was refused or revoked resumes immediately instead of waiting for the next poll tick. A disconnect and reconnect that both landed before this reconcile therefore revoke the pre-disconnect lease exactly like a pause would. The combined pair is otherwise treated like a disconnect followed by its Undo: the final state is `connected`, so no disconnect cleanup runs, and the new lease continues from the committed cursor (cursor writes from the old lease were fenced out). A reconnect always reuses the same channel row and mailbox (`connect-channel.ts` heals the row by its dedupe key), so the cursor stays valid.
     - **The channel row is the single source of truth for authorization state.** When the inbound or outbound worker hits `CalendarAuthError`, it does not set `requires_reauth` on the connection alone.
       - **Guard against a fresh reconnect first.** The worker compares the credentials record's version (`credentialsService.resolveUpdatedAt`) with a baseline it read **after its own `refreshCredentialsIfNeeded`**, so its own token refresh never looks like a reconnect. If the credentials changed meanwhile (a reconnect stored new tokens, or a concurrent refresh), the failure may have come from the old token, so the job **does not mark anything and does not retry within itself**: it exits, clearing its own lease with the usual lease-conditional final clear (so the requeued run can acquire at once even when no catch-up revokes it, e.g. after a concurrent refresh with no reconnect), and is requeued with backoff. A reconnect has also bumped the channel's `lifecycle_generation`, so this job could not mark anyway (its reauth transition is generation-fenced, below); the reconcile's generation catch-up revokes its lease and enqueues a fresh run. That fresh run, under its new lease and the new generation, uses the new credentials and is the one that marks reauth if its own call also fails with an auth error and the version is unchanged since its own baseline.
       - Otherwise, in one transaction it marks the connection and the channel. The condition is the lease for the inbound worker (below). The outbound worker holds no lease, so its condition is `status = 'active' AND lease_epoch = :epochAtJobStart` (plus the channel's `lifecycle_generation` read at job start, checked on the channel row `FOR NO KEY UPDATE` in the same transaction, since `markChannelRequiresReauth` may follow): any pause, revocation or reauth since the job started has bumped the epoch, so a stale outbound job never marks anything. Because routine inbound lease acquisitions also bump the epoch, an outbound job often does not mark a genuine auth error. That is by design: **the inbound worker is the authoritative reauth detector** (it hits the same token on its next run), and an outbound job that does not mark retries with backoff. Under that condition, it moves the connection to `requires_reauth` **and** marks the channel row `status = 'requires_reauth'` (with `last_error`) through the new exported hub helper `markChannelRequiresReauth(em, { channelId, tenantId, organizationId, reason })` (Part B prerequisite in `communication_channels`, the same write the Gmail poller makes in `workers/poll-channel.ts`). After commit it emits the existing `communication_channels.channel.requires_reauth` event.
       - A real reconnect then genuinely changes the channel row (`requires_reauth` → `connected`, a real `UPDATE`), so the reconcile reactivates the connection.
       - A stale or duplicate `connected` delivery finds the channel still `requires_reauth` and is a no-op. No timestamp comparison is needed.
     - **`error`** is a calendar-sync condition (repeated provider failures), not an authorization state, so it stays on the connection only and is **sticky**. It is cleared only by an explicit or automatic retry, both using the same **retryable** condition: `status = 'error' AND last_error NOT IN ('organization_required','channel_error')` (with `last_error` never null for `error`), plus the channel row being `connected` (re-read `FOR SHARE` in the same transaction).
       - The explicit retry is "Sync now" or "Full resync" on the settings page.
       - The **automatic** retry by `poll-tick` additionally requires `status_changed_at < now() − OM_CALENDAR_SYNC_ERROR_RETRY_MINUTES` (default 60). That age predicate applies to the automatic retry only, not to "Sync now".
       - Both clear `last_error`.
       - A connection whose channel is itself in `error` (`last_error = 'channel_error'`) is never retried by either path; it follows the channel. A `connected` delivery never clears a **retryable** `error`.
       - **Non-retryable error `organization_required`:** neither retry path touches it. Every lifecycle reconcile **re-runs the creation pinning rule** while the error persists: the channel's `organizationId`, else the connecting user's home organization from `auth`. When one resolves, it pins it, clears `organization_required`, and then applies the mapping table **as if the connection were `paused`**:
         - `connected` channel → `active`;
         - disconnected or deleted → `paused`;
         - channel `requires_reauth` → `requires_reauth`;
         - channel `error` → `error`/`channel_error`.
         A paused connection whose channel is disconnected therefore stays `paused`, and only a connection on a `connected` channel becomes `active`. No intermediate `error`-without-reason state ever exists.
       - Reactivation of **any** connection (from `paused`, `requires_reauth` or an error) requires a non-null `organization_id`. When the desired state is `active` but no organization can be pinned, the connection lands in `error` with `last_error = 'organization_required'`. An active connection always has an organization, so this never revokes a live lease. **Every** transition of an org-less connection keeps `last_error = 'organization_required'`: the move into `paused`, a mapping to `requires_reauth`, a channel-level `error`, and a capped cleanup, which records its failure in `calendar_sync.connection.failed` instead of overwriting `last_error`. The invariant "`organization_id` is null ⇔ `last_error = 'organization_required'`" therefore holds in every state, and an org-less connection is never `active`. Disconnect → reconnect or an Undo can therefore never yield an org-less active connection.
       - **Trigger:** changing a user's home organization emits no channel event, so the `poll-tick` safety net enqueues the reconcile for `organization_required` connections (any status; after a successful pin the mapping decides the status, as if `paused`, see above), throttled to once per `OM_CALENDAR_SYNC_ERROR_RETRY_MINUTES` per connection, using the connection's `last_reconcile_requested_at`. The safety net sets it, in the same short transaction, whenever it enqueues this trigger, and enqueues only when it is older than the window. The settings page also offers "Retry setup" (`POST /api/calendar_sync/setups/retry`), which enqueues the reconcile immediately.
       - Reconnecting heals the channel row in place without updating its `organizationId` (`connect-channel.ts`), so a plain reconnect does **not** fix this. The settings page tells the user to set a home organization (picked up by the trigger above), or to delete the channel and connect it again from inside an organization.
     - **Result:** a disconnect or delete delivered **after its Undo** sees a connected channel and is a no-op. A `connected` delivered **after a newer** disconnect or delete sees the paused or deleted channel and is a no-op. Duplicate deliveries are no-ops.
     - **Discovery runs only when a connection is created.** Reactivating an existing connection reuses its stored `external_calendar_id` and never calls `resolvePrimaryCalendar`, so a failing lookup can never be repeated on every tick through the reactivation path. Discovery attempts are throttled per channel by `calendar_sync_channel_setups`, below.
     - **Discovery in flight:** creating a connection needs `resolvePrimaryCalendar`, a provider call, which never runs inside a transaction. A reconcile job for a channel with no connection runs, in this order: (1) the **attempt-start transaction** (below), which captures `:attemptGeneration` (the channel's `lifecycle_generation`, recorded as `channel_generation_seen`) and `:attemptToken`; (2) the provider call, outside any transaction, only when the attempt start counted an attempt; (3) the closing write, a transaction of its own chosen from the already-known outcome: the **discovery commit fence** for a success or a `requires_reauth` result (channel lock mode chosen from the outcome), or the token-conditional closing `UPDATE` for a rate limit or any other error, plus the unconditional `GREATEST` write of a `Retry-After` window; (4) the **reconcile transaction** (steps 1–5 above), which always runs. The fence and the reconcile transaction are never merged, so no transaction ever upgrades a channel `FOR SHARE` lock to the exclusive lock `markChannelRequiresReauth` needs.
     - **Discovery commit fence:** the result of an attempt — a successful lookup **or** a `requires_reauth` mark — is persisted only by its own transaction (step 3 above), which locks, in the global order, the channel row (`FOR SHARE` for a success, `FOR NO KEY UPDATE` when it may mark reauth) and then the setup row `FOR UPDATE`, and finds **all** of: the channel `connected` and not deleted, `channel.lifecycle_generation = :attemptGeneration`, `setup.attempt_token = :attemptToken`, and (in a separate statement after the setup-row lock) **no live connection** for the channel. Any mismatch means a disconnect/reconnect, a "Retry setup" reset or a newer attempt superseded this one: the result is **discarded**, the attempt itself writes nothing (no connection, no channel mark, no setup-row change; the only setup-row write a superseded attempt can ever make is extending the provider's `Retry-After` window, see the rate-limit bullet), and the reconcile is re-enqueued: its own transaction then applies the current state (a new attempt for the current generation, or deleting the setup row when the channel is disconnected or deleted, or when a connection already exists). A successful lookup made with the old authorization can therefore never create a connection, with its calendar id or timezone, stamped with a newer generation.
     - **New connections start at the attempt's generation:** the fenced commit inserts the connection with `channel_generation = :attemptGeneration` (equal to the channel's current generation, as the fence just verified), deletes the setup row, and enqueues the first inbound run after commit, so the first lease acquisition is not refused.
     - **Attempt start (all bookkeeping and eligibility before the provider call):** every discovery attempt, whatever enqueued it (a lifecycle delivery, including a delayed or duplicate one, "Retry setup", or the safety-net scan), goes through one short transaction. "Skip" below always means **skip discovery only** (no attempt is counted, no provider call): the reconcile transaction itself still runs in full, including the state mapping, deleting the setup row of a disconnected or deleted channel, and the backstop. The attempt start reads the channel row `FOR SHARE` first and skips unless the channel is `connected` and not deleted. It then ensures the setup row exists with the same guarded insert as `/setups/retry` (`INSERT … SELECT … WHERE NOT EXISTS (live connection for channel_id) ON CONFLICT (channel_id) DO NOTHING`, `attempts = 0`, `channel_generation_seen = NULL`, no `attempt_token`; the insert is taken after the channel lock, so it stays in the global order; a concurrent inserter of the same key (`/setups/retry`) waits on it while holding only the channel `FOR SHARE`, so no cycle can form) and skips if no row exists afterwards. It locks the setup row `FOR UPDATE`; **if that lock returns no row** (a concurrent fenced commit held the row and deleted it while this transaction waited), it skips. Otherwise, in a **separate statement** (a fresh snapshot under READ COMMITTED, taken after the lock), checks that no live connection exists for the channel. If one does, a concurrent fenced commit created it after the insert's snapshot (that commit deletes the setup row, and the insert's `ON CONFLICT` then re-created it), so the attempt start deletes the row and skips. Otherwise:
       1. **Resets** (explicit, before the eligibility test): when the channel's `lifecycle_generation` differs from `channel_generation_seen` (a real reconnect, see Cap reset; a null value on a fresh row counts as a fresh start), it sets `attempts = 0`, `last_attempt_at = NULL`, `attempt_token = NULL`, `last_error = NULL` and `channel_generation_seen = :channelGeneration`. "Retry setup" has already applied the same reset in its own transaction. `retry_after_at` is **not** cleared by either reset: it is the provider's own quota window, and every trigger honours it.
       2. **Eligibility**, the **same predicate** the safety-net scan uses (`isSetupAttemptEligible`): `attempts < OM_CALENDAR_SYNC_DISCOVERY_MAX_ATTEMPTS`, **and** `last_attempt_at IS NULL OR last_attempt_at < now() − backoff(attempts)`, **and** `retry_after_at IS NULL OR retry_after_at <= now()`. If it fails, the transaction commits only the resets from step 1 (if any) and discovery is skipped **without calling the provider**; the scan enqueues the reconcile again once the row becomes eligible. A delayed or duplicate lifecycle delivery during a `Retry-After` window or after the cap therefore never reaches the provider.
       3. **Count**: only when eligible, a single `UPDATE` sets `attempts = attempts + 1`, `attempt_token = :fresh`, `last_attempt_at = now()` and `channel_generation_seen = :channelGeneration`.
       It commits **before** `refreshCredentialsIfNeeded` and `resolvePrimaryCalendar`. A crash at any later point therefore leaves a counted attempt with a current timestamp and an up-to-date reconnect baseline, so the next attempt waits its backoff and a token refreshed by the crashed attempt can never look like a reconnect (the generation, unlike the credentials version, ignores refreshes).
     - **Attempt fencing:** the attempt start sets `attempt_token` to a fresh random id. Every reset of `attempts` ("Retry setup", a real reconnect) clears `attempt_token`, and every later attempt replaces it. **Every** setup-row write the attempt makes after its start, for **every** outcome, is a token-conditional `UPDATE … WHERE channel_id = ? AND attempt_token = :mine`: `last_error` (`requires_reauth`, `rate_limited` or any other code) and the rate-limit decrement. The one exception is the provider's `Retry-After` window, recorded unconditionally with `GREATEST` (see the rate-limit bullet). Zero rows matched means a reset or a newer attempt superseded this one, so the stale attempt writes **nothing** to the setup row and the newer attempt's outcome stands. Writes outside the setup row (connection creation, the channel-level `markChannelRequiresReauth`) are covered by the discovery commit fence above, which checks the same token together with the generation. Writes that are **not** attempt writes are never token-conditional: the attempt start itself, deleting the row (connection created, channel disconnected or deleted, the backstop), the `/setups/retry` insert and reset. The `/setups/retry` insert never sets `attempt_token`.
     - **Discovery failures:**
       - If the channel is no longer connected when the job re-reads it (for example a concurrent disconnect cleared its credentials), the **discovery result is discarded** by the commit fence and **no connection is created**. The setup row is then deleted by the re-enqueued reconcile transaction (the channel was removed), not by the discarded attempt.
       - On `CalendarAuthError`, the discovery commit fence applies: if a reconnect landed meanwhile (generation changed) or the attempt was superseded (token changed), the error came from a stale authorization or a superseded attempt, so nothing is marked and the reconcile is re-enqueued; the next attempt uses the new credentials. Only an attempt that still owns its token at the unchanged generation marks the channel `requires_reauth` through `markChannelRequiresReauth` (conditional; see Phase 1 step 3a), in the same fenced transaction that writes `last_error = 'requires_reauth'` on the setup row. **No connection is created**: a connection always has an `external_calendar_id`. The setup row is kept with `last_error = 'requires_reauth'` (state `setup_blocked_reauth`; `/setups` also derives that state from the channel itself, see the API), and the user's reconnect bumps the channel's `lifecycle_generation`, which resets `attempts` and re-runs discovery. A user who unticked the Calendar permission in Google's consent screen recovers by reconnecting with it ticked. **Precedence:** the rule above (channel no longer connected → discard, create nothing) is evaluated **first**, so a stale `connected` delivery whose discovery fails because a concurrent disconnect cleared the credentials leaves the channel `disconnected` and creates nothing.
       - On `CalendarRateLimitError`, the attempt's closing transaction **decrements `attempts`** (undoing its own pre-attempt increment) in the same token-fenced `UPDATE` (see Attempt fencing) that sets `last_error = 'rate_limited'` (`last_attempt_at` was already set by the attempt start). If a reset (and possibly a newer attempt) landed while the call was in flight, the `UPDATE` matches nothing, so `attempts` never goes below 0 and a stale attempt never cancels a newer attempt's count or overwrites its outcome (comparing the counter value instead would not work: a reset followed by a new increment reproduces it). A rate limit therefore never moves the setup toward the cap, while a crash mid-attempt (no closing transaction) still counts. When the error carries `retryAfter` (from the provider's `Retry-After` header), a separate `UPDATE`, **not** token-conditional, sets `retry_after_at = GREATEST(retry_after_at, now() + retryAfter)` when the setup row still exists: the quota window is a fact about the provider, not this attempt's outcome, so even a superseded attempt records it and can only extend it. Every trigger honours it through the shared eligibility predicate, and it lapses on its own once past (no attempt starts before then).
       - Any other error records `last_error` on the setup row and retries with backoff (setup throttling). A connection is created **only** after discovery succeeds; until then the settings page shows "Setting up…" (or "Setup failed" after the cap) for the channel.
     - **Safety net for writes without events:** each `poll-tick` performs two batched, **tenant-scoped** reads, each row keeping its own organization: the connections, and the channel rows for their `channel_id`s through the hub's channel read path, not a cross-module ORM join. It applies the **same mapping function** as the reconcile, and enqueues a reconcile job for every connection that either:
       - disagrees with its channel, including a `channel_generation` that differs from the channel's `lifecycle_generation` (a lost lifecycle delivery after a disconnect + reconnect). A `connected` channel with a connection in a retryable `error` **or** in `error`/`organization_required` counts as **agreeing**, so the safety net never fights the sticky-error rule. `organization_required` connections are enqueued **only** by the throttled pinning trigger below, even on a generation mismatch (they never hold a lease, and the pinning reconcile performs the catch-up);
       - or is `paused` with **unfinished cleanup** (`cleanup_epoch IS DISTINCT FROM lease_epoch`). Cleanup attempts are capped at `OM_CALENDAR_SYNC_CLEANUP_MAX_ATTEMPTS` (default 10) per epoch. `cleanup_attempts` is reset to 0 by the pausing `UPDATE` and incremented in its own short transaction before each attempt, so a crash still counts. After the cap, `last_error = 'cleanup_failed'` is recorded (except on an org-less connection, which keeps `organization_required`; the failure is then only reported) and reported via `calendar_sync.connection.failed`, and the safety net stops re-enqueuing until the epoch changes or an operator retries with the CLI command `yarn mercato calendar_sync retry-cleanup --tenant <tenantId> --connection <id>`, which acts only on a `paused` connection with unfinished cleanup, resets `cleanup_attempts`, clears `last_error = 'cleanup_failed'` and enqueues the reconcile.
       - It also scans **connected calendar-provider channels that have no connection yet** (discovery not finished, "Setting up…"). Discovery attempts are tracked per channel in `calendar_sync_channel_setups`, and the scan re-enqueues the reconcile only for rows that pass `isSetupAttemptEligible` (the predicate the attempt start re-checks under its locks): `last_attempt_at IS NULL` (a row never attempted or just reset is selected immediately) **or** `last_attempt_at < now() − backoff(attempts)` with `backoff(n) = 5 min × 2^max(n − 1, 0)`, **and** `retry_after_at` (set from a rate limit's `Retry-After`) null or past, **and** `attempts < OM_CALENDAR_SYNC_DISCOVERY_MAX_ATTEMPTS` (default 10). The scan is only a scheduler: the attempt start is the enforcement point for every trigger. It **also** selects a row whose `channel_generation_seen` is not null and differs from the channel's `lifecycle_generation`, whatever its `attempts` and backoff (but still honouring `retry_after_at`): the channel was reconnected since the last attempt, and the attempt start will reset the cap (this covers a lost `channel.connected` delivery for a capped setup). After the cap, the settings page shows "Setup failed" with the last error and a "Retry setup" action that resets `attempts`. A deterministically failing lookup (e.g. a `403 accessNotConfigured` because the Calendar API is disabled in the Google Cloud project) therefore stops calling the provider.
       - That covers channel writes that emit no lifecycle event, lost deliveries, and interrupted cleanups.
     - Channel delete is undoable, so the connection row is paused, never soft-deleted. `deleted_at` on the connection is set only when the connection is permanently removed.
     - **Failure counter:** `consecutive_failures` on the connection counts failed inbound runs. A run that fails with a provider error other than `CalendarAuthError` or `CalendarRateLimitError` increments it (lease-conditional, like every worker write); a successful run resets it to 0, and so does every transition back to `active` (explicit or automatic retry, reactivation). When it reaches `OM_CALENDAR_SYNC_ERROR_THRESHOLD` (default 5), the same `UPDATE` moves the connection to `error` with the failure's machine code in `last_error`.
     - **Transitions the inbound worker makes itself** (`requires_reauth` after an auth error, `error` when `consecutive_failures` reaches the threshold) are conditional on still holding the lease: `WHERE id = ? AND status = 'active' AND sync_lease_owner = :me AND lease_epoch = :epoch`, and the same transaction then re-reads the channel row (`FOR NO KEY UPDATE` for the `requires_reauth` transition, which may call `markChannelRequiresReauth`; `FOR SHARE` for `error`) requiring `lifecycle_generation = :generation` (the full fence, connection → channel); on a mismatch it rolls back and touches nothing. For `requires_reauth`, the same transaction also marks the channel row through `markChannelRequiresReauth`, but only when the conditional connection update matched; the event is emitted after commit. Zero rows updated means the worker was already fenced out, so it exits without touching status. It touches neither the connection nor the channel. A stale job whose delayed provider call fails with `CalendarAuthError` after a disconnect and immediate reconnect can therefore never push the reconnected connection back into `requires_reauth`, even when both lifecycle writes committed before any reconcile (the generation changed although the epoch did not). The credentials-version guard stays only as a cheap early exit for the worker (no mark, requeue) when the version moved under it; discovery, which holds no lease, uses the discovery commit fence (generation + attempt token) instead.
     - The revoking `UPDATE` conflicts with the `FOR SHARE` fence, so an in-flight fenced transaction finishes first: its mutation predates the revocation and is cleaned up by the flow that follows. Every later fenced transaction fails the epoch, status or `deleted_at` check. A provider call still in flight at disconnect therefore cannot recreate links or external rows, write CRM records, or advance the cursor when it returns.
     - **Cleanup is level-triggered and resumable.** The reconcile runs, or resumes, the disconnect/delete cleanup (unlink, handover, purge) whenever the connection is `paused`, `cleanup_epoch IS DISTINCT FROM lease_epoch`, and the channel is still disconnected or deleted. This holds whether or not this run just paused it.
       - `:revocationEpoch` is **always** the connection's current `lease_epoch`, read under `FOR UPDATE` when the cleanup starts or resumes. Right after a pause, that is exactly the value the pausing `UPDATE` wrote. While a connection stays paused, its epoch changes only through another pause or a generation catch-up (step 5), and reactivation flips the status. Either way an in-flight cleanup is fenced out by the epoch change and resumes at the new epoch, so this is safe.
       - The **last** cleanup transaction sets `cleanup_epoch = lease_epoch`.
       - A crash, a deploy or a transient error mid-cleanup therefore leaves `cleanup_epoch` behind, and the next reconcile, a retry or the `poll-tick` safety net, finishes it.
     - **Cleanup is fenced against reactivation.** The cleanup runs after the revoking `UPDATE` commits, in short transactions. Each one first locks the connection row `FOR UPDATE` and re-reads the channel row `FOR SHARE`. It proceeds only while `status = 'paused' AND lease_epoch = :revocationEpoch` **and** the channel is still disconnected or deleted. Every move into `paused` bumps the epoch, so an older cleanup can never pass the fence of a later pause. Because **moves into `paused`** come only from the level-triggered reconcile (the worker's own `requires_reauth`/`error` transitions revoke the lease but never pause or trigger cleanup), a stale delivery can never create a revocation epoch in the first place, so it can never authorize a cleanup. If the connection was reactivated meanwhile (Undo or reconnect), the cleanup stops, and the reactivation's full resync reconciles whatever was already cleaned. Reactivation's own `UPDATE` serializes with these locks, so cleanup never undoes links that a new job re-attached.
     - **Immediate reconnect:** reactivation sets `status = 'active'`, clears `paused_reason`, and never lowers `lease_epoch`; a new lease increments it again. The old job's epoch therefore stays invalid forever, even if the same connection row is reactivated while that job's provider call is still pending.
   - **Hub-only mutations** (links, external rows, sweep) run in short hub transactions that start with the fence check.
   - **Customers writes keep their own transaction**, so their side effects stay durable-after-commit. They are **not** run on a hub transaction via `ctx.transactionalEm`: a command that joins a caller-owned transaction emits its CRUD side effects (events, query-index jobs) **before** the outer commit (`customers/commands/interactions.ts`, `runInTransaction`), and `CommandBus.execute` runs post-commit work immediately. Instead:
     - The hub passes the fence through the existing, documented **`ctx.beforeTransactionalWrite`** guard, which supported handlers invoke inside their own write transaction before reading or mutating. The guard runs the fence check on that transaction-bound EntityManager and throws `[internal] calendar_sync lease lost` on failure, which rolls the command back.
     - Because the command owns its transaction, its events and indexing fire only after its own commit, and never for a rolled-back write.
     - `create` and `update` already invoke the guard. Part A adds the same `beforeTransactionalWrite` support to `customers.interactions.cancel` and `customers.interactions.delete`, which today always fork their own EntityManager without it.
   - **Hub bookkeeping** for a customers write (link watermarks, `content_hash`, clearing `pending_write_hash`) is a separate hub transaction run right after the command commits. It takes the fence, then the per-interaction lock, and then:
     - sets the primary's `synced_interaction_updated_at` to **exactly** the interaction's current `updatedAt` (no `GREATEST`, which could run ahead under app-clock skew) **only if** both hold:
       - the stored row still hashes to *this* write's `pending_write_hash`, which is how bookkeeping identifies its own write, since the command returns only `{ interactionId }`;
       - `pending_write_was_pristine` is true.
     - When the row was **not** pristine (a user's CRM edit preceded this hub write), the watermark is left behind, so the user's edit stays visible as a CRM edit. A hub write such as an RSVP therefore never "absorbs" an earlier user edit: such an interaction never becomes pristine again by accident, and a later private-organizer demotion keeps it (`privacy_changed_kept`) instead of deleting it.
     - clears the marker with **compare-and-clear** (`WHERE pending_write_hash = :mine`). Recovery also clears a marker that no longer matches the stored row (a later non-hub edit superseded it).
     - A later hub write that already superseded this one owns the marker and advances the watermark itself, so out-of-order bookkeeping can neither regress the watermark nor erase another write's marker. If the lease is lost in between, the bookkeeping aborts and the next lease holder re-derives it through the pending-write marker (Watermark rule). Re-applying is idempotent: the version guard and `content_hash` skip unchanged content, and repeating an identical customers update is harmless.
   - **Lost-update protection and per-interaction serialization** (independent of `OM_OPTIMISTIC_LOCK`). The hub's `beforeTransactionalWrite` guard runs inside the customers command's own transaction, before the command reads anything, and acquires locks in one fixed order on every hub path:
     1. Fence check: the connection row `FOR SHARE`, as above.
     2. The per-interaction advisory lock `pg_advisory_xact_lock(hashtext('calendar_sync:interaction:' || :interactionId))`, which serializes **all hub writers** of that interaction.
     3. The interaction row locked `FOR UPDATE` (`findOne` with `LockMode.PESSIMISTIC_WRITE` on the transaction-bound EntityManager; read-only use of the customers entity, as in `example_customers_sync`). A concurrent CRM user edit therefore waits for this write instead of being overwritten.
     4. The locked row's `updatedAt` compared with the version the hub computed its change from. On a mismatch the guard throws a hub conflict and rolls the command back; the hub re-reads, recomputes and retries (≤ 3, then requeues).
     - Because the check is the hub's own, it holds even when `OM_OPTIMISTIC_LOCK` is off or excludes `customers.interaction`. No synthetic request header is used.
     - For `customers.interactions.create`, steps 3–4 are skipped: the row does not exist yet, and the reserved caller-supplied id plus the primary-per-meeting unique index already make creation single-writer. The guard writes the marker with `pending_write_was_pristine = true` and the hash of `toStoredSyncedFields(createInput)`.
     - A **missing** interaction (hard-removed, or soft-deleted outside the delete flow) is never retried: it goes to the Missing interaction path.
   - **Version guard** (defence in depth): a link applies a normalized event only when `event.updatedAt ≥ link.externalUpdatedAt`. A provider call that returns after a newer page of the same event was applied is dropped instead of overwriting newer content.
   - **Contention:** `PUT /connections` writes the connection row, so it can wait for one short fence-holding transaction: one page-apply or one customers command. That transaction can itself briefly wait on the per-interaction lock (held by a delete, restore or bookkeeping transaction) or on a CRM user's row lock. Every lock holder is short-lived. A settings save never waits on a provider network call or on a whole sync.
3. **Token:** `refreshCredentialsIfNeeded` returns a fresh token. Reauth errors route to the hub's `requires_reauth`.
4. **Listing:**
   - The worker **loops one page per call**, at most `OM_CALENDAR_SYNC_PAGE_BUDGET` pages per job; the adapter never sees the budget. Each call is `adapter.listChanges(ctx, { state: connection.providerState, pageState: connection.providerPageState, mode: traversal_mode, horizon: { from: traversal_horizon_from, to: traversal_horizon_to } })`, using the persisted traversal (step 6). It returns `{ events, deletedExternalIds, hasMore, nextPageState, nextState, fullResyncRequired? }`.
   - After applying each page, a fenced transaction persists `provider_page_state = nextPageState` together with the traversal record.
     - When `hasMore = false`, it instead finishes the traversal in the order given in step 6: commit `provider_state = nextState`, run the full-sync sweep (which needs the traversal's run id and start time), clear the serviced request, and only then clear the traversal.
     - When the budget runs out with `hasMore = true`, the worker enqueues a follow-up job, which resumes from the stored `provider_page_state`. Page two and beyond are therefore always reachable.
   - `fullResyncRequired` (Google `410`, Graph expired delta link, CalDAV invalid sync-token), on any page of any traversal, sets `full_resync_requested_at = now()` and **invalidates the current traversal record** (the committed cursor is not advanced). The next run therefore starts a fresh full traversal under the rules in step 6, even when the error arrived on page 2 of an incremental traversal or in the middle of a full one.
   - Provider-owned series masters fan out through `adapter.listInstances` within the horizon.
5. **Placement:** each event is validated against the hub's zod schema for `NormalizedCalendarEvent` and goes through `applyNormalizedEvent` (placement, shared-meeting identity, § Mapping). **Echo skip:** the event is skipped only when **all** of these hold: the hub-computed `content_hash` (SHA-256 of the normalized, mapped fields) equals `link.contentHash`, the link is `state = 'linked'`, its placement is live (an external row exists for `external`, or `interaction_id` is current for `interaction`), and the run is `incremental`. A `full` run **always re-evaluates placement** (attach, promote, re-create external rows, auto-create), so reconnects and "enable auto-create, then full resync" take effect on unchanged events. `content_hash` is cleared whenever a link is unlinked or re-placed.
   - **Placement re-evaluation is separate from content application.** Provider content is written to an interaction **only when the provider copy changed** since the last apply: `content_hash ≠ link.content_hash` (link not freshly cleared) or `event.updatedAt > link.externalUpdatedAt`.
   - When only the CRM side changed, the CRM version is kept. Outbound is enqueued if push is enabled; otherwise the edit stays CRM-only, as the editor states. A full sync, `410` or reconnect therefore never overwrites CRM edits with unchanged provider content.
   - For a freshly cleared hash (unlink/re-place) **on a link with no `external_updated_at` of its own**, content is applied only when the interaction is sync-pristine. A link that still has its own watermark uses `event.updatedAt > link.externalUpdatedAt` as the change signal, with the normal conflict rule. This matches the first-apply-as-primary rule. The check is provider-independent: it works for CalDAV, where one ETag covers a whole series. `version` is used only for `If-Match` concurrency.
6. **Cursor and paging:**
   - The connection keeps the **committed cursor** `provider_state` (the adapter's `nextState`, persisted only when a listing finishes, `hasMore = false`) and one **traversal** record, persisted **atomically together** after every page:
     - `traversal_mode`: `incremental` | `full`;
     - `traversal_run_id`;
     - `traversal_started_at`;
     - `traversal_horizon_from` / `traversal_horizon_to`: the horizon fixed at traversal start and passed unchanged to every page call;
     - `provider_page_state`: the adapter's `nextPageState`.
   - When the page budget is exhausted with `hasMore = true`, the worker persists the traversal record and enqueues a follow-up inbound job. The next run **continues the same traversal**: same mode, same `traversal_run_id`, same fixed horizon, from the stored page. It never stamps a new run id mid-traversal. A listing of any size converges.
   - **A full request arriving mid-traversal:**
     - During an **incremental** traversal: its page state is incompatible with a full listing, so it is **invalidated**. The traversal record is cleared, while the committed cursor is untouched. A fresh full traversal starts with a new `traversal_run_id`, a new fixed horizon and `traversal_started_at = now()`.
     - During a **full** traversal: no restart. The running traversal continues.
   - **Completion:** when a traversal finishes (`hasMore = false`), the worker commits `provider_state`. If the traversal was `full`, it runs the sweep below **for its own `traversal_run_id` only**, then clears `full_resync_requested_at` **only if it is ≤ `traversal_started_at`**. A request made after that traversal began was not serviced by it and triggers another full run. Finally the traversal record is cleared.
   - A full traversal sets `last_seen_run_id = traversal_run_id` on every link it sees. On completion it **marks and sweeps**, within its fixed horizon: links of the connection whose `starts_at` is inside the horizon and that were not seen are treated as deleted. Excluded from the sweep: **owning** links (`push_enabled` and (`origin = 'crm'` or `is_organizer`)) with `external_event_id IS NULL` (first push or re-insert still pending); links in `deleting` (their delete flow owns them); and every link whose provider identity was established **after the traversal started** (`external_identity_at ≥ traversal_started_at`). Provider listings are not snapshots, so an event inserted by an outbound push, re-inserted, or attached while a long full traversal was paging may never be listed by it. That exclusion keeps such links from being swept. Only links with `state NOT IN ('unlinked','deleting')` are considered. Each unseen link is unlinked (`unlink_reason = 'sweep'`, with primary handover) and its external row soft-deleted. The sweep never overwrites an existing `unlink_reason`, so a `crm_delete` row keeps its reason for undo. This sweep is needed because providers return deletions only for a limited time.
   - Failed events are retried on the next tick (`pendingRetryExternalIds`, ≤ 50).

### Outbound flow (interactions only)

1. **Subscriber** on `customers.interaction.{created,updated,canceled,reverted}` (**not** `deleted`: the user-delete subscriber in Transitions is the **only** handler of `customers.interaction.deleted`. It commits the owning link's `deleting` state first and only then enqueues outbound, so the worker can never see a deleted interaction before the delete intent is recorded):
   - drops events whose `syncOrigin` is `calendar_sync`;
   - requires the **primary** link with `pushEnabled` that is either CRM-origin or organized by the connection's user;
   - enqueues to `calendar-sync-outbound` (`coalesceBy: (p) => \`link:${p.linkId}\``) with payload **`{ linkId }` only**. The worker re-derives the action from state, checked in this order: (1) link not `linked`/`deleting`, or push off → **no-op**; (1b) link `deleting` while the interaction is live (undo in progress) → **no-op**, the restore handler owns it; (2) interaction soft-deleted and link `deleting` → provider delete/cancel + delete-flow CAS unlink (see User deletes an interaction); (3) interaction soft-deleted and link still `linked` → **no-op** (the delete handler will enqueue); (4) interaction hard-missing → detach (see Missing interaction); (5) `canceled` → cancel; (6) no `external_event_id` → insert; (7) otherwise patch. Coalescing can therefore never drop a delete intent.
2. **Worker:** builds an `OutboundCalendarEvent` from the interaction (`findOneWithDecryption`) and calls the adapter:
   - `insertEvent` (idempotent per adapter; `conference` requested when `conferenceRequested` and the adapter has the capability);
   - `patchEvent` with `expectedVersion`; a `CalendarVersionConflictError` re-reads the event (`getEvent`), re-applies inbound for it, then re-evaluates the conflict rule. With `versionScope: 'series'` (CalDAV), `expectedVersion` is the series resource version stored on every instance link of that series;
   - `cancelEvent` / `deleteEvent` (organizer only; otherwise unlink with `unlink_reason = 'not_organizer'`).
3. **Conference:** a `conferencePending` result is polled through `getEvent` with backoff (max 5). Meeting fields are then written back via `customers.interactions.update` (`syncOrigin`).
4. **Shared meetings:** colleagues' calendars receive the provider's invitation. Their inbound sync sees the same iCalendar UID and attaches, so no duplicate is created.

### Promotion flow

1. **Triggers:**
   - **person subscriber:** reads the person's primary email via the matcher and computes `hashForLookup(email, 'calendar_sync:event_link.attendee_email')`. It looks up non-private links in the org with `attendee_email_hashes @> ARRAY[:hash]`:
     - `placement = 'external'` → `promote`;
     - `placement = 'interaction'` on the primary link without the person → re-apply that adds the person to `linkedEntities` (`managedPersonIds`);
   - a placement change during inbound sync.
   - These **automatic** triggers enqueue the coalesced `promote` job described below. Its payload carries **no intent** (`{ organizationId, meetingKey }` only), so the job re-derives everything from current state, as queue `AGENTS.md` rule 4 requires.
   - **Manual** promotion (`POST /api/calendar_sync/events/[id]/promote`: Create person, Link to existing customer, Add to CRM) never goes through the queue. If its reserve loses the race, it attaches, adds the requested `entityId` to the winner's `linkedEntities`, and returns the winner's `interactionId`. **Undo of a manual promotion is sticky:** it sets `auto_promote_suppressed_at` on the event's links. Automatic promotion skips suppressed links until the event's attendee set changes or a user promotes manually again, so undo is not silently reversed by the next person update. It runs **synchronously inside the `calendar_sync.external_event.promote` command**, using the same reserve → create → finalize steps, so the chosen `entityId` cannot be dropped by coalescing, the undo snapshot is captured at execution time, and the API returns the created `interactionId`.
2. **Reserve → create → finalize** (shared by the `promote` worker on queue `calendar-sync-promote`, `coalesceBy: (p) => \`meeting:${p.organizationId}:${p.meetingKey}\``, and the manual command). It re-matches attendees (the worker) or uses the request's `entityId` (the command), then runs:
   - **Locking:** each step runs in **its own** transaction. Before (a) the meeting has no interaction id; it is serialized by the primary-per-meeting unique index and the per-meeting coalescing key.
     - (b) `customers.interactions.create` takes the per-interaction lock through its `beforeTransactionalWrite` guard.
     - (c) finalize takes the lock in its own hub transaction for link changes, and applies the bookkeeping rules to the create's marker (own-write hash check, pristine flag, compare-and-clear). Its participant additions are separate `customers.interactions.update` calls that lock through their guard.
     - No step holds the lock while awaiting a customers command (see Locking rules).
   - **(a) Reserve:** in one transaction, set the chosen primary link to `placement = 'interaction'`, `is_primary = true`, `state = 'promoting'` and a new `interaction_id`. A unique violation on the primary-per-meeting index means another job won, so this job re-runs as ATTACH (see First-import race);
   - **(b) Create:** `customers.interactions.create` with that caller-supplied `id` and `syncOrigin`;
   - **(c) Finalize:** set the primary to `state = 'linked'`, attach every external sibling link with the same meeting key, add the participants of **every** link attached to this interaction (including links that attached while it was `promoting`), soft-delete all their external rows, and advance the primary's watermark.
3. **Recovery:**
   - **Staleness:** a `promoting`/`demoting`/`deleting` link counts as **stale** only when `state_changed_at < now − OM_CALENDAR_SYNC_STALE_STATE_MINUTES` (default 15).
   - **Sweep:** `poll-tick` sweeps stale rows (indexed on `(state, state_changed_at)`) and resumes them. Stale `deleting` links are resumed only when their connection is `active`; otherwise reactivation re-enqueues them. The same sweep performs delete **abandonment** (see User deletes an interaction). An existing interaction with the reserved id skips (b); a missing one re-runs it.
   - **Fresh rows:** any promote job or inbound tick that meets a **fresh** `promoting` link treats it as in-flight and no-ops, so a live reservation is never "recovered" concurrently.
   - All paths are idempotent.

### Conflict rule

Applied on the primary link only, and only when the provider copy changed (see Inbound step 5; a CRM-only change is never a conflict and never overwritten). A conflict exists when `event.updatedAt > link.externalUpdatedAt` **and** the interaction is **not effectively pristine** (Watermark rule predicate, evaluated after recovery, under the per-interaction lock). A committed hub write whose bookkeeping has not run yet therefore never counts as a CRM edit. Last writer wins; the worker sets `link.lastConflictAt` and emits `calendar_sync.event_link.conflict_resolved`.

### Commands & Events

| Kind | Id | Notes |
|------|----|-------|
| Command | `calendar_sync.connection.update` | Per-user connection settings; undo restores the snapshot |
| Command | `calendar_sync.settings.update` | Upserts the organization's `CalendarSyncSettings` row (compare-and-set on `updated_at`); undo restores the previous snapshot. Already auto-created people are not removed (documented). |
| Command | `calendar_sync.event_link.update` | Push intent. Bumps `intent_updated_at` and **enqueues `calendar-sync-outbound` for the link whenever the effective intent changes** (push turned on, conference requested). This is the path by which a newly created CRM meeting first reaches the provider, because `customers.interaction.created` fires before the editor's `onAfterSave` creates the link. Undo restores the intent and enqueues outbound to reconcile. The external provider write is not reversible. |
| Command | `calendar_sync.external_event.promote` | Manual promotion, executed synchronously (reserve → create → finalize). **Undo** deletes the interaction (via customers command, `syncOrigin`). It then selects links by `interaction_id` **at undo time**, which includes links attached after the promotion, and re-places each one as external from its latest normalized copy (the same procedure as demotion step (c)). It sets `auto_promote_suppressed_at` on each. |
| Reused | `customers.interactions.create/update/cancel/delete`, `customers.people.create` | System context `auth.sub = 'system:calendar_sync'`, `syncOrigin: 'calendar_sync'`, owner/author = the primary connection's user |
| Event (hub) | `calendar_sync.connection.synced` | `{ connectionId, providerKey, mode, applied, external, attached, promoted, peopleCreated, skipped, failed }` |
| Event (hub) | `calendar_sync.connection.failed` | `{ connectionId, providerKey, reason }` |
| Event (hub) | `calendar_sync.external_event.promoted` | `{ meetingKey, interactionId, trigger: 'match'\|'person_created'\|'manual'\|'link_existing' }` |
| Event (hub) | `calendar_sync.event_link.conflict_resolved` | `{ linkId, interactionId, winner }` |
| Event (hub) | `calendar_sync.interaction.demoted` | `{ meetingKey, interactionId, linkCount }`; emitted after demotion finalizes |
| Event (hub, new) | `communication_channels.channel.connected` | `{ channelId, providerKey, channelType, userId, tenantId, organizationId }`; emitted by the OAuth callback, the credential connect command, and the undo of channel disconnect, delete and admin-delete. The user-deleted cascade additionally emits the existing `channel.disconnected` per channel it disconnects (its bulk update must return the affected ids), and `markChannelRequiresReauth` emits the existing `channel.requires_reauth` only when it matched |

## Provider Contract (`calendar-provider.v1`)

Exported from `@open-mercato/core/modules/calendar_sync/lib/provider` and registered through `registerCalendarProviderAdapter(adapter): () => void`. This follows `registerChannelAdapter` exactly:
- the registry is a `globalThis`-scoped `Map` (survives module re-evaluation under hot reload);
- the adapter is structurally validated at registration: `changeNotifications` ⇔ `startNotifications`/`stopNotifications`/`parseNotification` are all present. **Behavioural** rules (for example: when `conference ≠ null`, `insertEvent` MUST honour `requestConference`; inserts MUST be idempotent per `idempotencyKey`) cannot be checked at registration. They are enforced by the exported **conformance suite** `runCalendarProviderConformanceSuite(createAdapter, fixtures)`, which every provider package MUST run in its unit tests;
- a duplicate `providerKey` throws;
- the returned function unregisters (used by tests);
- companion functions `hasCalendarProviderAdapter(key)`, `getCalendarProviderAdapter(key)` and `listCalendarProviderAdapters()`;
- **hot reload:** provider `setup.ts` guards with `if (hasCalendarProviderAdapter('google_calendar')) return` before registering, the same pattern as `channel_gmail/setup.ts` with `hasChannelAdapter`.

 The `providerKey` MUST equal the provider's `ChannelAdapter.providerKey`; that is how a connected channel maps to an adapter.

```ts
type CalendarProviderCapabilities = {
  changeNotifications: boolean                  // Google watch, Graph subscriptions; CalDAV: false
  conference: { key: string; labelKey: string } | null   // Google: { key: 'google_meet' }, Graph: { key: 'teams' }
  eventKinds: Array<'focus_time' | 'out_of_office'>       // Google: both; Graph: ['out_of_office']; CalDAV: []
  clientSuppliedIds: boolean                    // Google true, Graph false (uses transactionId)
  clientSuppliedIcalUid: boolean                // provider honours a hub-chosen UID on insert: CalDAV (`UID`) true; Google false (create accepts
                                                // `id` OR `iCalUID`, and the client `id` is needed for idempotency); Graph false
  // optional: predictIcalUid?(idempotencyKey) — a deterministic UID the provider will assign
  // (Google: `<id>@google.com`, to be verified in Phase 7); lets the hub pre-assign the key without supplying it
  versionScope: 'event' | 'series'              // CalDAV: 'series' (one ETag per resource incl. overrides)
}

type CalendarProviderAuthContext = {
  accessToken: string | null                    // fresh, from refreshCredentialsIfNeeded (OAuth providers)
  credentials: Record<string, unknown>          // provider credentials (e.g. CalDAV server URL + app password)
  signal: AbortSignal
}

type CalendarProviderContext = CalendarProviderAuthContext & {
  externalCalendarId: string
}

type NormalizedCalendarEvent = {
  externalId: string
  seriesExternalId: string | null               // parent series for instances
  isSeriesMaster: boolean
  icalUid: string | null
  instanceKey: string                           // MUST come from buildInstanceKey(); '' for single events and masters
  version: string                               // concurrency token: etag / changeKey / CalDAV resource ETag (series-wide when versionScope = 'series')
  updatedAt: string
  status: 'confirmed' | 'tentative' | 'cancelled'
  kind: 'default' | 'focus_time' | 'out_of_office' | 'working_location' | 'birthday' | 'other'
  isPrivate: boolean
  isBusy: boolean
  title: string | null
  description: { format: 'html' | 'text'; value: string } | null
  location: string | null
  start: string; end: string; allDay: boolean; timezone: string | null
  recurrence: string[] | null                   // RFC 5545 lines, masters only
  organizer: { email: string | null; name: string | null; self: boolean } | null
  attendees: Array<{ email: string; name: string | null; status: 'accepted' | 'declined' | 'tentative' | 'needs_action'; self: boolean; resource: boolean; organizer: boolean }>
  conference: { url: string | null; provider: string | null; details: MeetingDetails | null; pending: boolean } | null
  htmlLink: string | null
  crmInteractionId: string | null               // round-tripped hub marker (extended properties / X- property)
}

type OutboundCalendarEvent = Omit<NormalizedCalendarEvent,
  'externalId' | 'version' | 'updatedAt' | 'seriesExternalId' | 'isSeriesMaster' | 'instanceKey' | 'htmlLink'
  | 'isPrivate' | 'isBusy' | 'kind'>
  // privacy/availability fields are provider-owned: inserts use provider defaults (default visibility, busy,
  // normal event); patches never send them, so a CRM edit can never un-private or re-type a provider event.
  // icalUid is set on insert when capabilities.clientSuppliedIcalUid

interface CalendarProviderAdapter {
  providerKey: string
  labelKey: string
  capabilities: CalendarProviderCapabilities
  providerStateSchema: z.ZodType                // validates connection.providerState (cursor, page token, …)
  resolvePrimaryCalendar(authCtx: CalendarProviderAuthContext):          // discovery (CalDAV principal / calendar-home) lives here
    Promise<{ externalCalendarId: string; timezone: string | null }>
  listChanges(ctx, input: { state: unknown; pageState: unknown | null; mode: 'incremental' | 'full'; horizon: { from: Date; to: Date } }):
    Promise<{ events: NormalizedCalendarEvent[]; deletedExternalIds: string[]; hasMore: boolean;
              nextPageState: unknown | null;            // when hasMore — persisted by the hub after every page
              nextState: unknown | null;                // when !hasMore — the new committed cursor
              fullResyncRequired?: boolean }>
    // ONE page per call; the hub loops and enforces the page budget
    // MUST return fullResyncRequired when the stored cursor cannot cover `horizon`
    // (e.g. a Graph calendarView delta link is bound to the window it was created with)
  listInstances(ctx, input: { seriesExternalId: string; from: Date; to: Date }): Promise<NormalizedCalendarEvent[]>
    // providers without server-side expansion (CalDAV) expand RFC 5545 inside the adapter
  getEvent(ctx, externalId: string): Promise<NormalizedCalendarEvent | null>
  insertEvent(ctx, input: { idempotencyKey: string; event: OutboundCalendarEvent; requestConference: boolean; notifyAttendees: boolean }):
    Promise<NormalizedCalendarEvent>             // MUST be idempotent per idempotencyKey (= `<link id>:<insert_generation>`; a new
                                                 // generation MUST create a new event, never dedupe against an older one)
  patchEvent(ctx, input: { externalId: string; expectedVersion: string; event: OutboundCalendarEvent; notifyAttendees: boolean }):
    Promise<NormalizedCalendarEvent>             // throws CalendarVersionConflictError
  cancelEvent(ctx, input: { externalId: string; notifyAttendees: boolean }): Promise<void>
  deleteEvent(ctx, input: { externalId: string; notifyAttendees: boolean }): Promise<void>
  startNotifications?(ctx, input: { channelId: string; token: string; address: string }): Promise<{ resource: string; expiresAt: Date }>
  stopNotifications?(ctx, input: { channelId: string; resource: string }): Promise<void>
  parseNotification?(request: { headers: Headers; body: string; query: URLSearchParams }):
    | { kind: 'validation'; response: { status: number; body: string; contentType: string } }   // Graph handshake
    | { kind: 'changes'; items: Array<{ lookup: { by: 'channelId' | 'resource'; value: string }; token: string }> }
    //   one POST may batch several notifications (Graph `value[]`); Google maps X-Goog-Channel-ID → by 'channelId',
    //   Graph maps subscriptionId → by 'resource' and clientState → token
    | { kind: 'sync' } | { kind: 'ignore' }
}

// exported helper (same import path) — the only sanctioned way to build NormalizedCalendarEvent.instanceKey
function buildInstanceKey(input: { originalStart: string | null; allDay: boolean; timezone: string | null }): string
```

Errors are typed: `CalendarVersionConflictError`, `CalendarAuthError` (→ reauth), `CalendarRateLimitError` (→ backoff; optional `retryAfter` in seconds, parsed from `Retry-After`), `CalendarNotFoundError`. Adapters never log payloads.

**Fit check (design-time):**

| Contract need | Google Calendar v3 | Microsoft Graph | CalDAV (RFC 4791/6578) |
|---|---|---|---|
| Incremental changes | `syncToken`, `410` → full | `calendarView/delta` link (window-bound → `fullResyncRequired` on horizon roll), expiry → full | `sync-collection` token, invalid → full |
| Primary calendar discovery | `events.list?calendarId=primary&maxResults=1` (`timeZone` in the response; works with `calendar.events` scope); id = account email from the OAuth userinfo | `/me/calendar` | principal → `calendar-home-set` → default calendar (`resolvePrimaryCalendar(authCtx)`) |
| Meeting identity | `iCalUID` + `originalStartTime` | series-wide identity: the `uid` property where available, else the **series master's** `iCalUId` (fetched via `seriesMasterId`; the per-occurrence `iCalUId` differs per occurrence), + `originalStart` | `UID` + `RECURRENCE-ID` (all via `buildInstanceKey`) |
| Version / concurrency | per-event `etag` + `If-Match` | per-event `@odata.etag` + `If-Match` | per-resource `ETag` (`versionScope: 'series'`) + `If-Match` |
| Echo detection | hub `content_hash` | hub `content_hash` | hub `content_hash` (per-instance despite series ETag) |
| Instance expansion | server (`events.instances`) | server (`instances`) | in-adapter RFC 5545 expansion |
| Notifications | `events.watch`; one notification per POST, `X-Goog-Channel-ID/Token` | subscriptions; batched `value[]`, `subscriptionId` + `clientState`, validation handshake | none → polling |
| Idempotent insert | client `id` | `transactionId` | client-chosen resource name |
| Conference | `conferenceData.createRequest` (Meet) | `isOnlineMeeting` (Teams) | none |
| Focus / OOO | `eventType` (`focusTime`, `outOfOffice`) | `showAs: 'oof'` only (no native focus kind) | none |
| Privacy / busy | `visibility`, `transparency` | `sensitivity`, `showAs` | `CLASS`, `TRANSP` |

All three fit the contract through capability flags (`changeNotifications`, `conference`, `eventKinds`, `versionScope`) and adapter-side responsibilities (expansion, `fullResyncRequired`, batched notifications).

## Data Models

### `calendar_sync` module (Part B, new)

#### `CalendarConnection` → `calendar_sync_connections`

One row per (communication channel, external calendar). User-editable → `updated_at` for optimistic locking.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `tenant_id`, `organization_id` | uuid | `organization_id` is **pinned at first creation**: the channel's `organizationId`; when that is null (the OAuth state had no active org), the connecting user's home organization from `auth`; if neither exists, the connection is created with `status = 'error'`, `last_error = 'organization_required'`, and the settings page asks the user to set a home organization, or to delete and reconnect the channel from inside an organization (a plain reconnect keeps the channel's null organization). Reconnects never change a pinned organization; the only exception is a connection still in `organization_required`, which the reconcile pins later. **Nullable**: `organization_id IS NULL` ⇔ `last_error = 'organization_required'` (kept through every transition; such a connection is never `active`). |
| `provider_key` | text | e.g. `google_calendar` |
| `channel_id` | uuid | FK id → `communication_channels` |
| `user_id` | uuid | connected user |
| `external_calendar_id` | text | |
| `status` | text | `active` \| `paused` \| `error` \| `requires_reauth` |
| `cleanup_attempts` | int default 0 | cleanup attempts for the current `lease_epoch`; capped by `OM_CALENDAR_SYNC_CLEANUP_MAX_ATTEMPTS` |
| `channel_generation` | bigint not null | the channel's `lifecycle_generation` this connection was last reconciled against; set from the channel row at creation; lease acquisition requires equality; the reconcile catches it up and revokes the lease whenever it differs |
| `consecutive_failures` | int default 0 | failed inbound runs since the last success, excluding auth and rate-limit errors; reaching `OM_CALENDAR_SYNC_ERROR_THRESHOLD` moves the connection to `error`; reset on success and on every return to `active` |
| `last_reconcile_requested_at` | timestamptz null | when the safety net last enqueued the throttled `organization_required` pinning trigger for this connection |
| `cleanup_epoch` | bigint null | `lease_epoch` value whose disconnect/delete cleanup has completed; a paused connection with `cleanup_epoch IS DISTINCT FROM lease_epoch` has unfinished cleanup, which the reconcile resumes |
| `paused_reason` | text null | `disconnect` \| `channel_deleted` while `status = 'paused'`; cleared on reactivation (channel delete is undoable, so it pauses rather than soft-deletes the row) |
| `provider_state` | jsonb null | committed cursor owned by the adapter (validated by `providerStateSchema`); no PII |
| `provider_page_state` | jsonb null | in-progress page token of the current traversal; persisted atomically with the traversal record, cleared on completion or invalidation |
| `sync_lease_until` | timestamptz null | inbound worker lease (see Inbound flow step 2) |
| `sync_lease_owner` | uuid null | random id of the lease holder; renewals, the final clear, and every `provider_state` / `provider_page_state` write are conditional on `sync_lease_owner = :me AND lease_epoch = :epoch AND status = 'active' AND deleted_at IS NULL` |
| `pending_retry_external_ids` | jsonb null | ≤ 50 |
| `notification_channel_id` | uuid null | unique; our id for the provider subscription |
| `notification_resource` | text null | provider resource / subscription id |
| `notification_token_hash` | text null | SHA-256 of the per-subscription secret |
| `notification_expires_at`, `horizon_until` | timestamptz null | |
| `share_event_details` | boolean default true | false → this user's non-customer events are busy-only to others |
| `import_interaction_type` | text default `'meeting'` | |
| `push_default_enabled`, `notify_attendees_default` | boolean default true | |
| `last_full_sync_at`, `last_incremental_sync_at` | timestamptz null | |
| `status_changed_at` | timestamptz | set whenever `status` changes; drives delete abandonment for inactive connections |
| `full_resync_requested_at` | timestamptz null | persisted intent from "Full resync"; cleared by a completed full traversal only when `≤ traversal_started_at` |
| `traversal_mode`, `traversal_run_id`, `traversal_started_at`, `traversal_horizon_from`, `traversal_horizon_to` | text / uuid / timestamptz null | the in-progress traversal; written atomically with `provider_page_state` after every page, cleared on completion or invalidation |
| `lease_epoch` | bigint default 0 | fencing token, never decreasing: incremented on every lease acquisition, on every transition out of `active` (revocation), on every move into `paused`, **and** on every generation catch-up (reconcile step 5), even when the status stays `active`; checked `FOR SHARE`, together with `status = 'active' AND deleted_at IS NULL`, by every mutation transaction |
| `settings_updated_at` | timestamptz | **optimistic-lock version** for user settings, bumped only by `connection.update` (sync writes never touch it); returned as `updatedAt` by the connections API |
| `last_error` | text null | machine code |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | |

Indexes:
- unique `(channel_id, external_calendar_id) WHERE deleted_at IS NULL`;
- unique `(notification_channel_id) WHERE notification_channel_id IS NOT NULL`;
- `(tenant_id, organization_id, user_id)`;
- `(status, notification_expires_at)`.

#### `CalendarEventLink` → `calendar_sync_event_links`

Identity and sync state per (connection, external event or instance). Holds no content.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `unlink_reason` | text null | `crm_delete` \| `provider_delete_abandoned` \| `disconnect` \| `channel_deleted` \| `provider_cancelled` \| `sweep` \| `not_organizer`; set on every unlink, cleared on re-link. Only the first two take part in undo (owning-delete key) |
| `insert_generation` | int default 0 | bumped when push is re-enabled on a link whose provider event was deleted (for example after undoing a CRM delete). The outbound **idempotency key is `<link id>:<insert_generation>`**, and the Google client `id` and the hub UID are derived from that key, so a re-insert is a new event, while retries within one generation stay idempotent |
| `tenant_id`, `organization_id` | uuid | |
| `connection_id` | uuid | ManyToOne → `CalendarConnection` |
| `provider_key` | text | denormalized for diagnostics |
| `placement` | text | `interaction` \| `external` \| `skipped` |
| `is_primary` | boolean | for `interaction` placement: the single content writer for this meeting |
| `interaction_id` | uuid null | FK id → `customers` |
| `external_event_id`, `external_series_id` | text null | |
| `ical_uid` | text null | meeting identity (plaintext; opaque identifier) |
| `instance_key` | text | `''` for single events |
| `origin` | text | `provider` \| `crm` |
| `state` | text | `linked` \| `promoting` \| `demoting` \| `deleting` \| `unlinked` \| `error` |
| `starts_at` | timestamptz null | event or instance start (scheduling metadata, not content); used by the full-sync sweep window |
| `external_identity_at` | timestamptz NOT NULL default `now()` | when this link's provider identity (`external_event_id`) was established or last re-established; set with the **database** clock (`now()`) by inbound placement, outbound insert/re-insert and attach, as is `traversal_started_at`, so app-clock skew cannot make a sweep catch a fresh insert. The full-sync sweep only considers links with `external_identity_at < traversal_started_at` |
| `merged_from_interaction_id` | uuid null | the duplicate interaction an in-progress UID merge is folding into this link's interaction; makes steps (2)–(3) resumable by the stale-state sweep; cleared at the end |
| `pending_write_was_pristine` | boolean null | whether the interaction was pristine when the guard locked it; bookkeeping advances the watermark only when true |
| `pending_write_hash` | text null | hash of the CRM fields a hub write is about to set; covers the gap between a customers command commit and its bookkeeping (Watermark rule) |
| `last_seen_run_id` | uuid null | last full-sync run that listed this event (mark-and-sweep) |
| `state_changed_at` | timestamptz | set whenever `state` changes; separates a live `promoting`/`demoting` row from a crashed one |
| `auto_promote_suppressed_at` | timestamptz null | set by undo of a manual promotion, by a user-delete detach and by the missing-interaction detach; suppresses automatic promotion until the attendee set changes or a manual promote |
| `auto_promote_suppressed_hashes` | text[] null | attendee-email hashes at suppression time; placement compares against them to detect an attendee change |
| `deletion_marker` | timestamptz null | the interaction `deletedAt` this link's delete flow is handling; makes the delete handler idempotent and rejects superseded deliveries |
| `detached_from_interaction_id` | uuid null | set when the link is detached from an interaction by demotion or by a user delete; lets the `customers.interaction.created` subscriber restore the meeting's links when that delete is undone. **Cleared** by promote finalize and by any later re-placement of the link to `interaction`. Re-placement to `external` by demotion or detach keeps it, which is what undo needs. |
| `skip_reason` | text null | `event_type` \| `before_lookback` \| `series_master` |
| `is_organizer`, `is_private` | boolean | |
| `push_enabled`, `conference_requested`, `notify_attendees` | boolean | outbound intent (primary only). Defaults: CRM-origin links take the editor widget's values (initialised from the connection's `push_default_enabled` / `notify_attendees_default`). **Provider-origin links default to `push_enabled = false`** and keep it after re-election, so CRM edits to an imported meeting never send provider updates or invitations until a user opts in through the editor widget (R6). |
| `intent_updated_at` | timestamptz | **optimistic-lock version** for push intent, bumped only by `event_link.update`; returned as `updatedAt` by the link API |
| `conference_pending` | boolean default false | set when the provider returned a pending conference; cleared on write-back or failure |
| `content_hash` | text null | hub-computed SHA-256 of the last applied normalized content (echo skip) |
| `managed_person_ids` | jsonb null | ≤ 50 |
| `attendee_email_hashes` | text[] | `hashForLookup(email, 'calendar_sync:event_link.attendee_email')`, ≤ 200, non-resource, non-self |
| `external_version`, `external_updated_at`, `synced_interaction_updated_at` | text / timestamptz | watermarks |
| `html_link` | text null | |
| `last_conflict_at`, `last_synced_at` | timestamptz null | |
| `last_error` | text null | |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | |

Indexes:
- unique `(connection_id, external_event_id) WHERE external_event_id IS NOT NULL AND deleted_at IS NULL`;
- unique `(connection_id, interaction_id, instance_key) WHERE interaction_id IS NOT NULL AND deleted_at IS NULL AND state <> 'unlinked'` (several instance links of one series may point at the same series interaction — Series attach);
- unique `(interaction_id) WHERE is_primary AND deleted_at IS NULL` (one primary per meeting);
- `(organization_id, ical_uid, instance_key) WHERE ical_uid IS NOT NULL AND deleted_at IS NULL` (shared-meeting lookup);
- **unique** `(organization_id, ical_uid, instance_key) WHERE is_primary AND placement = 'interaction' AND deleted_at IS NULL` (at most one primary per meeting; arbitrates the first-import race);
- `(detached_from_interaction_id) WHERE detached_from_interaction_id IS NOT NULL` (undo lookup);
- `(merged_from_interaction_id, state_changed_at) WHERE merged_from_interaction_id IS NOT NULL` (merge resumer);
- `(tenant_id, organization_id, interaction_id)`;
- `(connection_id, external_series_id)`;
- `(state, state_changed_at) WHERE state IN ('promoting','demoting','deleting')` (stale-state sweep);
- `(connection_id, last_seen_run_id)` (full-sync sweep);
- GIN `(attendee_email_hashes) WHERE deleted_at IS NULL AND placement <> 'skipped'`.

#### `CalendarExternalEvent` → `calendar_sync_external_events`

Content of external placements (1:1 with a link). It is a provider mirror, purged on disconnect and after retention.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `tenant_id`, `organization_id` | uuid | |
| `link_id` | uuid | OneToOne → link (same module; unique) |
| `connection_id`, `owner_user_id` | uuid | |
| `provider_key` | text | for the source glyph/label |
| `kind` | text | `meeting` \| `event` \| `focus_time` \| `out_of_office` |
| `is_private`, `is_busy`, `all_day` | boolean | |
| `starts_at`, `ends_at` | timestamptz | |
| `timezone` | text null | |
| `title`, `description`, `location`, `meeting_url`, `organizer_email` | text null | **encrypted** |
| `meeting_provider` | text null | |
| `meeting_details`, `attendees` | jsonb null | **encrypted**; attendees ≤ 200 `[{ email, name, status, isOrganizer, isResource }]` |
| `attendee_count` | int | |
| `html_link` | text null | |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | |

Indexes:
- unique `(link_id) WHERE deleted_at IS NULL`;
- `(tenant_id, organization_id, starts_at) WHERE deleted_at IS NULL`;
- `(tenant_id, organization_id, owner_user_id, starts_at)`.

`calendar_sync/encryption.ts` declares the encrypted fields; reads use `findWithDecryption`.

#### `CalendarChannelSetup` → `calendar_sync_channel_setups`

One row per calendar-provider channel whose connection does not exist yet. It throttles discovery retries.
- **Deleted** when the connection is created, and also by the reconcile when it finds the channel disconnected or deleted, so no rows linger for channels removed mid-setup. The reconcile also deletes a setup row for a channel that already has a connection (a late `/setups/retry` insert).
- **Cap reset:** "Retry setup" resets `attempts` explicitly. A **real reconnect** also resets `attempts`: the attempt start resets them when the channel's `lifecycle_generation` (Phase 1 step 3b), read `FOR SHARE` in that transaction, differs from `channel_generation_seen`, which every attempt start records. A routine access-token refresh never bumps the generation, so it never looks like a reconnect (even when the attempt that refreshed crashed), and a deterministically failing lookup does reach the cap. A stale or duplicate `channel.connected` delivery changes no channel row and never resets the cap. Any other channel lifecycle change (for example recovery from a channel `error`) also resets the cap, which is intended: the conditions the failures were counted under have changed. Every reset also clears `attempt_token`, which fences out the setup-row writes of any attempt still in flight.

| Column | Type | Notes |
|--------|------|-------|
| `channel_id` | uuid PK | FK id → `communication_channels` |
| `tenant_id`, `organization_id` | uuid / uuid null | the channel's own scope |
| `attempts` | int default 0 | incremented by the attempt start, before any provider call, so a crash still counts; decremented again by the attempt's closing transaction when it ended in `CalendarRateLimitError`, only while `attempt_token` is still this attempt's (compare-and-set), so a concurrent reset is never undercut; `CHECK (attempts >= 0)` |
| `attempt_token` | uuid null | random id written by each attempt start, cleared by every `attempts` reset; every later setup-row write of that attempt (all outcomes) is conditional on it, so a superseded attempt writes nothing, except the provider's `Retry-After` window (`GREATEST`, unconditional) |
| `user_id` | uuid | the channel's user; used by the user-scoped setup listing |
| `channel_generation_seen` | bigint null | channel `lifecycle_generation` recorded by every attempt start (before any provider call); a different value at the next attempt start means a real reconnect and resets `attempts` |
| `last_attempt_at` | timestamptz null | set by the attempt start, before the provider call, so a crashed attempt is still throttled; null for a row never attempted or just reset ("Retry setup", a reconnect), which is eligible immediately |
| `retry_after_at` | timestamptz null | earliest next attempt requested by the provider's `Retry-After` on a rate limit; enforced by `isSetupAttemptEligible` at every attempt start (all triggers) and used by the scan; never cleared by a reset |
| `last_error` | text null | machine code of the last failure |
| `created_at`, `updated_at` | timestamptz | |

#### `CalendarSyncSettings` → `calendar_sync_settings`

One row per organization. User-editable → `updated_at` for optimistic locking. A missing row means the defaults apply.

| Column | Type | Default | Validation |
|--------|------|---------|------------|
| `id` | uuid PK | | |
| `tenant_id`, `organization_id` | uuid | | unique `(tenant_id, organization_id) WHERE deleted_at IS NULL` |
| `auto_create_enabled` | boolean | `false` | |
| `auto_create_excluded_domains` | jsonb | `[]` | ≤ 50 lower-cased domains |
| `auto_create_max_attendees` | int | `15` | 1–100 |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | | |

**Writes and locking:** `calendar_sync.settings.update` upserts the row in a command transaction (`withAtomicFlush`, transactional). It reads the row `FOR UPDATE` and compares `updated_at` with the lock header (409 on mismatch). A first-insert race between two admins surfaces as a unique-index violation, which is mapped to 409. Placement reads the row once per inbound job.

### `customers` module (Part A, additive)

`CustomerInteraction` gains three nullable columns:

| Column | Type | Validator |
|--------|------|-----------|
| `meeting_url` | text null | http(s) URL ≤ 2048; rejects `javascript:` and `data:`. Join anchors use `rel="noopener noreferrer"` + `target="_blank"`. |
| `meeting_provider` | text null | `^[a-z0-9_]{1,50}$` (`google_meet`, `teams`, `zoom`, `webex`, `other`) |
| `meeting_details` | jsonb null | strict `{ conferenceId?: ≤200, entryPoints?: max 10 × { type: video\|phone\|sip\|more, uri ≤2048 (**scheme allowlist by type**: `video`/`more` → `https:` only; `phone` → `tel:` only; `sip` → `sip:`/`sips:` only; anything else, including `javascript:`, `data:` and `http:`, is rejected), label? ≤200, pin? ≤50, regionCode? ≤10 }, notes? ≤2000 }` |

- **Encryption:** `meeting_url`, `meeting_details` **and `participants`** (jsonb: attendee names and emails, which sync writes at volume) are added to the `customers:customer_interaction` map, with a `buildEncryptionMapBackfillSql` migration (empty `down()`) that also backfills existing `participants`. Every reader already loads interactions through `findWithDecryption` (list route, detail routes, conflict check, calendar), and no SQL filters on `participants`; Phase 2 verifies both with a grep plus the existing conflict/visibility tests.
- **Entry-point URI safety (validation and rendering):** the scheme allowlist on `meetingDetails.entryPoints[].uri` lives in one pure, domain-free exported helper, `isAllowedMeetingEntryPointUri(type, uri)` in `@open-mercato/shared/lib/url/meetingEntryPoint`. Customers (validator, render) and the hub (normalizer) both import it from `shared`, so the hub never imports a customers library. As a new shared export, it is flagged for maintainer confirmation (`packages/shared/AGENTS.md` → Ask First).
  - The zod validator uses it, so the API rejects a bad entry point with 400.
  - The hub's normalizer uses it to **drop** non-conforming entry points from provider data instead of failing the whole event.
  - Every UI that renders entry points uses it **again at render time**: an entry point that fails the check renders as plain text, never as an anchor. This is defence in depth against values written by any path that bypassed the validator (for example direct SQL or a future import).
  - `meetingUrl` keeps its own `http(s):` rule.
- **Index:** GIN `jsonb_path_ops` on `linked_entities`, built `CONCURRENTLY` (precedent: `sales/migrations/Migration20260916120000_sales_payment_allocation_order_idx.ts`).
- **Applicability:** `meetingUrl` is applicable to the `meeting` and `event` base kinds.

### Mapping (`NormalizedCalendarEvent` → stored record)

| Normalized field | `CustomerInteraction` (primary link only) | `CalendarExternalEvent` | Rule |
|---|---|---|---|
| `title` | `title` | `title` | |
| `description` | `body` | `description` | HTML → plain text with links kept |
| `start/end/allDay` | `scheduledAt`, `durationMinutes`, `allDay` | `starts_at`, `ends_at`, `all_day` | |
| `timezone` | `timezone` | `timezone` | |
| `location` | `location` (≤500) | `location` | |
| `conference` | `meetingUrl/Provider/Details` | same | without a conference: first known-platform URL in location/description. Entry points failing `isAllowedMeetingEntryPointUri` are dropped during normalization. |
| `attendees` | `participants[]` (`self` → connection user id); attached links add their own user | `attendees` + link hashes | resources excluded from matching |
| matched persons | `entity` + `linkedEntities` (`managedPersonIds`) | — | entity is stable once set |
| `kind` | — | `kind` | `focus_time` / `out_of_office`; `default` → `meeting` / `event` |
| `isPrivate` / `isBusy` | — | `is_private` / `is_busy` | |
| `status: cancelled` | **only** when the cancelled copy is the **organizer's** (`is_organizer`), or every linked copy of the meeting is cancelled → `customers.interactions.cancel`. Otherwise (an attendee deleted or declined their own copy) → unlink that link, remove its user from `participants`, hand over the primary if it was primary. | soft-delete | |
| ended before import | `status: 'done'`, `occurredAt = start` | — | creation only |
| `recurrence` | CRM-owned: `recurrenceRule`; provider-owned: per instance | per instance | |
| — | `interactionType` = connection setting; `source = 'calendar_sync:<providerKey>'`; `visibility = 'team'`; owner/author = primary connection user | `owner_user_id` = connection user | |

**Auto-created Person.** Created with `customers.people.create`:
- `displayName` = attendee name ?? email local part;
- first/last name split on the last space when the name has two or more tokens;
- `primaryEmail`;
- `source: 'calendar_sync:<providerKey>'`.

## API Contracts

All routes:
- export `openApi` and validate with zod;
- scope by tenant + org (+ `user_id = auth.sub` for user-owned rows);
- custom authenticated writes wire `runMutationGuards`.

### Hub — `calendar_sync` (Part B)

| Route | Auth | Contract |
|-------|------|----------|
| `GET /api/calendar_sync/connections` | `calendar_sync.connect` | `makeCrudRoute` list of the caller's connections: `{ id, providerKey, providerLabelKey, externalCalendarId, status, shareEventDetails, importInteractionType, pushDefaultEnabled, notifyAttendeesDefault, lastFullSyncAt, lastIncrementalSyncAt, lastError, notificationsActive, updatedAt }`; `pageSize ≤ 100` |
| `PUT /api/calendar_sync/connections` | same | Settings + lock on `settings_updated_at` (the route configures the shared optimistic-lock reader with `updatedAtField: 'settingsUpdatedAt'`; the link route uses `'intentUpdatedAt'`) → `connection.update` (sync activity never causes 409). 400 unknown activity type; 404 not owned; 409 stale. |
| `GET /api/calendar_sync/setups` | `calendar_sync.connect` | Custom route, **user-scoped, not organization-scoped**: `tenant_id = auth.tenant AND user_id = auth.sub`. It returns what the org-scoped `makeCrudRoute` list cannot show:
- pending setups (`calendar_sync_channel_setups` rows: `{ channelId, providerKey, attempts, lastAttemptAt, lastError, retryAfterAt, state: 'setting_up' \| 'setup_failed' \| 'setup_blocked_reauth' }`). The state is derived from the caller-owned channel's **current** row first, then the setup row. Precedence: channel `status = 'requires_reauth'` → `setup_blocked_reauth` (the fix is a reconnect), whatever the setup row says, so a channel committed as `requires_reauth` whose fenced setup write was skipped or interrupted still shows "Reconnect"; then `last_error = 'requires_reauth'` with the channel **not** `connected` → `setup_blocked_reauth`; then cap reached → `setup_failed`; else `setting_up`. A `last_error = 'requires_reauth'` on a channel that is `connected` again (reconnected, reconcile not run yet) is shown as `setting_up`, and so is a capped row whose `channel_generation_seen` differs from the channel's `lifecycle_generation` (the reconnect resets the cap at the next attempt start); the generation check comes before the cap rule. Each setup row is read together with its channel row (one batched, tenant- and user-scoped read through the hub's channel read path);
- the caller's connections with `organization_id IS NULL` (`organization_required`), with their guidance code.

(`state` values and their precedence are defined above.)

Deliberately **cross-organization for the caller's own rows**. Unlike `/me/channels`, which filters by the active organization, it must show the user's pending setups and org-less connections whichever organization is selected; every row belongs to `auth.sub`, so nothing of another user is exposed.

The settings page merges it with `GET /connections`. Keyset paging: `?cursor=<opaque>&limit=` (`limit ≤ 100`), ordered by `(created_at, channel_id)`. |
| `POST /api/calendar_sync/setups/retry` | `calendar_sync.connect` | `{ channelId }`. Mutation guards apply (operation `update`); user-scoped like the GET. Guard `resourceKind: 'calendar_sync.channel_setup'`, resource id = `channelId`.
- For a pending setup it reads the channel row `FOR SHARE` first (for the 409 check), then locks the setup row (if the lock returns no row because a concurrent fenced commit deleted it, the request falls through to the branches below: `200 { queued: false }` when a connection now exists, otherwise the guarded insert) and resets `attempts = 0`, `last_attempt_at = NULL`, `attempt_token = NULL`, `last_error = NULL` (keeping `retry_after_at`), and enqueues the lifecycle reconcile. While a `Retry-After` window is open, the response is still `202 { queued: true, retryAfterAt }`, and the attempt runs when the window ends.
- For an `organization_required` connection it enqueues the reconcile (re-running pinning).
- A connected calendar channel with **neither** a setup row nor a connection yet (the reconcile has not run) → inserts the setup row **only while the channel still has no connection** (`INSERT … SELECT … WHERE NOT EXISTS (connection for channel_id) ON CONFLICT (channel_id) DO NOTHING`, since the reconcile may create the row or the connection concurrently) and enqueues the reconcile, `202 { queued: true }`. As a backstop, the reconcile deletes any setup row for a channel that already has a connection.
- Nothing to retry (the channel already has a connection that is not `organization_required`) → `200 { queued: false }`.
- For `setup_blocked_reauth` the settings page offers **"Reconnect"** (the OAuth flow), not "Retry setup": the channel is `requires_reauth`, so retry would return 409 `channel_not_connected`.
- Rate limited to 1 call per channel per minute (429), since each call can lead to a provider call.
- 404 when the channel is not the caller's.
- 409 `channel_not_connected` applies **only** to the pending-setup and no-setup-row branches, which need a connected channel for discovery.
- The `organization_required` branch **always** queues: pinning is useful whatever the channel state, and the resulting status still comes from the mapping, so the connection stays `paused` while its channel is disconnected.
- Otherwise `202 { queued: true }`. |
| `POST /api/calendar_sync/connections/run` | same | `{ id, mode }`. `mode: 'full'` first **persists** `full_resync_requested_at` on the connection, then enqueues the coalesced inbound job, so a waiting incremental job cannot swallow the full-resync request (the worker reads the mode from state). On an `error` connection with a retryable error, it first clears the error, in one transaction that re-reads the channel `FOR SHARE`: `UPDATE … SET status = 'active', last_error = NULL WHERE status = 'error' AND last_error NOT IN ('organization_required','channel_error')`, and only if the channel is `connected`. Response `202 { queued: true }`. 409 `requires_reauth`, `paused` (reconnect first), `organization_required`, `channel_error` (the channel itself is failing; it recovers with the channel) or `channel_not_connected` (a retryable error, but the channel row is not `connected`). Full resync ≤ 1 per 10 min. |
| `GET/PUT /api/calendar_sync/settings` | `calendar_sync.configure` | The caller's organization row `{ autoCreateEnabled, autoCreateExcludedDomains, autoCreateMaxAttendees, updatedAt }`, with defaults when absent; PUT + lock → `settings.update`. Turning auto-create on is not retroactive; the response hints to run a full resync. |
| `GET /api/calendar_sync/events?from&to[&ownerUserId][&cursor][&limit≤100]` | `calendar_sync.view` | Keyset `(starts_at, id)`; range `starts_at < :to AND ends_at > :from`. Items = `CalendarExternalItem` + `updatedAt`. **Redaction:** owner ≠ viewer and (`is_private` or the owner's `share_event_details = false`) → busy-only shape; focus/OOO for others → kind + times only. |
| `GET /api/calendar_sync/events/[id]` | same | Details (owner, or shared non-private) incl. `attendees: [{ email, name, status, personId \| null, canCreatePerson }]` (one batched matcher call). Redacted → `{ redacted: true }`. |
| `POST /api/calendar_sync/events/[id]/promote` | `calendar_sync.view` + `customers.interactions.manage` | `{ entityId?: uuid, confirmSharePrivate?: boolean }`. **Authorization follows the redaction rule:** a caller who would receive the redacted shape for this event (any non-owner of a private event, or of an event whose owner has `share_event_details = false`) gets 403 `details_hidden`. **Focus-time and out-of-office events cannot be promoted by anyone** (409 `kind_not_promotable`): they are availability, not meetings. Other errors: 409 `no_person`, 409 `confirmation_required` (owner promoting their own private event without `confirmSharePrivate`); a foreign `entityId` → 404 from the customers command. Idempotent. The details panel hides the actions whenever the API would refuse them. |
| `GET/PUT /api/calendar_sync/interactions/[interactionId]/link` | GET `calendar_sync.connect` + `customers.interactions.view`; PUT + `customers.interactions.manage` | **Record-level authorization (GET and PUT):** the hub resolves the customers DI service `customerInteractionAccess` (`tryResolve`) and calls `describeForUser({ interactionId, userId, tenantId, organizationId })`. That applies the same visibility rules as the interactions read path (`customers/lib/visibilityFilter.ts`, including owner-only private email rows) and returns `{ visible, baseKind }`. Not visible → 404. A base kind other than `meeting`/`event` → 409 `kind_not_syncable` (email/call/note/task interactions are never pushed). The outbound worker re-checks the base kind before every provider write (defense in depth). `{ connections: [{ id, providerKey, providerLabelKey, conference: {key,labelKey}\|null }], link: null \| { id, connectionId, origin, isPrimary, isOrganizer, pushEnabled, conferenceRequested, conferencePending, notifyAttendees, htmlLink, lastError, updatedAt /* = intent_updated_at */ }, defaults }` / PUT `{ connectionId, pushEnabled, conferenceRequested?, notifyAttendees? }` + lock on `intent_updated_at` (sync ticks never bump it). The interaction itself is already saved when this runs; a 409 is surfaced via `surfaceRecordConflict` and leaves the interaction edit intact, with only the push intent unsaved. Errors: 409 `not_organizer`, `not_primary`, `not_connected`, `conference_unsupported`. |
| `POST /api/calendar_sync/webhook/[provider]` | `requireAuth: false`, rate limited | **Bounded body first:** before any adapter code runs, the route reads the body with `readBoundedRequestBody(req)` from `@open-mercato/shared/lib/webhooks` (shared 1 MiB default, `OM_WEBHOOK_MAX_BODY_BYTES` override). A declared `Content-Length` over the limit, or a streamed/chunked body that overflows, raises `WebhookBodyTooLargeError` → **413**, with no adapter call and no lookup. `parseNotification` only ever receives the bounded string. Unknown provider or no `parseNotification` → 404. `validation` → the adapter's status and body, served by the hub **always** as `text/plain; charset=utf-8` with `X-Content-Type-Options: nosniff` (the adapter cannot choose the content type). `changes` → for each item, look up the connection by `notification_channel_id` or `notification_resource` (per `lookup.by`) and do a constant-time `sha256(token)` compare. Matching items enqueue the coalesced inbound job for their connection. Unknown or bad-token items are dropped and counted in metrics/logs. The response is a **uniform `202`** regardless of item validity, so callers cannot probe which channel ids exist. `sync`/`ignore` → 200. Scope comes only from the stored connection. |

**Response enricher** `calendar_sync.interaction-link` on `customers.interaction`: `_calendarSync: { linked, providerKey, htmlLink, origin, isOrganizer, conferencePending, sharedWith: number }`. One batched query, gated on `calendar_sync.connect`, `cacheableOnListHit: false`.

### Customers (Part A)

**Item-source extension point.** Hosts in `customers/extension-points.ts`:
- `calendarItemSources`: spot `calendar:customers.item-sources`, headless widget, data contract `customers.calendar.item-sources.v1`;
- `calendarExternalItemDetails`: component `section:customers.calendar-peek.external-details`, props `customers.calendar.external-item-details.v1`.

Exported types:

```ts
type CalendarExternalItem = {
  key: string; sourceId: string; id: string
  startsAt: string; endsAt: string; allDay: boolean; timezone?: string | null
  ownerUserId: string | null
  kind: 'meeting' | 'event' | 'focus_time' | 'out_of_office' | 'busy'
  busy: boolean; redacted: boolean
  isPrivate?: boolean                      // only sent to the owner
  title?: string | null; location?: string | null
  meetingUrl?: string | null; meetingProvider?: string | null
  attendeeCount?: number; externalUrl?: string | null
  sourceLabelKey?: string | null           // e.g. provider label for the glyph tooltip
}
type CalendarItemSource = {
  id: string; labelKey: string
  fetchItems(range: { from: Date; to: Date }, ctx: { signal: AbortSignal }): Promise<{ items: CalendarExternalItem[]; truncated: boolean }>
}
```

Calendar behavior:
- sources are fetched in parallel with interactions (500-item cap per source; a failing source shows a non-blocking `Alert`);
- external items are read-only in all views;
- tabs: `meeting` → Meetings, `event` → Events, others → All;
- the owner filter, client search and conflicts (busy items by owner) apply;
- the peek shows Join / "Open in {provider}" plus the details component handle;
- with no sources, the calendar is unchanged.

**Other customers changes:**
- `meetingUrl` / `meetingProvider` / `meetingDetails` on the interactions API;
- `includeLinked=true` (opt-in; `entity_id = ? OR linked_entities @> ?::jsonb`, with the second parameter bound as `JSON.stringify([{ type: 'person', id }])`; never string-interpolated);
- DI `customerPersonEmailMatcher` (`matchPeopleByEmails`, `getPrimaryEmails`);
- DI `customerInteractionAccess.describeForUser({ interactionId, userId, tenantId, organizationId }) → { visible: boolean; baseKind: string | null }`, plus `toStoredSyncedFields(rowAndChanges) → StoredSyncedFields` (the complete user-editable field set listed in the Watermark rule, including custom-field values), which applies the same validator normalization the interaction commands apply (title trim, `canonicalCalendarTimezone`, participant shape), so hub hashes match persisted values. It is pure; no database access. It reuses `lib/visibilityFilter.ts` and the event-type resolver, so other modules never re-implement interaction visibility;
- participant "Create person" in `CalendarEventEditor` (`CreatePersonDialog`, adds a `person` linked entity on save);
- `EmailCardActions.tsx` / `PersonEmailThreadsTab.tsx` filter `channelType === 'email'`.

### Hub seams — `communication_channels`

- `ChannelAdapter.oauthClientFallbackProviderKeys?: readonly string[]` in `resolveOAuthClientCredentials` (own row first);
- the mailbox guard compares only channels of the same `channelType`;
- `communication_channels.channel.connected` is emitted after the row is persisted by **both** connect paths that call `createConnectedChannelRow`: the OAuth callback (`api/get/oauth/[provider]/callback/route.ts`) and the credential connect command (`commands/connect-credential-channel.ts`). Credential-based providers (CalDAV app passwords) therefore get a `CalendarConnection` too;
- `set-primary-channel` rejects cross-type promotion.

These are needed because calendar channels would otherwise be offered as email senders and could be promoted to primary mailbox. The two customers composers filter only on `status === 'connected'`. Discord channels (`channelType: 'discord'`) are already user-scoped and exposed the same way today, so the email-only filter also fixes that existing exposure.

### Google provider — `@open-mercato/channel-google-calendar` (Part C)

- **`ChannelAdapter`:**
  - `providerKey 'google_calendar'`, `channelType 'calendar'`;
  - OAuth via `@open-mercato/google-auth`, `oauthClientFallbackProviderKeys: ['gmail']`;
  - fixed scopes `calendar.events`, `userinfo.email`, `userinfo.profile`. `resolvePrimaryCalendar` uses `events.list?calendarId=primary&maxResults=1` (time zone) plus the userinfo email (id), so no calendar-read scope is needed. TC-GCAL-001 asserts the exact scope list;
  - `realtimePush: true`;
  - message methods throw `[internal]`.
- **`CalendarProviderAdapter`:**
  - `listChanges`: `events.list` with `syncToken` / full, `singleEvents=false`, `showDeleted=true`, 250 per page, `410` → `fullResyncRequired`;
  - `listInstances`: `events.instances`;
  - `insertEvent`: client `id` = base32hex-safe hex digest of the idempotency key `<link id>:<insert_generation>`, `conferenceDataVersion=1`, `createRequest` `hangoutsMeet`, `extendedProperties.private.omInteractionId`;
  - `patchEvent`: `If-Match` → `CalendarVersionConflictError` on `412`;
  - notifications: `events.watch` / `channels.stop`; `parseNotification` maps `X-Goog-Channel-ID/Token/Resource-State`;
  - **error mapping:**
    - `401` → `CalendarAuthError`;
    - **`429`, and `403` with reason `rateLimitExceeded` or `userRateLimitExceeded` → `CalendarRateLimitError`** (backoff; never counts toward the sticky `error` threshold or the discovery attempt cap). This is checked before the other `403` rules, mirroring Gmail's `isRateLimit403` in `packages/channel-gmail/src/modules/channel_gmail/lib/gmail-client.ts`.
    - **`403` with reason `insufficientPermissions` (in `error.errors[].reason`) or `ACCESS_TOKEN_SCOPE_INSUFFICIENT` (in `error.details[]`, `ErrorInfo.reason`) — the user unticked the Calendar permission in Google's granular consent screen → `CalendarAuthError`**, because only a reconnect that grants the scope fixes it;
    - other `403`s (e.g. `accessNotConfigured` / `SERVICE_DISABLED`, the Calendar API disabled in the Google Cloud project) → a non-auth provider error.
  - normalize: `eventType` → kind, `visibility ∈ {private, confidential}` → `isPrivate`, `transparency` → `isBusy`, `conferenceData` → conference (`hangoutsMeet` → `google_meet`, add-ons by name).
- **No API routes or tables of its own.** It contributes `integration.ts` (optional `clientId` / `clientSecret`; empty → Gmail's), a connect widget and i18n.

## Internationalization (i18n)

- **`calendar_sync.*`** (all platform locales: `en`, `pl`, `es`, `de`, `ko`; same for `channel_google_calendar.*` and the new `customers.calendar.*` keys):
  - `connections` (user settings page, statuses, sync actions, share-details help)
  - `settings` (org auto-create, excluded domains, warning, resync hint)
  - `external` (Busy, Focus time, Out of office, Open in {provider}, Create person, Link to existing customer, Add to CRM, private confirmation, promoted flash)
  - `editor` (Add to {provider}, Add {conference} link, Notify attendees, not organizer, not primary, conference pending/failed)
  - `errors`
- **`channel_google_calendar.*`:** integration, connect + consent explainer, provider label "Google Calendar", conference label "Google Meet".
- **`customers.calendar.*`:** meeting field, Join, external source failure notice, participant Create person.
- Machine codes map to i18n keys; internal throws are prefixed `[internal]`.

## UI/UX

1. **Connect** (per provider, `profile:communication-channels:connect`): a "Google Calendar" item (lucide `CalendarDays`) with a consent explainer dialog (`Cmd/Ctrl+Enter` / `Escape`) → `useConnectChannel({ providerKey: 'google_calendar' })`.
2. **User settings page** `/backend/profile/calendar-sync` (hub, `calendar_sync.connect`):
   - one section per connection with the provider label, a `StatusBadge`, last-sync times, and "Sync now" / "Full resync" (`useGuardedMutation`, `useConfirmDialog`);
   - a `CrudForm` for share details, activity type, push/notify defaults;
   - `Alert` for `privacy_changed_kept`;
   - `EmptyState` with connect hints when nothing is connected.
3. **Org settings page** `/backend/calendar-sync/settings` (hub, settings sidebar, `calendar_sync.configure`):
   - an auto-create `Switch`, an excluded-domains `TagInput` (warning `Alert` when empty and enabled), and the attendee limit;
   - a post-save flash about full resync.
4. **Calendar rendering of external items** (customers, Part A):
   - Busy: neutral hatch + `Lock` + "Busy";
   - focus: `Target`;
   - OOO: `Plane`;
   - shared: neutral tint + provider glyph (`aria-label` from `sourceLabelKey`);
   - free items: dashed border, no conflicts;
   - the owner's private events: details + `Lock`;
   - DS tokens only.
5. **External details panel** (hub component for `section:customers.calendar-peek.external-details`):
   - attendees with match `StatusBadge`;
   - "Create person" (`customers.people.manage`; embedded `CrudForm` → `POST /api/customers/people` → promote; hint `Alert` pointing to Link to existing customer);
   - "Link to existing customer" (combobox over `/api/customers/people` + `/api/customers/companies`, `pageSize ≤ 20`, debounced → `promote { entityId }`; also for events with no attendees);
   - "Add to CRM" for the owner's private events (confirmation dialog);
   - redacted items get no panel.
6. **Editor widget** (hub, `crud-form:customers.customer_interaction:fields`):
   - a `CollapsibleSection` "Calendar sync", rendered when the user has ≥1 connection;
   - a connection `Select` when there is more than one;
   - `Switch` "Add to {provider}";
   - `Switch` "Add {conference} link", only when the adapter has a conference capability and the Meeting link field is empty;
   - `Switch` "Notify attendees";
   - `Alert`s for not organizer / not primary ("Synced from {colleague}'s calendar; changes stay in the CRM");
   - `Spinner` while a conference is pending;
   - persists via `onAfterSave` → `PUT …/link` (`useGuardedMutation`, lock header, `surfaceRecordConflict`).
7. **Meeting link field, Join and participant "Create person"** (customers, Part A), as described in API Contracts. Touched lines follow the Boy Scout rule.

## Frontend Architecture Contract

### Server/Client Boundary Map

| Route / surface | Server root | Client islands | Data owner |
|---|---|---|---|
| `/backend/profile/calendar-sync` | `page.tsx` (metadata, `resolveTranslations`) | `CalendarConnectionsSettings` | hub API |
| `/backend/calendar-sync/settings` | `page.tsx` | `CalendarSyncOrgSettings` | hub API |
| `/backend/calendar` (existing) | unchanged | `CalendarScreen`; `fetchExternalCalendarItems` helper (no new root) | interactions API + sources |
| Item source | — (headless) | `widgets/injection/calendar-source/widget.ts` | hub events API |
| Details panel / editor widget / connect widget | — (injected) | one client file each | hub API / hub OAuth |

### `"use client"` Ledger

| File | Reason | Heavy deps |
|---|---|---|
| `calendar_sync/components/CalendarConnectionsSettings.tsx` | forms, guarded mutations | none |
| `calendar_sync/components/CalendarSyncOrgSettings.tsx` | form | none |
| `calendar_sync/components/ExternalEventDetails.tsx` | attendee actions, dialogs | none |
| `calendar_sync/widgets/injection/editor-sync/widget.client.tsx` | CrudForm field widget | none |
| `channel_google_calendar/widgets/injection/connect/widget.client.tsx` | OAuth trigger | none |

### Budgets & Evidence

- 0 new unallowlisted page-root `"use client"` files and no new browser dependencies.
- Touched files ≤ 300 LOC.
- Evidence: `yarn check:client-boundaries`, plus a `yarn build:app` note (calendar route delta ≤ 5 kB gz).
- Hydration: TC-CALSYNC-004, TC-CALSYNC-009.

### Provider / Bootstrap Scope

None touched.

## Configuration

| Env | Default | Owner | Purpose |
|-----|---------|-------|---------|
| `OM_CALENDAR_SYNC_WEBHOOK_BASE_URL` | unset | hub | public HTTPS origin for change notifications; unset → polling only |
| `OM_CALENDAR_SYNC_POLL_INTERVAL` | `15m` (`5m` without notifications) | hub | poll tick |
| `OM_CALENDAR_SYNC_IMPORT_LOOKBACK_DAYS` | `90` | hub | full-sync lookback + horizon start |
| `OM_CALENDAR_SYNC_HORIZON_DAYS` | `180` | hub | instance horizon |
| `OM_CALENDAR_SYNC_EXTERNAL_RETENTION_DAYS` | `365` | hub | external-event retention |
| `OM_CALENDAR_SYNC_PAGE_BUDGET` | `8` | hub | pages per job run (a follow-up job continues the listing) |
| `OM_CALENDAR_SYNC_DELETE_ABANDON_DAYS` | `7` | hub | a `deleting` link on a connection inactive this long is abandoned (`provider_delete_abandoned`, reported) |
| `OM_CALENDAR_SYNC_DISCOVERY_MAX_ATTEMPTS` | `10` | hub | cap on calendar discovery attempts per channel (exponential backoff from 5 min) before "Setup failed" |
| `OM_CALENDAR_SYNC_CLEANUP_MAX_ATTEMPTS` | `10` | hub | cap on disconnect/delete cleanup attempts per lease epoch before `cleanup_failed` is reported |
| `OM_CALENDAR_SYNC_ERROR_THRESHOLD` | `5` | hub | consecutive failed inbound runs (auth and rate-limit errors excluded) before a connection moves to the sticky `error` |
| `OM_CALENDAR_SYNC_ERROR_RETRY_MINUTES` | `60` | hub | `poll-tick` moves retryable `error` connections back to `active` (conditional update) after this long and enqueues an inbound run; also the throttle window for the `organization_required` pinning trigger (`last_reconcile_requested_at`) |
| `OM_CALENDAR_SYNC_STALE_STATE_MINUTES` | `15` | hub | age after which `promoting`/`demoting` links are swept and resumed |
| `OM_GOOGLE_CALENDAR_REQUEST_TIMEOUT_MS` | `30000` | Google | per request |
| `OM_GOOGLE_CALENDAR_API_BASE_URL` | Google | Google | test-only override, ignored in production |

**ACL** (sync with `yarn mercato auth sync-role-acls`):

| Feature | Granted to | Allows |
|---|---|---|
| `calendar_sync.view` | admin + employee | external items |
| `calendar_sync.connect` | admin + employee | own connections |
| `calendar_sync.configure` | admin | org settings |
| `channel_google_calendar.view`, `.configure` | admin | integration credentials, like Gmail |

**Schedules:** `poll-tick`, `notifications-renew` (`0 3 * * *`) and `horizon-roll` (`0 2 * * *`, plus retention) are registered by the hub in `setup.ts` behind `hasRegistration('schedulerService')`.

**Google Cloud prerequisites (docs):**
- enable the Calendar API;
- add the consent-screen scope;
- add the redirect URI `<origin>/api/communication_channels/oauth/google_calendar/callback`.

## Migration & Compatibility

- **DB:** five new hub tables (`calendar_sync_connections`, `calendar_sync_event_links`, `calendar_sync_external_events`, `calendar_sync_channel_setups`, `calendar_sync_settings`); customers additive columns + GIN index + encryption backfill; one additive `communication_channels.lifecycle_generation` column (default 0, no backfill). No provider tables.
- **New contract surfaces (STABLE once released):**
  - `calendar-provider.v1` types and `registerCalendarProviderAdapter` (import path `@open-mercato/core/modules/calendar_sync/lib/provider`);
  - `customers.calendar.item-sources.v1`;
  - spot `calendar:customers.item-sources`, component `section:customers.calendar-peek.external-details`;
  - events `calendar_sync.*`, `communication_channels.channel.connected`;
  - DI `customerPersonEmailMatcher`, `customerInteractionAccess`, `calendarProviderRegistry`;
  - ACL `calendar_sync.*`.
  - CLI `yarn mercato calendar_sync retry-cleanup --tenant <tenantId> --connection <id>` (operator retry of a capped cleanup; tenant-scoped lookup; acts only on a `paused` connection with unfinished cleanup; resets `cleanup_attempts`, clears `last_error = 'cleanup_failed'` and enqueues the reconcile).
  - The provider contract evolves additively; breaking changes need `calendar-provider.v2` with a bridge (`BACKWARD_COMPATIBILITY.md`).
- **Existing surfaces:**
  - Gmail `lib/oauth` exports re-exported;
  - `ChannelAdapter` gains an optional field;
  - narrow behavior changes: type-scoped mailbox guard, cross-type primary rejection, email-only composers, calendar types rejected by the messaging webhook;
  - **person timelines** (person detail activities) start passing `includeLinked=true`, so interactions that link the person through `linkedEntities` (including ones linked manually before this change) begin to appear on that person's timeline. The API default is unchanged.
- **Rollback:** disable the provider module, and connections go idle. Disable `calendar_sync`, and the calendar renders interactions only. Interactions and people created by sync remain as normal CRM records.

## Implementation Plan

Each phase is its own PR and leaves the app working.

| Part | Phases |
|------|--------|
| **A** (customers) | 2, plus its rows of Phase 8 |
| **B** (hub) | 1, 3–6, 9, plus its rows of Phase 8 |
| **C** (Google) | 7, plus its rows of Phase 8 |

Phase 8 is cross-cutting: integration tests and docs for whatever has landed. Each Part's tests ship with that Part's last phase if the Parts are split into separate specs.

Phases 1 and 2 can run in parallel. Phases 3–6 need Phase 1 (`channel.connected`) and are developed against an in-repo **fake adapter** (test-only, `calendar_sync/__tests__/fakeProvider.ts`). Phase 7 plugs Google in.

### Phase 1 — `communication_channels` prerequisites (B)

1. `resolveOAuthClientCredentials` fallback keys, plus its callers (`lib/credential-refresh.ts`, the OAuth initiate and callback routes).
2. The type-scoped mailbox guard (`lib/connect-channel.ts`).
3. `channel.connected` from the OAuth callback, `commands/connect-credential-channel.ts`, **and the `undo()` handlers of `commands/disconnect-channel.ts`, `commands/delete-channel.ts` and `commands/admin-delete-channel.ts`** (a restored channel must reactivate its calendar connection). `subscribers/user-deleted-cascade.ts` emits `channel.disconnected` for each channel it disconnects, which it does silently today.
3a. Exported helper `markChannelRequiresReauth(em, { channelId, tenantId, organizationId, reason })`. On the caller's transaction-bound EntityManager it performs a **conditional** update: `SET status = 'requires_reauth', last_error = :reason, lifecycle_generation = lifecycle_generation + 1 WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL AND is_active AND status IN ('connected','error')`, the same precondition style as the Gmail poller's `writePollFailure`. It returns `{ matched: boolean, emitAfterCommit }`, and `communication_channels.channel.requires_reauth` is emitted only when `matched`. A user's `disconnected` or deleted channel can therefore never be overwritten into `requires_reauth`. It factors out the write the Gmail poller already does inline (`workers/poll-channel.ts`), which may adopt it.
3b. **Channel lifecycle generation:** new column `communication_channels.lifecycle_generation bigint NOT NULL DEFAULT 0` (additive migration; no backfill needed). It is incremented in the same write by **every** lifecycle write that **actually changes** `status`, `is_active`, `deleted_at` or `credentials_ref`, plus every connect/reconnect (which replaces credentials even when those fields look unchanged). The write sites today are:
   - `lib/connect-channel.ts`: `applyConnectionState` (connect and every reconnect, including heal-on-reconnect; always bumps) and the superseded-duplicate demotion to `disconnected`;
   - `commands/connect-credential-channel.ts`;
   - `commands/disconnect-channel.ts`, `commands/delete-channel.ts`, `commands/admin-delete-channel.ts` and their `undo()` handlers;
   - `subscribers/user-deleted-cascade.ts`;
   - `markChannelRequiresReauth` (only when it matched);
   - `workers/poll-channel.ts`: the `requires_reauth` and `error` failure writes, and `commitPollProgress`, which re-assigns `status = 'connected'` on every successful poll, so it bumps **only** when the previous status differed;
   - `commands/deliver-outbound-message.ts`: the recovery to `connected` and the `requires_reauth` mark;
   - `lib/ensure-system-email-channel.ts` (reactivating the system email channel).
   The helper `bumpChannelLifecycleGeneration(channel, nextFields, { force })` applies the fields and increments the generation when one of them changes, or unconditionally with `force: true` (SQL `lifecycle_generation = lifecycle_generation + 1`). `applyConnectionState` always passes `force: true`, because a reconnect of an already-`connected` channel can reuse the credentials row and change none of the four fields, yet it is a real reconnect that must reset a capped setup and invalidate older leases. A unit test scans the module for assignments to those four fields on `CommunicationChannel` and fails on any site that does not go through the helper, with one documented exemption: the test-only seed route `api/post/test-seed/route.ts`. It also flags `nativeUpdate` / raw SQL that sets any of the four columns on `communication_channels` unless it increments `lifecycle_generation` in the same statement (as `markChannelRequiresReauth` does). Row creation (`em.create`, e.g. `setup.ts`, `ensure-system-email-channel.ts`, `connect-channel.ts`) is out of scope: a new row starts at 0 and no connection references it yet. The scan covers the core `communication_channels` module; provider packages that write channel state for their own non-calendar channels (today `packages/channel-discord/.../lib/channel-state-store.ts`) are listed as known exceptions, since calendar connections never reference those channels. A routine token refresh (`lib/credential-refresh.ts`, which writes no such field) and non-lifecycle writes (`set-primary-channel`, visibility, `lastPolledAt`) never bump it. Calendar adapters are push-only and send no messages, so the poller and outbound delivery never touch calendar channels; their bumps matter only for the completeness test.
4. Cross-type primary rejection.
4a. **Issuing-client refresh:** the OAuth callback stores `oauthClientId` (the client that issued the tokens) in the user credentials. `oauthClientId` is a declared optional field of `googleUserCredentialsSchema` (and so of the `gmailUserCredentialsSchema` alias, which `.strip()`s unknown keys). Every refresh writes it back, so it survives re-parsing. `refreshCredentialsIfNeeded` refreshes with the client config whose `clientId` matches it, searching the provider's own row, then its fallback rows. An admin later configuring a dedicated calendar client therefore does not break refresh for tokens issued by Gmail's client; users reconnect at their own pace.
4b. The generic messaging webhook `POST /api/communication_channels/webhook/[provider]` returns 404 for adapters with `channelType: 'calendar'`, instead of calling a `verifyWebhook` that throws.
5. Unit tests for all of the above.

*Exit:* Gmail/IMAP tests unchanged and green.

### Phase 2 — Customers seams (A)

6. Meeting columns/validators/encryption/backfill/applicability/API; `isAllowedMeetingEntryPointUri` (validator + render-time check); `ctx.beforeTransactionalWrite` support added to `customers.interactions.cancel` and `customers.interactions.delete` (create/update already invoke it), so the hub's lease fence runs inside every customers write transaction while side effects stay post-commit.
7. Meeting link field; Join prefers `meetingUrl`.
8. `customerPersonEmailMatcher`; `customerInteractionAccess` (visibility + base kind); `includeLinked` + GIN (bound `?::jsonb` parameter); person activities use `includeLinked=true`.
9. Item-source + details hosts and types; `fetchExternalCalendarItems`; external rendering; conflicts; peek.
10. Participant "Create person"; email-only composer filters.

*Exit:* the fake source renders, conflicts, and shows redacted items as Busy; with no source the calendar is unchanged.

### Phase 3 — Hub foundation (B)

11. Module scaffold (`acl`, `setup`, `di`, `events`, `encryption`), provider contract + `registerCalendarProviderAdapter` (`registerChannelAdapter` semantics) + typed errors + `buildInstanceKey`. Ship the exported **conformance suite** `runCalendarProviderConformanceSuite` (`calendar_sync/lib/provider/conformance.ts`, test-time only). It checks idempotent insert per `idempotencyKey`, `requestConference` honoured when `conference ≠ null`, `CalendarVersionConflictError` on a stale `expectedVersion`, `buildInstanceKey` usage, `fullResyncRequired` semantics, `parseNotification` shapes and `predictIcalUid` accuracy. Add the fake adapter, which passes the suite.
12. Entities + migrations (all indexes in Data Models, including the primary-per-meeting unique index).
13. Lifecycle handling. Subscribers on `channel.connected`, `channel.disconnected` and `channel.deleted` only enqueue the **lifecycle reconcile job** (Inbound flow step 2), restricted to channels whose adapter resolves to a registered calendar provider. The job reads the current channel state. When the channel is connected and **no connection exists**, it creates one via `resolvePrimaryCalendar` (discovery outside the transaction, gated by the attempt start's eligibility check, result persisted only through the discovery commit fence: channel connected, unchanged generation, and the attempt still owning its token). An **existing** connection is reactivated **without** discovery, reusing its stored `external_calendar_id`:
   - **new** → create;
   - **existing** `paused` / `requires_reauth` connection on a **connected** channel (a reconnect, or the Undo of a disconnect or channel delete, reuses the same channel id and the same, never soft-deleted connection row) → reactivate (`status = 'active'`, clear `last_error` and `paused_reason`). A connection in a **sync** `error` (any `last_error` other than `channel_error` and `organization_required`) is not reactivated by the lifecycle job; it waits for an explicit or automatic retry (Inbound flow step 2). A `channel_error` connection **is** reactivated once its channel is `connected` again. An `organization_required` connection is handled by the pinning rule. On reactivation the job also sets `full_resync_requested_at`, enqueues inbound, and **re-enqueue outbound for its `deleting` links**, so a provider delete lost while the connection needed reauth is completed. Its `provider_delete_abandoned` rows are re-evaluated as described under Re-enabling push.
   - The full resync reuses the connection's existing, unlinked link rows by `(connection_id, external_event_id)`, re-attaches them to shared meetings, and re-elects the primary where this connection outranks the current one.
   - When the job derives a paused state, it first **revokes the lease** in the same `UPDATE` that pauses the connection (Inbound flow step 2, revocation on leaving `active`). Only after that commits does the job unlink its links, hand over primaries, and purge its external rows.
     - **Disconnect and channel delete** (both are undoable, and their undo emits `channel.connected`): links in `deleting` are kept and completed on reactivation, or abandoned by the sweep after `OM_CALENDAR_SYNC_DELETE_ABANDON_DAYS`. All other links are unlinked with `unlink_reason = 'disconnect'` / `'channel_deleted'`.
14. Connections + settings APIs, the user-scoped `/setups` routes (`GET /setups`, `POST /setups/retry`), user and org settings pages, i18n; `yarn generate`.
15. Add the hub env vars (`OM_CALENDAR_SYNC_*`) to `apps/mercato/.env.example` and mirror them into the create-app template with `yarn template:sync:fix` (root `AGENTS.md` → Template Sync).

*Exit:* a fake-provider connection appears with settings round-trip.

### Phase 4 — Inbound engine (B)

16. `lib/apply-normalized-event.ts`: placement, shared-meeting identity (reserve-first primary, unique-violation → attach, eligibility, re-election, series attach, handover), mapping, external upsert + hashes, cancel, conflict, echo skip, demotion (all links → external, undo restore). Exhaustive unit tests with the fake adapter.
17. Workers on coalesced queues (`calendar-sync-inbound`, `-promote`, `-outbound`, plus `poll-tick` and `horizon-roll` with retention); redacted events API; item-source widget; details panel (read-only).

*Exit:* fake-provider events land correctly, including two connections racing on one new meeting.

### Phase 5 — People and promotion (B)

18. Auto-create in placement.
19. `external_event.promote` command + API (redaction-based authorization, `kind_not_promotable`) + worker (reserve/create/finalize, sibling attach).
20. Person subscriber (external promote + interaction link).
21. Details panel actions (Create person, Link to existing customer, Add to CRM), hidden whenever the API would refuse them.

### Phase 6 — Outbound and notifications (B)

22. Link API + `event_link.update`, enricher, editor widget; outbound subscribers + worker (insert/patch/cancel/delete via adapter, conference polling + write-back).
23. Webhook route, notification start/renew/stop orchestration.

*Exit:* the fake adapter receives idempotent inserts, version-checked patches and notification registration.

### Phase 7 — Google provider (C)

24. `@open-mercato/google-auth`: OAuth client, endpoints, `googleUserCredentialsSchema`, and `parseScopes(value, defaults?)` (**`defaults` optional**). Gmail's `lib/credentials.ts` keeps its one-argument `parseScopes(value)` export as a wrapper defaulting to `GMAIL_DEFAULT_SCOPES`, so the Gmail import path and signature are unchanged. Gmail also keeps exporting `gmailUserCredentialsSchema` and `gmailClientCredentialsSchema` under those names, as aliases of the `google-auth` schemas. Gmail re-exports the rest; tests move. *Gmail tests must stay green.*
25. `@open-mercato/channel-google-calendar`: `integration.ts`, OAuth `ChannelAdapter`, `CalendarProviderAdapter` (client with timeout/backoff, normalize/denormalize fixtures, `buildInstanceKey` usage, watch, Meet), connect widget, i18n, `AGENTS.md`; the package's unit tests run `runCalendarProviderConformanceSuite` against the Google adapter with recorded fixtures.
26. Add `OM_GOOGLE_CALENDAR_*` to `apps/mercato/.env.example` and run `yarn template:sync:fix`.

*Exit:* end-to-end with a stub Google server.

### Phase 8 — Integration tests, docs, spec sync (A + B + C)

27. Integration tests below.
28. Docs, following the existing layout of `framework/modules/building-communication-channel-provider.mdx` and `user-guide/communication-channels-gmail.mdx`:
   - `apps/docs/docs/framework/modules/building-calendar-sync-provider.mdx` ("How to add a calendar provider", contract, fit check, conformance suite);
   - `apps/docs/docs/user-guide/calendar-sync-google.mdx`.
29. CRM Calendar spec changelog. Cross-reference `2026-03-29-google-workspace-integration.md` so its connector consumes `@open-mercato/google-auth` instead of adding a third Google OAuth implementation.

### Phase 9 — Second-provider readiness check (B, test-only)

30. Run the conformance suite (shipped in Phase 3) against the two profiles below.
31. Add two more fake-adapter profiles in unit tests, with no production code:
   - **CalDAV-like:** no notifications, no conference, no client ids, `versionScope: 'series'`, in-adapter expansion, credential connect path;
   - **Graph-like:** batched notifications looked up by resource, window-bound cursor returning `fullResyncRequired` on horizon roll, `eventKinds: ['out_of_office']`.
   - Each proves the hub degrades correctly.

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `packages/google-auth/**` | Create | Shared Google OAuth |
| `packages/core/src/modules/communication_channels/lib/channel-reauth.ts` | Create | `markChannelRequiresReauth` conditional helper (Phase 1 step 3a) |
| `packages/core/src/modules/communication_channels/{data/entities.ts,migrations/*,lib/lifecycle-generation.ts,workers/poll-channel.ts,commands/deliver-outbound-message.ts,lib/ensure-system-email-channel.ts}` | Modify/Create | `lifecycle_generation` column, its additive migration and snapshot, and the `bumpChannelLifecycleGeneration` helper used by every lifecycle write site (Phase 1 step 3b) |
| `packages/shared/src/lib/url/meetingEntryPoint.ts` (new `lib/url/` directory) | Create | `isAllowedMeetingEntryPointUri` per-type scheme allowlist (pure, domain-free), shared by customers and the hub |
| `packages/channel-gmail/src/modules/channel_gmail/lib/{oauth,credentials}.ts` | Modify | Re-export |
| `packages/core/src/modules/communication_channels/{lib/adapter.ts,lib/oauth-client-config.ts,lib/credential-refresh.ts,lib/connect-channel.ts,events.ts,api/post/oauth/[provider]/initiate/route.ts,api/get/oauth/[provider]/callback/route.ts,commands/connect-credential-channel.ts,commands/disconnect-channel.ts,commands/delete-channel.ts,commands/admin-delete-channel.ts,subscribers/user-deleted-cascade.ts,commands/set-primary-channel.ts,api/post/webhook/[provider]/route.ts}` | Modify | Seams (fallback keys reach every `resolveOAuthClientCredentials` caller; `channel.connected` from both connect paths and the disconnect/delete/admin-delete undo handlers; `channel.disconnected` from the user-deleted cascade; callers of the new `markChannelRequiresReauth` helper (created in `lib/channel-reauth.ts`, see the Create row); `lifecycle_generation` bumps at every lifecycle write site; issuing-client refresh; calendar channel types rejected by the messaging webhook) |
| `apps/mercato/.env.example`, create-app template (via `yarn template:sync:fix`) | Modify | New `OM_CALENDAR_SYNC_*` / `OM_GOOGLE_CALENDAR_*` variables |
| `apps/mercato/src/modules.ts`, `packages/create-app/template/src/modules.ts` | Modify | Enable `{ id: 'calendar_sync', from: '@open-mercato/core' }` and `{ id: 'channel_google_calendar', from: '@open-mercato/channel-google-calendar' }` (same pattern as `channel_gmail`) |
| `apps/mercato/package.json`, `packages/create-app/template/package.json.template` | Modify | Add `@open-mercato/channel-google-calendar` and `@open-mercato/google-auth` |
| `packages/channel-gmail/package.json` | Modify | Depend on `@open-mercato/google-auth` |
| `packages/core/src/modules/customers/**` (entities, validators, encryption, migrations, di, extension-points, `lib/personEmailMatcher.ts`, `lib/interactionAccess.ts`, `commands/interactions.ts` (`beforeTransactionalWrite` for cancel/delete), `lib/calendar/*`, calendar components, interactions route, email components) | Modify/Create | Part A |
| `packages/core/src/modules/calendar_sync/**` | Create | Hub (contract, registry, entities, engine, workers, subscribers, API incl. `/setups`, `cli.ts` with `retry-cleanup`, widgets, pages, i18n, tests, fake adapter) |
| `packages/channel-google-calendar/src/modules/channel_google_calendar/**` | Create | Google provider |
| `apps/docs/docs/framework/modules/building-calendar-sync-provider.mdx`, `apps/docs/docs/user-guide/calendar-sync-google.mdx` | Create | Docs |

### Testing Strategy

- **Unit (hub, fake adapter):**
  - placement matrix: customer / internal / private / focus / OOO / transparent / skipped kinds;
  - auto-create: eligible, excluded domain, cap, resource/self;
  - shared meetings:
    - second connection attaches;
    - an attendee copy never overwrites content;
    - primary = organizer;
    - handover on disconnect;
    - private sibling attaches as participant only;
    - two connections racing on first import of the same new meeting → exactly one interaction (unique violation → attach);
    - organizer's private copy never becomes primary and triggers demotion only when pristine;
    - demotion with attached siblings → every link external with its own row; undo restores all links;
    - two modified instances of one CRM-owned series on the same connection → no unique-index violation;
    - promote authorization: `share_event_details = false` → 403 `details_hidden`; focus/OOO → 409 `kind_not_promotable`;
    - registry: duplicate `providerKey` throws; unregister then re-register works;
    - auto-create under the race: two connections importing the same new meeting with `auto_create_enabled` → exactly one Person per unknown attendee (only the reserve winner creates), and two different new meetings with the same new prospect → one Person (advisory lock + re-match);
    - attach while the winner is `promoting` → the loser's participant appears after the winner's finalize;
    - demotion undo: an undo emitting `customers.interaction.created` restores every link (subscriber keyed on `detached_from_interaction_id`); an unrelated `created` event is a no-op;
    - manual promote while an automatic promote job is waiting → the manual `entityId` wins (synchronous command, no queue);
    - full resync requested while an incremental job is waiting → the next run is `full` (`full_resync_requested_at`);
    - a sync tick between loading and saving connection settings or link intent → no 409 (dedicated version columns);
    - an attendee's RSVP update followed by the organizer making the meeting private → still demotes (watermark advanced);
    - editor-created meeting with push on → exactly one provider insert (`event_link.update` enqueues outbound);
    - re-elected imported link keeps `push_enabled = false` → CRM edits do not push;
    - reconnect reactivates the existing connection and re-elects its primaries;
    - a released reservation with attached links → each attached link gets its own external row immediately (no provider resend needed);
    - the sweep resumes a stale `promoting` link but ignores a fresh one; a promote job meeting a fresh `promoting` link no-ops;
    - a full sync of 3× the page budget converges (page state persisted per page, follow-up job), and the mark-and-sweep removes events that disappeared while disconnected;
    - a CRM push followed immediately by a colleague's inbound tick → one interaction, both with a client-supplied UID (Google/CalDAV profiles) and via the merge path (Graph-like profile);
    - re-promotion followed by an admin undo of the old demotion → the live interaction keeps its links (marker cleared);
    - an attendee primary's copy cancelled while the organizer still attends → unlink + handover, not cancel;
    - disconnect then Undo → the connection is reactivated (`channel.connected` from the undo);
    - a primary swap never violates the unique index (two-phase flush);
    - re-election during `promoting` is deferred to finalize;
    - parallel RSVP updates from two connections both persist under a forced interleaving, **with `OM_OPTIMISTIC_LOCK=off`** too (the guard's own lock and version check → conflict → re-read → retry); a CRM user edit committed before the hub write is not overwritten (the guard's version check fails → re-read → recompute); a user edit arriving during the hub write waits on the row lock and then applies on top, its own optimistic-lock rules deciding (by design);
    - a crash between a customers command commit and its bookkeeping → the next apply recognises the hub's own write via `pending_write_hash`: no fake conflict and no echo push;
    - two attached-link writes (B then C) interleaved with an organizer change between B's commit and B's bookkeeping → no fake CRM edit, no conflict, the organizer's change applied; out-of-order bookkeeping never moves the watermark backwards or clears the newer marker; the marker survives a primary swap;
    - promote/finalize and the delete/restore flows never hold the per-interaction lock while awaiting a customers command (asserted with a lock-held probe under a short per-test timeout, so a regression fails fast instead of hanging);
    - on a pristine interaction, hub write W2's guard runs between W1's commit and W1's bookkeeping → W2 records `pending_write_was_pristine = true` (effectively pristine), and the watermark ends at W2's `updatedAt` with no fake CRM edit; a primary swap in that window keeps all three interaction-level fields;
    - recovery after a crashed bookkeeping following a user edit → the marker is cleared without advancing the watermark (the user edit stays visible);
    - promoted (created) interactions start effectively pristine (`pending_write_was_pristine = true`, create-input hash);
    - a provider response delayed across a **disconnect** → its page-apply, customers write and cursor write all fail the fence (epoch bumped, status not `active`); no links, external rows or CRM records are recreated after cleanup;
    - the same delayed response across a disconnect **followed by an immediate reconnect** → still rejected (the reactivated connection has a higher `lease_epoch`; the old epoch never becomes valid again); the new lease's job syncs normally;
    - a disconnect and a reconnect that **both** commit before any lifecycle reconcile runs (both deliveries held back), then the pre-disconnect lease's delayed provider response is released → its page-apply, customers write and cursor write all fail the fence (channel `lifecycle_generation` changed) and a reconcile is enqueued; releasing the held deliveries → the reconcile bumps `lease_epoch` with the status still `active`, catches up `channel_generation`, runs no cleanup, and the next lease syncs from the committed cursor; lease acquisition between the reconnect and that reconcile is refused (generation mismatch);
    - a token refresh between two leases → `lifecycle_generation` unchanged, no revocation;
    - the catch-up on an `active` connection → the inbound run it enqueues acquires its lease immediately (`sync_lease_until` cleared), without waiting for the old lease's expiry;
    - an outbound job's auth error after a disconnect + reconnect that both committed before any reconcile → no mark (generation changed although `lease_epoch` did not);
    - a newly created connection → `channel_generation` equals the channel's generation and the first inbound run acquires its lease (no refused acquisition); a catch-up on an `active` connection enqueues an inbound run;
    - a stale inbound job's `CalendarAuthError` after a disconnect + reconnect that both committed before any reconcile → the generation fence rolls back the reauth transition; neither the connection nor the channel is marked;
    - lease acquisition concurrent with a stalled worker's reauth transition → no deadlock (both lock connection → channel);
    - Phase 1: a reconnect of an already-`connected` channel that changes none of the four fields still bumps `lifecycle_generation` (`force: true`), and resets a capped setup at the next attempt start; the lifecycle-write completeness test fails when a new assignment to `status`/`is_active`/`deleted_at`/`credentials_ref` bypasses `bumpChannelLifecycleGeneration`; a successful poll on an already `connected` channel does not bump;
    - channel delete with a job mid-flight → the lease is revoked (`paused`, `paused_reason = 'channel_deleted'`) and acquisition is refused while paused; Undo of the channel delete reactivates the **same** row (`paused_reason` cleared), a lease can be acquired, and its `deleting` links complete;
    - a delayed `CalendarAuthError` from the old epoch after disconnect + immediate reconnect → the conditional update matches zero rows and the connection stays `active`;
    - **stale lifecycle deliveries:** a `channel.disconnected` delivered after its Undo was processed → no-op; the same for `channel.deleted` after its Undo; a `channel.connected` delivered after a newer disconnect or delete → no-op; a duplicate `connected` after a worker-detected auth error → no-op (the channel row itself is `requires_reauth`); a real reconnect that changes **no other** channel field (only `status` `requires_reauth` → `connected`) → reactivated; a stale `connected` arriving after an unrelated channel write (`set-primary-channel`, `set-channel-visibility`, `lastPolledAt`) → no effect on a `requires_reauth` or `error` connection; an `error` connection is reactivated only by "Sync now" or the automatic retry;
    - Undo of an admin channel delete → `channel.connected` → the connection is reactivated; the user-deleted cascade → `channel.disconnected` → the connection is paused; a lifecycle write that emitted no event is corrected by the `poll-tick` safety net;
    - a reconnect whose credentials failed to persist (`requires_reauth`, `is_active = false`) → the connection goes to `requires_reauth` and **no** disconnect cleanup runs;
    - reactivate → disconnect → an older pending cleanup → its fence fails (epoch bumped on every move into `paused`);
    - crash after the pause commits and part-way through cleanup → the retry or the `poll-tick` safety net resumes cleanup (`cleanup_epoch` behind `lease_epoch`) and finishes it, setting `cleanup_epoch`; a reconnect mid-cleanup still stops it;
    - an outbound job's auth error after the connection was paused or reconnected → no mark (`lease_epoch` changed); an auth error from the old token after a same-channel reconnect → credentials version changed → no mark, the job exits and is requeued; the requeued job reads the new epoch/generation and uses the new token, and the channel stays `connected`;
    - an `organization_required` connection is ignored by "Sync now" and the automatic retry; a plain reconnect does **not** resolve it; deleting the channel and connecting it again from inside an organization → a new connection with that organization;
    - the safety net treats a connected channel + retryable `error` connection as agreeing (no reconcile churn);
    - an `organization_required` connection on a connected channel → the safety net treats it as agreeing and enqueues it only through the throttled trigger (`last_reconcile_requested_at`), at most once per window;
    - reactivating a `paused`/`requires_reauth` connection never calls `resolvePrimaryCalendar` (stored `external_calendar_id` reused);
    - a channel disconnected mid-setup → its setup row is deleted; a real reconnect (`lifecycle_generation` changed) resets a capped setup; a stale `connected` delivery does not;
    - an `organization_required` connection whose channel is disconnected → `paused` with `last_error = 'organization_required'` kept;
    - a paused org-less connection whose user then sets a home organization → the organization is pinned but the connection **stays `paused`** while its channel is disconnected; reconnecting then activates it;
    - a routine access-token refresh between two failing setup attempts → does **not** reset `attempts` (`lifecycle_generation` unchanged); a real reconnect does;
    - a first setup attempt that crashes right after its start → `attempts = 1`, `last_attempt_at` set, so the scan waits `backoff(1)` instead of re-selecting it on the next tick; a never-attempted row (`last_attempt_at IS NULL`) is selected on the next tick;
    - a setup attempt that refreshes the access token and then crashes → the next attempt start finds `lifecycle_generation` unchanged and does **not** reset `attempts`;
    - **discovery commit fence:** a discovery lookup that succeeds with the old authorization after a disconnect + reconnect both committed during the call → discarded (generation changed): no connection is created, the reconcile is re-enqueued, and the next attempt (new generation, counter reset) creates the connection with the new authorization's calendar; the same delayed success after a "Retry setup" reset or a newer attempt (token changed) → discarded, no connection, no setup-row write; a superseded attempt's `CalendarAuthError` → neither the channel nor the setup row is marked;
    - an attempt start racing a fenced commit that creates the connection (a duplicate `channel.connected`) → the post-lock live-connection check finds the connection, the re-created setup row is deleted, no provider call is made, and `GET /setups` shows no phantom row;
    - with `default_transaction_isolation = 'repeatable read'` on the server, a hub transaction still runs at read committed (explicit `isolationLevel`); a customers command transaction running the fence under repeatable read → the guard's isolation assertion throws (`[internal]`), nothing is written;
    - a concurrent token refresh with no reconnect, then an auth error in the inbound job → no mark, the job clears its lease and is requeued; the next run (fresh baseline after its own refresh) marks reauth if the auth error persists;
    - an attempt start whose setup-row lock returns no row (a fenced commit deleted it while it waited) → skipped, no provider call; "Retry setup" in the same window → `200 { queued: false }` (connection now exists);
    - a superseded attempt's `429` with `Retry-After` → `retry_after_at` is still recorded (never shortened), so the next attempt waits for it;
    - an attempt ending in `CalendarAuthError` while `/setups/retry` runs concurrently → no deadlock (the fence is its own transaction and takes the channel `FOR NO KEY UPDATE` from the start);
    - an attempt start on a channel that is no longer connected → discovery is skipped, and the same reconcile transaction deletes the setup row (no "Setting up…" left for a disconnected channel);
    - **eligibility at attempt start:** a stale or duplicate `channel.connected` delivery while `retry_after_at` is in the future → no provider call, `attempts` unchanged; the same delivery after the cap → no provider call; "Retry setup" during a `Retry-After` window → `202` with `retryAfterAt`, the attempt runs only after the window; a reconnect after the cap → the attempt start resets and calls the provider (unless a `Retry-After` window is open);
    - the first attempt on a connected channel with **no** setup row → the attempt start inserts it and counts the attempt (`attempts = 1`, `last_attempt_at` set), so a deterministically failing lookup still backs off and reaches the cap;
    - a capped setup whose channel is reconnected but whose `channel.connected` delivery is lost → the safety-net scan selects it (generation mismatch), `/setups` shows `setting_up`, and the attempt start resets the cap;
    - a user who unticked the Calendar permission (Google `403 insufficientPermissions` / `ACCESS_TOKEN_SCOPE_INSUFFICIENT`, mapped to `CalendarAuthError` by the Google adapter) → no connection, setup `setup_blocked_reauth`; reconnecting with it ticked → setup resets and the connection is created;
    - `POST /setups/retry` twice within a minute → 429; on a channel that already has a healthy connection → `200 { queued: false }`;
    - "Sync now" on a `channel_error` connection → 409 `channel_error` (no reactivation, no flip-flop with the safety net); the automatic retry ignores it; the channel back to `connected` → reactivated by the reconcile;
    - Google `403 rateLimitExceeded` / `userRateLimitExceeded` or `429` during sync or discovery → `CalendarRateLimitError`, backoff only: it does not count toward the sticky `error` threshold or the discovery attempt cap;
    - a rate-limited discovery attempt leaves `attempts` unchanged, records `last_error = 'rate_limited'` and honours `Retry-After` via `retry_after_at`; a crash mid-attempt still counts;
    - "Retry setup" during an in-flight discovery attempt that is then rate-limited → `attempts` stays 0 (the token-fenced decrement is skipped), never -1; a reset followed by a newer attempt, then the stale attempt's rate limit → the newer attempt's count is kept; a reconnect whose newer attempt ends in `requires_reauth` (`setup_blocked_reauth`, "Reconnect" offered), then a stale attempt's rate limit or other error → `last_error` and the state are unchanged; `retry_after_at` can only be extended by the stale attempt's `Retry-After` (`GREATEST`), never shortened or cleared;
    - `OM_CALENDAR_SYNC_ERROR_THRESHOLD` consecutive non-auth, non-rate-limit inbound failures → `error`; a success in between resets `consecutive_failures`; a retry back to `active` resets it;
    - `/setups/retry` racing a reconcile that creates the connection → no setup row is left behind (conditional insert, plus the reconcile's cleanup);
    - `GET /setups` with the channel `requires_reauth` but the setup row's `last_error` still `rate_limited` or null (superseded or missing fenced write) → `setup_blocked_reauth`, "Reconnect" offered; with the channel reconnected but `last_error = 'requires_reauth'` not yet cleared → `setting_up`;
    - "Retry setup" on an `organization_required` connection whose channel is disconnected → `202`, the organization is pinned and the connection stays `paused`; on a pending setup whose channel is disconnected → 409 `channel_not_connected`;
    - a deterministically failing discovery (`403 accessNotConfigured`) → retried with backoff, stops after `OM_CALENDAR_SYNC_DISCOVERY_MAX_ATTEMPTS`, "Setup failed" shown; "Retry setup" resets it;
    - discovery `CalendarAuthError` with a reconnect landing mid-lookup → discarded by the discovery commit fence (generation changed), the fresh channel is not marked `requires_reauth`, and the re-enqueued attempt runs with the new credentials;
    - a crash mid-cleanup still increments `cleanup_attempts`; `retry-cleanup` resets it;
    - a channel in `error` → the connection is `error`/`channel_error`; neither "Sync now" nor the automatic retry reactivates it while the channel is in `error` (no retry/safety-net flip-flop); the channel back to `connected` → the reconcile reactivates it;
    - a stale `connected` + discovery `CalendarAuthError` after a disconnect → the commit fence discards it (channel not `connected`), so `markChannelRequiresReauth` is never called and no reauth event is emitted; the channel stays `disconnected`, nothing is created, and the re-enqueued reconcile deletes the setup row;
    - `organization_required` → user sets a home organization → the throttled safety-net reconcile (or "Retry setup") pins it and activates it **if the channel is connected** (otherwise the mapping status is kept, e.g. `paused`); a blocked reactivation (no organization) → `error`/`organization_required`, not left half-active; disconnect → reconnect of an org-less connection never yields an active connection without an organization;
    - a channel without an organization whose connection is pinned to the home organization → the reconcile and safety net find both rows (tenant-scoped reads); a hard-deleted channel row → `paused`/`channel_deleted`;
    - the job's own token refresh followed by an auth error → no false "reconnect" (baseline read after refresh); an auth error after a real reconnect → the stale job does not mark (version changed, generation fenced) and exits; the next run under the new lease and generation uses the new credentials, and if it also fails with an auth error it marks reauth;
    - a connected calendar channel whose discovery **queue** retries ran out while still under `OM_CALENDAR_SYNC_DISCOVERY_MAX_ATTEMPTS` → re-enqueued by the safety net after its backoff; for the inbound/outbound **workers** (not discovery), a credentials version that changed under the job → no reauth mark, the job is requeued; a deterministically failing cleanup → stops after `OM_CALENDAR_SYNC_CLEANUP_MAX_ATTEMPTS`, `cleanup_failed` reported;
    - `resolvePrimaryCalendar` (creation only) fails after a concurrent disconnect → the discovery result is discarded, nothing is created, and the re-enqueued reconcile deletes the setup row; it fails with an auth error → the channel is marked `requires_reauth`, **no** connection is created, and the setup row shows `setup_blocked_reauth` until a reconnect resets it; a transient error → retried via the setup throttle;
    - `resolvePrimaryCalendar` still in flight when a channel delete commits → the discovery result is discarded and no connection is created;
    - a disconnect delivery processed after an Undo can never start cleanup (no revocation epoch is created);
    - disconnect followed by Undo while cleanup is still running → cleanup stops at the next transaction (connection active again, epoch changed); links re-attached by the new job are not unlinked;
    - a full traversal of 3× the page budget calls `listChanges` once per page with the persisted `pageState` and fixed horizon; job 2 resumes on page `budget + 1` (not page 1); the adapter never receives a page budget;
    - the primary applies a genuine organizer change while an attached link's hub write is committed but un-bookkept → no `conflict_resolved` (the conflict rule uses the effectively-pristine predicate after recovery);
    - a user edit to a field the hub never writes (e.g. `priority`, a custom field) while a marker is pending → the hash differs, the edit stays visible, and the interaction is not demoted;
    - an inbound title with surrounding spaces and an alias timezone (e.g. `US/Pacific`) → the own-write hash matches the stored, normalized row, the watermark advances, and there is no fake conflict or echo push;
    - a user CRM edit followed by a hub RSVP write → the watermark is not advanced (`pending_write_was_pristine = false`), the user edit stays visible, and a later private-organizer change keeps the interaction (`privacy_changed_kept`);
    - a page that marks a series master and attaches an occurrence of the same interaction while a guard on that interaction runs → no 40P01 (advisory lock before the first link-row write);
    - UID merge interrupted after step (2) → the sweep resumes from `merged_from_interaction_id`, and no second interaction can be reserved for the key between steps (1) and (4), ending with one interaction and no lock held across customers commands;
    - a hub write to an interaction that was meanwhile hard-removed → the missing-interaction path, never retried;
    - outbound coalescing of update + delete → delete executed (payload `{ linkId }`, action from state);
    - a manual promote that loses the reserve race adds its `entityId` to the winner and returns the winner's id;
    - undo of a manual promote is not reversed by the next person update (`auto_promote_suppressed_at`);
    - refresh after a dedicated calendar client is configured still uses the issuing (Gmail) client;
    - Graph-like recurring occurrences produce the same meeting key as the Google and CalDAV fixtures (series-master UID);
    - a full traversal spanning several jobs keeps one `traversal_run_id` and its fixed horizon, and its final sweep removes nothing that was seen on page 1;
    - a full request arriving mid-incremental traversal invalidates the incremental page state (the committed cursor is unchanged) and starts a fresh full traversal; a full request arriving mid-full traversal does not restart it, and a request made after the traversal started is not cleared by it;
    - a provider call that returns after another worker took over the lease and applied a newer page → the stale worker's placement/content transaction aborts on the `lease_epoch` fence, and the version guard drops the older event;
    - a delete delivery arriving after its undo was handled → no-op (interaction live); a duplicate delivery of a handled deletion → no-op (`deletion_marker`); a re-delete after undo → handled; a `deleting` link with a live interaction is restored by the sweep;
    - two connections returning the same local external id for unrelated UID-less events → placed independently (connection-scoped synthetic key);
    - the normalizer drops entry points with disallowed schemes, and the render-time check never emits a link for them;
    - a lease lost during a customers write → `beforeTransactionalWrite` throws, the command rolls back, and **no** `customers.interaction.*` event or query-index job is emitted; on success, events fire only after the command's own commit;
    - the delete handler and the undo restore handler interleaved (undo commits while the delete handler holds the per-interaction lock) → the end state is the owning link `linked` and the colleague links re-attached, never stuck in `deleting`;
    - an outbound insert completing while a full traversal is paging → the link (with `external_identity_at ≥ traversal_started_at`) is not swept;
    - `fullResyncRequired` on page 2 of an incremental traversal → traversal invalidated, `full_resync_requested_at` set, the next run starts a fresh full traversal;
    - the safety net on a `deleting` link with a live interaction on a paused connection → disconnect outcome (never primary), colleagues restored by the generic marker restore;
    - reconnect with unchanged provider events restores the external rows and re-elects primaries (full mode bypasses the echo skip); enabling auto-create, then a full resync, creates People for unchanged events;
    - undo of a manual promotion after a colleague attached → every link attached at undo time is re-placed as external (none dangling);
    - a user deleting an imported interaction → all its links detached to external rows with auto-promotion suppressed; undoing the delete restores them;
    - the organizer of a CRM-pushed series disconnects while a colleague holds occurrence links → no occurrence link becomes primary; the series rule and start time are unchanged;
    - a stalled worker whose lease was taken over cannot write the cursor (owner token);
    - a handover copies only `synced_interaction_updated_at` → no spurious `conflict_resolved`; a genuine organizer change right after handover is still applied;
    - the organizer's primary copy turns private on a non-pristine interaction → stays primary with writes frozen; the demotion check fires only on the transition;
    - per-attendee advisory locks taken in sorted order (no deadlock with reversed attendee order);
    - a null-org channel pins the connection to the user's home org, and `organization_required` when there is none;
    - `oauthClientId` survives a refresh round-trip through the stripping schema;
    - Google insert: the provider-returned `iCalUID` overwrites the predicted key, and a mismatch runs the merge rule;
    - CRM delete of a push-enabled CRM-origin meeting → exactly one provider delete, no external row, owning link `unlinked` / `crm_delete` with `interaction_id` kept; a pending outbound job running between the delete and the handler's commit is a no-op;
    - undo while `deleting` → the owning link is restored first (CAS), colleagues re-attach, no provider write; undo after `crm_delete` → CRM record only, colleague markers cleared, push off; re-enabling push → identity reset → **insert** of a new event that colleagues' new copies attach to; undo after `provider_delete_abandoned` → colleagues re-attached and a primary elected among them;
    - organizer disconnects (handover to colleague B, organizer row `unlinked` / `disconnect`), then CRM delete, then undo → the stale disconnect row is **not** matched by the owning-delete key, and B's link is restored by the generic marker restore;
    - disconnect and channel delete keep `deleting` links; their undo (`channel.connected`) completes the provider delete; after `OM_CALENDAR_SYNC_DELETE_ABANDON_DAYS` the sweep abandons and reports;
    - a stale `deleting` link (connection needed reauth) is completed by the sweep or on reactivation;
    - handover followed by a CRM edit → the edit is kept and no `conflict_resolved` is raised (the new primary's own copy is unchanged, so no content write);
    - re-enabling push after an `unlinked` undo → **insert, not patch** (old provider identity cleared); a full sync between re-enable and insert does not sweep the owning link;
    - undo racing an in-flight provider delete → the worker's CAS (`state = 'deleting' AND state_changed_at = :readAt`) fails and it applies the CRM-only outcome; the end state is never a CRM record bound to a cancelled provider event;
    - full sync skips `deleting` links and owning links awaiting an insert; undo of a CRM delete while the connection is `requires_reauth` → the `deleting` branch (full restore, colleagues re-attached, no provider write until reauth);
    - undo of a `deleting` link after the connection was disconnected or channel-deleted → the link gets the disconnect outcome (never primary on a paused connection), and a colleague is elected through the generic restore;
    - abandoned undo branch → the old link has `is_primary = false`, and a colleague is elected without an index violation; abandonment also fires for a `deleting` link stuck on an active connection (permanent provider error);
    - a stale `created` restore arriving after a quick re-delete → no-op (interaction soft-deleted);
    - full-sync sweep after `crm_delete` → the `unlink_reason` is preserved, and a later undo still finds the owning link;
    - the generic restore skips cancelled (`unlinked`) colleague links;
    - re-enable for `provider_delete_abandoned` → 409 while the connection is inactive; after reactivation, the row is re-linked and patched, with no duplicate event or interaction;
    - a reconnected link with its own watermark applies a genuine provider change made while disconnected, via the conflict rule against a non-pristine interaction;
    - full sync with an unchanged provider copy and an edited CRM interaction → the CRM body is kept, with no `conflict_resolved` event;
    - a suppressed link with unchanged attendees edited in the provider → stays external; an attendee change lifts the suppression;
    - admin undo of a hub-created interaction → its links are detached on the next touch (missing-interaction rule);
    - organizer connecting after an attendee's promotion is re-elected primary;
    - instances of a CRM-owned series attach to the series interaction (series attach);
    - `buildInstanceKey` yields identical keys for Google `originalStartTime`, Graph `originalStart` and CalDAV `RECURRENCE-ID` (timed + all-day);
    - cross-provider (two fake provider keys, same UID);
    - promotion attaches all external siblings;
  - demotion; recurrence (provider-owned instances, CRM-owned echo); conflict; echo; `managedPersonIds`;
  - redaction serializer; hash context;
  - outbound payload; idempotent insert retry; version conflict;
  - webhook parse (validation / change / bad token);
  - notification renewal ordering;
  - CalDAV-like profile degradation.
- **Unit (Google):** normalize/denormalize fixtures (Meet, Zoom add-on, focus, OOO, private, all-day, multi-day, recurring exception, cancelled), `410` → full, `412` → conflict, watch headers.
- **Unit (hub seams / customers):** fallback, guard, matcher, `includeLinked`, item-source fan-out.
- **Integration:** a stub Google server via `OM_GOOGLE_CALENDAR_API_BASE_URL`, skipped (and reported) when unreachable from the app container.

## Integration Test Coverage (required)

Self-contained Playwright specs in `calendar_sync/__integration__/`, `channel_google_calendar/__integration__/` and `customers/__integration__/`. Fixtures are created through the API and cleaned up in teardown.

| Id | Covers |
|----|--------|
| TC-CALSYNC-001 | Connections/settings APIs: 401, 403 (`connect`/`configure`), foreign connection 404, stale 409, invalid domain 400; **two organizations in one tenant** keep separate auto-create settings (each GET returns only its own values); a sync tick between GET and PUT of connection settings does not cause 409; `GET /setups` returns a pending setup and an org-less (`organization_required`) connection to its own user only (another user in the same tenant → not listed); `POST /setups/retry` resets attempts and enqueues the reconcile, another user's channel → 404, a pending setup on a disconnected channel → 409 `channel_not_connected`, an `organization_required` connection on a disconnected channel → 202 and stays `paused`; `POST /connections/run` on a retryable-error connection whose channel is disconnected → 409 `channel_not_connected` |
| TC-CALSYNC-002 | Webhook: unknown provider → 404; unknown channel id, bad token and valid change all → uniform 202 (only the valid one enqueues a job, asserted via the job count); a `validation` response is served as `text/plain` with `X-Content-Type-Options: nosniff`; `POST /api/communication_channels/webhook/google_calendar` → 404; a body with a declared `Content-Length` over the limit → 413, and a chunked body without `Content-Length` that streams past the limit → 413, neither reaching the adapter (asserted by no job and no adapter call) |
| TC-CALSYNC-003 | Placement: matched meeting with an unknown email + Meet → interaction (entity, participants, meeting fields, `source = calendar_sync:google_calendar`); internal meeting → external item; cancelled → `canceled` |
| TC-CALSYNC-004 | User settings page hydration + settings round-trip |
| TC-CALSYNC-005 | Multi-match → one interaction; `includeLinked=true` for the second person |
| TC-CALSYNC-006 | Loop-breaker: inbound update → no outbound; CRM edit → exactly one version-checked patch |
| TC-CALSYNC-007 | `PUT …/link`: not organizer / not primary → 409; another user's **private email** interaction → 404 (GET too); a `task`/`call` interaction → 409 `kind_not_syncable` |
| TC-CALSYNC-008 | Privacy: user B sees A's private event only as `{kind:'busy', redacted:true}` in raw JSON; details `{redacted:true}`; `shareEventDetails=false`; focus/OOO kind + times only |
| TC-CALSYNC-009 | Calendar UI: Busy and OOO blocks without titles; conflict ring against A's busy block |
| TC-CALSYNC-010 | Auto-create: excluded domain not created; other attendee created with `source`; over-cap event stays external |
| TC-CALSYNC-011 | Manual: Create person X → promoted; Y created elsewhere → linked to the same interaction; "Link to existing customer" with a company on an attendee-less event; foreign `entityId` → 404 |
| TC-CALSYNC-012 | Promotion authorization: non-owner of a private event → 403 `details_hidden`; non-owner of an event whose owner set `shareEventDetails=false` → 403 `details_hidden`; owner without confirmation → 409 `confirmation_required`; confirmed → interaction; a focus-time event → 409 `kind_not_promotable` |
| TC-CALSYNC-013 | **Shared meeting:** A (organizer) and B (attendee) both connected, same iCalUID → one interaction, both user ids in participants, `_calendarSync.sharedWith = 1`; B's stale copy does not overwrite A's title change; A disconnects → B's link becomes primary; A reconnects → A is re-elected primary; an internal shared meeting promoted via B attaches A's external copy (A's external row gone) |
| TC-CALSYNC-014 | **Shared-meeting edge cases:** <br>• a user deletes an imported shared meeting in the CRM → both users keep their availability as external rows, and undo restores one interaction with both links <br>• a user deletes a CRM-pushed meeting (push on) → exactly one provider delete in the stub and no external row <br>• with a connected colleague: delete + undo after the provider delete → the CRM record is restored without a primary; re-enabling push inserts a new stub event that the colleague's new copy attaches to <br>• a CRM edit to an imported meeting's body survives a forced full sync (stub returns `410`) <br>• two connections whose stub calendars return the same new meeting, synced concurrently → exactly one interaction <br>• the organizer's copy turns private on a pristine interaction → demotion: no interaction, both users get their own external row, undo of the delete restores one interaction with both links <br>• a CRM-pushed weekly series with two instances modified in the organizer's calendar → a single series interaction, no unique-index error <br>• the same new meeting in both calendars with auto-create on and one unknown attendee → exactly one Person <br>• after demotion, an admin undo (`audit_logs.undo_tenant`) restores one interaction with both links; making the event non-private again re-promotes it without undo <br>• A disconnects and reconnects → the existing connection is reactivated (no unique-index error) and A is primary again |
| TC-GCAL-001 | OAuth initiate for `google_calendar`; with only `channel_gmail` client config, the authorize URL uses Gmail's `client_id` + calendar scopes |
| TC-GCAL-002 | Google normalization end to end (stub): Meet conference, focus time, OOO, private visibility, all-day → correct hub records |
| TC-GCAL-003 | Editor widget + Meet: insert with `createRequest` and the client id; `meetingUrl` written back; a retried insert (`409`) creates no duplicate |
| TC-GCAL-004 | Watch registration with `OM_CALENDAR_SYNC_WEBHOOK_BASE_URL`; `X-Goog-*` headers parsed by the generic webhook route |
| TC-CAL-016 (customers) | `meetingUrl` validation; Join prefers `meetingUrl`; participant "Create person"; `meetingDetails.entryPoints` rejects `javascript:`/`data:`/`http:` on `video`, non-`tel:` on `phone` and non-`sip(s):` on `sip` (400); a legacy row containing a `javascript:` entry point renders as plain text, not a link |
| TC-CAL-017 (customers) | Item-source extension: test source renders; failure notice; no source → no change |
| TC-CHANNEL-EMAIL-033 (hub) | A calendar channel is not offered as an email sender |

## Risks & Impact Review

### Data Integrity Failures

- **Idempotent inserts:** each adapter guarantees idempotency per key `<link id>:<insert_generation>`; tested for Google (`409`) and for the fake adapter's search-based profile.
- **Cursors and replay:** `providerState` advances only after the final page; replays are echo-skipped by `content_hash`.
- **Promotion:** reserve → create → finalize with a caller-supplied id; resumable from `promoting`; sibling attach is part of finalize.
- **One writer per meeting:** a partial unique index (`interaction_id WHERE is_primary`) guarantees a single primary. Handover runs in one transaction with the unlink.
- **Concurrency:**
  - Queues coalesce per entity (`connection:<id>`, `link:<id>`, `meeting:<org>:<key>`), and every worker is idempotent (queue `AGENTS.md`).
  - The owner-tokened, epoch-fenced connection lease (`sync_lease_until` + `sync_lease_owner` + `lease_epoch`) guards against cross-process overlap without holding a row lock across provider calls.
  - **Shared meetings:** the unique primary-per-meeting index makes the first-import race safe. The reserve step inserts the primary before any customers write, and the loser retries as ATTACH, so at most one interaction is ever created per meeting.
  - **Locking rules** (per-interaction advisory lock `pg_advisory_xact_lock(hashtext('calendar_sync:interaction:' || interaction_id))`):
    - **Order:** connection `FOR SHARE` (fenced inbound work only) → channel `FOR SHARE` (the generation fence) → per-interaction advisory lock(s), taken in **ascending interaction id** order when one transaction touches several interactions → then rows. Page-apply therefore first collects the interaction ids its page will touch (the page's links **and** their meeting-key attach and series-attach targets), then locks them in order. Postgres detects advisory-lock deadlocks (40P01), and a slip is retried as a transient error.
      - Hub link-only transactions write link rows.
      - The customers guard locks the interaction row `FOR UPDATE` and then writes the primary link row (the marker).
      - Every row write below the advisory lock is serialized by that lock, so the order among rows cannot deadlock.
      - **Rule:** any transaction that writes an interaction-placed link row takes that interaction's advisory lock **before its first such write**. That includes page-apply writes of `last_seen_run_id` and external watermarks on interaction-placed links.
      - Paths that do not touch the connection row skip the first step.
    - **Never await a customers command while holding the lock.** A customers command opens its own connection and takes the same lock through its `beforeTransactionalWrite` guard. A hub transaction holding the lock while awaiting it would wait on itself through two sessions, which Postgres cannot detect (it would hang until `lock_timeout` or the idle-in-transaction timeout). Hub link changes and customers commands are therefore always separate, sequential transactions.
    - **Writers that take the lock** (in addition to the general rule above):
      - `event_link.update`, including re-enabling push, which makes a link primary again;
      - promote finalize;
      - the UID merge's link moves;
      - customers writes through the guard (create, update, cancel, delete);
      - the hub bookkeeping transaction after each customers write;
      - inbound **link-only** transactions that change interaction-placed links: attach, re-election, handover, provider-cancel unlink, reservation release, and sweep unlinks of interaction-placed links;
      - the delete handler, the undo restore handler and the sweep safety net;
      - promote steps after the reserve, and demote steps (a) and (c);
      - the outbound worker's post-provider-call transaction.
    - **Writers that don't need it:** transactions touching only external-placed links or external rows. These carry no `interaction_id`, so the delete, restore and safety-net flows never read them.
    - The guard's locked-row version check makes parallel inbound jobs from different connections, and concurrent CRM user edits, unable to overwrite one another unknowingly.

### Cascading Failures & Side Effects

- **Provider outage:** isolated per connection and adapter; backoff; `error` after `OM_CALENDAR_SYNC_ERROR_THRESHOLD` (default 5) consecutive failures (`consecutive_failures`).
- **Auto-create:** bounded per event and per tick; individually undoable; tagged `source`.
- **Item source failure:** isolated; interactions still render.
- **`customers` absent:** everything is placed external; promotion and auto-create no-op (`customers_unavailable`).
- **A bad adapter (third party):** contained. Typed errors only, zod-validated `providerState`, normalized events validated by a hub zod schema before placement (invalid → link `error`, never a crash), timeouts enforced by the hub around every adapter call.
- **Outbound invitations:** irreversible, hence per-event opt-in.

### Tenant & Data Isolation Risks

- Webhook scope comes only from the stored connection, with a hashed token.
- Every query is scoped by tenant/org.
- **Shared-meeting lookup is per organization**, so iCalendar UIDs never join across tenants or organizations.
- Redaction is server-side, with a raw-JSON test.
- Consent explainer at connect; per-user share switch.

### Migration & Deployment Risks

- Additive only; concurrent GIN index; encryption backfill.
- Provider prerequisites are documented per provider.

### Operational Risks

- External store: ~40k rows per org at 50 users; range-indexed; nightly retention.
- Notification expiry: daily renewal + polling.
- Blast radius: the new hub and provider; additive customers seams; narrow `communication_channels` changes.

### Risk Register

#### Provider contract too narrow for the next provider

- **Scenario:** Microsoft Graph or CalDAV needs a capability the v1 contract lacks, forcing a breaking change.
- **Severity:** Medium
- **Mitigation:**
  - design-time fit check against Google, Graph and CalDAV (Provider Contract);
  - capability flags;
  - opaque `providerState`;
  - Phase 9 CalDAV-like degradation tests;
  - additive evolution policy.
- **Residual risk:** Edge features (Graph room lists, CalDAV scheduling inbox) are out of v1 scope and additive later.

#### Shared-meeting misattribution

- **Scenario:** Two different meetings share an iCalendar UID (buggy client), so unrelated attendees get attached to one interaction.
- **Severity:** Medium
- **Mitigation:**
  - the key includes `instance_key` and is scoped per organization;
  - an attach is rejected when start times differ by > 24h (the link records `last_error = 'uid_collision'`, and the event is placed independently with the synthetic key `uid_collision:<connectionId>:<externalId>` stored in `ical_uid`);
  - covered by unit tests.
- **Residual risk:** Low.

#### Colleagues or vendors auto-created as customers

- **Severity:** High
- **Mitigation:** off by default; empty-domains warning; self/resource excluded; cap; `source` tag; never for private events.
- **Residual risk:** Personal-domain colleagues are not caught (documented).

#### Private details leaking

- **Severity:** High
- **Mitigation:**
  - external events are not indexed for search or AI tools in v1;
  - the redaction serializer is the only read path;
  - no auto-promotion of private events;
  - privacy is decided by the primary copy;
  - TC-CALSYNC-008.
- **Residual risk:** Low.

#### Matching misses and manual duplicates

- **Severity:** Medium
- **Mitigation:** "Link to existing customer"; the subscriber links later-created people; the blind-index swap.
- **Residual risk:** Remains until the blind index ships.

#### Sync loop

- **Severity:** High
- **Mitigation:** `syncOrigin` filter, `content_hash` echo skip, watermark, single primary writer, TC-CALSYNC-006.
- **Residual risk:** Low.

#### Demotion destroys an interaction

- **Severity:** Medium
- **Mitigation:** pristine-only, undoable delete; otherwise kept + warning.
- **Residual risk:** Recoverable.

#### Webhook spoofing

- **Severity:** Medium
- **Mitigation:** uniform 202 (no id probing); hashed token compare; rate limit; a ping triggers only a read with the user's token; validation responses forced to `text/plain` + `nosniff`.
- **Residual risk:** Bounded extra polling.

#### Recurrence limits

- **Severity:** Low
- **Detail:** provider-owned series are edited per instance; exceptions to CRM-owned series are ignored and logged.
- **Residual risk:** Accepted.

#### Token or secret leakage

- **Severity:** High
- **Mitigation:**
  - tokens stay in encrypted integration credentials;
  - only hashed notification tokens are stored;
  - external content and meeting fields are encrypted;
  - errors are machine codes only;
  - adapters are forbidden to log payloads (reviewed in the adapter checklist in the docs).
- **Residual risk:** Low.

## Final Compliance Report — 2026-11-19

### AGENTS.md Files Reviewed

- `AGENTS.md` (root): Task Router rows for integration provider, module development, cross-module coupling, encryption, optimistic locking, events, widget injection, response enrichers, queue/scheduler, integration tests, DS rules
- `packages/core/AGENTS.md`, `packages/core/src/modules/customers/AGENTS.md`, `packages/core/src/modules/data_sync/AGENTS.md`, `packages/channel-gmail/AGENTS.md`
- `packages/ui/AGENTS.md`, `packages/ui/src/backend/AGENTS.md`, `packages/queue/AGENTS.md`, `packages/events/AGENTS.md`
- `.ai/specs/AGENTS.md`, `.ai/qa/AGENTS.md`, `.ai/ds-rules.md`, `.ai/ui-components.md`, `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root | Core platform features in `packages/<pkg>/src/modules/<module>/`; providers in dedicated packages | Compliant | `calendar_sync` in core (provider-neutral hub, like `data_sync`); Google in its own package with no tables or routes |
| root | No direct ORM relationships between modules | Compliant | FK ids; ManyToOne only intra-module |
| root | Tenant/org scoping | Compliant | Shared-meeting identity scoped per org; webhook scope from the stored row |
| root | zod validation | Compliant | Including hub validation of adapter output and `providerState` |
| core → Encryption | Encryption maps, `findWithDecryption`, backfill | Compliant | Hub external content; customers meeting fields **and `participants`** (encrypted with backfill in Part A, because the hub scales up this PII) |
| root | Optimistic locking | Compliant | Connections, org settings, link intent |
| core → Cross-Module Coupling | Optional consumer owns glue; no reverse dependency | Compliant | Hub → customers via `tryResolve`, commands, extension point; providers → hub via the registry; customers never imports the hub; hub never imports providers |
| core → Events / Commands | `createModuleEvents`; undoable commands; side effects documented | Compliant | |
| core → API Routes | `makeCrudRoute`, `openApi`, mutation guards | Compliant | |
| core → Access Control | Feature guards + ACL sync | Compliant | |
| core → Response Enrichers | `enrichMany`, namespace, features, `cacheableOnListHit: false` | Compliant | |
| queue | Idempotent jobs | Compliant | |
| ui / ds-rules | CrudForm, `apiCall`, `useGuardedMutation`, tokens, dialogs, `aria-label` | Compliant | |
| BACKWARD_COMPATIBILITY | Additive surfaces; versioned provider contract | Compliant | `calendar-provider.v1`, evolution policy stated |
| .ai/qa | Integration coverage for new API/UI paths | Compliant | TC-CALSYNC-001…014, TC-GCAL-001…004, TC-CAL-016/017, TC-CHANNEL-EMAIL-033 |

### Internal Consistency Check

| Check | Status |
|---|---|
| Data models match API contracts | Pass |
| API contracts match UI/UX | Pass |
| Risks cover all write paths (placement, attach/handover, auto-create, promote, demote, outbound, settings, link intent, webhook) | Pass |
| Commands defined for all mutations | Pass |
| Cache strategy | N/A |

### Non-Compliant Items

None blocking. (`CustomerInteraction.participants` encryption, previously a follow-up, is now part of Part A.)

### Open Items for Maintainers (Ask First)

- **New shared export:** `@open-mercato/shared/lib/url/meetingEntryPoint` → `isAllowedMeetingEntryPointUri`, a new cross-package helper (`packages/shared/AGENTS.md` → Ask First). The alternative, if maintainers prefer, is to keep it in customers and expose it to the hub through a customers DI service.
- **Spec split:** Part A/B/C split (see Resolved Assumptions).

### Verdict

**Compliant — no blocking AGENTS.md gaps.** This is an author self-assessment, not an approval: implementation approval is a maintainer decision, as is the open Part A/B/C split.

## Changelog

- 2026-11-19 — Skeleton with Open Questions Q1–Q9.
- 2026-11-19 — Rev 1: Open Questions resolved with the recommended defaults; full Google-only design.
- 2026-11-19 — Rev 1 review fixes:
  - Part labels;
  - hub hardening rationale;
  - mutation guards, encryption backfill, concurrent index, Join XSS rule.
- 2026-11-19 — Rev 2 (requester):
  - import all events; external store + item-source extension point;
  - private events → Busy; focus time / OOO;
  - org auto-create; manual Create person + promotion.
- 2026-11-19 — Rev 2.1: attendee hashes on the link row (people created after promotion get linked); "Link to existing customer"; duplicate-person risk.
- 2026-11-19 — **Rev 3 (requester delegated the reuse decision; recommended option applied):**
  - **Restructured** into a provider-neutral `calendar_sync` hub in core with a versioned `CalendarProviderAdapter` contract (`calendar-provider.v1`, fit-checked against Google, Microsoft Graph, CalDAV) and a registry mirroring `data_sync`;
  - Google reduced to a thin provider package with no tables or routes;
  - tables renamed `calendar_sync_*` with `provider_key`, opaque `provider_state` and generic notification columns;
  - generic webhook `/api/calendar_sync/webhook/[provider]` with validation-handshake support;
  - org auto-create settings moved to the hub (one policy for all providers);
  - **shared-meeting identity (R14):** deduplication by `(org, iCalUID, instanceKey)`, a single primary writer, attach and handover — fixes duplicate interactions when several connected users attend one meeting;
  - Phases re-cut to 9 (Part A/B/C), including a CalDAV-like degradation check;
  - tests renamed to TC-CALSYNC / TC-GCAL and TC-CALSYNC-013 added.

- 2026-11-19 — **Rev 3.1 (fixes for the `om-code-review` findings, request changes, 5 major / 7 minor / 4 nits):**
  - **Major fixes:**
    - the series-attach index is now `(connection_id, interaction_id, instance_key)`;
    - a unique primary-per-meeting index plus reserve-first placement removes the first-import race (unique violation → attach);
    - private links are never eligible as primary, and a private organizer copy triggers demotion;
    - promote authorization follows the redaction rule (`details_hidden`), and focus/OOO events are not promotable;
    - demotion converts every sibling link to its own external row, and undo restores them (`detached_from_interaction_id`, `calendar_sync.interaction.demoted`).
  - **Minor fixes:**
    - queue job-id dedupe restated as `coalesceBy` keys;
    - TC-CAL-013/014 renumbered to 016/017;
    - registry semantics follow `registerChannelAdapter` (throw on duplicate, unregister function, `globalThis` map);
    - `parseScopes` keeps Gmail's one-argument export;
    - file manifest completed;
    - template-sync steps for the new env vars;
    - `includeLinked` uses a bound `?::jsonb` parameter.
  - **Nits:**
    - status made consistent (no self-approval);
    - phase steps renumbered 1–30 and Phase 8 assigned to the Parts;
    - `link_id` is OneToOne;
    - google-workspace spec cross-reference.
  - TC-CALSYNC-014 and new unit cases added.

- 2026-11-19 — **Rev 3.2 (fixes for the rev 3.1 independent review):**
  - **Major fixes:**
    - Demotion undo listens on `customers.interaction.created` (what the delete-undo actually emits), keyed by `detached_from_interaction_id`. Undoing it is admin-only (`audit_logs.undo_tenant`); the user-facing reversal is un-privating the event or "Add to CRM".
    - Manual promotion runs synchronously inside the `external_event.promote` command. The coalesced `promote` job serves only automatic triggers and carries no intent. Full resync intent is persisted (`full_resync_requested_at`).
    - Placement reserves the primary **before** auto-creating People; only the reserve winner creates them, serialized per attendee by an advisory lock with re-match.
    - A link attaching while the winner is still `promoting` defers its participant write to the winner's finalize.
  - **Minor fixes:**
    - dedicated lock version columns (`settings_updated_at`, `intent_updated_at`);
    - org settings stored as a single `autoCreate` value with compare-and-set;
    - the watermark advances on every hub write (attached RSVP no longer breaks pristine);
    - `event_link.update` enqueues outbound;
    - provider-origin links default `push_enabled = false`;
    - Google primary-calendar discovery via `events.list` + userinfo (no extra scope; TC-GCAL-001 asserts scopes);
    - Discord statement corrected;
    - manifest gains `modules.ts` / `package.json` entries;
    - header registry rows corrected;
    - reconnect upserts and reactivates the connection;
    - Gmail schema-name aliases kept.
  - **Nits:**
    - behavioural rules moved to an exported conformance suite;
    - uniform `202` webhook response;
    - demotion selects by `interaction_id` (covers series);
    - synthetic and collision keys stored in `ical_uid`.
  - Unit cases and TC-CALSYNC-014 extended.
- 2026-11-19 — **Rev 3.3 (fixes for the rev 3.2 independent review):**
  - **Blockers:**
    - org settings moved from the tenant-only `ModuleConfigService` to an org-scoped hub table `calendar_sync_settings`, locked on `updated_at`;
    - the link API gains record-level authorization via the new customers DI service `customerInteractionAccess` (visibility rules + base kind; private email → 404, non-meeting kinds → 409 `kind_not_syncable`), re-checked by the outbound worker.
  - **Major fixes:**
    - stale-state sweep (`state_changed_at`) and explicit re-placement of attached links on a released reservation;
    - per-page persisted page state with follow-up jobs, plus a full-sync mark-and-sweep;
    - CRM-pushed meetings get their UID at link creation (`clientSuppliedIcalUid`), with a merge rule for providers that assign the UID late;
    - the demotion marker is cleared on re-promotion, and undo restores only still-external links;
    - only the organizer's cancelled copy (or all copies cancelled) cancels the interaction;
    - `channel.connected` is also emitted from the disconnect/delete undo handlers.
  - **Minor fixes:**
    - stale webhook test and risk text aligned with the uniform 202;
    - `ko` locale;
    - Graph uses the series master's `iCalUId`;
    - registry `has`/`get`/`list` functions and the hot-reload guard;
    - two-phase primary swap;
    - re-election deferred while `promoting`;
    - per-interaction advisory lock for every hub write;
    - lease instead of a row lock across network calls;
    - outbound payload `{ linkId }` with the action re-derived from state, and privacy fields provider-owned;
    - a manual promote that loses the race attaches and returns the winner;
    - sticky undo of manual promotion;
    - refresh with the issuing OAuth client;
    - forced `text/plain` + `nosniff` on validation responses;
    - the `includeLinked` person-timeline change documented.
  - **Nits:**
    - `confidential` maps to private;
    - the messaging webhook rejects calendar types;
    - changelog ordering fixed;
    - review records added for every round.
  - **Considered, unchanged:** `share_event_details` defaults to `true`. The requester specified that only *private* events are hidden from colleagues; the consent explainer at connect states that non-private event details are visible to the team, and users can switch it off.

- 2026-11-19 — **Rev 3.4 (fixes for the rev 3.3 independent review):**
  - **Major fixes:**
    - The echo skip applies only to live, linked, incremental cases, and full runs always re-place (reconnect and auto-create resync work).
    - Promote undo selects links by `interaction_id` at undo time and re-places them.
    - A new `customers.interaction.deleted` subscriber detaches links when a user deletes an imported interaction (undo restores them). The marker is renamed `demoted_from_interaction_id` → `detached_from_interaction_id` (earlier changelog entries were updated to the new name).
    - Handover and re-election candidates are restricted to links with the interaction's own meeting key, so occurrence links never write series content.
  - **Minor fixes:**
    - Google `clientSuppliedIcalUid = false`, with an optional `predictIcalUid`; the provider-returned UID always wins, and the merge rule applies to every provider.
    - Risks text now describes the lease; the lease gets an owner token.
    - Advisory locks are taken in sorted order.
    - Watermarks are copied on every swap.
    - A private organizer copy on a non-pristine interaction stays primary with frozen writes, and the demotion check fires on the transition only.
    - Sweep window via link `starts_at`; pending CRM links are excluded.
    - The conformance suite moved to Phase 3.
    - Connection organization pinning rule.
    - `oauthClientId` declared in the credentials schema.
    - `customerInteractionAccess` listed as a contract surface.
    - `participants` encryption (with backfill) moved into Part A.
  - **Nits:**
    - docs paths follow the existing layout;
    - stale `autoCreate.enabled` fixed;
    - the first-insert settings race maps to 409;
    - lock-reader `updatedAtField` configured;
    - Graph `uid` noted.

- 2026-11-19 — **Rev 3.5 (fixes for the rev 3.4 verification review):**
  - **Major fixes:**
    - Deleting a CRM-pushed meeting keeps its owning link in a new `deleting` state, so the outbound job deletes the provider event; only other links are detached. Undo re-inserts the event.
    - Placement re-evaluation is now separate from content application: provider content is written only when the provider copy changed, so full syncs, `410` and reconnects never overwrite CRM edits.
  - **Minor fixes:**
    - the placement pseudocode honours `auto_promote_suppressed_at` (+ `auto_promote_suppressed_hashes`);
    - the marker-clearing note is corrected;
    - a missing-interaction rule covers undo of hub-created interactions;
    - integration coverage added for the delete and detach paths.
  - **Nits:**
    - suppression note completed;
    - garbled sweep sentence fixed;
    - Eligibility exception stated.

- 2026-11-19 — **Rev 3.6 (fixes for the rev 3.5 delta verification):**
  - **Major fixes:**
    - `customers.interaction.deleted` now has a single handler that commits `deleting` before enqueuing outbound; the worker derives "owning" from link flags, not state; apply/RSVP/attach skip deleting and soft-deleted links.
    - Undo of a CRM delete explicitly restores the owning link (before re-election). It bumps a new `insert_generation` that feeds the idempotency key, client id and UID, so the re-insert really creates a new provider event.
  - **Minor fixes:**
    - swaps copy only `synced_interaction_updated_at`, and a link's first apply as primary is pristine-only;
    - `deleting` is covered by the stale sweep and re-enqueued on reactivation;
    - `auto_promote_suppressed_hashes` has its own column row.
  - Unit cases added.

- 2026-11-19 — **Rev 3.7 (fixes for the rev 3.6 delta verification):**
  - **Major fix:** undo of a CRM delete is simplified and made deterministic by the owning link's state.
    - `deleting` (job not run) → full restore, owning link first.
    - `unlinked` (provider event deleted) → only the CRM record is restored: no re-attach of cancelled colleague copies, push off, and re-enabling push inserts a new event via `insert_generation`.
    - The delete-flow unlink keeps `interaction_id` and does no handover.
    - The series/connection unique index excludes `unlinked` links.
  - **Minor fixes:**
    - the delete subscriber ignores an already-unlinked owning link;
    - disconnect keeps `deleting` links, and the sweep skips inactive connections;
    - a link's first apply as primary uses its own change signal + the normal conflict rule (pristine-only only without its own watermark);
    - the idempotency key `<link id>:<insert_generation>` is stated everywhere, including the contract.
  - **Nit:** handover test text.

- 2026-11-19 — **Rev 3.8 (fixes for the rev 3.7 delta verification):**
  - **Major fixes:**
    - An explicit **owning-delete key** (no `is_primary` requirement) is used by the delete subscriber and the undo restore. "Every other link" excludes `unlinked`.
    - Re-enabling push clears the old provider identity, so the worker inserts, not patches. The sweep spares owning links awaiting an insert.
  - **Minor fixes:**
    - compare-and-set transitions between undo and the in-flight delete worker;
    - a single `created` restore handler with fixed branch order;
    - the full sync skips `deleting`; channel delete abandons pending provider deletes with a reported error; undo never revives a dead connection's link;
    - the freshly-cleared-hash rule is aligned with the first-apply rule.
  - **Nits:** test wording.

- 2026-11-19 — **Rev 3.9 (fixes for the rev 3.8 delta verification):** the CRM-delete flow was rewritten as an explicit state machine.
  - **Major fixes:**
    - The owning-delete key now requires `unlink_reason ∈ {crm_delete, provider_delete_abandoned}` (new column), so stale ordinary unlinks never match.
    - Undo branches on link state only, never on connection status. A `deleting` link on a `requires_reauth` connection is fully restored.
    - `provider_delete_abandoned` restores colleagues through the generic marker restore.
  - **Minor fixes:**
    - Channel delete is treated like disconnect (both undoable); pending provider deletes are abandoned only after `OM_CALENDAR_SYNC_DELETE_ABANDON_DAYS`.
    - The worker acts on a soft-deleted interaction only when the link is `deleting`, so it can never run before the handler. Its CAS uses `state_changed_at`.
    - The action derivation lists the no-op cases first.

- 2026-11-19 — **Rev 3.10 (precision fixes from the rev 3.9 verification, verdict approve):**
  - **Minor fixes:**
    - The `deleting` undo branch gives a paused connection's link the disconnect outcome instead of making it primary.
    - Abandonment is a CAS that clears `is_primary`, driven by the new `connection.status_changed_at`, and also applies to links stuck on active connections.
    - The restore handler no-ops when the interaction is no longer live.
    - The full-sync sweep and the generic marker restore ignore `unlinked` rows, and the sweep never overwrites `unlink_reason`.
    - The re-enable identity reset is limited to `crm_delete`; abandoned rows are re-linked on reactivation.
  - **Nits:**
    - explicit no-op for `deleting` + live interaction;
    - `not_organizer` unlink reason.

- 2026-11-19 — **Rev 3.11 (PR #10009 review: haxiorz security scan, pkarw spec review):**
  - **High fixes:**
    - The public webhook reads a bounded body (`readBoundedRequestBody`, 1 MiB default / `OM_WEBHOOK_MAX_BODY_BYTES`) before any adapter parsing, and returns 413 for declared and streamed overflow.
    - A full sync is a persisted **traversal** (mode, run id, start time, fixed horizon and page state written together). Continuations reuse it. An incompatible incremental traversal is invalidated by a full request. The sweep runs only for the completing full traversal's run id, and the full request is cleared only when it predates the traversal start.
    - Placement and content mutations are fenced by a `lease_epoch` token (`FOR SHARE` check in every mutation transaction), with customers commands joining that transaction via `ctx.transactionalEm` (support added to cancel/delete). A monotonic version guard is added.
    - The delete handler ignores superseded deliveries: it re-reads the interaction, uses a `deletion_marker` + CAS, and a sweep safety net restores `deleting` links whose interaction is live.
  - **Medium fixes:**
    - `meetingDetails.entryPoints[].uri` has a per-type scheme allowlist enforced at validation, normalization and render time.
    - Synthetic meeting keys are scoped by connection.

- 2026-11-19 — **Rev 3.12 (internal review of rev 3.11):**
  - **Major fixes:**
    - **Customers writes keep their own transaction** (side effects stay post-commit). The lease fence reaches them through the existing `ctx.beforeTransactionalWrite` guard instead of `ctx.transactionalEm`; Part A adds `beforeTransactionalWrite` support to cancel/delete. Lost updates are prevented with the commands' optimistic lock (`buildOptimisticLockHeader` on a synthetic request, retry ≤ 3) instead of running commands on a hub transaction.
    - The delete handler, the undo restore handler and the sweep safety net serialize on one per-interaction advisory lock.
    - The full-sync sweep skips links whose provider identity was established after the traversal started (new `external_identity_at`).
  - **Minor fixes:**
    - `fullResyncRequired` on any page invalidates the traversal and requests a full run;
    - the safety net runs the full `deleting` restore branch, connection-aware and with colleagues;
    - the delete guard uses the owning-delete key;
    - `isAllowedMeetingEntryPointUri` moved to `@open-mercato/shared` (flagged for maintainer confirmation);
    - contention wording corrected;
    - fence scope clarified (the promote job is not lease-fenced).
  - **Nits:** misplaced lease sentences moved; lease wording includes the epoch; "legacy rows" rephrased as defence in depth.

- 2026-11-19 — **Rev 3.13 (internal verification of rev 3.12):**
  - **Major fix:** lost-update protection no longer depends on the optimistic-lock header, which checks and then writes without a lock and is disabled when `OM_OPTIMISTIC_LOCK` is off. The hub's `beforeTransactionalWrite` guard locks in a fixed order (connection `FOR SHARE` → per-interaction advisory lock → interaction row `FOR UPDATE`) and compares the locked row's version itself; a missing interaction goes to the missing path. The client-only `buildOptimisticLockHeader` is no longer referenced.
  - **Minor fixes:**
    - a pending-write marker (`pending_write_hash`) covers the gap between a customers commit and its bookkeeping, and the watermark wording is corrected;
    - promote and the outbound worker's CRM-only outcome take the per-interaction lock, and every hub writer is listed;
    - a manifest row and an Ask-First open item for the new shared helper;
    - `external_identity_at` is NOT NULL and uses the database clock.
  - **Nits:** the safety-net condition is now measurable; grammar fixes.

- 2026-11-19 — **Rev 3.14 (internal verification of rev 3.13):**
  - **Major fix:** the pending-write marker is set inside the customers command transaction by the guard, after the lock and version check. Bookkeeping runs under the per-interaction lock with compare-and-clear, a forward-only watermark (`GREATEST`), and an own-write hash check. The marker is copied on primary swaps.
  - **Minor fixes:**
    - explicit locking rules: a fixed order, and **never await a customers command while holding the lock**; promote and demote steps run in their own transactions;
    - a complete list of the lock-taking writers, plus the exempt external-only transactions.
  - **Nits:** test wording on CRM user edits; contention wording.

- 2026-11-19 — **Rev 3.15 (internal verification of rev 3.14):**
  - **Major fixes:**
    - The own-write hash uses the stored, normalized form via the new pure customers DI method `customerInteractionAccess.toStoredSyncedFields` (title trim, canonical timezone, participants), so normal hub writes match their own marker.
    - A hub write no longer absorbs an earlier CRM user edit: the guard records `pending_write_was_pristine`, and bookkeeping advances the watermark only for pristine rows. This fixes a pre-existing defect the reviewer flagged out of scope.
  - **Minor fixes:**
    - the guard's real lock order is stated, with the rule that every transaction writing an interaction-placed link row takes the advisory lock first, plus ascending-id order for multi-interaction transactions;
    - missing writers listed (`event_link.update`, promote finalize, UID merge);
    - the UID merge is split into resumable steps (`merge_into_interaction_id`) that never await a customers command while holding a lock;
    - the watermark is set exactly, with no `GREATEST`.
  - **Nits:**
    - finalize applies the bookkeeping rules;
    - the marker goes on the current primary, and is skipped when there is none;
    - recovery clears superseded markers;
    - tests use a per-test timeout.

- 2026-11-19 — **Rev 3.16 (internal verification of rev 3.15):**
  - **Major fix:** a single **effectively pristine** predicate, which also recognises a pending hub write whose bookkeeping has not run, is used by the guard, bookkeeping, recovery, demotion and first apply. Back-to-back hub writes no longer make an interaction permanently non-pristine.
  - **Minor fixes:**
    - swaps copy all three interaction-level fields;
    - the create path defines its marker (pristine, create-input hash);
    - recovery honours the pristine flag;
    - the UID merge stores `merged_from_interaction_id` (renamed), updates the surviving primary's key in step (1), and is resumed by the stale-state sweep.
  - **Nit:** page-apply collects interaction ids before taking locks in order.

- 2026-11-19 — **Rev 3.17 (precision fixes from the rev 3.16 verification, verdict approve):**
  - The conflict rule and the CRM-only-change check use the effectively-pristine predicate, evaluated after recovery under the per-interaction lock.
  - The merge resumer's staleness clock starts at step (1), and a partial index is added for `merged_from_interaction_id`.
  - `StoredSyncedFields` is enumerated as the complete user-editable surface, including custom fields, so clause 2 can never absorb a user edit.
  - **Nits:**
    - merge step (4) is described as a locked hub transaction;
    - page-apply's lock set includes attach and series-attach targets.

- 2026-11-20 — **Rev 3.18 (pkarw re-review of `fba5ded1`; haxiorz approved `fba5ded1`):**
  - **High fix:** the lease is revoked atomically on every transition out of `active` (disconnect, channel delete, `requires_reauth`, `error`) by the same `UPDATE` that changes the status. It bumps `lease_epoch` and clears the owner. Acquisition, renewals, cursor writes and the fence all require `status = 'active' AND deleted_at IS NULL`. Disconnect/delete cleanup runs only after revocation commits. The epoch never decreases, so an old job stays fenced out after an immediate reconnect. Tests cover a delayed provider response across disconnect and across disconnect + reconnect.
  - **Medium fix:** inbound step 4 now matches the paginated adapter contract. One page per `listChanges` call with the stored `pageState` and the traversal's fixed horizon. `nextPageState` is persisted after every page, and the page budget is enforced by the worker only.
  - Merged the latest upstream `main` (no conflicts; only this spec differs).

- 2026-11-20 — **Rev 3.19 (internal verification of rev 3.18):**
  - Channel delete now pauses the connection (`paused_reason = 'channel_deleted'`) instead of soft-deleting it. Channel delete is undoable, so its Undo reactivates the same row and its `deleting` links complete.
  - Status transitions the worker makes itself (`requires_reauth`, `error`) are conditional on still holding the lease, so a stale job cannot knock a reconnected connection back into reauth.
  - Disconnect/delete cleanup is fenced against reactivation (row `FOR UPDATE` + revocation epoch).
  - **Nits:** fence sentence placement, `sync_lease_owner` doc, step 4 → step 6 completion order.

- 2026-11-20 — **Rev 3.20 (pkarw re-review of `b957af69`):** channel lifecycle handling is now **level-triggered**. Every `channel.connected/disconnected/deleted` delivery only enqueues a coalesced per-channel reconcile job. That job locks the connection `FOR UPDATE`, re-reads the current channel row `FOR SHARE` (serialized with channel lifecycle writes), derives the desired connection state from it, and applies only the difference.
  - Stale, duplicate or out-of-order deliveries (disconnect/delete after Undo, connected after a newer disconnect/delete) are no-ops by construction.
  - `channel_updated_at_seen` distinguishes a real reconnect from a stale `connected`.
  - In-flight discovery results are discarded when the channel is no longer connected.
  - Cleanup re-checks the channel state, and a stale delivery can no longer create a revocation epoch.

- 2026-11-20 — **Rev 3.21 (independent review of rev 3.20):**
  - **Major fix:** the channel row is the single source of truth for authorization state. On `CalendarAuthError`, the worker marks the channel `requires_reauth` via the new hub helper `markChannelRequiresReauth` (the same write the Gmail poller makes) in its lease-held transaction, so a real reconnect genuinely changes the channel row. `channel_updated_at_seen` and its timestamp heuristic are removed. `error` is sticky on the connection and cleared only by an explicit or automatic retry.
  - **Minor fixes:**
    - Phase 3 step 13 aligned with the lifecycle rules;
    - admin-delete Undo and the user-deleted cascade now emit lifecycle events, plus a `poll-tick` reconcile safety net;
    - every move into `paused` bumps `lease_epoch`, and the cleanup fence uses the returned value;
    - the reconcile payload carries tenant and organization;
    - discovery failures are defined (no-op / reauth / retry).
  - **Nits:** the mapping checks `requires_reauth` before `disconnected`, so a failed-credential reconnect is non-destructive; status line updated.

- 2026-11-20 — **Rev 3.22 (independent review of rev 3.21):**
  - **Major fix:** disconnect/delete cleanup is level-triggered and resumable (`cleanup_epoch`). The reconcile and the `poll-tick` safety net resume any paused connection whose cleanup did not complete, so an interrupted cleanup can no longer stall forever.
  - **Minor fixes:**
    - the outbound auth-error mark is fenced by the epoch read at job start;
    - an auth error after a credentials change is retried, never marked;
    - `organization_required` is non-retryable and is resolved by the reconcile when the channel gains an organization;
    - the discovery-failure wording is corrected;
    - the safety net uses two scoped batched reads and the same mapping function (connected + retryable `error` agree).
  - **Nits:** grammar, manifest purpose, `/connections/run` contract.

- 2026-11-20 — **Rev 3.23 (precision fixes from the rev 3.22 verification, verdict approve):**
  - `markChannelRequiresReauth` is conditional (it never overwrites a disconnected or deleted channel), with the event emitted only when it matched; the discard rule has precedence during discovery.
  - `organization_required`: the reconcile re-runs pinning, reactivation requires an organization, and the settings-page guidance is defined.
  - Tenant-scoped lookups use each row's own organization; a "channel not found" mapping row is added; locks are taken in id order.
  - The outbound fence is documented: inbound is the authoritative reauth detector, and outbound retries.
  - The credentials baseline is read after the job's own refresh, with a defined second-failure outcome.
  - The safety net scans connected channels with no connection.
  - Cleanup attempts are capped (`cleanup_attempts`, `OM_CALENDAR_SYNC_CLEANUP_MAX_ATTEMPTS`).
  - **Nits:** a single `:revocationEpoch` definition; `IS DISTINCT FROM` plus the retry age predicate, clearing `last_error`; the events table lists the new emissions.

- 2026-11-20 — **Rev 3.24:** the remaining rev 3.22 nit. A channel-level `error` maps to connection `error` with `last_error = 'channel_error'`. It follows the channel (reactivated when the channel returns to `connected`) and is excluded from "Sync now" and the automatic retry, so the retry and the safety net cannot flip-flop.

- 2026-11-20 — **Rev 3.25 (minors from the rev 3.23–3.24 review, verdict approve):**
  - Phase 3 step 13 is aligned with `channel_error`.
  - "Sync now" and the automatic retry share one retryable condition that excludes `organization_required` and `channel_error` and requires a connected channel; `/connections/run` returns 409 `channel_error`.
  - `organization_required`:
    - a blocked reactivation lands in `error`/`organization_required`;
    - a throttled safety-net trigger and "Retry setup" pick up a home-organization change;
    - stale "reconnect fixes it" text is corrected;
    - `organization_id` is documented as nullable.
  - Discovery retries are throttled and capped per channel in the new `calendar_sync_channel_setups` table (`OM_CALENDAR_SYNC_DISCOVERY_MAX_ATTEMPTS`); the discovery auth mark uses the credentials-version guard.
  - **Nits:**
    - the age predicate applies to the automatic retry only;
    - `cleanup_attempts` is reset by the pausing `UPDATE` and incremented per attempt;
    - an operator `retry-cleanup` CLI command is defined;
    - the manifest lists `lib/channel-reauth.ts` as Create;
    - a credentials version that changed again leads to a requeue.

- 2026-11-20 — **Rev 3.26 (minors from the rev 3.25 review, verdict approve):**
  - `organization_required` is classified explicitly: the mapping leaves it to the pinning rule, and the safety net counts it as agreeing and enqueues it only through the throttled trigger, with new state `last_reconcile_requested_at`.
  - Setup visibility and actions get an API: user-scoped `GET /setups` (pending setups and org-less connections, which the org-scoped list cannot show) and `POST /setups/retry`, both tested.
  - Reactivation never runs discovery; it reuses the stored `external_calendar_id`.
  - **Nits:**
    - setup rows are deleted when the channel is removed, and the cap resets on a real reconnect only (credentials version);
    - 409 `channel_not_connected`;
    - `retry-cleanup` is tenant-scoped, clears `cleanup_failed` and acts only on paused connections with unfinished cleanup;
    - five-table count, the retry-minutes description and the manifest text are fixed;
    - an unreachable clause is removed;
    - the null-organization invariant holds across pause;
    - test wording and a test for a credentials version that changed again.

- 2026-11-20 — **Rev 3.27 (minors from the rev 3.26 review, verdict approve):**
  - Discovery runs **only** at creation, everywhere in the spec: step 13, the failure paths and the tests. A discovery auth error creates no connection; the setup row shows `setup_blocked_reauth`, and a reconnect resets it.
  - `credentials_version_seen` is recorded after the attempt's own token refresh, so routine refreshes never reset the cap.
  - Pinning an organization never changes the status; the mapping decides, so a paused org-less connection stays paused.
  - **Nits:**
    - the org-less invariant holds across every transition;
    - the inline `retry-cleanup` text is aligned;
    - `/setups/retry` gets its guard `resourceKind`, a `200 { queued: false }` no-op and a 1/min rate limit;
    - `/setups` gets keyset paging, the `state` enum and its cross-organization rationale;
    - Phase 3 step 14 lists the `/setups` routes.

- 2026-11-20 — **Rev 3.28 (minors from the rev 3.27 review, verdict approve):**
  - The pinning rule and the mapping no longer defer to each other: after a successful pin, the mapping is applied as if the connection were `paused`.
  - The Google adapter maps a `403` with `insufficientPermissions` / `ACCESS_TOKEN_SCOPE_INSUFFICIENT` (unticked Calendar permission) to `CalendarAuthError`. The "deterministic 403" example is now `accessNotConfigured`.
  - **Nits:**
    - stale test wording fixed;
    - the `/setups` `state` union is complete, with precedence;
    - the activation test is conditional on the channel being connected;
    - the null-organization invariant is stated as `⇔` in the data model;
    - `/setups/retry` handles channels with no setup row yet, and the UI offers "Reconnect" for blocked setups.

- 2026-11-20 — **Rev 3.34 (pkarw re-review of `03d104d5`):**
  - **High — discovery results fenced by the generation and attempt that produced them:** a discovery success or `requires_reauth` mark is persisted only by a transaction that locks channel → setup row and finds the channel `connected`, `lifecycle_generation = :attemptGeneration` and `attempt_token = :attemptToken`; otherwise nothing is written and the reconcile is re-enqueued. A new connection takes `channel_generation = :attemptGeneration`. This replaces discovery's credentials-version guard. Tests: delayed success across a reconnect; a superseded attempt completing after a reset.
  - **Medium — cap, backoff and `Retry-After` enforced at attempt start for every trigger:** the attempt start re-checks the channel state and the shared `isSetupAttemptEligible` predicate under its locks after explicit resets (generation change; "Retry setup" now also clears `last_attempt_at`), and exits without a provider call when ineligible. `retry_after_at` is never cleared by a reset. Tests: a stale lifecycle delivery during `Retry-After` and after the cap.
  - **From the internal review of the first 3.34 draft (verdict approve):**
    - **Minor fixes:**
      - the attempt start re-checks for a live connection in a fresh statement after locking the setup row, and the commit fence requires no live connection, so a duplicate delivery racing a fenced commit cannot resurrect a setup row or call the provider;
      - a discarded attempt writes nothing (except extending a `Retry-After` window, added later in 3.34); the re-enqueued reconcile deletes the setup row of a removed channel (text and test aligned);
      - "skip" at attempt start skips discovery only; the reconcile transaction (mapping, setup-row deletion, backstop) always runs.
    - **Nits:**
      - the outbound and inbound reauth transitions take the channel `FOR NO KEY UPDATE`;
      - the credentials-version requeue test is scoped to the workers;
      - `GET /setups` returns `retryAfterAt`, and resets clear `last_error`.
  - **From the second internal review of 3.34 (verdict approve):**
    - **Minor fixes:**
      - an empty setup-row lock at attempt start (row deleted by a concurrent fenced commit) skips discovery; `/setups/retry` falls through to its other branches;
      - the job order is stated: attempt-start transaction → provider call → discovery commit fence (own transaction, lock mode from the known outcome) → reconcile transaction.
    - **Nits:**
      - the insert's lock-order wording is corrected;
      - hub transactions run at READ COMMITTED;
      - the stale-`connected` auth-error test matches the fence;
      - a superseded attempt's `Retry-After` is still recorded with `GREATEST` (not token-conditional).
  - **From the third internal review of 3.34 (verdict approve):**
    - **Minor fix:** the stale-attempt test no longer expects `retry_after_at` unchanged; it can only be extended (`GREATEST`), never shortened or cleared.
    - **Nits:** the job-order step (3) and the fence's "writes nothing" name the `Retry-After` exception; the lock-order sentence's punctuation and full list of setup-row writers; READ COMMITTED also required for the customers command transaction that runs the fence.
  - **From the fourth internal review of 3.34 (verdict approve):**
    - **Minor fix:** the worker no longer retries once and marks after a reconnect (which the generation fence forbids); a job that sees the credentials version move exits without marking and is requeued, and the next run under the new lease and generation marks if it also fails (text and test aligned).
    - **Nit:** READ COMMITTED is set explicitly on hub transactions and asserted by the `beforeTransactionalWrite` guard inside the customers transaction.
    - **Follow-up from the fifth internal review (verdict approve):** the outbound test no longer expects a retry-once; the early exit clears its own lease (concurrent-refresh case, with a test); the isolation test is split into the hub and customers cases.
  - **Nits from the rev 3.33 internal review:** `lease_epoch` column note lists every bump; lock order connection → channel → setup row is stated for every setup-row writer (incl. `/setups/retry`); `FOR NO KEY UPDATE` on the channel where a reauth mark may follow; the concurrency lock-order line includes the channel; `markChannelRequiresReauth` bumps `lifecycle_generation` (rev 3.33, now recorded); outbound and catch-up tests added.

- 2026-11-20 — **Rev 3.33 (pkarw re-review of `6e680bf0`):**
  - **High — lease fenced across a disconnect + reconnect that both precede the reconcile:** new `communication_channels.lifecycle_generation` (Phase 1 step 3b), bumped by every channel lifecycle write and never by a token refresh. Lease acquisition requires the connection's `channel_generation` to match; every fence check re-reads the channel row `FOR SHARE` and requires the generation acquired with; the reconcile catches up `channel_generation` and bumps `lease_epoch` even when the status stays `active`. Lock order connection → channel. Regression test holds both deliveries until after the reconnect.
  - **Medium — setup bookkeeping before the provider call:** one attempt-start transaction resets (on a generation change), increments, sets `attempt_token`, `last_attempt_at` and `channel_generation_seen`, and clears `retry_after_at`, all before the token refresh and the lookup. `credentials_version_seen` is replaced by `channel_generation_seen`, so a token refreshed by a crashed attempt never resets the cap. `last_attempt_at IS NULL` rows are selected immediately; `backoff(n)` is defined.
  - **Medium — Reconnect derived from the current channel:** `/setups` gives a `requires_reauth` channel precedence over the setup row's `last_error`.
  - Non-attempt writes (attempt start, row deletions, `/setups/retry` insert/reset) are explicitly not token-conditional.
  - **From the independent review of the first 3.33 draft (verdict approve):**
    - **Minor fixes:**
      - the attempt start creates a missing setup row (guarded insert), so a first attempt is counted and throttled;
      - a new connection starts at the channel's current generation, and a catch-up on an `active` connection enqueues inbound;
      - lease acquisition locks connection → channel, the global lock order;
      - Phase 1 step 3b lists every real lifecycle write site (incl. `deliver-outbound-message`, duplicate demotion, the system email channel), bumps only on an actual change (`commitPollProgress`), and exempts only the test-seed route;
      - the inbound worker's own reauth/`error` transition uses the full generation fence.
    - **Nits:**
      - the scan and `/setups` treat a generation mismatch on a capped row as a reconnect;
      - `organization_required` precedence on a mismatch is stated;
      - the catch-up resets `cleanup_attempts`;
      - the new column appears in the Part B, DB-impact and manifest summaries.
  - **From the second review of 3.33 (verdict approve):**
    - **Minor fixes:**
      - the generation catch-up also clears `sync_lease_until`, so the inbound run it enqueues acquires immediately;
      - `bumpChannelLifecycleGeneration` takes `force: true`, used by `applyConnectionState`, so a reconnect that changes no field still bumps.
    - **Nits:**
      - the paused-epoch sentence mentions the catch-up;
      - the rate-limit close no longer re-sets `last_attempt_at`;
      - the setup row is locked last (connection → channel → setup row);
      - the completeness test covers raw SQL and states its scope and exceptions.

- 2026-11-20 — **Rev 3.32 (minor + nit from the rev 3.31 review, verdict approve):**
  - New **Attempt fencing** rule: every setup-row write an attempt makes after its increment (`credentials_version_seen`, `last_error`, `last_attempt_at`, `retry_after_at`, the rate-limit decrement), for every outcome, is conditional on its `attempt_token`, so a superseded attempt can no longer overwrite a newer attempt's outcome (e.g. turn `setup_blocked_reauth` back into `rate_limited`).
  - **Nit:** the cap-reset wording no longer makes "them" read as the token.

- 2026-11-20 — **Rev 3.31 (minor from the rev 3.30 review, verdict approve):**
  - The rate-limit decrement of `attempts` is fenced by a per-attempt `attempt_token` (set by the increment, cleared by every reset), so a concurrent "Retry setup" or reconnect reset can no longer drive `attempts` to -1, and a stale attempt cannot cancel a newer one's count; `CHECK (attempts >= 0)` added.
  - The status line records that rev 3.30 is pushed.

- 2026-11-20 — **Rev 3.30 (minor + nits from the rev 3.29 review, verdict approve):**
  - A rate-limited discovery attempt no longer counts toward the setup cap: its closing transaction decrements `attempts`, records `rate_limited`, and `retry_after_at` honours `Retry-After`.
  - **Nits:**
    - the sticky `error` threshold is now a named counter (`consecutive_failures`) with `OM_CALENDAR_SYNC_ERROR_THRESHOLD` (default 5);
    - TC-CALSYNC-001 distinguishes a pending setup (409) from an `organization_required` connection (202) on a disconnected channel;
    - `/setups/retry` inserts the setup row only while no connection exists, and the reconcile removes any stale setup row.

- 2026-11-20 — **Rev 3.29 (minors from the rev 3.28 review, verdict approve):**
  - The stale "pinning never changes the status" phrase is fixed.
  - Google `429` and `403 rateLimitExceeded` / `userRateLimitExceeded` map to `CalendarRateLimitError` (backoff only, never counted toward the sticky error or the discovery cap), mirroring Gmail's `isRateLimit403`.
  - `/setups/retry`'s 409 `channel_not_connected` is limited to the setup branches; the `organization_required` branch always queues.
  - **Nits:**
    - the duplicate `state` list is removed;
    - the setup row is upserted;
    - where each Google error reason lives is stated, plus `SERVICE_DISABLED`;
    - the review-record nit count is reconciled.

### Review — 2026-11-19 (rev 3)

- **Reviewer:** Agent (author pass, checklist §§2–7) + fresh-context agent (checklist §1 + consistency, given only this file)
- **Scope cohesion (§1):** **SPLIT** (fresh-context reviewer).
  - **Proposed boundaries:**
    1. Customers calendar seams (Part A), with seam `customers.calendar.item-sources.v1`;
    2. the hub plus the `communication_channels` prerequisites (Part B), with seam `calendar-provider.v1`;
    3. the Google provider plus `google-auth` (Part C).
  - The reviewer notes that B ships no user value without C, so splitting only A is a reasonable alternative.
  - **Resolution:** kept as one spec under R1; Part labels allow a verbatim split. This stays an open, non-blocking maintainer decision.
- **Consistency and contract fixes applied from the same review:**
  - **Fields and labels:** added `conference_pending` + `content_hash` link columns; `communication_channels` prerequisites relabelled as Part B (Phase 1); `google-auth` moved to Phase 7.
  - **Shared-meeting rules:**
    - primary **re-election on attach** (an organizer connecting later takes over);
    - **series attach** (instances of a CRM-owned series attach to the series interaction; no per-instance duplicates);
    - canonical **`buildInstanceKey`** so keys match byte-for-byte across providers.
  - **Credential-based providers:** `channel.connected` is emitted by the credential connect command too.
  - **Provider contract:**
    - `CalendarVersionConflictError` naming;
    - `versionScope` capability plus a hub-computed `content_hash` echo skip (CalDAV series-wide ETags);
    - in-adapter RFC 5545 expansion for CalDAV;
    - batched `parseNotification` `changes[]` with lookup by channel id or resource (Graph);
    - `fullResyncRequired` for window-bound cursors (Graph delta);
    - Graph `eventKinds` corrected (no native focus);
    - `resolvePrimaryCalendar(authCtx)` without a calendar id (CalDAV discovery).
  - **Phase 9:** test-only, with CalDAV-like and Graph-like fake profiles.
- **Security:** Passed.
  - Server-side redaction.
  - Webhook scope from the stored row, with a hashed token and a provider handshake hook.
  - Per-org identity keys.
  - Encrypted external content and meeting fields.
  - Hub validation of adapter output.
  - Adapters forbidden to log payloads.
- **Performance:**
  - **Passed:** range and keyset reads; GIN hash lookup; shared-meeting point lookup index; page budgets; batched enricher and matcher calls.
  - **Known limitation:** the matcher scan.
- **Cache:** N/A.
- **Commands:** Passed. Four hub commands with undo; irreversible effects documented.
- **Risks:** Passed. Contract narrowness, UID collision, plus all rev 2 risks.
- **Verdict:** Author pass complete. Superseded by the rev 3.1 `om-code-review` findings and fixes below.

### Review — 2026-11-19 (rev 3, first `om-code-review`)

- **Verdict:** request changes. 5 major, 7 minor, 4 nits. All addressed in rev 3.1 (see Changelog).
- **Major findings:**
  - series-attach index conflict;
  - first-import race;
  - private copy as primary;
  - colleagues promoting redacted events;
  - demotion leaving sibling links dangling.

### Review — 2026-11-19 (rev 3.1, independent `om-code-review`)

- **Verdict:** **request changes.** 3 major, 11 minor, 4 nits. **All addressed in rev 3.2** (see Changelog).
- **Major:**
  1. **Demotion undo listens for the wrong event.** Undoing `customers.interactions.delete` emits `customers.interaction.created` (`emitCrudUndoSideEffects({ action: 'created' })`), not `reverted` (verified in `customers/commands/interactions.ts`). Also, undoing a system actor's command needs `audit_logs.undo_tenant`.
  2. **Promote is both a command and a coalesced async job.** Undo capture and the response code are undefined. Coalescing (BullMQ `deduplication` + `keepLastIfActive`) can drop a manual `promote { entityId }` or a full-resync `mode` that carries intent in its payload.
  3. **The first-import race is still leaky.** Auto-created People are made before the reserve, so the race loser duplicates them. Attaching while the winner is still `promoting` can hit a not-yet-created interaction.
- **Minor:**
  - **Locking:**
    - false 409s, because sync writes bump the lock column;
    - org settings have no compare-and-set;
    - attached links' RSVP writes break the "pristine" watermark.
  - **Outbound:**
    - `event_link.update` must enqueue outbound;
    - the push default for imported links is undefined;
    - the Google scope may not cover `calendars.get` (unconfirmed).
  - **Inaccurate statements:**
    - "first user-scoped non-email channel" is false (Discord already exists);
    - the header still names the `data_sync` registry.
  - **Gaps:**
    - the manifest misses `modules.ts` / `package.json` entries;
    - reconnect needs an upsert/reactivate;
    - Gmail must keep its `gmail*CredentialsSchema` names as aliases.
- **Nits:**
  - the registration-time conference "check" can't actually be checked;
  - webhook 401 vs 404 reveals which channel ids exist;
  - demotion link selection differs for series;
  - where synthetic/collision keys are stored is unstated.

### Review — 2026-11-19 (rev 3.2, independent `om-code-review`)

- **Verdict:** request changes. 3 blockers, 6 major, 15 minor, 5 nits. All design findings addressed in rev 3.3 (see Changelog).
- **Gate:** the reviewer ran the full gate after `yarn install`. `build:packages`, `generate`, `i18n:check-sync`, `i18n:check-usage`, `typecheck`, `build:app` and `template:sync` passed. `yarn test` failed only in `create-mercato-app#test` (81/1259): agent-harness sandbox tests that timed out or were blocked by nested macOS sandboxing. That is environmental; no test reads `.ai/specs`. It must be confirmed green in CI before merge.

### Review — 2026-11-19 (rev 3.3, independent `om-code-review`)

- **Verdict:** request changes. 3 major, 12 minor, 5 nits. The only Blocker was the environmental `yarn test` failure.
- All design findings were addressed in rev 3.4 (see Changelog).
- **Gate (local, full):** `build:packages`, `generate`, `i18n:check-sync`, `i18n:check-usage`, `typecheck`, `build:app` and `template:sync` passed. `yarn test` failed only in `create-mercato-app#test` (81/1259; nested-sandbox `libllhttp` load failures in agent-harness tests; not diff-related). It must be confirmed green in CI.

### Review — 2026-11-19 (rev 3.4, verification `om-code-review`)

- **Verdict:** request changes. 2 major (both regressions introduced by rev 3.4: a CRM delete never reached the provider, and full syncs overwrote CRM edits), 4 minor, 3 nits.
- All findings were addressed in rev 3.5.
- The gate was not re-run (markdown-only diff; earlier full runs green except the environmental `create-mercato-app#test`).

### Review — 2026-11-19 (rev 3.5, delta verification `om-code-review`)

- **Verdict:** request changes. 2 major in the new delete flow (subscriber race; undo vs idempotency), 2 minor, 1 nit.
- Every rev 3.5 change was confirmed to resolve its rev 3.4 finding on the main path.
- All new findings were addressed in rev 3.6. The gate was not re-run (markdown-only diff).

### Review — 2026-11-19 (rev 3.6, delta verification `om-code-review`)

- **Verdict:** request changes. 1 major (the undo re-insert path re-attached cancelled colleague copies and collided with the series index), 4 minor, 1 nit.
- Both rev 3.5 majors were confirmed resolved. All new findings were addressed in rev 3.7 by simplifying the undo semantics.

### Review — 2026-11-19 (rev 3.7, delta verification `om-code-review`)

- **Verdict:** request changes. 2 major (the `unlinked` undo branch was unreachable because "owning" required `is_primary`; re-enable patched instead of inserting), 4 minor, 1 nit.
- The rev 3.6 Major was confirmed addressed in direction. All findings were fixed in rev 3.8.

### Review — 2026-11-19 (rev 3.8, delta verification `om-code-review`)

- **Verdict:** request changes. 2 major (undo on a non-active connection took the CRM-only branch even though the provider delete never happened; the owning-delete key matched stale ordinary `unlinked` rows), 2 minor (channel delete is undoable; the worker CAS did not fit the worker-before-handler path).
- Both rev 3.7 majors were confirmed resolved. All findings were addressed in rev 3.9.

### Review — 2026-11-19 (rev 3.9, delta verification `om-code-review`)

- **Verdict: approve.** Every rev 3.9 change resolves its finding, and no new Blocker or Major was introduced.
- 5 minor precision gaps and 3 nits on rare paths were folded into rev 3.10.
- The gate was not re-run (markdown-only diff). The earlier full runs were green except the environmental `create-mercato-app#test` failure, which must be confirmed green in CI before merge.

### Review — 2026-11-19 (PR #10009, external: `haxiorz` security scan + `pkarw` spec review)

- **Verdict:** changes requested. 4 high and 2 medium findings:
  - unbounded webhook body;
  - full-sync run-id and horizon reuse across jobs;
  - unfenced placement mutations;
  - delete delivery superseded by undo;
  - entry-point URI schemes;
  - synthetic key scope.
- All six were addressed in rev 3.11.

### Review — 2026-11-19 (rev 3.11, internal `om-code-review`)

- **Verdict:** request changes.
- **Upstream findings:** 4 of 6 were fully resolved by rev 3.11; the fencing finding and the delete-supersession finding were only partially resolved.
- **New findings:** 3 major (customers side effects firing before the hub commit under `ctx.transactionalEm`; delete handler vs restore handler race; sweep vs push during a traversal), 6 minor, 3 nits.
- All findings were addressed in rev 3.12.

### Review — 2026-11-19 (rev 3.12, internal verification `om-code-review`)

- **Verdict:** request changes. All rev 3.11 internal findings (M1–M3, m1–m6) were confirmed resolved.
- **New findings:** 1 major (optimistic-lock lost-update window and `OM_OPTIMISTIC_LOCK=off` bypass), 5 minor, nits. All addressed in rev 3.13.

### Review — 2026-11-19 (rev 3.13, internal verification `om-code-review`)

- **Verdict:** request changes. N1 and N3–N6 resolved; N2 partly.
- **New findings:** 1 major (the marker and the watermark bookkeeping ran outside the lock, so concurrent writers could produce a fake conflict, a watermark regression, or a marker lost on swap), 2 minor (lock held while awaiting a customers command could hang; incomplete writer list), 2 nits.
- All addressed in rev 3.14.

### Review — 2026-11-19 (rev 3.14, internal verification `om-code-review`)

- **Verdict:** request changes. All rev 3.14 targeted races were resolved.
- **New findings:** 1 major (own-write hash vs customers normalization), 3 minor (lock order/writer list, UID merge awaiting customers commands under the lock, `GREATEST` under clock skew), nits.
- **Pre-existing defect** flagged out of scope (a hub write absorbing a user edit).
- All addressed in rev 3.15.

### Review — 2026-11-19 (rev 3.15, internal verification `om-code-review`)

- **Verdict:** request changes. All rev 3.15 targets resolved (normalization hash, user-edit absorption, lock order, writer list, exact watermark).
- **New findings:** 1 major (back-to-back hub writes recorded as not pristine), 3 minor (swap copy, create flag, recovery flag + merge resumability/key window), 1 nit.
- All addressed in rev 3.16.

### Review — 2026-11-19 (rev 3.16, internal verification `om-code-review`)

- **Verdict: approve.** All rev 3.16 changes resolve their findings, with no new Blocker or Major.
- 3 minor and 2 nit precision items were folded into rev 3.17.

### Review — 2026-11-20 (PR #10009 re-reviews)

- **haxiorz:** **approved** `fba5ded1`. All six earlier findings confirmed fixed.
- **pkarw:** changes requested on `fba5ded1`. The six earlier findings were confirmed addressed. Two new findings:
  - high: lease not revoked on disconnect or channel deletion;
  - medium: inbound step 4 not aligned with the paginated adapter contract.
  - Both addressed in rev 3.18.

### Review — 2026-11-20 (rev 3.18, internal verification `om-code-review`)

- **Verdict:** request changes. Both pkarw findings were confirmed resolved.
- **New findings:**
  - major: channel delete + Undo left the connection soft-deleted and unable to sync;
  - narrow major: a stale worker could set `requires_reauth` on a reconnected connection;
  - minor: cleanup vs reconnect race;
  - nits.
- All addressed in rev 3.19.

### Review — 2026-11-20 (PR #10009, pkarw re-review of `b957af69`)

- **Verdict:** changes requested. Both rev 3.18 findings were confirmed addressed.
- **New finding:** 1 high (lifecycle transitions applied from stale or out-of-order channel event deliveries).
- Addressed in rev 3.20.

### Review — 2026-11-20 (rev 3.20, internal independent `om-code-review`)

- **Verdict:** request changes. pkarw's lifecycle finding was confirmed resolved.
- **New findings:**
  - major: the `channel_updated_at_seen` reconnect gate is unreliable, because a reconnect writes identical values (no `UPDATE`, `updated_at` unchanged), and unrelated writes move it;
  - 5 minor and 2 nits.
- All addressed in rev 3.21.

### Review — 2026-11-20 (rev 3.21, internal independent `om-code-review`)

- **Verdict:** request changes. The upstream lifecycle finding and every rev 3.21 change were confirmed resolved.
- **New findings:** 1 major (interrupted disconnect cleanup never resumed after the level-triggered switch), 5 minor, 3 nits.
- All addressed in rev 3.22.

### Review — 2026-11-20 (rev 3.22, internal independent `om-code-review`)

- **Verdict: approve.** The upstream lifecycle finding and every rev 3.22 change were confirmed, with no Blocker or Major.
- 7 minor and 5 nit precision items were folded into rev 3.23.

### Review — 2026-11-20 (rev 3.23–3.24, internal independent `om-code-review`)

- **Verdict: approve.** All rev 3.22 minors were confirmed resolved in the authoritative sections.
- 5 minor and 5 nit consistency items were addressed in rev 3.25.

### Review — 2026-11-20 (rev 3.25, internal independent `om-code-review`)

- **Verdict: approve.** All ten rev 3.23–3.24 items were confirmed resolved.
- 4 minor and 9 nit consistency items were addressed in rev 3.26.

### Review — 2026-11-20 (rev 3.26, internal independent `om-code-review`)

- **Verdict: approve.** 11 of 13 rev 3.25 items fully resolved and 2 partly.
- 3 minor and 5 nit items were addressed in rev 3.27.

### Review — 2026-11-20 (rev 3.27, internal independent `om-code-review`)

- **Verdict: approve.** All 8 rev 3.26 items were confirmed resolved.
- 2 minor and 4 nit items were addressed in rev 3.28. The rev 3.28 changelog lists 5 nit bullets, because one nit was split into two edits.

### Review — 2026-11-20 (rev 3.28, internal independent `om-code-review`)

- **Verdict: approve.** All rev 3.27 items were confirmed resolved.
- 3 minor and 4 nit items were addressed in rev 3.29.
