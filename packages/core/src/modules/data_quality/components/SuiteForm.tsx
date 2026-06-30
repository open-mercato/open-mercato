"use client"

import * as React from 'react'
import Link from 'next/link'
import { z } from 'zod'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type SuiteFormProps = {
  mode: 'create' | 'edit'
  suiteId?: string
}

type SuiteRecord = {
  id: string
  code?: string | null
  name?: string | null
  description?: string | null
  enabled?: boolean | null
}

type SuiteListResponse = {
  items?: SuiteRecord[]
}

const suiteFormSchema = z.object({
  code: z.string().trim().optional(),
  name: z.string().trim().min(1),
  description: z.string().optional(),
  enabled: z.boolean(),
})

type SuiteFormValues = z.infer<typeof suiteFormSchema>

export function SuiteForm({ mode, suiteId }: SuiteFormProps) {
  const t = useT()
  const [initialValues, setInitialValues] = React.useState<Partial<SuiteFormValues>>({
    code: '',
    name: '',
    description: '',
    enabled: true,
  })
  const [loading, setLoading] = React.useState(mode === 'edit')
  const [loadError, setLoadError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (mode !== 'edit' || !suiteId) return

    let cancelled = false
    async function loadSuite() {
      setLoading(true)
      setLoadError(null)
      try {
        const { ok, result } = await apiCall<SuiteListResponse>(
          `/api/data_quality/suites?id=${encodeURIComponent(suiteId)}&page=1&pageSize=1`,
        )
        if (!ok) {
          throw new Error(t('data_quality.errors.suiteLoadFailed', 'Failed to load the data quality suite.'))
        }
        const record = Array.isArray(result?.items) ? result.items[0] : null
        if (!record) {
          throw new Error(t('data_quality.errors.suiteNotFound', 'Suite not found.'))
        }
        if (cancelled) return
        setInitialValues({
          code: record.code ?? '',
          name: record.name ?? '',
          description: record.description ?? '',
          enabled: record.enabled ?? true,
        })
      } catch (nextError) {
        if (!cancelled) {
          setLoadError(nextError instanceof Error ? nextError.message : t('data_quality.errors.suiteLoadFailed', 'Failed to load the data quality suite.'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadSuite()
    return () => {
      cancelled = true
    }
  }, [mode, suiteId, t])

  const fields = React.useMemo<CrudField[]>(() => {
    const list: CrudField[] = []
    if (mode === 'create') {
      list.push({
        id: 'code',
        label: t('data_quality.suites.columns.code', 'Code'),
        type: 'text',
        required: true,
      })
    }

    list.push(
      {
        id: 'name',
        label: t('data_quality.suites.columns.name', 'Name'),
        type: 'text',
        required: true,
      },
      {
        id: 'description',
        label: t('common.description', 'Description'),
        type: 'textarea',
        rows: 4,
      },
      {
        id: 'enabled',
        label: t('data_quality.suites.columns.enabled', 'Enabled'),
        type: 'checkbox',
      },
    )

    return list
  }, [mode, t])

  const detailFieldIds = React.useMemo(() => {
    const list = ['name', 'description', 'enabled']
    if (mode === 'create') list.unshift('code')
    return list
  }, [mode])

  const groups = React.useMemo<CrudFormGroup[]>(() => ([
    {
      id: 'details',
      title: t('common.details', 'Details'),
      column: 1,
      fields: detailFieldIds,
    },
  ]), [detailFieldIds, t])

  const successRedirect = React.useMemo(
    () => `/backend/data-quality/suites?flash=${encodeURIComponent(
      mode === 'create'
        ? t('data_quality.flash.suiteCreated', 'Suite created successfully.')
        : t('data_quality.flash.suiteUpdated', 'Suite updated successfully.'),
    )}&type=success`,
    [mode, t],
  )

  if (loading) {
    return <LoadingMessage label={t('data_quality.suites.loading', 'Loading suite...')} />
  }

  if (loadError) {
    return (
      <ErrorMessage
        label={loadError}
        action={
          <Button variant="outline" asChild>
            <Link href="/backend/data-quality/suites">{t('data_quality.nav.suites', 'Suites')}</Link>
          </Button>
        }
      />
    )
  }

  if (mode === 'edit' && !suiteId) {
    return <ErrorMessage label={t('data_quality.errors.suiteNotFound', 'Suite not found.')} />
  }

  return (
    <CrudForm<SuiteFormValues>
      title={mode === 'create' ? t('data_quality.suites.create', 'Create Suite') : t('data_quality.suites.edit', 'Edit Suite')}
      backHref="/backend/data-quality/suites"
      fields={fields}
      groups={groups}
      schema={suiteFormSchema}
      initialValues={initialValues}
      isLoading={loading}
      loadingMessage={t('data_quality.suites.loading', 'Loading suite...')}
      submitLabel={mode === 'create' ? t('data_quality.suites.create', 'Create Suite') : t('common.save', 'Save')}
      cancelHref="/backend/data-quality/suites"
      successRedirect={successRedirect}
      onSubmit={async (values) => {
        const code = typeof values.code === 'string' ? values.code.trim() : ''
        if (mode === 'create' && !code) {
          const message = t('data_quality.errors.codeRequired', 'Code is required.')
          throw createCrudFormError(message, { code: message })
        }

        const payload: Record<string, unknown> = {
          name: values.name.trim(),
          description: values.description?.trim() ? values.description.trim() : null,
          enabled: values.enabled,
        }

        if (mode === 'create') {
          payload.code = code
          await createCrud('data_quality/suites', payload, {
            errorMessage: t('data_quality.errors.suiteSaveFailed', 'Failed to save the data quality suite.'),
          })
          return
        }

        await updateCrud('data_quality/suites', { id: suiteId, ...payload }, {
          errorMessage: t('data_quality.errors.suiteSaveFailed', 'Failed to save the data quality suite.'),
        })
      }}
    />
  )
}
