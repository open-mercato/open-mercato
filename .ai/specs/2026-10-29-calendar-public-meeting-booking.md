# CRM Calendar — public meeting booking page per user

## 📝 TLDR
**Key points:**
- A public, no-login page at **`/calendar/{orgSlug}/{userSlug}/meetings`** where an external person picks a free slot in a CRM user's calendar, enters e-mail, first name and last name, and books a meeting.
- A confirmed booking creates a scheduled `CustomerInteraction` (a meeting) owned by that user. It appears in the CRM Calendar (`/backend/calendar`, spec `2026-06-11-crm-calendar.md`). The booker receives an e-mail with an `.ics` attachment and a private manage link for cancelling or rescheduling.
- Each user opts in and configures their own booking profile: slug, slot length, weekly hours, buffers, notice, horizon, daily cap, date overrides, and whether each booking needs their approval (with an approval deadline after which requests expire).
- The feature lives in the **`customers`** module. It adds two entities plus an idempotency-key table. It also makes these additive changes to existing code: the conflicts route is refactored onto a shared busy-time helper (same contract, including its e-mail visibility filter); the CRM Calendar types move from `components/calendar/types` to `lib/calendar/types.ts` (a `@deprecated` re-export stays) and the recurrence expander gains an optional fallback-timezone parameter; the scheduler module's service gains an additive `isActive(id)` method (a second package, `packages/scheduler`); `people.create` and `interactions.cancel` gain the same `transactionalEm` support as `interactions.create`/`update`; the command bus lets a nested command join a caller-owned transaction lifetime (the existing `transactionLifetime` mechanism, generalised from atomic replay); and a `customers` upgrade action registers the maintenance schedule. One change is a **behavior change** rather than additive: the directory module's organization update gets a command interceptor that can refuse a slug change (see Risks → Migration & Backward Compatibility). No existing entity or route contract changes.

**Scope:** booking profile settings (a backend profile page), public booking page, slot engine, booking requests with an approval and expiry lifecycle, manual matching of the booker to a CRM person, `.ics` e-mails, and booker self-service cancel and reschedule.

**Out of scope:** multiple meeting types per user, team or round-robin pages, payments, custom booking questions, video-conference link generation, external calendar sync (Google/Outlook busy time), and CAPTCHA (an extension point only). The bookings module spec (`2026-08-10-bookings-module.md`, §19 `/book/{slug}`) remains the home for service and resource bookings with pricing. This spec neither depends on it nor blocks it.

## 📝 Overview
CRM users schedule meetings with prospects and customers by trading e-mails about availability. The CRM Calendar already shows every scheduled interaction, but external people cannot see when a user is free or book time with them. This spec adds a personal booking link, similar to Calendly or cal.com, that reads the same busy data the backend calendar uses, so bookings never collide with the user's CRM schedule.

> **Market reference:** **cal.com** (open-source leader) and **Calendly** (commercial canon), plus **Odoo Appointments** and **HubSpot Meetings** (CRM-native).
> **Adopted:** the "first available day" landing, a month picker with day dots plus a vertical slot list, minimum notice, horizon, buffers, a daily cap, date overrides, a "requires confirmation" mode with a request lifecycle, a booker manage link (cancel/reschedule), `.ics` with a stable UID and SEQUENCE, and display in the visitor's timezone.
> **Rejected for v1:** multiple event types per user (one booking profile per user keeps settings and URL simple; additive later), routing forms, payments, and custom questions (cal.com/Calendly carry heavy builder UIs for these). Busy time from external calendars belongs to a future integrations provider.

## 📝 Problem Statement
- External parties cannot book time with a CRM user without back-and-forth e-mail.
- Meetings agreed by e-mail are entered by hand and often miss the CRM link to a person, so CRM activity history is incomplete.
- Any booking tool outside the CRM does not see CRM-scheduled interactions, so it double-books.

## 📝 User Stories (story map)

### Epic A — Set up my booking page (CRM user)
- **US-A1** As a CRM user, I want to enable a public booking page with my own slug, so that I can share one link with external people.
  - AC: off by default. The slug is validated live (format, taken), and the full URL `/calendar/{orgSlug}/{slug}/meetings` is previewed with a copy button. Enabling without an org slug, or with an ambiguous one, shows a blocking inline error. Save uses optimistic locking; a conflict shows the conflict bar.
- **US-A2** As a CRM user, I want to set slot length, interval, weekly hours and date overrides, so that only times I actually work are offered.
  - AC: defaults are 30 min and Mon–Fri 09:00–17:00 in my timezone. Overlapping ranges are rejected inline. "Copy to all weekdays" is available. An override can be a day off or custom hours. The preview card updates to the next 5 slots after each change, with an empty state when nothing is bookable.
- **US-A3** As a CRM user, I want to set notice, horizon, buffers and a daily cap, so that bookings don't overwhelm me.
  - AC: every field shows its unit and range. Clearing the daily cap means unlimited.
- **US-A4** As a CRM user, I want to require approval with a deadline, so that I can vet requests before they reach my calendar.
  - AC: the deadline field shows only when approval is on (default 24h). Help text says that requests not answered by the deadline (or by slot start) expire automatically.
- **US-A5** As a CRM user, I want to allow bookers to cancel or reschedule up to a cutoff.
  - AC: a toggle (default on) plus a cutoff in minutes.

### Epic B — Book a meeting (external visitor, not logged in)
- **US-B1** As a visitor, I want to land on the first day with free times, so that I don't have to hunt.
  - AC: that day is preselected, days without slots are disabled, month navigation is limited to the horizon, and the slot length is visible. Times are in my timezone, with a switcher. With no availability, the empty state reads "No times available in the next N days".
- **US-B2** As a visitor, I want to pick a time from a vertical list and enter e-mail, first name and last name, so that I can book quickly.
  - AC: the selected slot shows a summary (date, start–end, timezone). All fields are required, the e-mail format is validated, and consent is required. The keyboard works end to end. Back returns to the slots with the selection kept.
- **US-B3** As a visitor, I want a clear result.
  - AC: instant booking reads "You're booked" plus "invite sent to {email}". Approval mode reads "Request sent", with the confirm-by time. "Just taken" returns me to the refreshed slots with a flash. A rate limit shows a retry message.
- **US-B4** As a booker, I want to cancel or reschedule from the e-mail link.
  - AC: the page shows the meeting summary with Cancel (confirmation dialog) and Reschedule (the same picker). After the cutoff both are disabled with an explanation. Cancelled and expired states are shown read-only.

### Epic C — Handle requests (CRM user)
- **US-C1** As a CRM user, I want to see pending requests and accept or decline them before they expire.
  - AC: a list with status tabs and an "expires in" column. Accept opens a dialog: Create new person (default) or Link existing person (a picker; persons with the same e-mail are hinted, never auto-selected). Decline takes an optional reason. A request that has already expired shows a conflict message. The empty state for each tab says why it is empty. Users without `customers.booking.manage_own` get no access.
- **US-C2** As a CRM user, I want to link a confirmed booking's auto-created person to an existing CRM person.
  - AC: a picker. On success, the toast says whether the auto-created person was removed or kept (because it holds other data).
- **US-C3** As a CRM user, I want pending requests visible in my CRM Calendar.
  - AC: a hatched "Pending request" block; clicking it opens Accept/Decline.

### Cross-cutting rules
- All times are stored in UTC, the public page shows times in the visitor's timezone, and the backend shows them in the user's timezone.
- Dialogs: `Cmd/Ctrl+Enter` submits, `Escape` cancels.
- No busy details are ever shown publicly, only free starts.

## 📝 Proposed Solution
1. **Booking profile** (`CustomerBookingProfile`): one per user per organization, edited on a new backend profile page **My meeting booking**. It is opt-in and off by default.
2. **Public page:** a chrome-less frontend page in `customers/frontend/calendar/[orgSlug]/[userSlug]/meetings/`. It loads the first day with free slots, a month calendar widget marking days with availability, the slot length, and the vertical list of start times. Picking a slot opens a form (e-mail, first name, last name). Submitting goes through the public request route.
3. **Slot engine** (`customers/lib/booking/slots.ts`): a pure function. Inputs are the profile, busy intervals and a date range; the output is the free starts. Busy intervals come from a shared server helper extracted from the existing conflicts route, so the calendar's notion of "blocked" and the booking page's notion of "busy" stay identical (see Architecture → Busy time).
4. **Booking request** (`CustomerBookingRequest`): holds the booker's details and the lifecycle `pending → confirmed | declined | expired | cancelled`. Every state change runs as a conditional update (`… WHERE id = ? AND status = 'pending' AND expires_at > now()` for accept/decline, and the matching guard for expire and cancel), so exactly one transition wins (see Architecture → State transitions).
   - Without approval, a request is created already `confirmed`.
   - With approval, it is `pending` with `expiresAt = min(createdAt + approvalDeadlineHours, startsAt)`. A pending request blocks its slot. The owner gets a notification and accepts or declines from a backend list. A scheduler job expires overdue requests.
5. **Person linking (no automatic matching):** on confirmation the system always creates a **new** CRM person (`source = 'public_booking'`) from the typed details and attaches the interaction to it. It never matches by e-mail, because a typed e-mail is a claim, not an identity. In the backend, the user can **Link to existing person**: this moves the interaction to the chosen person. The auto-created person is then **soft-deleted** (`deleted_at` set, **never** through the existing person-delete command, which hard-deletes and cascades) only when the new `countPersonDependents` helper finds nothing else attached to it (Architecture → Link to existing person). The accept dialog offers the same choice upfront. A **reschedule** keeps the booking's existing person and never creates a second one.
6. **E-mails:** shared `sendEmail` with an `EmailAttachment` holding `text/calendar` content built by a small RFC 5545 builder (`customers/lib/booking/ics.ts`). Each lifecycle step sends a fixed e-mail:

   | Event | Recipient | E-mail | `.ics` |
   |---|---|---|---|
   | Request received (approval on) | booker | "request received" | none |
   | Confirmed | booker | confirmation + manage link | `METHOD:REQUEST` |
   | Declined | booker | "declined" | none |
   | Expired | booker | "expired" | none |
   | Cancelled by the booker | owner | notification | none |
   | Cancelled by the booker | booker | cancellation | `METHOD:CANCEL` |
   | Rescheduled | booker | update | `METHOD:REQUEST`, same `UID`, `SEQUENCE + 1` |

   **E-mail safety** (there is no e-mail confirmation step, by decision):
   - booker e-mails and the `.ics` contain **no** booker-supplied text at all: no names in the greeting, subject, body, `ATTENDEE CN` or description (the attendee is the e-mail address only). So the form cannot inject content into a mail sent to an arbitrary address;
   - owner-facing e-mails and notifications may show the booker's name, as escaped plain text truncated to 100 characters;
   - `replyTo` is the owner's e-mail, so "reply to change" reaches the owner;
   - a per-profile cap of 50 outbound booking e-mails per day applies (configurable through `CUSTOMERS_BOOKING_DAILY_MAIL_CAP`); over the cap, mail is queued for the next day and the owner is notified (`cap_reached` with `cap: 'mail'`);
   - e-mails use the booker's `locale` (captured at submit from `Accept-Language`, falling back to the tenant default).

7. **Manage link:** a random 32-byte token that is shown once in the e-mail and stored as a SHA-256 hash. It opens `/calendar/{orgSlug}/{userSlug}/meetings/manage/{token}` with **Cancel** and **Reschedule** (the same slot picker, at `…/manage/{token}/reschedule`). The pages send `Referrer-Policy: no-referrer`, and the token path segment is redacted in request logs. A reschedule under approval mode creates a new `pending` request for the new time, while the old meeting stays confirmed until the decision (see Architecture → Reschedule).

### Alternatives considered
| Alternative | Why rejected |
|---|---|
| Fold into the bookings module §19 | That design is per service and per resource, with pricing and staff pools. This feature is per CRM user over CRM interactions. Coupling them would block a small feature on a large, unimplemented module. |
| New interaction status `pending` instead of a request entity | Changes a contract surface (`interactionStatusValues`, calendar rendering, every filter on status) and still needs somewhere to keep booker PII, tokens and expiry. A dedicated request entity is additive. |
| Create the person at request time | Spam requests would litter CRM with persons. Pending requests hold the details on the request row. The person is created only on confirmation. |
| Match the person by e-mail automatically | Lets anyone attach a meeting to a real customer by typing their address (impersonation). This was rejected explicitly in the Q&A. |
| Reuse `planner` availability (weekly/RRULE rules, date-specific rules, timezones) | Planner subjects are staff members and resources, not auth users, so a CRM user without a staff record would have no availability; `planner` is also an optional module, while booking lives in the always-present `customers` module. Booking needs only one weekly-hours list and a date-override map per profile, kept as two jsonb columns. If a later version wants staff-backed availability, an adapter can read planner rules into the same slot engine input. |
| User slug unique installation-wide (no org segment) | Answered: add the org slug. A per-organization user slug lets two organizations both have `/…/anna/meetings`. |

## 📝 Architecture

### Placement
All code lives in `packages/core/src/modules/customers/`:

```
data/entities.ts              + CustomerBookingProfile, CustomerBookingRequest
data/validators.ts            + bookingProfileSchema, publicBookingRequestSchema, …
lib/booking/busy.ts           findBusyIntervals(em, options): interaction busy time (see Architecture → Busy time)
lib/booking/availability.ts   loadBusyTime(em, profile, range, exclusions): interactions + request rows
lib/booking/slots.ts          computeFreeSlots(profile, busy, range, now): pure
lib/booking/ics.ts            buildIcs({ method, uid, sequence, … }): pure
lib/booking/resolveProfile.ts resolvePublicProfile(orgSlug, userSlug, host)
lib/booking/tokens.ts         manage token generate/hash
commands/bookingRequests.ts   create, confirm, decline, expire, cancel, reschedule, linkPerson
api/public/booking/[orgSlug]/[userSlug]/{route,slots,requests}/…
api/public/booking-manage/[token]/{route,cancel,reschedule}/…  (own prefix: under booking/ it would clash with an org slugged `manage`)
api/booking-profile/route.ts  GET/PUT own profile
api/booking-requests/…        list, [id] detail, counts, bulk, accept/decline/link-person/cancel
frontend/calendar/[orgSlug]/[userSlug]/meetings/page.tsx (+ manage/[token]/page.tsx)
backend/profile/meeting-booking/page.tsx   pageContext: 'profile'
backend/customers/booking-requests/page.tsx
workers/booking-maintenance.ts  expiry + anonymisation + person-delete backstop (one job)
workers/booking-person-delete-cascade.ts  delayed cascade after a person delete
workers/booking-interaction-sync.ts  interaction→request sync (enqueued by the subscriber)
workers/booking-requests-bulk.ts bulk accept/decline as a ProgressJob
lib/booking/dependents.ts     countPersonDependents(em, scope, entityId)
lib/booking/transitions.ts    conditional state updates
setup.ts                      + scheduler registration in seedDefaults (interval 5 min, soft-optional)
configs upgrade action        customers.register-booking-maintenance-schedule (existing installs)
cli.ts                        + `mercato customers booking-maintenance` (a manual run when the scheduler is absent)
events.ts, notifications.ts, acl.ts, i18n/*
```

### Busy time ("everything that blocks the backend calendar")
Today, `GET /api/customers/interactions/conflicts` defines a blocked interval for a user as follows:
- an interaction with `author_user_id` or `owner_user_id` equal to the user,
- `status` not terminal (`TERMINAL_INTERACTION_STATUS_LIST`),
- `scheduled_at` set and `deleted_at` null,
- covering `[scheduled_at, scheduled_at + coalesce(duration_minutes, 30))`.

