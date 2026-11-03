import { resolveDateLocaleSettingsForScope } from '@open-mercato/shared/lib/date-locale/registry'
import type { WidgetDataScope } from '../services/widgetDataService'

type ContainerLike = Parameters<typeof resolveDateLocaleSettingsForScope>[0]

/** The configured first day of the week as a partial widget scope; empty when unset. */
export async function resolveWeekStartsOnScope(
  container: ContainerLike,
  tenantId: string,
  userId?: string | null,
): Promise<Pick<WidgetDataScope, 'weekStartsOn'>> {
  const settings = await resolveDateLocaleSettingsForScope(container, { tenantId, userId: userId ?? null })
  return settings.firstDayOfWeek === null ? {} : { weekStartsOn: settings.firstDayOfWeek }
}
