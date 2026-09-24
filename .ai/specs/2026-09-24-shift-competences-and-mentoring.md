# Competences: Skill-Based Shift Coverage and Mentoring

| Field | Value |
|-------|-------|
| **Status** | Proposed |
| **Created** | 2026-09-24 |
| **Brief** | [2026-09-24-shift-competences-and-mentoring](briefs/2026-09-24-shift-competences-and-mentoring.md) |
| **Related** | `packages/core/src/modules/staff/AGENTS.md`, [Staff Member Directory](2026-07-15-staff-member-directory.md), `BACKWARD_COMPATIBILITY.md` |

## TLDR

**Key points:**
- A new optional `competences` core module. It holds a skill catalog, levelled employee skills, configurable shift definitions, per-shift skill requirements, and a weekly assignment grid. The grid shows live coverage-gap validation.
- Phase 2 adds mentor–learner pairings with a status workflow (`assigned → in_progress → done | cancelled`). Moving a pairing to `done` needs an approval-gated skill grant.
- Staff team members and leave requests are referenced by FK id and read through a DI port. There are no ORM relations to `staff`, and `staff` does not change.

**Scope:** entities, CRUD APIs, commands, events, ACL, backend pages (catalog, member skills, planning grid, mentoring board), and integration tests.

**Boundaries:** no auto-rostering, payroll, shift swaps, self-service, skill expiry, or multi-line grids.

## Overview

Manufacturing sites staff every shift with people who hold specific competences, for example a certified forklift operator or a line-3 setter. Open Mercato's `staff` module already models team members, roles and leave. `planner` models availability rules. Neither can say *which skills* a person holds or whether a planned shift *meets its skill requirements*.

This spec adds the missing layer as a separate module, so installations without shift work are not affected.

> **Market reference:** Workday Scheduling, Deputy and Planday all use the same core model: skills (or "qualifications") on the employee, requirements on the shift template, and live under-coverage warnings in the roster grid. We adopt that model. We reject auto-rostering: it is the costliest part of those products and the brief excludes it.

## Problem Statement

1. Planners cannot see, for a given week, which shifts lack an employee holding a required skill at the required level.
2. Absences (approved leave) silently break a plan that looked complete.
3. Nobody tracks who can teach a skill to whom, or where a training pairing stands. As a result, skill gaps persist.

## Proposed Solution

### Phase 1 — Skills and shift coverage

- **Skill catalog.** An organization-scoped list of skills: name, optional category, description, active flag.
- **Member skills.** A `(teamMemberId, skillId)` pair with a `level` from 1 to 4 (1 learner, 2 practitioner, 3 proficient, 4 expert; labels via i18n), plus `acquiredAt` and `notes`.
- **Shift definitions.** Name, `startTime`, `endTime` (a night shift may cross midnight), sort order and active flag. `setup.ts` seeds three defaults: Morning 06:00–14:00, Afternoon 14:00–22:00, Night 22:00–06:00. The number of shifts is configurable.
- **Shift requirements.** Per shift definition: skill, `minLevel`, `minHeadcount`, and an optional `weekday` (null = every day).
- **Shift assignments.** A `(date, shiftDefinitionId, teamMemberId)` triple. It is unique per member, date and shift. The same member may not be assigned to two shifts whose time ranges overlap on the same date.
- **Planning grid.** The rows are shift definitions and the columns are the 7 days of the selected ISO week. Each cell lists the assigned members and a coverage badge: covered, gap, or warning. The gap detail names each unmet requirement, for example "Forklift ≥3: 1 of 2". Members on approved leave are shown struck-through with a warning and don't count. The grid supports adding and removing members per cell and copying the previous week.
- **Coverage evaluation.** A pure function `evaluateCoverage(requirements, assignments, memberSkills, leaves) → CellCoverage[]`. It runs live on every read and is never persisted, so any change to a skill, requirement or leave record is reflected immediately.

### Phase 2 — Mentoring

- **Pairing.** Holds `skillId`, `mentorMemberId`, `learnerMemberId`, `targetLevel` (default 2), `status`, `startedAt`, `completedAt`, `approvedByUserId`, `notes` and `dueDate`.
- **Status flow.** `assigned → in_progress → done`. `cancelled` is reachable from any state except `done`. The flow is enforced in commands. Moving to `done` requires the `competences.mentoring.approve` feature. In the same transaction it upserts the learner's member skill to `max(current, targetLevel)` and records the approver.
- **Eligibility rules.**
  - The mentor must hold the skill at level ≥ 3.
  - The learner's current level must be below `targetLevel`.
  - The mentor and learner must be different people.
  - A learner may have only one open pairing per skill.
