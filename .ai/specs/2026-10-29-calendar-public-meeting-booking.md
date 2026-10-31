# CRM Calendar — public meeting booking page per user

## 📝 TLDR
**Key points:**
- A public, no-login page at **`/calendar/{orgSlug}/{userSlug}/meetings`** where an external person picks a free slot in a CRM user's calendar, enters e-mail, first name and last name, and books a meeting.
- A confirmed booking creates a scheduled `CustomerInteraction` (a meeting) owned by that user. It appears in the CRM Calendar (`/backend/calendar`, spec `2026-06-11-crm-calendar.md`). The booker receives an e-mail with an `.ics` attachment and a private manage link for cancelling or rescheduling.
- Each user opts in and configures their own booking profile: slug, slot length, weekly hours, buffers, notice, horizon, daily cap, date overrides, and whether each booking needs their approval (with an approval deadline after which requests expire).
- The feature lives in the **`customers`** module. It adds two entities plus an idempotency-key table. It also makes four additive changes to existing code: the conflicts route is refactored onto a shared busy-time helper (same contract, including its e-mail visibility filter), the directory module's organization update gets a command interceptor (a behavior change, see Risks → Compatibility), `people.create` gains support for running inside the caller's transaction, and the command runtime gains an opt-in after-commit queue for side effects of nested commands. No existing entity or route contract changes.

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
   - a per-profile cap of 50 outbound booking e-mails per day applies (configurable through `CUSTOMERS_BOOKING_DAILY_MAIL_CAP`); over the cap, mail is queued for the next day and the owner is notified;
   - e-mails use the booker's `locale` (captured at submit from `Accept-Language`, falling back to the tenant default).

7. **Manage link:** a random 32-byte token that is shown once in the e-mail and stored as a SHA-256 hash. It opens `/calendar/{orgSlug}/{userSlug}/meetings/manage/{token}` with **Cancel** and **Reschedule** (the same slot picker, at `…/manage/{token}/reschedule`). The pages send `Referrer-Policy: no-referrer`, and the token path segment is redacted in request logs. A reschedule under approval mode creates a new `pending` request for the new time, while the old meeting stays confirmed until the decision (see Architecture → Reschedule).

### Alternatives considered
| Alternative | Why rejected |
|---|---|
| Fold into the bookings module §19 | That design is per service and per resource, with pricing and staff pools. This feature is per CRM user over CRM interactions. Coupling them would block a small feature on a large, unimplemented module. |
| New interaction status `pending` instead of a request entity | Changes a contract surface (`interactionStatusValues`, calendar rendering, every filter on status) and still needs somewhere to keep booker PII, tokens and expiry. A dedicated request entity is additive. |
| Create the person at request time | Spam requests would litter CRM with persons. Pending requests hold the details on the request row. The person is created only on confirmation. |
| Match the person by e-mail automatically | Lets anyone attach a meeting to a real customer by typing their address (impersonation). This was rejected explicitly in the Q&A. |
| User slug unique installation-wide (no org segment) | Answered: add the org slug. A per-organization user slug lets two organizations both have `/…/anna/meetings`. |

## 📝 Architecture

### Placement
All code lives in `packages/core/src/modules/customers/`:

