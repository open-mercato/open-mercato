import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import CrudValidationAddonWidget from './widget.client'

const widget: InjectionWidgetModule<any, any> = {
  metadata: {
    id: 'example.injection.crud-validation-addon',
    title: 'CRUD Validation Addon',
    description: 'Demonstrates recursive widget injection — this widget is injected into another widget.',
    features: ['example.widgets.injection'],
    priority: 50,
    enabled: true,
  },
  Widget: CrudValidationAddonWidget,
  eventHandlers: {
    onBeforeSave: async (data, context) => {
      console.log('[UMES] Nested addon widget onBeforeSave fired', data)
      return { ok: true }
    },
  },
}

export default widget
