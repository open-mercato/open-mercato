import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'

const viewFeatures = {
  activities: 'customers.activities.view',
  deals: 'customers.deals.view',
  interactions: 'customers.interactions.view',
  people: 'customers.people.view',
} as const

const includePermissions = {
  activities: 'activities',
  addresses: 'activities',
  comments: 'activities',
  deals: 'deals',
  interactions: 'interactions',
  people: 'people',
  todos: 'interactions',
} as const

export async function resolveCustomerDetailView(
  rbac: Pick<RbacService, 'getGrantedFeatures'>,
  userId: string,
  scope: { tenantId: string | null; organizationId: string | null },
  request: Request,
) {
  const grantedFeatures = await rbac.getGrantedFeatures(userId, scope)
  const subject = { grantedFeatures }
  const view = {
    activities: authorizeFeatures([viewFeatures.activities], subject),
    deals: authorizeFeatures([viewFeatures.deals], subject),
    interactions: authorizeFeatures([viewFeatures.interactions], subject),
    people: authorizeFeatures([viewFeatures.people], subject),
  }

  const requested = new Set(
    new URL(request.url).searchParams.getAll('include')
      .flatMap((include) => include.split(','))
      .map((token) => token.trim().toLowerCase()),
  )
  if (requested.has('notes')) requested.add('comments')
  if (requested.has('tasks')) requested.add('todos')

  const include = new Set(
    (Object.keys(includePermissions) as Array<keyof typeof includePermissions>)
      .filter((relation) => requested.has(relation) && view[includePermissions[relation]]),
  )
  const cacheAccess = Object.entries(view)
    .filter(([, allowed]) => allowed)
    .map(([feature]) => feature)
    .join(',')

  return { view, include, cacheAccess }
}
