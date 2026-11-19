import { resolveDateLocaleSettingsForScope } from '@open-mercato/shared/lib/date-locale/registry'
import { resolveFirstDayOfWeek } from '@open-mercato/shared/lib/date-locale/weekStart'
import type { WidgetDataScope } from '../services/widgetDataService'

type ContainerLike = Parameters<typeof resolveDateLocaleSettingsForScope>[0]

/**
 * The tenant's first day of the week (configured day, else its formatting locale's week start) as a
 * partial widget scope; empty when it falls back to the Monday default, so cache keys stay unchanged.
 */
export async function resolveWeekStartsOnScope(
  container: ContainerLike,
  tenantId: string,
): Promise<Pick<WidgetDataScope, 'weekStartsOn'>> {
  // Tenant-only: the first day of week and formatting locale have no user layer, so skip the
  // per-user time zone lookup on every widget data request.
  const settings = await resolveDateLocaleSettingsForScope(container, { tenantId })
  const resolved = resolveFirstDayOfWeek(settings)
  return resolved.source === 'default' ? {} : { weekStartsOn: resolved.day }
}
