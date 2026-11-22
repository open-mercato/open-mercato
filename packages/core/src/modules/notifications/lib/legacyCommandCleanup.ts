import { sql, type QueryExecutorProvider } from 'kysely'
import { legacyCommandCleanupOptionsSchema, type LegacyCommandCleanupOptions } from '../data/validators'

type CleanupNotification = {
  id: string
  tenantId: string
  organizationId: string | null
}

export async function cleanupLegacyNotificationCommands(
  database: QueryExecutorProvider,
  input: LegacyCommandCleanupOptions,
): Promise<CleanupNotification[]> {
  const options = legacyCommandCleanupOptionsSchema.parse(input)
  const organizationFilter = options.org
    ? sql`and organization_id = ${options.org}::uuid`
    : sql``
  const candidates = sql`
    select id from notifications
    where tenant_id = ${options.tenant}::uuid
      ${organizationFilter}
      and created_at < ${new Date(options.before)}
      and actioned_at is null
      and status in ('unread', 'read', 'dismissed')
      and exists (
        select 1 from jsonb_array_elements(
          case when jsonb_typeof(action_data -> 'actions') = 'array'
            then action_data -> 'actions' else '[]'::jsonb end
        ) as action where action ? 'commandId'
      )
    order by created_at, id
    limit ${options.limit}
    ${options.apply ? sql`for update skip locked` : sql``}
  `
  const query = options.apply
    ? sql<CleanupNotification>`
      with candidates as (${candidates})
      update notifications as notification
      set action_data = jsonb_set(notification.action_data, '{actions}', (
        select coalesce(jsonb_agg(action order by position), '[]'::jsonb)
        from jsonb_array_elements(notification.action_data -> 'actions')
          with ordinality as stored(action, position)
        where not (action ? 'commandId')
      )),
        status = 'dismissed',
        dismissed_at = coalesce(notification.dismissed_at, now()),
        expires_at = least(notification.expires_at, now())
      from candidates where notification.id = candidates.id
      returning notification.id, notification.tenant_id as "tenantId",
        notification.organization_id as "organizationId"
    `
    : sql<CleanupNotification>`
      with candidates as (${candidates})
      select notification.id, notification.tenant_id as "tenantId",
        notification.organization_id as "organizationId"
      from notifications as notification join candidates on notification.id = candidates.id
    `
  return (await query.execute(database)).rows
}
