/**
 * EP-45 — entity fields a tenant may translate per locale.
 *
 * Keys are entity ids, values are **database column** names (snake_case), matching the
 * `staff_team_member` entry this file shipped with. Adding a field here does not change
 * any rendered output on its own: the translation overlay only substitutes a value when
 * a translation row exists for the request locale, and there are none until a tenant
 * writes one.
 *
 * Only columns that actually exist are listed. `staff_time_task_statuses` has no
 * description column and `staff_time_tags` names its label `label`, so the spec's
 * "name / description" reads as "the human-readable columns of each" rather than two
 * literal column names.
 */
export const translatableFields: Record<string, string[]> = {
  'staff:staff_team_member': ['display_name', 'description'],
  'staff:staff_time_project': ['name', 'description'],
  'staff:staff_time_task_status': ['name'],
  'staff:staff_time_tag': ['label'],
}

export default translatableFields
