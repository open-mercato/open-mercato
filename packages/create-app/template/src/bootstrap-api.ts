import { createBootstrap, isBootstrapped } from '@open-mercato/shared/lib/bootstrap'
import { register as registerAppDi } from '@/di'
import { serverFoundationBootstrapData } from '@/bootstrap-common'
import { injectionWidgetEntries } from '@/.mercato/generated/injection-widgets.generated'

/**
 * API-only bootstrap: keeps server injection tables and entries but excludes UI registries.
 *
 * The entries are needed because module API routes resolve widget contributions on the request
 * path (the customers calendar event-type catalog is one). They are lazy `() => import(...)`
 * loaders, so listing them here costs a module reference, not a widget import: only a widget a
 * request actually resolves is ever evaluated, and `skipUiRegistries` still keeps
 * `@open-mercato/ui` out of this runtime. `skipCoreInjectionWidgets` makes the registration a
 * merge so this partition never shrinks a registry the full page bootstrap already published.
 */
export const bootstrap = createBootstrap({
  ...serverFoundationBootstrapData,
  dashboardWidgetEntries: [],
  injectionWidgetEntries,
}, {
  appDiRegistrar: registerAppDi,
  registrationKey: 'api',
  skipUiRegistries: true,
  skipCoreInjectionWidgets: true,
})

export { isBootstrapped }
