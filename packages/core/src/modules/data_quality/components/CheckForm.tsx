"use client"

import * as React from 'react'
import Link from 'next/link'
import { z } from 'zod'
import { CrudForm, type CrudCustomFieldRenderProps, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ConditionBuilder } from '../../business_rules/components/ConditionBuilder'
import type { GroupCondition } from '../../business_rules/components/utils/conditionValidation'
import { severitySchema } from '../data/validators'

type CheckFormProps = {
  mode: 'create' | 'edit'
  checkId?: string
}

type CheckRecord = {
  id: string
  code?: string | null
  name?: string | null
  description?: string | null
  targetEntityType?: string | null
  severity?: z.infer<typeof severitySchema> | null
  weight?: number | null
  enabled?: boolean | null
  failureExpression?: GroupCondition | null
}

type CheckListResponse = {
  items?: CheckRecord[]
}

const checkFormSchema = z.object({
  code: z.string().trim().optional(),
  name: z.string().trim().min(1),
  description: z.string().optional(),
  targetEntityType: z.string().trim().min(1),
  severity: severitySchema,
  weight: z.coerce.number().int().min(1).max(100),
  enabled: z.boolean(),
  failureExpression: z.record(z.string(), z.unknown()).nullable().optional(),
})

type CheckFormValues = z.infer<typeof checkFormSchema>

function FailureExpressionField({ value, setValue, values }: CrudCustomFieldRenderProps) {
  const t = useT()
  const nextValue = value && typeof value === 'object' ? (value as GroupCondition) : null
  const targetEntityType = typeof values?.targetEntityType === 'string' ? values.targetEntityType : ''

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        {t('data_quality.form.condition.description', 'Define the condition that identifies failing records. Records matching this expression will be flagged.')}
      </p>
      <ConditionBuilder
        value={nextValue}
        onChangeAction={(updated) => setValue(updated)}
        entityType={targetEntityType}
      />
    </div>
  )
}