```
data/entities.ts              + CustomerBookingProfile, CustomerBookingRequest
data/validators.ts            + bookingProfileSchema, publicBookingRequestSchema, …
lib/booking/busy.ts           findBusyIntervals(em, scope, userId, from, to): shared busy-time query
lib/booking/slots.ts          computeFreeSlots(profile, busy, range, now): pure
lib/booking/ics.ts            buildIcs({ method, uid, sequence, … }): pure
lib/booking/resolveProfile.ts resolvePublicProfile(orgSlug, userSlug, host)
lib/booking/tokens.ts         manage token generate/hash
commands/bookingRequests.ts   create, confirm, decline, expire, cancel, reschedule, linkPerson
api/public/booking/[orgSlug]/[userSlug]/{route,slots,requests}/…
api/public/booking/manage/[token]/{route,cancel,reschedule}/…
api/booking-profile/route.ts  GET/PUT own profile
api/booking-requests/…        list, counts, bulk, accept/decline/link-person/cancel
frontend/calendar/[orgSlug]/[userSlug]/meetings/page.tsx (+ manage/[token]/page.tsx)
backend/profile/meeting-booking/page.tsx   pageContext: 'profile'
backend/customers/booking-requests/page.tsx
workers/booking-maintenance.ts  expiry + anonymisation (one job)
workers/booking-requests-bulk.ts bulk accept/decline as a ProgressJob
lib/booking/dependents.ts     countPersonDependents(em, scope, entityId)
lib/booking/transitions.ts    conditional state updates
setup.ts                      + scheduler registration (interval 5 min, soft-optional like customer_accounts)
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

This spec **extracts** the interval query (the `WHERE` and overlap part only) into `lib/booking/busy.ts` as `findBusyIntervals(em, { tenantId, userId, from, to, organizationIds?, excludeId?, mode, viewer? })`, returning `{ id, startsAt, endsAt }[]`. The conflicts route keeps its own `limit 10`, title lookup and response shape.
- **`mode: 'legacy'`:** exactly today's predicate (author **or** owner, `organizationIds` and `excludeId` honoured) **including the e-mail visibility filter**. `viewer` is **required** in this mode (enforced by the type: `{ mode: 'legacy', viewer: { userId: string | null, sharedConversations, sharedChannelIds } }`), and the helper applies `applyEmailVisibilityFilter` with it **before** the user predicate, ordering and limit, exactly where the route applies it today. The route keeps resolving the viewer (`null` for API-key callers) and the grants as it does now and passes them in. The conflicts route switches to it as a pure refactor, so its behavior and access boundary do not change. Parity tests are pinned against the existing conflicts fixtures and add the access cases: another user's private scheduled e-mail is **not** returned (and its title is not leaked), a conversation share and a shared channel make it visible, and an API-key caller (`viewer.userId = null`) sees exactly what it sees today. This refactor ships as its own PR (Step 2) before any booking code.
- **`mode: 'calendar'`:** used by booking only, server-side. It takes no `viewer`, because it reads the **owner's own** schedule to compute free time, and its result never leaves the booking code as ids or titles: the public API only returns free starts. So the owner's private scheduled e-mails do block availability, which is the intended meaning of "busy". It follows the CRM Calendar's own conflict rule (`lib/calendar/conflicts.ts`: **owner or participant**). It does **not** use `author_user_id`, so meetings an assistant creates for someone else do not consume the assistant's availability. On top of that:
  - **participants:** interactions whose `participants` jsonb contains `{ "userId": <user> }`;
  - **recurring series:** masters selected like the `recurrenceMasters=true` mode (start ≤ `to`, no end before `from`), expanded server-side with the existing `lib/calendar/recurrence.ts` expander. Its type imports from `components/calendar/types` move to `lib/calendar/types.ts`, with a re-export left behind. The expander currently falls back to the **process** timezone (`getDay()`/`getFullYear()`) for masters without `timezone`; busy-time expansion passes the **profile timezone** as the explicit fallback, and an added parameter keeps the client's current behavior unchanged;
  - **all-day items:** they block the whole day in the profile timezone (`lib/calendar/timezone.ts`, `date-fns-tz`; no new dependency).
- **Scope:** busy time covers **all organizations of the user within the tenant**, not just the profile's organization. A user with booking pages in two organizations, or with CRM meetings in another one, cannot be double-booked. This is a read of the owner's own records and leaks nothing across tenants.

Busy time is then the union of:
- the user's `calendar`-mode intervals,
- `CustomerBookingRequest` rows for **any profile of the same user** with `status = 'pending'` and `expiresAt > now`.

Buffers extend each busy interval by `bufferBefore`/`bufferAfter`.

### Keeping the booking in sync with the interaction
The owner can edit, reschedule, cancel or delete the created interaction from the CRM Calendar like any other. A subscriber on the interaction's existing CRUD/lifecycle events keeps the linked request (looked up via `interaction_id`) in sync:

| Owner action on the interaction | Request becomes | E-mail to booker |
|---|---|---|
| Cancelled (status `canceled`) or deleted | `cancelled`, `cancelled_by = owner` | cancellation, `METHOD:CANCEL` |
| Time or duration changed | `confirmed`, with `starts_at`/`ends_at` updated and `ics_sequence + 1` | update, `METHOD:REQUEST` |
| Title or location changed | unchanged except the snapshots | update, `METHOD:REQUEST`, `SEQUENCE + 1` |
| The person is deleted (cascade) | `cancelled`, `cancelled_by = owner` | cancellation, `METHOD:CANCEL` |
| Moved to another person | unchanged; `customer_entity_id` follows the interaction | none |

A cancelled request is never re-opened, even if the interaction is later restored through undo. The restored interaction stays a normal CRM meeting; the owner can re-invite the booker manually. This matches the rule that ended requests are final (the slot may already be re-booked).

**Pending reschedule cascade:** whenever a confirmed request is cancelled (by the booker, by the owner, by interaction cancel or delete, or by the person-delete cascade), its pending reschedule successor, if any, is set to `cancelled` (`cancelled_by = 'reschedule'`) **in the same transaction**, and no separate e-mail is sent for it.

**Sequence allocation:** a booking's `SEQUENCE` belongs to its `ics_uid` and is allocated, never copied. Every path that sends a `METHOD:REQUEST` or `METHOD:CANCEL` for a UID (owner-sync subscriber, booker reschedule, accept of a reschedule, cancel) does so in a transaction holding the same per-owner lock as public writes (`pg_advisory_xact_lock(hash(tenantId, userId))`) and allocates the number there with `UPDATE … SET ics_sequence = ics_sequence + 1 WHERE id = :liveRequestId RETURNING ics_sequence` on the request that currently holds the UID's interaction. The e-mail uses the returned value. So owner edits and booking actions on one UID are serialised, each one sends a strictly higher number, and no path sends a value computed earlier (RFC 5546 §2.1.4: a higher SEQUENCE supersedes a lower one).

**Detecting changes:** interaction events carry ids and status only, so the request keeps snapshot columns (`starts_at`, `ends_at`, `title_snapshot`, `location_snapshot`). On each `customers.interaction.updated`, the subscriber loads the interaction and diffs it against the snapshots; it sends an e-mail only when something the booker sees has changed.

**Person-delete cascade:** the person-delete command removes interactions with `nativeDelete` and emits no interaction events. A subscriber on `customers.person.deleted` therefore cancels every confirmed request whose `customer_entity_id` matches the event's **`entityId`** (the event's `id` is the person *profile* id, `commands/people.ts`), cascades to pending successors, and e-mails the bookers.

Undoing a person delete restores the interactions silently (no interaction events). The booking requests stay `cancelled` and the bookers have their CANCEL; this is consistent with "cancelled is final". A `beforeUndo` command interceptor on `customers.people.delete` warns the user in the undo toast: "{n} booked meetings were cancelled and their bookers notified; they will not be re-invited automatically".

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

**Action-log PII:** the command bus stores each command's full input as `commandPayload`, and `people.create` stores a `snapshotAfter` with names. So:
- the booker's e-mail and names are passed through the request row, never through a booking command's input, and every booking command's `captureBefore`/`captureAfter` snapshot is **ids and status only** (request id, status, `interaction_id`, `customer_entity_id`, `starts_at`, `ics_sequence`), so neither the command payload nor the snapshots carry PII;
- **undoable** booking commands (`confirm`, i.e. accept, and `link-person`) keep replay **enabled**: they supply an ids-only `redoInput` (`{ requestId, expectedUpdatedAt }`) and leave `replayable` unset, so the bus still issues an undo token (`CommandLogMetadata.redoInput`; `replayable: false` would clear it). The bulk worker runs the single-item `confirm` per item, so each accepted item gets its own undo entry;
- **non-undoable** booking commands (public `create` with its inline confirm, which runs with no user to undo it, `decline`, `cancel`, and `reschedule` including accepting a reschedule) use `replayable: false`, which is the intended effect: an audit entry without an undo token or payload;
- the auto-created person's own `people.create` log entry **does** keep the name and e-mail. That is standard CRM behavior for any person record, covered by the CRM's GDPR tooling and not by this feature's anonymisation (see Data Model → Retention).
- **link-person:** undoing it moves the interaction back and restores the soft-deleted person;
- **decline and cancel:** not undoable, because the booker's state would flip back without a matching e-mail. The owner can still book a new meeting manually.

### State transitions
All transitions live in `lib/booking/transitions.ts` and run as one conditional `UPDATE … SET status = :to, updated_at = now() WHERE id = :id AND status = :from [AND expires_at > now()] RETURNING *` inside the command's transaction:

| Transition | Guard |
|---|---|
| accept, decline | `status = 'pending' AND expires_at > now()`; the API's `expectedUpdatedAt` is checked as well |
| expire | `status = 'pending' AND expires_at <= now()` |
| cancel (booker or owner) | `status IN ('pending','confirmed')`; also cancels a pending successor in the same transaction |
| accept of a reschedule successor | the above, **plus** the predecessor still `confirmed` (checked under the owner lock); otherwise `409 original_booking_gone` and the successor is cancelled |

Zero rows updated means the action lost the race: the API returns `409 request_state_changed`, and only the winner's e-mail is sent. This replaces read-then-compare locking for these rows, so accept and expiry can no longer both commit.

### Reschedule
- **Busy time for a reschedule excludes the booking being moved:** `findBusyIntervals` in `calendar` mode takes `excludeInteractionIds` and `excludeRequestIds`, and the daily cap ignores the request being moved. So the booker's own meeting does not block overlapping new times or use up the cap.
- **Instant mode:** under the owner lock, the new `startsAt` is validated as an offered slot (with the exclusions above). The same request row is updated (`starts_at`, `ends_at`, snapshots, and `ics_sequence` allocated as in Architecture → Sequence allocation), the **same interaction** is moved through the interaction update command (with the booking `syncOrigin`), and an update `METHOD:REQUEST` with the same UID is sent. The manage token stays the same.
- **Approval mode:** a new `pending` request is created, with `previous_request_id` pointing at the confirmed one, `source = 'reschedule'`, the same `ics_uid` and `customer_entity_id`, `ics_sequence` left at 0 (a placeholder; no number is reserved while pending), and `interaction_id` **null** until accept (so the sync lookup by `interaction_id` always finds exactly one row, the confirmed one). It holds the new slot and the old meeting stays confirmed. The old manage token **remains valid** and its page shows "Reschedule requested for {new time}, waiting for confirmation".
  - **On accept** (guarded: the predecessor is still `confirmed`): under the per-owner lock, the sequence is allocated **at acceptance** from the live predecessor (Architecture → Sequence allocation): `predecessor.ics_sequence + 1`, read and incremented in the same locked transaction, then written to the successor. Owner edits made while the request was pending have already raised the predecessor's number, so the accept e-mail always supersedes them. The existing interaction is moved to the new time (same UID, the newly allocated SEQUENCE, update e-mail), the successor takes `interaction_id`, the predecessor becomes `cancelled` (`cancelled_by = 'reschedule'`, no CANCEL e-mail), and the token is re-pointed (`manage_token_hash` moves to the successor). Only one reschedule can be pending per booking (`409 reschedule_pending`).
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
3. Drop a slot that falls before `now + minNoticeMinutes`, after `today + horizonDays`, or overlaps busy time.
4. When `maxBookingsPerDay` is reached (confirmed plus pending), drop the whole day.

The first-available scan goes forward in 31-day chunks up to the horizon and returns the **first free instant** (`firstAvailableAt`). The client converts it to the visitor's local date, so the preselected day is right in every timezone. The function is pure and unit-tested with fixed `now`. Timezone math uses `date-fns-tz` and `lib/calendar/timezone.ts`, which are already dependencies.

The same function is the **write-side gate**: `isOfferedSlot(profile, busy, startsAt, now)` returns true only when `startsAt` is exactly one of the computed starts. It therefore checks working hours, overrides, the interval grid, notice, horizon and the daily cap, as well as busy time.

### Public request write (race safety)
`POST …/requests`, in a single transaction:
1. Resolve the profile (it must be active).
2. Validate the payload with zod.
3. Take `pg_advisory_xact_lock(hash(tenantId, userId))` to serialise writes per **owner**, so two profiles of the same user cannot race.
4. Load busy time for the slot's profile-local day and require `isOfferedSlot(profile, busy, startsAt, now)`. Reject with `422 slot_not_offered` when the time was never offered (off-grid, outside hours or overrides, inside the notice window, past the horizon), and with `409 slot_taken` when it was offered but is now busy or the day reached its cap.
5. Insert the request.
6. If approval is off, confirm inline: create the person and the interaction through the existing commands, with `ownerUserId = profile.userId` and the outer `ctx.transactionalEm`. `interactions.create` already honours it. `people.create` does **not** today (it forks its own EntityManager), so Step 8 adds `transactionalEm` support to `people.create` as an additive change (the same pattern as `interactions.create`). Without that change there is no single transaction, and a rollback would leave an orphan person.
7. Commit.

**Side effects run after commit.** `ctx.bulkImport` is **not** enough here: the bus only passes those flags to its queued CRUD flush (`dataEngine.flushOrmEntityChanges`), while the nested commands also emit directly. `people.create` calls `emitQueryIndexUpsertEvents` (`commands/shared.ts`, which emits `query_index.upsert_one` straight to the event bus), and `interactions.create` emits the parent `customers:customer_entity` index upsert and the `customers.next_interaction.updated` lifecycle event (`emitNextInteractionUpdatedEvent`). Each nested `execute` also flushes the CRUD queue as soon as it returns. All of that would escape before the outer transaction commits.

This spec therefore adds a small, opt-in, **transaction-aware deferral** to the command runtime (Step 8, additive):
- `CommandRuntimeContext.afterCommit?: AfterCommitQueue`, with `defer(effect: () => Promise<void>)`, `flush()` (runs each queued effect once, in order, and reports failures through `reportError` without throwing) and `discard()`;
- when `ctx.afterCommit` is set, the command bus defers its post-execute `flushCrudSideEffects` into the queue instead of running it, and the data engine gains `discardOrmEntityChanges()` so a rollback can drop the queued CRUD entries of the rolled-back rows;
- the shared emit helpers consult `ctx.afterCommit` and defer instead of emitting: `emitQueryIndexEvents` (both the upsert and delete paths) in `customers/commands/shared.ts`, and `emitLifecycleEvent` in `customers/commands/interactions.ts`, which carries `customers.next_interaction.updated` and the interaction lifecycle events;
- without `ctx.afterCommit` (every existing caller) behavior is unchanged.

The booking command creates the queue, passes it to the nested `people.create` and `interactions.create` together with `transactionalEm` and the booking `syncOrigin`, and then:
- **on commit:** calls `afterCommit.flush()` exactly once. That restores the complete effect set, each once: the person `created` CRUD event and index entries, the person `customers:customer_entity` index upsert, the interaction `created` CRUD event and index entries, the parent `customers:customer_entity` projection upsert, and `customers.next_interaction.updated`;
- **on rollback:** calls `afterCommit.discard()` and `dataEngine.discardOrmEntityChanges()`, so nothing is emitted or indexed.

If a deferred effect fails after commit, the error is reported through `reportError`, and a maintenance-job pass re-indexes records of `source = 'public_booking'` that are missing from the index.

Booking e-mails and notifications go out from event subscribers after commit, so a mail failure never rolls back a booking. The `Idempotency-Key` header is required on every public write (`requests`, `cancel`, `reschedule`). Keys are stored in `customer_booking_idempotency_keys` (`scope`, `key`, `fingerprint`, `response`, `created_at`; unique `(scope, key)`; purged after 24 h by the maintenance job). The same key and payload returns the stored response; the same key with a different payload returns `422`.

### Public profile resolution and the org slug
`organizations.slug` is unique per `(tenant_id, slug)`, not globally. Resolution reuses the portal's rule (`directory/api/get/organizations/lookup.ts`): a custom-domain host binds the tenant; otherwise the lookup is unscoped. The resolver then requires **exactly one** active profile matching `(org.slug = orgSlug, profile.slug = userSlug)`. Zero or several matches return 404, and several matches are also logged as `warn`. To keep that from happening, **enabling** a profile, or changing the slug of an already-active profile, is refused with `org_slug_ambiguous` when the organization has no slug or another tenant has an organization with the same slug and an active booking profile with the same user slug.

This guard is a **deliberate, documented cross-tenant read**: it returns only a boolean, never another tenant's data, and runs under `pg_advisory_xact_lock(hash(orgSlug, userSlug))`, so concurrent enables cannot both pass.

**Org slug changes:** a command interceptor on the directory module's organization update command (`commands/interceptors.ts`, the pattern `communication_channels` uses) runs whenever the slug changes and the organization has active booking profiles:
- it checks the **resolved** slug (after `resolveUniqueSlug` may have rewritten the requested one) and **refuses** the change with `org_slug_ambiguous_for_booking` if it would collide. `beforeExecute` runs outside the update's transaction, so the guard is advisory. The authoritative check is repeated at resolution time (exactly-one match, else 404 plus a `warn` log and an owner notification);
- the same guard runs on `beforeUndo` of an organization update, which would restore an old slug;
- otherwise it lets the change through and notifies each profile owner that their link changed.

Old links return 404; manage links keep working because they are keyed by token. A redirect from old slugs is out of scope.

### Cross-module boundaries
- Owner identity: `userId` is an FK id to `auth` users, with no ORM relation. The auth `User` has no avatar, active flag or timezone. The public page shows the display name (falling back to the e-mail's local part) and **initials** in the avatar. An owner counts as "active" when the user has `deleted_at IS NULL` and still has access to the profile's organization; otherwise the page returns 404.
- Organization slug: read through `directory` as the portal does.
- E-mail: `@open-mercato/shared/lib/email/send`. Notifications go through the `notifications` module's typed notifications (`customers/notifications.ts`).
- Scheduler: soft-optional, **registered in Phase 1** as one **system-scoped** schedule with a stable id (the `customer_accounts/setup.ts` pattern). Because it is not per-tenant, no per-tenant registration or `--register` step is needed; the worker iterates over tenants itself. When `schedulerService` is not registered, expiry still works at read time (pending blocks only while `expiresAt > now`, and lists show `expired` from the derived state); the job only makes the status change and the "expired" e-mail happen. Anonymisation then needs the CLI to be run by hand.

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
| `max_bookings_per_day` | int null | null = unlimited |
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
| `title_snapshot`, `location_snapshot` | text null | what the booker was last told; used by the sync diff |
| `email`, `first_name`, `last_name` | text | **encrypted** via the module's encryption defaults (GDPR fields); queried with `findWithDecryption` |
| `email_hash` | text | HMAC of the normalised e-mail, used for per-e-mail rate caps without decrypting |
| `client_ip_hash` | text null | HMAC of the resolved client IP; null when the IP cannot be determined. Used for per-IP caps |
| `consent_at`, `consent_policy_version` | timestamptz, text | proof of consent captured at submit |
| `status` | text | `pending` \| `confirmed` \| `declined` \| `expired` \| `cancelled` |
| `expires_at` | timestamptz null | pending only |
| `decided_at`, `decided_by_user_id` | null | |
| `decline_reason` | text null | optional, shown to the booker |
| `cancelled_by` | text null | `booker` \| `owner` \| `reschedule` |
| `interaction_id` | uuid null | set on confirm |
| `customer_entity_id` | uuid null | person the interaction is attached to |
| `auto_created_entity` | bool, default false | true when the person was auto-created from this request |
| `previous_request_id` | uuid null | set on a reschedule chain |
| `manage_token_hash` | text **null** | SHA-256; unique where not null. Null in Phase 1 (no tokens issued), after anonymisation, and after moving to a reschedule successor |
| `ics_uid` | text | stable `{requestRootId}@{APP_URL host}`; never derived from the request `Host` header |
| `ics_sequence` | int, default 0 | last SEQUENCE sent for `ics_uid`; only ever incremented under the per-owner lock (Architecture → Sequence allocation). 0 placeholder on a pending reschedule successor |
| `idempotency_key`, `request_fingerprint` | text | unique `(profile_id, idempotency_key)` |

Indexes:
- `(profile_id, status, starts_at)`: busy lookup and daily cap.
- `(organization_id, owner_user_id, status, created_at)`: backend list.
- `(status, expires_at) where status = 'pending'`: expiry job.

Plus a small table, `customer_booking_idempotency_keys`, for public-write idempotency (see Architecture → Public request write).

**Retention and PII placement:** booker PII is kept out of every place the module does not control:
- **titles:** created interactions are titled with the profile title ("Meet with Anna"), never the booker's name; the booker is visible through the linked person;
- **events and notifications:** event payloads carry ids only; notification texts say "New meeting request for {date time}" and resolve the name only when rendered for an authorised viewer;
- **audit log:** the platform action log stores command payloads and snapshots. Booking commands therefore use ids-only inputs (a redacted `redoInput` where undo is kept, `replayable: false` where it is not) and ids-only snapshots (Architecture → Command context), so their log entries never hold the e-mail or names. The auto-created person's own creation entry does hold them (standard CRM behavior).

Declined, expired and cancelled requests, and confirmed requests whose meeting ended, are anonymised 90 days later by the maintenance job (Phase 1):
- e-mail and names are replaced with a fixed marker;
- `email_hash`, `client_ip_hash`, `request_fingerprint` and the token hash are cleared.

**Not covered:** the person auto-created on confirmation is a normal CRM record and follows the CRM's retention and GDPR tooling, not this job.

Without the scheduler, the job can be run by hand with the CLI command `mercato customers booking-maintenance`. Confirmed requests whose meeting ended more than 90 days ago are anonymised the same way, because the person record holds the CRM copy. Interactions and persons follow the CRM's normal retention.

## 📝 API Contracts
Every handler exports `openApi`. Public routes declare `requireAuth: false`; all public writes go through commands.

### Public (no auth)
**Abuse controls** on the write routes (`requests`, `cancel`, `reschedule`):
- **Client IP:** resolved with the platform's `getClientIp`, which needs `RATE_LIMIT_TRUST_PROXY_DEPTH` set to the number of proxies in front of the app (it defaults to 0). Booking setup documents that this is **required** behind a proxy or load balancer. When the IP cannot be resolved, every **per-IP** limit below is **skipped**, never applied to a shared bucket, so visitors are never pooled into one lockout. The per-profile and per-e-mail limits still apply.
- **Rate limit** per resolved IP and per profile, through a module-local wrapper over the platform rate limiter. Unlike checkout's wrapper, which lets requests through when the limiter is not registered, the booking wrapper is **fail-closed on writes**: with no rate limiter registered, public `POST`s return `503 booking_unavailable`; reads stay available.
- **Outstanding-request caps:**
  - at most 2 open (pending or future confirmed) requests per `email_hash` per owner;
  - at most 3 open requests per `client_ip_hash` per owner (skipped when the IP is unknown);
  - the owner-wide pending cap `max(10, 2 × maxBookingsPerDay)` counts at most 3 requests per `client_ip_hash`, and requests with an unknown IP count individually. So one resolved source cannot fill it, and unresolved traffic is still bounded by the cap itself.

  Over a cap, the route returns `429 too_many_open_requests`. The owner is notified when the owner-wide cap is hit, so they can decline in bulk.
- **Outbound mail cap:** see Proposed Solution → E-mail safety.
- **Bot check:** a server-side verification hook, `customers.public-booking.verify-submission` (DI-overridable, default no-op), plus the client form extension point `customers.public-booking.form`, where the matching CAPTCHA widget renders. A CAPTCHA provider plugs into both in v1 without code changes here.
- **Origin check** against `CUSTOMERS_BOOKING_ALLOWED_ORIGINS`, falling back to `APP_URL`/`NEXT_PUBLIC_APP_URL`. This is CSRF hygiene only, not abuse protection, and is applied on POST only.

| Method & path | Request | Response |
|---|---|---|
| `GET /api/customers/public/booking/{orgSlug}/{userSlug}` | — | `{ ownerName, ownerInitials, organizationName, title, description, location, slotDurationMinutes, timezone, horizonEndDate, firstAvailableAt: ISO \| null, requiresApproval }`. 404 when inactive, unknown or ambiguous (same body for each). |
| `GET …/slots?from=YYYY-MM-DD&to=YYYY-MM-DD` | range ≤ 44 days (a 6-week month grid plus one day on each side for visitors in far-off timezones) | `{ days: [{ date, slots: [{ startsAt: ISO, endsAt: ISO }] }] }`; dates in the profile timezone, instants in UTC; the client renders them in the visitor's timezone |
| `POST …/requests` | header `Idempotency-Key`; body `{ startsAt: ISO, email, firstName (1–100), lastName (1–100), timezone: IANA, consent: true }` | `201 { status: 'confirmed' \| 'pending', startsAt, endsAt, expiresAt?, ics?: string }` (`ics` is only present when confirmed; it is the same file as the e-mail attachment, for the **Add to calendar** download). 409 `slot_taken`, 422 `slot_not_offered` or validation, 429 rate or caps. The manage URL is **only** e-mailed. |
| `GET /api/customers/public/booking/manage/{token}` | — | `{ status, startsAt, endsAt, ownerName, ownerInitials, title, bookerName, bookerEmail, canCancel, canReschedule, changeCutoffAt, pendingReschedule?: { startsAt, expiresAt }, orgSlug, userSlug }` (booker details are returned only to the token holder). 404 for an unknown token (no detail leaked). |
| `POST …/manage/{token}/cancel` | `Idempotency-Key` | `{ status: 'cancelled' }`; 409 `cutoff_passed` |
| `POST …/manage/{token}/reschedule` | `Idempotency-Key`, `{ startsAt }` | `{ status: 'confirmed' \| 'pending', startsAt, endsAt }`; 422 `slot_not_offered`; 409 `slot_taken` \| `cutoff_passed` \| `reschedule_pending` |

### Backend (auth)
| Method & path | Guard | Notes |
|---|---|---|
| `GET /api/customers/booking-profile` | `customers.booking.manage_own` | own profile or defaults; `publicUrl` |
| `PUT /api/customers/booking-profile` | same | upsert own profile; optimistic lock; 409 `slug_taken`, `org_slug_ambiguous` |
| `GET /api/customers/booking-requests` | `customers.booking.manage_own` (own) / `customers.booking.manage` (all in org) | `makeCrudRoute` list; filters `status`, `ownerUserId`, `from`, `to`, `q` (an exact e-mail match through `email_hash`; name search uses the customers module's existing encrypted-search approach for encrypted columns, as in `api/interactions/encryptedSortPage.ts`); `pageSize ≤ 100` |
| `GET /api/customers/booking-requests/counts` | same | `{ pending, pendingExpiringSoon, upcomingConfirmed, nextConfirmedAt, accepted30d, decided30d, expired30d }`, scoped like the list |
| `POST /api/customers/booking-requests/{id}/accept` | owner or `manage` | `{ expectedUpdatedAt, person: { mode: 'create' } \| { mode: 'link', entityId } }`; 409 if no longer pending, expired, or stale |
| `POST …/{id}/decline` | same | `{ expectedUpdatedAt, reason?: string ≤ 500 }` |
| `POST /api/customers/booking-requests/bulk` | same (checked per item) | `{ action: 'accept' \| 'decline', items: [{ id, expectedUpdatedAt }] (≤ 100), reason? }`. Enqueues a **`ProgressJob`** (the `core:progress` pattern) and returns `{ ok: true, progressJobId }`; the top-bar progress shows it. The worker runs the single-item command for each item, and each item succeeds or fails on its own; results are stored on the job (`{ id, ok, error? }[]`). Bulk accept uses `person: { mode: 'create' }` for new bookings and **keeps the existing person** for `Pending · reschedule` rows. |
| `POST …/{id}/link-person` | same | `{ expectedUpdatedAt, entityId }` on a confirmed request. Moves the interaction to the chosen person. The auto-created person is soft-deleted only when `countPersonDependents` returns zero (Architecture → Link to existing person); the person-delete command is never used. Otherwise it is kept and the response returns `autoCreatedEntityKept: true`. Undoable. |
| `POST …/{id}/cancel` | same | owner-side cancel; soft-cancels the interaction (existing cancel command) and sends `METHOD:CANCEL` |

### ACL (`acl.ts`, additive)
- `customers.booking.manage_own`: `dependsOn: ['customers.interactions.manage']`, because owners must be able to edit and cancel the meetings their page creates. It is added to `defaultRoleFeatures` for `admin` (already covered by `customers.*`). `employee` gets it **together with** `customers.interactions.manage`, which `employee` does not have today. This is a deliberate default-role change, called out in UPGRADE_NOTES. Roles without `interactions.manage` cannot enable a booking page.
- `customers.booking.manage`: `admin` only (via `customers.*`).

Existing tenants pick these up with `yarn mercato auth sync-role-acls`, which is noted in UPGRADE_NOTES.

### Events (`events.ts`, additive)
`customers.booking_request.created`, `.confirmed`, `.declined`, `.expired`, `.cancelled`, `.rescheduled`, `.person_linked`. Payload: ids only (no PII).

### Notifications (additive)
To the owner:
- `customers.booking_request.pending`, with an **Open request** `href` action to the Meeting requests page with the request preselected. It has no inline Accept/Decline: notification `commandId` actions send only `{ id, …payload }` and cannot carry `expectedUpdatedAt` or the person choice,
- `customers.booking_request.confirmed` (instant booking),
- `customers.booking_request.cancelled`,
- `customers.booking_request.cap_reached` (the owner-wide pending cap was hit),
- `customers.booking_profile.link_changed` (the organization slug changed).

Notification texts carry the date and time only; the booker's name is resolved at render time.

## 📝 UI/UX

### Public page `/calendar/{orgSlug}/{userSlug}/meetings`
Chrome-less: no backend menus, headers or portal nav. It uses the same `@open-mercato/ui` primitives and DS tokens as backend pages (Card, Button, Input, Calendar/day-picker, Badge, Spinner).
- **Header card:** owner initials avatar, owner name · organization name, title, description, a clock icon with "{n} min", the location, and the confirmation mode ("Instant confirmation", or, when approval is on, "{first name} confirms within {deadline} h"). The timezone switcher sits under the calendar and defaults to the browser timezone.
- **Layout:** three columns: header card, then the month calendar, then the slot list.
- **Calendar and slots:** in the month calendar, available days are marked and unavailable days are disabled; prev/next month is limited to the horizon. The slot column shows the selected day's heading, then the slots stacked vertically as full-width buttons (`09:00`, `09:30`, …). Below 900px the columns stack. A small "Powered by Open Mercato" footer sits under the card.
- **Initial state:** the day selected is the visitor-local date of `firstAvailableAt`. With no availability at all, an empty state reads "No times available in the next {horizon} days".
- **Slot picked:** the card switches to a details step. The left column keeps the header with the chosen date, start–end time and timezone, plus a **Back** button. The right column holds the form: e-mail, first name, last name, the consent checkbox (privacy text from `content`), and **Book meeting** (or **Request meeting** when approval is on). Back returns to the slots with the selected day kept.
- **Result:** a centred card showing one of two outcomes:
  - **confirmed:** "You're booked", the invite e-mail address, a meeting summary, an **Add to calendar (.ics)** download built from the `ics` field of the response, and the change hint: Phase 1 says "Need to change it? Reply to the invite e-mail" (the reply goes to the owner), and Phase 3 says "Use the link in your e-mail to cancel or reschedule";
  - **pending:** "Request sent", {name} will confirm by {expiresAt}, an "Awaiting confirmation" badge, and a note that the time is held until then and released if not confirmed.
- **Errors:** `slot_taken` returns to the list with a flash, "That time was just taken", and refreshed slots; 429 shows "Too many attempts, try again shortly".
- **Accessibility:** the calendar has full keyboard navigation (arrow keys and Enter), each slot list is a `role="listbox"` per day, labels are tied to inputs, and form errors are announced through `aria-live`.

### Manage page `/calendar/{orgSlug}/{userSlug}/meetings/manage/{token}`
A summary card shows the owner initials avatar and name, a status badge, the meeting title, date and time, and "Booked as {name} · {email}". It has two actions:
- **Cancel meeting:** opens a confirmation dialog.
- **Reschedule:** opens the same picker with a banner showing the current time ("your current time stays booked until the new one is confirmed"), preselecting the first available day. Picking a slot splits it into [time | **Confirm**]; no form is needed because the booker's details are kept.

The page states the cutoff ("Changes are possible until {cutoff} before the meeting"). After the cutoff both actions are disabled with "This meeting can no longer be changed online — reply to the invite e-mail". When a reschedule is waiting for approval, the card shows "Reschedule requested for {time}, waiting for confirmation", and Reschedule is disabled. Cancelled, declined and expired bookings are shown read-only.

The reschedule picker lives at `/calendar/{orgSlug}/{userSlug}/meetings/manage/{token}/reschedule`.

### Backend: My meeting booking (`backend/profile/meeting-booking`, `pageContext: 'profile'`)
`CrudForm` sections:
- **Public page:** enable toggle; slug ("Your link name") with live validation and a "slug taken" error; a URL preview with **Copy** and **Open** buttons; title; description.
- **Meeting:** slot length, slot interval, location, interaction type (dictionary select).
- **Availability:** timezone; a weekly hours editor with a row per weekday (on/off switch, one or more ranges, add/remove range) and "Copy Monday to all weekdays"; a date overrides list (date badge plus "Day off" or custom hours, with remove and **Add override**).
- **Limits:** minimum notice, horizon, buffers before/after, max per day. The UI shows notice in hours and stores minutes. Each field shows its unit, and its allowed range as hint text (for example "0–720 hours").
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
- **List:** `DataTable` with status tabs (All · Pending · Upcoming · Past · Declined/Expired/Cancelled), search by name or e-mail, a status filter and a meeting-date filter. Sorting puts pending first (soonest deadline on top), then orders by meeting date. A request that expires while the page is open greys out with a "just expired" hint.
- **Bulk actions** (pending rows only): Accept selected (each booker becomes a new person) and Decline selected (one optional reason for all).
- **Columns:** selection (pending rows only); requested meeting (date, time, and a hint for duration, request time, "instant booking" or "moved from …"); booker (name and e-mail); status badge (Pending, Pending · reschedule, Confirmed, Declined, Expired, Cancelled by booker/owner); respond by or outcome (time left, flagged as an error under 3 h, an overlap hint, the decline reason, "not answered within {deadline} h" (the profile's own deadline), who accepted or cancelled and when); CRM person ("Chosen on accept" while pending, a "New from booking" badge on auto-created persons); actions. Users with `customers.booking.manage` also get an Owner column and filter.
- **Row actions:**
  - on a pending request: **Accept**, which opens a dialog with "Create new person" (default) or "Link existing person" (a person picker, with a hint listing persons whose e-mail matches, never auto-selected), and **Decline** (optional reason);
  - on a confirmed request: a row menu with **Open in calendar**, **Link to existing person** (the dialog searches people and explains whether the auto-created person will be removed; the success toast offers **Undo**) and **Cancel meeting**;
  - on declined, expired or cancelled requests: **View details** only (they cannot be re-opened, because the booker has already been e-mailed).
- **Accept dialog:** shows the booker, the slot, the person choice and, when needed, a warning such as "Overlaps with {title} ({time}), added after this request. You can still accept." The button reads **Accept & send invite**.

Dialogs: `Cmd/Ctrl+Enter` submits, `Escape` cancels. The CRM Calendar shows pending requests for the current user as hatched "Pending request" blocks. The calendar data hook `components/calendar/useCalendarItems.ts` fetches them from `GET /api/customers/booking-requests?status=pending&from&to` next to its interactions query, only when the user has `customers.booking.manage_own`, and merges them as a separate item kind. An enricher cannot add rows, so none is used. Pending blocks are visible to the owner and to holders of `customers.booking.manage`, and show "Pending · {booker name}" (the name is resolved for the authorised viewer). Clicking a pending block opens the same Accept/Decline dialog. Confirmed bookings appear as normal meetings titled with the profile title. The calendar's existing conflict badges also cover pending blocks.

## 📝 Edge Cases & Failure Scenarios
| Scenario | Behavior |
|---|---|
| Two visitors submit the same slot at the same time | The per-owner advisory lock plus the offered-slot recheck: the first gets 201, the second gets 409 `slot_taken` and the UI refreshes slots |
| The owner adds a CRM meeting over a pending request's time | Allowed (the backend calendar shows the conflict badge). Accepting later warns "conflicts with {title}" but may proceed |
| The approval deadline passes | Read paths treat the request as expired immediately. The job sets `expired` and e-mails the booker within ≤ 5 min; without the scheduler, status is derived on read |
| The deadline is after the slot start | `expiresAt` is capped at `startsAt` |
| The profile is disabled or the slug changed while a booking flow is open | Submit returns 404 and the page shows "This booking page is no longer available". Existing bookings and manage links keep working (keyed by token, not slug) |
| The owner is deleted or loses access to the organization | Profile resolution requires `deleted_at IS NULL` and organization access; the public page returns 404. Pending requests expire normally |
| A crafted request for a time that was never offered (03:17, a weekend, inside notice, past the horizon, off-grid) | `422 slot_not_offered`; nothing is written |
| Accept and expiry (or two accepts) at the same moment | The conditional update lets exactly one win; the loser gets `409 request_state_changed`, and only one e-mail is sent |
| The person is deleted while bookings point at it | The `customers.person.deleted` subscriber cancels the linked confirmed requests and e-mails the bookers |
| E-mail send fails | The booking stays committed. The subscriber goes through the queue with retry; after the final failure it reports through `reportError` and the owner notification says "invite e-mail failed — send manually" |
| A DST transition on a slot day | Slots are generated in the profile timezone over wall-clock windows; a non-existent local time is skipped and an ambiguous one takes the first occurrence. Unit-tested for Europe/Warsaw and America/New_York |
| Visitor and profile timezones differ by a date line | The calendar widget marks days by the **visitor's** local date of each slot. The slots API returns instants, and the client groups them |
| The booker cancels after the cutoff | 409 `cutoff_passed`; the page says "reply to the invite e-mail" (the reply goes to the owner) |
| A manage token after a reschedule | Instant mode: the same token. Approval mode: the old token stays valid while the new request is pending, moves to the new request on accept, and keeps managing the original meeting on decline or expiry |
| A reschedule under approval | See Architecture → Reschedule: the existing interaction is moved on accept (same UID, higher SEQUENCE, no CANCEL), and the original stays on decline or expiry |
| A second reschedule while one is pending | `409 reschedule_pending` |
| Link to a person that belongs to another organization | 404 (scoped lookup) |
| An abusive volume of requests | Rate limit, origin check and idempotency. Pending requests also count toward `maxBookingsPerDay`. A CAPTCHA plugs in through the form extension point `customers.public-booking.form` plus the `customers.public-booking.verify-submission` hook |
| Organization slug collision across tenants | Enabling is refused with `org_slug_ambiguous`; changing an org slug into a collision is refused by the directory interceptor; runtime ambiguity returns 404 |
| Mass bookings with rotating e-mails from one source | The per-IP open-request cap, rate limit, owner-wide cap (IP-weighted) and the daily outbound-mail cap; the owner is notified at the cap |

## 📝 Risks & Impact Review
| Risk | Severity | Area | Mitigation | Residual |
|---|---|---|---|---|
| A public endpoint leaks a user's schedule | Medium | privacy | Slots expose only free starts, never busy titles or reasons; opt-in; 404s are uniform | Free/busy shape is inferable by design (same as Calendly) |
| Spam bookings fill a user's calendar | Medium | abuse | Rate limits, approval mode, daily cap, manage-token cancel, decline in bulk from the list | No CAPTCHA in v1 |
| Extracting the busy predicate changes conflict-route behavior or its access boundary | Medium | customers API, privacy | Pure refactor; `legacy` mode requires the viewer and applies the e-mail visibility filter before selection; existing conflicts tests stay green; parity tests including private e-mail, conversation share, shared channel and API-key caller | Low |
| PII in booking requests | Medium | GDPR | Encrypted columns, `findWithDecryption`, 90-day anonymisation; no PII in events, notifications, interaction titles or action-log payloads | The auto-created person follows CRM retention, not this job |
| The public form used as a mail relay | Medium | abuse | No booker free text in mails; escaped, truncated names; daily mail cap; per-IP and per-e-mail caps | No e-mail confirmation by product decision |
| Default `employee` role gains `customers.interactions.manage` | Medium | RBAC | Called out in UPGRADE_NOTES; admins can remove it, which also removes booking | — |
| Scheduler not installed | Low | expiry | Derived-on-read expiry; the job is only for status and e-mail; CLI for manual runs | The expiry e-mail and anonymisation need the CLI without the scheduler |
| Org slug not globally unique | Low | routing | Enable-time guard plus exact-one resolution | — |

**Compatibility:** additive, with two behavior changes listed in UPGRADE_NOTES:
- **Additive:** new tables, routes, ACL features, events, notifications and a frontend route. The conflicts route keeps its contract. `people.create` gains optional `transactionalEm` support, and the command runtime gains the optional `ctx.afterCommit` queue (honoured by the bus flush, `emitQueryIndexEvents`, the interactions `emitLifecycleEvent`, and `dataEngine.discardOrmEntityChanges()`); existing callers pass neither and are unaffected. No change to `CustomerInteraction` or its statuses.
- **Behavior change (directory):** the organization update command can now be **refused** (`org_slug_ambiguous_for_booking`), but only when the new slug would make an active booking page ambiguous across tenants. Organizations without active booking profiles are unaffected. Per BACKWARD_COMPATIBILITY.md this is a new failure mode on an existing command, so it is documented with the error code and the workaround (disable the colliding booking profile first).
- **Behavior change (RBAC):** the default `employee` role gains `customers.interactions.manage`. **Rollback:** the preferred rollback is to disable profiles. Data stays, public pages return 404, and the CRM interactions already created remain normal meetings. Reverting the code is possible as well. The migration `down` drops both tables and **loses all booking history**, including the link from interactions back to their requests, so it is a last resort only.

## 📋 Phasing
- **Phase 1: Instant booking (MVP).** Profile settings page, public page, slot engine with the write-side offered-slot gate, busy-time extraction, confirmed bookings with an auto-created person (in one real transaction), `.ics` confirmation e-mail, interaction→request sync (owner changes inform the booker, plus the person-delete cascade), abuse controls shipped **together with** the public write (Step 8), the mail cap, the idempotency table, the org-slug interceptor, and the maintenance job **with its system-scoped schedule and CLI**. Ships on its own: no manage tokens are issued (`manage_token_hash` null), and e-mails say "reply to this e-mail to change the meeting" (`replyTo` = owner).
- **Phase 2: Approval and matching.** `requiresApproval`, the pending lifecycle with conditional transitions, expiry added to the existing maintenance job, owner notifications, the Meeting requests list (counts, bulk as a ProgressJob), accept/decline, Link to existing person with `countPersonDependents`, pending blocks in the CRM Calendar.
- **Phase 3: Booker self-service.** Manage tokens and the manage page, booker cancel, and reschedule (instant and approval semantics, token re-pointing), with `METHOD:CANCEL` and SEQUENCE updates.

## 📋 Implementation Plan

### Phase 1
1. **Entities, validators, migration:** both entities (all columns, so later phases need no migration), zod schemas, `yarn db:generate`; unit tests for the validators (slug, weekly hours overlap).
2. **Busy-time extraction (separate PR):** `lib/booking/busy.ts` with `legacy` (viewer required, e-mail visibility filter applied before selection) and `calendar` modes; the conflicts route moves to `legacy`. Parity tests against existing conflicts fixtures, plus access parity: another user's private scheduled e-mail is neither returned nor title-leaked, a conversation share and a shared channel make it visible, an API-key caller is unchanged; `calendar`-mode tests for participants, recurring, all-day and multi-org.
3. **Slot engine:** `lib/booking/slots.ts` with unit tests (overrides, buffers, notice, horizon, daily cap, DST, first-available scan).
4. **ICS builder:** `lib/booking/ics.ts` with snapshot tests (REQUEST/CANCEL, escaping, UTC times, UID/SEQUENCE).
5. **ACL plus the profile API:** `customers.booking.manage_own`, `GET`/`PUT /api/customers/booking-profile` (slug and org-slug guards, optimistic lock); integration test.
6. **Profile settings page:** backend profile page with `CrudForm` and the preview card; i18n; integration test (enable, slug conflict, preview).
7. **Public read API:** profile resolution, profile and slots routes, rate limit, origin check; integration tests (inactive → 404, range > 44 → 400, `firstAvailableAt` lands on the right visitor-local day for UTC−10 and UTC+13, busy interaction hides slot).
8. **Public request command plus API, with abuse controls:** checkout-style command context (`organizationScope: null` + `selectedOrganizationId`, `syncOrigin`, `replayable: false` with ids-only input and ids-only snapshots), `people.create` `transactionalEm` support, the `ctx.afterCommit` queue (bus flush deferral, `emitQueryIndexEvents`, interactions `emitLifecycleEvent`, `dataEngine.discardOrmEntityChanges()`), client-IP resolution, fail-closed rate limit, per-e-mail/per-IP/owner caps (with the unknown-IP skip), the verification hook, owner advisory lock, `isOfferedSlot` gate, idempotency table, confirm inline (person plus interaction titled with the profile title); integration tests (double submit → one booking, `slot_taken`, 429 caps, unknown-IP requests not pooled into one bucket, 503 with no rate limiter, a forced rollback after interaction creation leaves no person and no interaction, and spies on `eventBus.emitEvent` and the data-engine flush observe **no** CRUD event, no `query_index.*` event and no `customers.next_interaction.updated`; a successful booking emits each of the person `created` event, the person index upsert, the interaction `created` event, the parent projection upsert and `customers.next_interaction.updated` **exactly once, after commit**; unit tests show the shared emit helpers behave unchanged without `ctx.afterCommit`; off-grid/after-hours/inside-notice/past-horizon → 422 `slot_not_offered`, daily cap, idempotent replay, mismatched replay → 422, interaction visible in `/api/customers/interactions`, no booker name in the interaction title or action log).
9. **Confirmation e-mail subscriber:** `.ics` attachment with queue retry, `replyTo` = owner, booker locale, escaped and truncated names; unit test with a mocked `sendEmail`.
10. **Public page UI:** chrome-less frontend page; Playwright test (lands on first available day, picks a slot, books, sees success).
11. **Interaction→request sync subscribers:** snapshot diff and the person-delete cascade; integration tests (owner cancels → request cancelled and CANCEL sent; owner moves the time → SEQUENCE+1 update; two concurrent owner edits send two distinct, increasing SEQUENCE values; a title change → update; an unrelated field change → no mail; the person deleted → requests cancelled and bookers e-mailed; events with the booking `syncOrigin` ignored; the owner moves the interaction to another person → `customer_entity_id` follows; a person delete followed by undo → requests stay cancelled, no re-invite, and the undo toast warns; a booking-linked person-delete cascade also cancels the pending reschedule successor).
12. **Mail cap plus maintenance job:** the daily outbound mail cap (queue tests); the maintenance worker (anonymisation including ended confirmed requests and `client_ip_hash`, plus idempotency-key purge) with one system-scoped schedule and the manual CLI; a test reads the anonymised rows and finds no PII; the org-slug interceptor (refuses a colliding resolved slug, guards undo); tests for it.

### Phase 2
13. **Approval lifecycle commands:** pending create, accept (create/link person), decline via the conditional transitions; events and notifications (no names in texts); accept keeps undo (ids-only `redoInput`, replay enabled, ids-only snapshots); integration tests, including a concurrent accept-vs-expire run where only one wins and one e-mail is sent, and accept → undo: the response carries a usable undo token, undo cancels the interaction and the request and sends exactly one `METHOD:CANCEL`, and the booking command's action-log entry (payload and snapshots) contains no booker e-mail or name.
14. **Expiry in the maintenance job:** derived-on-read expiry; tests (pending past deadline frees slot, job sets `expired` and sends the e-mail, a job racing an accept loses cleanly).
15. **Meeting requests backend page:** `DataTable` with the All/status tabs, counters (`counts` endpoint), the sidebar pending badge, bulk accept/decline (`bulk` endpoint as a ProgressJob), and the accept/decline/link dialogs; integration tests for `counts` and `bulk` (mixed success, stale `expectedUpdatedAt`, reschedule rows keep their person, job progress), and a Playwright test.
16. **Link to existing person:** `countPersonDependents` plus the command and API; soft-delete only (the person-delete command is never called); undo restores the person; integration tests for both branches, including a person with a colleague's comment (kept) and an untouched one (soft-deleted).
17. **Pending blocks in the CRM Calendar:** a same-module fetch in `CalendarScreen` plus rendering; Playwright check.

### Phase 3
18. **Manage token API plus page:** token issue on confirm, `Referrer-Policy: no-referrer`, log redaction, booker cancel with cutoff; integration and Playwright tests.
19. **Reschedule:** instant (same row, same interaction moved) and approval (successor request, token re-pointing on accept, original kept on decline or expiry, `reschedule_pending`); offered-slot gate with the own-booking exclusion (a new time overlapping the current one is offered, and the daily cap ignores the moved booking); the successor has a null `interaction_id` and no reserved sequence; SEQUENCE allocated at acceptance from the live predecessor under the per-owner lock (test: pending reschedule → two owner edits, also run concurrently with the accept → the accept e-mail's SEQUENCE is higher than every edit's); reschedule × cancel cascade (booker or owner cancels the original → the successor is cancelled; accepting a successor whose original is gone → `409 original_booking_gone`); accepting a reschedule is not undoable; integration and Playwright tests.
20. **Manage-link e-mails:** the manage link added to confirmation and update e-mails; Phase 1's "reply to change" copy replaced; tests.

### Integration coverage (must ship with the phases above)
- **API paths:** `booking-profile` GET/PUT; public profile, slots, requests; manage GET, cancel, reschedule; `booking-requests` list, counts, bulk, accept, decline, link-person, cancel.
- **UI paths:** profile settings page; public page booking flow (pick → details → booked/request sent); Meeting requests list: accept/decline per row, bulk, link person; CRM Calendar pending block; manage page cancel/reschedule.

## 📋 Final Compliance Report
- Tenant and organization scoping on every query; the public resolver derives the organization from the slug pair, never from the request body.
- No cross-module ORM relations (`userId` and the org are FK ids only).
- PII is encrypted and read through `findWithDecryption`.
- All writes go through commands; backend forms use `CrudForm` or `useGuardedMutation`.
- Optimistic locking on the profile (`CrudForm`), plus conditional state transitions with `expectedUpdatedAt` on request accept, decline and link.
- Long-running bulk work runs as a `ProgressJob`.
- No PII in events, notifications, interaction titles or action-log payloads.
- No hard-coded strings; DS tokens only.
- Additive contract changes only (BACKWARD_COMPATIBILITY: new routes, events, ACL features, notifications, tables).

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
