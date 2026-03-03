import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import { createElement } from 'react'

const widget: InjectionWidgetModule = {
  metadata: {
    id: 'example.injection.crud-validation-addon',
    title: 'CRUD Validation Addon',
    description: 'Nested widget rendered inside the example CRUD validation widget.',
    features: ['example.widgets.injection'],
    priority: 50,
    enabled: true,
  },
  Widget: () =>
    createElement(
      'div',
      { className: 'rounded border border-border bg-muted/30 px-2 py-1 text-xs text-muted-foreground' },
      "Addon injected into validation widget's nested spot",
    ),
  eventHandlers: {
    onBeforeSave: async (_data, context) => {
      const sharedState =
        context && typeof context === 'object'
          ? (context as { sharedState?: { set?: (key: string, value: unknown) => void } }).sharedState
          : undefined
      sharedState?.set?.('lastRecursiveAddonBeforeSave', { fired: true, firedAt: Date.now() })
      console.log('[UMES] Nested addon widget onBeforeSave fired')
      return { ok: true }
    },
  },
}

export default widget
