/** Full app bootstrap used by backend and portal page runtimes. */
import { createBootstrap, isBootstrapped } from '@open-mercato/shared/lib/bootstrap'
import { serverFoundationBootstrapData } from '@/bootstrap-common'

import { dashboardWidgetEntries } from '@/.mercato/generated/dashboard-widgets.generated'
import { injectionWidgetEntries } from '@/.mercato/generated/injection-widgets.generated'
import { componentOverrideEntries } from '@/.mercato/generated/component-overrides.generated'
import { notificationHandlerEntries } from '@/.mercato/generated/notification-handlers.generated'

export const bootstrap = createBootstrap({
  ...serverFoundationBootstrapData,
  dashboardWidgetEntries,
  injectionWidgetEntries,
  componentOverrideEntries,
  notificationHandlerEntries,
}, {
  registrationKey: 'full',
})

export { isBootstrapped }
