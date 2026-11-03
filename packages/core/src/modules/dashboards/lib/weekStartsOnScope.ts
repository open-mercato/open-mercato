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
  userId?: string | null,
): Promise<Pick<WidgetDataScope, 'weekStartsOn'>> {
  const settings = await resolveDateLocaleSettingsForScope(container, { tenantId, userId: userId ?? null })
  const resolved = resolveFirstDayOfWeek(settings)
  return resolved.source === 'default' ? {} : { weekStartsOn: resolved.day }
}
