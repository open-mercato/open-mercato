import type {
  InjectionWidgetModule,
  WidgetBeforeSaveResult,
  WidgetInjectionEventHandlers,
} from '@open-mercato/shared/modules/widgets/injection'
import { loadInjectionWidgetsForSpot } from '@open-mercato/shared/modules/widgets/injection-loader'
import ValidationWidget from './widget.client'

function readSharedState(context: unknown) {
  if (!context || typeof context !== 'object') return null
  const candidate = (context as { sharedState?: { get?: unknown; set?: unknown } }).sharedState
  if (!candidate || typeof candidate.set !== 'function') return null
  return candidate as { get?: (key: string) => unknown; set: (key: string, value: unknown) => void }
}

const RECURSIVE_ADDON_SPOT = 'widget:example.injection.crud-validation:addon'

function normalizeBeforeSaveResult(result: WidgetBeforeSaveResult): {
  ok: boolean
  message?: string
  fieldErrors?: Record<string, string>
  requestHeaders?: Record<string, string>
  details?: unknown
} {
  if (result === false) return { ok: false }
  if (result === true || typeof result === 'undefined') return { ok: true }
  if (result && typeof result === 'object') {
    return {
      ok: typeof result.ok === 'boolean' ? result.ok : true,
      message: typeof result.message === 'string' ? result.message : undefined,
      fieldErrors:
        result.fieldErrors && typeof result.fieldErrors === 'object'
          ? Object.fromEntries(Object.entries(result.fieldErrors).map(([key, value]) => [key, String(value)]))
          : undefined,
      requestHeaders:
        result.requestHeaders && typeof result.requestHeaders === 'object'
          ? Object.fromEntries(Object.entries(result.requestHeaders).map(([key, value]) => [key, String(value)]))
          : undefined,
      details: result.details,
    }
  }
  return { ok: true }
}

function shouldRunForOperation(
  eventHandlers: WidgetInjectionEventHandlers<unknown, unknown> | undefined,
  operation: 'create' | 'update' | 'delete',
) {
  const operations = eventHandlers?.filter?.operations
  return !Array.isArray(operations) || operations.length === 0 || operations.includes(operation)
}

async function runRecursiveBeforeSave(data: unknown, context: unknown): Promise<WidgetBeforeSaveResult> {
  const sharedState = readSharedState(context)
  const nestedWidgets = await loadInjectionWidgetsForSpot(RECURSIVE_ADDON_SPOT)
  let mergedHeaders: Record<string, string> | undefined
  let mergedFieldErrors: Record<string, string> | undefined
  let message: string | undefined
  let details: unknown

  for (const nestedWidget of nestedWidgets) {
    if (!shouldRunForOperation(nestedWidget.eventHandlers, 'create')) continue
    const nestedResult = await nestedWidget.eventHandlers?.onBeforeSave?.(data, context)
    const normalized = normalizeBeforeSaveResult(nestedResult)
    if (!normalized.ok) {
      return normalized
    }
    if (normalized.requestHeaders) {
      mergedHeaders = { ...(mergedHeaders ?? {}), ...normalized.requestHeaders }
    }
    if (normalized.fieldErrors) {
      mergedFieldErrors = { ...(mergedFieldErrors ?? {}), ...normalized.fieldErrors }
    }
    if (normalized.message) {
      message = normalized.message
    }
    if (typeof normalized.details !== 'undefined') {
      details = normalized.details
    }
  }

  if (nestedWidgets.length > 0) {
    sharedState?.set('lastRecursiveAddonBeforeSave', {
      fired: true,
      firedAt: Date.now(),
      widgets: nestedWidgets.map((widget) => widget.metadata.id),
    })
  }

  if (!mergedHeaders && !mergedFieldErrors && !message && typeof details === 'undefined') {
    return true
  }

  return {
    ok: true,
    ...(mergedHeaders ? { requestHeaders: mergedHeaders } : {}),
    ...(mergedFieldErrors ? { fieldErrors: mergedFieldErrors } : {}),
    ...(message ? { message } : {}),
    ...(typeof details !== 'undefined' ? { details } : {}),
  }
}

