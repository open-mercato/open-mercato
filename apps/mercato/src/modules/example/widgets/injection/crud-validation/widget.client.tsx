"use client"
import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'

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
  const [lastRecursiveAddonBeforeSave, setLastRecursiveAddonBeforeSave] = React.useState<unknown>(
    sharedState?.get?.('lastRecursiveAddonBeforeSave') ?? null,
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
      sharedState.subscribe('lastRecursiveAddonBeforeSave', setLastRecursiveAddonBeforeSave),
    ]
    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe())
    }
  }, [sharedState])

  const print = (value: unknown) => JSON.stringify(value ?? null)

  return (
    <div className="space-y-1 rounded border border-border bg-muted/30 p-3 text-sm">
      <div className="font-medium text-foreground">Example Injection Widget</div>
      <div className="mt-1 text-muted-foreground">
        This widget is injected via the widget injection system. It can respond to form events and add custom UI.
      </div>
      {disabled && <div className="mt-1 text-xs text-muted-foreground">Form is currently saving...</div>}
      <div data-testid="widget-field-change" className="text-xs text-muted-foreground">fieldChange={print(lastFieldChange)}</div>
      <div data-testid="widget-field-warning" className="text-xs text-muted-foreground">fieldWarning={print(lastFieldChangeWarning)}</div>
      <div data-testid="widget-navigation" className="text-xs text-muted-foreground">navigate={print(lastNavigationResult)}</div>
      <div data-testid="widget-visibility" className="text-xs text-muted-foreground">visibility={print(lastVisibilityChange)}</div>
      <div data-testid="widget-app-event" className="text-xs text-muted-foreground">appEvent={print(lastAppEvent)}</div>
      <div data-testid="widget-save-guard" className="text-xs text-muted-foreground">saveGuard={print(lastSaveGuard)}</div>
      <div data-testid="widget-transform-form-data" className="text-xs text-muted-foreground">transformFormData={print(lastTransformFormData)}</div>
      <div data-testid="widget-transform-display-data" className="text-xs text-muted-foreground">transformDisplayData={print(lastTransformDisplayData)}</div>
      <div data-testid="widget-transform-validation" className="text-xs text-muted-foreground">transformValidation={print(lastTransformValidation)}</div>
      <div data-testid="widget-recursive-before-save" className="text-xs text-muted-foreground">recursiveBeforeSave={print(lastRecursiveAddonBeforeSave)}</div>
      <div data-testid="widget-recursive-addon-host" className="mt-2 rounded border border-dashed border-border/80 bg-background/60 p-2">
        <InjectionSpot
          spotId="widget:example.injection.crud-validation:addon"
          context={context}
          data={data}
          disabled={disabled}
        />
      </div>
    </div>
  )
}
