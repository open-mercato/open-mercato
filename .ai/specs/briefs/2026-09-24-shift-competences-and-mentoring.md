# Competence-based shift coverage planning and mentor–learner skill development

- Date: 2026-09-24
- Category: feature
- Priority signal: medium — new business capability requested by a factory operator; not blocking existing users
- Risk signal: medium — new module with new tables and UI; touches `staff` only through read-only DI/FK ids
- Routing: Next: om-auto-write-spec "Competence-based shift coverage planning and mentor–learner skill development (new competences module) — brief: .ai/specs/briefs/2026-09-24-shift-competences-and-mentoring.md"

## Problem

A factory runs three shifts a day, and each shift needs people with specific skills on duty. Today no one can see, for a planned week, whether every shift has the skilled employees it needs. The planner has to check that by hand. Separately, skills spread by pairing a skilled employee with one who needs the skill, and this is not tracked anywhere. So nobody can answer "who can teach whom" or say where a pairing stands.

## Agreed direction

Build a new, optional `competences` module. It references `staff` team members by FK id only, with no ORM relations, and reads staff and leave data through DI.

The spec is split into two phases, and each phase can ship on its own:

1. **Skills and shift coverage.** This phase adds:
   - a skill catalog;
   - employee skills with a level;
   - shift definitions;
   - per-shift skill requirements;
   - a weekly grid (days × shifts) for assigning team members;
   - live gap validation that flags every shift/day cell where a requirement is unmet.
2. **Mentoring.** This phase adds:
   - mentor–learner pairings for a skill;
   - a status flow: assigned → in_progress → done (plus cancelled);
   - a "who can teach whom" suggestion view that matches mentors who hold the skill at the teaching threshold with learners who lack it.

Rejected options:

- **Build nothing** (custom fields on team members plus a spreadsheet): this gives no coverage validation, and the validation is the core need.
- **Extending `staff`:** `staff` is already large and optional, and competences are a separate concern.
- **Extending `planner`:** `planner` models availability rules, not assignments or skill requirements. The `competences` module may *read* planner and leave data as an input to availability.

## Resolved unknowns

The user asked us to proceed autonomously, so these are stated assumptions. The spec should keep them visible and overridable.

| Question | Answer (from the conversation) |
|----------|--------------------------------|
| System of record for shift assignment? | Open Mercato. Shifts are planned manually in the grid; there is no import from payroll or time-and-attendance in scope. |
| Shift structure? | Shift definitions are configurable per organization (name, start, end, order). The default seed has 3 shifts: morning, afternoon, night. The number of shifts is not hard-coded. |
| Skill level model? | An ordered 1–4 scale (1 learner, 2 practitioner, 3 proficient, 4 expert). Levels are shown with i18n labels. |
| Coverage rule? | Per shift definition, optionally per weekday: skill + minimum level + minimum headcount. A cell counts as covered when enough assigned members hold the skill at or above the minimum level. |
| Leave and availability? | Evaluated per grid cell date. A member with approved `staff` leave overlapping that date does not count toward coverage, and is flagged as assigned while on leave. |
| Sites / lines? | A single grid per organization in v1. Open Mercato organizations can model separate sites. Per-line/department grids are an explicit v1 non-goal, and the spec must say how they could be added later. |
| Skill edited or removed after planning? | Validation is always computed live and never stored as a snapshot, so a skill change immediately re-flags the affected cells. |
| What happens on mentoring "done"? | Marking a pairing done needs a separate `competences.mentoring.approve` feature. It raises the learner's skill level to a target level set on the pairing (default 2) and records who approved it and when. It never auto-grants without that approval step. |
| Who can mentor? | A member holding the skill at level ≥ 3. |

## Non-goals

- Automatic schedule generation or optimization (no auto-rostering).
- Payroll, overtime, labor-law rules, shift swaps and employee self-service.
- Skill expiry and re-certification (a likely follow-up).
- Training content, courses and attachments beyond a notes field on the pairing.
- Multi-line/department grids within one organization (v1).

## Affected areas (if known)

- New module (location decided by the spec).
- Read-only use of `staff` team members and leave requests (see `.ai/specs/2026-07-15-staff-member-directory.md`).
- Optionally, `planner` availability as an input.
