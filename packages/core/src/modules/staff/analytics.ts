import type { AnalyticsModuleConfig } from '@open-mercato/shared/modules/analytics'

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
        date: { dbColumn: 'date', type: 'date' },
        timeProjectId: { dbColumn: 'time_project_id', type: 'uuid' },
        staffMemberId: { dbColumn: 'staff_member_id', type: 'uuid' },
        source: { dbColumn: 'source', type: 'text' },
      },
      labelResolvers: {
        timeProjectId: { table: 'staff_time_projects', idColumn: 'id', labelColumn: 'name' },
        staffMemberId: { table: 'staff_team_members', idColumn: 'id', labelColumn: 'display_name' },
      },
    },
  ],
}

export const config = analyticsConfig
export default analyticsConfig