- **Suggestions ("who can teach whom").** For a chosen skill, the page lists eligible mentors and learners below the target level. It also shows the skill gaps that appear most often in the grid over the next 4 weeks, so the planner can see which skills are worth training.
- **Board.** A DataTable grouped by status, with row actions for each allowed transition.

## Architecture

- **Module:** `packages/core/src/modules/competences/` (id `competences`, plural snake_case). It is an optional module and depends on `staff` being enabled. When `staff` is absent, the module's pages show an explanatory empty state. That dependency is resolved with a soft-optional `tryResolve`.
- **Staff access:** a DI port `competencesStaffReader` with `listMembers(scope, ids?)` and `listApprovedLeaves(scope, from, to)`. It is implemented with `findWithDecryption` over `staff` entities inside the module's lib. This follows the module-decoupling pattern checked by `module-decoupling.test.ts`. If the proposed `staffMemberDirectory` service lands first, the port delegates to it.
- **Writes** go through commands (`competences.skill.create`, `competences.assignment.create`, `competences.mentoring.transition`, and so on), with optimistic locking via `updated_at` on every editable entity.
- **Events:** `competences.skill.created|updated|deleted`, `competences.member_skill.updated`, `competences.assignment.created|deleted`, `competences.mentoring.status_changed` (`clientBroadcast: true` for the grid and the board).
- **Notifications (Phase 2):** a mentor or learner is notified when a pairing is assigned to them, and when it is completed.
- **Search:** skills are indexed for fulltext search. Pairings are not indexed.

## Data Models

All tables have `id` (uuid), `tenant_id`, `organization_id`, `created_at`, `updated_at` and `deleted_at`. Every query filters by tenant and organization.

| Table | Columns | Constraints |
|-------|---------|-------------|
| `competences_skills` | `name` text, `category` text null, `description` text null, `is_active` bool | unique (org, lower(name)) where not deleted |
| `competences_member_skills` | `team_member_id` uuid, `skill_id` uuid, `level` smallint 1–4, `acquired_at` date null, `notes` text null | unique (org, team_member_id, skill_id) |
| `competences_shift_definitions` | `name` text, `start_time` time, `end_time` time, `sort_order` int, `is_active` bool | — |
| `competences_shift_requirements` | `shift_definition_id` uuid, `skill_id` uuid, `min_level` smallint, `min_headcount` int ≥1, `weekday` smallint null (1–7) | unique (shift, skill, weekday) |
| `competences_shift_assignments` | `date` date, `shift_definition_id` uuid, `team_member_id` uuid, `notes` text null | unique (org, date, shift, member); index (org, date) |
| `competences_mentoring_pairings` (P2) | `skill_id`, `mentor_member_id`, `learner_member_id` uuid, `target_level` smallint, `status` text enum, `due_date` date null, `started_at`, `completed_at` timestamptz null, `approved_by_user_id` uuid null, `notes` text null | partial unique (org, learner, skill) where status in (assigned, in_progress) |

`team_member_id` and the mentor/learner ids are plain FK ids to `staff_team_members`, with no ORM relation. Future support for multiple lines would add a nullable `area_id` to requirements and assignments, which is an additive change.

## API Contracts

The CRUD routes use `makeCrudRoute` with OpenAPI, zod validators in `data/validators.ts`, `pageSize` ≤ 100, and `updatedAt` in every response.

| Method | Path | Feature |
|--------|------|---------|
| GET/POST/PUT/DELETE | `/api/competences/skills` | `competences.skills.view` / `.manage` |
| GET/POST/PUT/DELETE | `/api/competences/member-skills` (`?teamMemberId=`, `?skillId=`) | `competences.skills.view` / `competences.member_skills.manage` |
| GET/POST/PUT/DELETE | `/api/competences/shift-definitions` | `competences.planning.view` / `competences.shifts.manage` |
| GET/POST/PUT/DELETE | `/api/competences/shift-requirements` | `competences.planning.view` / `competences.shifts.manage` |
| GET/POST/DELETE | `/api/competences/assignments` (`?from=&to=`) | `competences.planning.view` / `competences.planning.manage` |
| GET | `/api/competences/coverage?from=&to=` (max 31 days) → `{ cells: [{ date, shiftDefinitionId, assignedMemberIds, onLeaveMemberIds, gaps: [{ skillId, minLevel, required, qualified }], status }] }` | `competences.planning.view` |
| POST | `/api/competences/assignments/copy-week` `{ fromWeekStart, toWeekStart }` | `competences.planning.manage` |
| GET/POST/PUT | `/api/competences/mentoring` (P2) | `competences.mentoring.view` / `.manage` |
| POST | `/api/competences/mentoring/:id/transition` `{ status }` | `.manage`; `done` also requires `competences.mentoring.approve` |
| GET | `/api/competences/mentoring/suggestions?skillId=` | `competences.mentoring.view` |

