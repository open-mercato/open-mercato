# Bookings module for Open Mercato

| Field | Value |
|-------|-------|
| **Status** | Proposed |
| **Created** | 2026-08-10 (version 1), 2026-10-07 (version 4) |
| **Related** | `packages/core/src/modules/planner`, `resources`, `staff`, `customers`, `catalog`, `checkout`; `.ai/specs/2026-07-15-staff-member-directory.md`; `.ai/specs/implemented/2026-05-08-staff-decouple-from-core.md` |

Where the required spec sections are: Overview and Problem Statement — sections 1–3; User Stories —
section 4; Proposed Solution and Architecture — sections 5, 6, 8–11, 15–20; Data Models — section 7;
API Contracts — section 12; Implementation Plan — section 22; Migration & Backward Compatibility —
section 23; Frontend Architecture Contract — section 24; Risks & Impact Review — section 25; Final
Compliance Report — section 26.

This is version 4 of the proposal. Versions 1–3 were reviewed as an official module in
`open-mercato/official-modules` (PR #33). Version 4 moves the module into the core repository and
widens its scope to the whole booking domain, delivered in phases.

**TLDR.** The module adds reservations: who is busy, when, and for what. It finds
reservations that overlap and reservations that fall into unavailability. It warns when a
reservation without dates gets close to its start day. It shows everything on a timeline with
one row per subject. It stands on the existing registries of resources and people, and on the
availability schedules. It adds a read method to the schedules and small additive changes to
`notifications`, `staff` and `customers`, and in phase 2 to `ui` (section 23).

On top of that core it books services from the catalog — people and things needed together, picked
by name or from a pool, at a price — in days, in minutes or in days with their own hours, and opens
public booking pages for customers. Every screen and every decision has an extension point, so a
clinic, a hotel or a rental company is a configuration of the module, not a fork. Phase 1 is the
occupancy core; phases 2–4 add hours, services and self-service booking (section 4).

The module identifier is `bookings`, not `reservations`: in Open Mercato a reservation already
means stock held back in the warehouse. This document keeps the word "reservation" for the
thing the module stores; only identifiers say booking.

---

## 1. Why this module

Open Mercato has no place today that answers the question "is this resource busy?". There is a
calendar of customer meetings in `customers`. An entry there is linked to a customer and can be
linked to other records. But it is a record of a meeting, not of occupancy. It does not know about
unavailability. It does not detect that two meetings take the same resource. Anyone who needs
occupancy writes it alone, from scratch. The reservations module does not replace that calendar.
If a product wants to see a meeting on the occupancy timeline, it creates a reservation for it, or
registers the calendar as an occupancy source, so meetings count as busy time without being copied
(section 20).

**One store of occupancy.** An open pull request on the platform makes the calendar's event types
configurable and shows it with a "visit" type in the `example` module: a visit assigns a staff
member and a resource, takes advisory locks per subject, reads planner's availability and rechecks
clashes among calendar events inside one transaction. That example is a second, small occupancy
engine, and once both exist a doctor could be double-booked between a calendar visit and a
reservation, with neither engine seeing the other. This specification proposes that `bookings` is
the single store of occupancy on the platform:

- as soon as calendar events can carry staff and resources, `bookings` registers the calendar as an
  occupancy source (section 20), so reservations see visits;
- the visit check of the example is the proof of concept whose role `bookings` takes over: the
  calendar's own guard consults the module's occupancy service (section 12) instead of keeping its
  own engine;
- the example's lesson — an authoritative guard must validate the final input, after every
  interceptor — is what the module's shared write path does by construction (section 9).

How the maintainers want the visit example to evolve once `bookings` exists is an open question
(section 21).

A reservation is one sentence: "{subject} is busy from Tuesday to Friday, for {target}".

A subject is the thing that becomes busy. A target is the reason we reserve. On a construction
site the subject is an excavator and the target is the site. In a clinic the subject is a doctor
and the target is a patient. In a rental company the subject is equipment and the target is a
customer.

Three things are needed: a place to store this fact, a warning when two reservations overlap,
and a timeline that shows everything.

None of this depends on the industry. Only **what** is a subject and a target changes. The
mechanism stays the same.

That is why this should be an Open Mercato module, not one more feature locked inside our
application. The product adds its part: what can be reserved, which fields it carries, which
warnings it cares about. Reservations, conflicts, the timeline and occupancy come from the module.

The same holds for selling time. A clinic sells visits, a hotel sells nights, a rental company sells
days of a machine with an operator. Each is a service that takes people and things together for a
stretch of time, has a price in the catalog, and is booked by staff or by the customer on a public
page. Today each product builds this alone too. The module covers it in later phases (section 4).

What we took from the market: the public booking flow of cal.com and Calendly — a link per service,
free slots computed on the server, a request the host confirms; and the resource timeline of
dispatch tools — one row per subject, bars dragged between days. What we did not take: their
calendar sync and their own user model — Open Mercato already has customers, staff and resources,
and the module builds on them instead of keeping its own.

## 2. What the module gives

**Reservations.** An entry: "this subject is busy in this time window, for this target". A
reservation carries its own data: status, how many working days it takes, when it is expected. It
can also exist without dates — as a commitment that has not landed on the timeline yet.

**One place that knows what is busy.** Occupancy lives in the reservations table and nowhere
else. Other modules ask for it through the module's service instead of keeping their own copy.

**Conflict detection.** Two reservations of the same subject that overlap, or a reservation that
falls into an unavailability window. A conflict is visible on the timeline and goes out as an
event, from which the module's notifications are made.

**Early warning about a coverage gap.** A reservation waits without dates, and only X working
days are left until the day it must start. The module says so before it is too late. The
threshold is a setting, not a constant in code.

**View of what is free.** The timeline shows all other subjects of the same category in the same
window, so the dispatcher sees alternatives. This is not a suggestion engine and not automatic
assignment — a person decides.

**Timeline with one row per subject.** One row is one subject, reservations are bars, conflicts
are marked.

**Working calendar of the organization.** Duration is counted in working days, with free
weekdays and holidays. The calendar blocks nothing — work on Saturday is allowed, the arithmetic
only reflects reality.

**Hours and working hours** (phase 2). Reservations in minutes, a warning outside the hours a
subject works, buffers between reservations, an hourly scale and a calendar view.

**Services and pools** (phase 3). A product from the catalog that needs several people and things
at once; "any dentist" instead of one named dentist, picked by round robin; the price on the
reservation; a day with its own hours for hotel nights.

**Public booking pages** (phase 4). A link per service; the customer picks a free slot, staff
confirm, payment through `checkout`.

**Extension points** everywhere (section 20), so a product changes what the module shows and decides
without forking it.

## 3. Where it applies

The same mechanism serves three kinds of subjects:

**Equipment** — excavator, forklift, ultrasound machine, event equipment.
**Space** — meeting room, workstation, service bay.
**People** — a doctor at a visit, a technician on a job, a crew on a site.

The module does not know what a subject is. It sees an identifier, time windows, and nothing
more. The product adds the meaning: what is a target, which fields it carries, which warnings it
cares about.

The same subjects can be sold. A visit takes a doctor, an assistant and a surgery; a hotel night
takes a room; a rental day takes a machine and an operator. The module books them as one service
(section 16).

Thanks to this, building the next reservation product on Open Mercato costs work on the product,
not on the platform.

## 4. Scope and phases

This document specifies the whole module. It is delivered in phases. Each phase ships on its
own and works without the next one. What a later phase needs from the data model, the events
and the API is fixed in phase 1, so a later phase adds tables, nullable columns, routes, screens
and new values of existing lists — a third duration unit, a third conflict mode, a new field on
the conflict object. Nothing released changes meaning.

Phase 1 is delivered first. Phases 2–4 are specified to the same level, so each can be picked up
as its own piece of work.

### Phase 1 — occupancy core

Everything needed to plan equipment and people over days.

**Reservations, conflicts, warnings.** Storing reservations, detecting collisions, warning about
a coming coverage gap. How many days ahead to warn — a setting.

**Working calendar of the organization.** Free weekdays and a list of holidays. The engine counts
in working days but forbids nothing: work on Saturday is allowed, the arithmetic only reflects
reality. One calendar per organization, no exceptions for single subjects.

**Subjects from `staff` and `resources`** through provider plugins, and unavailability read from
`planner` through the read method added to it (sections 5, 6, 10).

**Reservation target.** Light and generic, optionally linked to a customer from `customers`
(section 7.4).

**Several participants per reservation** — in the model, the engine and the API from phase 1.
The screen writes one participant; a second one is a screen change, not a contract change
(section 7.2).

**Timeline with one row per subject.** Day scale.

**Hourly scan, events and notifications** (sections 9, 12).

**Extension points** for every screen of this phase (section 20).

Two contracts are fixed in phase 1 although phase 1 uses only part of them:

- duration carries a unit — working days or minutes; phase 1 writes working days only,
- the reservation create command — and, in phase 4, the public request command — accepts an
  idempotency key, so a repeated submit returns the reservation
  already created instead of a second one. Matching on dates is not enough: two reservations of
  the same target in the same window are a normal case, and an unplaced reservation has no dates.

The idempotency key is defined once, here, for both entries:

```
scope        organization + the user who writes; for a public page, organization + page
stored       the key, a hash of the submitted payload, the reservation it created, when
same key, same payload       the reservation it created, re-read; nothing is written
same key, other payload      409, "this key was already used for another request"
kept for                     twenty-four hours, then deleted for real: every insert first deletes
                             all expired rows of the organization, so no tick is needed and a scope
                             that never writes again does not keep its keys forever (7)
stored answer                the reservation's id, not the response; a repeat re-reads the
                             reservation and answers with its current state
```

The scope keeps keys from meeting across users: on a public page every customer writes through the
same page, so the payload hash is what stops a reused key from returning another customer's
reservation. The keys live in their own table, `bookings_idempotency_keys`, not on the reservation,
so they can expire without touching it. The platform has no shared idempotency helper; the nearest
precedent is the idempotency key of `wms` inventory reservations, with a unique index. Two first
submits with the same key at the same moment race on that unique index: one inserts and writes, the
other hits the unique violation, rolls back its transaction and answers with the winner's
reservation — never with a second one.

Five things can be configured in phase 1:

1. how many days ahead to warn about a coming coverage gap,
2. free weekdays,
3. list of holidays,
4. time zone of the organization,
5. whether a conflict should warn or block the write — by default, and, when needed, differently
   for chosen subject categories.

There is no rules engine behind this.

One thing that is easy to confuse with automatic assignment: **the view of free subjects is in
phase 1.** When a date collides or a target is left without a subject, the timeline still shows
all other subjects of the same category — and a person decides. This comes from the timeline
read filtered by category (section 12), not from a separate suggestion feature. Automatic
picking comes in phase 3, and only from a pool the user chose.

### Phase 2 — hours and calendar views

**Reservations in minutes.** The user gives a start time and a duration in minutes; the end is
computed, as for days. Conflicts compare instants instead of days. Moving to hours needs no data
change, because dates are stored to the second from phase 1 (section 18).

**Working hours.** A reservation outside the hours a subject works warns, the same way a conflict
with unavailability does. The hours come from the availability already defined in `staff` and
`resources` and read from `planner` — the module defines no hours of its own (section 18).

**Buffers between reservations** — a gap a subject needs after one reservation before the next.

**Hourly scale on the timeline**, and a **calendar view** — day, week, month and agenda for one
subject or one target (section 11).

**Second participant on the screen.** The contract has carried it since phase 1.

**Confirming warnings.** A third conflict mode, `confirm`: a write with warnings goes through only
when a user with its own permission confirms the exact warnings the server computed and gives a
reason; the reason is stored on the reservation (section 9).

### Phase 3 — services and pools

**A service is a product from `catalog`.** It says how long it takes, which roles of people it
needs and which types of resources. A reservation of a service takes all of them at once — a
dentist, an assistant and a surgery — and is free only when every one of them is free
(section 16).

**Pools instead of concrete subjects.** A participant can be "any dentist" or "any surgery"
instead of one named subject. Roles come from `staff`, resource types from `resources`. The
module picks a free subject from the pool by round robin; the user can still pick one by hand
(section 17).

**Price.** A reservation of a service carries its price from the catalog pricing, so a visit can
be charged.

**Definition of a day.** A day can run between other hours than midnight to midnight — for
example 15:00 to 11:00 for hotel nights. A room is then a resource, booked by name or from a pool
(section 18).

### Phase 4 — self-service booking

**Public booking pages**, created the way payment links are: a page per service where a customer
picks a slot without logging in (section 19).

**Confirmation.** A reservation made by a customer waits for staff to confirm it; one made by
staff needs no confirmation.

**Payment** through the existing `checkout` module, on confirmation.

### Not planned in any phase

Nobody needs these yet. The data model leaves room for them, so adding them later does not need
a rebuild.

**A rules engine** — configuring conditions and actions per client, without code.

**Qualification matching** — checking whether a subject meets the target's requirements, beyond
the role a pool asks for.

**Cascading moves** — moving one reservation does not move the chain of the next ones.

**Capacity** — one thing taking several reservations at once, up to a limit of seats. A room is
taken by the first reservation, and every next one is a conflict.

**Calendar exceptions for a single subject or target** — one working calendar per organization.
Hours per subject come in phase 2 from `planner`, not from the working calendar.

### User stories and acceptance criteria

Roles: the **dispatcher** plans reservations (`bookings.manage_bookings`); the **viewer** only looks
(`bookings.view`); the **administrator** sets the module up (`bookings.manage_settings`); the
**receptionist** books services for customers (phases 2–4, the same features as the dispatcher);
the **customer** books on a public page without an account (phase 4); the **module author**
builds a product on the module (section 20).

Rules shared by every story below:

- every date is shown in the zone of its owner — a reservation in its target's zone, a window in
  its subject's — with the zone named next to it when the viewer's zone differs (section 8),
- a user without the feature for an action does not see its control; a direct call is refused
  with 403,
- a write made on a record that changed since it was opened shows the platform's conflict bar and
  writes nothing,
- every write on the timeline can be undone from the message that confirms it (section 12),
- every dialog submits with Cmd/Ctrl+Enter and closes with Escape; a dialog with unsaved changes
  asks before closing,
- every list and the timeline have an empty state that says what to do next, a loading state and
  an error state with a retry,
- a refused write says why — the conflict with its other side, the invalid transition, the missing
  settings — never only "could not save".

#### Phase 1 — Epic A: set the module up

**US-A1** As an administrator, I want to set the company's working calendar and time zone, so that
durations and day boundaries match how the company works.
- the screen saves section by section; the zone comes first, and the other sections stay locked
  until it is saved; defaults are shown until the first save, and nothing is written before it,
- a zone outside the standard list or a bare offset is refused with a field error,
- at least one weekday stays a working day,
- changing the organization's zone later changes only the default for new targets and subjects;
  the screen says that existing ones keep their own zones (7.5),
- a new holiday does not move bars already on the timeline.

**US-A2** As an administrator, I want to choose whether a double booking warns or blocks, for the
whole company and for chosen categories, so that doctors cannot be double-booked while equipment only
warns.
- the default mode is `advisory`; an exception per category overrides it,
- a reservation with participants from several categories follows the strictest mode,
- the new policy applies from the next write.

**US-A3** As an administrator, I want to set how many working days ahead to be warned about an
unplaced reservation, so that a coverage gap is seen in time.
- the threshold is a whole number of working days from 0 to 250; 0 warns only on the day itself,
- the new threshold applies from the next scan.

#### Phase 1 — Epic B: keep the lists of what can be reserved and for whom

**US-B1** As a dispatcher, I want to add a new excavator or a new doctor from the module, so that I
do not have to leave it to register them.
- the choice of kind — person, crew or thing — decides the registry; the form asks the name, the
  category and the zone; the record is created in `staff` or `resources` and our row after it,
- without the registry's own create permission the option is not offered,
- if our row fails after the registry record was created, the error names that record and offers
  "add existing"; submitting again does not create a second record (section 6).

**US-B2** As a dispatcher, I want to add equipment or people that already exist in the registries,
so that a company that had them before the module does not retype anything.
- the list shows only records not yet on our list, paged, with a search box; inactive records are
  marked and can be attached,
- adding the same record twice is refused; re-adding a removed one restores its old row and its
  history.

**US-B5** As a dispatcher, I want to take a subject out of use instead of deleting it, so that its
history stays and it gets no new reservations.
- a subject not in use is refused in any new write with `subject_inactive`,
- its open reservations stay on the timeline until moved; its row is shown only while it has a bar
  in the range.

**US-B3** As an administrator, I want to group subjects into categories with an icon and a colour, so
that the timeline rows are easy to scan.
- a category in use cannot be deleted; the message says how many subjects use it, or that a
  policy exception names it,
- a subject whose provider module is disabled stays visible, read-only, marked "unavailability
  unknown".

**US-B4** As a dispatcher, I want to keep targets — a site, a customer — as permanent entries,
optionally linked to a customer, so that every new reservation attaches to the same history.
- a target is picked from the list with a search box; it cannot be typed in on the reservation form,
- the link to a person or company in `customers` is optional; a linked target shows the
  customer's name with a link to their card,
- a target with open reservations cannot be deleted; the message gives their count.

#### Phase 1 — Epic C: plan reservations

**US-C1** As a dispatcher, I want to create a reservation with its duration and expected start and
either put it on the timeline or save it for later, so that I can record a commitment before I know
its dates.
- the end is computed from the start date, the duration and the working calendar; 2.5 days take
  three working days,
- "save for later" creates an unplaced reservation that appears in the unplaced list,
- the conflicts of the new reservation are shown before saving and returned after saving,
- under `reject` a double booking is refused with the other reservation named, and nothing is
  written,
- submitting twice gives one reservation (section 4).

**US-C2** As a dispatcher, I want to rearrange several bars in an edit mode and save them together,
so that I can try a plan before others see it.
- "Edit" switches the timeline to a draft: dragging the middle of a bar moves it, dragging an edge
  changes its length; changed bars are marked; nothing is written yet and others do not see it,
- while dragging, the conflict at the new place is shown before the drop, computed in the browser
  by the same engine as the server,
- a move keeps the duration and recomputes the end; a resize changes the duration in steps of half
  a day,
- "Save" sends all changes as one command and one undo entry; under `reject` a refused one stays marked
  in the draft with the refusal, the others are saved; "Discard" drops the draft, and leaving with
  unsaved changes asks first,
- a viewer has no "Edit".

**US-C3** As a dispatcher, I want to take a placed reservation off the timeline when its date falls
through, so that it waits in the unplaced list instead of holding a wrong slot.
- "Unplace" clears its dates and keeps its duration and expected start; it is refused for a closed
  reservation,
- the slot is freed at once, and the coverage warning counts again from the expected start.

**US-C4** As a dispatcher, I want to place an unplaced reservation from the list onto a subject's
row, so that a commitment gets its dates.
- dropping it on a row and a day places it there and clears its coverage warning,
- its notification of a coverage gap disappears when the target has no other unplaced reservation
  inside the threshold.

**US-C5** As a dispatcher, I want to close a reservation as completed, cancelled or no-show, and to
undo a mistaken close, so that the timeline shows what really happened.
- only the transitions of 7.1 are offered; any other is refused with a clear message,
- closing frees the slot at once; reopening a completed or no-show reservation is checked like a
  new placement and can be refused under `reject`,
- a cancel can be undone by the user who made it, from the message that confirms it or from the
  audit log, or by an administrator; otherwise cancelled is final, has no "Reopen", and the screen
  says that a restart is a new reservation.

**US-C6** As a dispatcher, I want to see the whole reservation — target, subject, dates, status,
note and its conflicts with the other side — in one card, so that I can decide without opening
anything else.
- the card opens from a bar, from the unplaced list and from a notification,
- each conflict names its kind and what it collides with,
- the card offers only the actions the user's features allow.

**US-C7** As a dispatcher, I want to enter an inspection or a breakdown of a subject from the module,
so that I do not leave the timeline to block a machine.
- the window is written to `planner`; without `planner`'s right to manage availability the form is
  not offered,
- after the save the conflicts the window creates are shown at once.

#### Phase 1 — Epic D: see what is busy and what needs attention

**US-D1** As a dispatcher, I want a timeline with one row per subject, reservations as bars and
free days and unavailability in the background, so that I see the whole picture at once.
- it opens on two days back and a week in total; the range can be set up to 366 days and reset;
  rows are paged,
- a reservation with two participants is a bar in each row and moves as one,
- the view refreshes by itself when someone else changes a reservation,
- the timeline library loads only on this screen.

**US-D2** As a dispatcher, I want to filter the timeline by category, to only rows with a conflict,
and to hide unavailable subjects, so that I find a free excavator or the morning's problems fast.
- the category filter shows all subjects of that category, with and without bars, so a free one is
  visible,
- "only conflicts" leaves only rows with at least one conflict,
- "hide unavailable" drops subjects with an unavailability window in the range.

**US-D3** As a dispatcher, I want a list of unplaced reservations with how many working days are
left, so that I see what is close to its start without a slot.
- each item says "in N days" or "overdue", counted from today in the target's zone; the count
  changes without a reload,
- the list is paged and sorted by the days left.

**US-D4** As a dispatcher, I want a notification when a conflict appears or a coverage gap comes
close, and to have it go away when the problem is gone, so that my list holds only what is still
true.
- two conflicts of the same subject merge into one notification; gaps merge by target,
- a dismissed notification does not come back the next morning,
- a notification disappears for everyone once the conflict or the gap is gone, by a write or by
  the scan,
- only holders of `bookings.manage_bookings` in the organization get them.

**US-D5** As a viewer, I want to see the timeline, the lists and the cards without being able to
change them, so that I can follow the plan safely.
- no write control is shown; dragging does nothing,
- notifications are not sent to viewers.

#### Phase 1 — Epic E: build on the module

**US-E1** As a module author, I want to add fields, columns, panels and checks to the module's
screens and writes without forking it, so that my product fits its business.
- every form, table and screen of phase 1 is a declared extension host and appears in the generated
  catalog,
- a product rule on a mutation guard, a command interceptor or a "before" lifecycle event can
  refuse a write with its own message,
- a replaced reservation bar or card renders in place of the built-in one.

**US-E2** As a module author, I want to ask which subjects are busy in a range, so that my module
can plan around reservations without its own copy.
- the occupancy service answers in bulk, open reservations only, at most 366 days,
- another organization's reservations are never returned.

#### Phase 2 — Epic F: hours and calendars

**US-F1** As a receptionist, I want to book a visit in minutes at a given hour, so that a ninety-minute
visit takes exactly that.
- the end is start plus minutes, also on a free day,
- two visits on one day conflict only when their hours overlap.

**US-F2** As a receptionist, I want a warning when I book outside the hours a doctor works, so that
I do not promise a slot nobody covers.
- the warning names the hours; a subject with no hours defined is not checked, and the screen
  says so once.

**US-F3** As a receptionist, I want a day, week, month and agenda view of one doctor or one
customer, so that I see their schedule the way a calendar shows it.
- entries sit on their targets' days, also for a viewer in another zone,
- moving an entry works as on the timeline.

**US-F4** As an administrator, I want the mode "confirm warnings", so that a booking with any
warning needs a deliberate decision with a reason.
- the write stops with the list; a user with `bookings.override_conflict` confirms it with a reason,
- if the list changed in the meantime, the new list is shown and nothing is written.

**US-F5** As a dispatcher, I want to add a second participant with a role, so that a visit takes a
doctor and a room together.
- the reservation conflicts if any participant does; cancelling frees all of them.

#### Phase 3 — Epic G: services

**US-G1** As an administrator, I want to make a catalog product bookable by giving it a duration,
a price basis and the people and things it needs, so that staff book the service, not its parts.
- the section is edited on the product screen; a product without it is not bookable.

**US-G2** As a receptionist, I want to book a service and let the module pick a free dentist and a
free surgery, so that I do not search for them by hand.
- every requirement is filled by a different free member, picked by round robin,
- I can still pick a member by hand,
- when a requirement has no free member, the message names it and nothing is written.

**US-G3** As a receptionist, I want the first free dates for a service, so that I can offer the
customer a slot on the phone.
- only starts where every requirement is free are listed, on the grid, within ninety days.

**US-G4** As an administrator of a hotel, I want nights that run from 15:00 to 11:00, so that a room is free for
cleaning between guests.
- three nights from 1 June end on 4 June at 11:00; the next guest can arrive at 15:00.

#### Phase 4 — Epic H: self-service booking

**US-H1** As an administrator, I want to create a booking page with its services and rules and get
its link, so that customers can book without calling.
- the page has the settings of section 19 with their defaults; an inactive page takes no requests.

**US-H2** As a customer, I want to pick a service, optionally a person, and a free slot, and leave
my details, so that I can book in a minute.
- only really free slots are shown; when the schedules cannot be read, none are shown and the page
  says to call,
- a slot taken a second earlier gives "this slot was just taken" and other slots,
- after sending I see that the request waits for confirmation.

**US-H3** As a receptionist, I want to confirm or decline a request and decide which customer it
belongs to, so that bookings land in the right history.
- the confirmation shows the people matching the e-mail or the phone; I link one, create a new one
  or leave it unlinked,
- confirming sends the customer an e-mail with the details, and a payment link when the page asks
  for payment.

**US-H4** As a customer, I want to know when my request is not confirmed in time, so that I can
book elsewhere.
- a request expires after the page's time, frees the slot and sends me an e-mail.

## 5. What the module stands on

The module does not build everything from scratch. It adds a reservations layer on top of what
Open Mercato already has.

**`resources` — registry of things.** Equipment, rooms, vehicles. We do not write our own
registry. Required.

**`planner` — unavailability.** One table of rules for all subjects, told apart by a type column:
`member` (a team member — our kind `person`), `resource`, or `ruleset` (a schedule). Required —
and it comes anyway together with `resources`, which needs it.

**`staff` — registry of people. Optional, and soft.** Besides the registry of people it gives two
things. An approved leave request becomes unavailability in `planner` by itself, so a doctor on
leave disappears from the available ones with no work on our side. And it gives the access service
without which `planner` refuses every rule write: planner's check asks for it, only `staff`
registers it, and without it planner answers 403 `staff_module_not_loaded` — even for an excavator
inspection.

The module still does not declare `staff` as a requirement. `staff` is optional and slated to leave
`packages/core` for its own package; its guide says core modules must not depend on it directly, and
a hard requirement would stop the application from building once it moves. So the dependency is
soft, the way the platform couples to an optional peer:

- the `staff` and `staff_teams` provider plugins read team members and teams only through a
  read-only service that `staff` registers in the container — the narrow directory service its own
  guide prescribes for consumers like this one (a proposed spec of `staff` already defines its first
  method; this change adds the list and lookup this module needs). The plugins resolve it softly and
  are not registered when it is absent; they never import `staff` entities or read them through the
  query engine,
- without `staff`, the module works for things only: people and crews are not offered, the
  unavailability form is hidden, and the timeline marks unavailability of existing person rows as
  unknown. Planner's 403 is planner's documented degradation; the module does not paper over it.

Who has the right to write unavailability is a separate question of permissions (section 10).

**`events` and `notifications` — notifications.** The module only announces that something
happened. Delivery is done by the existing infrastructure.

**`scheduler` — job scheduler. Optional, and soft.** It starts the hourly scan: the scan looks for
reservations that are running out of time and computes conflicts with unavailability windows that
announced themselves with no event — from planner's editors and from our own form (section 9). The module registers **one system-scope entry** — no tenant, a
fixed UUID — from its `seedDefaults` hook, and only when the scheduler service is in the container,
the way `customer_accounts` does. `seedDefaults` runs once per tenant; the scheduler upserts by
the id, so every run after the first touches the same row. Only a system entry lets the worker walk
every organization, and it does not count against the scheduler's per-tenant limit. Without the
scheduler the hourly tick never comes, and
everything that rides it stops:

```
coverage warnings and their notifications            phase 1
notifications of conflicts with windows that send no event   phase 1 — HR leaves still come
                                                     through the planner subscriber
removal of notifications that are no longer true     phase 1 — writes still remove theirs
the expiry safety net for page requests              phase 4 — the delayed jobs still run
clearing contact details after the retention         phase 4
```

The screens still compute everything on read, and the settings screen says the scan is off. The
idempotency keys do not depend on the tick: every insert deletes the organization's expired keys
first, so the table holds at most a day of keys per organization. The job queue itself is a platform library,
not a module — it needs no enabling and no declaration.

Permissions, dictionaries, search and the audit log come from the platform.

More modules are optional — one in phase 1, the rest in later phases. When one is disabled, only
the feature built on it is off, and the rest of the module works.

**`customers`** — the person or company a target can be linked to (phase 1, section 7.4).

**`catalog`** — services and their prices (phase 3, section 16).

**`checkout`** — payment links for confirmed requests (phase 4, section 19).

**`customer_accounts`** — the optional customer login on public pages (phase 4, section 19).

### All dependencies in one place

This table is the one list; section 14 refers to it.

| Module | Kind | Declared how | What breaks without it |
|---|---|---|---|
| `resources` | required | declared directly | nothing to reserve |
| `planner` | required | declared directly; `resources` requires it too | no unavailability |
| `staff` | optional, soft | its read service resolved when present; never declared | no people and crews; planner refuses rule writes, so the unavailability form is hidden |
| `scheduler` | optional, soft | its service resolved when present | no hourly scan, so none of the jobs listed above (5) |
| `events`, `notifications` | platform | always present | — |
| job queue | platform library | not a module, no declaration | — |
| `customers` | optional, phase 1 | soft dependency, resolved when present | targets cannot be linked to customers |
| `catalog` | optional, phase 3 | soft dependency | no services, no prices |
| `checkout` | optional, phase 4 | soft dependency | public pages without payment |
| `customer_accounts` | optional, phase 4 | soft dependency | public pages without customer login |

### What we must add to `planner`

Writing unavailability works fully today: `staff` creates rules by itself when a leave request is
approved. Reading is missing — `planner` exposes nothing that answers the question "when is this
subject unavailable". The only public function computes the opposite — when a subject is
available — and for equipment with no work schedule it returns nothing.

So the contribution adds one read method to `planner`: "give the unavailability windows for these
subjects in this date range". The change is additive only — it touches no data, changes no
behaviour of existing screens, and widens no type list.

The method takes the tenant and the organization, a date range, and a list of subjects. Each
subject is a type, an identifier, and — if the subject has one — the identifier of its assigned
schedule. Why this split: a rule can hang in two places, on
the subject itself or on a schedule. Which schedule a subject has is known only by its registry
(`resources` for equipment, `staff` for people), and those modules sit **above** planner —
planner cannot reach into them, and the schedule column in those registries is a bare identifier
with no relation to join through. So the caller passes the schedule, and the provider plugin
(section 6) reads it from its own registry. In return, planner decides the precedence between the
subject's own rules and the schedule. The rule, as the server will implement it: **the subject's
own rules when it has any, otherwise the schedule's rules.** The availability editor shows a third
condition, but that is screen state: customising copies the schedule's rules onto the subject,
after which the subject has its own rules. Skipping schedules would mean an inspection entered
from the resource card is invisible to us.

The second thing the method does differently from the public availability function: it turns
one-off rules into windows. An approved leave is exactly a set of one-off rules, one per day, and
the public function never turns them into windows — it diverts one-off rules into override days
and expands only repeating ones — so through it a person on leave gives no window at all. Planner
does have an unused branch for one-off rules, but it snaps the window to the UTC day, and that
throws away the midnight the author used — exactly the information section 8 needs to place the
window on the right day. So our method expands a one-off rule as it is stored, start plus
duration, on its own path; it does not reuse that branch, and it leaves the availability
function alone, because its handling of one-off rules is what the availability side depends on.

The result is flat windows: subject, from, to, and the time zone of the rule the window came from,
as stored on the rule — the method resolves nothing, and section 8 decides whether that zone is
used. The conflict engine does not know whether a window came from a recurring rule, from a
schedule or from a leave.

The method lives on the availability service that planner already registers in the container;
that service has no production callers today, so the addition changes nothing that runs.

From phase 2 the same method returns a second list: the **working windows** of the same subjects in
the same range, computed from their availability rules by the availability function planner
already has (section 18). One question, one read of the rules, two answers.

**The module and the method live in the same repository.** The method is part of this
specification and ships with phase 1, in the same change as the module — there is no version of
core with the module and without the method.

Rejected paths, for the record: copying the rule expansion code to our side would mean two copies
of the same logic that drift apart. Reading through the search index is not fit for conflict
detection, because the index catches up with a delay. Our own unavailability table would mean a
doctor's leave entered in HR is invisible to the engine.

## 6. Where subjects come from

A subject rarely comes into being in the reservations module — the doctor is already in HR, the
excavator in the equipment registry. The module should see one list of things to reserve, no
matter where they come from.

### Own list of subjects

The module keeps its own list. A row holds only what is needed to reserve: where the subject
comes from, its identifier in that registry, a name to display, a category to group timeline
rows, and whether it is still in use. No contact data and no equipment details are here — the
truth stays with the provider. The name copy follows its source on encryption: `staff` does not
encrypt team member names, so our copy of a person's name is not encrypted either; a provider
whose registry encrypts names marks the copy for encryption when it registers.

Thanks to this, a reservation always points at one kind of row, and the engine, the timeline and
conflict detection do not branch on the subject type.

### Providers

A provider is a plugin that translates between the module and one registry. The module asks it
four questions in phase 1, and a fifth from phase 3 — which subjects belong to a role or a type
(section 17):

- **create a new subject** — the plugin writes a record in its registry and returns the
  identifier,
- **what is its name and where is its card** — to show on the list and on the timeline,
- **when are these subjects unavailable in this date range** — one question about many subjects
  at once; the answer is flat windows for the conflict engine, each with the zone of its rule
  (section 5), or with no zone when the registry has none,
- **list what you have** — a paged list of records, from which an existing subject is picked.

The module ships three plugins:

```
resources     equipment, rooms, vehicles      kind resource   new records through resources' create command
staff         people                          kind person     new records through staff's team-member command
staff_teams   crews — a staff team             kind team       new records through staff's team command
```

The `staff` plugin gives leaves for free, because an approved leave request becomes unavailability
by itself. A crew on a site — section 3 names it among the people a reservation holds — is a team
in `staff`, not a team member, so it needs its own plugin. Planner schedules members and
resources, not teams, so a team has no availability of its own: the `staff_teams` plugin answers
the unavailability question with "unknown", the timeline marks the row so, and the unavailability
form offers no schedule for a team. Whether a team's unavailability should follow from its members
is left open (section 21).

A new record is created under the registry's own permission — `resources.manage_resources`,
`staff.manage_team` — checked before the provider's command runs, so the module never becomes a
side door into another registry. Undoing an add removes only our subject row; the registry's
record stays, because other modules may already use it.

A product can add its own plugin if it keeps subjects elsewhere. A new kind of subject needs no
change in the screens or in the engine.

A plugin registers under a name — the same name that later sits in the "provider" column.
Registration goes through the plugin registry of the reservations module, and the reservations
module asks the registry for a plugin by name or for the list of all of them. This is the same
pattern Open Mercato uses to register shipping carriers and currency rate sources — not a key in
the dependency container, because one key there holds one implementation, and there are many
plugins. The three built-in plugins are registered by this module itself, from its own dependency
setup — the dependency points from `bookings` to `resources` and `staff`, never back, so those
modules stay unaware of reservations. A
third-party plugin is registered by the module that owns its registry. The name is short and
stable: `resources`, `staff`, and for foreign registries the identifier of their module. When a
plugin is missing because its module was disabled, the subjects of that provider stay visible,
but read-only.

### How the built-in plugins read their registries

Three of the four phase 1 questions are reads — the subject's name and card, the paged list behind
"add existing", and its unavailability, for which the plugin first reads the schedule assigned to
the subject. The two registries are reached
differently, because they have different standing:

- **`resources`** stays in core and is a declared requirement. It registers no read service, so the
  `resources` plugin reads its entities through the platform's query engine. The engine reads the
  entity's own table, live, and joins the search index only for custom fields; the plugin asks for
  none — the name, the schedule and the resource type are base columns, so a change made a moment
  ago is seen at once.
- **`staff`** is optional and on its way out of core, and its guide says other modules reach it
  only through its public surfaces. It has no listing service today — what it registers checks
  access or computes time tracking. A proposed `staff` spec defines a read-only directory service
  for another consumer; this change adds two methods to it: list team members or teams of an
  organization with a search, and look them up by id, returning the name, the card link, the
  schedule id, the role ids and whether they are active, scoped by tenant and organization and
  decrypted through the platform's helpers. The `staff` and `staff_teams` plugins use only that
  service.

Importing a foreign entity class would make a compile-time dependency across a module boundary,
and server-to-server HTTP is not a platform pattern. Writes to the registries go through the
command bus, which finds the handler by the command name, so no import of `resources` or `staff` is
needed on that side either.

**Reading a registry needs that registry's permission.** Listing candidates for "add existing" shows
records of another module, so it requires the registry's own view feature — `resources.view`,
`staff.view` — on top of `bookings.manage_bookings`; creating a new record requires its create
feature. A provider declares both features when it registers, so a third-party provider cannot list
its records to users its own module would refuse. The query engine does not apply another module's
access rules by itself; the plugin checks the feature before it reads.

**Soft at compile time too.** Resolving the `staff` service softly at run time is not enough: if the
module imported the service's type from `staff`, the build would break the day `staff` leaves
core. So `bookings` declares the directory contract as its own local type, describing only what it
calls, the way `planner` declares its own type for the access service it resolves and
`customer_accounts` its own type for the scheduler. It checks the registration before resolving.
No shared contract folder exists on the platform, and no platform test catches a cross-module
import, so the module adds its own import-boundary test that fails on any import from the `staff`
module — the same kind of test it keeps for the timeline library and the date adapter.

**Names stay fresh through the registry's events.** The name on our row is a copy (7.3). Each
built-in plugin subscribes to the update events of its registry's records — the CRUD events of
resources, team members and teams — and refreshes the copy of every subject that points at the
record. When the registry's module is disabled, the last known name stays.

The `resources` and `staff` plugins answer the unavailability question the same way: they take the schedule of
each subject from their registry and ask the read method in `planner` (section 5). The question
is part of the contract so that a foreign registry can answer differently — for example from its
own calendar.

### How it looks in the interface

There is one list of subjects — excavators, doctors and rooms side by side, with a column that
says what each one is.

When adding, there is one choice of kind: a person, a crew or a thing. A person goes to the HR
registry as a team member, a crew to the HR registry as a team, a thing to the resources registry.
The form asks only what reservations need — the name, the category and the zone. Everything else
about a doctor or an excavator is described in its own registry, which the subject's card links
to; the module does not copy those forms.

The choice is made once and saved in the row. Later nobody guesses anything.

The second path is adding something that already exists. A company that kept equipment and
people before enabling reservations picks them from the provider's list and fills no form — only
our row is created. This is a normal case, not an exception. The list shows records not yet on our
list, with a search box, paged; records the registry marks inactive are shown as such and can still
be attached.

**A subject is never removed, only taken out of use.** Its history stays. A subject not in use takes
no new reservations: any later write that lists it is refused with 400 `subject_inactive`. Taking it
out of use is allowed while it still has open reservations; their bars stay, and the dispatcher
moves them to another subject. A subject is removed only by undoing its own addition. Re-adding a
removed one restores its old row, sets it back in use and takes its name fresh from the registry.

### Writes to foreign registries

The module creates a record in the provider's registry when that is the only place where the
thing should exist. Without this it would not be self-sufficient: adding a doctor would need a
trip to another module.

What it never does: it never copies its own truth into foreign tables. Reservations, occupancy and
conflicts live only in the module. Writing in two places without a shared transaction risks a
reservation that exists while the other module does not see it.

Adding a subject is two writes in two modules, and there is no shared transaction over them. The
order is fixed: first the record in the provider's registry, then our row. If the second step
fails, a record stays in the registry with no entry on our side. We do not hide this: the user
sees an error that carries the identifier of the record already created, and the record can be
attached by the second path — "add existing". Sending the
form again would create a second record at the provider, so after such an error the screen does
not repeat the write; it offers to attach the record that was already created. The pair
"provider + identifier" is unique among our rows, so one provider record cannot be attached
twice.

Creating a record in a foreign registry is subject to that module's permissions, not ours. Who
can add a subject depends on the permissions to the registry of people or resources.

### When the provider's module is disabled

The subject row stays, and the reservation history does not break. The subject stops being
available for new reservations, and its name comes from the last remembered state. Its
unavailability is unknown from that moment — there is no plugin to ask — so the timeline marks
the row as "unavailability unknown" instead of showing it as free, and the scan skips conflicts
with unavailability for that subject.

## 7. Data model

All tables of the module look alike. The primary key is a UUID. Every row belongs to an
organization and a tenant, and every query filters by both. There is also a creation date, a last
change date and a deletion field — we do not delete rows from the database, we mark them as
deleted. The last change date has one more role: the system uses it to detect that two people
edited the same record at the same time.

Some tables are exceptions, each for its own reason. `bookings_settings` has no deletion field
(7.5). `bookings_idempotency_keys`, `bookings_reported_conflicts` and `bookings_scan_state` are the
module's bookkeeping, not records anyone edits: their rows are removed for real when what they
record is gone or has expired (sections 4, 9), and they have no last change date used for locking.
`bookings_holidays` and `bookings_conflict_policy_exceptions` are removed for real as well: the
settings screen sends each list whole and the save replaces the stored rows, so a holiday removed
and added again for the same date never meets a soft-deleted twin under its unique index.
`bookings_pool_cursors` (phase 3) is bookkeeping of the same kind.

The two proof records — the confirmed warnings on a reservation (phase 2) and the consent proof of a
page request (phase 4) — are the only `jsonb` in the module: each is a snapshot that is written
once, read whole and never queried by its parts, the shape `checkout` keeps for its consent proof.

Table names start with the module name and are plural, as everywhere in Open Mercato:
`bookings_bookings`, `bookings_participants`, `bookings_targets`, `bookings_settings`,
`bookings_subjects`, `bookings_subject_categories`, `bookings_holidays`,
`bookings_conflict_policy_exceptions` in phase 1; `bookings_services`, `bookings_service_requirements` and
`bookings_pool_cursors` in phase 3 (sections 16, 17); `bookings_pages` and
`bookings_page_requests` in phase 4 (section 19); `bookings_idempotency_keys`,
`bookings_reported_conflicts` and `bookings_scan_state` in phase 1 (sections 4, 9, 7.5).

Columns that a later phase brings are marked with that phase below. Each one is nullable or has a
default, so its migration adds and never rewrites.

Every list in the module is a table or a set of typed columns, and `jsonb` is used only for the two
write-once proof snapshots named below: nothing else has a variable shape, and `jsonb` would only
cost the types and the constraints. So the later-phase lists are tables too: the allowed subjects of
a service requirement (phase 3) and the services of a booking page (phase 4) are join tables,
`bookings_service_requirement_subjects` and `bookings_page_services`. A list of variable
length that one row points at — holidays, policy exceptions, categories — is a table, because the
database schema only grows: splitting a column into a table after the first release is a
migration of meaning, adding a table is not.

### 7.1 Reservation

| Column | What it holds |
|---|---|
| target | pointer to a target row; required |
| from / to | time window as instants; for working days the start of the first day and the start of the day after the last one, in the target's time zone; both empty means the reservation waits to be placed |
| status | planned, active, completed, cancelled, no_show |
| duration | a value and a unit: working days in steps of half a day, or minutes; days with their own hours from phase 3 (section 18) |
| expected start | the date by which the reservation must be on the timeline; always required |
| last reported warning | the state at the last signal: the number of working days left, 0 on the expected start day itself, or "overdue"; empty when nothing was reported |
| note | free text; a preferred date range, when there is one, is written here — a field of its own may come later |
| override reason | phase 2: why a user wrote it despite the warnings, and which warnings they confirmed |
| service, service name | phase 3: the service it books and a copy of its name (section 16) |
| price | phase 3: unit price, currency, price kind and total, copied when it is made (section 16) |
| page, confirmation | phase 4: the public page it came from, and awaiting, confirmed, declined or expired; empty for reservations made by staff (section 19) |
| paid | phase 4: when the payment link was paid (section 19) |

**A reservation without dates is a normal state.** A commitment that has no window yet — in the
interface "unplaced". It is not broken and not wrong.

**Status is not the same as placement.** A reservation can be active and still unplaced, or only
planned but already on the timeline.

Statuses split into open (planned, active) and closed (completed, cancelled, no_show). No-show
is the third way to close: the target did not turn up. The slot is freed, but the work was
neither done nor called off, so reports count it apart from cancellations. Allowed transitions:

```
planned    → active                     someone confirms the work has started
open       → completed | cancelled | no_show
                                        closing is allowed from any open state
completed  → planned | active           undoing a mistake
no_show    → planned | active           undoing a mistake
cancelled  → nothing                    terminal state; a restart is a new reservation
```

Every other transition is rejected. Occupancy and conflicts count only open reservations.
Bringing a completed or no-show reservation back to open restores occupancy and follows the
same rules as placing (section 9).

The matrix is about status changes a user asks for. Undo is not a status change: undoing a cancel
restores the reservation as it was, under the same checks as any write (section 12). The user who
cancelled can undo it, from the message that confirms it or from the audit log, and so can a user
allowed to undo others' actions (section 12, Undo); since a cancelled reservation takes no other
write, the cancel stays its author's latest entry on it and stays undoable. No status change
reopens a cancelled reservation. On a closed reservation, undo of any entry other than the closing
status change — a create, a move, an edit, by anyone — is refused with 422 `booking_closed`.

**Unplacing.** A placed, open reservation can be taken off the timeline: its dates are cleared, its
duration and expected start stay, and it waits in the unplaced list again. The slot is freed, and
the coverage warning counts from the expected start as for any unplaced reservation. A date that
falls through is common in dispatch, and keeping a wrong bar until a new date is known would hold
a slot that is not needed.

**Changing the target of a placed reservation** keeps its start as a local date and recomputes its
window in the new target's zone (section 8), then checks conflicts again, like a move.

**A reservation is never deleted by a user.** Cancelling is the way out, because a cancelled
reservation keeps its history and counts in reports. The only path that removes one is undoing its
creation. Placing an already placed reservation is refused with 422 `booking_placed`, and moving an
unplaced one with 422 `booking_not_placed`; resizing an unplaced one is allowed and changes only its
duration.

**Limits.** A duration in working days is at most 365; a note at most 2000 characters; every name
at most 200. The reservation form proposes today as the start and as the expected start, and one
working day; the expected start is its own field and is not copied from the start afterwards.
Busy subjects are marked in the subject picker but can still be picked — under `advisory` that is
a decision, not a mistake.

**A closed reservation is read-only.** On a completed, no-show or cancelled reservation every
write except a status change is refused with 422 `booking_closed`: the dates, the length, the
target, the participants and the note of a finished reservation do not change. To correct one, it
is reopened first, and reopening runs the conflict check like a placement.

A person or the product changes the status, never the passing of time. The module does not flip a
reservation to "active" at midnight on the start day — it could not do that for a reservation
without dates.

**Interval bounds.** An interval is closed on the left and open on the right: "to" is the start of
the day after the last working day. Two intervals conflict when one starts before the other ends
and ends after the other starts — touching intervals do not conflict. The same rule works for
reservations and for unavailability windows.

**Duration is the input, the end is computed.** When placing, the user gives the start day, and
the server computes the end from the duration and the working calendar. "Resizing" a bar changes
the duration, and the end is computed again. The end is never given directly, so the three fields
cannot drift apart.

**Half a day on a day scale.** A half extends the end by a full day: 2.5 days take three working
days on the timeline, and the last one is a half day. Conflicts count whole days — two half-day
reservations on the same day are a conflict, because on a day scale we cannot tell morning and
afternoon from morning and morning. So the half is information for planning and totals; it does
not decide occupancy. Half days exist only in the unit "working days"; a reservation in minutes
has its real hours (section 18).

Four things are guarded by the database itself: the from/to pair is set fully or not at all, "to"
is after "from", the duration is positive and, in working days, goes in steps of half a day — the
numeric type alone would let one third through — and one subject appears at most once in one reservation, by
a unique index on reservation and subject (7.2). We declare these constraints on the entity, not
by hand in the migration. A constraint added by hand does not reach the saved schema snapshot and leaves a drift
that nothing fixes later.

The expected start is not part of these constraints, because it is always required. The coverage
warning is counted from it, so a reservation without it would be invisible to alerts. The form
proposes one (see Limits above), and the user can always change it.

### 7.2 Reservation participants

| Column | What it holds |
|---|---|
| reservation | which one it belongs to |
| subject | pointer to a row in the subjects list (section 6) |
| role | performer, place, supporting equipment |
| requirement | phase 3: which service requirement it fills, when the reservation books a service (section 16) |
| picked automatically | phase 3: whether the module picked it from a pool (section 17) |

The role comes from a closed list. The phase 1 screen always writes "performer". The
same subject cannot appear twice in one reservation — it would conflict with itself.

The reason: one reservation can take several things at once. A visit takes a doctor and a room, a
service job takes a bay and a technician. If the subject sat in a column of the reservation, the
only way out would be two separate reservations. Then cancelling one leaves the other busy,
because nothing ties them together.

**The model, the engine and the API take a list of participants from phase 1.** The
write commands accept one or more participants, each with a role; at least one is required.
The occupancy service, the timeline read and the conflict read answer per participant. Only the
phase 1 screen writes exactly one participant, with no field for a second one. Adding
that field in phase 2 is a screen change: the routes, the events and the tables do not move, so no
consumer built on them has to follow.

The engine counts occupancy separately for each participant. A reservation is in conflict if at
least one of its participants is. Cancelling the reservation frees all of them at once; removing
one participant leaves the others in place.

### 7.3 Subjects

| Column | What it holds |
|---|---|
| provider | which registry the subject comes from |
| provider id | its key in that registry |
| name | a copy of the name, to show on the list and the timeline |
| category | optional pointer to a row of `bookings_subject_categories` (below) |
| kind | person, resource or team — what the provider registers (section 6) |
| time zone | the zone the subject's unavailability is read in; written from the organization's zone when the row is created (section 8). It can be edited at any time — no stored instant of ours depends on it — and the form warns that the days its existing unavailability lands on may shift |
| in use | whether it can still be reserved |

`bookings_subject_categories` — the module's own dictionary of categories, to group timeline rows
and to carry the conflict policy exceptions (section 9) and, from phase 2, the buffer (section 18):

| Column | What it holds |
|---|---|
| name | unique per organization, case-insensitive, among non-deleted rows |
| icon, colour | how its rows look on the timeline |
| buffer | phase 2: minutes after each reservation of its subjects (section 18) |
| day | phase 3: optional definition of a day for the unit `days` — a start and an end time (section 18) |

A category is the module's own entity, so the pointer from a subject is an ordinary relation inside
the module, not across a boundary. A category used by any subject cannot be deleted; the refusal
gives the count of subjects. A category named by a policy exception (7.5) cannot be deleted either,
until the exception is removed; the refusal says so.

The name is a copy, not the source. It refreshes when the provider reports a change; when the
provider's module is disabled, the last known one stays. No other data about the subject lives
here.

The pair "provider + identifier" is unique among non-deleted rows. When an added subject is removed
by undo and added again, the write code finds the deleted row and restores it instead of creating a
second one — the reservation history stays with the same row. The index alone does not force
this; it only does not block adding the same doctor again forever.

### 7.4 Target

| Column | What it holds |
|---|---|
| name | name of the target |
| customer | optional link to a person or a company in `customers`: its kind and identifier |
| colour | optional, the colour of its bars on the timeline; a new target without one takes the least-used colour of a fixed palette that holds no red, orange or amber, because those mean conflicts and warnings |
| time zone | the zone of the place where the work happens; decides the days of its reservations (section 8); written from the organization's zone when the row is created |
| provisional | phase 4: the target was created for a public request and is hidden from lists, picker and search until staff confirm it (section 19) |

A target is someone or something that comes back. "Peter" stays in the database for good, and the
next reservations simply attach to him. A target has no dates — the reservation has dates.

If a target meant a single rental, a customer coming for the twentieth time would have twenty
entries. Nothing would tie them together, and a fix in the customer's data would mean twenty
fixes.

Names need not be unique: two sites called "Warehouse" can both be real. When a new target gets a
name an existing one already has, the form warns and shows the existing one, so a duplicate is a
decision, not an accident.

The core does not know what a target is. It holds only the name and, when there is one, the link
to a customer; phone, e-mail, address and everything else is added by the product — as custom
fields or as a link to its own entity: a site, a patient. Changing them lives there too. None of
these fields is in the core.

The link to `customers` is the one link the module knows, because a booking for a customer is the
common case and because public pages need it (section 19). It is an identifier, not a relation
(section 15). From a linked target the module shows the customer's name and a link to their card,
and the customer's card shows their reservations through an injected tab. A target can stay
unlinked: a construction site is a target and not a customer. When `customers` is disabled, the
link stays stored and is not shown.

The tab goes into the spot `detail:customers.person:tabs`. The person page already renders that
spot and other modules already inject into it, but `customers` does not declare it in its
`extension-points.ts`. This change declares it there — a one-line addition to `customers` — so the
spot appears in the generated catalog; from the release on its id is frozen like any spot id
(section 23).

**The target name is personal data** when the target is a person — a patient, a guest. `customers`
encrypts the display name of its people, so the module declares the target name in its encryption
map too, and reads targets through the platform's decrypting queries. The search box over targets
then works the way search over encrypted customer names works today.

When creating a reservation, the target is picked only from a list, with a search box. A new
target cannot be typed in — otherwise the same person would enter the database in several
spellings, and the history would fall apart.

### 7.5 Module settings

One row per organization. It appears on the first save of the settings screen. Until a row
exists, reads return the built-in defaults from memory and write nothing — a read never turns
into a write.

One setting has no default: the time zone. Guessing it — from the server, from the first user's
browser — would freeze a possibly wrong zone into every target and subject created in the
meantime, because they copy it (section 8). So the row is not seeded at tenant creation: an
installation chooses its zone once, before anything is booked. Until then every write of the
module that needs the settings — creating a target, creating or adding a subject, and every write
of a reservation, placed or not — answers 409 `settings_required`, and the screen sends the
administrator to the settings first. So does the timeline read, which cannot draw a day without a
zone. Lists are unaffected: empty lists need no zone. Subject categories and the settings save
itself need no zone either — the save is how the zone arrives. The scan skips an organization with no
settings row instead of creating one.

The settings screen saves section by section — calendar, threshold, conflict policy, zone — and the
other sections stay locked until the zone is saved; a first save without a zone is refused with 400
`time_zone_required`. At least one weekday must stay a working day.

| Column | What it holds |
|---|---|
| free weekdays | seven boolean columns, one per weekday — a closed set that never grows, typed day by day |
| warning threshold | how many working days before the expected start to warn; a whole number from 0 to 250, default 5; 0 warns only on the expected start day itself |
| time zone | the organization's zone, as a name from the standard list; required, no default |
| default conflict mode | `advisory`, `confirm` (phase 2) or `reject`; `advisory` by default (section 9) |

`bookings_holidays` — one row per holiday: a real `date` column the database validates, a label,
unique per organization and date, so the same day cannot be entered twice. Holidays are added and
removed one at a time and imported a year at a time, so they are rows, not a list in the settings.
The screen saves the calendar section as a whole: the list sent replaces the stored one, at most
1000 holidays, each label at most 120 characters, a duplicate date refused.

`bookings_conflict_policy_exceptions` — one row per category that departs from the default: the
category and its mode, unique per organization and category. A missing row means the default. At
most 200; an exception for a category that does not exist is refused with 400 `unknown_category`.
A column holding "the other categories" could not have grown a third mode; the table can.

`bookings_scan_state` — the scan's own bookkeeping, one row per organization and per time zone in
use there (section 9): the last local date processed in that zone.
Nobody edits it, so it has no last change date used for locking. It is kept off the settings row on
purpose: the scan writes its watermark once per zone per local day, at any hour, and a settings row
bumped at a random hour would make an administrator's save fail with a stale-version conflict for
nothing.

The working calendar is state here. The free-day windows that follow from it are not stored
anywhere, because they can be computed from these settings.

**Changing settings does not recompute stored reservations.** The end of a reservation is computed
when it is placed or resized, and it stays; a new holiday does not move bars already on the
timeline — the dispatcher sees a bar on a free day and decides whether to move it.

Zones work the same way. Changing the organization's zone changes only the default for rows
created afterwards; existing targets and subjects keep their own zones (section 8). A target's
zone is different, because it decides what its stored instants mean: a reservation in working days
is stored from one local midnight to another, and after a zone change those instants no longer
fall on midnights — the day scale would read them as touching an extra day. So a target's zone can
be changed only while it has no open, placed reservation in working days; the refusal (409
`target_zone_locked`) says how many stand in the way. The change takes the target's lock before
it counts (section 9). Reservations in minutes keep their instants under any zone and do not
block it.

Changing the warning threshold takes effect from the next scan, and the counter on the reservation
serves only to filter out repeats — after a threshold change the scan may emit one extra signal,
and that is fine.

The settings table has no deletion field because nothing ever deletes a settings row — there is no
action for it. The platform's usual answer to a unique key over soft-deleted rows, a unique index
over the rows that are not deleted, would work here too; it is simply not needed.

**Why a table and not the platform's module configuration.** First, the platform's module
configuration service is keyed by module, name and tenant: it stores an organization but never
looks a value up by it, so it cannot hold one working calendar per organization. Second, the
settings here are not simple values: the policy exceptions and holidays are rows that point at
other rows, and the day boundary of every write reads them inside the write's transaction. That is
the shape of a module's own table. `sales` keeps its document-number settings in one, seeded when
a tenant is created and created on first save for organizations that were not seeded; this module
seeds nothing, because the zone has no default, and creates the row on the first save.

### 7.6 Indexes

Every read named in section 12 and every scan step has its index:

| Table | Index | For |
|---|---|---|
| `bookings_bookings` | (tenant, organization, start, end) over open, non-deleted rows | the timeline, the conflict read and the occupancy service by window |
| `bookings_bookings` | (tenant, organization, expected start) over open, unplaced, non-deleted rows | the unplaced list and the coverage scan |
| `bookings_bookings` | (target) over non-deleted rows | target delete and zone change counts |
| `bookings_participants` | (subject, reservation) unique over non-deleted rows | conflicts per subject; one subject once per reservation |
| `bookings_participants` | (reservation) | loading a reservation's participants |
| `bookings_subjects` | (provider, provider id) unique over non-deleted rows | add and re-add |
| `bookings_subjects` | (tenant, organization, category, name) over non-deleted rows | timeline rows in their sort order |
| `bookings_targets` | (tenant, organization) over non-deleted rows; from phase 4 also non-provisional | the target list and picker |
| `bookings_targets` | (tenant, organization, customer kind, customer id) over non-deleted rows | the reservations tab on a customer's card |
| `bookings_reported_conflicts` | (participant, other side) unique | the novelty check of writes and the scan |
| `bookings_scan_state` | (tenant, organization, zone) unique | the scan's watermark |
| `bookings_subject_categories` | (tenant, organization, lower(name)) unique over non-deleted rows | one spelling per category |
| `bookings_holidays` | (tenant, organization, date) unique | the working calendar |
| `bookings_conflict_policy_exceptions` | (tenant, organization, category) unique | the policy of a write |
| `bookings_settings` | (tenant, organization) unique | one row per organization |
| `bookings_idempotency_keys` | (scope, key) unique; (tenant, organization, created at) | the duplicate check; the clean-up on insert |

The timeline read costs a fixed number of queries per view: one page of rows, one query for their
bars by window over the first index, one bulk question per provider for unavailability, one read of
the settings and holidays. "Hide unavailable" filters the page after the providers answer, so a page
can hold fewer rows than asked; the answer says so and the screen fetches the next page.

### 7.7 Search

Targets and subjects are searched by name in pickers and lists. The target name is encrypted
(7.4), so a plain `LIKE` cannot find it; the module declares a search configuration in `search.ts`
for targets and subjects, the way `customers` does for its people: the target name is indexed
through the platform's hashed search tokens — which match from the start of a word, three
characters and up, not inside a word; that is the picker's stated behaviour — the subject name as
plain text, each result formatted
with its kind and its category. Provisional targets (section 19) are not indexed until they become
normal targets.

## 8. Working calendar and time zones

### We keep the working calendar on our side

Free weekdays, holidays and the organization's time zone are module settings (7.5). They answer
one question: what does "a day" mean in this company.

They are not rules in `planner` and not an entry in the platform configuration. The reason:
`planner` holds rules pinned to a specific subject, and the working calendar is not about any
subject — it is about the whole company. The platform has no holiday table anywhere else; `staff`
holds no calendar data. This working calendar is the first one on the platform.

We do not store free days anywhere separately. They can always be computed from these settings.

### Three zones, each owned by someone

One zone per company is enough for a clinic whose patients come to one building. It breaks for the
case the module is meant to serve: sending people and equipment to places that are somewhere else.
A technician sent across a border is due at 13:00 local time at the place of work; the dispatcher
sits in another zone. Read in the dispatcher's zone, the visit lands two hours off, on the wrong
side of a working day, and the coverage warning counts to the wrong date.

So each side of a reservation is read in its own zone:

| Zone | Stored on | What it decides |
|---|---|---|
| the organization's | settings (7.5) | the default for the two below; everything that has no target — the timeline axis, the "now" line; the scan's tick is hourly and its days are per target zone (section 9) |
| the target's | each target (7.4) | the days and the wall time of the target's reservations; "today" for their coverage warning |
| the subject's | each subject (7.3) | the days of the subject's unavailability — a leave belongs to the person, not to the trip |

A technician's leave is entered by HR in their own calendar; it does not move because a booking
sends them abroad. The visit does. A reservation has exactly one target, so its zone is never
ambiguous, even when participants come from different places.

The target's and the subject's zones are written from the organization's zone when the row is
created and can be edited later. A read never falls back from one to another — each row states its
answer. Changing the organization's zone therefore leaves existing targets and subjects as they
are; a site abroad does not move because the head office did.

Not the zone of the person who looks, and not UTC. If the viewer's zone decided, the same
reservation would fall on different days for different people. UTC fails the same way: "from 3 to
5 August, from local midnight" read in UTC gives 2–4 August. We show the viewer's zone when it
differs, but it never moves a reservation.

### What sits in the database

We store exact instants, saved in UTC. The start and end of a reservation's days are computed in
its target's zone, not at UTC midnight — in a real zone the day does not always start at the same
hour.

Duration is counted by calendar dates, not by adding twenty-four hours. A working day is a
calendar day, so a day of 23 or 25 hours breaks nothing.

A start on a free day is allowed and counts as the first working day — the dispatcher put it there
on purpose — and the free days after it are skipped: three working days from a Saturday cover
Saturday, Monday and Tuesday. The write goes through, and the response flags the free start. A job
that really covers a whole weekend is expressed in the unit `days` of phase 3 (section 18), which
counts calendar days; until then it is two reservations.

### Entering and showing

In timeline operations the user gives a date, and the server computes the instant in the target's
zone. The browser decides nothing. Next to every shown date you can see which zone it is in — the
same zone is one hour off UTC at one time of year and two hours at another.

The timeline axis gets its days already resolved on the server, in the organization's zone, and
draws them on a UTC grid, so the browser's zone never moves a column. A bar stands on its target's
dates; the "now" line stands on the organization's wall clock at the time of the read.

Clock changes are settled in code. In spring 02:30 does not exist, so such an entry is moved
forward. In autumn 02:30 happens twice, so we take the first one. The machine that happens to do
the computing must not decide this, because the server and the browser would store two different
instants for the same entry.

We accept only zone names from the standard list and check them on write. A bare offset like
"GMT+3" is rejected — it says nothing about when the clock changes.

Zone conversions go through `date-fns`, at the version core already pins, and `@date-fns/tz`, the
zone package of the same authors. The second is a new production dependency; core's own zone
helper is the older third-party `date-fns-tz`. Every import of either lives in one adapter file
that exposes the module's own vocabulary — a bare date, an instant, a wall time — and never lets a
library type out; a guard test fails an import anywhere else. So whether the maintainers accept
`@date-fns/tz` or prefer `date-fns-tz` (section 21), the answer changes one file. Clock changes are
resolved by hand in that adapter, not by the library's constructor, because the constructor
settles a repeated or skipped wall time through the host's zone — exactly what the rule above
forbids.

### Zones do not reach the engine

The conflict engine gets ranges and nothing more. A reservation and an unavailability window look
the same to it. Working-day arithmetic also works on dates alone. The zone matters only at the
edge, where a stored instant turns into a range of dates: a reservation's in its target's zone, a
window's in its subject's.

**On the day scale the two are compared as dates, not as instants.** A leave on Monday in Lisbon
and a visit on Tuesday in Warsaw share an hour of wall clock; an instant comparison would call that
a conflict — the very case the per-target zone exists for. So the reservation's dates and the
window's dates are intersected. Instants decide only for reservations in minutes (section 18).

One consequence for reads. Dates are compared in each owner's zone, while the database holds
instants: two visits on 2 June, one on Kiritimati (UTC+14) and one in Honolulu (UTC−10), share the
date and not a single instant. Every query that loads candidate reservations by instants widens its
range by twenty-six hours on each side — the distance between the earliest and the latest zone on
Earth, UTC+14 and UTC−12 — and lets the engine decide.

### We read unavailability windows the same way planner does

An unavailability rule has a time zone field in the database. On the platform's development branch
today it is stored, validated and editable in planner's editor, but no computation reads it: the
code that turns a rule into concrete days counts in UTC, and repetition steps by exact 24 hours and
7 days. So at a clock change such a rule shifts by one hour against local time.

**This is changing.** An open platform issue (#5862) names the defect, and an open pull request
(#5868) fixes its write side: planner's date-specific and weekly commands will anchor a rule's start
to the rule's declared zone. Making the expansion itself zone-aware is the issue's second step, not
yet started. The module depends on this work, in two ways:

- the day-of-window rule below takes the rule's declared zone as its **first** anchor whenever that
  zone resolves, so it is right for rules written after #5868 without guessing;
- the read method this specification adds to planner (section 5) is itself an expander of rules.
  Planner should not carry two expansion semantics for the same rows, so whether the read method
  becomes the zone-aware expander the issue asks for is a question for the planner maintainers
  (section 21). Until they answer, the read method expands one-off rules as stored, start plus
  duration, which is right under both semantics, and leaves repetition to planner's existing code.

There is one side effect we must handle on our side: we cannot always read the day of an all-day
window from its edge. Planner stores an all-day window as two instants, and the write paths anchor
"midnight" differently:

```
HR, approved leave              UTC midnight
our own form (section 10)       midnight of the subject's zone, which it also writes as the rule's zone
planner's date-specific editor  today: midnight of the server it runs on;
                                after #5868: midnight of the rule's declared zone
```

Two hours of difference push the start into the previous UTC date, so "the UTC date of the start"
is right for a leave and wrong for an inspection entered from our form in Warsaw. The rule
therefore recognises the anchor instead of guessing it, trying the zones in this order:

- **a window whose both ends are midnights of one known zone** — first the rule's own declared zone
  when it resolves (every rule written after #5868, and every rule our form writes), then the
  subject's, UTC, and the organization's (a planner editor on a server set to the company's zone),
  for rules written before — covers exactly the dates between them, in any zone and across a clock
  change;
- **a window of whole days anchored to none of them** — a server in yet another zone, a foreign
  writer: each 24-hour piece of it, counted from its start, is one day, and that day is the date of
  the piece's **middle**, read in the subject's zone. The middle of a day-long piece sits around
  noon for any zone within eleven hours of UTC, far from every day boundary;
- **a window with real hours** (any other length): its days are all the calendar days in the
  subject's zone that it touches. A window from 23:00 to 01:00 blocks both days.

This works because the read method hands the window over as stored, start plus duration, together
with its rule's zone, and does not snap it to a UTC day (section 5).

A reservation conflicts with a window when one of the reservation's dates is a date of the window.

Examples, for a subject in Warsaw in summer (UTC+2):

```
HR leave for Monday              Mon 00:00Z – Tue 00:00Z        UTC midnights          → Monday
our form, inspection 1 June      31 May 22:00Z – 1 Jun 22:00Z   Warsaw midnights       → 1 June
planner editor, server on UTC    1 Jun 00:00Z – 2 Jun 00:00Z    UTC midnights          → 1 June
two-day window at UTC midnight   Mon 00:00Z – Wed 00:00Z        UTC midnights          → Mon, Tue
server in New York               1 Jun 04:00Z – 2 Jun 04:00Z    no known anchor; middle 1 Jun 16:00Z → 1 June
```

Reading the start date in UTC would have given 31 May for our form. Treating the two-day window as
real hours would have blocked Wednesday too, because it ends at Wednesday 02:00 local. And a Monday
leave from HR lands on Monday even in Auckland, because its UTC anchor is recognised — the middle
rule would have put it on Tuesday there.

The rule needs no new column and no change in planner beyond the read method. Its limit is only the
fallback: a window anchored to a midnight none of the known zones owns, for a subject more than
eleven hours from UTC. Once planner expands rules in their declared zone (#5862), the declared zone
answers every rule and the rest of the list stays only for rows written before.

## 9. Conflicts and coverage warnings

### What a conflict is

Two reservations of the same subject that overlap in time, or a reservation that falls into its
unavailability window. Planned and active reservations count — completed, cancelled and no-show
ones free the slot.

A conflict concerns a pair, and detection is symmetric — it does not matter which was written
second. The write outcome is not symmetric: in reject mode the one who writes later loses.

### A pure function computes it

The engine gets lists of intervals and returns a list of conflicts. No database, no framework.
The same code runs on the server and in the browser, so a conflict is visible already while
dragging a bar on the timeline, before the write.

### Two paths

```
read     the view recomputes conflicts every time the timeline is shown
push     after a write an event goes out; notifications are made from it
```

**Writes that change occupancy.** One list, used by the push path here and by the lock below:

```
create with a start date        a new bar
place                           an unplaced reservation gets dates
unplace                         a placed one loses its dates; the window is freed
move, resize                    the window changes
update with new participants    a subject joins or leaves the window
status change that reopens      completed or no_show back to planned or active
status change that closes       the window is freed
target change of a placed one  the window is recomputed in the new target's zone (7.1)
form save                       any of the above in one command (section 12)
compound Save of the edit mode  many moves and resizes in one command (section 11)
undo of any write above         the window is restored as it was
```

The push path is triggered by every write on that list. Each one recomputes the subjects of that
reservation — for a participant change, the old and the new ones.

Unavailability windows are written by other modules — HR when a leave is approved, an employee on
their own screen, and also our own form, which sends the write straight to planner (section 10).
None of these writes passes through our server, and only some of them announce themselves with
an event. So the source of truth about conflicts with unavailability is the hourly scan described
below: it computes them from scratch for the coming period and reports the ones that were not
there before. Where planner does send a rule-change event, the module subscribes to it, computes the
subject's conflicts with that window at once and reports the new ones through the same table of
reported conflicts the writes and the scan use (below), so an HR leave that clashes with a
reservation is notified in seconds and the scan does not report it a second time. The subscriber
also emits `bookings.booking.changed` for the subject, so an open timeline refetches its rows. Three
reporters — the write, the subscriber, the scan — and one table that decides what is new. Today the
events are:

```
staff approves a leave               planner.availability_rule.created, one per rule; deleted on undo
planner weekly schedule replaced     planner.availability_rule_set.updated, and only when the
                                     schedule edited is a rule set, not a person's or a resource's
planner single rule or date editor   no event — the rule commands emit none, and the route does
                                     not re-emit for a command-backed write
our own form                         no event — it writes through the same rule command
```

So for most windows written outside HR the scan is the only trigger, and the design does not
assume otherwise. After a window is written from our screen, the browser asks our conflict read for that subject,
so the dispatcher sees the effect at once, without waiting for the scan.

### When we compute

In every mode, inside the write's transaction, under the locks, before the commit (below). Under
`reject` and `confirm` that is the only place a refusal can still happen. Under `advisory` nothing
is refused, but computing there costs nothing extra — the locks are already held — and it makes the
list in the response exact: a conflict computed after the commit would no longer be under the lock,
and a parallel write could change it in between. Conflicts with unavailability are computed in the
same step and returned in the response; they never block, except as warnings to confirm under
`confirm`. The unavailability windows themselves come from planner, outside our locks — a window
written a moment later is caught by the next read or the scan.

The same recomputation after a write decides what happens to open notifications. When a
subject of the written reservation has no reported pair left, its conflict notification is removed
for every recipient (section 12). Placing or closing a reservation does the same for the
coverage gap notification of its target, when the target has no other unplaced reservation
inside the threshold.

Not in the background on an event — background delivery can be delayed and retried, so there is
no certainty that anyone computed that conflict.

We compute on the committed state of the database, read from the module's own tables — never from
the full-text search index, which catches up with a delay and may not know a reservation from a
second ago.

### Warn or reject

An organization setting, not a rule in code.

```
advisory   the write goes through, the conflict is shown and reported    ← default
reject     a write that creates a conflict fails
```

**Rejection applies only to two reservations overlapping.** A conflict with an unavailability
window never blocks, in both directions — under `advisory` and `reject` it warns, under the
`confirm` mode of phase 2 it asks for a confirmation — a reservation is not lost because of an inspection, and
an inspection is not lost because of a reservation. A breakdown does not ask about the schedule.

When dispatching equipment a person decides, hence `advisory` as the default. When booking visits
a second person for the same slot must be refused, hence the second mode.

The mode has two levels: a default for the organization and exceptions for chosen subject
categories. A clinic sets `advisory` as the default and `reject` for the "doctor" category — two
visits with the same doctor fail, two jobs for the same portable ultrasound only warn. When a
reservation has several participants from different categories, the stricter mode applies.
Splitting by reservation type, not subject, does not change the data model and can come later.

### Kinds of conflict

```
overlap                  two open reservations of one subject          by mode: warns, needs confirmation, or blocks
unavailability           a reservation in a window from planner        warns; needs confirmation under confirm
outside_working_hours    phase 2: outside the subject's hours (18)     warns; needs confirmation under confirm
product kinds            registered by a product as a conflict kind (20)  the product's rule decides
```

An overlap is shown in one of two ways, because they ask different things of the dispatcher. A
subject **needed at several targets** at once — the excavator on two sites — is a planning error
and is shown first. A subject **booked more than once for the same target** is usually a duplicate
entry. Both rank above **booked while unavailable**. The kind in the answer stays `overlap`; the
label is computed from whether the other side's target is the same.

### Confirming warnings

Phase 2 adds a third mode, `confirm`, set the same way — as the default or for chosen categories.
The two modes of phase 1 keep their meaning:

```
advisory   the write goes through, warnings are shown and reported            phase 1
reject     an overlap fails; every other warning only warns                   phase 1
confirm    a write with any warning goes through only when a user confirms     phase 2
           them, with a reason
```

When a reservation has participants under different modes, the strictest applies, in the order
advisory, confirm, reject. Under reject, warnings other than an overlap still only warn — reject
does not inherit confirm. "Any warning" under confirm means the module's own kinds and those a
product registered; intervals from an occupancy source (section 20) only warn in every mode and
are never part of the list to confirm.

Under `confirm` a write that produces warnings fails with their list. The user, who must hold
`bookings.override_conflict`, confirms that exact list and gives a reason; the write carries the
list back, and the server compares it with what it computes in the transaction. When the lists
differ — someone booked the slot a second earlier — the write fails again with the new list. The
reason and the confirmed list are stored on the reservation (7.1). Because the comparison must see
the committed state, `confirm` computes all warnings before the commit, in the transaction and
under the same locks as `reject` (below). A clinic sets `confirm`, so a
visit outside the doctor's hours needs a deliberate decision; a dispatcher keeps `advisory`.

Under `confirm` an overlap is a warning like the others and can be confirmed. Under `reject` it is
a refusal that no confirmation lifts, because reject is there exactly for slots that must not be
shared.

### The lock under reject

A check before the write is not enough on its own: two parallel writes check "free?" before
either commits, and both pass.

So under `reject` and `confirm` the check and the write go in one transaction, preceded by a lock
on the subject. Every write on the list of writes that change occupancy (above) takes it — not
only place, move and resize: a create with a date, a participant change, a reopening status change
and an undo can each put a second reservation into a slot. One shared write path takes the locks,
checks and writes, so no command can skip it. Writes that only free a slot — closing —
take the lock too, so a parallel check never reads a half-written state. Under `advisory` the
locks are taken as well, and the conflicts are computed under them (When we compute, above). The lock is a Postgres transaction-scoped advisory lock whose key is the text
`bookings.subject:{subject id}` hashed to a number; it is released by the commit or the rollback.
When a reservation has several participants, we take the locks in a fixed order, by subject
identifier — otherwise two parallel writes could deadlock.

Every reservation write also locks its target first (`bookings.target:{target id}`), placed or
not, and always before the subjects, so the order is the same everywhere and two writes can never
deadlock. Deleting a target and changing its zone take the same lock, then count its open
reservations. This closes a race: without it, a reservation created between "any open
reservations?" and the soft delete would land under a deleted target. A write that changes the
target — an update with a new target — locks both, the old and the new, in identifier order,
before the subjects; otherwise a parallel delete of the new target could slip in between. The
compound Save of the edit mode locks every target and subject it touches, targets first, each
group in identifier order. An exclusion
constraint at the database level would handle this without a lock, but it needs a database
extension that no module migration in Open Mercato has created so far — that is a platform
decision, not a module one.

Where this code lives matters. Command handlers on the platform do not run inside a transaction
by themselves; a transaction exists only where the handler opens one. So the lock, the overlap
check and the write are phases of that shared write path, inside each command's own atomic block — the
platform's atomic flush with the transaction option on — not a command interceptor, which runs
before the handler and outside any transaction. The platform has no shared advisory-lock helper;
the modules that take such locks call them inline, and one of them — the folder hierarchy of
`documents` — checks the transaction first. Our lock code follows that one: it asserts that it runs
inside a transaction and fails otherwise, because a transaction-scoped lock taken outside a
transaction is released at once and guards nothing, so that assertion is what catches a lock taken
in the wrong place.

### Coverage gap warning

A reservation can exist without dates — it is a commitment that has no window yet. When few
working days are left until the expected start and the reservation is still unplaced, the module
emits a signal "in X days". The settings say what X should be.

This applies only to planned and active reservations. A closed one needs no subject, so it does
not warn.

It is a warning, not an action. It blocks nothing and assigns nothing by itself.

A deadline that has already passed is a separate state. "In −2 days" means nothing; the
reservation is then overdue, and that is how we show it. "Overdue" is stored as a state of its
own, not as zero — zero already means "the expected start is today" — so the change from 0 to
overdue is a change the scan sees. An overdue reservation gets one signal — when it becomes
overdue — and the scan does not repeat it
until someone places or closes the reservation. Placing clears the "last reported warning"
column.

A pure function computes this: it gets the expected start, today's date, the working calendar and
the threshold, and returns the number of working days to the deadline. The calendar comes in as
input data, not as a dependency — so the same function runs on the server and in the browser.

How the days are counted: today counts as a day left when it is a working day, the expected start
day itself shows 0 days and is not yet overdue, and the reservation becomes overdue the day after.
A reservation placed later than its expected start is not overdue — it has dates — but its card
says "starts N working days late".

The warning has two paths, like a conflict:

```
read     the screen computes "in how many days" every time it is shown
push     once per local day of each target zone the scan emits an event for those whose state changed
```

For conflicts the scan replaces the events that planner does not send. For coverage gaps it is
the only possible trigger: the reservation lies untouched, and the deadline comes closer by
itself. On Monday six working days are left, on Tuesday five, and it is Tuesday that has to emit
the signal, although nothing happened in the system.

The scan does one more thing: it turns the counter for someone who has had the screen open since
yesterday: for each zone whose day turned over it emits `bookings.booking.changed` (section 12), the
screen refetches, and "in 3 days" becomes "in 2 days" without a refresh.

It is started by the platform's job scheduler: one system-level entry, shared by the whole
installation, puts a job on the queue, and the module's background worker walks through all
organizations one by one. The entry is registered from the module's `seedDefaults` hook with a
fixed UUID (section 5), so repeated runs do not create duplicates. It is system-level with no tenant, so it does not
count against the scheduler's per-tenant limit of active entries — and an organization added
later has nothing to be forgotten. Walking the organizations is the worker's job, not the
scheduler's. The scan itself computes within one organization, because the working calendar and
the threshold are its settings; inside it, days are counted per target zone (below).

The entry fires every hour, and the worker keeps a watermark per organization **and per time zone
used by its targets** (`bookings_scan_state`, 7.5). For each zone it computes today's date there and
compares it with the last date it processed in that zone; when they differ, it processes the
reservations of the targets in that zone and stores the new date. So every place of work gets its
new day within an hour after its own midnight — a site eight hours ahead is not eight hours late,
and a site behind the head office is not a day late. A missed or late tick delays a zone's day by an
hour instead of skipping it — this matters, because the coverage warning has no other trigger.

**One run per organization at a time.** Two workers, or a run longer than an hour, must not process
the same organization twice — that would send each signal twice and write the watermark twice. So
the run of one organization holds a transaction-scoped advisory lock on `bookings.scan:{organization
id}`, taken with a try-lock: a second worker that cannot take it skips the organization instead of
waiting. Inside the lock the worker reads the watermark again and skips when it is already today's.
The worker runs with a concurrency of one per queue as well, so the normal case never contends.
The run collects its signals while it holds the lock, commits, and only then emits events and
notifications — side effects fire after commit, as everywhere in the module (section 15).

Inside a run, each reservation is judged against today in its own target's zone: a deadline belongs
to the place of work.

The scan does not emit signals blindly. It computes the state for today and compares it with the
"last reported warning" column on the reservation. The signal goes out only when the number of
days has changed, and the same column is then overwritten. Otherwise the same warning would go
out five days in a row.

**Reported conflicts are recorded, not inferred from time.** A rule based on timestamps cannot
tell what was already reported: a leave approved at 10:00 and a reservation placed into it at 11:00
were reported by the 11:00 write, yet the next scan sees a rule newer than its last run and would
report it again; and a window written beyond the ninety-day horizon is older than the last run by
the time it enters the horizon, so it would never be reported at all. So the module keeps
`bookings_reported_conflicts`: one row per participant and per thing it collides with — the other
reservation, or the unavailability rule and the start of the window — with the instant it was
reported. The write path, the planner subscriber and the scan each report a conflict only when its
row is missing, and write the row when they report. A write removes the pairs of the subjects it touched; the scan
removes only pairs inside its horizon; a subject's notification goes when no pair of it is left
(below, and section 12). This is the same idea as the "last reported warning" column of
the coverage warning, kept per pair because a conflict is a pair.

So a conflict reported yesterday — by a write, the subscriber or the scan — is not reported again the next
morning, and a conflict that enters the horizon late is reported on the day it enters.

This matters for dismissal. The notifications layer merges a repeat into an existing notification
only while that one is unread, read or actioned; a dismissed notification is not merged, so a
second report would bring it back. Reporting each fact once is what keeps a dismissed notification
dismissed. The event still carries a grouping key, so repeats that arrive while the notification
is open merge into it (section 12).

The scan also removes what is no longer true, but only what it can see. It removes a reported pair
whose other side lies inside its horizon and no longer clashes; a pair beyond the horizon — a
reservation placed into a leave 120 days out, reported by the write — is left alone, because the
scan does not look there and "nothing found" would be a false clean. A write removes the pairs it
re-checked and found clean — of the subjects it touched, at any date. A coverage gap notification goes when its target has no
unplaced reservation inside the threshold. A subject's conflict notification goes when it has no
reported pair left. A leave cancelled in HR or a bar moved away inside the horizon clears the
dispatcher's list by the next scan at the latest; beyond the horizon it clears when the pair enters
the horizon or when a write touches the subject. A write on our side clears it at once.

The scan looks ahead over a fixed horizon: for unplaced reservations up to the warning threshold,
for conflicts with unavailability the next ninety days. The timeline screen opens on a shorter
range (section 11); the two numbers are independent. Nothing beyond the horizon is scanned; it enters the horizon on a later day. The same run computes
conflicts with unavailability over that horizon no matter whether an event about the window
change arrived.

There is one rule and it is computed in one place: the same code feeds the screen and the scan.

## 10. Unavailability

### Where it lives

In `planner`, in one table of rules for all subjects — team members, resources and schedules
(section 5). The reservations
module creates no unavailability table of its own and copies nothing from there.

This is different from the working calendar: the calendar says when the whole company works,
unavailability concerns one subject.

### Who writes it

```
HR, approved leave            the rule is created by itself, with no part from our module
the employee on their own     the "my availability" screen in the HR module
our screen                    service, inspection, equipment breakdown
```

The third path is ours: the module has its own unavailability form, because otherwise it would
not be self-sufficient — entering an excavator inspection would need a trip to another module.
The write goes to the same table in `planner`, where unavailability lives. We do not create a
second place for the same information.

We learn about writes outside our screen from the scan, and — where planner sends an event — at
once (section 9).

Writing unavailability is subject to the permissions of the availability schedules, not ours. In
practice this means a person with planner's right to manage other people's availability writes it
— by default the administrator; a dispatcher who should enter inspections gets that planner right
on their role. Without it the form is not offered (US-C7), even to a user who manages reservations.

The form takes whole days only — from and to, both inclusive, today by default — and is written as
one one-off rule from the subject zone's midnight to the midnight after the last day (section 8).
The reason is optional and comes from planner's own dictionary of unavailability reasons for the
subject's type, so reasons are the same everywhere; the note is at most 200 characters, as planner
allows. Only subjects in use are offered. Hours come with phase 2.

The write itself does not pass through our server. The form is ours, but the browser sends it
straight to the existing rule write endpoint. This way the same access check as always applies,
and planner's write side needs no change for it. The opposite version — a write through our
server — would require repeating planner's permission check on our side, and we do not want to
copy it.

The consequence for conflicts: our server does not see this write, so it cannot return conflicts
in its response. After a successful write the browser asks our conflict read for that subject and
range — a second request, the same screen. The notification about such a conflict is emitted by
the scan (section 9).

### How we read it

Through the provider plugins (section 6): for each provider one question about all its subjects
in the date range. The built-in plugins ask the read method added to `planner` (section 5),
adding the subject's schedule from their own registry. We ask in bulk — one display of the
timeline is dozens of rows, so asking about each one separately would be a waste.

We read windows as stored instants and date them in the subject's zone by the day-of-window rule of
section 8.

### What happens to it next

The intervals go to the conflict engine next to the reservations. A reservation that falls into
an unavailability window is a conflict — always reported, never blocking (under `confirm`, phase 2,
it asks for a confirmation like every warning), in both directions: on a
reservation write in the response, on a window write in the second request from the screen, and
in the scan (section 9).

On the timeline, windows are shown as the background of the subject's row, so the dispatcher
knows why a slot is marked.

## 11. Timeline

### Why not the ready component

`@open-mercato/ui` has a ready calendar view for day, week and month, built on a calendar library
that is already a dependency of that package. It does not fit here for two reasons.

**It lacks what a reservation timeline needs:**

```
one row per subject across many days   the base of the view; the wrapper in `ui` exposes no
                                       resource axis at all, and the library underneath can
                                       show resources only as columns within one day
dragging and resizing existing bars    the dispatcher moves and extends existing bars
smooth zooming of the scale            from a few days to a few months
staying smooth with thousands of bars
```

**It counts days in the browser's zone.** Expansion of recurring entries uses local date methods,
so "every Monday" means Monday for whoever is looking. This contradicts the rule from section 8
that the owner's zone decides the day, never the viewer's: two people in different zones would see the same entry
on different days. Reconciling this would mean rewriting that code.

So the timeline does not use the ready view, and phase 1 leaves the ready view untouched. Phase 2
uses it for a different screen and needs one additive change in it (Calendar view, below).

### What we build

A light component fed by properties, with no knowledge of the domain. It knows nothing about
reservations, subjects or any module: it gets rows, bars, days to grey out, and labels.

Bars are changed in an **edit mode**, not one drop at a time. "Edit" turns the timeline into a
draft: moves and resizes stay in the browser, changed bars are marked, and the conflict engine —
the same pure function as on the server — shows the effect of each drop at once. "Save" sends the
whole draft as **one compound command**, `bookings.bookings.apply_changes`: a list of moves and
resizes. It takes the locks of every touched target and subject in the fixed order, checks each
change against the state the earlier ones leave, applies the ones that pass and refuses the rest,
and answers per change. Accepted changes are one undo entry — undo restores all of them together —
and produce one `bookings.booking.changed` event listing the reservations, so twenty open screens
refetch once, not once per bar. Refused changes stay marked in the draft with their reason; the
dispatcher fixes or drops them and saves again. Undo after a partly refused Save restores only what
was saved. "Discard" drops the draft. Open screens also wait a moment after an event before they
refetch, so a burst of events from several users becomes one read. A dispatcher reshuffling a week
tries several arrangements before committing one, and others should not see the half-done plan.

The screen opens on two days back and a week in total, with a range picker for any range up to 366
days and a reset to the default. A dispatcher reads the coming days bar by bar, and ninety day
columns of a readable width do not fit a screen; the scan's ninety-day horizon (section 9) is a
separate number.

One row is one subject, reservations are bars, conflicts are marked, free days in the background.
Completed and no-show bars stay, greyed as done, so the dispatcher sees what really happened;
cancelled ones are not drawn. A subject not in use is shown only when it has a bar in the range.
Rows are sorted by category name, then by subject name, with subjects without a category last.

The reservation card offers only what fits the bar's state: a bar with a conflict gets Edit and
Cancel, not inline changes, so the conflict is decided in the form where its other side is shown;
a closed bar gets Reopen, except a cancelled one.
A reservation with several participants is one bar in each participant's row; dragging any of
them moves the whole reservation. Day scale now, hourly later — with no data change, because we
store dates as instants anyway.

### `vis-timeline` as a conscious decision

Drawing is based on `vis-timeline`. It is a new production dependency, and we choose it
consciously, because it gives everything from the list above out of the box, including the hourly
scale that phase 2 needs. We checked the alternative: adding a row layout,
dragging of existing bars and zooming next to the calendar library from `ui` is a timeline engine
written from scratch — more code than the whole component on `vis-timeline`.

Two safeguards:

**Loaded lazily** — the library code is downloaded only when the timeline screen is opened, so it
does not weigh on the rest of the application. Core guards its own heavy libraries with a test
(`lazy-heavy-libraries` in `@open-mercato/ui`) and a client-boundary script; the module adds its
own import-boundary test of the same kind, failing when the library is imported outside the
timeline screen, and passes the client-boundary script.

The library is not alone. `vis-timeline` 8 depends on `moment` — in maintenance mode, and a second
date library next to `date-fns` — and on `xss`, `@egjs/hammerjs`, `propagating-hammerjs`,
`vis-data`, `vis-util`, `uuid`, `keycharm` and `component-emitter`. All of them ride in the timeline
chunk only, and all count against the chunk budget of section 24; the bundle check measures the
chunk with them. The request to the maintainers names the whole tree, not only the library.

**Closed in one file** — the component gets its data through properties and does not know what
draws it. Swapping the library is replacing one file, not rewriting the view.

### On duplicating logic

The `customers` module has three pure functions that at first sight overlap with what a
reservation timeline needs: detecting overlapping entries, packing them into columns, and
snapping to a grid while dragging. We checked each one.

```
packing into columns     about columns within one day in a day calendar
                         here every subject has its own row — does not apply

snapping to a grid       computes position within a day, in browser time
                         our scale is daily, and we avoid browser time

overlap detection        the shared core is about twenty lines
                         the rest assumes a conflict is a shared user
                         and knows nothing about unavailability windows
```

So we write our own overlap detection — the fourth in the platform, but it is about twenty lines
of a pure function that, besides reservations, knows unavailability windows and does not assume
that a conflict is a shared user. Extracting the shared core into `shared` and wiring the
`customers` calendar to it makes sense to us — as a separate change, with its tests, not as a
condition of phase 1.

### Calendar view

Phase 2. The timeline answers "who is busy when" across many subjects. A receptionist asks a
different question: "what does Dr Smith's day look like" or "when is Peter coming". So phase 2 adds
a calendar view — day, week, month and agenda — for one subject or one target, next to the
timeline, on the same reads.

It is built on the ready calendar view of `@open-mercato/ui`. The two reasons that rule it out for
the timeline do not hold here: the view shows one subject, so it needs no row per subject, and
reservations are not recurring entries — the server sends ready instants, so the browser expands
nothing. What remains is showing those instants in their target's zone rather than the viewer's,
and here the component falls short today: it takes a time zone, but uses it only to format the
times on labels; it puts entries into days by the browser's local date. A visit at 23:30 in Warsaw
would then sit on the next day for a viewer in London.

So phase 2 includes a change in `@open-mercato/ui`, larger than one line: today the schedule view
passes its zone only to the toolbar, the calendar underneath never receives it and is not exported
from the package, and both the grid and the recurrence expansion bucket by local date getters. The
change threads the zone into the calendar, buckets entries by it, falls back to the browser's zone
when none is given — so existing callers see no difference — and exports the calendar. It is
additive and comes with its own tests. Moving a reservation in this
view goes through the same move command as on the timeline.

The calendar of `customers` is the other candidate. It is not chosen for now, because its entries
are customer interactions that require a customer, and a reservation of an excavator for a site
has none. Its meetings can still count as occupancy through an occupancy source (section 20).

### Three levels of use

```
engine and calendar arithmetic   pure functions, imported without enabling the module
timeline component               fed by properties, no knowledge of the domain
ready board screen               works on the resources registry once the module is on and the zone is set
```

The consumer takes the level it needs.

## 12. Module surface

### What the module exposes

```
targets                      plain write and read through the route factory
subjects                     read and list through the factory; adding goes through the
                             provider plugin, because the record is created in its registry
                             (section 6)
reservations                 list, details, editing single fields; create takes one or more
                             participants
place / unplace / move / resize / change status
                             undoable commands; cancel is an alias of a status change
save                         the form's one save of a reservation, all or nothing (section 11)
apply changes                the edit mode's compound Save of moves and resizes (section 11)
timeline read                one request: subject rows, reservation bars, unavailability
                             windows and calendar state; paged by rows; filters: subject
                             category, only rows with a conflict, hide unavailable subjects
conflict read                conflicts of subjects in a date range, each with its kind and
                             the other side; the screen calls it after a window write
"unplaced" list              a separate, cheap read of reservations without dates
settings                     read and write
occupancy for other modules  a service available through dependency injection (below)
unavailability               no write endpoint of its own — the form sends the request to the
                             existing availability schedules endpoint
```

Later phases add:

```
calendar read                phase 2: reservations of one subject or one target in a range,
                             with the working windows of the subject (sections 11, 18)
services                     phase 3: the booking definition of a catalog product and its
                             requirements, through the factory (section 16)
free slots read              phase 3: starts at which a service has every requirement free,
                             on a grid, at most ninety days (section 17)
pages                        phase 4: booking pages through the factory (section 19)
confirm / decline            phase 4: commands on a request from a page; not undoable (section 19)
public routes                phase 4: page, services, free slots and request, without login,
                             through the public request command (section 19)
```

### API contracts, phase 1

Every route is under `/api/bookings`, exports its OpenAPI description, validates its input with a
zod schema in `data/validators.ts`, and filters by tenant and organization. Lists take `page` and
`pageSize`, with `pageSize` at most 100.

| Method and path | Input | Answer |
|---|---|---|
| `GET/POST/PUT/DELETE /targets` | factory route: name, customer link | target rows with `updatedAt` |
| `GET/POST/PUT/DELETE /subject-categories` | factory route: name, icon, color | category rows with `updatedAt` |
| `GET /subjects` | factory list; filters: category, provider, in use | subject rows with `updatedAt` |
| `POST /subjects` | provider key; either a new record's fields or an existing record's id | the subject row; 409 `subject_already_added`, 409 `provider_record_orphaned` with the created record's id (section 6) |
| `GET /subjects/providers` | — | the registered providers |
| `GET /subjects/candidates` | provider key, search, page | the provider's records not yet on the list |
| `GET /bookings` | page, pageSize, status, target, subject, placed or not | reservations with participants and `updatedAt` |
| `POST /bookings` | target, participants (1–10, each subject and role), duration with unit, expected start, note, optional start date, idempotency key | the reservation and its conflicts |
| `PUT /bookings` | id, `updatedAt`, and any of: target, participants (the whole new list — this is how one is added or removed), expected start, note | the reservation and its conflicts |
| `POST /bookings/actions/place` | id, `updatedAt`, start date | the reservation and its conflicts |
| `POST /bookings/actions/move` | id, `updatedAt`, new start date | the reservation and its conflicts |
| `POST /bookings/actions/resize` | id, `updatedAt`, new duration | the reservation and its conflicts |
| `POST /bookings/actions/status` | id, `updatedAt`, new status | the reservation and its conflicts |
| `POST /bookings/actions/unplace` | id, `updatedAt` | the reservation, now without dates; 422 `booking_not_placed` when it has none, 422 `booking_closed` when closed |
| `POST /bookings/actions/apply-changes` | a list of moves and resizes, each with id and `updatedAt` | per change: applied with its conflicts, or refused with its code (section 11) |
| `POST /bookings/actions/save` | id, `updatedAt`, and any of: target, participants, expected start, note, start date, length — the form's one save | the reservation and its conflicts, or one refusal for the whole save |
| `PUT /subjects` | id, `updatedAt`, and any of: name copy refresh, category, zone, in use | the subject row; taking out of use as in section 6 |
| `GET /timeline` | from, to (at most 366 days), page and pageSize of rows, category, conflicts only, hide unavailable; includes the unplaced list's first page | rows, bars, windows, calendar state, conflicts, unplaced |
| `GET /conflicts` | subject ids (1–100), from, to (at most 366 days), optional reservation to leave out | conflicts per subject |
| `GET /bookings/unplaced` | page, pageSize | reservations without dates |
| `GET/PUT /settings` | the settings of 7.5, one section per save; the holiday list and the exception list are sent whole and replace the stored ones | the settings; defaults when no row exists |

Lists page by `page` and `pageSize` — offset paging, the platform's own; its route factory has no
cursor paging. The bound is the organization's own rows: hundreds of subjects and targets, a few
thousand open reservations.

Command ids follow the existing command ids of the platform, `<module>.<entities>.<action>` with a
plural entity — `resources.resources.create`, `staff.team-members.create` — because interceptors,
the audit log and undo key on them; events use the singular entity, as the root guide says, and
features follow the existing ones, like `resources.manage_resources`. Commands:
`bookings.bookings.create`, `.update`, `.save`, `.place`, `.unplace`, `.move`,
`.resize`, `.change_status`, `.apply_changes`; `bookings.targets.create` / `.update` / `.delete`;
`bookings.subjects.add` / `.update`; `bookings.subject_categories.*`; `bookings.settings.save`;
later `bookings.services.*`, `bookings.pages.*`, `bookings.requests.create` / `.confirm` /
`.decline`. A reservation has no delete command; deleting exists only as the undo of a create.

The timeline answer, field by field — the screen draws from it alone:

```
range, today, wallClock, timeZone     the requested days, today and now in the organization's zone
calendar                              free weekdays and holidays, to grey out free days
rows[]                                subjectId, name, category (id, name, icon, colour), in use,
                                      provider key, card link, whether unavailability is known
bars[]                                reservationId, subjectId, from and to days, target id, name and
                                      colour, status, duration, expected start, note, conflicts[]
unavailability[]                      windowId, subjectId, from and to days, reason
canCreate, canWriteUnavailability     what the current user may do on this screen
unplaced                              the first page of reservations without dates
paging                                page, pageSize, total rows
```

The conflict object, the same in every answer:

```
kind          overlap | unavailability | outside_working_hours | a validator's kind
subjectId     the participant it concerns
window        from, to — the overlapping part
other         for overlap: the other reservation's id, its target's id and name
              for unavailability: the window's from, to and, where the rule has one, its reason
severity      warning | blocking
confirmable   true when the mode is confirm and a confirmation can lift it (phase 2)
```

Errors carry a stable `code` next to the translated message:

```
400 invalid_input            schema failed; the field errors are in details
400 subject_inactive         a participant is not in use
404 not_found                the record does not exist in this organization
409 booking_conflict         reject mode refused an overlap; details.conflicts is the list above
409 confirmation_required    phase 2, confirm mode; details.conflicts is the list to confirm
409 settings_required        a write or the timeline read needs saved settings that do not exist yet (7.5)
409 idempotency_key_reused   the key was used with another payload (section 4)
409 record_conflict          the record changed since `updatedAt` — the platform's optimistic lock
422 invalid_transition       the status change is not in the matrix of 7.1
422 booking_closed           a write other than a status change on a closed reservation (7.1)
422 booking_placed           place on a reservation that already has dates (7.1)
422 booking_not_placed       move on a reservation without dates (7.1)
400 time_zone_required       a first settings save without a zone (7.5)
409 subject_in_use           undoing the addition of a subject that reservations already name
400 unknown_category         a policy exception for a category that does not exist (7.5)
409 target_zone_locked       a target's zone change while it has open placed reservations in working days (7.5)
409 target_in_use            deleting a target with open reservations; details carry their count
409 category_in_use          deleting a category used by subjects or a policy exception
409 subject_already_added    adding a registry record that is already on the list (section 6)
409 provider_record_orphaned the registry record was created but our row was not; details carry its id
403 forbidden                the user lacks the feature the action needs (section 12, permissions)
409 pool_exhausted           phase 3: no free member for a requirement; details name it (section 17)
409 slot_taken               phase 4: the slot was taken a moment earlier (section 19)
```

The reservation form saves with **one command**, `bookings.bookings.save`: whatever changed among
target, participants, expected start, note, start date and length, in one transaction under one
set of locks, all or nothing. A refusal — an overlap under `reject`, a closed reservation — leaves
the reservation as it was and names the field it stopped at. One save is one undo entry and one
`bookings.booking.changed`; server-side it still emits `.updated`, `.placed`, `.moved` or
`.resized` for each kind of change it made, so subscribers see what happened. The single-purpose
action routes stay for the timeline and for other modules. A status change and a cancel go out on
their own, at once. An answer that places, moves or resizes flags a start on a free day (section 8).

Events of the writes: creating a reservation emits `bookings.booking.created` only, also when it is
created with a start date — the payload carries the window. Placing an unplaced one emits
`placed`, unplacing `unplaced`, a move `moved`, a resize `resized`, a cancel `cancelled`; every other
status change rides `updated` with the status in its payload (section 12, Events). There is no
delete route (7.1): `deleted` is emitted only by the undo of a create; undo of any other write emits `updated` with the
restored state.

The timeline read is one request on purpose: the screen needs rows, bars, windows, calendar state
and the unplaced list at once, and separate queries would give flicker and different moments in
time. The category filter gives
the view of free subjects from section 2: the same rows, and you can see which ones have no bar in
a given window.

Every conflict the module returns — in the timeline read, the conflict read and the write
response — says what kind it is and what it collides with. For an overlap: the other
reservation and its target. For unavailability: the window with its dates and, where the rule
has one, its reason. A bar can carry both at once, so it is a list. In advisory mode a person
decides, and without the other side there is nothing to decide on. The two extra filters serve
the same person: "only conflicts" for the morning check, "hide unavailable" when looking for a
free subject.

### Occupancy service

The only server-side entry for other modules. Question: a list of subjects and a date range.
Answer: for each subject a list of busy intervals, each with the identifier of the reservation and
the target. It counts only open reservations. It does not add unavailability — that is different
information, asked from the provider plugins (section 6). It answers in bulk, without paging, and
the date range is capped at 366 days — a longer question is rejected, so the answer has a bound.

### Undo

Commands are undone by the platform's command mechanism: each one saves the state before the
change and can restore it. That mechanism is the audit log's undo, and it sets two preconditions
the screens rely on:

- **the user needs `audit_logs.undo_self`.** The default employee and administrator roles have it;
  a custom dispatcher role must be given it next to `bookings.manage_bookings`, or the "Undo" in
  the confirming message is not offered (section 12, permissions),
- **only the author's latest undoable entry can be undone** — the latest of that author for the
  same record, or their latest overall when the entry names no record. There is no timer. A
  cancelled reservation takes no other write, so a cancel stays its author's latest entry on that
  record and stays undoable (7.1). The module adds one limit: on a closed reservation only the
  closing status change can be undone; any older entry is refused with 422 `booking_closed`. A
  user with `audit_logs.undo_tenant` next to `audit_logs.undo_self` — the default administrator role
  has both — can also undo another user's entry, when it is that user's latest on the record. The
  compound Save of the edit mode (section 11) touches many reservations and names none; it can be
  undone only until the same user writes anything else.

Undo is a write like any other — in reject mode it goes through the
same overlap check, so it will not restore a conflict that a normal write would not let through.
For the same reason undo is refused with 400 `subject_inactive` when one of the reservation's
subjects was taken out of use in the meantime: an undo must not bring back what a new write could
not create.

Undoing the addition of a subject is refused with 409 `subject_in_use` once any reservation names
it; until then it removes our row and keeps the registry's record (section 6).

### Write and conflict

In advisory mode a write that creates a conflict **is not an error**. It succeeds, and the list of
conflicts, in the shape above, comes back in the response.

In reject mode the write fails and returns an error carrying the same list — which subject,
which slot, with what — so the screen can show it instead of saying "could not save".

In confirm mode (phase 2) a write with warnings fails with 409 `confirmation_required`, the same
list and each item marked `confirmable`; the screen asks for the reason and sends the write again
with the confirmed list (section 9). Reject keeps its phase 1 behaviour in every phase: only an
overlap fails, with 409 `booking_conflict`.

### Things that are easy to forget

Every route exports a description for the API documentation — those from the factory and those
written by hand. Without it, the route is not in the documentation.

The last change date does not appear in list responses by itself — it has to be listed explicitly
among the returned fields.

For locking under concurrent edits we use the variant with guards, which the platform points to
for new call sites. The coverage test in core rejects new direct uses of the older variant unless
they are on the allow-list — we do not want to end up there.

### Events

Names are a contract and do not change after release. Pattern: module, entity, action in the past
tense.

```
bookings.booking.created / .updated / .deleted                  not marked for the browser
bookings.booking.placed / .unplaced / .moved / .resized / .cancelled   not marked for the browser
bookings.booking.creating / .updating                           synchronous "before" events, may veto (20)
bookings.booking.changed                                         the only event marked for the browser
bookings.conflict.detected                                       not marked for the browser
bookings.coverage_gap.detected                                   not marked for the browser
bookings.target.created / .updated / .deleted                   factory route events
bookings.subject.created / .updated / .deleted                  `.created` by `bookings.subjects.add`, `.updated` by `bookings.subjects.update`, `.deleted` only on the undo of an add
bookings.subject_category.created / .updated / .deleted         factory route events
bookings.settings.updated                                        after each saved section
```

"Not marked for the browser" means only that: every event still reaches server-side subscribers,
other processes and, when persistent, the queue; the browser mark adds delivery to the browser on
top.

`bookings.booking.changed` carries a list of reservation ids, the subject ids, the affected window,
the status when a single reservation changed, and the kind of change — a write, a Save of the edit mode, a coverage day turning over, a planner
rule changing. It is emitted after every reservation write, once per compound Save, by the scan for
each zone whose day turned over, and by the planner subscriber for the subject concerned. A screen
refetches the range it shows. When a large Save would exceed the stream's 4 KB limit, the platform
cuts the payload to `{ truncated, id }`; the screen treats a truncated `changed` as "refetch what I
show", so nothing is lost. Server-side, the compound Save still emits `.moved` and `.resized` per
applied change.

Later phases add:

```
bookings.service.created / .updated / .deleted                   phase 3
bookings.page.created / .updated / .deleted                      phase 4
bookings.booking.requested / .confirmed / .declined / .expired   phase 4
bookings.booking.paid                                            phase 4
```

Open screens refresh by themselves, without a reload, through **one browser event of its own:
`bookings.booking.changed`.** The platform marks an event for the browser on its definition, and
the browser then receives exactly the payload the event was emitted with — there is no separate,
reduced browser payload. The browser stream filters by tenant and organization, and by recipient
users or roles when the event names them; it does not filter by feature, and the platform has no
resolver of feature holders the event could name. So every signed-in user of the organization
receives a module event, also one without `bookings.view`, and a
target's name can be a patient's (7.4). So none of the reservation events above is sent to the
browser; they keep their full payload for server-side subscribers. After every reservation write
the module emits `bookings.booking.changed` as well, marked for the browser, carrying only the
fields listed above — identifiers, window, status, kind of change — and no names. An
open screen refetches through the module's routes, which check the user's features. The small
payload also keeps under the stream's 4 KB limit, above which the platform cuts any payload down to
an id — a reservation with ten participants and their conflicts would not fit. Completing a reservation, marking a no-show and bringing it back to open ride
`bookings.booking.updated` with the status change in the payload; only cancel has its own name,
because it is the status change other modules react to.

The module declares its own notification types, and the platform's infrastructure delivers them.
The types are `bookings.conflict` and `bookings.coverage_gap`. Background jobs go through the
`bookings-scan` queue, and from phase 4 the request jobs through `bookings-requests` (section 19).
Notifications are merged by a grouping key: conflicts by subject,
gaps by target — so the dispatcher does not get ten notifications about the same excavator.

Conflict and coverage notifications go to the holders of `bookings.manage_bookings` in the
organization; nobody outside it sees them. The platform's "notify the holders of a feature" call
resolves holders across the whole tenant by default, so the module always passes the option that
restricts recipients to the organization. With that option the platform returns no recipients at
all once more than 200 users are candidates. The module does not accept that silent cap, and it
cannot work around it on its own: the platform's only resolver of feature holders is internal to
`notifications`, tenant-wide and unpaged, and importing it would reach into another module's
insides. So the cap is lifted where it lives — the change makes the organization-restricted call
page through its candidates instead of returning nobody, an additive change to `notifications`
(section 23), the same way the read method is a contribution to `planner`. Phase 4 adds the types `bookings.request` — a new
request from a page — and `bookings.request_expiring`, with the same recipients; the customer is
told by e-mail, not by a notification.

A notification is removed for every recipient when what it reported is gone. Each one is
created with the record it is about as its source: the subject for a conflict, the target for a
coverage gap. When the subject has no reported conflict pair left — a write removes the pairs of
the subjects it touched, the scan only those inside its horizon — or the target has no unplaced
reservation inside the threshold, the module deletes the notifications with that source through
the platform's notification service (section 9). That delete is scoped by tenant
and source, not by organization; it is still safe, because a source is a subject's or a target's
own identifier and belongs to one organization. No "resolved" event is needed for this; the table
of reported conflicts (section 9) already knows what was reported. Dismissal still holds: the scan reports a conflict
only once, when it is new, so nothing recreates a dismissed notification the next morning.

### Permissions

Three: view, manage bookings, manage settings. Their identifiers are `bookings.view`,
`bookings.manage_bookings` and `bookings.manage_settings`. The occupancy service for other
modules is called `bookingsOccupancyService`.

Later phases add three: `bookings.override_conflict` to confirm warnings (phase 2),
`bookings.manage_services` (phase 3) and `bookings.manage_pages` (phase 4). Confirming a request
from a page needs `bookings.manage_bookings`, like any other change of a reservation.

Which action needs which feature:

| Action | Feature |
|---|---|
| see the timeline, reservations, targets, subjects, categories, conflicts | `bookings.view` |
| create, edit, place, unplace, move, resize, change status of a reservation; save the edit mode | `bookings.manage_bookings` |
| create, edit, delete a target | `bookings.manage_bookings` |
| list a provider's candidates | `bookings.manage_bookings` plus the registry's own view feature — `resources.view`, `staff.view` (section 6) |
| add a subject | `bookings.manage_bookings`; for a new record also the registry's own create feature (section 6) |
| read and save settings, the conflict policy and its exceptions | `bookings.manage_settings` |
| create, edit, delete subject categories | `bookings.manage_settings` |
| write an unavailability window | `planner`'s right to manage availability (below) |
| confirm warnings under `confirm` (phase 2) | `bookings.override_conflict` |
| create and edit services (phase 3) | `bookings.manage_services` |
| create and edit booking pages (phase 4) | `bookings.manage_pages` |
| confirm or decline a request from a page (phase 4) | `bookings.manage_bookings` |
| undo one's own write from the confirming message | `audit_logs.undo_self` — in the default roles; a custom role needs it (section 12, Undo) |
| edit a subject, take it out of use or back | `bookings.manage_bookings` |
| link a request to a person, or create one (phase 4) | `bookings.manage_bookings` plus `customers`' own people permission |

After the module is enabled, the administrator gets all of them, and a regular employee gets view —
the module works at once, without granting permissions by hand; in an existing installation after
a one-time sync of role permissions (section 14).

One permission from outside the module is added to this: writing unavailability windows requires
the right to manage availability in the schedules. It belongs to `planner`, not to us, and its
check works only with the service from the HR module (section 5).

## 13. Tests as the definition of done

Integration tests come in the same change as the code. Each one sets up its own data, preferably
through the API, and cleans up after itself. None relies on demo data.

This table is also the definition of done: until a row has coverage, the module is not finished.

| Area | What must be covered |
|---|---|
| targets and subjects | write and read within organization bounds; rejection on a stale record version; removing a subject by undo and re-adding it returns to the same row, back in use with a fresh name; there is no route to delete a subject; a subject taken out of use keeps its bars and is refused in any new write with `subject_inactive`; a target with open reservations cannot be deleted and the refusal gives their count |
| reservations | there is no delete route; cancel is the way out; place on a placed one gives `booking_placed`, move on an unplaced one `booking_not_placed`; resize of an unplaced one changes only its duration; unplace clears the dates, keeps duration and expected start, frees the slot and emits `unplaced`; unplace of a closed one gives `booking_closed`; changing the target of a placed one keeps its local start date and recomputes the window in the new target's zone; a duration above 365 working days, a note above 2000 characters and a name above 200 are rejected; a new target with an existing name is accepted with a warning |
| subject categories | name unique per organization regardless of case; a category used by a subject cannot be deleted and the refusal gives the count; a policy exception points at a category |
| providers | creating a subject through each of the three plugins; without the registry's own create permission the plugin is refused before its command runs; attaching a record that already exists in the registry; undoing an add removes only our row and keeps the registry record; a team subject reports unavailability as unknown; a subject from a disabled provider module does not disappear from history and takes no new reservations |
| read method in planner | windows from the subject's own rules; windows from the schedule's rules when the subject has none of its own; own rules switch the schedule off; one-off rules (leave) give windows that keep their stored start and duration, not snapped to the UTC day; every window carries its rule's zone as stored; empty result for a subject with no rules |
| place / move / resize | end computed from duration and the working calendar, including 2.5 days = three days; three days from a Saturday cover Saturday, Monday and Tuesday and the answer flags the free start; every write but a status change on a closed reservation gives 422 `booking_closed`; rejection on a stale version; placing clears the warning counter |
| status change | every pair from the transition matrix: allowed ones pass, disallowed ones are rejected; closed ones free the slot; bringing a completed reservation back to open recomputes conflicts and can fail in reject mode |
| participants | a reservation created through the API with two participants; conflict counted separately for each; the same subject twice in one reservation is rejected; no participant at all is rejected; cancelling frees both; removing one participant leaves the other busy |
| interval bounds | touching reservations do not conflict; overlapping by one day conflicts; "to" before "from" rejected by the database |
| conflicts, advisory mode | the write passes, conflicts come back in the response with their kind and the other side: the other reservation and its target |
| conflicts, reject mode | a second write for the same slot fails, and the error names the subject and the slot; two parallel writes — only one succeeds |
| conflict policy | default mode from settings; a per-category exception wins; a reservation with participants from different categories gets the stricter mode; changing the setting changes the write behaviour |
| conflict with unavailability | always warns, never blocks; on a reservation write it comes back in the response with the window's dates and reason; a window written directly in planner is visible in the conflict read and detected by the scan |
| day of a planner window | a Monday leave stored at UTC midnight lands on Monday in a UTC+2 zone; an all-day inspection stored at Warsaw midnight lands on its own day, not the day before; a 23:00–01:00 window blocks both days; a reservation from Tuesday does not conflict with the Monday leave; a two-day window Mon 00:00Z–Wed 00:00Z blocks Monday and Tuesday in a UTC+2 zone, not Wednesday; a one-day window from the planner date editor on a UTC server lands on its own day; windows anchored to midnights of the subject's zone, of UTC and of the organization's zone are each recognised; a whole-day window anchored to none of them falls back to the middle rule per day; a date-specific rule written under #5868 in `Europe/Warsaw` lands on its own day for a Warsaw subject through its declared zone, also when the server runs on UTC |
| time zone change | a target's zone change is refused with 409 `target_zone_locked` while it has open placed reservations in working days, with their count, and allowed when there are none or only reservations in minutes; the organization's zone change leaves existing targets and subjects unchanged |
| occupancy service | bulk answer shape per subject; open reservations only; unavailability not included; another organization's reservations not returned; a range above 366 days rejected |
| undo | undo into a slot that now conflicts fails under `reject` and succeeds under `advisory` with the conflict returned; undo from the message on the board restores the previous dates; undo of a create removes the reservation; undo of a cancel restores the open reservation under the same checks; a cancel stays undoable by its author after their writes on other reservations; another user can undo it only with `audit_logs.undo_tenant`; an older entry on a cancelled reservation, including its create, cannot be undone (`booking_closed`); only the user's latest entry on a record can be undone — an earlier move of a reservation moved again is refused; a role without `audit_logs.undo_self` gets no "Undo" in the confirming message; undo with a subject taken out of use since gives `subject_inactive`; undoing the addition of a subject that reservations name gives `subject_in_use` |
| locks on every occupancy write | two parallel writes into one slot under `reject` — only one succeeds — for each write on the list of section 9: create with a date, place, move, resize, a participant change, a target change, a form save, a compound Save, a reopening status change, undo; a target change racing a delete of the new target — the delete waits or the change is refused, never a reservation under a deleted target |
| compound Save | part refused under `reject`: the rest applied, refused changes answered with their codes; one undo entry that restores only what was applied; one `changed` event, and a truncated one makes the screen refetch |
| form save | one command; a refused overlap leaves the reservation unchanged, with no half-applied field; one undo entry |
| subjects | an orphaned registry record is offered for attachment, and the form does not resubmit; `PUT /subjects` takes a subject out of use and back |
| limits | a timeline range above 366 days, a conflict read above 366 days or 100 subjects, and a page above 100 are rejected |
| planner subscriber | an HR leave event refreshes open timelines through `changed` and reports a new conflict once |
| search | provisional targets are not found; the target name is found by a three-letter prefix, not by an inner part |
| categories | a category used only by a policy exception cannot be deleted |
| timeline read | response shape: rows, bars, windows, calendar state; paging by rows; category filter; "only conflicts" leaves only rows with a conflict; "hide unavailable" drops subjects with an unavailability window inside the requested range; a reservation with two participants gives a bar in each of their rows; conflict computed on read; completed and no-show bars returned, cancelled ones not; a subject not in use returned only with a bar in the range; rows sorted by category, then name, uncategorised last; overlaps labelled "several targets" before "same target"; only subjects of the own organization |
| "unplaced" list | reservations without dates, paged, own organization only |
| settings | a read with no row returns the defaults and creates nothing; the first save creates the row; write and read; rejection of an invalid time zone; a threshold outside 0–250 rejected; no weekday left as a working day rejected; a first save without a zone gives 400 `time_zone_required`; before the zone is chosen, creating a target or a subject, every reservation write and the timeline read answer 409 `settings_required` while lists still work, and the scan skips the organization; more than 1000 holidays or 200 exceptions rejected; an exception for an unknown category gives 400 `unknown_category`; holidays: one per date, a second entry for the same date refused; a policy exception per category, a missing one meaning the default; another organization's settings are not visible |
| occupancy sources | a registered source's intervals show on the timeline and give warnings only, in every mode; they take no locks, create no notifications and are not returned by the occupancy service |
| time zones | a reservation's days resolved in its target's zone, a window's in its subject's, never the browser's; a Monday leave in Lisbon does not conflict with a Tuesday visit in Warsaw; a Monday HR leave lands on Monday for a subject in Auckland; two visits on one date in Kiritimati and Honolulu are both found by the widened query; coverage "today" is the target's; both clock-change cases; the date library is imported only in its adapter |
| coverage gap, read | working days counted from the calendar (free days, holidays); today counts when it is a working day; the expected start day gives 0 days, not overdue; the day after gives "overdue"; a reservation placed after its expected start shows "starts N working days late"; the same result on the server and in the browser |
| reconciliation scan | signal when the day count entered the threshold; a second run the same day emits no second one; an overdue reservation signals once; each target zone of an organization is processed once per its own local date and a late tick does not skip a day; a target eight hours ahead of the organization gets its new day within an hour of its own midnight; a conflict from a window with no event is detected; a conflict reported yesterday and unchanged is not reported again; a leave approved at 10:00 and a reservation placed into it at 11:00 — reported by the write, dismissed — is not reported again by the scan; a window written beyond the horizon is reported on the day it enters it; a conflict reported by a write beyond the horizon and dismissed is neither removed by the scan nor reported again when it enters the horizon; an HR leave that clashes is reported by the subscriber within seconds and not again by the scan; a planner editor rule, which emits no event, is reported by the next scan; a window beyond the horizon is not scanned; a settings save is not refused because the scan ran in between |
| events | each of the server-side events emitted by the right write; every reservation write also emits `bookings.booking.changed`, the only one marked for the browser |
| notifications | two conflicts of the same excavator merged into one notification; gaps merged by target; a dismissed conflict notification does not return after the next scan; a conflict notification disappears for every recipient once the clashing reservation is moved away, by a write and by the scan; a coverage gap notification disappears after placing, but stays while the target has another unplaced reservation inside the threshold; recipients limited to the organization's holders of the manage permission |
| permissions | a view role does not write; manage reservations without the planner right does not write a window; the administrator does |
| board screen | rows and bars draw, conflicts are marked with their kind and the other side, the view refreshes after an event; a reservation with two participants draws in both rows and moves as one; in edit mode moves and resizes stay a draft, changed bars are marked, "Save" writes all changes as one compound command and keeps refused ones marked, "Discard" drops the draft, leaving with unsaved changes asks first; a viewer has no edit mode; the timeline library loads only on this screen |
| forms | creating a reservation, saving a target, saving settings section by section; the unavailability form takes whole days, writes one rule at the subject zone's midnights, offers planner's reasons for the subject's type and only subjects in use, sends the request to the planner endpoint and, after success, calls the conflict read, which returns unavailability conflicts too (a contract test, not a pass through our server) |
| idempotency | the same create sent twice with one key gives one reservation and the same response; the same key with another payload gives 409 `idempotency_key_reused`; the same key from another user or another organization is independent; a key older than twenty-four hours is removed |
| API contracts | every route answers the shapes and error codes of section 12; 409 `booking_conflict` carries the conflict list; 422 for a transition outside the matrix; `pageSize` above 100 rejected |
| customer link | a target linked to a person shows the person's name; a reservation tab on the customer card lists its reservations; with `customers` disabled the link stays stored and is not shown |
| extension points | every declared host appears in the extension-point catalog the build produces; for each injection spot and replaceable component a test on the real screen, not only on the registry; a mutation guard and a "before" lifecycle subscriber can each refuse a reservation write with their message, in every mode |
| security of reads and events | listing a provider's candidates without the registry's view feature is refused; no `bookings.booking.*` event other than `changed` is marked for the browser; `bookings.booking.changed` carries no target or subject name and stays under 4 KB with ten participants; a user without `bookings.view` who receives it and refetches gets 403 |
| notifications, many users | with more than 200 holders of the feature in the organization, every holder still gets the notification; holders in another organization of the tenant do not |
| scan, one at a time | two workers on the same organization at the same moment — one processes it, the other skips; a run longer than the tick does not start a second one |
| optional modules | without `staff` the module builds and runs: no people or crews offered, the unavailability form hidden, person rows marked "unavailability unknown"; without the scheduler no scan entry is registered and the settings screen says so |
| name refresh | renaming a resource, a team member or a team in its registry renames every subject that points at it |

Phases 2–4 bring their rows with their code:

| Area | What must be covered |
|---|---|
| minutes (2) | end = start + minutes, across a free day too; two visits on one day conflict only when hours overlap; a visit conflicts with a working-day reservation on the same day; an all-day leave blocks the whole day of a visit |
| working hours (2) | a reservation outside the hours warns with `outside_working_hours` and never blocks; a subject with no availability rules is not checked; a working-day reservation warns only on a day with no hours |
| buffers (2) | the category's buffer extends occupancy for conflicts and is not a reservation; from phase 3, a service buffer wins over the category's (tested with services) |
| confirm mode (2) | a write with warnings fails with 409 `confirmation_required` and the list; a confirmation with the same list and a reason passes and stores both; a confirmation with a stale list fails with the new one; without `bookings.override_conflict` it is rejected; an overlap under reject is never confirmed; under reject an unavailability conflict still only warns, as in phase 1 |
| calendar view (2) | reservations of one subject put into days in their targets' zones, not the viewer's — a 23:30 Warsaw visit stays on its day for a London viewer; the ui calendar without a zone behaves as before; moving in the view goes through the move command |
| services (3) | a product without a definition is not bookable; a reservation of a service gets participants from every requirement, its duration and its price copy; per-unit price times duration; changing the definition does not touch made reservations |
| pools (3) | round robin over free members in a stable order; a busy member is skipped; a count of two gives two different members; no free member fails with the requirement named; two parallel writes for the last free member — only one gets it; a hand-picked busy member gives a normal conflict |
| definition of a day (3) | three nights from 1 June are 1 June 15:00 to 4 June 11:00; a stay leaving at 11:00 and one arriving at 15:00 do not conflict |
| free slots (3) | only starts where every requirement has a free member; the grid and the ninety-day cap; computed on committed data |
| pages (4) | slots respect lead time, horizon and grid; a public free slots call longer than fourteen days is rejected; a request holds its slot; a slot taken a second earlier gives "just taken"; `planner` unreadable gives no slots; rate limit and origin check; the same request twice gives one reservation; a reused key with other details is refused and returns nothing of the first request; the organization comes from the page, never from the request |
| confirmation (4) | confirm and decline; an unconfirmed request expires on time through its delayed job, and through the hourly safety net when the job is lost; "close to expiring" notifies staff; changing time or person of an unpaid request sets it back to awaiting and restarts the waiting time — the old expiry job does nothing; a paid reservation moved by staff stays confirmed and the customer gets an e-mail |
| customer (4) | an anonymous request links to no person and creates none, whatever e-mail is typed; its provisional target is absent from the target list and picker; at confirmation staff see the matching targets and attach, create or leave unlinked; attaching moves the reservation and soft-deletes the provisional target; decline and expiry soft-delete it; with the account option the target is linked to the logged-in person at once; contact fields are stored encrypted with the consent proof and cleared after the page's retention |
| payment (4) | confirming with payment on creates a checkout link for the reservation's total; a completed transaction marks it paid |

## 14. Translations, logs, deployment

### Translations

Every string the user sees sits in the module's translation files, in all languages required by
the translation sync check of the core repository. No labels are hard-coded in the code. The public
booking pages (phase 4) follow the same rule, and the page shows the language the customer's
browser asks for when it is one of them.

The timeline component translates nothing by itself. It gets ready strings from outside, so the
screen that embeds it does the translating — through the platform's translation mechanism, like
every other screen. Thanks to this, the component can be taken into another product without
changes.

### Logs

We log with the platform's tool, in fields, not in glued sentences. How much to log is set in the
environment.

What happens in the module is best seen through its events: what was placed, where a conflict
came up, where a coverage gap is coming. They can be listened to with a subscription, sent to the
browser or turned into a notification. The module adds no counters or charts of its own.

Every path that degrades and carries on — instead of failing the request — reports the failure to
the platform's error reporting with a stable code, so a silent degradation is still seen:

```
bookings.planner_unreadable      unavailability shown as unknown because planner did not answer
bookings.provider_failed         a provider plugin failed; its rows are read-only
bookings.name_refresh_failed     a registry's update event could not refresh a subject's name
bookings.notification_failed     a notification could not be created or removed
bookings.scan_org_skipped        the scan skipped an organization after an error
bookings.expiry_job_failed       phase 4: an expiry job failed and waits for the safety net
```

### Where the module lives

It lives in the core repository as a module in `packages/core/src/modules/bookings`, next to
`planner`, `staff` and `resources`, and is enabled separately in each application, because not
every application books anything. The timeline library does not reach applications that do not
use it: it is loaded lazily, only on the timeline screen (section 11). Reservations are a layer
above the resources registry, HR and the availability schedules, not a foundation they stand on.

The platform's guard tests reach the module in two ways:

```
scan every package by themselves        the command sweep of optimistic locking, the workspace UI
                                        sweep, the indexing check of factory routes
driven by a hand-kept map with paths    the editable-entities guard and the record-locks audit
under packages/core/src/modules
```

As a module in `packages/core` it is covered by all five: the change adds its entities to the map
of the editable-entities guard, and the record-locks audit reads that same map.

The alternative is its own package in the same repository, `packages/bookings` published as
`@open-mercato/bookings`, the way `checkout`, `documents` and `webhooks` are. It is just as much
part of the core repository and is released with it; an application installs the package and
enables the module. The cost: the first three guard tests see it by themselves, and the change
must extend the editable-entities guard and the record-locks audit to read entities outside
`packages/core`. We propose `packages/core`; the choice is the maintainers' (section 21).

Beyond that, the module follows the repository's conventions for a new module:

- lazy loading of heavy libraries with an import-boundary test,
- mutation guards on hand-written routes,
- the schema snapshot in the same change as the migration,
- the indexing configuration on every factory route that lists an entity,
- a full `error`-severity override block for the `om-ds/*` rules in `eslint.ds.config.mjs`, as
  every new module must add,
- its features in `acl.ts`, the same features in `defaultRoleFeatures` of `setup.ts`, and, for
  existing tenants, `yarn mercato auth sync-role-acls` in the enabling instructions; phase 4 adds
  `defaultCustomerRoleFeatures` only if the customer login option is used,
- a row for this spec in the index of `.ai/specs/README.md`.

### Enabling and disabling

The module's migrations only create new tables and touch nothing that is already in the database
— so enabling it on a running installation is safe. Permissions for the default roles are created
by the module setup that the platform runs when a tenant is created; it seeds no settings and no
records, because nothing can be created before the zone is chosen. Demo data, where an installation
wants it, comes from the platform's example seeding, which saves settings with a zone first. For an
installation that already exists, the platform commands for seeding defaults and syncing role
permissions do the same — we list them in the enabling instructions.

Enabling, in order:

1. **Set the organization's time zone** on the settings screen. Until then creating a target or a
   subject, every reservation write and the timeline read answer 409 `settings_required`; lists,
   categories and the settings save itself work (section 7.5). This is the one step nobody can skip.
2. For an existing installation, run the platform's commands for seeding defaults and syncing role
   permissions.
3. A custom dispatcher role needs `audit_logs.undo_self` next to `bookings.manage_bookings`, or its
   users get no "Undo" (section 12, Undo). The default roles have it.

Everything else needs no step: the other settings have built-in defaults until the first save, and
the scan's single system-scope scheduler entry is registered by the module's `seedDefaults` hook,
upserted by its fixed UUID on every tenant's run (section 5). An organization added after the module is enabled is handled the same way as the first
one — it, too, starts by choosing its zone.

Disabling is deactivation. Tables and data stay, and nothing outside the module depends on them.

The read method in `planner` (section 5) ships in the same change as phase 1, so there is no
release of the module without it and no version check is needed.

Each later phase ships as its own change: its migration adds tables and nullable columns, its
setup adds permissions to the default roles, and the feature's screens show only to users who
hold its permissions.

The dependencies are listed once, in section 5. Two points matter for enabling. Only `resources`
and `planner` are required, and the generator checks they are enabled. An installation that
reserves only equipment can run without HR, but then planner refuses rule writes, so inspections
and breakdowns cannot be entered from our screen until planner gets an access path that does not
need HR — planner's limitation, stated in section 5. And an installation without the scheduler
gets no notifications from the scan.

## 15. Dependencies and conventions

### Which direction we reach

The module reads from the availability schedules and from the subject registries. It writes there
only when it creates a thing that should live in that place: a person in HR, equipment in the
resources registry, an unavailability window in the schedules. It never copies its own truth
there — reservations, occupancy and conflicts stay with the module.

### No table relations across module boundaries

For foreign records we keep only the identifier, without joining tables through the relation
mechanism. When a query must reach across a module boundary — for example to sort reservations by
subject name — the join is given in that specific query, not declared once for good. When a
foreign record must be read by identifier — for example a subject's schedule — the provider
plugin reads it through that module's public surface: the query engine over `resources`' entities,
the directory service of `staff` (section 6); never by importing an entity class.

### Writes

Every change goes through a command. What happens after it — sending an event, clearing the cache
— fires only after the write commits, never during it.

Input is validated with a schema, and every query filters by organization and tenant.

### The core does not know where data comes from

The conflict engine and the working-day arithmetic know nothing about routes, commands or the
database. The write and read layer sits above them and follows the rules of the project it lives
in.

So the core moves without changes, and only what surrounds it is adapted.

## 16. Services from the catalog

Phase 3.

### What a service is

A service is something a customer pays for and that takes people and things for a stretch of
time: a dental check-up, a hotel night, a machine with an operator for a day. It is a product in
`catalog` — the price, the description and the promotions already live there. The module adds
only what booking needs: how long the service takes and what it requires.

Any product type can be a service. A product becomes bookable when it has a booking definition;
without one it is a product like any other and the module does not see it.

### What the module stores

The booking definition is the module's own data, keyed by the product identifier — no relation
to the catalog table, the same rule as everywhere else (section 15).

`bookings_services`

| Column | What it holds |
|---|---|
| product | identifier of the catalog product |
| duration | the default duration, with its unit — working days, minutes or days (sections 4, 18) |
| price basis | whether the catalog price is per reservation or per unit of the duration |
| buffer | optional time after each reservation, in minutes (section 18) |
| day | optional definition of a day for the unit `days` (section 18) |
| in use | whether new reservations of this service can be made |

`bookings_service_requirements`

| Column | What it holds |
|---|---|
| service | which service it belongs to |
| role | the participant role it fills: performer, place, supporting equipment (7.2) |
| source | where a matching subject comes from: a role in `staff`, a resource type in `resources`, or a fixed list of subjects |
| reference | the role or the resource type, when the source is one of them |
| allowed subjects | an optional list that narrows the source to chosen subjects |
| count | how many subjects of this kind the service needs; one by default |

A dental check-up is three rows: one performer from the role "dentist", one performer from the
role "assistant", one place from the resource type "surgery". A hotel night is one row: one place
from the resource type "double room".

Why the module's own tables and not custom fields on the product: a requirement is a list of
structured rows, and custom fields hold flat values. And the rule "who is needed for this" is
booking logic — it belongs to the module that owns reservations, not to the catalog.

### Where it is edited

On the product screen of `catalog`. The module injects a "Booking" section into the product form
through the form extension host that `catalog` already declares for it (`crud-form:catalog.product`)
— the catalog does not know about
reservations, and the user does not leave the product to make it bookable. The section saves
through the module's own commands.

### A reservation of a service

A reservation gets two new optional columns: the service, and a copy of the service name taken
when the reservation is made. A reservation without a service stays valid — everything from
phase 1 works as before.

When a reservation of a service is made:

1. the duration is copied from the service; the user can change it on this reservation,
2. each requirement turns into participants with the requirement's role — chosen by the user,
   or picked from the pool by the module (section 17),
3. the reservation is free only when every participant is free in the window. This needs no new
   rule: the engine already counts each participant separately, and a reservation is in conflict
   when at least one participant is (7.2). The locks are taken in every mode, in a fixed order, as
   for any reservation with several participants (section 9).

Changing the service definition later does not touch reservations already made — the same rule
as for settings (7.5).

One reservation holds one service. A visit with two services is either two reservations or one
bundle product in the catalog with its own requirements.

### Price

When a reservation of a service is made, the module loads the product's price rows from `catalog`
and lets the catalog pricing service pick the one that applies — that service selects among rows
it is given, it does not look products up — and stores a copy on the reservation: the unit price, the currency, the price kind and the
total. A copy, because the catalog price changes later and a reservation keeps the price it was
made at. A reservation without a service has no price. Charging the customer — a payment link
through `checkout` — is phase 4 (section 19).

The service's price basis decides the total. Per reservation: the total is the price. Per unit:
the total is the price times the duration in the service's unit — three hotel nights are three
times the night price, two rental days twice the day price. Changing the duration recomputes the
total from the copied unit price, not from today's catalog.

### When the catalog module is disabled

Reservations of services stay, with the copied name and price. New reservations of a service
cannot be made, and the booking section is not injected anywhere.

## 17. Pools and automatic picking

Phase 3.

### What a pool is

A pool is a requirement that names a kind of subject instead of one subject: "any dentist", "any
surgery", "any double room". It comes from a service requirement (section 16) or is given
directly in a write command.

The members of a pool are the subjects on our list (section 6) that are in use and whose provider
record has the asked role or resource type, narrowed to the allowed subjects when the requirement
lists them. Roles come from `staff`, resource types from `resources`.

Providers get a fifth question for this: **which of these subjects belong to this role or type**.
The `resources` plugin answers it through the query engine, filtering on the resource type, a base
column read live. The `staff` plugin answers through the staff directory service (section 6): a
team member's roles are stored as a list inside one column, which the query engine cannot filter
by containment, so the plugin lists the active members of the organization and keeps those whose
role list holds the role, in memory. Pools are lists of people, so the list is short.
A provider that has no roles or types answers with an empty pool.

### How a subject is picked

The user can always pick a member by hand. When they do not, the module picks, on the server, in
the write command:

1. the candidates are the members free in the window: no overlapping open reservation, no
   unavailability window and — in phase 2 and later — inside working hours,
2. among them the module takes the next one after the one picked last time for this pool, in a
   stable order of members — round robin,
3. a requirement with a count of two takes two different members; one subject never fills two
   requirements of the same reservation (7.2).

The pointer "picked last time" is kept per pool in `bookings_pool_cursors` and moves in the same
transaction as the write. A cancelled reservation does not move it back.

Round robin is the default strategy, not the only one. The picking strategy is a registry
(section 20): a product can register "least booked this week" or "the one closest to the site"
without changing the module.

### Under concurrent writes

Two customers can ask for the last free dentist at the same moment. So the pick runs inside the
write transaction, after taking the locks on all members of the pool in a fixed order, by subject
identifier — the same rule as for several participants (section 9). Pools are lists of people or
rooms, not thousands of rows, so locking the whole pool is cheap. Under `advisory` the locks are
taken too, because a pick that hands the same dentist to two visits is wrong in any mode.

### When nobody is free

The write fails with an error that names the requirement and the window. The module does not
pick a busy member and report a conflict instead — a pick is a promise that the subject is free.
The user can still choose a busy member by hand; then the normal conflict rules apply.

### After the pick

The participant row records which requirement it fills and whether it was picked automatically.
Moving or resizing the reservation later keeps the participants; if one of them is busy in the new
window, that is a conflict like any other. The module does not re-pick on its own — that would be
a cascading move (section 4).

### Free slots

The same rules give one more read: **free slots** for a service in a date range, on a grid —
the starts at which every requirement has a free member. Staff use it to find the first free
date; the public page uses it as its only source of slots (section 19). It runs on the committed
state of the database, never on the search index, and the range is capped at ninety days.

## 18. Time: minutes, working hours and the definition of a day

Phase 2, except the definition of a day, which comes with phase 3.

### Reservations in minutes

The duration unit `minutes` is in the model from phase 1 (section 4). In phase 2 the screens and
the commands accept it. The user gives a start date and time in the target's zone and a duration
in minutes; the end is the start plus the duration, in real time, not in working time. A reservation
in minutes does not skip free days — a ninety-minute visit on a Saturday is ninety minutes on that
Saturday.

The working-day rules of section 8 stay for reservations in working days. Half days exist only
there.

### Comparing reservations of different units

Two reservations in working days are compared as dates (section 8). As soon as one side is in
minutes, both are compared as instants: a reservation in working days then occupies whole days in
its target's zone — from the start of its first day to the start of the day after its last one —
so it conflicts with a ninety-minute visit on any of those days, and two visits on the same day
conflict only when their hours overlap. No unit needs its own rule.

An unavailability window is compared the same way. For a reservation in working days the
day-of-window rule of section 8 still applies. For a reservation in minutes the window is compared
as it is stored, with one exception: an all-day window blocks the whole day the rule of section 8
gives it, in the subject's zone, so a Monday leave stored at UTC midnight blocks all of Monday for a
subject in Warsaw, not Monday 02:00 to Tuesday 02:00.

### Buffers

A subject category can carry a buffer after each reservation, in minutes: the time a room needs to
be cleaned, a machine to be checked. For conflicts a reservation occupies its window plus the
buffer; on the timeline the buffer is shown as a lighter tail of the bar, not as a reservation. A
service can carry its own buffer, which wins over the category's.

### Working hours

A subject can work only at certain hours: a doctor from 8 to 16, a surgery open on weekdays. These
hours already live in `planner` as availability rules, entered on the `staff` and `resources`
screens. The module does not keep its own hours.

The read method added to `planner` (section 5) gets a second part of the answer: **the working
windows** of the same subjects in the same range. Recurring availability rules are expanded by the
availability function `planner` already has. One-off availability rules are not: that function
turns a one-off availability day into a full UTC day and drops its hours, so a doctor working
10:00–14:00 on one Saturday would look available all day. The read method expands one-off
availability rules on its own path, as stored, start plus duration — the same way it expands
one-off unavailability (section 5). A subject with no availability rules has no working
hours — the module then does not check them and says so once, the same way as when `planner`
cannot be read.

A reservation outside working hours is a conflict of its own kind, `outside_working_hours`. It
warns and never blocks: under `advisory` and `reject` it only warns, under `confirm` it needs a
confirmation like every warning (section 9) — the same as a conflict with unavailability. A reservation in
working days is checked by the day: it warns only when the subject does not work at all on one of
its days.

### The definition of a day

A hotel night does not run from midnight to midnight: a guest arrives at 15:00 and leaves at 11:00
the next day, and the room is cleaned in between. A machine rented "per day" may run from 7:00 to
19:00.

So a service or a subject category can define its day: a start time and an end time, where the end
can fall on the next calendar day. A duration in the unit `days` then counts such days: three
hotel nights from 1 June are 1 June 15:00 to 4 June 11:00. The unit `days` is the third value of the
duration unit, added in phase 3. It counts calendar days, not working days — a hotel works on
Sundays. The default day, when nothing is defined, runs from midnight to midnight in the target's
zone.

The engine needs nothing new: the window is turned into instants at the edge, and the engine
compares instants. Two stays where one guest leaves at 11:00 and the next arrives at 15:00 do not
conflict.

### On the timeline

Reservations in minutes and in days with a defined day are drawn at their real hours. On the day
scale a short bar is drawn at least as wide as a quarter of a day, so it can still be grabbed. The
hourly scale comes in phase 2 (section 11).

## 19. Public booking pages

Phase 4.

### What it is

A page where a customer books a service without calling: they pick the service, optionally the
person, a free slot, and leave their details. Staff confirm the request. It works the way payment
links in `checkout` work — staff create a page, get a link and share it — and the way public booking
tools like cal.com and Calendly work for the customer.

It is a second entry next to the staff screens, not a reversal of the module. Everything a staff
write does — conflicts, pools, the working calendar, price — applies the same way.

### The page

`bookings_pages`

| Column | What it holds |
|---|---|
| slug | the address of the page; unique in the installation |
| services | which services can be booked on it |
| subject choice | whether the customer picks a person from the pool or the module picks one |
| lead time | the minimum time between now and the start of a slot |
| horizon | how far ahead slots are offered; at most ninety days |
| grid | the step between slot starts, in minutes |
| confirmation | whether staff confirm each request; on by default |
| confirm within | how long a request waits for confirmation |
| payment | none, or a payment link after confirmation |
| account | whether the customer must log in with a customer account |
| keep requests | how many days declined and expired requests keep their contact details; ninety by default |
| active | whether the page takes requests |

Defaults: no login, a fifteen-minute grid, two hours of lead time, sixty days of horizon, confirmation
on, twenty-four hours to confirm, no payment.

### The flow

```
customer opens /book/{slug}          services from the page, prices from the catalog (16)
customer picks a service and a slot  free slots read (17), computed on the server
customer leaves details              name, e-mail, phone, consents
server writes the request            the public request command, with an idempotency key (below)
customer sees "request received"     what they booked, and that it waits for confirmation
staff confirm or decline             one click on the reservation
customer gets an e-mail              confirmed with the details, or declined
```

### Confirmation

A reservation made from a page has a confirmation state: awaiting, confirmed, declined, expired. A
reservation made by staff has none — it needs no confirmation.

An awaiting request **holds the slot**: it is an open reservation, and the next customer does not
see that slot. Otherwise two customers would get the same slot and one of them a decline.

### Expiry

A request nobody confirms within the page's time expires: it moves to expired, which closes the
reservation as cancelled, frees the slot and sends the customer an e-mail. Staff get a notification
when a request arrives and once more when it is close to expiring.

Expiry has its own trigger, not the scan — the scan processes each zone once per local date
(section 9), so a twenty-four-hour expiry tied to it could be a day late. When a request is
written, the module puts two delayed jobs on a queue of their own, `bookings-requests` —
"close to expiring" and "expire", each delayed by the time left to its instant (the queue takes a
delay, not a date). A job that finds the request already confirmed or declined does nothing. The
queue is separate from the scan's, so a long scan run, which works one organization at a time, never
holds expiry back. As a safety net for a lost job, every hourly tick of the scheduler entry also
expires the overdue requests of every organization. So a request expires on time, and at worst an
hour late when its job was lost.

**How a request ends.** Confirming keeps the reservation open and marks it confirmed. Declining
and expiring both close the reservation as cancelled, free the slot and soft-delete the provisional
target (The customer, below); declining emits `bookings.booking.declined` and expiring
`bookings.booking.expired`, each with the cancelled status in its payload — not a second
`.cancelled`. Confirm and decline are not undoable: each sends the customer an e-mail that cannot be
taken back, so a mistaken decline is put right by booking the customer again. The request's
idempotency key lives in `bookings_idempotency_keys` with the page as its scope (section 4) — one
store of keys, not two.

### Changes after the request

Changing the time, the person or the room of an awaiting or confirmed request that is not paid sets
it back to awaiting, because the customer agreed to something else. The waiting time starts again
from that change: the module puts two new delayed jobs on the queue, and the old ones find a
newer version of the request and do nothing. The customer gets an e-mail with the proposed change.

A paid reservation stays confirmed when staff move it: setting it back to awaiting would leave a
customer who paid with an unconfirmed visit. The customer gets an e-mail with the new details. When
the change alters the total — a longer stay — the difference is shown to staff and is not charged
or refunded by the module (see Payment).

### Who writes

The page has no logged-in user. The module follows the pattern `checkout` already uses for its
public payment route: the route declares no authentication, finds the page by its slug, takes the
tenant and the organization from the page — never from the request — and runs the module's own
request command with a command context that has no user and is scoped to that organization. It
does not use a system actor, which the platform reserves for paths that are not HTTP, and it needs
no API key or service account.

That command is the only command reachable from a route without authentication — the scan, the
expiry jobs and the retention clearing also run without a user, but from the queue — and it checks everything
itself: the page is active, the service is on the page, the slot is free under the locks. It
writes the reservation and the request; it does not create or change anything in `customers`
(see The customer). No public route writes to a table directly.

### Protection

- a rate limit per address and per page, through a module-local wrapper over the platform's
  rate-limit helper, as `checkout` does, and a check of the request's origin against an allowlist
  read from `BOOKINGS_ALLOWED_ORIGINS`, falling back to `APP_URL` and `NEXT_PUBLIC_APP_URL` —
  the same shape as `checkout`'s,
- an `Idempotency-Key` header required on the public submit, as `checkout`'s public submit does,
- the idempotency key from phase 1, scoped to the page (section 4), so a double submit gives one
  request and a reused key with other details is refused,
- the slot is checked again in the write transaction, under the pool locks (17); a slot taken a
  second earlier gives a clear "this slot was just taken" instead of a second booking,
- the free slots read on the public route covers at most fourteen days per call; the page moves
  through the horizon week by week. The cost of one call is bounded: one bulk read of the
  occupancy and the windows of the pool members over those days, then the grid computed in memory
  — at most fourteen days times the starts of one day, times the requirements of the service,
- when `planner` cannot be read, the page offers no slots at all — fail closed. The staff screens
  warn in that case instead; a customer must never get a slot that is not really free,
- a CAPTCHA is not built in; it can be added through an extension point of the form (section 20).

### The customer

What a customer types into an anonymous form is a claim, not an identity. If the module linked the
request to the person with that e-mail, anyone could put a visit into someone else's history by
typing their address. So an anonymous request is linked to no one when it is written. Its contact
details — name, e-mail, phone — and the consents stay on the request (below).

A reservation needs a target, so the request gets a **provisional target**: a target named after
the customer and marked as coming from a page request. Provisional targets do not appear in the
target list or in the target picker, so they do not flood it with one entry per request. What
happens to one depends on how the request ends:

```
confirmed, linked to an existing target    the reservation moves to that target; the provisional
                                           one is soft-deleted
confirmed, new person or left unlinked     the provisional target becomes a normal target
declined or expired                        the provisional target is soft-deleted with the request
```

So "one person, one target" (7.4) holds for everything staff see: a returning customer is attached
to their existing target at confirmation, and the provisional one disappears.

When staff confirm the request, the confirmation screen shows the targets linked to people in
`customers` that match the e-mail or the phone, and staff choose: attach to one of them, create a
new person, or leave the target unlinked. A person is created or linked only by staff, through the
normal `customers` commands, with their permissions. `customers` has no tool to merge people today, so a duplicate
created here stays a duplicate; that is stated as a residual risk (section 25).

With the account option on, the customer logs in through `customer_accounts` before booking. Their
identity is then verified, and the target is linked to their person at once.

### What the request stores

`bookings_page_requests`

| Column | What it holds |
|---|---|
| reservation | the reservation it created |
| page | the page it came from |
| contact | name, e-mail and phone as typed; encrypted |
| consents | which consent texts were accepted, in which version, and when; the same proof shape `checkout` keeps for its legal consents |

The contact fields are personal data and are declared in the module's encryption map. The platform
has no retention setting for customer data to lean on, so the page carries its own: **keep declined
and expired requests for N days**, ninety by default. After that the scan's hourly tick clears the
contact fields of those requests and keeps the rest — dates, service, consent proof without the
person — so reports still count them. A confirmed request keeps its contact fields as long as the
reservation exists; once staff linked it to a person, that person in `customers` is the record of
truth.

### Payment

With payment on, confirming a request creates a payment link in `checkout` for the price of the
reservation (section 16) and sends it to the customer. A completed transaction marks the
reservation paid. A paid reservation cannot be set back to awaiting. Refunds and extra charges are
not part of this module — they stay in `checkout` and the payment gateways.

### Not in phase 4

Cancelling or moving a reservation by the customer from a link in the e-mail, several services in
one request, reminders by SMS. The page and the confirmation state leave room for them.

## 20. Extension points

Every phase.

The module is meant to be the base for booking products built for one business: a clinic, a hotel,
a rental company, a construction dispatcher. They must be able to change what the module shows and
decides without forking it. So the module declares its extension points in `extension-points.ts`,
the way core modules do, and each one appears in the generated catalog of extension points.

Each phase adds the points of its own screens. Each point has a test on the real component, not
only on the registry.

### Data

- **custom fields** on reservations, targets, subjects, services and pages,
- **response enrichers** on the reservation, the timeline read and the free slots read — the factory
  applies them to its own routes, and the hand-written reads apply them themselves — so a product
  can add its fields to what the screens get,
- **events** for every write (section 12), with browser delivery for reservation changes.

### Writes

- **mutation guards and interceptors** on every hand-written route — place, unplace, move, resize,
  change status, save, apply changes, confirm, the public request — not only on the factory routes,
- **product rules on writes** go through the seams the platform already has, not a new one. Command
  interceptors cover every command of the module by themselves. Mutation guards and the synchronous
  "before" lifecycle events run by themselves only on factory routes; the reservation actions —
  place, move, resize, unplace, status, the form's save, Save of the edit mode — are hand-written, so the module's
  shared write path calls the guards and runs the "before" events itself, with the same payload a
  factory route would give. The events are `bookings.booking.creating`, `.updating` and the like,
  where a subscriber can veto with a status and a message. This is where a clinic adds "a child
  patient needs a guardian" or a product adds qualification matching (section 4) — without changing
  the engine. A product rule that blocks is a business rule, so it blocks in every mode. All three
  run before the module's transaction and hold none of its locks, so a slow product check never
  holds a subject's lock. A product rule that must see the final state inside the transaction needs
  the transactional pre-write hook the platform is adding to its command bus (proposed in the open
  pull request for configurable calendar event types); the module adopts it when it lands and does
  not invent its own.

### Domain registries

- **providers** of subjects (section 6),
- **occupancy sources**: another module can feed busy intervals of a subject into the engine, next
  to reservations and unavailability. Meetings from the `customers` calendar can be one — the module
  then sees a doctor's meeting as occupancy without copying it. A source is read-only input: its
  intervals are shown on the timeline and give conflicts that only warn, in every mode; they take
  no locks, so they never decide a write under `reject` or `confirm`; the scan does not report them
  and they create no notifications; the occupancy service does not return them, because it answers
  for reservations only. Taking part in locks and notifications needs the source's module to
  promise the same consistency as reservations, and that is left for when a source needs it,
- **picking strategies** for pools (section 17),
- **conflict kinds**: a product can add its own kind of conflict with its own label and severity.

### Screens

- **forms** — reservation, target, subject, service section, settings, page — as form extension
  hosts: a product adds fields and sections,
- **tables** — reservations, unplaced reservations, targets, subjects, services, pages — as table
  extension hosts: columns, row actions, bulk actions, filters,
- **injection spots** on the timeline toolbar, the timeline row header, the reservation card and each
  step of the public page,
- **component replacement** for the reservation bar, the reservation card, the subject row header and
  the steps of the public page. A product replaces how a visit looks without touching how it is
  stored.

"Visit", "stay", "rental" or "job" is therefore not a type in the module. It is a product's
configuration of the same reservation: its services, its custom fields, its validators and its
replaced components.

## 21. What changed and what we do not know yet

### Changes in version 4

Answering the core maintainers' comment of 2 October: the module should live in core, cover the
whole booking domain and be extensible, with phases chosen to fit a first delivery. Compared with
version 3.2 (the version under review in PR #33), heaviest first.

**Where it lives.** In the core repository; a module in `packages/core` is proposed, its own
package in the same repository is the alternative (14, 21). The read method in `planner` ships with
phase 1, so the peer dependency, the startup check and the copied guard tests of version 3 are gone
(5, 14).

**Scope.** The whole module, in four phases, with user stories and acceptance criteria (4).
Phase 1 is version 3's scope plus the customer link, the idempotency key and extension points;
phases 2–4 add hours and calendar views, services and pools, and public booking pages (16–19).

**Dependencies.** Only `resources` and `planner` are required. `staff` is optional and leaving
core, so it is a soft dependency: people and crews are read through two new read-only methods
`staff` registers, under a local contract type and an import-boundary test; a third built-in plugin
covers `staff` teams. `scheduler` is soft too (5, 6).

**Time zones.** Three zones — the organization's, the target's, the subject's. On the day scale
dates are compared, not instants. The day of an all-day window is recognised from its anchor, the
rule's declared zone first; planner's zone semantics are in flight (#5862, #5868) and named as a
dependency (8, 21).

**Data model.** New tables: subject categories, holidays, policy exceptions, idempotency keys,
reported conflicts, scan state. A target carries a customer link, a colour and a zone; a subject a
kind and a zone. `jsonb` only for two write-once proof snapshots. Indexes per query and a search
configuration (7).

**Settings.** The organization's zone has no default; until it is set, writes and the timeline
answer 409. Settings save section by section. Why a table and not module configuration (7.5).

**Conflicts.** A third mode, `confirm`. Every write that changes occupancy locks its target and
subjects, in every mode, and computes conflicts under the lock. Reported conflicts are recorded,
so writes, the planner subscriber and the hourly scan — per target zone, one run per organization
at a time — report each conflict once (9). Notifications stay inside the organization, past the
platform's 200-candidate cap through an additive change to `notifications` (12, 23).

**Reservations.** No user delete — cancel is the way out; unplace; closed reservations are
read-only; the form saves with one command, the edit mode of the timeline with one compound
command; undo's platform preconditions; a start on a free day is flagged; limits (7.1, 11, 12).

**Subjects.** Taken out of use, never removed; listing a registry's candidates needs its view
feature; names refreshed from the registries' events (6, 7.3).

**API and events.** Phase 1 routes, the conflict object, error codes and command ids; the full
event list, where only `bookings.booking.changed` — names-free — is marked for the browser (12).

**One store of occupancy.** The calendar's visit example in an open platform pull request is named
as a second engine; the proposal is that `bookings` is the single store (1, 21).

**New sections**: implementation plan (22), migration and backward compatibility (23), frontend
architecture contract (24), risks and impact review (25), final compliance report (26). New
production dependencies for approval: the `vis-timeline` tree and `@date-fns/tz` (8, 11, 26).

### Changes in version 3

Heaviest first. Two of them are superseded by version 4 and marked so.

**People are a full subject.** The previous version cut them from the scope, arguing that the
platform has no registry of people. There is one — the HR module. When adding a subject, there is
a choice: person or non-person, and it decides where the record lands and which form the user
sees.

**The module keeps its own list of subjects.** A new section describes how a subject gets into
the module from any registry, what a provider must be able to do, and what happens when its
module is disabled. The previous version had a column for this but no mechanism. Providers
register through a plugin registry of the module, not through a key in the dependency container.

**A reservation can take several things at once.** The subject moved from a column to a separate
participants table. The model, the engine and the API take a list from the first version; only
the screen writes one, so the second participant is a screen change and nothing released has
to move.

**A conflict can be rejected.** The behaviour is a setting: advisory or reject, advisory by
default. The mode has a default for the organization and exceptions for chosen subject
categories; with several participants the stricter one applies. Rejection applies only to
overlapping reservations; a conflict with unavailability always only warns.

**Conflict detection moved from the background to the response of a reservation write.** Under
advisory it is computed after the commit, under reject the overlap check runs before the commit,
in the transaction. A window write is handled by a separate conflict read called from the screen,
and by the scan.

**The daily scan is the source of truth for unavailability changes.** Rule-change events, where
planner sends them, only speed things up. The document does not claim which write paths send
them.

**The target is a permanent entity.** No dates, picked only from a list, no free typing. Address is
no longer a core field.

**We add a read method for unavailability windows to planner.** The previous version promised
that the module works on an untouched planner — that sentence is gone, because the mechanism it
relied on does not exist. The caller passes the subject's schedule; planner decides the precedence
between own rules and the schedule and expands one-off rules. The shape of the method is a
proposal to agree with the planner maintainers.

**We take unavailability windows as ready instants** and do not convert them through the zone
stored on the rule — the platform does not use it either. On the day scale the day of an all-day
window is read from its middle in the company's zone, because planner's write paths anchor the
window's midnight differently; a window with real hours blocks every day it touches. Numeric
examples in section 8.

**The model is pinned down:** half-open intervals, touching ones do not conflict; duration is the
input and the end is computed; half a day extends the end by a full day and conflicts count whole
days; a closed matrix of status transitions; the warning counter stops at zero; bringing a closed
reservation back to open recomputes conflicts; changing settings does not recompute stored
reservations.

**Table names got the module prefix**, and constraints on two columns are declared on the entity
instead of added in the migration.

**Settings follow the platform's pattern: defaults in memory, a row on first save or on tenant
setup.** The scan has one system-level scheduler entry with a fixed identifier and keeps a
per-organization watermark of the last processed local date. No per-organization setup step.

**The built-in plugins read their registries through the query engine**, with the index delay
accepted for schedule assignments and stated; they write through the command bus. The package
registers both plugins itself.

**The reject-mode check is a phase inside the write command's own transaction**, not an
interceptor.

**The reason for our own timeline was replaced with the real one**: no rows per subject, no
dragging and resizing of existing bars, and counting days in the browser's zone. The library
choice is declared openly, with the alternative we checked.

**Our own overlap detection now, a shared core in `shared` as a separate change.** The `customers`
functions were checked one by one; the shared part is about twenty lines.

**The module is official, not core** — with a commitment to bring into our package the guard
tests that stop at the core repository. *Superseded in version 4: the module lives in core.*

**The core version requirement is a peer dependency plus a startup check.** Release order: core
first, then the module. *Superseded in version 4: the method ships with the module.*

**The module creates no subjects of type "rule set".** Every subject of ours is a person or a
resource. Schedules stay on the read side: the method in planner gets the subject's schedule from
the caller and adds its rules by itself (section 5).

**Added:** the occupancy service contract with a one-year cap on the range, undo of commands, the
conflict read, the timeline filter by category, the unique index on participants, what happens
to a conflict notification after the clash is fixed, and the missing test rows. Translations
cover five languages.

### What we do not know yet

- Whether the maintainers accept `vis-timeline` as a new production dependency. The review
  recommends yes; the decision is theirs.
- Planner's zone semantics are in flight (issue #5862, pull request #5868). Whether #5868 merges
  before phase 1, which semantics planner settles on — rules read in UTC, or in their declared
  zone — and whether the read method of section 5 should become the zone-aware expander the issue's
  second step asks for, so planner keeps one expander, not two (section 8).
- Whether the planner maintainers accept the read method in the shape of section 5, now with the
  working windows of section 18.
- Whether the eleven-hour limit of the day-of-window rule (section 8) ever matters. No known
  deployment is affected today; if one appears, the fix is on the planner write side.
- Whether the maintainers confirm `bookings` as the module identifier. Today the rename is
  text; after the first release it would follow the compatibility protocol.
- Where in the core repository the module lives: a module in `packages/core`, as proposed, or its
  own package `packages/bookings`, like `checkout`. Both keep it out of `official-modules`; the
  package costs an extension of two guard tests (section 14).
- Whether this document should be split, the way `wms` is: a roadmap for all four phases and a
  specification per phase, starting with phase 1. The rule of `om-spec-writing` asks to raise it,
  because phases 3 and 4 are capabilities of their own.
- Self-service booking (phase 4) reverses the chain: the customer asks, staff answers. Section 19
  gives defaults for every question below; they need the maintainers' and design's confirmation:
  whether a customer must log in to book (default: no, optional per page; an anonymous request is
  linked to a customer only by staff); what limits protect
  the page from abuse (default: rate limit, origin check, idempotency, fourteen days of slots per
  call, no CAPTCHA built in); how
  long a request waits for confirmation and what happens when nobody confirms it (default:
  twenty-four hours, then it expires and frees the slot); what the customer sees while waiting
  (default: a "request received" page and an e-mail on the decision).
- Mockups of every screen of phases 1–4, to be accepted by design before implementation.
- How the visit example of the calendar's configurable event types should evolve once `bookings`
  exists: consult the module's occupancy service, give way to it, or stay as a separate example
  (section 1). The proposal is one store of occupancy.
- Whether the `staff` directory service this module needs is added in this change or by the
  `staff` maintainers first, from their proposed directory spec (section 6).
- Whether `@date-fns/tz` is accepted next to `date-fns`, or the module should use core's
  `date-fns-tz` (section 8). The adapter makes either a change of one file.
- Whether a crew's unavailability should follow from its members' (section 6). Today a team has
  no availability of its own in planner, and its row shows "unavailability unknown".

## 22. Implementation plan

Each step is testable on its own and leaves the application working: the module can be enabled
after any step, and what is not built yet is simply not there.

### Phase 1: occupancy core

1. **Read method in `planner`.** The optional method on the availability service: unavailability
   windows for a list of subjects in a range, the subject's own rules before its schedule, one-off
   rules expanded as stored, each window with its rule's zone. Unit and integration tests from
   section 13. Nothing calls it yet.
2. **Module skeleton.** `packages/core/src/modules/bookings`: entities of section 7 with their
   constraints, the migration and the schema snapshot, `acl.ts`, `setup.ts` with
   `defaultRoleFeatures`, `encryption.ts`, `events.ts`, the `om-ds/*` lint override, the row in
   `.ai/specs/README.md`, the entities added to the editable-entities guard map. The module enables
   and shows nothing.
3. **Pure engine.** Intervals, overlap and unavailability conflicts, the status matrix, working-day
   arithmetic, the coverage-gap count, the day-of-window rule. Pure functions with unit tests, no
   database.
4. **Settings.** Validators, the save command, `GET/PUT /settings`, the settings screen; defaults
   in memory until the first save; the zone change rule of 7.5.
5. **Targets, categories, subjects.** Factory routes and `PUT /subjects`; the provider registry;
   the two directory methods in `staff`, with their tests; the local contract type and the
   import-boundary test; the `resources`, `staff` and `staff_teams` plugins, the last two resolved
   softly; adding a new or an existing record; name refresh from the registries' events; the
   customer link on targets; `search.ts` for targets and subjects (7.7).
6. **Reservation commands.** Create, update, save, place, unplace, move, resize, change status,
   apply changes; the idempotency table; the target and subject locks, the conflict policy and the
   "before" events inside the shared write path; the reported-conflicts table; undo.
7. **Reads.** The timeline read with row paging and the unplaced list's first page, the conflict
   read, the unplaced list, the occupancy service in the container; response enrichers applied by
   hand on the hand-written reads.
8. **Scan and notifications.** The paged organization-restricted recipient resolution in
   `notifications`, with its tests; the planner rule subscriber; the system scheduler entry, the worker on `bookings-scan`, the
   watermark of 7.5, coverage-gap and conflict notifications with their removal, browser events.
9. **Timeline screen.** The lazy `vis-timeline` component behind its one file, the board page,
   the reservation form and card, the unplaced list, the import-boundary test.
10. **Unavailability form.** The form that writes to the planner endpoint and calls the conflict
    read after success.
11. **Customer tab.** The declaration of `detail:customers.person:tabs` in `customers` and the
    reservations tab injected into it.
12. **Extension points.** `extension-points.ts` with every host of phase 1; mutation guards and
    interceptors wired on every hand-written route; the "before" lifecycle events; the occupancy
    source registry. Each spot and replaceable component gets its own hand-written test on the real
    screen — the platform has no generic one — so this step is budgeted per host, not as one task.
13. **Translations and integration tests.** Every locale of the sync check; every row of section 13
    for phase 1.

### Phase 2: hours and calendar views

1. Minutes as a duration unit in commands and forms; the comparison of mixed units (18).
2. Working windows in the planner read method; `outside_working_hours` (18).
3. Buffers on categories (18).
4. The `confirm` mode, `bookings.override_conflict`, the confirmation dialog (9).
5. Zone-aware day bucketing in the `ui` calendar view, then the calendar screen (11).
6. Hourly scale on the timeline; second participant on the form.

### Phase 3: services and pools

1. Service tables and the booking section injected into the product form (16).
2. Price copy on the reservation (16).
3. The fifth provider question, pool members, cursors and picking under locks (17).
4. The free slots read (17).
5. The unit `days` and the definition of a day (18).

### Phase 4: self-service booking

1. Pages and their screens (19).
2. The public routes and the public request command, on the `checkout` pattern (19).
3. Requests, consents, the confirmation state, expiry jobs (19).
4. Confirmation screen with customer matching (19).
5. Payment through `checkout` (19).

## 23. Migration and backward compatibility

The module is new, so it breaks nothing that exists. What it adds becomes a contract on its first
release, under the rules of `BACKWARD_COMPATIBILITY.md`:

| Surface | What the module adds | Class after release |
|---|---|---|
| event ids | every id in the list of section 12 — `bookings.booking.*` including `changed`, `creating` and `updating`, `bookings.conflict.detected`, `bookings.coverage_gap.detected`, the target, subject, category and settings events — and those of later phases | frozen |
| command ids | the ids named in section 12 | stable — interceptors and the audit log key on them |
| ACL features | `bookings.view`, `bookings.manage_bookings`, `bookings.manage_settings`, and those of later phases | frozen |
| notification types | `bookings.conflict`, `bookings.coverage_gap`, `bookings.request`, `bookings.request_expiring` | frozen |
| widget spot ids and extension hosts | every host in the module's `extension-points.ts` (section 20) | frozen |
| DI keys | `bookingsOccupancyService`, the provider registry | stable |
| queue and scheduler | the `bookings-scan` queue, the `bookings-requests` queue (phase 4) and the fixed UUID of the scheduler entry | stable |
| API routes | the routes of section 12 | stable; fields only added |
| database | `bookings_*` tables | additive only |

Five changes touch modules that already exist. Each is additive:

- **`notifications`**: notifying the holders of a feature restricted to one organization pages
  through the candidates instead of returning nobody above 200. Callers that do not ask for the
  organization restriction see no change.

- **`staff`**: two new read-only methods on a directory service in its container — list team
  members or teams of an organization with a search, and look them up by their own ids, returning
  name, card link, schedule id, role ids and whether they are active. The proposed directory spec
  of `staff` defines one method, keyed by user ids, for another consumer; these two sit next to it
  on the same service. No entity, route or permission of
  `staff` changes, and nothing in `staff` learns about reservations.

- **`planner`**: a new optional method on the availability service it already registers. No
  existing method changes; the service has no production callers today.
- **`customers`**: the declaration of the spot `detail:customers.person:tabs`, which the person page
  already renders and other modules already use. Declaring it changes nothing at run time; it only
  puts the spot into the catalog and freezes its id.
- **`ui`** (phase 2): the calendar view puts entries into days by the zone it is given. Without a
  zone it keeps today's behaviour, so no existing caller changes.

There is no deprecation: nothing is renamed or removed. The rename of the module from `reservations`
to `bookings` happened before any release, in text only.

## 24. Frontend architecture contract

### Server and client boundary

| Route or surface | Server root | Client islands | Data owner |
|---|---|---|---|
| `/backend/bookings` (timeline) | `page.tsx` | timeline board, reservation dialog, details card, unplaced list | `GET /timeline`, commands |
| `/backend/bookings/targets`, `/subjects` | `page.tsx` | `DataTable` and `CrudForm` | factory routes |
| `/backend/config/bookings` | `page.tsx` | settings form | `GET/PUT /settings` |
| calendar view (phase 2) | `page.tsx` | the `ui` calendar view | calendar read |
| product form section (phase 3) | `catalog` page | injected booking section | services routes |
| `/book/{slug}` (phase 4) | `page.tsx`, public | the booking steps | public routes |

No page root is a client file.

### Client files

| File | Why client | Heavy dependency |
|---|---|---|
| the timeline component | drag, resize and zoom of bars | `vis-timeline`, loaded lazily, only here |
| the reservation dialog | live conflict preview while typing | none |
| the booking steps (phase 4) | slot picking without reloads | none |

### Guardrails and budgets

- `vis-timeline` is imported only by the one timeline file and only through a dynamic import; the
  module's import-boundary test fails otherwise.
- No new provider at the application root; the timeline state lives in the page.
- The timeline read is one request per view (section 12), so the page does not fan out requests;
  refetches after events are debounced (section 11).

| Budget | Value |
|---|---|
| new page-root client files | 0 |
| `vis-timeline` and its styles in any chunk but the timeline route | 0 |
| requests on opening the timeline | 1 — the timeline read carries the calendar state and the first page of the unplaced list |
| timeline route chunk added by the library, including `moment` and the rest of the `vis-timeline` tree | at most 150 KB gzipped, measured in the bundle check; if the measured tree exceeds it, the budget and the library are raised with the maintainers together |

### Evidence before merge

- a Playwright load of the timeline page and of each new screen,
- the key interactions: drag a bar, resize a bar, create from the dialog, confirm a warning
  (phase 2), book from a public page (phase 4),
- the platform's client-boundary check,
- a bundle check that `vis-timeline` is absent from every chunk but the timeline route.

## 25. Risks and impact review

Risks of phase 1 come first; later phases are marked.

#### Personal data in browser events
- **Scenario**: a reservation write is broadcast to the browser; the stream filters by organization,
  not by feature, so every signed-in user of the organization receives it.
- **Severity**: High
- **Affected area**: patients' and guests' names, all users of an organization
- **Mitigation**: the platform sends the browser the payload the event was emitted with, so no reservation event
  is marked for the browser; one dedicated event, `bookings.booking.changed`, carries identifiers,
  window, status and kind only, and screens refetch through routes that check `bookings.view`
  (section 12). Marking any other event for the browser is a review stop.
- **Residual risk**: a user without the feature learns that a reservation changed and when, not for
  whom.

#### An organization without a time zone
- **Scenario**: the module is enabled and nobody saves the settings.
- **Severity**: Medium
- **Affected area**: the writes listed in 7.5 and the timeline of that organization
- **Mitigation**: those writes and the timeline answer 409 `settings_required` and the screens send the
  administrator to the settings; lists still work; the scan skips the organization; the enabling
  instructions make "set the zone" the first step (sections 7.5, 14).
- **Residual risk**: the module is unusable until the zone is set — on purpose, instead of guessing.

#### Two scan runs on one organization
- **Scenario**: two workers, or a run longer than the hourly tick, process the same organization.
- **Severity**: Medium
- **Affected area**: duplicate notifications, two watermark writes
- **Mitigation**: a per-organization try-lock, the watermark re-read inside it, worker concurrency
  of one (section 9).
- **Residual risk**: none known.

#### Two occupancy engines
- **Scenario**: the calendar's visit example and `bookings` both book the same doctor; neither sees
  the other's bookings.
- **Severity**: High
- **Affected area**: double bookings across the calendar and reservations
- **Mitigation**: the calendar becomes an occupancy source of `bookings`, and the calendar's guard
  is proposed to consult the occupancy service (section 1).
- **Residual risk**: until both sides are wired, a visit warns in `bookings` but a reservation does
  not stop a visit.

#### `staff` moves and the build breaks
- **Scenario**: the module imports a type or an entity from `staff`; when `staff` leaves core, the
  build fails.
- **Severity**: High
- **Affected area**: every application with reservations
- **Mitigation**: a local contract type, a registration check before resolving, and an
  import-boundary test that forbids any import from `staff` (section 6).
- **Residual risk**: none, while the test stands.

#### `staff` is absent or has moved out of core
- **Scenario**: an application enables reservations without `staff`, or `staff` leaves
  `packages/core` as planned.
- **Severity**: Medium
- **Affected area**: people and crews, the unavailability form
- **Mitigation**: no hard dependency; the people plugins use a `staff` read service and are not
  registered without it; the module builds and runs for things (sections 5, 6).
- **Residual risk**: without `staff`, planner refuses rule writes, so inspections cannot be entered
  from our screen — planner's limitation, until it has an access path without HR.

#### Two writes take the same slot
- **Scenario**: two users, or two customers on a public page, write the same subject into the
  same window at the same moment; both checks see the slot free before either commits.
- **Severity**: High
- **Affected area**: reservation writes, pools, public pages
- **Mitigation**: in every mode, and for every pool pick, the check and the write run in one
  transaction after advisory locks on the target and the subjects, taken in a fixed order; the lock code
  asserts it runs inside a transaction (sections 9, 17).
- **Residual risk**: under `advisory` two overlapping writes both pass — by design, the conflict is
  shown and reported.

#### A double submit creates two reservations
- **Scenario**: a user clicks save twice, or a public request is retried by the browser.
- **Severity**: Medium
- **Affected area**: create command, public request route
- **Mitigation**: the idempotency key on create, scoped to the user or the page, with a hash of the
  payload; the same key and payload return the first reservation, the same key with another payload
  is refused, keys expire after twenty-four hours (section 4).
- **Residual risk**: a user who opens the form twice and fills it twice gets two reservations; that
  is two decisions, not a double submit.

#### Adding a subject leaves a record in the provider's registry
- **Scenario**: the record is created in `staff` or `resources`, then our row fails.
- **Severity**: Low
- **Affected area**: adding subjects
- **Mitigation**: fixed order, the error carries the created record's identifier, the screen offers
  "add existing" instead of a repeated write; provider and identifier are unique (section 6).
- **Residual risk**: an orphan record in the registry until someone attaches it.

#### Unavailability written outside our screen is seen late
- **Scenario**: an inspection entered in the planner editor, or from our own form, creates a
  conflict; planner's rule commands emit no event, so nothing tells the module at once. A leave
  approved in HR does emit one.
- **Severity**: Medium
- **Affected area**: conflict notifications
- **Mitigation**: the timeline computes conflicts on every read; the scan finds it on the next local
  day at the latest; the HR leave event shortens it to seconds (section 9).
- **Residual risk**: a notification up to a day late for windows written outside HR; the screen is
  never late.

#### The day of an all-day window is wrong far from UTC
- **Scenario**: a whole-day window anchored to a midnight of no known zone, for a subject more than
  eleven hours from UTC, lands on the neighbouring day.
- **Severity**: Low
- **Affected area**: conflicts with unavailability on the day scale
- **Mitigation**: the anchor is recognised first — the rule's declared zone, then the subject's,
  UTC and the organization's — so HR leaves and rules written after #5868 are always right; only the
  last fallback reads the middle of the window (section 8).
- **Residual risk**: legacy rows from a server in a third zone, for subjects far from UTC; gone once
  planner expands rules in their declared zone (#5862).

#### Noisy organization in the hourly scan
- **Scenario**: one organization has far more reservations than others and slows the scan for all.
- **Severity**: Medium
- **Affected area**: `bookings-scan` queue, notifications of every organization
- **Mitigation**: the worker processes organizations one by one with a watermark per organization
  and target zone; the horizon is bounded (ninety days, the warning threshold); a late organization
  delays itself, not the day of the others, because each one's watermark is its own; request expiry
  has its own queue (section 19).
- **Residual risk**: on a single worker a large organization delays the ones after it within the
  same tick.

#### A public page is abused
- **Scenario** (phase 4): a script floods a page with requests and blocks every slot with
  unconfirmed requests.
- **Severity**: High
- **Affected area**: public pages, the organization's calendar
- **Mitigation**: rate limit per address and per page, origin check, requests expire after the
  page's time, staff see each request and can decline in bulk; a CAPTCHA can be added through an
  extension point (section 19).
- **Residual risk**: a slow, distributed flood within the rate limit holds slots until expiry;
  stated, and the reason the CAPTCHA point exists.

#### The public request command is reached without a user
- **Scenario** (phase 4): the only command that accepts a context without a user is called with a
  forged organization, or used to write more than a request.
- **Severity**: High
- **Affected area**: reservations of any organization with pages
- **Mitigation**: the route takes the tenant and the organization from the page found by slug,
  never from the body, as `checkout` does for its payment links; the command checks that the page
  is active and the service is on it, writes only a reservation and its request, and touches no
  other module (section 19).
- **Residual risk**: anyone with a page link can hold slots until expiry — the abuse risk above.

#### A typed e-mail puts a booking into someone else's history
- **Scenario** (phase 4): a visitor types another person's e-mail into the public form.
- **Severity**: High
- **Affected area**: `customers`, reservation history, personal data
- **Mitigation**: an anonymous request is linked to no person; staff link it at confirmation,
  choosing among the matches, or the customer logs in through `customer_accounts` (section 19).
- **Residual risk**: staff can still link the wrong person by mistake; `customers` has no merge
  tool, so a duplicate person created at confirmation stays until such a tool exists.

#### Free slots on a public page are expensive to compute
- **Scenario** (phase 4): anonymous visitors ask for free slots of a service with several pooled
  requirements over a long range.
- **Severity**: Medium
- **Affected area**: database load of the organization
- **Mitigation**: at most fourteen days per call; one bulk read of occupancy and windows for the
  pool members, the grid computed in memory; the page's rate limit applies (section 19).
- **Residual risk**: a large pool with a fine grid is still the heaviest read of the module; the
  grid step and the pool size are the levers.

#### A new production dependency for the timeline
- **Scenario**: `vis-timeline` is abandoned or conflicts with a later React version; its `moment`
  dependency is in maintenance mode and adds a second date library to the bundle.
- **Severity**: Low
- **Affected area**: the timeline screen, the timeline route chunk
- **Mitigation**: loaded lazily, closed in one file, replaceable without touching the view; the
  whole tree, `moment` included, counts toward the route's chunk budget (sections 11, 24).
- **Residual risk**: one file to rewrite.

#### Migration and deployment
- **Scenario**: enabling the module, or a later phase, on a running installation.
- **Severity**: Low
- **Affected area**: database, default roles
- **Mitigation**: every migration creates tables or adds nullable columns and touches nothing that
  exists; permissions come from setup and the role sync command; settings have defaults in memory
  (section 14).
- **Residual risk**: none known; disabling keeps tables and data.

#### Tenant isolation
- **Scenario**: a read or a notification leaks another organization's reservations.
- **Severity**: Critical
- **Affected area**: every read, the occupancy service, notifications, public pages
- **Mitigation**: every row carries tenant and organization and every query filters by both;
  notifications go only to holders of the permission in the organization; a public page resolves its
  organization from the page, never from the request (sections 7, 12, 19); a test row for each read
  (section 13).
- **Residual risk**: none accepted.

## 26. Final compliance report — 2026-10-07

This is a proposal, not an implementation. The report checks the design against the rules of the
core repository; each row is verified again against the code of each phase.

### Files reviewed
- `AGENTS.md` (root)
- `BACKWARD_COMPATIBILITY.md`
- `.ai/specs/AGENTS.md`
- `.ai/review-checklist.md`
- `.ai/docs/module-development.md`
- `packages/core/src/modules/staff/AGENTS.md` — the dependency rule of section 5
- the Task Router guides for notifications, widgets, encryption and the queue
- `packages/core/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/events/AGENTS.md`

### Compliance matrix

| Rule source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | identifiers only; `resources` read through the query engine, `staff` through its directory service under a local contract type (sections 6, 15) |
| `.ai/ds-rules.md` | Design system tokens and primitives | N/A until the mockups | the `om-mockup-prototype` mockups must pass it before implementation (section 21) |
| root AGENTS.md | Filter by organization and tenant | Compliant | every table and query (section 7) |
| packages/core/AGENTS.md | Every mutation is a command; side effects after commit | Compliant | sections 9, 15 |
| packages/core/AGENTS.md | API routes export `openApi` | Compliant | factory and hand-written routes (section 12) |
| packages/core/AGENTS.md | CRUD routes use `makeCrudRoute` with an indexer | Compliant | targets and categories, the subject list, services and pages; adding a subject and the reservation actions are hand-written routes over commands (section 12) |
| packages/core/AGENTS.md | Schema snapshot in the same change as the migration | Compliant | constraints declared on entities so they reach the snapshot (section 7.1) |
| packages/core/AGENTS.md | Sensitive fields declared in encryption maps | Compliant | the target name (7.4) and the contact fields of a page request (19); the subject name follows its source, which `staff` does not encrypt (6) |
| root AGENTS.md | Optimistic locking on every new user-editable entity | Compliant | `updated_at` on every user-editable table — not on the bookkeeping tables (idempotency keys, reported conflicts, scan state, pool cursors) or the replaced-whole holidays and policy exceptions, which nobody edits row by row (7) — `updatedAt` in list and detail answers and in every write input (section 12) |
| staff AGENTS.md | Core modules must not depend directly on `staff` | Compliant | soft dependency through a `staff` read service, no `requires`, no entity access (sections 5, 6) |
| events AGENTS.md / browser stream | Browser events reach every user of the organization | Compliant | only `bookings.booking.changed` is marked for the browser, and it carries no names; screens refetch through checked routes (section 12) |
| notifications | Recipients scoped to the organization, not the tenant | Compliant | organization restriction always on; the 200-candidate cap lifted by an additive change to `notifications` (sections 12, 23) |
| repo checklist § indexes | Every query pattern names its index | Compliant | 7.6 |
| repo checklist § search | Every searchable entity has a search configuration | Compliant | 7.7 |
| packages/core/AGENTS.md → ACL Grant Sync | Features in `acl.ts` also in `setup.ts` defaults, sync command for existing tenants | Compliant | section 14 |
| .ai/docs/module-development.md | A new module adds an `error`-severity `om-ds/*` override in `eslint.ds.config.mjs` | Compliant | section 14 |
| BACKWARD_COMPATIBILITY.md | New contract surfaces listed; changes to existing modules additive | Compliant | section 23 |
| root AGENTS.md → Ask First | Adding a production dependency needs approval | Pending approval | the `vis-timeline` tree with `moment` (section 11) and `@date-fns/tz` (section 8); `date-fns` itself is already a core dependency |
| root AGENTS.md | Personal data and consents handled explicitly | Compliant | consents with their proof on the page request (section 19) |
| platform convention (`catalog`, `customers`, … `extension-points.ts`) | Extension hosts declared with `defineModuleExtensionPoints` | Compliant | section 20 |
| packages/ui/AGENTS.md | Forms with `CrudForm`, lists with `DataTable` and stable table ids, guarded mutations elsewhere | Compliant | section 12 |
| packages/events/AGENTS.md | Cross-module side effects through events and subscribers | Compliant | notifications, payment completion (sections 12, 19) |
| core guard test for heavy libraries | Heavy libraries loaded lazily with an import-boundary test | Compliant | `vis-timeline` (section 11) |
| repository translation sync check | Translations in every locale the check requires | Compliant | section 14 |

### Internal consistency check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Partial | phase 1: routes, inputs, the conflict object and error codes in section 12 match section 7; field-level zod schemas come with the code. Phases 2–4: routes named, shapes pending |
| API contracts match the screens | Pending | mockups come after the spec (section 21) |
| Risks cover all write operations | Pass | section 25 |
| Commands defined for all mutations | Pass | every command id listed in section 12 — reservations, targets, subjects, categories, settings; phase 4 requests, services, pages |
| Cache strategy covers all read APIs | N/A | no cache; reads run on committed state by design (section 9) |

### Non-compliant and pending items

- **Rule**: adding a production dependency needs approval. **Source**: root AGENTS.md. **Gap**:
  the `vis-timeline` tree, `moment` included, and `@date-fns/tz` are new. **Recommendation**:
  maintainers decide; the timeline library is closed in one file (section 11), and the zone library
  behind one adapter (section 8).
- **Rule**: a spec covers one independently deployable capability; otherwise splitting is an open
  question. **Source**: `om-spec-writing`. **Gap**: phases 3–4 are separate capabilities.
  **Recommendation**: see section 21.
- **Rule**: API contracts at schema level. **Gap**: phases 2–4. **Recommendation**: each phase's own
  specification adds them before its code.

### Verdict

Ready for review as a design of phase 1 and a plan of phases 2–4. Each phase re-runs this report
against its code.

## Changelog

### 2026-10-07
- Version 4, answering the core maintainers' comment of 2 October: the module moves to the core
  repository and covers the whole booking domain in four phases, with user stories (sections 4,
  14). Soft dependencies on `staff` and `scheduler` (5, 6); three time zones (8); new tables (7);
  the `confirm` mode, locks on every occupancy write and recorded reported conflicts (9); phase 1
  API contracts, events and permissions (12). New sections: services (16), pools (17), time (18),
  public booking pages (19), extension points (20), implementation plan (22), migration and
  backward compatibility (23), frontend architecture contract (24), risks (25), compliance report
  (26). "What changed" is section 21. Section numbers in the entries below refer to version 3.

### 2026-09-16
- Version 3.2, answering the comment of 12 September: the module identifier is `bookings` —
  tables, events, permissions, notification types, queue and service renamed, the document
  keeps the word reservation (note under the TLDR, sections 7, 12). Participants are a list in
  the model, the engine and the API from the first version, the screen writes one (sections 4,
  7.2, 11, 12, 13). `no_show` is a third closed status (sections 4, 7.1, 9, 12). Timeline
  filters "only conflicts" and "hide unavailable" (sections 12, 13). Every returned conflict
  carries its kind and the other side (sections 12, 13). Conflict and coverage gap
  notifications are removed when what they reported is gone — the earlier "not retracted"
  rested on the belief that this needs a table of reported facts, and it does not (sections 9,
  12, 13).

### 2026-09-07
- Version 3.1, answering the review of 4 September: the built-in plugins read their registries
  through the query engine (section 6, 15); the day of an all-day planner window is read from its
  middle in the company's zone, windows with hours block every day they touch (section 8);
  one-off rules are expanded as start plus duration, without the UTC-day snap (section 5);
  settings have defaults in memory and a row on first save or tenant setup (section 7.5, 14); the
  reject-mode check is a phase inside the write command's transaction (section 9); the scan keeps
  a per-organization watermark and is registered with a fixed identifier (section 9); the guard
  tests are named with rewrites marked and the two inaccurate repository claims are removed
  (section 14); unique index on participants, one-year cap on the occupancy service, conflict
  notifications are not retracted, nine events, test rows for the occupancy service and undo.
- Same day, second pass: the scan reports only conflicts new since the watermark and looks ninety
  days ahead, so a dismissed notification stays dismissed (section 9, 12); notification
  recipients named (section 12); the read method takes tenant, organization and range (section
  5); a disabled provider marks its rows as "unavailability unknown" (section 6); the error after
  a failed second write carries the created record's identifier (section 6); status changes
  other than cancel ride `.updated` (section 12); the locale list corrected to this
  repository's check (section 14); `requires` described as a generator check, not as enabling
  (section 5, 14); open questions listed (section 16).

### 2026-09-04
- Version 3, a full rewrite answering the review of 26 August: people as subjects, own subject
  list with provider plugins, participants table, conflict policy as data with per-category
  exceptions, detection in the write response plus a daily reconciliation scan, permanent
  targets, the read method added to planner, module-prefixed table names, official module. The
  delta is described in section 16.

### 2026-08-10
- Initial specification, submitted as PR #33.
