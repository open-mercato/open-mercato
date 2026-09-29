import type { AnalyticsModuleConfig } from '@open-mercato/shared/modules/analytics'

/**
 * EP-47. Four time-tracking entities are aggregatable from a dashboard widget.
 *
 * Two rules shape every mapping below.
 *
 * **Money is absent, never blanked.** `staff_time_entries.rate_override_amount`,
 * `staff_time_projects.hourly_rate` / `budget_value` and
 * `staff_time_reports.total_amount` are deliberately NOT mapped. An
 * `AnalyticsEntityConfig` carries a single `requiredFeatures` list for the whole
 * entity, so there is no shape in which a money column is gated on
 * `staff.timesheets.rates.view` while the rest of the entity stays readable by a
 * plain viewer — and mapping it under the weaker gate would hand every dashboard
 * author the customer's rates. The minute columns carry the same analysis
 * without the disclosure.
 *
 * **Custom fields are not dimensions and cannot be.** `AnalyticsFieldMapping` is
 * `{ dbColumn, type }` and the aggregation builder emits `dbColumn` as a bare
 * identifier against `entityConfig.tableName` (`dashboards/lib/aggregations.ts`),
 * so a mapping can only ever name a real column on that one table. The custom
 * fields EP-43 declared are EAV rows in the `entities` module's tables, reachable
 * by neither a join nor the jsonb-path form (which needs the values to live in a
 * jsonb column on the row itself). The point is moot in any case while the
 * command-backed write path drops `cf_*` on the way in — see the module
 * `AGENTS.md` § Time-tracking custom fields.
 *
 * `is_billable` and `billable_by_default` are declared `text` because
 * `AnalyticsFieldType` has no boolean member; the type is read for exactly one
 * decision — whether a group-by column gets a `date_trunc` — so a boolean column
 * grouped as `text` is emitted verbatim and labelled by its own value.
 */
export const analyticsConfig: AnalyticsModuleConfig = {
  entities: [
    {
      entityId: 'staff:staff_time_entries',
      requiredFeatures: ['staff.timesheets.view'],
      entityConfig: {
        tableName: 'staff_time_entries',
        dateField: 'date',
        defaultScopeFields: ['tenant_id', 'organization_id'],
      },
      fieldMappings: {
        id: { dbColumn: 'id', type: 'uuid' },
        durationMinutes: { dbColumn: 'duration_minutes', type: 'numeric' },
        roundedMinutes: { dbColumn: 'rounded_minutes', type: 'numeric' },
        date: { dbColumn: 'date', type: 'timestamp' },
        timeProjectId: { dbColumn: 'time_project_id', type: 'uuid' },
        staffMemberId: { dbColumn: 'staff_member_id', type: 'uuid' },
        taskId: { dbColumn: 'task_id', type: 'uuid' },
        customerId: { dbColumn: 'customer_id', type: 'uuid' },
        isBillable: { dbColumn: 'is_billable', type: 'text' },
        lockedReportId: { dbColumn: 'locked_report_id', type: 'uuid' },
        source: { dbColumn: 'source', type: 'text' },
      },
      labelResolvers: {
        timeProjectId: { table: 'staff_time_projects', idColumn: 'id', labelColumn: 'name' },
        staffMemberId: { table: 'staff_team_members', idColumn: 'id', labelColumn: 'display_name' },
        taskId: { table: 'staff_time_tasks', idColumn: 'id', labelColumn: 'title' },
        customerId: { table: 'customer_entities', idColumn: 'id', labelColumn: 'display_name' },
        lockedReportId: { table: 'staff_time_reports', idColumn: 'id', labelColumn: 'reference' },
      },
    },
    {
      entityId: 'staff:staff_time_tasks',
      requiredFeatures: ['staff.timesheets.tasks.view'],
      entityConfig: {
        tableName: 'staff_time_tasks',
        dateField: 'created_at',
        defaultScopeFields: ['tenant_id', 'organization_id'],
      },
      fieldMappings: {
        id: { dbColumn: 'id', type: 'uuid' },
        reference: { dbColumn: 'reference', type: 'text' },
        timeProjectId: { dbColumn: 'time_project_id', type: 'uuid' },
        parentTaskId: { dbColumn: 'parent_task_id', type: 'uuid' },
        taskStatusId: { dbColumn: 'task_status_id', type: 'uuid' },
        assigneeStaffMemberId: { dbColumn: 'assignee_staff_member_id', type: 'uuid' },
        createdAt: { dbColumn: 'created_at', type: 'timestamp' },
        closedAt: { dbColumn: 'closed_at', type: 'timestamp' },
      },
      labelResolvers: {
        timeProjectId: { table: 'staff_time_projects', idColumn: 'id', labelColumn: 'name' },
        taskStatusId: { table: 'staff_time_task_statuses', idColumn: 'id', labelColumn: 'name' },
        assigneeStaffMemberId: { table: 'staff_team_members', idColumn: 'id', labelColumn: 'display_name' },
        parentTaskId: { table: 'staff_time_tasks', idColumn: 'id', labelColumn: 'title' },
      },
    },
    {
      entityId: 'staff:staff_time_projects',
      requiredFeatures: ['staff.timesheets.projects.view'],
      entityConfig: {
        tableName: 'staff_time_projects',
        dateField: 'created_at',
        defaultScopeFields: ['tenant_id', 'organization_id'],
      },
      fieldMappings: {
        id: { dbColumn: 'id', type: 'uuid' },
        code: { dbColumn: 'code', type: 'text' },
        customerId: { dbColumn: 'customer_id', type: 'uuid' },
        projectType: { dbColumn: 'project_type', type: 'text' },
        status: { dbColumn: 'status', type: 'text' },
        ownerUserId: { dbColumn: 'owner_user_id', type: 'uuid' },
        costCenter: { dbColumn: 'cost_center', type: 'text' },
        budgetKind: { dbColumn: 'budget_kind', type: 'text' },
        billableByDefault: { dbColumn: 'billable_by_default', type: 'text' },
        startDate: { dbColumn: 'start_date', type: 'timestamp' },
        createdAt: { dbColumn: 'created_at', type: 'timestamp' },
      },
      labelResolvers: {
        customerId: { table: 'customer_entities', idColumn: 'id', labelColumn: 'display_name' },
      },
    },
    {
      entityId: 'staff:staff_time_reports',
      requiredFeatures: ['staff.timesheets.reports.view'],
      entityConfig: {
        tableName: 'staff_time_reports',
        dateField: 'period_from',
        defaultScopeFields: ['tenant_id', 'organization_id'],
      },
      fieldMappings: {
        id: { dbColumn: 'id', type: 'uuid' },
        reference: { dbColumn: 'reference', type: 'text' },
        customerId: { dbColumn: 'customer_id', type: 'uuid' },
        status: { dbColumn: 'status', type: 'text' },
        periodKind: { dbColumn: 'period_kind', type: 'text' },
        periodFrom: { dbColumn: 'period_from', type: 'timestamp' },
        periodTo: { dbColumn: 'period_to', type: 'timestamp' },
        grouping: { dbColumn: 'grouping', type: 'text' },
        totalBillableMinutes: { dbColumn: 'total_billable_minutes', type: 'numeric' },
        totalNonbillableMinutes: { dbColumn: 'total_nonbillable_minutes', type: 'numeric' },
        closedAt: { dbColumn: 'closed_at', type: 'timestamp' },
      },
      labelResolvers: {
        customerId: { table: 'customer_entities', idColumn: 'id', labelColumn: 'display_name' },
      },
    },
  ],
}

export const config = analyticsConfig
export default analyticsConfig