In `setup.ts`, the admin role receives `competences.*`.

## UI/UX

- **Backend menu group "Competences":** Skills, Planning, Mentoring (P2), and Settings → Shifts & requirements.
- **Skills:** a `CrudForm` and `DataTable`. The skill detail page lists its holders with their levels.
- **Staff member detail:** a widget injected into the staff team-member detail spot lists that member's skills and lets you edit them inline.
- **Planning:** a week picker, the grid, and badges that use `status-success/warning/error` DS tokens (no hard-coded colors). Adding a member opens a dialog with member search, and each member shows their matching skills. Dialogs support `Cmd/Ctrl+Enter` and `Escape`.
- **Mentoring:** the status board, a create dialog pre-filtered by the eligibility rules, and the suggestions panel.

## Integration Coverage

- **API:** CRUD for skills, member skills, shift definitions and requirements (including the 409 optimistic-lock conflict); assignment uniqueness and the overlap rejection; coverage (covered, a gap, a gap caused by leave, a weekday-specific requirement, a shift crossing midnight); copy-week; mentoring transitions (an invalid transition, `done` without approve → 403, `done` with approve → the learner's level is raised); suggestions filtering.
- **UI:** create a skill, assign it to a member, add a requirement, plan a cell, and see the gap badge clear; create a pairing and complete it.
- Every test creates its own fixtures through the API and cleans them up afterwards.

## Phasing

1. Phase 1 has these steps:
   1. Entities, migrations and validators.
   2. Skill and member-skill CRUD, plus the staff widget.
   3. Shift definitions and requirements.
   4. Assignments, `evaluateCoverage` and the coverage route.
   5. The planning grid UI.
   6. Tests.
2. Phase 2 has these steps:
   1. The pairing entity and transition command.
   2. Notifications.
   3. The board and suggestions.
   4. Tests.

## Risks & Impact Review

| Scenario | Severity | Area | Mitigation | Residual |
|----------|----------|------|------------|----------|
| A skill grant on `done` is misused for safety-relevant skills | High | Mentoring | A separate approve feature, an audit of the approver, and events | An approver can still grant carelessly |
| The coverage query is slow for large orgs or long ranges | Medium | Coverage API | A range cap of 31 days, indexed reads, batch loading of leaves and skills | Acceptable for teams of up to about 2k members |
| A staff member is deleted while still assigned | Medium | Grid | Deleted or inactive members are shown as "unavailable" and never counted | Stale rows until someone edits them |
| Night shifts cross midnight, making leave overlap ambiguous | Low | Coverage | Leave is matched against the shift's start date | Edge cases for leave that starts at midnight |
| `staff` is disabled | Low | Module | Soft-optional resolution and an empty state | None |
| One grid per org does not fit multi-line plants | Medium | Product | Documented extension via a nullable `area_id` | Needs a follow-up spec |

## Resolved assumptions (autonomous defaults)

The handoff brief resolved every question the spec raised. See the brief's Resolved-unknowns table: manual planning as the system of record, configurable shifts, a 1–4 level scale, a headcount-per-skill-at-minimum-level rule, leave checked per date, a single grid per organization, live validation, approval-gated grant, and a mentor threshold of ≥3. Two additional defaults were set in this spec: the coverage range is capped at 31 days, and leave for a night shift is matched against the shift's start date.

## Final Compliance Report

- There are no cross-module ORM relations, and every query is tenant- and organization-scoped.
- Reads use `findWithDecryption`, inputs are validated with zod, and every write goes through a command.
- Optimistic locking is on for every editable entity.
- All user-facing strings use i18n, status indicators use DS tokens, and `pageSize` is ≤ 100.
- Changes are additive only; no existing contract surface changes.

## Changelog

- 2026-09-24 — Initial proposal (autonomous, from the brainstorm brief).
