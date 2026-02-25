"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { InjectionSpot, useInjectionSpotEvents } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type DemoData = {
  title: string
  note: string
}

type ValidationErrors = Record<string, string>

const INJECTION_SPOT_ID = 'example:phase-c-handlers'

function print(value: unknown) {
  return JSON.stringify(value ?? null)
}

export default function UmesHandlersPage() {
  const t = useT()
  const [demoData, setDemoData] = React.useState<DemoData>({ title: '  TEST Widget  ', note: '  draft note  ' })
  const [validationErrors, setValidationErrors] = React.useState<ValidationErrors>({
    title: 'Title is required',
  })
  const [navigationTarget, setNavigationTarget] = React.useState('/backend/blocked')
  const [visible, setVisible] = React.useState(true)

  const [fieldChangeResult, setFieldChangeResult] = React.useState<unknown>(null)
  const [beforeNavigateResult, setBeforeNavigateResult] = React.useState<unknown>(null)
  const [formTransformResult, setFormTransformResult] = React.useState<unknown>(null)
  const [displayTransformResult, setDisplayTransformResult] = React.useState<unknown>(null)
  const [validationTransformResult, setValidationTransformResult] = React.useState<unknown>(null)
  const [appEventResult, setAppEventResult] = React.useState<unknown>(null)

  const injectionContext = React.useMemo(
    () => ({
      pageId: 'example.umes.handlers',
    }),
    [],
  )

  const { triggerEvent } = useInjectionSpotEvents<typeof injectionContext, DemoData | ValidationErrors>(INJECTION_SPOT_ID)

  useAppEvent('example.todo.*', (event) => {
    setAppEventResult(event)
    void triggerEvent('onAppEvent', demoData, injectionContext, { appEvent: event })
  }, [triggerEvent, demoData, injectionContext])

  const triggerFieldChange = React.useCallback(async () => {
    const result = await triggerEvent('onFieldChange', demoData, injectionContext, {
      fieldId: 'title',
      fieldValue: demoData.title,
    })
    setFieldChangeResult(result)
  }, [demoData, injectionContext, triggerEvent])

  const triggerBeforeNavigate = React.useCallback(async () => {
    const result = await triggerEvent('onBeforeNavigate', demoData, injectionContext, {
      target: navigationTarget,
    })
    setBeforeNavigateResult(result)
  }, [demoData, injectionContext, navigationTarget, triggerEvent])

  const triggerVisibilityChange = React.useCallback(async () => {
    const nextVisible = !visible
    setVisible(nextVisible)
    await triggerEvent('onVisibilityChange', demoData, injectionContext, {
      visible: nextVisible,
    })
  }, [demoData, injectionContext, triggerEvent, visible])

  const runTransformFormData = React.useCallback(async () => {
    const result = await triggerEvent('transformFormData', demoData, injectionContext)
    setFormTransformResult(result.data ?? null)
  }, [demoData, injectionContext, triggerEvent])

  const runTransformDisplayData = React.useCallback(async () => {
    const result = await triggerEvent('transformDisplayData', demoData, injectionContext)
    setDisplayTransformResult(result.data ?? null)
  }, [demoData, injectionContext, triggerEvent])

  const runTransformValidation = React.useCallback(async () => {
    const result = await triggerEvent('transformValidation', validationErrors, injectionContext)
    const nextErrors = (result.data ?? validationErrors) as ValidationErrors
    setValidationTransformResult(nextErrors)
    setValidationErrors(nextErrors)
  }, [injectionContext, triggerEvent, validationErrors])

  const dispatchMockEvent = React.useCallback(() => {
    if (typeof window === 'undefined') return
    window.dispatchEvent(
      new CustomEvent('om:event', {
        detail: {
          id: 'example.todo.created',
          payload: { title: demoData.title },
          timestamp: Date.now(),
          organizationId: 'demo-org',
        },
      }),
    )
  }, [demoData.title])

  return (
    <Page>
      <PageBody className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold">{t('example.umes.handlers.page.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('example.umes.handlers.page.description')}</p>
        </div>

        <div className="grid gap-3 rounded border border-border p-4">
          <label className="text-sm font-medium" htmlFor="phase-c-title">
            {t('example.umes.handlers.fields.title')}
          </label>
          <input
            id="phase-c-title"
            data-testid="phase-c-title-input"
            value={demoData.title}
            onChange={(event) => setDemoData((prev) => ({ ...prev, title: event.target.value }))}
            className="rounded border border-input bg-background px-2 py-1 text-sm"
          />

          <label className="text-sm font-medium" htmlFor="phase-c-note">
            {t('example.umes.handlers.fields.note')}
          </label>
          <input
            id="phase-c-note"
            data-testid="phase-c-note-input"
            value={demoData.note}
            onChange={(event) => setDemoData((prev) => ({ ...prev, note: event.target.value }))}
            className="rounded border border-input bg-background px-2 py-1 text-sm"
          />

          <label className="text-sm font-medium" htmlFor="phase-c-target">
            {t('example.umes.handlers.fields.navigationTarget')}
          </label>
          <input
            id="phase-c-target"
            data-testid="phase-c-target-input"
            value={navigationTarget}
            onChange={(event) => setNavigationTarget(event.target.value)}
            className="rounded border border-input bg-background px-2 py-1 text-sm"
          />

          <div className="flex flex-wrap gap-2">
            <Button data-testid="phase-c-trigger-field-change" type="button" onClick={() => void triggerFieldChange()}>
              {t('example.umes.handlers.actions.onFieldChange')}
            </Button>
            <Button data-testid="phase-c-trigger-before-navigate" type="button" onClick={() => void triggerBeforeNavigate()}>
              {t('example.umes.handlers.actions.onBeforeNavigate')}
            </Button>
            <Button data-testid="phase-c-trigger-visibility" type="button" onClick={() => void triggerVisibilityChange()}>
              {t('example.umes.handlers.actions.onVisibilityChange')}
            </Button>
            <Button data-testid="phase-c-trigger-transform-form" type="button" onClick={() => void runTransformFormData()}>
              {t('example.umes.handlers.actions.transformFormData')}
            </Button>
            <Button data-testid="phase-c-trigger-transform-display" type="button" onClick={() => void runTransformDisplayData()}>
              {t('example.umes.handlers.actions.transformDisplayData')}
            </Button>
            <Button data-testid="phase-c-trigger-transform-validation" type="button" onClick={() => void runTransformValidation()}>
              {t('example.umes.handlers.actions.transformValidation')}
            </Button>
            <Button data-testid="phase-c-trigger-app-event" type="button" onClick={dispatchMockEvent}>
              {t('example.umes.handlers.actions.onAppEvent')}
            </Button>
          </div>
        </div>

        <div className="grid gap-1 rounded border border-border p-4 text-xs">
          <div data-testid="phase-c-field-change-result">fieldChangeResult={print(fieldChangeResult)}</div>
          <div data-testid="phase-c-before-navigate-result">beforeNavigateResult={print(beforeNavigateResult)}</div>
          <div data-testid="phase-c-form-transform-result">transformFormDataResult={print(formTransformResult)}</div>
          <div data-testid="phase-c-display-transform-result">transformDisplayDataResult={print(displayTransformResult)}</div>
          <div data-testid="phase-c-validation-transform-result">transformValidationResult={print(validationTransformResult)}</div>
          <div data-testid="phase-c-app-event-result">appEventResult={print(appEventResult)}</div>
        </div>

        {visible ? (
          <InjectionSpot spotId={INJECTION_SPOT_ID} context={injectionContext} data={demoData} />
        ) : (
          <div className="rounded border border-dashed border-border p-3 text-sm text-muted-foreground">
            <span data-testid="phase-c-widget-hidden">
            {t('example.umes.handlers.widgetHidden')}
            </span>
          </div>
        )}
      </PageBody>
    </Page>
  )
}
