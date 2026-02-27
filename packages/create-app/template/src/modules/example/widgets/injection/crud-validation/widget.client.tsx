"use client"
import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'

export default function ValidationWidget({ context, data, disabled }: InjectionWidgetComponentProps) {
  const sharedState =
    context && typeof context === 'object'
      ? (context as { sharedState?: { get?: <T>(key: string) => T | undefined; subscribe?: (key: string, cb: (value: unknown) => void) => () => void } }).sharedState
      : undefined

  const [lastFieldChange, setLastFieldChange] = React.useState<unknown>(sharedState?.get?.('lastFieldChange') ?? null)
  const [lastFieldChangeWarning, setLastFieldChangeWarning] = React.useState<unknown>(
    sharedState?.get?.('lastFieldChangeWarning') ?? null,
  )
  const [lastNavigationResult, setLastNavigationResult] = React.useState<unknown>(
    sharedState?.get?.('lastNavigationResult') ?? null,
  )
  const [lastVisibilityChange, setLastVisibilityChange] = React.useState<unknown>(
    sharedState?.get?.('lastVisibilityChange') ?? null,
  )
  const [lastAppEvent, setLastAppEvent] = React.useState<unknown>(sharedState?.get?.('lastAppEvent') ?? null)
  const [lastSaveGuard, setLastSaveGuard] = React.useState<unknown>(sharedState?.get?.('lastSaveGuard') ?? null)
  const [lastTransformFormData, setLastTransformFormData] = React.useState<unknown>(
    sharedState?.get?.('lastTransformFormData') ?? null,
  )
  const [lastTransformDisplayData, setLastTransformDisplayData] = React.useState<unknown>(
    sharedState?.get?.('lastTransformDisplayData') ?? null,
  )
  const [lastTransformValidation, setLastTransformValidation] = React.useState<unknown>(
    sharedState?.get?.('lastTransformValidation') ?? null,
  )

  React.useEffect(() => {
    if (!sharedState?.subscribe) return
    const unsubscribers = [
      sharedState.subscribe('lastFieldChange', setLastFieldChange),
      sharedState.subscribe('lastFieldChangeWarning', setLastFieldChangeWarning),
      sharedState.subscribe('lastNavigationResult', setLastNavigationResult),
      sharedState.subscribe('lastVisibilityChange', setLastVisibilityChange),
      sharedState.subscribe('lastAppEvent', setLastAppEvent),
      sharedState.subscribe('lastSaveGuard', setLastSaveGuard),
      sharedState.subscribe('lastTransformFormData', setLastTransformFormData),
      sharedState.subscribe('lastTransformDisplayData', setLastTransformDisplayData),
      sharedState.subscribe('lastTransformValidation', setLastTransformValidation),
    ]
    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe())
    }
  }, [sharedState])

  const print = (value: unknown) => JSON.stringify(value ?? null)

  return (
    <div className="rounded border border-blue-200 bg-blue-50 p-3 text-sm space-y-1">
      <div className="font-medium text-blue-900">Example Injection Widget</div>
      <div className="text-blue-700 mt-1">
        This widget is injected via the widget injection system. It can respond to form events and add custom UI.
      </div>
      {disabled && <div className="text-blue-600 mt-1 text-xs">Form is currently saving...</div>}
      <div data-testid="widget-field-change" className="text-xs text-blue-800">fieldChange={print(lastFieldChange)}</div>
      <div data-testid="widget-field-warning" className="text-xs text-blue-800">fieldWarning={print(lastFieldChangeWarning)}</div>
      <div data-testid="widget-navigation" className="text-xs text-blue-800">navigate={print(lastNavigationResult)}</div>
      <div data-testid="widget-visibility" className="text-xs text-blue-800">visibility={print(lastVisibilityChange)}</div>
      <div data-testid="widget-app-event" className="text-xs text-blue-800">appEvent={print(lastAppEvent)}</div>
      <div data-testid="widget-save-guard" className="text-xs text-blue-800">saveGuard={print(lastSaveGuard)}</div>
      <div data-testid="widget-transform-form-data" className="text-xs text-blue-800">transformFormData={print(lastTransformFormData)}</div>
      <div data-testid="widget-transform-display-data" className="text-xs text-blue-800">transformDisplayData={print(lastTransformDisplayData)}</div>
      <div data-testid="widget-transform-validation" className="text-xs text-blue-800">transformValidation={print(lastTransformValidation)}</div>
    </div>
  )
}
