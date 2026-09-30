'use client'

import * as React from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { FormRunner } from '../../../../runner/FormRunner'
import { pickHiddenFromUrl } from '../../../../runner/tamper-check'

type ContextResponse = {
  form: { id: string; key: string; name: string; defaultLocale: string; supportedLocales: string[] }
  formVersion: { id: string; versionNumber: number; schemaHash: string; registryVersion: string }
  schema: Record<string, unknown>
  uiSchema: Record<string, unknown>
  requiresCustomerAuth: boolean
}

export default function PublicFormRunnerPage() {
  const t = useT()
  const params = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const formId = String(params?.id ?? '')
  const [context, setContext] = React.useState<ContextResponse | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    if (!formId) return
    apiCallOrThrow<ContextResponse>(`/api/forms/${encodeURIComponent(formId)}/run/context`, { method: 'GET' })
      .then((result) => {
        if (cancelled) return
        if (result.result) setContext(result.result)
        else setError('Failed to load form.')
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load form.')
      })
    return () => {
      cancelled = true
    }
  }, [formId])

  if (error) {
    return (
      <main className="mx-auto max-w-xl px-4 py-10">
        <Alert variant="destructive">{error}</Alert>
      </main>
    )
  }

  if (!context) {
    return (
      <main className="mx-auto max-w-xl px-4 py-10">
        <p className="text-sm text-muted-foreground">{t('forms.runner.completion.subtitle')}</p>
      </main>
    )
  }

  const params2 = new URLSearchParams()
  if (searchParams) {
    for (const [key, value] of searchParams.entries()) params2.set(key, value)
  }
  const hidden = pickHiddenFromUrl(context.schema, params2)
  const locale = context.form.defaultLocale ?? 'en'

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-4 space-y-1">
        <h1 className="text-xl font-semibold text-foreground">{context.form.name}</h1>
      </header>
      <FormRunner
        formId={formId}
        formVersionId={context.formVersion.id}
        schema={context.schema}
        uiSchema={context.uiSchema}
        hidden={hidden}
        locale={locale}
      />
    </main>
  )
}
