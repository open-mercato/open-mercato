"use client"

import * as React from 'react'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { defaultFieldTypeRegistry } from '../../../schema/field-type-registry'
import {
  resolveLocaleString,
  resolveSectionTitle,
  type RunnerActiveFormResponse,
  type RunnerSection,
} from '../types'

export type ReviewStepProps = {
  schemaResponse: RunnerActiveFormResponse
  values: Record<string, unknown>
  locale: string
  onBack: () => void
  onSubmit: () => void
  submitting: boolean
}

export function ReviewStep({
  schemaResponse,
  values,
  locale,
  onBack,
  onSubmit,
  submitting,
}: ReviewStepProps) {
  const t = useT()
  const defaultLocale = schemaResponse.form.defaultLocale
  const sections: RunnerSection[] = Array.isArray(schemaResponse.schema['x-om-sections'])
    ? (schemaResponse.schema['x-om-sections'] as RunnerSection[])
    : []
  const fieldOrder = sections.length > 0
    ? sections.flatMap((section) => section.fieldKeys)
    : Object.keys(schemaResponse.schema.properties ?? {})

  const onFormSubmit = React.useCallback(
    (event: React.FormEvent) => {
      event.preventDefault()
      onSubmit()
    },
    [onSubmit],
  )

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        onSubmit()
      }
    },
    [onSubmit],
  )

  return (
    <form
      className="mx-auto flex w-full max-w-2xl flex-col gap-6"
      onSubmit={onFormSubmit}
      onKeyDown={onKeyDown}
    >
      <header>
        <h2 className="text-2xl font-semibold text-foreground">
          {t('forms.runner.review.title', { fallback: 'Review your answers' })}
        </h2>
      </header>

      <Alert variant="warning">
        <AlertTitle>
          {t('forms.runner.review.title', { fallback: 'Review your answers' })}
        </AlertTitle>
        <AlertDescription>
          {t('forms.runner.review.callout', {
            fallback:
              'On submit, this version is locked and a PDF snapshot is generated. You can still download the PDF later.',
          })}
        </AlertDescription>
      </Alert>

      <div className="flex flex-col gap-6">
        {sections.length > 0 ? (
          sections.map((section) => (
            <section key={section.key} className="rounded-lg border border-border bg-card p-4">
              <h3 className="mb-3 text-base font-semibold text-foreground">
                {resolveSectionTitle(section, locale, defaultLocale)}
              </h3>
              <dl className="flex flex-col gap-3">
                {section.fieldKeys.map((fieldKey) =>
                  renderRow(fieldKey, values, schemaResponse, locale, defaultLocale, t),
                )}
              </dl>
            </section>
          ))
        ) : (
          <section className="rounded-lg border border-border bg-card p-4">
            <dl className="flex flex-col gap-3">
              {fieldOrder.map((fieldKey) =>
                renderRow(fieldKey, values, schemaResponse, locale, defaultLocale, t),
              )}
            </dl>
          </section>
        )}
      </div>

      <footer className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" variant="outline" onClick={onBack} className="flex-1" disabled={submitting}>
          {t('forms.runner.review.actions.back', { fallback: 'Back to editing' })}
        </Button>
        <Button type="submit" className="flex-1" disabled={submitting}>
          {t('forms.runner.review.actions.submit', { fallback: 'Submit' })}
        </Button>
      </footer>
    </form>
  )
}

function renderRow(
  fieldKey: string,
  values: Record<string, unknown>,
  schemaResponse: RunnerActiveFormResponse,
  locale: string,
  defaultLocale: string,
  t: ReturnType<typeof useT>,
): React.ReactNode {
  const node = (schemaResponse.schema.properties ?? {})[fieldKey]
  if (!node) return null
  const descriptor = schemaResponse.fieldIndex[fieldKey]
  if (descriptor?.type === 'info_block') return null
  const label = resolveLocaleString(node['x-om-label'], locale, defaultLocale, fieldKey)
  const typeKey = String(node['x-om-type'] ?? 'text')
  const spec = defaultFieldTypeRegistry.get(typeKey)
  const exporter = spec?.exportAdapter
  const raw = values[fieldKey]
  const display = exporter ? exporter(raw) : String(raw ?? '')
  const empty = display === '' || display === undefined
  return (
    <div key={fieldKey} className="grid grid-cols-1 gap-1 sm:grid-cols-3 sm:items-baseline sm:gap-4">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="col-span-1 text-sm text-foreground sm:col-span-2">
        {empty ? (
          <span className="italic text-muted-foreground">
            {t('forms.runner.review.empty', { fallback: 'No answer provided.' })}
          </span>
        ) : (
          display
        )}
      </dd>
    </div>
  )
}
