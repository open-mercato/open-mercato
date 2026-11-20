import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import type { LoginFormWidgetContext } from '@open-mercato/core/modules/auth/frontend/login-injection'
import LoginProviderProbeWidget from './widget.client'

/**
 * Contribution to the `auth.login:form` spot that needs no enterprise module, so the
 * public extension point can be observed in a browser. The login page is served from the
 * `login` client bootstrap profile, which has to load the injection registry for this
 * widget (and any alternative sign-in provider) to render at all.
 */
const widget: InjectionWidgetModule<LoginFormWidgetContext> = {
  metadata: {
    id: 'example.injection.login-provider-probe',
    title: 'Login Provider Probe',
    description: 'Claims the login flow for the @login-probe.example domain; inert for every other email.',
    features: [],
    requiredModules: ['auth'],
    priority: 50,
    enabled: true,
  },
  Widget: LoginProviderProbeWidget,
}

export default widget
