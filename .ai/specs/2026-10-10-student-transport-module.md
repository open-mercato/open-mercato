# Student transport module — subscriptions, plans and the daily run (buildable)

## TLDR

Add a `student_transport` app-local module: priced subscription plans, per-student subscriptions that
bill either the family (B2C) or the school (B2B), and daily boarding attendance split by leg — the
morning pickup and the afternoon drop-off — with reported absences kept apart from unexcused ones.

## Overview

A *plan* is the product: a direction, a duration, and a price for the round trip and for a single leg.
A *subscription* binds one student to a plan, snapshots the price for the chosen direction, and names
the paying party. *Attendance* is one row per child, day and leg, with four states
(`boarded`, `alighted`, `absent_notified`, `absent_unnotified`) and an origin (`staff` on the run,
`parent` for an absence reported ahead of it).

## Problem Statement

Schools and operators sell term transport per child, but the platform has nothing that says who rides,
who pays, or whether a child actually boarded. The office runs this on paper: a list per vehicle, a
phone call from a parent, and a term invoice the school reconciles by hand.

## Proposed Solution

### Entities

- `SubscriptionPlan` (`subscription_plans`) — name, code (partial unique per org+tenant where set),
  `account_type` (`b2c|b2b`), `duration` (`monthly|quarterly|annual|custom_b2b_contract`),
  `price_two_way`, `price_one_way`, currency, VAT rate, active flag, notes.
- `StudentSubscription` (`student_subscriptions`) — `subscription_number` (partial unique per
  org+tenant), `status` (`draft|active|suspended|ended`), student and guardian details, `direction`
  (`two_way|one_way_pickup|one_way_drop`), plan id + snapshot, paying party id + snapshot, school id +
  snapshot, pickup/drop-off points, route/vehicle/driver ids + snapshots, window, `period_price`,
  currency, VAT rate, notes.
- `StudentTripAttendance` (`student_trip_attendance`) — subscription, `trip_date`, `leg`, `status`,
  `origin`, recorder, vehicle/driver, notes. Unique per (subscription, date, leg) among live rows.
- `StudentSubscriptionSequence` (`student_subscription_sequences`) — the per-scope number counter.

### Commands

`student_transport.plans.*`, `student_transport.subscriptions.{create,update,delete,activate,suspend,end}`
and `student_transport.attendance.record`.

- `create` snapshots the plan's price for the chosen direction (an explicit price wins) and allocates
  the subscription number.
- `activate` / `suspend` / `end` move the lifecycle; `end` stamps the window and takes no further
  attendance.
- `delete` is refused once attendance exists (the record is history — end it instead).
- `attendance.record` upserts the (subscription, date, leg) slot under a row lock, so the board and a
  parent's absence report write the same row rather than racing.

### API

`/api/student_transport/plans` (CRUD), `/api/student_transport/subscriptions` (CRUD + `activate`,
`suspend`, `end`), `/api/student_transport/attendance` (GET the run board or a subscription's history,
POST a mark), `/api/student_transport/children` (the family view), `/api/student_transport/reference/transport`,
`/api/student_transport/dashboard-summary`.

### UI

`/backend/education` (KPIs), `/backend/education/plans` (list/create/edit),
`/backend/education/subscriptions` (list/create/detail/edit with the boarding log),
`/backend/education/attendance` (the day's run board with one-tap marks per leg), and
`/backend/parent/children` (the family's view of today, with absence reporting).
Features: `student_transport.read`, `plans.manage`, `subscriptions.manage`, `attendance.record`,
`parents.view`, `admin`.

### Integration coverage (ships with this module)

`TC-STUDENT-001-subscription-and-attendance` — the direction decides the snapshotted price; a draft
subscription is not on the run; a one-way rider appears on exactly one leg; the board upserts one row
per slot; a family-reported absence carries `origin: parent`; an ended subscription refuses further
attendance. Unit tests pin the price resolution and the period counting.

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| Double-marked attendance | Medium | Partial unique index + upsert inside a transaction with a pessimistic row lock | — |
| Price drift after a plan edit | Medium | The price is snapshotted onto the subscription at create/update; a plan edit never re-prices existing contracts | An operator who wants the new price must edit the subscription (documented in the form) |
| B2B/B2C confusion on the invoice | High | The payer is chosen by account type in the form and validated server-side; the school is a separate snapshot | A subscription re-typed B2B later re-points the payer by design |

## Final Compliance Report

- Tenant/org scoping on every table and read; no cross-tenant exposure.
- Optimistic locking on the subscription; the attendance slot is protected by lock + unique index.
- All user-facing strings via i18n (6 locales; Arabic authored first-class).
- Integration test ships with the module; unit tests pin the pricing rules.

## Changelog

- 2026-10-10: Initial spec (module implemented in the same change).
