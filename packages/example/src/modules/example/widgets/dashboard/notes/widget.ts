import type { DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import NotesWidgetClient from './widget.client'
import { DEFAULT_SETTINGS, hydrateNotesSettings, type NotesSettings } from './config'

const widget: DashboardWidgetModule<NotesSettings> = {
  metadata: {
    id: 'example.dashboard.notes',
    title: 'Notes',
    description: 'Keep personal notes or reminders directly on the dashboard.',
    features: ['dashboards.view', 'example.widgets.notes'],
    defaultSize: 'md',
    defaultEnabled: true,
    defaultSettings: DEFAULT_SETTINGS,
  },
  Widget: NotesWidgetClient,
  hydrateSettings: hydrateNotesSettings,
  dehydrateSettings: (value) => ({ text: value.text }),
}

export default widget