export function CheckForm({ mode, checkId }: CheckFormProps) {
  const t = useT()
  const [initialValues, setInitialValues] = React.useState<Partial<CheckFormValues>>({
    code: '',
    name: '',
    description: '',
    targetEntityType: '',
    severity: 'warning',
    weight: 1,
    enabled: true,
    failureExpression: null,
  })
  const [loading, setLoading] = React.useState(mode === 'edit')
  const [loadError, setLoadError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (mode !== 'edit' || !checkId) return

    let cancelled = false
    async function loadCheck() {
      setLoading(true)
      setLoadError(null)
      try {
        const { ok, result } = await apiCall<CheckListResponse>(
          `/api/data_quality/checks?id=${encodeURIComponent(checkId)}&page=1&pageSize=1`,
        )
        if (!ok) {
          throw new Error(t('data_quality.errors.checkLoadFailed', 'Failed to load the data quality check.'))
        }
        const record = Array.isArray(result?.items) ? result.items[0] : null
        if (!record) {
          throw new Error(t('data_quality.errors.checkNotFound', 'Check not found.'))
        }
        if (cancelled) return
        setInitialValues({
          code: record.code ?? '',
          name: record.name ?? '',
          description: record.description ?? '',
          targetEntityType: record.targetEntityType ?? '',
          severity: record.severity ?? 'warning',
          weight: record.weight ?? 1,
          enabled: record.enabled ?? true,
          failureExpression: record.failureExpression ?? null,
        })
      } catch (nextError) {
        if (!cancelled) {
          setLoadError(nextError instanceof Error ? nextError.message : t('data_quality.errors.checkLoadFailed', 'Failed to load the data quality check.'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadCheck()
    return () => {
      cancelled = true
    }
  }, [checkId, mode, t])

  const fields = React.useMemo<CrudField[]>(() => {
    const list: CrudField[] = []
    if (mode === 'create') {
      list.push({
        id: 'code',
        label: t('data_quality.checks.columns.code', 'Code'),
        type: 'text',
        required: true,
        placeholder: 'catalog.product.missing_image',
      })
    }

    list.push(
      {
        id: 'name',
        label: t('data_quality.checks.columns.name', 'Name'),
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
        id: 'targetEntityType',
        label: t('data_quality.checks.columns.target', 'Target'),
        type: 'text',
        required: true,
        placeholder: 'catalog:products',
      },
      {
        id: 'severity',
        label: t('data_quality.checks.columns.severity', 'Severity'),
        type: 'select',
        options: [
          { value: 'info', label: t('data_quality.severity.info', 'Info') },
          { value: 'warning', label: t('data_quality.severity.warning', 'Warning') },
          { value: 'error', label: t('data_quality.severity.error', 'Error') },
          { value: 'critical', label: t('data_quality.severity.critical', 'Critical') },
        ],
      },
      {
        id: 'weight',
        label: t('data_quality.checks.columns.weight', 'Weight'),
        type: 'number',
        required: true,
      },
      {
        id: 'enabled',
        label: t('data_quality.checks.columns.enabled', 'Enabled'),
        type: 'checkbox',
      },
      {
        id: 'failureExpression',
        label: t('data_quality.form.condition.title', 'Failure Condition'),
        type: 'custom',
        component: FailureExpressionField,
      },
    )

    return list
  }, [mode, t])

  const detailFieldIds = React.useMemo(() => {
    const list = ['name', 'description', 'targetEntityType', 'severity', 'weight', 'enabled']
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
    {
      id: 'condition',
      title: t('data_quality.form.condition.title', 'Failure Condition'),
      column: 2,
      fields: ['failureExpression'],
    },
  ]), [detailFieldIds, t])

  const successRedirect = React.useMemo(
    () => `/backend/data-quality/checks?flash=${encodeURIComponent(
      mode === 'create'
        ? t('data_quality.flash.checkCreated', 'Check created successfully.')
        : t('data_quality.flash.checkUpdated', 'Check updated successfully.'),
    )}&type=success`,
    [mode, t],
  )

  if (loading) {
    return <LoadingMessage label={t('data_quality.checks.loading', 'Loading check...')} />
  }

  if (loadError) {
    return (
      <ErrorMessage
        label={loadError}
        action={
          <Button variant="outline" asChild>
            <Link href="/backend/data-quality/checks">{t('data_quality.nav.checks', 'Checks')}</Link>
          </Button>
        }
      />
    )
  }

  if (mode === 'edit' && !checkId) {
    return <ErrorMessage label={t('data_quality.errors.checkNotFound', 'Check not found.')} />
  }

  return (
    <CrudForm<CheckFormValues>
      title={mode === 'create' ? t('data_quality.checks.create', 'Create Check') : t('data_quality.checks.edit', 'Edit Check')}
      backHref="/backend/data-quality/checks"
      fields={fields}
      groups={groups}
      schema={checkFormSchema}
      initialValues={initialValues}
      isLoading={loading}
      loadingMessage={t('data_quality.checks.loading', 'Loading check...')}
      submitLabel={mode === 'create' ? t('data_quality.checks.create', 'Create Check') : t('common.save', 'Save')}
      cancelHref="/backend/data-quality/checks"
      successRedirect={successRedirect}
      onSubmit={async (values) => {
        const name = values.name.trim()
        const targetEntityType = values.targetEntityType.trim()
        const code = typeof values.code === 'string' ? values.code.trim() : ''
        const failureExpression = values.failureExpression && typeof values.failureExpression === 'object'
          ? values.failureExpression
          : null

        if (mode === 'create' && !code) {
          const message = t('data_quality.errors.codeRequired', 'Code is required.')
          throw createCrudFormError(message, { code: message })
        }
        if (!failureExpression) {
          const message = t('data_quality.errors.invalidExpression', 'Invalid failure expression.')
          throw createCrudFormError(message, { failureExpression: message })
        }

        const payload: Record<string, unknown> = {
          name,
          description: values.description?.trim() ? values.description.trim() : null,
          targetEntityType,
          severity: values.severity,
          weight: values.weight,
          enabled: values.enabled,
          failureExpression,
        }

        if (mode === 'create') {
          payload.code = code
          await createCrud('data_quality/checks', payload, {
            errorMessage: t('data_quality.errors.checkSaveFailed', 'Failed to save the data quality check.'),
          })
          return
        }

        await updateCrud('data_quality/checks', { id: checkId, ...payload }, {
          errorMessage: t('data_quality.errors.checkSaveFailed', 'Failed to save the data quality check.'),
        })
      }}
    />
  )
}
