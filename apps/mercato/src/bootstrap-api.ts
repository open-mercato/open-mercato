import { createBootstrap, isBootstrapped } from '@open-mercato/shared/lib/bootstrap'
import { serverFoundationBootstrapData } from '@/bootstrap-common'

/** API-only bootstrap: keeps server injection tables but excludes UI registries. */
export const bootstrap = createBootstrap({
  ...serverFoundationBootstrapData,
  dashboardWidgetEntries: [],
  injectionWidgetEntries: [],
}, {
  registrationKey: 'api',
  skipUiRegistries: true,
})

export { isBootstrapped }
