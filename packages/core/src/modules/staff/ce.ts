import type { CustomEntitySpec } from '@open-mercato/shared/modules/entities'
import { E } from '#generated/entities.ids.generated'
import { STAFF_TEAM_MEMBER_CUSTOM_FIELDS } from './lib/customFields'

/**
 * EP-43 — the time-tracking entities are declared here alongside the employee.
 *
 * All six are **system** entities (they appear in `entities.ids.generated.ts` and are
 * backed by real tables), which decides exactly what a declaration does and does not do:
 *
 *  - `yarn mercato entities install` seeds only the `fields` of a system entry and never
 *    writes a `custom_entities` row (`entities/lib/install-from-ce.ts` → `registerEntity`
 *    is false for a system id), so `label`, `description` and `showInSidebar` are
 *    metadata for code, not for the installer.
 *  - The Data designer already lists every generated entity id, so this declaration is
 *    NOT what makes custom fields definable on them.
 *  - `labelField` is read at runtime by `attachments/lib/assignmentDetails.ts` to label
 *    an attached record, which is the one behaviour these entries change today.
 *
 * `showInSidebar` is false for all of them: each has its own screen under
 * `/backend/staff/time-tracking/*` and must not also appear as a generic records list.
 *
 * What is still missing before a custom field on these entities is end-to-end usable is
 * written up in `AGENTS.md` → "Time-tracking custom fields (EP-43)". In short: the
 * time-tracking CRUD routes are command-backed, and the CRUD factory persists
 * `customFields` only on its ORM write path, so a `cf_*` value posted to them is dropped.
 */
const systemEntities: CustomEntitySpec[] = [
  {
    id: E.staff.staff_team_member,
    label: 'Employee',
    description: 'Employees who can be scheduled on worktime plans.',
    labelField: 'displayName',
    showInSidebar: false,
    fields: STAFF_TEAM_MEMBER_CUSTOM_FIELDS,
  },
  {
    id: E.staff.staff_time_entry,
    label: 'Time Entry',
    description: 'A logged block of time against a project, task and day.',
    labelField: 'notes',
    showInSidebar: false,
    fields: [],
  },
  {
    id: E.staff.staff_time_project,
    label: 'Time Project',
    description: 'Billable or internal project time is tracked against.',
    labelField: 'name',
    showInSidebar: false,
    fields: [],
  },
  {
    id: E.staff.staff_time_task,
    label: 'Time Task',
    description: 'Task on a time project, tracked on the Kanban board.',
    labelField: 'title',
    showInSidebar: false,
    fields: [],
  },
  {
    id: E.staff.staff_time_report,
    label: 'Time Report',
    description: 'Customer time and cost statement for a period.',
    labelField: 'title',
    showInSidebar: false,
    fields: [],
  },
  {
    id: E.staff.staff_time_tag,
    label: 'Time Tag',
    description: 'Tag assignable to time entries and tasks.',
    labelField: 'label',
    showInSidebar: false,
    fields: [],
  },
]

export const entities = systemEntities
export default systemEntities
