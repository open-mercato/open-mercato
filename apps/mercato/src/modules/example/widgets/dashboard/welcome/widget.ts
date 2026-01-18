import type { DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import WelcomeWidgetClient from './widget.client'
import { DEFAULT_SETTINGS, hydrateWelcomeSettings, type WelcomeSettings } from './config'

const widget: DashboardWidgetModule<WelcomeSettings> = {
  metadata: {
    id: 'example.dashboard.welcome',
    title: 'Welcome message',
    description: 'Greets the current user with a configurable headline and message.',
    features: ['dashboards.view', 'example.widgets.welcome'],
    defaultSize: 'md',
    defaultEnabled: true,
    defaultSettings: DEFAULT_SETTINGS,
  },
  Widget: WelcomeWidgetClient,
  hydrateSettings: hydrateWelcomeSettings,
  dehydrateSettings: (value) => ({ headline: value.headline, message: value.message }),
}

export default widget
