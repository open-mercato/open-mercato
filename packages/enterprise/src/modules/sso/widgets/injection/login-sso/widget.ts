import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import type { LoginFormWidgetContext } from '@open-mercato/core/modules/auth/frontend/login-injection'
import Widget from './widget.client'

const widgetModule: InjectionWidgetModule<LoginFormWidgetContext> = {
  metadata: {
    id: 'sso.injection.login-sso',
    title: 'SSO Login',
    features: [],
    priority: 100,
    enabled: true,
  },
  Widget,
}

export default widgetModule
