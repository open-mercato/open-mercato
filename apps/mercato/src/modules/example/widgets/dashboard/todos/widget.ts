import { lazyDashboardWidget, type DashboardWidgetModule } from '@open-mercato/shared/modules/dashboard/widgets'
import { DEFAULT_SETTINGS, hydrateTodoSettings, type TodoSettings } from './config'
const TodoWidgetClient = lazyDashboardWidget(() => import('./widget.client'))

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