async function runRecursiveLifecycleEvent(
  eventName: 'onSave' | 'onAfterSave',
  data: unknown,
  context: unknown,
) {
  const nestedWidgets = await loadInjectionWidgetsForSpot(RECURSIVE_ADDON_SPOT)
  for (const nestedWidget of nestedWidgets) {
    if (!shouldRunForOperation(nestedWidget.eventHandlers, 'create')) continue
    const handler = nestedWidget.eventHandlers?.[eventName]
    if (!handler) continue
    await handler(data, context)
  }
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
      const sharedState = readSharedState(context)
      const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
      const title = typeof record.title === 'string' ? record.title : ''
      const normalizedTitle = title.toLowerCase()
      const confirmRequested = normalizedTitle.includes('[confirm]') || sharedState?.get?.('lastConfirmRequested') === true
      if (normalizedTitle.includes('[block]')) {
        const message = 'Save blocked by widget rule. Remove [block] from title to continue.'
        sharedState?.set('lastSaveGuard', { ok: false, reason: 'rule:block-tag', message })
        return {
          ok: false,
          message,
          fieldErrors: {
            title: 'Remove [block] marker from title',
          },
        }
      }
      if (confirmRequested && typeof window !== 'undefined') {
        const shouldContinue = window.confirm('Widget confirmation: apply transform and continue saving?')
        if (!shouldContinue) {
          const message = 'Save canceled in confirmation dialog.'
          sharedState?.set('lastSaveGuard', { ok: false, reason: 'dialog:cancel', message })
          sharedState?.set('lastConfirmRequested', false)
          return { ok: false, message }
        }
        sharedState?.set('lastSaveGuard', { ok: true, reason: 'dialog:accepted' })
        sharedState?.set('lastConfirmRequested', false)
        const recursiveResult = await runRecursiveBeforeSave(data, context)
        const normalizedRecursive = normalizeBeforeSaveResult(recursiveResult)
        if (!normalizedRecursive.ok) {
          return normalizedRecursive
        }
        return recursiveResult
      }
      sharedState?.set('lastConfirmRequested', false)
      sharedState?.set('lastSaveGuard', { ok: true, reason: 'pass' })
      const recursiveResult = await runRecursiveBeforeSave(data, context)
      const normalizedRecursive = normalizeBeforeSaveResult(recursiveResult)
      if (!normalizedRecursive.ok) {
        return normalizedRecursive
      }
      return recursiveResult
    },
    onSave: async (data, context) => {
      console.log('[Example Widget] Save triggered:', data, context)
      await runRecursiveLifecycleEvent('onSave', data, context)
    },
    onAfterSave: async (data, context) => {
      console.log('[Example Widget] After save complete:', data, context)
      await runRecursiveLifecycleEvent('onAfterSave', data, context)
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
        const title = typeof trimmed.title === 'string' ? trimmed.title : ''
        const note = typeof trimmed.note === 'string' ? trimmed.note : ''
        const confirmRequested = title.toLowerCase().includes('[confirm]')
        sharedState?.set('lastConfirmRequested', confirmRequested)
        const shouldTransform =
          title.toLowerCase().includes('[transform]') ||
          note.toLowerCase().startsWith('transform:')
        if (shouldTransform) {
          if (typeof trimmed.title === 'string') {
            trimmed.title = trimmed.title
              .replace(/\[transform\]/ig, '')
              .replace(/\[confirm\]/ig, '')
              .trim()
            trimmed.title = `${trimmed.title} (transformed)`
          }
          if (typeof trimmed.note === 'string') {
            trimmed.note = trimmed.note.replace(/^transform:\s*/i, '').toUpperCase()
          }
        }
        sharedState?.set('lastTransformFormData', trimmed)
        if (shouldTransform) {
          return { data: trimmed as typeof data, applyToForm: true }
        }
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
      sharedState?.set('lastTransformValidation', transformed)
      return transformed
    },
  },
}

export default widget
