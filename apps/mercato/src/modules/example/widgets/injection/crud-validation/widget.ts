import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import ValidationWidget from './widget.client'

function readSharedState(context: unknown) {
  if (!context || typeof context !== 'object') return null
  const candidate = (context as { sharedState?: { set?: unknown } }).sharedState
  if (!candidate || typeof candidate.set !== 'function') return null
  return candidate as { set: (key: string, value: unknown) => void }
}

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
      const sharedState = readSharedState(context)
      sharedState?.set('lastFieldChange', { fieldId, value })
      // Example: warn when title field contains "TEST"
      if (fieldId === 'title' && typeof value === 'string' && value.toUpperCase().includes('TEST')) {
        sharedState?.set('lastFieldChangeWarning', 'Title contains "TEST" — is this intentional?')
        return {
          message: { text: 'Title contains "TEST" — is this intentional?', severity: 'warning' },
        }
      }
    },
    onBeforeNavigate: async (target, context) => {
      const sharedState = readSharedState(context)
      const targetValue = typeof target === 'string' ? target : String(target ?? '')
      if (targetValue.toLowerCase().includes('blocked')) {
        const message = `Navigation blocked for target: ${targetValue}`
        sharedState?.set('lastNavigationResult', { ok: false, message, target: targetValue })
        return { ok: false, message }
      }
      sharedState?.set('lastNavigationResult', { ok: true, target: targetValue })
      return { ok: true }
    },
    onVisibilityChange: async (visible, context) => {
      const sharedState = readSharedState(context)
      sharedState?.set('lastVisibilityChange', { visible: Boolean(visible), changedAt: Date.now() })
    },
    onAppEvent: async (event, context) => {
      const sharedState = readSharedState(context)
      if (event && typeof event === 'object') {
        const eventData = event as { id?: unknown; payload?: unknown }
        sharedState?.set('lastAppEvent', {
          id: typeof eventData.id === 'string' ? eventData.id : '',
          payload: eventData.payload ?? null,
        })
      }
    },
    transformFormData: async (data, context) => {
      const sharedState = readSharedState(context)
      // Example: trim whitespace from all string fields before saving
      if (data && typeof data === 'object') {
        const trimmed = { ...(data as Record<string, unknown>) }
        for (const [key, value] of Object.entries(trimmed)) {
          if (typeof value === 'string') {
            trimmed[key] = value.trim()
          }
        }
        sharedState?.set('lastTransformFormData', trimmed)
        return trimmed as typeof data
      }
      return data
    },
    transformDisplayData: async (data, context) => {
      const sharedState = readSharedState(context)
      if (data && typeof data === 'object') {
        const transformed = { ...(data as Record<string, unknown>) }
        const title = transformed.title
        if (typeof title === 'string') {
          transformed.title = title.toUpperCase()
        }
        sharedState?.set('lastTransformDisplayData', transformed)
        return transformed as typeof data
      }
      return data
    },
    transformValidation: async (errors, _data, context) => {
      const sharedState = readSharedState(context)
      if (!errors || typeof errors !== 'object') return errors
      const transformed = { ...(errors as Record<string, string>) }
      if (typeof transformed.title === 'string') {
        transformed.title = `[widget] ${transformed.title}`
      }
      sharedState?.set('lastTransformValidation', transformed)
      return transformed
    },
  },
}

export default widget
