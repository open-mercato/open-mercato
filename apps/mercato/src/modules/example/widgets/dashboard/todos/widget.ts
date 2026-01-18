import type { DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import TodoWidgetClient from './widget.client'
import { DEFAULT_SETTINGS, hydrateTodoSettings, type TodoSettings } from './config'

const widget: DashboardWidgetModule<TodoSettings> = {
  metadata: {
    id: 'example.dashboard.todos',
    title: 'Todos',
    description: 'Stay on top of Example module todos and add new ones without leaving the dashboard.',
    features: ['dashboards.view', 'example.widgets.todo'],
    defaultSize: 'md',
    defaultEnabled: true,
    defaultSettings: DEFAULT_SETTINGS,
  },
  Widget: TodoWidgetClient,
  hydrateSettings: hydrateTodoSettings,
  dehydrateSettings: (value) => ({
    pageSize: value.pageSize,
    showCompleted: value.showCompleted,
  }),
}

export default widget
