"use client"

import * as React from 'react'
import { z } from 'zod'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'

function print(value: unknown) {
  return JSON.stringify(value ?? null)
}

export default function UmesNextPhasesPage() {
  const t = useT()
  const [submittedData, setSubmittedData] = React.useState<unknown>(null)
  const [addonDetected, setAddonDetected] = React.useState(false)

  const schema = React.useMemo(
    () => z.object({
      title: z.string().min(1, t('example.umes.handlers.validation.titleRequired')),
      note: z.string().optional(),
    }),
    [t],
  )

  const fields = React.useMemo<CrudField[]>(
    () => [
      { id: 'title', label: t('example.umes.handlers.fields.title'), type: 'text', required: true },
      { id: 'note', label: t('example.umes.handlers.fields.note'), type: 'text' },
    ],
    [t],
  )

  const groups = React.useMemo<CrudFormGroup[]>(
    () => [{ id: 'phase-j-main', title: t('example.umes.next.form.group'), fields: ['title', 'note'] }],
    [t],
  )

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const check = () => {
      setAddonDetected(Boolean(document.querySelector('[data-testid="recursive-widget-addon"]')))
    }
    check()
    const interval = window.setInterval(check, 500)
    return () => { window.clearInterval(interval) }
  }, [])

  const phaseJOk = addonDetected
  const phaseRows = React.useMemo(
    () => [
      {
        id: 'J',
        ok: phaseJOk,
        label: t('example.umes.next.phaseJ.label'),
        signal: { addonDetected },
      },
    ],
    [phaseJOk, addonDetected, t],
  )

  return (
    <Page>
      <PageBody className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold">{t('example.umes.next.page.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('example.umes.next.page.description')}</p>
        </div>

        <div className="space-y-3 rounded border border-border p-4">
          <div>
            <h2 className="text-lg font-semibold">{t('example.umes.next.readiness.title')}</h2>
            <p className="text-sm text-muted-foreground">{t('example.umes.next.readiness.description')}</p>
          </div>
          <div className="grid gap-2">
            {phaseRows.map((row) => (
              <div key={row.id} className="grid gap-2 rounded border border-border p-3 md:grid-cols-[120px_120px_1fr]">
                <div className="text-sm font-medium">
                  {row.id}: {row.label}
                </div>
                <div
                  data-testid={`phase-status-${row.id.toLowerCase()}`}
                  className={row.ok ? 'text-sm text-green-700' : 'text-sm text-amber-700'}
                >
                  {row.ok ? t('example.umes.handlers.phaseAD.status.ok') : t('example.umes.handlers.phaseAD.status.missing')}
                </div>
                <div className="text-xs text-muted-foreground">
                  signal={print(row.signal)}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3 rounded border border-border p-4">
          <div>
            <h2 className="text-lg font-semibold">{t('example.umes.next.recursive.title')}</h2>
            <p className="text-sm text-muted-foreground">{t('example.umes.next.recursive.description')}</p>
          </div>
          <div data-testid="phase-j-standalone-spot" className="rounded border border-dashed border-border p-3">
            <div className="mb-2 text-xs font-medium text-muted-foreground">
              {t('example.umes.next.recursive.spotLabel')} widget:example.injection.crud-validation:addon
            </div>
            <InjectionSpot
              spotId="example:phase-j-recursive"
              context={{}}
              data={{}}
            />
          </div>
        </div>

        <CrudForm<{ title: string; note?: string }>
          schema={schema}
          title={t('example.umes.next.form.title')}
          fields={fields}
          groups={groups}
          injectionSpotId="example:phase-j-recursive"
          initialValues={{ title: 'recursive widget test', note: '' }}
          cancelHref="/backend/umes-handlers"
          onSubmit={async (values) => {
            setSubmittedData(values)
          }}
        />

        <div className="grid gap-1 rounded border border-border p-4 text-xs">
          <div data-testid="phase-j-submit-result">submitResult={print(submittedData)}</div>
        </div>
      </PageBody>
    </Page>
  )
}