- visible to the **caller**: the route applies `applyEmailVisibilityFilter` (the viewer's own id, conversation grants from `listGrantsForViewer` and shared channels from `listSharedChannelIds`) before selecting conflicts. `userId` may name someone other than the caller, so this filter is an access boundary: without it a viewer could probe another user's private scheduled e-mails and read their titles through the route's title lookup.

This spec **extracts** the interval query (the `WHERE` and overlap part only) into `lib/booking/busy.ts` as `findBusyIntervals(em, options)`, where `options` is a discriminated union:

```ts
type FindBusyIntervalsOptions =
  | { mode: 'legacy'; tenantId: string; userId: string | null; from: Date; to: Date;
      organizationIds?: string[]; excludeId?: string; viewer: BusyViewer; limit?: number }
  | { mode: 'calendar'; tenantId: string; userId: string; from: Date; to: Date;
      organizationIds?: string[]; excludeInteractionIds?: string[]; timezone: string }
```

The helper reads **interactions only**, returning `{ id, startsAt, endsAt, interactionType }[]` ordered by `scheduled_at` ascending (`interactionType` feeds the route's `type` field). In `legacy` mode it takes an optional `limit`, which the conflicts route passes as 10 so its SQL stays `ORDER BY scheduled_at LIMIT 10` exactly as today; the route keeps its title lookup and response shape.
- **`mode: 'legacy'`:** exactly today's predicate (author **or** owner, `organizationIds` and `excludeId` honoured) **including the e-mail visibility filter**. `viewer` is **required** in this mode (enforced by the type: `{ mode: 'legacy', viewer: { userId: string | null, sharedConversations, sharedChannelIds } }`), and the helper applies `applyEmailVisibilityFilter` with it **before** the user predicate, the ordering and the limit, exactly where the route applies it today. The route keeps resolving the viewer (`null` for API-key callers) and the grants as it does now and passes them in. The conflicts route switches to it as a pure refactor, so its behavior and access boundary do not change. Parity tests are pinned against the existing conflicts fixtures and add the access cases: another user's private scheduled e-mail is **not** returned (and its title is not leaked), a conversation share and a shared channel make it visible, and an API-key caller (`viewer.userId = null`) sees exactly what it sees today. Two more route behaviors are preserved: with `userId: null` (an API key without a bound user and no `userId` query) the author/owner predicate is **not** applied, exactly like the route's `if (checkUserId)`; and the route keeps its early `{ hasConflicts: false }` return for an empty `organizationIds` list before calling the helper. Both have parity cases. This refactor ships as its own PR (Step 2) before any booking code.
- **`mode: 'calendar'`:** used by booking only, server-side. It takes no `viewer`, because it reads the **owner's own** schedule to compute free time, and its result never leaves the booking code as ids or titles: the public API only returns free starts. So the owner's private scheduled e-mails do block availability, which is the intended meaning of "busy". It follows the CRM Calendar's own conflict rule (`lib/calendar/conflicts.ts`: **owner or participant**). It does **not** use `author_user_id`, so meetings an assistant creates for someone else do not consume the assistant's availability. On top of that:
  - **participants:** interactions whose `participants` jsonb contains `{ "userId": <user> }`;
  - **recurring series:** masters selected like the `recurrenceMasters=true` mode (start ≤ `to`, no end before `from`), expanded server-side with the existing `lib/calendar/recurrence.ts` expander. Its type imports from `components/calendar/types` move to `lib/calendar/types.ts`, with a re-export left behind. The expander currently falls back to the **process** timezone (`getDay()`/`getFullYear()`) for masters without `timezone`; busy-time expansion passes the **profile timezone** as the explicit fallback, and an added parameter keeps the client's current behavior unchanged;
  - **all-day items:** they block the whole day in the profile timezone (`lib/calendar/timezone.ts`, `date-fns-tz`; no new dependency).
- **Scope:** busy time covers **all organizations of the user within the tenant**, not just the profile's organization. A user with booking pages in two organizations, or with CRM meetings in another one, cannot be double-booked. This is a read of the owner's own records and leaks nothing across tenants.

The booking layer, `lib/booking/availability.ts` (`loadBusyTime(em, profile, range, { excludeInteractionIds?, excludeRequestIds? })`), then builds busy time as the union of:
- the user's `calendar`-mode intervals,
- `CustomerBookingRequest` rows for **any profile of the same user** with `status = 'pending'` and `expiresAt > now`,
- confirmed requests whose interaction is `done` but whose time is still in the future (calendar-mode busy skips terminal interactions, so marking a meeting completed early must not reopen its slot).

**Buffers:** a slot `[s, e)` on a profile is free only when both hold:
- its padded range `[s − bufferBefore, e + bufferAfter)` overlaps no busy interval (CRM meetings are not padded);
- the slot itself overlaps no **booking** of the same owner padded with the buffers of the profile it was booked on (confirmed requests and pending requests with `expiresAt > now`; `loadBusyTime` returns these intervals with their own `padBefore`/`padAfter`, which `computeFreeSlots` applies).

So between two bookings the gap is at least the earlier one's `bufferAfter` and the later one's `bufferBefore`, whichever is larger, whatever order they were booked in (the cal.com model, where existing bookings carry their event type's buffers). The slot list and the write gate use this one definition (`lib/booking/slots.ts`), so they cannot disagree.

### Keeping the booking in sync with the interaction
The owner can edit, reschedule, cancel or delete the created interaction from the CRM Calendar like any other. A subscriber on the interaction's existing CRUD/lifecycle events keeps the linked request (looked up via `interaction_id`) in sync:

| Owner action on the interaction | Request becomes | E-mail to booker |
|---|---|---|
| Cancelled (status `canceled`) or deleted | upcoming meetings: `cancelled`, `cancelled_by = owner`; a past meeting is left as it is (it happened) | cancellation, `METHOD:CANCEL` (upcoming only) |
| Time or duration changed | `confirmed`, with `starts_at`/`ends_at` updated and `ics_sequence + 1` | update, `METHOD:REQUEST`; none when the meeting had already ended before the edit and still has |
| Title or location changed | unchanged except the snapshots | update, `METHOD:REQUEST`, `SEQUENCE + 1`; none for a meeting that has ended |
| The person is deleted (cascade) | upcoming meetings only: `cancelled`, `cancelled_by = person_deleted`; past meetings are left as they are (they happened, and the 90-day anonymisation covers them) | cancellation, `METHOD:CANCEL` |
| Moved to another person | unchanged; `customer_entity_id` follows the interaction | none |
| Completed (status `done`, `customers.interaction.completed`) | unchanged (stays `confirmed`); `done` is the owner's record that the meeting happened | none |
| An interaction edit is undone (undo emits the CRUD `updated` event) | handled by the same snapshot diff as any edit | update if the booker-visible fields changed |

**Ended and anonymised bookings:** the subscriber skips **anonymised** rows entirely (`anonymised_at IS NOT NULL`: no snapshot write, no sequence, no e-mail), so the clean-up is never undone. For a meeting that has ended (`ends_at <= now()`, and the new time also in the past) it may update the snapshots but sends nothing and allocates no sequence.

A cancelled request is never re-opened, even if the interaction is later restored through undo. The restored interaction stays a normal CRM meeting; the owner can re-invite the booker manually. This matches the rule that ended requests are final (the slot may already be re-booked).

**Cancelling joins the booking transaction.** `interactions.cancel` currently forks its own EntityManager (`commands/interactions.ts`), unlike `interactions.create`/`update`, so it cannot be atomic with the request update. Step 13 makes it honour `ctx.transactionalEm` and `ctx.transactionLifetime` the same way in `prepare`, `execute` and `captureAfter` (`ctx.transactionalEm ?? fork()`, its effects through the deferral in Architecture → Public request write). Every booking path that cancels a meeting (owner cancel, booker cancel, undo of confirm) cancels the interaction, the request and any pending successor in one transaction.

**Pending reschedule cascade:** whenever a confirmed request is cancelled (by the booker, by the owner, by interaction cancel or delete, or by the person-delete cascade), its pending reschedule successor, if any, is set to `cancelled` (`cancelled_by = 'original_cancelled'`) **in the same transaction**, and no separate e-mail is sent for it. Such a row stays **visible** in the Meeting requests list with the badge "Cancelled: original cancelled".

**Sequence allocation:** a booking's `SEQUENCE` belongs to its `ics_uid` and is allocated, never copied. Every path that sends a `METHOD:REQUEST` or `METHOD:CANCEL` for a UID (owner-sync subscriber, booker reschedule, accept of a reschedule, cancel) does so in a transaction holding the same per-owner lock as public writes (`pg_advisory_xact_lock(hash(tenantId, userId))`) and allocates the number there with `UPDATE … SET ics_sequence = ics_sequence + 1 WHERE id = :liveRequestId RETURNING ics_sequence` on the request that currently holds the UID's interaction. The e-mail uses the returned value. So owner edits and booking actions on one UID are serialised, each one sends a strictly higher number, and no path sends a value computed earlier (RFC 5546 §2.1.4: a higher SEQUENCE supersedes a lower one).

**Detecting changes:** interaction events carry ids and status only, so the request keeps snapshot columns (`starts_at`, `ends_at`, `title_snapshot`, `location_snapshot`). On each `customers.interaction.updated` (and the other lifecycle events in the table), the subscriber only enqueues a booking-owned job, `customers:booking-interaction-sync`, keyed by `interaction_id`, and never throws, as on the person-delete path; the job does the work under the per-owner lock, uses the standard queue retries (so a lock timeout is retried) and reports with `reportError` after the last attempt. The job loads the interaction and the request through the decryption helpers (tenant and organization scope) and diffs the decrypted values against the snapshots, writing new snapshots back through the encryption service; it sends an e-mail only when something the booker sees has changed.

**Person-delete cascade:** the person-delete command removes interactions with `nativeDelete` and emits no interaction events, so a booking-owned path cancels the bookings instead. It is deliberately simple and never reads audit-log states:
- **Subscriber:** a persistent subscriber on `customers.person.deleted` only enqueues a booking-owned job, `customers:booking-person-delete-cascade`, with `{ tenantId, organizationId, entityId }` (the event's `entityId`; its `id` is the person *profile* id, `commands/people.ts`) and `delayMs` of 2 minutes, roughly the undo-toast window. It never throws for control flow, so it never makes the events worker retry the other `customers.person.deleted` subscribers (`sales`, `customer_accounts`, webhooks, workflow triggers), which all run in the same queue job.
- **Job:** in one transaction it takes the per-owner lock (`pg_advisory_xact_lock`) of **every** owner with a confirmed request for that person, in ascending lock-key order (no deadlock between two cascades), then re-checks that the person is still deleted (no live `customer_entities` row for `entityId`). If the person exists again (the delete was undone, which is the common case for an undo within the delay), it does nothing. Otherwise it cancels each **upcoming** confirmed request with that `customer_entity_id` (`ends_at > now()`, `anonymised_at IS NULL`, and its interaction no longer exists, the same predicate as the backstop, so a meeting already moved to another person is never cancelled; past and anonymised rows are never touched or e-mailed, so a GDPR erasure months later sends nothing), with `cancelled_by = 'person_deleted'` and `cancelled_at = now()`, cascades to pending successors (`original_cancelled`), and commits; the CANCEL e-mails go out after commit as usual. It uses the queue's standard retries (3 attempts, exponential backoff); a failure after the last attempt is reported with `reportError`. After commit, the job checks once more whether the person exists again; if it does (the accepted race below), it sends each affected owner `customers.booking_request.not_reinvited`, so somebody knows the bookers were told the meeting is off.
- **Backstop:** a hard delete leaves no record of when the person disappeared, so the maintenance job keeps one: on each tick, for upcoming confirmed requests whose `customer_entity_id` has no live row **and** whose interaction no longer exists (so a meeting already moved to another person, with the `customer_entity_id` sync lagging, is never cancelled), it sets `person_missing_since = now()` where it is null, and clears it where the person exists again. It cancels, the same way as the job, the requests whose `person_missing_since` is older than 10 minutes. So a tick inside the 2-minute delay only marks rows, and an undo resets the clock. That covers a lost or permanently failed cascade job and a crash in the middle of an undo.
- **Accepted risk:** an undo that commits while the job's transaction is open (after its re-check) is not blocked; the bookers then have a CANCEL for meetings that were restored. The window is the duration of one short transaction, two minutes after the delete; the cancellations stay final, consistent with "cancelled is final", the owners are notified by the job's after-commit check (best effort: a crash between the commit and that check loses the notice, and the backstop path sends none), and the restored meetings stay normal CRM meetings the owner can re-send.
Undoing a person delete restores the interactions silently (no interaction events). The booking requests stay `cancelled` and the bookers have their CANCEL; this is consistent with "cancelled is final". An `afterUndo` command interceptor on `customers.people.delete` counts the requests for that person with `cancelled_by = 'person_deleted'` and `cancelled_at` after the undone delete's log `createdAt` (so earlier booker or owner cancellations are not counted) and, when there are any, sends the undoing user an in-app notification, `customers.booking_request.not_reinvited`: "{n} booked meetings were cancelled and their bookers notified; they will not be re-invited automatically". Interceptor results have no channel for a non-blocking warning in the undo toast, so a notification is used instead; undo itself is never blocked.

**No loops:** booking commands run with `ctx.syncOrigin = 'customers.booking'`, which the interaction commands already copy into their event payloads (`commands/interactions.ts`). The subscriber ignores events with that origin. The interaction's `source` column is **not** used as a marker, because it persists and would hide later owner edits.

### Command context for public writes
Public writes follow the checkout public submit route (`checkout/api/pay/[slug]/submit/route.ts`), with one difference:
- `commandBus.execute` gets `auth: null` and `selectedOrganizationId = profile.organizationId`;
- `organizationScope: null`, exactly like checkout. Strict scope mode already accepts `null` together with `selectedOrganizationId` (`shared/lib/commands/scope.ts`);
- `syncOrigin = 'customers.booking'`.

With no auth, `normalizeAuthorUserId` leaves `author_user_id` null; `owner_user_id = profile.userId` is passed as normal input. No new actor fields are introduced: the action log shows the command with no user, and the request row records `source = 'public'`. Backend writes (accept, decline, link, cancel, bulk) run as the signed-in user, as usual.

**Undo:**
- **confirm:** undoing it cancels the interaction, sets the request to `cancelled` and **sends `METHOD:CANCEL`**. The booker was told about the meeting, so they must be told it is gone;
- **accepting a reschedule:** not undoable (the meeting moved and the booker was e-mailed the new time). The owner can move it back from the calendar, and the sync sends an update;
- **link-person:** undoing it moves the interaction back and restores the soft-deleted person;
- **decline and cancel:** not undoable, because the booker's state would flip back without a matching e-mail. The owner can still book a new meeting manually.

**Action-log PII:** the command bus stores each command's full input as `commandPayload`, and `people.create` stores a `snapshotAfter` with names. So:
- the booker's e-mail and names are passed through the request row, never through a booking command's input, and every booking command's `captureBefore`/`captureAfter` snapshot is **ids and status only** (request id, status, `interaction_id`, `customer_entity_id`, `starts_at`, `ics_sequence`), so neither the command payload nor the snapshots carry PII;
- **undoable** booking commands (`confirm`, i.e. accept, and `link-person`) keep replay **enabled**: they supply an ids-only `redoInput` (`{ requestId, expectedUpdatedAt }`) and leave `replayable` unset, so the bus still issues an undo token (`CommandLogMetadata.redoInput`; `replayable: false` would clear it). The bulk worker runs the single-item `confirm` per item, so each accepted item gets its own undo entry;
- **non-undoable** booking commands (public `create` with its inline confirm, which runs with no user to undo it, `decline`, `cancel`, and `reschedule` including accepting a reschedule) use `replayable: false`, which is the intended effect: an audit entry without an undo token or payload;
- the auto-created person's own `people.create` log entry **does** keep the name and e-mail. That is standard CRM behavior for any person record, covered by the CRM's GDPR tooling and not by this feature's anonymisation (see Data Model → Retention).

### State transitions
All transitions live in `lib/booking/transitions.ts` and run as one conditional `UPDATE … SET status = :to, updated_at = now() WHERE id = :id AND status = :from [AND expires_at > now()] RETURNING *` inside the command's transaction:

| Transition | Guard |
|---|---|
| accept, decline | `status = 'pending' AND expires_at > now()`; the API's `expectedUpdatedAt` is checked as well |
| expire | `status = 'pending' AND expires_at <= now()` |
| cancel (booker or owner) | `status IN ('pending','confirmed')` plus the caller's `expectedUpdatedAt`; also cancels a pending successor in the same transaction |
| reschedule (booker) | `status = 'confirmed'` plus the caller's `expectedUpdatedAt` |
| accept of a reschedule successor | the above, **plus** the predecessor still `confirmed` (checked under the owner lock) **and** its live interaction still current (Architecture → Reschedule → live-predecessor check); otherwise `409 original_booking_gone` and the successor is cancelled with `cancelled_by = 'original_cancelled'` |

Zero rows updated means the action lost the race: the API returns `409 request_state_changed`, and only the winner's e-mail is sent. This replaces read-then-compare locking for these rows, so accept and expiry can no longer both commit.

**Optimistic locking on every edit or delete.** The status guard alone would accept a stale `confirmed` row after the owner moved the meeting or changed the person, so every write on a request also carries the version the user viewed:
- every read that feeds an action returns the request's `updatedAt`: the backend list and detail, and the public manage `GET`;
- every action sends it back as `expectedUpdatedAt`: accept, decline, bulk items, link-person, owner cancel, and the public cancel and reschedule;
- the command checks it with `enforceCommandOptimisticLockWithGuards` (`resourceKind: 'customers.booking_request'`) on the request row, read under the per-owner lock, before the conditional transition;
- **the linked interaction is part of the version.** An ordinary CRM edit (`customers.interactions.update` from the calendar) commits the interaction first; the request row only catches up when the sync subscriber runs, which can be delayed. The request version alone would therefore still look current. So for a confirmed request:
  - reads that feed an action also return `interactionUpdatedAt` (the linked interaction's `updatedAt`), and the manage page and backend detail show the time, title and location **from the live interaction** (decrypted), not from the snapshots, so the booker sees an owner's move as soon as it commits;
  - actions on a confirmed request (owner cancel, link-person, public cancel and reschedule) send it back as `expectedInteractionUpdatedAt`. Accepting a pending reschedule successor (single or bulk) has no interaction of its own to send a version for; it locks and checks the **predecessor's** live interaction instead (Architecture → Reschedule → live-predecessor check);
  - the booking command reads the interaction with `SELECT … FOR UPDATE` in its transaction and requires `updatedAt = expectedInteractionUpdatedAt`; otherwise it returns `409` and changes nothing. The row lock waits for an in-flight CRM write to commit, so the check sees its result. Ordinary interaction commands are unchanged: the interaction row they already update is the shared version boundary, and no extra lock is needed on their side;
  - nested interaction writes then run with `request: null`, so they do not pick up the HTTP request's version header; the check above already pinned the version the user viewed;
- a stale write returns the unified `409` conflict contract. The backend shows the standard conflict dialog; the public manage page shows "This booking was changed. Reload to see the latest details" with a **Reload** button.

### Reschedule
- **Busy time for a reschedule excludes the booking being moved:** `findBusyIntervals` in `calendar` mode takes `excludeInteractionIds`; the booking layer (`lib/booking/availability.ts`, which unions the helper's intervals with the request rows) takes `excludeRequestIds`, and the daily cap ignores the request being moved. So the booker's own meeting does not block overlapping new times or use up the cap.
- **Instant mode:** under the owner lock, the new `startsAt` is validated as an offered slot (with the exclusions above). The same request row is updated (`starts_at`, `ends_at`, snapshots, and `ics_sequence` allocated as in Architecture → Sequence allocation), the **same interaction** is moved through the interaction update command (with the booking `syncOrigin`), and an update `METHOD:REQUEST` with the same UID is sent. The manage token stays the same.
- **Approval mode:** a new `pending` request is created, with `previous_request_id` pointing at the confirmed one, `source = 'reschedule'`, the same `ics_uid` and `customer_entity_id`, `ics_sequence` left at 0 (a placeholder; no number is reserved while pending), and `interaction_id` **null** until accept (so the sync lookup by `interaction_id` always finds exactly one row, the confirmed one). It holds the new slot and the old meeting stays confirmed. The old manage token **remains valid** and its page shows "Reschedule requested for {new time}, waiting for confirmation".
  - **Live-predecessor check (on accept, single and bulk):** the predecessor request's `status` lags an ordinary CRM cancel or delete of its interaction until the queued sync job runs, and the CRM commands do not take the per-owner lock. So, under the per-owner lock and **before** anything else in the acceptance transaction (before either request's status or `interaction_id` changes, the token moves, a sequence is allocated or an invitation is queued), the command reads the predecessor's interaction by `predecessor.interaction_id` with `SELECT … FOR UPDATE`, **without** the `deleted_at IS NULL` filter. The row lock waits for an in-flight CRM cancel or delete to commit, so the check sees its result. The original counts as **gone** when the predecessor is not `confirmed`, its `interaction_id` is null, the interaction row is missing (person-delete `nativeDelete`), `deleted_at` is set (`customers.interactions.delete`), or `status = 'canceled'` (`customers.interactions.cancel`); `done` is not gone (see the sync table). When the original is gone, the command commits only the successor's cancellation (`cancelled_by = 'original_cancelled'`, `cancelled_at = now()`, no e-mail of its own) and returns `409 original_booking_gone`; it does **not** move, update or revive the interaction, change the predecessor, move the token or send anything. The predecessor is left to the queued sync job (or the person-delete cascade), which cancels it and sends the booker the single `METHOD:CANCEL` when it runs; its successor cascade then finds the successor already cancelled and does nothing. This does not depend on the queue having run. The bulk worker runs this same single-item command per item, so a gone original is that item's `{ ok: false, error: 'original_booking_gone' }` and the other items continue.
  - **On accept** (guarded: the predecessor is still `confirmed` and passes the live-predecessor check above): under the per-owner lock, the sequence is allocated **at acceptance** from the live predecessor (Architecture → Sequence allocation): `predecessor.ics_sequence + 1`, read and incremented in the same locked transaction, then written to the successor. Owner edits made while the request was pending have already raised the predecessor's number, so the accept e-mail always supersedes them. The existing interaction is moved to the new time (same UID, the newly allocated SEQUENCE, update e-mail), in the same locked transaction the predecessor's `interaction_id` is **first** set to null and **then** the successor takes it, as two explicit statements (`nativeUpdate` on the predecessor, then on the successor), never a single unit-of-work flush, whose statement order the ORM does not guarantee (the unique partial index on `interaction_id` is checked per statement, so assigning first would fail), so exactly one row ever holds an interaction; the predecessor becomes `cancelled` (`cancelled_by = 'superseded'`, no CANCEL e-mail), and the token is re-pointed (`manage_token_hash` moves to the successor). Only one reschedule can be pending per booking (`409 reschedule_pending`).
  - **On decline or expiry:** the new request ends, the booker is e-mailed "your original time stays", and the old token keeps managing the original meeting.

### Link to existing person
The existing person-delete command (`commands/people.ts`) blocks only on deal links, then **hard-deletes** the person and cascades through comments, interactions, todos, tags, addresses and custom fields. It must not be used here. Instead:
- `lib/booking/dependents.ts` `countPersonDependents` counts, for the auto-created person:
  - same-module rows: interactions other than the one being moved, deal links, todo links, comments, activities, tag assignments, addresses, company links, e-mail conversation shares, custom-field values, and booking requests **outside this booking's own reschedule chain**. The chain is re-pointed to the target person in the same command, so a rescheduled booking does not pin the auto-created person;
  - cross-module references, each soft-optional (counted only when the module is enabled, through its public query surface): attachments, `sales` documents that reference the person as customer, and `customer_accounts` accounts linked to the person.
- The link command moves the interaction (`entity`) and the reschedule chain's `customer_entity_id`. When the count is zero, it soft-deletes the person and its profile through the module's CRUD side-effect helpers, running the standard soft-delete side effects (query index, search reindex and the CRUD `deleted` event) rather than a bare `deleted_at` write. The person-delete subscriber ignores events with the booking `syncOrigin`, so this does not cancel the booking just moved. Otherwise it keeps the person and returns `autoCreatedEntityKept: true`.
- Undo restores the interaction's previous person and clears `deleted_at`.

### Slot computation
For each local day `d` in the range (profile timezone):
1. Take the windows from `dateOverrides[d]` if present (an empty override means a day off), otherwise from `weeklyHours[weekday(d)]`.
2. Walk each window from its start in steps of `slotIntervalMinutes`; a slot is the range `[t, t + slotDurationMinutes)`.
3. Drop a slot that falls before `now + minNoticeMinutes`, after `today + horizonDays`, or whose padded range (slot plus buffers) overlaps busy time, or that overlaps an owner booking padded with its own profile's buffers (see Busy time).
4. When `maxBookingsPerDay` is reached (confirmed plus pending), drop the whole day.

The first-available scan goes forward in 31-day chunks up to the horizon and returns the **first free instant** (`firstAvailableAt`). The client converts it to the visitor's local date, so the preselected day is right in every timezone. The function is pure and unit-tested with fixed `now`. Timezone math uses `date-fns-tz` and `lib/calendar/timezone.ts`, which are already dependencies.

The same rules are the **write-side gate**, split in two so the API can tell the errors apart: `isOnGrid(profile, startsAt, now)` (working hours, overrides, the interval grid, notice and horizon: never offered → `422`) and `isFree(profile, busy, startsAt, { dayCount, excludeRequestIds? })` (busy time with buffers and the `maxBookingsPerDay` daily limit: offered but taken → `409`). `isOfferedSlot` is their conjunction, so `startsAt` is accepted only when it is exactly one of the computed starts.

### Public request write (race safety)
`POST …/requests`. Steps 1–2 run **before** the transaction, so a slow verification hook (for example an external CAPTCHA check) never holds a database connection. The transaction starts at step 3, and its first statement is `SET LOCAL lock_timeout` (`CUSTOMERS_BOOKING_LOCK_TIMEOUT_MS`, default 5 s; a booking-only setting, separate from the pool-wide opt-in `DB_LOCK_TIMEOUT_MS`), so every lock wait inside it is bounded. **Any** lock timeout inside a booking write (SQLSTATE 55P03; the existing `isTransientLockDbError` also matches other transient lock and connection errors, which are mapped the same way; the key row, the owner lock, the interaction `SELECT … FOR UPDATE`, or a row lock in a nested command) returns `503 booking_busy` with `Retry-After` on public routes and `409 request_state_changed` on backend routes:
1. Resolve the profile (it must be active). Apply the origin check, the fail-closed rate limiter (`503` without a limiter, `429` over a limit), `runMutationGuards` and the `customers.public-booking.verify-submission` hook.
2. Validate the payload with zod (`400`/`422` on invalid input).
3. **Idempotency:** insert a placeholder key row (`customer_booking_idempotency_keys`, `fingerprint`, `response = null`) with `ON CONFLICT (tenant_id, scope, key) DO NOTHING`. If the row already existed, a request with the same key is either finished or still in flight: the insert waits on the other transaction's row lock until it commits (bounded by the lock timeout; a timeout returns `503 booking_busy` with `Retry-After`), then this request reads the stored row and returns its stored response (same payload) or `422` (different payload); if the other request rolled back, the row is gone and this request proceeds as new. This runs before any availability check, so a retry never sees its own booking as busy.
4. Take `pg_advisory_xact_lock(hash(tenantId, userId))` to serialise writes per **owner**, so two profiles of the same user cannot race. The transaction's `lock_timeout` applies, so a burst against one owner cannot hold pooled connections indefinitely: on timeout the public routes return `503 booking_busy` (retryable, `Retry-After`) and backend routes return `409 request_state_changed`. The shared `withAdvisoryXactLock` helper is **not** used: it runs its body in its own forked transaction and forbids further forks, while the booking write must run inside the `withAtomicFlush` transaction whose lifetime the nested commands join. Every other use of the per-owner lock in this spec (sync subscriber, reschedule, accept) uses the same timeout.
5. **Offered:** `isOnGrid(profile, startsAt, now)` checks working hours, overrides, the interval grid, notice and horizon. Off-grid → `422 slot_not_offered`.
6. **Caps:** the `max_new_requests_per_day` creation cap, the per-e-mail and per-IP open-request caps, and the owner-wide pending cap. Over any → `429` (`too_many_requests_today` or `too_many_open_requests`).
7. **Free:** load busy time with an overlap query over `[startsAt − bufferBefore − 240 min, endsAt + bufferAfter + 240 min]` (240 minutes is the largest allowed buffer, so a padded booking from another profile is seen; the slots read widens its range edges the same way), and the count of bookings on the slot's profile-local day; `isFree(profile, busy, startsAt, { dayCount, excludeRequestIds? })` checks the padded slot against busy intervals and the `maxBookingsPerDay` daily limit, excluding a moved request. Busy or day full → `409 slot_taken`.
8. Insert the request.
9. If approval is off, confirm inline: create the person and the interaction through the existing commands, with `ownerUserId = profile.userId` and the outer `ctx.transactionalEm`. The support must cover **every** phase the command has that reads or writes (`execute` and `captureAfter` for `people.create`, which has no `prepare`): each uses `ctx.transactionalEm ?? fork()`. A fork inside the uncommitted outer transaction cannot see the new rows, so `people.create`'s `captureAfter` (which forks today) would return an empty snapshot; `interactions.create` already does this in `captureAfter`. (`interactions.cancel` is covered under Architecture → Keeping the booking in sync.) `interactions.create` already honours it. `people.create` does **not** today (it forks its own EntityManager), so Step 8 adds `transactionalEm` support to `people.create` as an additive change (the same pattern as `interactions.create`). Without that change there is no single transaction, and a rollback would leave an orphan person.
10. Write the response (including `ics` when confirmed) into the idempotency row, in the same transaction, so the key and the booking commit or roll back together.
11. Commit.

**A rejected request leaves no key behind.** Every refusal after step 3 (`409`, `422`, `429`, `503`) rolls the whole transaction back, which also removes the placeholder key row. A retry with the same key is therefore evaluated again from scratch, and only a successful response is ever replayed.

The response precedence is therefore: rate limit and origin, validation, idempotent replay, `422 slot_not_offered`, `429` caps, `409 slot_taken`. Other public writes use the same building blocks:
- **manage-link writes** (`cancel`, `reschedule`) resolve the request by `manage_token_hash`, not by slug, and run the rate limiter, origin check and `runMutationGuards`, but **not** the `verify-submission` hook (holding the token is the credential; the bot check guards creation). Cancel works regardless of the profile's state and of every cap; no profile state or cap can refuse it. Reschedule needs an active profile: otherwise it returns `409 booking_unavailable`, the manage `GET` returns `canReschedule: false`, and the page offers Cancel only;
- **approval-mode reschedule:** steps 1–4 (with the manage-link exceptions above), then the `cutoff_passed`, `reschedule_pending` and `expectedUpdatedAt`/`expectedInteractionUpdatedAt` checks (`409`), then steps 5–7 with the own-booking exclusions (a reschedule chain counts as **one** open booking: the moved request, and any pending successor whose predecessor is still confirmed, are left out of the per-e-mail and per-IP open-request counts, so a booker at the per-e-mail cap can reschedule each of their bookings), then insert the successor and write the idempotency response;
- **instant reschedule:** steps 1–4 (with the manage-link exceptions), the same `409` checks, steps 5 and 7 with the exclusions (no cap check, no new row), then move the request and the interaction and write the idempotency response;
- **cancel:** steps 1–4 (with the manage-link exceptions), the `cutoff_passed` and version checks, then the cancel transition (no slot or cap checks) and the idempotency response.

**Side effects run after commit.** `ctx.bulkImport` is **not** enough here: the bus only passes those flags to its queued CRUD flush (`dataEngine.flushOrmEntityChanges`), while the nested commands also emit directly. `people.create` calls `emitQueryIndexUpsertEvents` (`commands/shared.ts`, which emits `query_index.upsert_one` straight to the event bus), and `interactions.create` emits the parent `customers:customer_entity` index upsert and the `customers.next_interaction.updated` lifecycle event (`emitNextInteractionUpdatedEvent`). Each nested `execute` also flushes the CRUD queue as soon as it returns. All of that would escape before the outer transaction commits.

The framework already owns this boundary: `withAtomicFlush` begins a **transaction lifetime** (`shared/lib/commands/transaction-lifetime.ts`) and completes it with `committed` or `rolled_back` only after the real commit or rollback, and `onTransactionLifetimeComplete(em, cb)` registers work against it. The command bus already uses it for ambient atomic replay, where it defers the **entire** `runPostCommit()` phase (after-interceptors, cache invalidation and the CRUD flush). This spec reuses that mechanism instead of adding a parallel queue (Step 8, additive):
- **Bus:** `CommandBus.execute` generalises the ambient-replay branch to ordinary execution. When `ctx.transactionalEm` is inside a transaction **and** `ctx.transactionLifetime` is the token that owns it (`ownsTransactionLifetime`), the bus registers its whole `runPostCommit()` with `onTransactionLifetimeComplete` and runs it only on `committed`; on `rolled_back` it is skipped. Without an owned lifetime token (every existing caller) the bus runs `runPostCommit()` immediately, as today.
- **Direct emitters:** a shared helper `runAfterTransaction(ctx, effect)` (additive export next to the lifetime helpers) registers `effect` on the owned lifetime for `committed` only, or runs it immediately when there is none. `emitQueryIndexEvents` (upsert and delete paths, `customers/commands/shared.ts`) and `emitLifecycleEvent` (`customers/commands/interactions.ts`, which carries `customers.next_interaction.updated` and the interaction lifecycle events) go through it.
- **CRUD queue on rollback:** `emitCrudSideEffects` only marks changes on the request container's `dataEngine` queue, and with the deferral above nothing flushes that queue on rollback. **No `DataEngine` contract change** is needed: every booking write runs in its own request-scoped container (`createRequestContainer()`; public and backend routes already get one per request, and the bulk and maintenance workers create one **per item**), so the unflushed entries of a rolled-back write are dropped with their container and can never be flushed by a later write.

The booking command opens its transaction with `withAtomicFlush(em, …, { transaction: true })`, reads the token with `getTransactionLifetime(em)`, and passes `transactionalEm`, `transactionLifetime` and the booking `syncOrigin` to the nested `people.create`, `interactions.create`, `interactions.update` and `interactions.cancel`. Then:
- **on commit:** each nested command's complete tail runs exactly once: after-interceptors, cache invalidation, the CRUD flush (person and interaction `created` events and index entries), the person `customers:customer_entity` index upsert, the parent projection upsert, and `customers.next_interaction.updated`;
- **on rollback:** none of it runs, and the container is discarded.

A failing completion callback is already reported through `reportError` by `completeTransactionLifetime` (`shared.transaction_completion_callback_failed`), and a maintenance-job pass re-indexes records of `source = 'public_booking'` that are missing from the index.

Booking e-mails and notifications go out from event subscribers after commit, so a mail failure never rolls back a booking. The `Idempotency-Key` header is required on every public write (`requests`, `cancel`, `reschedule`). Keys are stored **only** in `customer_booking_idempotency_keys` (`tenant_id`, `organization_id`, `scope`, `key`, `fingerprint`, `response`, `created_at`; unique `(tenant_id, scope, key)`; purged after 24 h by the maintenance job); the request row carries no idempotency columns. The same key and payload returns the stored response; the same key with a different payload returns `422`.

### Public profile resolution and the org slug
`organizations.slug` is unique per `(tenant_id, slug)`, not globally. Resolution reuses the portal's rule (`directory/api/get/organizations/lookup.ts`): a custom-domain host binds the tenant; otherwise the lookup is unscoped. The resolver then requires **exactly one** active profile matching `(org.slug = orgSlug, profile.slug = userSlug)`. Zero or several matches return 404, and several matches are also logged as `warn`. To keep that from happening, **enabling** a profile, or changing the slug of an already-active profile, is refused with `org_slug_ambiguous` when the organization has no slug or another tenant has an organization with the same slug and an active booking profile with the same user slug.

This guard is a **deliberate, documented cross-tenant read**: it returns only a boolean, never another tenant's data, and runs under `pg_advisory_xact_lock(hash(orgSlug, userSlug))`, so concurrent enables cannot both pass.

**Org slug changes:** a command interceptor on the directory module's organization update command (`commands/interceptors.ts`, the pattern `communication_channels` uses) runs whenever the slug changes and the organization has active booking profiles:
- **`beforeExecute`** checks the **requested** slug and **refuses** the change if it would collide, returning `{ ok: false, status: 409, body: { error: 'org_slug_ambiguous_for_booking' } }` (an explicit status per the Command Interceptor HTTP Status contract, so it is not a generic 500). It cannot see the final slug: `resolveUniqueSlug` is private to `directory/commands/organizations.ts` and only runs inside `execute`, where it may append a `-N` suffix on a same-tenant collision. No directory export is added for this;
- **`afterExecute`** reads the slug actually stored. If the suffix rule changed it and the stored slug is ambiguous, it does not refuse (the update has committed); it notifies each affected profile owner that their link is unavailable. `beforeExecute` runs outside the update's transaction, so both checks are advisory. The authoritative check is at resolution time (exactly-one match, else 404 plus a `warn` log and an owner notification);
- the same guard runs on `beforeUndo` of an organization update, which would restore an old slug;
- otherwise it lets the change through and notifies each profile owner that their link changed.

Old links return 404; manage links keep working because they are keyed by token. A redirect from old slugs is out of scope.

### Cross-module boundaries
- Owner identity: `userId` is an FK id to `auth` users, with no ORM relation. The auth `User` has no avatar, active flag or timezone. The public page shows the display name (falling back to the e-mail's local part) and **initials** in the avatar. An owner counts as "active" when the user has `deleted_at IS NULL` and still has access to the profile's organization; otherwise the page returns 404.
- Organization slug: read through `directory` as the portal does.
- E-mail: `@open-mercato/shared/lib/email/send`. Notifications go through the `notifications` module's typed notifications (`customers/notifications.ts`).
- Scheduler: soft-optional, **registered in Phase 1** as one **system-scoped** schedule whose id is `stableScheduleUuid('customers:booking-maintenance')` (the scheduler's primary key is a uuid; `stableScheduleUuid` is a private helper copied per module, so the customers module copies the one in `cart/lib/scheduling.ts` rather than importing it); the worker iterates over tenants itself. Registration happens in **two** places, because `seedDefaults` runs only when a tenant is created: `setup.ts` `seedDefaults` covers new installs, and a `customers.register-booking-maintenance-schedule` upgrade action (`configs/lib/upgrade-actions.ts`, the same pattern as `cart.register-sweeper-schedules` and `promotions.register-code-reservation-sweep-schedule`) covers existing installs that upgrade into the feature. Upgrade actions run only when an admin triggers them (`POST /api/configs/upgrade-actions`, `configs.manage`, per tenant and organization), so until then the schedule can be missing: the booking settings page and the Meeting requests page show a warning when the schedule is not active.

The pages cannot read the scheduler themselves (employees have no scheduler access), so the server computes `maintenanceSchedule: 'active' | 'missing' | 'inactive' | null` and returns it from `GET /api/customers/booking-profile` and `GET /api/customers/booking-requests/counts`:
- `missing`: no schedule row. Warning: "Booking maintenance is not scheduled: expiry e-mails and the 90-day data clean-up will not run. Ask an administrator to run the pending upgrade action.";
- `inactive`: the row exists but an admin disabled or deleted it. Warning: "Booking maintenance is disabled: expiry e-mails and the 90-day data clean-up will not run. Ask an administrator to enable or restore the Booking maintenance schedule in Scheduler." The upgrade action cannot fix this: registration omits `isEnabled` (so `register` keeps an admin's choice; the cart action passes `isEnabled: true`, this one deliberately does not) and does not clear `deletedAt`;
- `active`: no warning;
- `null`: the scheduler module is absent (no warning; expiry is derived on read and anonymisation needs the CLI).

The state comes from a new additive `schedulerService.isActive(id)` (`isEnabled = true AND deletedAt IS NULL`) together with the existing `exists(id)`, which counts disabled and soft-deleted rows. A `schedulerService` override that lacks `isActive` falls back to `exists()` alone: `missing` when there is no row, otherwise `active`. Such an override cannot report a disabled schedule, so the `inactive` warning needs `isActive`; the built-in service gains it in the same step.

The upgrade action declares `requiredModules: ['scheduler']`, so it is hidden on installs without the scheduler. Like the cart and promotions actions, it declares its `version` and the i18n `messageKey`/`ctaKey`/`successKey`/`loadingKey`. Both are idempotent on the stable id. The upgrade action is listed in UPGRADE_NOTES. When `schedulerService` is not registered, expiry still works at read time (pending blocks only while `expiresAt > now`, and lists show `expired` from the derived state); the job only makes the status change and the "expired" e-mail happen. Anonymisation then needs the CLI to be run by hand.

## 📝 Data Model
Both entities are tenant- and organization-scoped, with UUID PKs, `created_at`, `updated_at` and `deleted_at`. Both support optimistic locking (`updated_at` returned from detail/list).

### `customer_booking_profiles` (`CustomerBookingProfile`)
| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid | owner (auth user id) |
| `slug` | text | `^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$`; unique `(organization_id, slug) where deleted_at is null` |
| `is_active` | bool, default false | opt-in |
| `title` | text null | page heading; defaults to "Meet with {name}" |
| `description` | text null | short intro on the public page |
| `timezone` | text | IANA; the settings form pre-fills it from the browser on first save, because users have no stored timezone |
| `slot_duration_minutes` | int | 5–480 |
| `slot_interval_minutes` | int null | step between starts; null = duration |
| `buffer_before_minutes`, `buffer_after_minutes` | int, default 0 | 0–240 |
| `min_notice_minutes` | int, default 120 | 0–43 200 |
| `horizon_days` | int, default 60 | 1–365 |
| `max_bookings_per_day` | int null | null = unlimited (meetings per day of the calendar) |
| `max_new_requests_per_day` | int, default 20 | 1–200. Cap on requests **created** for this profile in any rolling 24 h: every row created in the window counts, whatever its current status (a cancelled, declined or expired request still counts), any source. Applied regardless of client IP |
| `weekly_hours` | jsonb | `{ "1": [{"start":"09:00","end":"17:00"}], … "7": [] }`; ISO weekday; non-overlapping, sorted |
| `date_overrides` | jsonb, default `{}` | `{ "2026-12-24": [] , "2026-12-27": [{"start":"10:00","end":"12:00"}] }` |
| `requires_approval` | bool, default false | |
| `approval_deadline_hours` | int, default 24 | 1–720; used only when approval is on |
| `allow_booker_cancel` | bool, default true | |
| `booker_cancel_cutoff_minutes` | int, default 60 | cancel/reschedule closes this long before start |
| `interaction_type` | text, default `meeting` | dictionary entry key used for the created interaction |
| `location` | text null | copied to the interaction and the `.ics` `LOCATION` |

Unique `(organization_id, user_id) where deleted_at is null`: one profile per user per organization.

### `customer_booking_requests` (`CustomerBookingRequest`)
| Column | Type | Notes |
|---|---|---|
| `profile_id` | uuid | same-module FK |
| `owner_user_id` | uuid | denormalised from the profile, for list scoping |
| `starts_at`, `ends_at` | timestamptz | UTC |
| `booker_timezone`, `booker_locale` | text | for e-mails; the locale comes from `Accept-Language` |
| `source` | text | `public` \| `reschedule` |
| `title_snapshot`, `location_snapshot` | text null | what the booker was last told; used by the sync diff. **Encrypted** (map below): they copy the interaction title, which is encrypted at source and may be edited by the owner into customer-specific text, and the owner-authored location. Diffed only on decrypted values; cleared by the 90-day anonymisation |
| `email`, `first_name`, `last_name` | text | **encrypted** (map below); read only through `findWithDecryption` / `findOneWithDecryption` with tenant and organization scope |
| `email_hash` | text null | null only after anonymisation (caps and search ignore null rows); set by the booking write path itself with `hashForLookup(email)` (no context, the same call the encryption service makes for `hashField`), so it is populated **whether or not tenant encryption is enabled**: with encryption off, `encryptEntityPayload` and the ORM subscriber return the payload unchanged and would leave it empty. With encryption on, the map's `hashField` writes the identical value. Reads match with `lookupHashCandidates(email)`, so rows written before a lookup pepper was configured still match. Used for per-e-mail caps and exact e-mail search without decrypting |
| `client_ip_hash` | text null | HMAC of the resolved client IP; null when the IP cannot be determined. Used for per-IP caps |
| `consent_at`, `consent_policy_version` | timestamptz, text | proof of consent captured at submit |
| `status` | text | `pending` \| `confirmed` \| `declined` \| `expired` \| `cancelled` |
| `expires_at` | timestamptz null | pending only |
| `decided_at`, `decided_by_user_id` | null | the owner's decision (accept or decline) or expiry; never changed by a later cancellation, so the list keeps who accepted and when, and the 30-day counters use it: `accepted30d` counts rows with `decided_at` in the window, `decided_by_user_id` set and status `confirmed` or `cancelled` (an accepted reschedule successor counts as its own accept); `decided30d` adds declined rows; `expired30d` counts expiries separately, and they are not in `decided30d` |
| `cancelled_at`, `cancelled_by_user_id` | null | set by **every** cancellation (booker, owner, `person_deleted`, `superseded`, `original_cancelled`); the user id only when a user acted |
| `anonymised_at` | timestamptz null | set by the 90-day anonymisation; the single "anonymised" predicate used by the sync subscriber, the cascade and the backstop |
| `person_missing_since` | timestamptz null | set by the maintenance job when the request's person has no live row, cleared when it exists again; the person-delete backstop cancels after 10 minutes (Architecture → Person-delete cascade) |
| `decline_reason` | text null | optional, written by the owner and shown to the booker. **Encrypted** (map below): owner-authored free text can still describe the booker, as with comment and interaction bodies. Read only through the decryption helpers; cleared by the 90-day anonymisation |
| `cancelled_by` | text null | `booker` \| `owner` \| `person_deleted` \| `superseded` (the predecessor of an accepted reschedule; hidden from lists and counts) \| `original_cancelled` (a pending reschedule whose original was cancelled; visible) |
| `interaction_id` | uuid null | set on confirm; unique where not null; cleared on the predecessor when a reschedule is accepted (before the successor takes it). **No database FK** (see below) |
| `customer_entity_id` | uuid null | person the interaction is attached to. **No database FK** |
| `auto_created_entity` | bool, default false | true when the person was auto-created from this request |
| `previous_request_id` | uuid null | set on a reschedule chain. **No database FK** |
| `manage_token_hash` | text **null** | SHA-256; unique where not null. Null in Phase 1 (no tokens issued), after anonymisation, and after moving to a reschedule successor |
| `ics_uid` | text | stable `{requestRootId}@{APP_URL host}`; never derived from the request `Host` header |
| `ics_sequence` | int, default 0 | last SEQUENCE sent for `ics_uid`; only ever incremented under the per-owner lock (Architecture → Sequence allocation). 0 placeholder on a pending reschedule successor |

Indexes:
- `(profile_id, status, starts_at)`: busy lookup and daily cap.
- `(organization_id, owner_user_id, status, created_at)`: backend list.
- `(status, expires_at) where status = 'pending'`: expiry job.
- **unique** `(interaction_id) where interaction_id is not null`: enforces that one request holds an interaction, and serves the sync subscriber's lookup on every `customers.interaction.updated`.
- `(tenant_id, owner_user_id, status, starts_at)`: per-owner busy time and caps across all profiles and organizations.
- `(owner_user_id, email_hash) where email_hash is not null`: the per-e-mail cap.
- `(organization_id, email_hash) where email_hash is not null`: org-wide exact e-mail search for `customers.booking.manage` holders.
- `(starts_at) where status = 'confirmed' and anonymised_at is null`: the backstop's scan of upcoming confirmed bookings (`ends_at > now()`, plus `starts_at > now() − 480 min`, the longest slot, so the index is used); `(customer_entity_id)` for the cascade job's lookup.
- `(profile_id, created_at)`: the `max_new_requests_per_day` creation cap, counted under the per-owner lock on each write that inserts a request row.
- `(owner_user_id, client_ip_hash) where client_ip_hash is not null`: the per-IP open-request cap.

**Encryption map** (`customers/encryption.ts`, added to `defaultEncryptionMaps`):

```ts
{
  entityId: 'customers:customer_booking_request',
  fields: [
    { field: 'email', hashField: 'email_hash' },
    { field: 'first_name' },
    { field: 'last_name' },
    { field: 'decline_reason' },
    { field: 'title_snapshot' },
    { field: 'location_snapshot' },
  ],
},
```

**Provisioning:** tenant encryption maps are seeded only at tenant creation, so a new map entry never reaches existing tenants by itself, and without a persisted rule `encryptEntityPayload` would write the first booking in plaintext with `email_hash` empty. So:
- **new tenants and organizations** get the entry through the existing seeding at tenant creation;
- **existing tenants** get it from a forward-only, idempotent customers migration that runs `buildEncryptionMapBackfillSql(bookingRequestEncryptionMap)` (`shared/lib/encryption/migration-backfill.ts`), with an empty `down()` as the helper requires. It inserts the entry for every (tenant, organization) scope with active maps that lacks it, and appends missing field rules to existing rows. Scopes with encryption disabled are skipped. The migration ships in Step 1, the same release as the tables, so the map is in place before public writes exist (Step 8);
- **operator recovery only:** `yarn mercato entities seed-encryption --tenant <uuid> [--org <uuid>]` re-seeds one scope. It is not part of the upgrade path.

**Foreign keys:** only `profile_id` is a real database FK. `interaction_id`, `customer_entity_id` and `previous_request_id` are plain uuid columns, the FK-id-plus-snapshot pattern used for cross-aggregate links. The existing person-delete command hard-deletes the person and its interactions with `nativeDelete`, and every FK option would break something: `NO ACTION` makes person delete fail (a behavior change on an existing command), `SET NULL` erases the `customer_entity_id` the `customers.person.deleted` subscriber matches on (bookers never get their CANCEL), and `CASCADE` deletes the requests before the subscriber runs. Readers treat a dangling id as "gone".

Plus a small table, `customer_booking_idempotency_keys`, for public-write idempotency (see Architecture → Public request write).

**Retention and PII placement:** booker PII is kept out of every place the module does not control:
- **titles:** created interactions are titled with the profile title ("Meet with Anna"), never the booker's name; the booker is visible through the linked person;
- **events and notifications:** event payloads carry ids only; notification texts say "New meeting request for {date time}" and resolve the name only when rendered for an authorised viewer;
- **audit log:** the platform action log stores command payloads and snapshots. Booking commands therefore use ids-only inputs (a redacted `redoInput` where undo is kept, `replayable: false` where it is not) and ids-only snapshots (Architecture → Command context), so their log entries never hold the e-mail or names. The auto-created person's own creation entry does hold them (standard CRM behavior).

Declined, expired and cancelled requests, and confirmed requests whose meeting ended, are anonymised 90 days later by the maintenance job (Phase 1):
- e-mail and names are replaced with a fixed marker (written through the encryption service like any other value), and `decline_reason`, `title_snapshot` and `location_snapshot` are cleared;
- `email_hash`, `client_ip_hash` and the token hash are cleared, and `anonymised_at` is set.

**Not covered:** the person auto-created on confirmation is a normal CRM record and follows the CRM's retention and GDPR tooling, not this job.

Without the scheduler, the job can be run by hand with the CLI command `mercato customers booking-maintenance`. Confirmed requests whose meeting ended more than 90 days ago are anonymised the same way, because the person record holds the CRM copy. Interactions and persons follow the CRM's normal retention.

## 📝 API Contracts
Every handler exports `openApi`. Public routes declare `requireAuth: false`; all public writes go through commands.

### Public (no auth)
**Abuse controls** on the write routes (`requests`, `cancel`, `reschedule`):
- **Client IP:** resolved with the platform's `getClientIp`, which needs `RATE_LIMIT_TRUST_PROXY_DEPTH` set to the number of proxies in front of the app (it defaults to 0). Booking setup documents that this is **required** behind a proxy or load balancer. When the IP cannot be resolved, every **per-IP** limit below is **skipped**, never applied to a shared bucket, so visitors are never pooled into one lockout. The per-profile and per-e-mail limits still apply.
- **Rate limit** per resolved IP and per profile, through a module-local wrapper over the platform rate limiter. Unlike checkout's wrapper, which lets requests through when the limiter is not registered, the booking wrapper is **fail-closed on writes**: with no rate limiter registered, public `POST`s return `503 booking_unavailable`; reads stay available.
- **IP-independent creation cap:** checked **only** on writes that insert a request row: `POST …/requests` and an approval-mode reschedule (which creates a successor). Cancel and instant reschedule are never refused by it, so a booker can always cancel even when an attacker has exhausted the owner's quota. At most `max_new_requests_per_day` new requests per profile in any rolling 24 h (default 20), counted on `created_at` under the per-owner lock, over every row created in the window whatever its status, so a book-then-cancel loop through the manage link cannot get around it. This is the bound that holds in the **default deployment**: `RATE_LIMIT_TRUST_PROXY_DEPTH` defaults to 0, so `getClientIp` returns `null` and every per-IP control below is skipped. Without it, a script rotating e-mail addresses could fill the whole horizon in instant mode, where nothing is pending. Over the cap: `429 too_many_requests_today`, and the owner is notified once per day (`customers.booking_request.cap_reached` with `cap: 'creation'`). The trade-off is that an attacker can exhaust one owner's daily quota, but cannot fill the calendar or create unbounded persons and e-mails. The settings page shows a warning when per-IP protection is off (no trusted proxy depth configured).
- **Outstanding-request caps:**
  - at most 2 open (pending or future confirmed) requests per `email_hash` per owner; a reschedule chain (a confirmed request and its pending successor) counts once;
  - at most 3 open requests per `client_ip_hash` per owner (skipped when the IP is unknown);
  - the owner-wide pending cap `maxBookingsPerDay == null ? 10 : max(10, 2 × maxBookingsPerDay)` (10 when meetings per day are unlimited) counts at most 3 requests per `client_ip_hash`, and requests with an unknown IP count individually. So one resolved source cannot fill it, and unresolved traffic is still bounded by the cap itself.

  Over a cap, the route returns `429 too_many_open_requests`. The owner is notified when the owner-wide cap is hit (`cap_reached` with `cap: 'pending'`), so they can decline in bulk.

  A `429` rolls back the booking transaction, so `cap_reached` (creation and pending) is emitted **after the rollback**, outside that transaction; its once-per-day dedupe check runs there as well.
- **Outbound mail cap:** see Proposed Solution → E-mail safety.
- **Bot check:** a server-side verification hook, `customers.public-booking.verify-submission` (DI-overridable, default no-op), plus the client form extension point `customers.public-booking.form`, where the matching CAPTCHA widget renders. A CAPTCHA provider plugs into both in v1 without code changes here.
- **Origin check** against `CUSTOMERS_BOOKING_ALLOWED_ORIGINS`, falling back to `APP_URL`/`NEXT_PUBLIC_APP_URL`. This is CSRF hygiene only, not abuse protection, and is applied on POST only.

| Method & path | Request | Response |
|---|---|---|
| `GET /api/customers/public/booking/{orgSlug}/{userSlug}` | — | `{ ownerName, ownerInitials, organizationName, title, description, location, slotDurationMinutes, timezone, horizonEndDate, firstAvailableAt: ISO \| null, requiresApproval }`. 404 when inactive, unknown or ambiguous (same body for each). |
| `GET …/slots?from=YYYY-MM-DD&to=YYYY-MM-DD` | range ≤ 44 days (a 6-week month grid plus one day on each side for visitors in far-off timezones) | `{ days: [{ date, slots: [{ startsAt: ISO, endsAt: ISO }] }] }`; dates in the profile timezone, instants in UTC; the client renders them in the visitor's timezone |
| `POST …/requests` | header `Idempotency-Key`; body `{ startsAt: ISO, email, firstName (1–100), lastName (1–100), timezone: IANA, consent: true }` | `201 { status: 'confirmed' \| 'pending', startsAt, endsAt, expiresAt?, ics?: string }` (`ics` is only present when confirmed; it is the same file as the e-mail attachment, for the **Add to calendar** download). 409 `slot_taken`, 422 `slot_not_offered` or validation, 429 rate or caps. The manage URL is **only** e-mailed. |
| `GET /api/customers/public/booking-manage/{token}` | — | `{ status, updatedAt, interactionUpdatedAt?, startsAt, endsAt, ownerName, ownerInitials, title, bookerName, bookerEmail, canCancel, canReschedule, changeCutoffAt, pendingReschedule?: { startsAt, expiresAt }, orgSlug, userSlug }` (booker details are returned only to the token holder). 404 for an unknown token (no detail leaked). |
| `POST /api/customers/public/booking-manage/{token}/cancel` | `Idempotency-Key`, `{ expectedUpdatedAt, expectedInteractionUpdatedAt? }` (required when confirmed) | `{ status: 'cancelled' }`; 409 `cutoff_passed` or stale |
| `POST /api/customers/public/booking-manage/{token}/reschedule` | `Idempotency-Key`, `{ startsAt, expectedUpdatedAt, expectedInteractionUpdatedAt }` | `{ status: 'confirmed' \| 'pending', startsAt, endsAt }`; 422 `slot_not_offered`; 409 `slot_taken` \| `cutoff_passed` \| `reschedule_pending` or stale; 429 `too_many_requests_today` or `too_many_open_requests` (approval mode only, which creates a successor; the moved request is not counted); 409 `booking_unavailable` when the profile is no longer active |

**Mutation guards:** every write route in this spec that is not a `makeCrudRoute` (`PUT booking-profile`, `accept`, `decline`, `bulk`, `link-person`, owner `cancel`, and the public `requests`, `cancel`, `reschedule`) calls `runMutationGuards(...)` before executing its command, as `packages/core/AGENTS.md` requires.

### Backend (auth)
| Method & path | Guard | Notes |
|---|---|---|
| `GET /api/customers/booking-profile` | `customers.booking.manage_own` | own profile or defaults; `publicUrl`; `maintenanceSchedule: 'active' \| 'missing' \| 'inactive' \| null` |
| `PUT /api/customers/booking-profile` | same | upsert own profile; optimistic lock; 409 `slug_taken`, `org_slug_ambiguous` |
| `GET /api/customers/booking-requests` | `customers.booking.manage_own` (own) / `customers.booking.manage` (all in org) | `makeCrudRoute` list; filters `status`, `ownerUserId`, `from`, `to`, `q` (an **exact e-mail** match through `email_hash` with `lookupHashCandidates`). There is no name search in v1: it would need the entity indexed into `search_tokens` and the query index, which would put booker names there and require the anonymisation to purge them too. Once a booking is confirmed, the booker can be found by name through the linked CRM person; `pageSize ≤ 100` |
| `GET /api/customers/booking-requests/{id}` | same, owner-scoped like the commands | Detail: the request (decrypted booker fields), `updatedAt`, `interactionUpdatedAt` for confirmed requests, the live interaction's time, title and location, and `history`: the whole reschedule chain (`previous_request_id` links), including `superseded` rows hidden from the list. 404 for a colleague's request without `customers.booking.manage` (same body as unknown) |
| `GET /api/customers/booking-requests/counts` | same | `{ pending, pendingExpiringSoon, upcomingConfirmed, nextConfirmedAt, accepted30d, decided30d, expired30d, maintenanceSchedule }`, scoped like the list; rows with `cancelled_by = 'superseded'` are excluded |
| `POST /api/customers/booking-requests/{id}/accept` | owner or `manage` | `{ expectedUpdatedAt, person: { mode: 'create' } \| { mode: 'link', entityId } }`; 409 if no longer pending, expired, or stale; for a reschedule successor, `409 original_booking_gone` when the original request or its live interaction is cancelled or deleted (Architecture → Reschedule) |
| `POST …/{id}/decline` | same | `{ expectedUpdatedAt, reason?: string ≤ 500 }` |
| `POST /api/customers/booking-requests/bulk` | same (checked per item) | `{ action: 'accept' \| 'decline', items: [{ id, expectedUpdatedAt }] (≤ 100), reason? }`. Enqueues a **`ProgressJob`** (the `core:progress` pattern) and returns `{ ok: true, progressJobId }`; the top-bar progress shows it. The worker runs the single-item command for each item, and each item succeeds or fails on its own; results are stored on the job (`{ id, ok, error? }[]`). Bulk accept uses `person: { mode: 'create' }` for new bookings and **keeps the existing person** for `Reschedule pending` rows; those rows get the same live-predecessor check as a single accept, so a row whose original was cancelled or deleted in the CRM fails with `original_booking_gone` (Architecture → Reschedule). |
| `POST …/{id}/link-person` | same | `{ expectedUpdatedAt, expectedInteractionUpdatedAt, entityId }` on a confirmed request. Moves the interaction to the chosen person. The auto-created person is soft-deleted only when `countPersonDependents` returns zero (Architecture → Link to existing person); the person-delete command is never used. Otherwise it is kept and the response returns `autoCreatedEntityKept: true`. Undoable. |
| `POST …/{id}/cancel` | same | `{ expectedUpdatedAt, expectedInteractionUpdatedAt? }` (required when confirmed). Owner-side cancel; soft-cancels the interaction through `interactions.cancel` **inside the booking transaction** (see below), cascades to a pending successor, and sends `METHOD:CANCEL` after commit. The transition also requires `ends_at > now()`. 409 when stale, `409 meeting_ended` for a meeting that has ended (a past meeting is left as it is) |

### ACL (`acl.ts`, additive)
- `customers.booking.manage_own`: **no** dependency on `customers.interactions.manage`. It authorises only the caller's own booking profile and the requests and meetings that profile created. It is added to `defaultRoleFeatures` for `admin` (already covered by `customers.*`) and `employee`. The `employee` role does **not** gain `customers.interactions.manage`, so the existing grant boundary is unchanged.
- **Owner scope is enforced in the booking commands**, not by the feature alone: every backend booking command loads the request under the per-owner lock and requires `request.owner_user_id = auth.sub`, unless the caller has `customers.booking.manage` (then organization scope applies). Otherwise it returns 404, the same as an unknown id. The nested interaction commands are invoked only on the request's own `interaction_id`, so a booking action can never reach another interaction.
- **Effect for owners without `interactions.manage`:** they handle booking meetings through the booking actions (accept, decline, link person, cancel, from the Meeting requests page or a pending block in the calendar). Editing a booking meeting directly in the CRM Calendar still needs `customers.interactions.manage`, exactly as for any other interaction; when an owner who has it edits the meeting there, the sync subscriber informs the booker.
- `customers.booking.manage`: `admin` only (via `customers.*`).

Existing tenants pick these up with `yarn mercato auth sync-role-acls`, which is noted in UPGRADE_NOTES.

### Events (`events.ts`, additive)
`customers.booking_request.created`, `.confirmed`, `.declined`, `.expired`, `.cancelled`, `.rescheduled`, `.person_linked`. Payload: ids only (no PII).

### Notifications (additive)
To the owner:
- `customers.booking_request.pending`, with an **Open request** `href` action to the Meeting requests page with the request preselected. It has no inline Accept/Decline: notification `commandId` actions send only `{ id, …payload }` and cannot carry `expectedUpdatedAt` or the person choice,
- `customers.booking_request.confirmed` (instant booking),
- `customers.booking_request.cancelled`,
- `customers.booking_request.cap_reached`, with a `cap` field (`creation` | `pending` | `mail`) and one text per value: the daily creation cap was hit, the owner-wide pending cap was hit, or booking e-mails were queued for tomorrow by the mail cap; sent at most once per cap per day: the sender checks for an existing `cap_reached` notification for the same recipient with the same `(profileId, cap, local date in the profile timezone)` key in its payload before creating one,
- `customers.booking_profile.link_changed` (the organization slug changed).

To the acting user:
- `customers.booking_request.not_reinvited` (to the user who undid a person delete that had cancelled booked meetings).

Notification texts carry the date and time only; the booker's name is resolved at render time.

## 📝 UI/UX

### Public page `/calendar/{orgSlug}/{userSlug}/meetings`
Chrome-less: no backend menus, headers or portal nav. It uses the same `@open-mercato/ui` primitives and DS tokens as backend pages (Card, Button, Input, Calendar/day-picker, Badge, Spinner).
- **Header card:** owner initials avatar, owner name and organization name on one line, title, description, a clock icon with "{n} min", the location, and the confirmation mode ("Instant confirmation", or, when approval is on, "{first name} confirms within {deadline} h"). The timezone switcher sits under the calendar and defaults to the browser timezone.
- **Layout:** three columns: header card, then the month calendar, then the slot list.
- **Calendar and slots:** in the month calendar, available days are marked and unavailable days are disabled; prev/next month is limited to the horizon. The slot column shows the selected day's heading, then the slots stacked vertically as full-width buttons (`09:00`, `09:30`, …). Below the `lg` breakpoint (1024px) the columns stack (mobile-first). A small "Powered by Open Mercato" footer sits under the card.
- **Initial state:** the day selected is the visitor-local date of `firstAvailableAt`. With no availability at all, an empty state reads "No times available in the next {horizon} days".
- **Slot picked:** the card switches to a details step. The left column keeps the header with the chosen date, start–end time and timezone, plus a **Back** button. The right column holds the form: e-mail, first name, last name, the consent checkbox (privacy text from `content`), and **Book meeting** (or **Request meeting** when approval is on). Back returns to the slots with the selected day kept.
- **Result:** a centred card showing one of two outcomes:
  - **confirmed:** "You're booked", the invite e-mail address, a meeting summary, an **Add to calendar (.ics)** download built from the `ics` field of the response, and the change hint: Phase 1 says "Need to change it? Reply to the invite e-mail" (the reply goes to the owner), and Phase 3 says "Use the link in your e-mail to cancel or reschedule";
  - **pending:** "Request sent", {name} will confirm by {expiresAt}, an "Awaiting confirmation" badge, and a note that the time is held until then and released if not confirmed.
- **Errors:** `slot_taken` returns to the list with a flash, "That time was just taken", and refreshed slots; 429 shows "Too many attempts, try again shortly".
- **Accessibility:** the calendar has full keyboard navigation (arrow keys and Enter), each slot list is a `role="listbox"` per day, labels are tied to inputs, and form errors are announced through `aria-live`.

### Manage page `/calendar/{orgSlug}/{userSlug}/meetings/manage/{token}`
A summary card shows the owner initials avatar and name, a status badge, the meeting title, date and time, and "Booked as {name} ({email})". It has two actions:
- **Cancel meeting:** opens a confirmation dialog.
- **Reschedule:** opens the same picker with a banner showing the current time ("your current time stays booked until the new one is confirmed"), preselecting the first available day. Picking a slot splits it into [time | **Confirm**]; no form is needed because the booker's details are kept.

The page states the cutoff ("Changes are possible until {cutoff} before the meeting"). After the cutoff both actions are disabled with "This meeting can no longer be changed online — reply to the invite e-mail". When an approval-mode reschedule is refused by the daily creation cap (`429 too_many_requests_today`), the picker shows "Online rescheduling is temporarily unavailable. Your current time stays booked; reply to the invite e-mail to change it." When it is refused by an open-request cap (`429 too_many_open_requests`), the picker shows "Online rescheduling is not available right now. Your current time stays booked; reply to the invite e-mail to change it." When a reschedule is waiting for approval, the card shows "Reschedule requested for {time}, waiting for confirmation", and Reschedule is disabled. Cancelled, declined and expired bookings are shown read-only.

The reschedule picker lives at `/calendar/{orgSlug}/{userSlug}/meetings/manage/{token}/reschedule`.

### Backend: My meeting booking (`backend/profile/meeting-booking`, `pageContext: 'profile'`)
`CrudForm` sections:
- **Public page:** enable toggle; slug ("Your link name") with live validation and a "slug taken" error; a URL preview with **Copy** and **Open** buttons; title; description.
- **Meeting:** slot length, slot interval, location, interaction type (dictionary select).
- **Availability:** timezone; a weekly hours editor with a row per weekday (on/off switch, one or more ranges, add/remove range) and "Copy Monday to all weekdays"; a date overrides list (date badge plus "Day off" or custom hours, with remove and **Add override**).
- **Limits:** minimum notice, horizon, buffers before/after, max meetings per day, max new requests per day (with the per-IP protection warning when it applies). The UI shows notice in hours and stores minutes. Each field shows its unit, and its allowed range as hint text (for example "0–720 hours").
- **Approval:** requires approval toggle; approval deadline (hours, 1–720), shown only when approval is on.
- **Booker self-service:** allow cancel/reschedule; cutoff.

The side column has a preview card with the next 5 computed slots (in the profile timezone), so the user can check the configuration, and an info alert: "Your CRM meetings, calls and pending requests automatically block times. Busy details are never shown publicly."

### Backend: Meeting requests (`backend/customers/booking-requests`, Customers group, under Calendar)
- **Navigation:** a sidebar entry **Meeting requests** with a pending-count badge. The page header has **Booking settings** and **Open my booking page** buttons.
- **Counters** above the table (from `GET /api/customers/booking-requests/counts`):
  - waiting for you, flagged when one expires in under 3 h;
  - upcoming confirmed, with the next meeting;
  - accepted in the last 30 days, with the share of decided requests;
  - expired in the last 30 days.
- **List:** `DataTable` with status tabs (All, Pending, Upcoming, Past, Declined/Expired/Cancelled), search by exact e-mail, a status filter and a meeting-date filter. Sorting puts pending first (soonest deadline on top), then orders by meeting date. A request that expires while the page is open greys out with a "just expired" hint.
- **Bulk actions** (pending rows only): Accept selected (each booker becomes a new person) and Decline selected (one optional reason for all).
- **Columns:** selection (pending rows only); requested meeting (date, time, and a hint for duration, request time, "instant booking" or "moved from …"); booker (name and e-mail); status badge (Pending, Reschedule pending, Confirmed, Declined, Expired, Cancelled by booker, Cancelled by owner, Cancelled: person deleted, Cancelled: original cancelled). In the detail `history`, a `superseded` row is labelled "Moved to {new time}". A confirmed booking that came from an accepted reschedule shows **Confirmed** with the hint "Rescheduled from {old time}". Its predecessor (`cancelled_by = 'superseded'`) is **hidden** from the list, every tab and the `counts` endpoint, because the meeting only moved; it remains reachable from the successor's detail (`GET /api/customers/booking-requests/{id}`, `history`) as history; respond by or outcome (time left, flagged as an error under 3 h, an overlap hint, the decline reason, "not answered within {deadline} h" (the profile's own deadline), who accepted or cancelled and when); CRM person ("Chosen on accept" while pending, a "New from booking" badge on auto-created persons); actions. Users with `customers.booking.manage` also get an Owner column and filter.
- **Row actions:**
  - on a pending request: **Accept**, which opens a dialog with "Create new person" (default) or "Link existing person" (a person picker, with a hint listing persons whose e-mail matches, never auto-selected), and **Decline** (optional reason);
  - on a confirmed request: a row menu with **Open in calendar**, **Link to existing person** (the dialog searches people and explains whether the auto-created person will be removed; the success toast offers **Undo**) and **Cancel meeting** (upcoming meetings only; hidden once the meeting has ended);
  - on declined, expired or cancelled requests: **View details** only (they cannot be re-opened, because the booker has already been e-mailed).
- **Accept dialog:** shows the booker, the slot, the person choice and, when needed, a warning such as "Overlaps with {title} ({time}), added after this request. You can still accept." The button reads **Accept & send invite**.

Dialogs: `Cmd/Ctrl+Enter` submits, `Escape` cancels. The CRM Calendar shows pending requests for the current user as hatched "Pending request" blocks. The calendar data hook `components/calendar/useCalendarItems.ts` fetches them from `GET /api/customers/booking-requests?status=pending&from&to` next to its interactions query, only when the user has `customers.booking.manage_own`, and merges them as a separate item kind. An enricher cannot add rows, so none is used. Pending blocks are visible to the owner and to holders of `customers.booking.manage`, and show "Pending: {booker name}" (the name is resolved for the authorised viewer). Clicking a pending block opens the same Accept/Decline dialog. Confirmed bookings appear as normal meetings titled with the profile title. The calendar's existing conflict badges also cover pending blocks.

### Frontend Architecture Contract
**Server/Client Boundary Map**

| Route / surface | Server root | Client islands | Data owner | Notes |
| --- | --- | --- | --- | --- |
| `/calendar/{orgSlug}/{userSlug}/meetings` | `frontend/calendar/[orgSlug]/[userSlug]/meetings/page.tsx` (server: resolves the profile, renders the header card, 404 with no client code) | `BookingPickerClient` (month calendar + slot list), lazy `BookingDetailsFormClient`, `BookingResultClient` | public profile and slots API via `apiCall` | No page-root `"use client"`; no backend shell or providers |
| `/calendar/…/meetings/manage/{token}` (+ `/reschedule`) | `…/manage/[token]/page.tsx` (server: summary card from the manage `GET`) | `ManageBookingActionsClient` (cancel dialog, conflict reload); the reschedule page reuses `BookingPickerClient` | manage API | Token never placed in client-side logs or analytics |
| `/backend/profile/meeting-booking` | `backend/profile/meeting-booking/page.tsx` (server: metadata, translations) | `BookingProfileFormClient` (`CrudForm`), `WeeklyHoursEditor`, `SlotPreviewCard` | booking-profile API | Editors are leaves of the form |
| `/backend/customers/booking-requests` | `backend/customers/booking-requests/page.tsx` (server: metadata, translations, feature gate) | `BookingRequestsTableClient` (`DataTable`), `BookingCountersClient`, lazy `AcceptRequestDialog`, `DeclineRequestDialog`, `LinkPersonDialog` | booking-requests API | Dialogs load with `next/dynamic` |
| `/backend/calendar` (existing) | unchanged | existing `CalendarScreen`; pending blocks added in `useCalendarItems.ts`; the accept dialog reuses the lazy `AcceptRequestDialog` | booking-requests API | No new provider |

**`"use client"` Ledger**

| File | Reason | Imported by | Heavy deps? | Cleanup / hydration risk | Alternative rejected |
| --- | --- | --- | --- | --- | --- |
| `components/booking/BookingPickerClient.tsx` | selected day and month state, keyboard navigation, slot fetching, visitor timezone from the browser (`Intl`) | public page, reschedule page | none (date-fns, `date-fns-tz`, already in tree) | timezone only known on the client: dates render after mount behind a skeleton to avoid a hydration mismatch | RSC: the visitor timezone and day selection are browser state |
| `components/booking/BookingDetailsFormClient.tsx` | stateful form, submit with `Idempotency-Key`, `aria-live` errors | `BookingPickerClient` (`next/dynamic`) | none | none | server action: still needs client state for the step flow |
| `components/booking/ManageBookingActionsClient.tsx` | cancel dialog, 409 reload flow | manage page | none | none | plain form post: no confirmation dialog |
| `components/booking/BookingProfileFormClient.tsx` | `CrudForm` with live slug validation and preview | settings page | none new | debounce timer cleared on unmount | — (`CrudForm` is client) |
| `components/booking/BookingRequestsTableClient.tsx` | `DataTable`, selection, bulk actions, progress-job polling | requests page | none new | polling stopped on unmount | — (`DataTable` is client) |

Leaves (`WeeklyHoursEditor`, `SlotPreviewCard`, `BookingCountersClient`, the dialogs) are client components by inheritance; each stays at or under ~250 LOC.

**Client blob guardrail and budgets**

| Budget | Default target | Spec value |
| --- | --- | --- |
| Generated backend page-root `"use client"` | 0 new unallowlisted | 0 |
| Touched client page/root files over 300 LOC | 0 unless justified | 0 (picker, form, table and dialogs are split; `CalendarScreen` gains only a small item-kind branch) |
| Heavy browser libraries at page/provider root | 0 | 0, no new dependencies |
| Per-route hydration smoke test | required for changed interactive route | Playwright load-and-interact test per route above (Steps 6, 10, 15, 17, 18) |
| Performance evidence | static check + one runtime/build/bundle/RSS signal | `yarn check:client-boundaries` plus the `yarn build:app` first-load JS of the public route, noted in each implementation PR; target: the public page adds no backend-shell chunks |

**Provider / bootstrap scope:** none touched. The public pages render without the backend providers; no global bootstrap or registry changes.

## 📝 Edge Cases & Failure Scenarios
| Scenario | Behavior |
|---|---|
| Two visitors submit the same slot at the same time | The per-owner advisory lock plus the offered-slot recheck: the first gets 201, the second gets 409 `slot_taken` and the UI refreshes slots |
| The owner adds a CRM meeting over a pending request's time | Allowed (the backend calendar shows the conflict badge). Accepting later warns "conflicts with {title}" but may proceed |
| The approval deadline passes | Read paths treat the request as expired immediately. The job sets `expired` and e-mails the booker within ≤ 5 min; without the scheduler, status is derived on read |
| The deadline is after the slot start | `expiresAt` is capped at `startsAt` |
| The profile is disabled or the slug changed while a booking flow is open | Submit returns 404 and the page shows "This booking page is no longer available". Existing bookings and manage links keep working (keyed by token, not slug); on a disabled profile the manage page offers Cancel only |
| The owner is deleted or loses access to the organization | Profile resolution requires `deleted_at IS NULL` and organization access; the public page returns 404. Pending requests expire normally |
| A crafted request for a time that was never offered (03:17, a weekend, inside notice, past the horizon, off-grid) | `422 slot_not_offered`; nothing is written |
| Accept and expiry (or two accepts) at the same moment | The conditional update lets exactly one win; the loser gets `409 request_state_changed`, and only one e-mail is sent |
| The person is deleted while bookings point at it | The `customers.person.deleted` subscriber enqueues the delayed cascade job, which cancels the upcoming confirmed requests and e-mails the bookers unless the delete was undone first; the maintenance job is the backstop |
| E-mail send fails | The booking stays committed. The subscriber goes through the queue with retry; after the final failure it reports through `reportError` and the owner notification says "invite e-mail failed — send manually" |
| A DST transition on a slot day | Slots are generated in the profile timezone over wall-clock windows; a non-existent local time is skipped and an ambiguous one takes the first occurrence. Unit-tested for Europe/Warsaw and America/New_York |
| Visitor and profile timezones differ by a date line | The calendar widget marks days by the **visitor's** local date of each slot. The slots API returns instants, and the client groups them |
| The booker cancels after the cutoff | 409 `cutoff_passed`; the page says "reply to the invite e-mail" (the reply goes to the owner) |
| A manage token after a reschedule | Instant mode: the same token. Approval mode: the old token stays valid while the new request is pending, moves to the new request on accept, and keeps managing the original meeting on decline or expiry |
| A reschedule under approval | See Architecture → Reschedule: the existing interaction is moved on accept (same UID, higher SEQUENCE, no CANCEL), and the original stays on decline or expiry |
| A second reschedule while one is pending | `409 reschedule_pending` |
| The owner cancels or deletes the original meeting in the CRM Calendar, then accepts its pending reschedule before the sync job has run | The acceptance locks and reads the live predecessor interaction, sees it `canceled` or deleted, cancels the successor (`original_cancelled`) and returns `409 original_booking_gone`; nothing is moved or sent. The sync job later cancels the original and sends the booker one CANCEL. Same per item in bulk accept |
| Link to a person that belongs to another organization | 404 (scoped lookup) |
| An abusive volume of requests | The IP-independent `max_new_requests_per_day` creation cap (holds in every deployment), the fail-closed write rate limiter, and idempotency; per-IP limits apply only when a trusted proxy depth is set. Pending requests also count toward `maxBookingsPerDay`. A CAPTCHA plugs in through the form extension point `customers.public-booking.form` plus the `customers.public-booking.verify-submission` hook |
| Organization slug collision across tenants | Enabling is refused with `org_slug_ambiguous`; changing an org slug into a collision is refused by the directory interceptor; runtime ambiguity returns 404 |
| Mass bookings with rotating e-mails from one source | First the per-profile `max_new_requests_per_day` cap (every created row counts, so book-and-cancel loops are bounded too), then the daily outbound-mail cap; the owner is notified at the cap. The per-IP open-request cap, per-IP rate limit and IP weighting of the owner-wide cap add to this only when `RATE_LIMIT_TRUST_PROXY_DEPTH` is set |

## 📝 Risks & Impact Review
| Risk | Severity | Area | Mitigation | Residual |
|---|---|---|---|---|
| A public endpoint leaks a user's schedule | Medium | privacy | Slots expose only free starts, never busy titles or reasons; opt-in; 404s are uniform | Free/busy shape is inferable by design (same as Calendly) |
| Spam bookings fill a user's calendar | Medium | abuse | Rate limits, approval mode, daily cap, manage-token cancel, decline in bulk from the list | No CAPTCHA in v1 |
| Extracting the busy predicate changes conflict-route behavior or its access boundary | Medium | customers API, privacy | Pure refactor; `legacy` mode requires the viewer and applies the e-mail visibility filter before selection; existing conflicts tests stay green; parity tests including private e-mail, conversation share, shared channel and API-key caller | Low |
| PII in booking requests | Medium | GDPR | Encrypted columns, `findWithDecryption`, 90-day anonymisation; no PII in events, notifications, interaction titles or action-log payloads | The auto-created person follows CRM retention, not this job |
| The public form used as a mail relay | Medium | abuse | No booker free text in mails; escaped, truncated names; daily mail cap; per-IP and per-e-mail caps | No e-mail confirmation by product decision |
| A booking action reaching interactions it does not own | Medium | RBAC | `manage_own` has no `interactions.manage` dependency; commands require `owner_user_id = auth.sub` (or `booking.manage`) and touch only the request's own `interaction_id`; a regression test (Step 13) | — |
| Scheduler not installed | Low | expiry | Derived-on-read expiry; the job is only for status and e-mail; CLI for manual runs | The expiry e-mail and anonymisation need the CLI without the scheduler |
| Org slug not globally unique | Low | routing | Enable-time guard plus exact-one resolution | — |

### Migration & Backward Compatibility
Additive, with one behavior change listed in UPGRADE_NOTES. The implementation adds a dated `BACKWARD_COMPATIBILITY.md` section, "CRM Calendar Public Booking" (created by Step 2, extended by each later step that changes a contract), covering: the CommandBus deferral of `runPostCommit()` when the caller passes an owned `transactionLifetime`; the optional `transactionalEm` support in `people.create` and `interactions.cancel`; the new `runAfterTransaction` export, and the shared customers emit helpers (`emitQueryIndexUpsertEvents`, `emitQueryIndexDeleteEvents`, the interactions lifecycle emits) which defer through it **only** when the caller passes an owned lifetime and are otherwise unchanged; the CRM Calendar types moving to `lib/calendar/types.ts` with a `@deprecated` re-export at `components/calendar/types` that also re-exports its runtime values (e.g. `calendarInteractionPayloadSchema`), kept for at least one minor version and scheduled for removal no earlier than the second minor release after it ships (import paths are STABLE, BC §4); the optional fallback-timezone parameter on the `lib/calendar/recurrence.ts` expander; the new `schedulerService.isActive(id)` method (additive on a DI service; an implementation without it falls back to `exists()`); and the directory refusal with its `409` status and error code.
- **Additive:** new tables, routes, ACL features, events, notifications and a frontend route. The conflicts route keeps its contract. `people.create` and `interactions.cancel` gain optional `transactionalEm` support; the command bus defers `runPostCommit()` only when the caller passes an owned `transactionLifetime`, and the new `runAfterTransaction` helper is an additive export. Existing callers pass neither and are unaffected. No `DataEngine` interface change. The scheduler service gains the optional `isActive(id)` method (`packages/scheduler`). No change to `CustomerInteraction` or its statuses.
- **Behavior change (directory):** the organization update command can now be **refused** (`org_slug_ambiguous_for_booking`), but only when the new slug would make an active booking page ambiguous across tenants. Organizations without active booking profiles are unaffected. Per BACKWARD_COMPATIBILITY.md this is a new failure mode on an existing command, so it is documented with the error code and the workaround (disable the colliding booking profile first).
- **RBAC:** the default `employee` role gains only the new `customers.booking.manage_own`; no existing grant changes.

**Rollback:** the preferred rollback is to disable profiles. Data stays, public pages return 404, and the CRM interactions already created remain normal meetings. Reverting the code is possible as well. The migration `down` drops the three booking tables (profiles, requests, idempotency keys) and **loses all booking history**, including the link from interactions back to their requests, so it is a last resort only. The encryption-map backfill migration is forward-only (empty `down()`), so the booking-request map rows stay in `encryption_maps`; they are inert without the table.

## 📋 Phasing
- **Phase 1: Instant booking (MVP).** Profile settings page, public page, slot engine with the write-side offered-slot gate, busy-time extraction, confirmed bookings with an auto-created person (in one real transaction), `.ics` confirmation e-mail, interaction→request sync (owner changes inform the booker, plus the person-delete cascade), abuse controls shipped **together with** the public write (Step 8), the mail cap, the idempotency table, the org-slug interceptor, and the maintenance job **with its system-scoped schedule and CLI**. Ships on its own: no manage tokens are issued (`manage_token_hash` null), and e-mails say "reply to this e-mail to change the meeting" (`replyTo` = owner).
- **Phase 2: Approval and matching.** `requiresApproval`, the pending lifecycle with conditional transitions, expiry added to the existing maintenance job, owner notifications, the Meeting requests list (counts, bulk as a ProgressJob), accept/decline, Link to existing person with `countPersonDependents`, pending blocks in the CRM Calendar.
- **Phase 3: Booker self-service.** Manage tokens and the manage page, booker cancel, and reschedule (instant and approval semantics, token re-pointing), with `METHOD:CANCEL` and SEQUENCE updates.

## 📋 Implementation Plan

### Phase 1
1. **Entities, validators, migration:** both entities (all columns, so later phases need no migration), zod schemas, `yarn db:generate`, the `customers/encryption.ts` map entry, and the forward-only encryption-map backfill migration (`buildEncryptionMapBackfillSql`, empty `down()`); unit tests for the validators (slug, weekly hours overlap); a migration test: an existing encryption-enabled tenant that receives only the normal upgrade migrations has the booking-request map afterwards, and running the migration twice changes nothing.
2. **Busy-time extraction (separate PR):** `lib/booking/busy.ts` with `legacy` (viewer required, e-mail visibility filter applied before selection, optional `limit` so the conflicts query stays `LIMIT 10` in SQL) and `calendar` modes; the conflicts route moves to `legacy`. The CRM Calendar types move from `components/calendar/types` to `lib/calendar/types.ts` with a `@deprecated` re-export, and the `lib/calendar/recurrence.ts` expander gains the optional fallback-timezone parameter; this step adds its own `BACKWARD_COMPATIBILITY.md`/UPGRADE_NOTES entry for both, with a unit test that `expandOccurrences` without the parameter returns exactly today's output and a type test that the old import path still resolves. Parity tests against existing conflicts fixtures, plus access parity: another user's private scheduled e-mail is neither returned nor title-leaked, a conversation share and a shared channel make it visible, an API-key caller is unchanged, an API key without `userId` gets no author/owner predicate, an empty `organizationIds` returns no conflicts, and each conflict's `type` field and the `scheduled_at` ordering match today's response; `calendar`-mode tests for participants, recurring, all-day and multi-org.
3. **Slot engine:** `lib/booking/slots.ts` with unit tests (overrides, buffers, notice, horizon, daily cap, DST, first-available scan).
4. **ICS builder:** `lib/booking/ics.ts` with snapshot tests (REQUEST/CANCEL, escaping, UTC times, UID/SEQUENCE).
5. **ACL plus the profile API:** `customers.booking.manage_own` (no `interactions.manage` dependency; added to `admin` and `employee`), `GET`/`PUT /api/customers/booking-profile` (slug and org-slug guards, optimistic lock); integration test.
6. **Profile settings page:** backend profile page with `CrudForm` and the preview card; i18n; integration test (enable, slug conflict, preview).
7. **Public read API:** profile resolution, profile and slots routes, rate limit, origin check; integration tests (inactive → 404, range > 44 → 400, `firstAvailableAt` lands on the right visitor-local day for UTC−10 and UTC+13, busy interaction hides slot, a profile under an organization slugged `manage` resolves normally).
8. **Public request command plus API, with abuse controls:** checkout-style command context (`organizationScope: null` + `selectedOrganizationId`, `syncOrigin`, `replayable: false` with ids-only input and ids-only snapshots), `people.create` `transactionalEm` support in `execute` and `captureAfter`, nested execution on the caller-owned transaction lifetime (bus defers the whole `runPostCommit()`, `runAfterTransaction` for `emitQueryIndexEvents` and the interactions `emitLifecycleEvent`, one request container per write), client-IP resolution, fail-closed rate limit, the `max_new_requests_per_day` creation cap and the per-e-mail/per-IP/owner caps (with the unknown-IP skip, checked in step 6 with the stated precedence), the verification hook, owner advisory lock, `isOnGrid`/`isFree` gates in the stated order, idempotency table, confirm inline (person plus interaction titled with the profile title); integration tests (double submit → one booking, `slot_taken`, 429 caps, unknown-IP requests not pooled into one bucket, 503 with no rate limiter, a forced rollback after interaction creation leaves no person and no interaction, and spies on `eventBus.emitEvent`, the data-engine flush, a test after-interceptor on `customers.interactions.create` and cache invalidation observe **none** of them; a successful booking runs each of the person `created` event, the person index upsert, the interaction `created` event, the parent projection upsert, `customers.next_interaction.updated`, the after-interceptor and cache invalidation **exactly once, after commit**; a bulk job with a rolled-back item followed by a committed item emits only the committed item's effects; unit tests show the bus and emit helpers behave unchanged without an owned lifetime; the nested `people.create` action-log entry has a non-empty `snapshotAfter`; with `RATE_LIMIT_TRUST_PROXY_DEPTH` unset, bookings from N rotating e-mails stop at `max_new_requests_per_day` with 429 and one `cap_reached` notification with `cap: 'creation'`; `runMutationGuards` is invoked on each public write; a lock timeout returns `503 booking_busy`, on the owner lock, on a same-key request waiting for the first one's key row, and on a public cancel waiting on the interaction row lock; a slow verification hook holds no database connection; a request refused with 409, 422 or 429 leaves no key row, and a retry with the same key and payload after the slot frees up books normally; the owner-wide pending cap with `maxBookingsPerDay = null` is 10; a replay of a successful request with the same `Idempotency-Key` after the slot became busy returns the stored `201`, not `409`; a request both over a `429` cap and on a busy slot returns `429`; two concurrent requests with the same `Idempotency-Key` and payload produce one booking and both return the same `201` (neither `409` nor `500`); with `bufferBefore = 0` and `bufferAfter = 30` and a CRM meeting at 10:00–10:30, the 09:30 slot is neither listed nor bookable (409) and the 10:30 slot is both; with the same buffers, a booking at 09:00–09:30 makes 09:30 unbookable, and a booking at 09:30 makes 09:00 unbookable (both orders return 409 and neither slot is listed); a 23:30 slot with `bufferAfter` that collides with a meeting at 00:10 the next profile-local day returns `409 slot_taken`; off-grid/after-hours/inside-notice/past-horizon → 422 `slot_not_offered`, daily cap, idempotent replay, mismatched replay → 422, interaction visible in `/api/customers/interactions`, no booker name in the interaction title or action log).
9. **Confirmation e-mail subscriber:** `.ics` attachment with queue retry, `replyTo` = owner, booker locale, escaped and truncated names; unit test with a mocked `sendEmail`.
10. **Public page UI:** chrome-less frontend page; Playwright test (lands on first available day, picks a slot, books, sees success).
11. **Interaction→request sync subscribers:** snapshot diff and the person-delete cascade; integration tests (the person-delete subscriber only enqueues the delayed job and never throws, so the other `customers.person.deleted` subscribers run once; a delete followed by an undo within the delay cancels nothing and sends no e-mail; a delete not undone cancels the bookings after the delay and the bookers get a CANCEL; the job re-checks the person inside its transaction; a person with bookings from two owners is cascaded under both locks taken in key order; a person deleted with one past and one upcoming booking (and one anonymised row) → only the upcoming one is cancelled and e-mailed; an undo that lands during the job's transaction → the owners get `not_reinvited`; the owner deletes or cancels a past booked meeting → the request is left `confirmed` and no e-mail is sent; a title edit on an anonymised row leaves `title_snapshot` null and sends nothing; a time edit on an ended meeting sends nothing; cancellations set `cancelled_at` and leave `decided_at`/`decided_by_user_id` of an accepted request unchanged; the cascade job and the backstop both leave a booking whose interaction was moved to another person alone; an owner-lock timeout in the sync subscriber is retried by its job and the update e-mail is still sent once, without re-running other `customers.interaction.updated` subscribers; owner cancels → request cancelled and CANCEL sent; owner moves the time → SEQUENCE+1 update; two concurrent owner edits send two distinct, increasing SEQUENCE values; a title change → update; an unrelated field change → no mail; events with the booking `syncOrigin` ignored; the owner moves the interaction to another person → `customer_entity_id` follows; a person delete followed by undo → requests stay cancelled, no re-invite, and the undoing user gets one `customers.booking_request.not_reinvited` notification whose count excludes a request the booker had cancelled before the delete (one earlier cancellation plus one cascaded → n = 1); a booking-linked person-delete cascade also cancels the pending reschedule successor; deleting a person with a booked meeting succeeds with no FK error and the booker gets a CANCEL; `interactions.complete` on a booked meeting leaves the request `confirmed`, sends no e-mail, and keeps a future slot busy; undoing an owner's interaction edit sends an update with the restored time).
12. **Mail cap plus maintenance job:** the daily outbound mail cap (queue tests, and the `cap_reached` notification with `cap: 'mail'` and its text); a test on an existing encryption-enabled tenant upgraded only through migrations: its first booking stores ciphertext e-mail and names and the expected `email_hash`, and a declined request stores its `decline_reason` as ciphertext (raw-row reads); after an owner title edit, the interaction title and the request's `title_snapshot` are both ciphertext while authorised reads, the sync diff and the update invitation still work; anonymisation clears both snapshots; with `TENANT_DATA_ENCRYPTION=no`, two open bookings for the same normalised e-mail (distinct idempotency keys, unknown or different IPs) succeed with `email_hash` populated, the third returns `429 too_many_open_requests`, and exact e-mail search finds both; the maintenance worker (anonymisation including ended confirmed requests, `decline_reason` and `client_ip_hash`, plus idempotency-key purge; one request container per item) with one system-scoped schedule and the manual CLI; a test reads the anonymised rows and finds no PII; the `customers.register-booking-maintenance-schedule` upgrade action (tests: before the action runs on an upgraded install, `maintenanceSchedule` is `missing` and the settings page shows the missing-schedule warning; without the scheduler module it is `null`, the action is hidden and no warning shows; with the schedule disabled or soft-deleted by an admin it is `inactive`, the warning points to Scheduler, and running the upgrade action does not re-enable it; with a `schedulerService` lacking `isActive` the flag is `missing` without a row and `active` with one; running it through the upgrade-actions service creates the schedule and removes the warning; running it twice leaves one); anonymising a row succeeds and leaves `email_hash` null; the person-delete backstop: a tick inside the cascade's 2-minute delay only sets `person_missing_since` and cancels nothing, a restored person clears it, and a tick more than 10 minutes after the marker cancels the upcoming request (past requests are never marked or cancelled); the org-slug interceptor (`beforeExecute` refuses a colliding requested slug with 409 and the error body; `afterExecute` notifies owners when the suffix rule produced an ambiguous slug; guards undo); tests for it.

### Phase 2
13. **Approval lifecycle commands:** pending create, accept (create/link person), decline and owner cancel via the conditional transitions, with `expectedUpdatedAt` enforced by `enforceCommandOptimisticLockWithGuards`; `interactions.cancel` gains `transactionalEm`/`transactionLifetime` support in `prepare`, `execute` and `captureAfter`; owner scope enforced in the commands; events and notifications (no names in texts); accept keeps undo (ids-only `redoInput`, replay enabled, ids-only snapshots); integration tests, including a concurrent accept-vs-expire run where only one wins and one e-mail is sent, and accept → undo: the response carries a usable undo token, undo cancels the interaction and the request and sends exactly one `METHOD:CANCEL`, and the booking command's action-log entry (payload and snapshots) contains no booker e-mail or name; a forced failure after the interaction is cancelled rolls back the interaction, the request and the successor together and emits nothing; stale owner cancel → 409; owner cancel of an ended meeting → `409 meeting_ended`, the interaction and request unchanged, no e-mail; the cancel's action-log `snapshotAfter` inside the booking transaction shows `canceled`; an employee with only `manage_own` can accept and cancel their own booking but gets 403 on `PUT`/cancel of a colleague's ordinary interaction and 404 on a colleague's booking request.
14. **Expiry in the maintenance job:** derived-on-read expiry; tests (pending past deadline frees slot, job sets `expired` and sends the e-mail, a job racing an accept loses cleanly).
15. **Meeting requests backend page:** `DataTable` with the All/status tabs (reschedule predecessors hidden from the list, tabs and `counts`; tests for the `Rescheduled from` hint, the `Cancelled: person deleted` badge, a cascade-cancelled reschedule successor staying visible as `Cancelled: original cancelled` while a `superseded` predecessor is hidden from the list, tabs and `counts`, and the detail route returning the hidden predecessor in `history` and 404 for a colleague without `booking.manage`), counters (`counts` endpoint), the sidebar pending badge, bulk accept/decline (`bulk` endpoint as a ProgressJob), and the accept/decline/link dialogs; integration tests for `counts` and `bulk` (mixed success, stale `expectedUpdatedAt`, reschedule rows keep their person, job progress), and a Playwright test.
16. **Link to existing person:** `countPersonDependents` plus the command and API; soft-delete only (the person-delete command is never called); undo restores the person; integration tests for both branches, including a person with a colleague's comment (kept) and an untouched one (soft-deleted).
17. **Pending blocks in the CRM Calendar:** the pending-request fetch in `components/calendar/useCalendarItems.ts` (next to the interactions query, gated on `customers.booking.manage_own`), rendering as a separate item kind in `CalendarScreen`; Playwright check.

### Phase 3
18. **Manage token API plus page:** token issue on confirm, `Referrer-Policy: no-referrer`, log redaction, booker cancel with cutoff and `expectedUpdatedAt`, resolved by token without the active-profile check or the verify hook; integration and Playwright tests, including a cancel after the owner disabled the profile (succeeds), a cancel replayed with the same `Idempotency-Key` (same response, one CANCEL e-mail), a stale cancel after the owner moved the meeting (409, reload shows the new time); a deterministic delayed-sync test: the sync subscriber is paused, the owner moves the meeting through the ordinary interaction update, and a cancel with the previously viewed versions returns 409 and leaves the moved meeting intact **before** the event queue is drained; the manage page already shows the new time at that point.
19. **Reschedule:** instant (same row, same interaction moved) and approval (successor request, token re-pointing on accept, original kept on decline or expiry, `reschedule_pending`); offered-slot gate with the own-booking exclusion (a new time overlapping the current one is offered, and the daily cap ignores the moved booking); the successor has a null `interaction_id` and no reserved sequence; SEQUENCE allocated at acceptance from the live predecessor under the per-owner lock (test: pending reschedule → two owner edits, also run concurrently with the accept → the accept e-mail's SEQUENCE is higher than every edit's); reschedule × cancel cascade (booker or owner cancels the original → the successor is cancelled; accepting a successor whose original is gone → `409 original_booking_gone`); deterministic paused-sync acceptance cases, with the `customers:booking-interaction-sync` queue paused and assertions made **before** it is drained, each run for a single accept and for a bulk accept that also carries one valid pending row: (a) the original's interaction is cancelled through ordinary `customers.interactions.cancel`, and (b) it is deleted through ordinary `customers.interactions.delete`; then the successor is accepted → `409 original_booking_gone` (in bulk, that item's result is `original_booking_gone` and the valid row is accepted), the successor is `cancelled` with `original_cancelled`, the interaction keeps its `canceled` status or `deleted_at` and its original time, the predecessor keeps its `interaction_id` and the manage token, neither request's `ics_sequence` changes, and no e-mail job is enqueued; after the queue is drained, the predecessor is `cancelled`, the booker gets exactly one `METHOD:CANCEL`, and the successor is unchanged; (c) the same with a CRM cancel started in a transaction that commits while the accept waits on the interaction row lock → the accept sees `canceled` and behaves as in (a); accepting a reschedule is not undoable; a stale reschedule after the owner moved the meeting → 409 with the reload flow, including the same paused-subscriber case as Step 18; accepting a reschedule commits without a unique-index violation (predecessor cleared before the successor is assigned); after an accepted reschedule, an owner move and then an owner cancel update the successor row only (the predecessor's `interaction_id` is null), allocate a strictly higher SEQUENCE and send exactly one CANCEL; a book-then-cancel loop through the manage link stops at `max_new_requests_per_day` with 429; an instant reschedule replayed with the same `Idempotency-Key` returns the stored response and moves the meeting once; a reschedule on a disabled profile → `409 booking_unavailable`; a booker with two open bookings (the per-e-mail cap) can make approval-mode reschedules of **both**, one after the other; the `too_many_open_requests` copy on the reschedule page; with the profile at the cap, a booker's cancel and instant reschedule still succeed, while an approval-mode reschedule returns 429, creates no successor and leaves the original confirmed; integration and Playwright tests.
20. **Manage-link e-mails:** the manage link added to confirmation and update e-mails; Phase 1's "reply to change" copy replaced; tests.

Every UI step (6, 10, 15, 17, 18, 19) runs `yarn check:client-boundaries` and records the route's hydration test and first-load JS in its PR (UI/UX → Frontend Architecture Contract).

### Integration coverage (must ship with the phases above)
- **API paths:** `booking-profile` GET/PUT; public profile, slots, requests; manage GET, cancel, reschedule; `booking-requests` list, detail (`{id}`), counts, bulk, accept, decline, link-person, cancel.
- **UI paths:** profile settings page; public page booking flow (pick → details → booked/request sent); Meeting requests list: accept/decline per row, bulk, link person; CRM Calendar pending block; manage page cancel/reschedule.

## 📋 Final Compliance Report
- Tenant and organization scoping on every query; the public resolver derives the organization from the slug pair, never from the request body.
- No cross-module ORM relations (`userId` and the org are FK ids only).
- Booker e-mail and names, the decline reason and the title and location snapshots are declared in `customers/encryption.ts` (`email` → `email_hash`), provisioned for existing tenants by a backfill migration, and read only through the decryption helpers.
- All writes go through commands; backend forms use `CrudForm` or `useGuardedMutation`.
- Optimistic locking on the profile (`CrudForm`), plus conditional state transitions with `expectedUpdatedAt` on every request write (accept, decline, bulk, link-person, owner cancel, public cancel and reschedule), enforced with `enforceCommandOptimisticLockWithGuards`.
- Long-running bulk work runs as a `ProgressJob`.
- No PII in events, notifications, interaction titles or action-log payloads.
- No hard-coded strings; DS tokens only.
- Every custom write route runs `runMutationGuards`.
- Contract changes: additive except the documented directory refusal. Each step that changes a contract adds its own part of the dated `BACKWARD_COMPATIBILITY.md` section in the same PR: Step 2 (calendar types move, expander parameter), Step 8 (bus lifetime deferral, `people.create` support, `runAfterTransaction`, emit-helper timing), Step 12 (directory refusal, and the additive `schedulerService.isActive` method in the scheduler module), Step 13 (`interactions.cancel` support).

## Changelog
- 2026-10-29: Initial spec. Open Questions Q1–Q11 resolved with the requester (separate feature in customers; configurable hours; busy time = the calendar's blocking predicate plus pending requests; no automatic person matching, manual linking instead; configurable approval deadline with expiry; booker cancel/reschedule link; fully configurable limits; visitor-timezone display; org slug in the route; opt-in; checkout-style abuse protection; prototypes for the public page and backend settings).
- 2026-10-29: Added the user story map (Epics A–C). Applied the independent architectural review:
  - busy-time `legacy`/`calendar` modes, with participants and multi-organization scope;
  - interaction→request sync;
  - per-owner advisory lock;
  - abuse caps and a verification hook;
  - a system-actor command context and undo semantics;
  - a person-delete dependency check for link-person;
  - consent columns and `email_hash`;
  - `expectedUpdatedAt` on accept, decline and link-person;
  - PII anonymisation and owner-side sync moved into Phase 1;
  - token reissue on reschedule;
  - `ics_uid` derived from `APP_URL`.

  Prototype: `.ai/prototypes/calendar-meeting-booking/` (backoffice and public screens in one journey).
- 2026-10-29: Aligned the spec with the combined prototype `.ai/prototypes/calendar-meeting-booking/` (screens 1–12):
  - public header content, details step, result cards with the `.ics` download, manage page contents and the reschedule split-confirm;
  - settings page details (URL Open button, "Copy Monday to all weekdays", overrides list, info alert);
  - the Meeting requests page (name, counters plus the `counts` endpoint, columns, sorting, row menus, bulk endpoint, sidebar badge, accept-dialog overlap warning);
  - pending blocks in the CRM Calendar;
  - public API fields (`organizationName`, `location`, `ics`, booker details and `changeCutoffAt` on manage).
- 2026-10-29: Decision: no e-mail confirmation step. A request holds its slot on submit. Abuse is limited by rate limits, outstanding-request caps, approval mode and the verification hook.
- 2026-10-29: Applied the second adversarial review (all findings).
  - **Critical:**
    - a write-side `isOfferedSlot` gate (`422 slot_not_offered`);
    - a dedicated `countPersonDependents` with soft-delete, replacing the non-existent person-delete check.
  - **High:**
    - a checkout-style command context instead of the invented actor fields;
    - a `syncOrigin`-based loop guard;
    - conditional state transitions;
    - reschedule token semantics;
    - mail-relay and cap hardening.
  - **Medium:**
    - busy-helper signature parity; calendar mode as owner or participant;
    - recurrence timezone fallback; a 44-day slot range and `firstAvailableAt`;
    - snapshot diff plus the person-delete cascade;
    - pending blocks fetched directly instead of through an enricher;
    - no avatar, active or timezone fields on users;
    - `manage_own` depends on `interactions.manage` (employee default role change);
    - bulk as a ProgressJob keeping persons on reschedules;
    - reschedule moves the same interaction;
    - an org-slug change interceptor;
    - PII kept out of titles, notifications and the action log;
    - scheduler and CLI in Phase 1.
  - **Low:**
    - an idempotency-key table;
    - Referrer-Policy and log redaction;
    - booker locale; a nullable token hash; `replyTo` = owner;
    - CANCEL on undo of confirm;
    - consistent per-owner lock wording.
- 2026-10-29: Applied the third adversarial review (all findings).
  - **Critical:** per-IP caps reworked:
    - a `client_ip_hash` column;
    - `RATE_LIMIT_TRUST_PROXY_DEPTH` documented as required;
    - per-IP limits skipped (never pooled) when the IP is unknown;
    - a genuinely fail-closed write limiter (503 when none is registered).
  - **High:**
    - pending reschedule successors cancelled with their original, and accept guarded on the original still being confirmed;
    - a real single transaction (`people.create` `transactionalEm` support, plus `bulkImport` suppression with an after-commit restore of events and indexing; no invented after-commit hook);
    - booking commands `replayable: false` with ids-only inputs, and the auto-created person's log entry documented.
  - **Medium:**
    - cancelled requests are final (the undo row removed);
    - person-delete matching on `entityId`, a `beforeUndo` warning, and `customer_entity_id` following interaction moves;
    - `countPersonDependents` excludes the own reschedule chain, adds soft-optional `sales` and `customer_accounts` checks, and uses standard soft-delete side effects;
    - the reschedule own-booking exclusion and successor field rules; accepting a reschedule not undoable;
    - the org-slug interceptor checks the resolved slug, guards undo, and is documented as a BC behavior change;
    - abuse controls moved into Step 8;
    - booker e-mails and `.ics` carry no booker-supplied text.
  - **Low:**
    - checkout's `organizationScope: null` kept, with the corrected rationale;
    - the ProgressJob response shape;
    - an `href` notification action instead of inline accept;
    - TLDR accuracy; the CAPTCHA hook and extension point named consistently;
    - the slug guard also runs on slug change;
    - a system-scoped schedule (no `--register`);
    - the pending-block fetch placed in `useCalendarItems.ts`;
    - ended confirmed requests anonymised;
    - added tests.
- 2026-10-30: Applied the maintainer review on PR #8214:
  - **Blocker:** the `legacy` busy-time mode keeps the conflicts route's e-mail visibility filter (viewer required, applied before selection), with access-parity tests; `calendar` mode documented as owner-only and never exposing ids or titles;
  - **Blocker:** `bulkImport` suppression replaced by an opt-in `ctx.afterCommit` queue that also covers the direct emits (`emitQueryIndexEvents`, `customers.next_interaction.updated`) and the bus CRUD flush, with discard on rollback; the rollback and commit tests observe the real event and index paths;
  - **Major:** SEQUENCE is allocated under the per-owner lock from the live request at send time (accept of a reschedule included), never copied when a successor is created; added the owner-edits-while-pending test;
  - **Major:** `confirm` and `link-person` keep undo through an ids-only `redoInput` with replay enabled and ids-only snapshots; `replayable: false` only for non-undoable commands; added the confirm → undo test.
- 2026-11-03: Applied the maintainer reviews on PR #8214 (@pkarw, @haxiorz re-review):
  - **Blocker:** dropped the `ctx.afterCommit` queue and `DataEngine.discardOrmEntityChanges()`; nested commands join the caller-owned transaction lifetime, the bus defers the whole `runPostCommit()` (after-interceptors, cache invalidation, CRUD flush), direct emitters use `runAfterTransaction`, and rollback relies on one request container per write; tests cover every effect on commit and rollback;
  - **Major:** `manage_own` no longer depends on `interactions.manage` and `employee` does not gain it; owner scope is enforced in the booking commands, with a regression test;
  - **Major:** explicit encryption map for `email` (→ `email_hash`), `first_name`, `last_name`, plus seeding for existing tenants; `decline_reason` stays unencrypted by product decision (owner-authored, not confidential) and is cleared by the anonymisation;
  - **Major:** `updatedAt`/`expectedUpdatedAt` on every request write including owner cancel and public cancel/reschedule, enforced with `enforceCommandOptimisticLockWithGuards`; nested interaction writes versioned against the interaction itself;
  - **Major:** `interactions.cancel` gains `transactionalEm` support so cancellation is atomic with the request and its successor;
  - **Minor:** added the Frontend Architecture Contract and per-step `check:client-boundaries` evidence;
  - **Minor:** kept as one spec by the author's decision; the three phases remain independently shippable and are implemented as separate PRs;
  - **Nit:** removed middot separators and the 900px breakpoint (now `lg`).
- 2026-11-04: Applied @pkarw's re-review on PR #8214:
  - `decline_reason` added to the encryption map (reverses the earlier product decision), with a raw-row ciphertext test;
  - existing tenants get the map from a forward-only `buildEncryptionMapBackfillSql` migration in Step 1, before public writes exist; `seed-encryption --tenant` kept as operator recovery only; migration and first-booking ciphertext tests added.
- 2026-11-04: Applied @haxiorz's re-review on PR #8214:
  - `email_hash` is set by the booking write path with `hashForLookup` independently of encryption (reads use `lookupHashCandidates`), with an encryption-disabled cap and search test;
  - the linked interaction's `updatedAt` is part of the booking version (`expectedInteractionUpdatedAt`, checked under `SELECT … FOR UPDATE`), and the manage page shows the live interaction, closing the delayed-sync stale-write window; a paused-subscriber test;
  - `title_snapshot` and `location_snapshot` are encrypted, diffed on decrypted values, provisioned by the same backfill migration, and cleared by the anonymisation; raw-row tests after an owner title edit.
- 2026-11-04: Applied an `om-code-review` pass:
  - **Major:** the maintenance schedule is also registered by a `customers.register-booking-maintenance-schedule` upgrade action for existing installs; an IP-independent per-profile creation cap (`max_new_requests_per_day`, default 20) bounds bookings in the default deployment where per-IP limits are skipped; `email_hash` is nullable (null after anonymisation); `interaction_id`, `customer_entity_id` and `previous_request_id` have no database FK, so person hard-delete keeps working;
  - **Minor:** `transactionalEm` in `prepare`/`execute`/`captureAfter` of nested commands; org-slug guard checks the requested slug before and the stored slug after, with an explicit 409; a planned `BACKWARD_COMPATIBILITY.md` section; name search dropped (exact e-mail only, no booker names in search tokens); `legacy` busy mode keeps the nullable user and empty-organization behavior; per-owner lock with `lock_timeout` and the reason `withAdvisoryXactLock` is not used; completed and undone interactions in the sync table; `runMutationGuards` on custom write routes; Step 17 aligned with `useCalendarItems.ts`; planner availability added to the alternatives;
  - **Nit:** TLDR count corrected; one idempotency mechanism (the table, now tenant-scoped).
- 2026-11-04: Applied a second `om-code-review` pass:
  - **Major:** accepting a reschedule clears the predecessor's `interaction_id`, backed by a unique partial index, so exactly one request holds an interaction;
  - **Minor:** the creation cap counts every row created in the window regardless of status; the `legacy` busy helper returns `interactionType`, orders by `scheduled_at` and leaves truncation to the route; `interactions.cancel` honours `transactionalEm` in `captureAfter` too (and `people.create` has no `prepare`); the person-delete undo warning is an `afterUndo` notification (interceptors cannot warn in the toast); manage routes moved to `api/public/booking-manage/[token]` to avoid an org slugged `manage`; indexes for `interaction_id`, per-owner busy time and `email_hash`; the BC section lists the calendar types move, the expander parameter and the emit-helper timing; edge-case rows lead with the IP-independent cap;
  - **Nit:** the Undo list regrouped; rollback text covers three tables and the forward-only map backfill.
- 2026-11-04: Applied a third `om-code-review` pass:
  - **Minor:**
    - the reschedule accept clears the predecessor's `interaction_id` before the successor takes it;
    - person-delete cancellations are marked `cancelled_by = 'person_deleted'` with the delete's action id, so the `afterUndo` notification counts only them, and the cascade skips a person already restored;
    - indexes for the creation cap, the per-IP cap and org-wide e-mail search;
    - `cap_reached` carries a `cap` discriminator (`creation`/`pending`/`mail`);
    - Step 2 ships the calendar types move and the expander parameter with their own BC entry, and each contract-changing step adds its own BC part;
  - **Nit:**
    - optional `limit` on the `legacy` helper keeps the conflicts SQL unchanged;
    - the `interactions.cancel` phases moved out of the inline-confirm step;
    - notifications split into owner and acting-user lists.
- 2026-11-04: Applied a fourth `om-code-review` pass:
  - **Minor:**
    - the person-delete subscriber looks the action-log id up explicitly and re-checks the person inside its own transaction, with the remaining race documented as residual risk;
    - the creation cap applies only to writes that insert a row, so cancel and instant reschedule are never refused;
    - status labels for every `cancelled_by` value, with reschedule predecessors hidden from the list and `counts`;
    - the upgrade action is admin-triggered, so the booking pages warn while the schedule is missing;
  - **Nit:**
    - one discriminated-union `findBusyIntervals` signature, with the request union moved to `lib/booking/availability.ts`;
    - neutral BC section title;
    - two explicit statements for the `interaction_id` hand-over;
    - a dedupe key for `cap_reached`.
- 2026-11-04: Applied a fifth `om-code-review` pass:
  - **Major:** corrected the person-delete action-log lookup. The log is persisted before the event, so the subscriber takes the latest `done` `customers.people.delete` entry through `actionLogService.list`;
  - **Minor:**
    - the cascade holds the log's undo claim during its transaction, which closes the undo race (the residual-risk note is removed);
    - `cancelled_by` split into `superseded` (hidden) and `original_cancelled` (visible);
    - a `GET booking-requests/{id}` detail route with `history`;
    - `429` on approval-mode reschedule, with manage-page copy and a test;
    - the schedule id via `stableScheduleUuid`, a server-computed `maintenanceScheduled` flag, and `requiredModules: ['scheduler']`;
    - the pending cap falls back to 10 when meetings per day are unlimited;
  - **Nit:**
    - cap checks added to the public write sequence with response precedence;
    - a "Migration & Backward Compatibility" heading and a removal target for the deprecated re-export.
- 2026-11-04: Applied a sixth `om-code-review` pass:
  - **Major:** the person-delete subscriber takes the latest `customers.people.delete` entry regardless of state (`list` without `undoableOnly`) and branches on it:
    - `done`: cascade;
    - `undoing`: retry;
    - `undone`: nothing;
    - no entry: audit logging off.

    It re-checks inside the transaction that the person is still deleted;
  - **Minor:**
    - the public write sequence rewritten in its real order (rate limit, validation, idempotent replay, lock, `isOnGrid` 422, caps 429, `isFree` 409, insert), with the gate split in two;
    - the detail route added to Placement and integration coverage;
    - `maintenanceScheduled` uses an additive `schedulerService.isActive` so a disabled schedule still warns;
    - the cascade takes every affected owner's lock in key order;
  - **Nit:**
    - "Moved to {new time}" label for superseded history rows;
    - the pending-cap test moved to Step 8;
    - `stableScheduleUuid` is copied, not imported;
    - prototype note for the reschedule 429.
- 2026-11-04: Applied a seventh `om-code-review` pass, with the person-delete cascade simplified:
  - **Simplified:**
    - the `customers.person.deleted` subscriber only enqueues a delayed (2 min) booking-owned job and never throws, so the other subscribers of that event are never retried because of it;
    - the job takes the owners' locks in key order, re-checks inside its transaction that the person is still deleted, and cancels;
    - the maintenance job is the backstop for lost jobs and crashed undos;
    - removed the audit-log state branching, the borrowed undo claim and `cancelled_by_action_id`. The `afterUndo` notification counts `person_deleted` rows cancelled after the delete's log time;
    - the one remaining overlap (an undo during the job's transaction) is an accepted risk;
  - **Major:** in-flight idempotency: a placeholder key row inserted with `ON CONFLICT` before the lock, and the response written in the booking's transaction; concurrent same-key requests get one booking and the same `201`;
  - **Minor:**
    - busy time for the write gate is loaded with an overlap query around the slot and its buffers;
    - `maintenanceSchedule` reports `missing` or `inactive` with separate warnings; registration omits `isEnabled`; a scheduler service without `isActive` falls back to `exists()`;
  - **Nit:**
    - the scheduler sentences rewritten;
    - per-operation step lists for reschedule and cancel;
    - the scheduler change added to the TLDR and the Additive list.
- 2026-11-05: Applied an eighth `om-code-review` pass:
  - **Major:**
    - the person-delete backstop measures time with a `person_missing_since` marker set by the maintenance job, so a tick inside the 2-minute delay never cancels and an undo resets the clock;
    - the cascade, the backstop and owner cancels/deletes only cancel or e-mail **upcoming** meetings; past and anonymised rows are never e-mailed;
    - cancel and instant reschedule write the idempotency response; any refusal rolls back and removes the key row, so retries are evaluated again;
  - **Minor:**
    - buffers belong to the offered slot (padded slot vs. raw busy time) in both the slot list and the write gate, with an asymmetric-buffer test;
    - manage-link writes resolve by token: cancel works on a disabled profile, reschedule returns `409 booking_unavailable`, and the verify hook applies to creation only;
    - every cancellation sets `decided_at`, which the `afterUndo` count uses;
    - the cascade job notifies owners when an undo landed during its transaction;
    - approval reschedule documents `429 too_many_open_requests` and leaves the moved request out of the per-e-mail and per-IP counts;
    - the `isActive` fallback is described accurately (it cannot report a disabled schedule);
    - `lock_timeout` is set at the start of the transaction, so the key-row wait is bounded too;
  - **Nit:** edge-case row updated, standard queue retries stated, the backstop test moved to Step 12 with the duplicate removed, prototype note 6 covers the no-scheduler case.
- 2026-11-05: Applied a ninth `om-code-review` pass:
  - **Major:**
    - buffers: an owner's own bookings are padded with their profile's buffers, so two bookings keep the larger of the two buffers between them in either booking order;
    - the sync subscriber skips anonymised rows (new `anonymised_at`) and sends nothing for ended meetings;
  - **Minor:**
    - past meetings are left untouched everywhere (owner cancel/delete included);
    - new `cancelled_at`/`cancelled_by_user_id`; `decided_*` keeps the accept or decline;
    - any lock timeout in a booking write maps to `503 booking_busy` (public) or `409` (backend); a booking-only `CUSTOMERS_BOOKING_LOCK_TIMEOUT_MS`;
    - validation and the verification hook run before the transaction opens;
    - a reschedule chain counts once in the per-e-mail and per-IP caps;
  - **Nit:** response written after the inline confirm, list numbering fixed, manage-link exceptions and cancel wording, a backstop index plus an interaction-gone check, `too_many_open_requests` copy (spec and prototype), the after-commit notice's durability stated.
- 2026-11-05: Applied a tenth `om-code-review` pass (approved):
  - **Minor:**
    - owner cancel refuses an ended meeting (`409 meeting_ended`) and the row menu hides it;
    - the cascade job uses the backstop's interaction-gone check;
    - the interaction sync subscriber enqueues a booking-owned job, so a lock timeout is retried without re-running other subscribers;
    - `cap_reached` is emitted after the rollback of the refused write;
  - **Nit:** slot algorithm text, per-booking padding in `loadBusyTime`, the slots read widened like the write gate, the backstop's index-friendly predicate, cancel wording, the lock-error helper's scope, the 30-day counter definitions, neutral copy for `too_many_open_requests`.
- 2026-11-09: Addressed the re-reviews by @haxiorz (2026-11-05) and `om-auto-review-pr` (2026-11-08):
  - **Major:** accepting a pending reschedule (single and bulk) locks the predecessor's live interaction with `SELECT … FOR UPDATE` before any other change, and treats a `canceled`, soft-deleted or missing interaction as `409 original_booking_gone`, so an ordinary CRM cancel or delete that the sync job has not processed yet can no longer be moved, revived or re-invited;
  - the refused accept cancels only the successor and leaves the predecessor and its single CANCEL e-mail to the sync job;
  - Step 19 gains deterministic paused-sync cases for CRM cancel and delete, single and bulk, plus a lock-wait case; a new edge-case row and the bulk contract describe the per-item failure.
