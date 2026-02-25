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
    onFieldChange: async (fieldId, value, data, context) => {
      // Example: warn when title field contains "TEST"
      if (fieldId === 'title' && typeof value === 'string' && value.toUpperCase().includes('TEST')) {
        return {
          message: { text: 'Title contains "TEST" — is this intentional?', severity: 'warning' },
        }
      }
    },
    transformFormData: async (data, context) => {
      // Example: trim whitespace from all string fields before saving
      if (data && typeof data === 'object') {
        const trimmed = { ...(data as Record<string, unknown>) }
        for (const [key, value] of Object.entries(trimmed)) {
          if (typeof value === 'string') {
            trimmed[key] = value.trim()
          }
        }
        return trimmed as typeof data
      }
      return data
    },
  },
}

export default widget
