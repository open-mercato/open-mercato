import { createBootstrap, isBootstrapped } from '@open-mercato/shared/lib/bootstrap'
import { register as registerAppDi } from '@/di'
import { serverFoundationBootstrapData } from '@/bootstrap-common'
import { injectionWidgetEntries } from '@/.mercato/generated/injection-widgets.generated'

/** API-only bootstrap: keeps server injection tables but excludes UI registries. */
export const bootstrap = createBootstrap({
  ...serverFoundationBootstrapData,
  dashboardWidgetEntries: [],
  injectionWidgetEntries,
}, {
  appDiRegistrar: registerAppDi,
  registrationKey: 'api',
  skipUiRegistries: true,
})

export { isBootstrapped }
