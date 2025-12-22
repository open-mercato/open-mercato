import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import ValidationWidget from './widget.client'

const widget: InjectionWidgetModule<any, any> = {
  metadata: {
    id: 'example.injection.crud-validation',
    title: 'CRUD Form Validation Example',
    description: 'Example injection widget that demonstrates form validation hooks',
    features: ['example.widgets.injection'],
    priority: 100,
    enabled: true,
  },
  Widget: ValidationWidget,
  eventHandlers: {
    onLoad: async (context) => {
      console.log('[Example Widget] Form loaded:', context)
    },
    onBeforeSave: async (data, context) => {
      console.log('[Example Widget] Before save validation:', data, context)
      // Example: prevent save if some condition is not met
      // return false to block the save
      return true
    },
    onSave: async (data, context) => {
      console.log('[Example Widget] Save triggered:', data, context)
    },
    onAfterSave: async (data, context) => {
      console.log('[Example Widget] After save complete:', data, context)
    },
  },
}

export default widget
