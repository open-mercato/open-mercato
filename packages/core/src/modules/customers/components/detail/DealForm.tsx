"use client"

import * as React from 'react'
import { z } from 'zod'
import { useT } from '@/lib/i18n/context'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import {
  fetchCustomFieldFormFieldsWithDefinitions,
} from '@open-mercato/ui/backend/utils/customFieldForms'
import { E } from '@open-mercato/core/generated/entities.ids.generated'

export type DealFormBaseValues = {
  title: string
  status?: string | null
  pipelineStage?: string | null
  valueAmount?: number | null
  valueCurrency?: string | null
  probability?: number | null
  expectedCloseAt?: string | null
  description?: string | null
}

export type DealFormSubmitPayload = {
  base: DealFormBaseValues
  custom: Record<string, unknown>
}

export type DealFormProps = {
  mode: 'create' | 'edit'
  initialValues?: Partial<DealFormBaseValues & Record<string, unknown>>
  onSubmit: (payload: DealFormSubmitPayload) => Promise<void>
  onCancel: () => void
  submitLabel?: string
  cancelLabel?: string
  isSubmitting?: boolean
}

const DEAL_ENTITY_IDS = [E.customers.customer_deal]

const schema = z.object({
  title: z
    .string({ required_error: 'customers.people.detail.deals.titleRequired' })
    .trim()
    .min(1, 'customers.people.detail.deals.titleRequired')
    .max(200, 'customers.people.detail.deals.titleTooLong'),
  status: z
    .string()
    .trim()
    .max(50, 'customers.people.detail.deals.statusTooLong')
    .optional(),
  pipelineStage: z
    .string()
    .trim()
    .max(100, 'customers.people.detail.deals.pipelineTooLong')
    .optional(),
  valueAmount: z
    .preprocess((value) => {
      if (value === '' || value === null || value === undefined) return undefined
      if (typeof value === 'number') return value
      if (typeof value === 'string') {
        const trimmed = value.trim()
        if (!trimmed) return undefined
        const parsed = Number(trimmed)
        if (Number.isNaN(parsed)) return value
        return parsed
      }
      return value
    }, z
      .number()
      .min(0, 'customers.people.detail.deals.valueInvalid')
      .optional())
    .optional(),
  valueCurrency: z
    .string()
    .transform((value) => value.trim().toUpperCase())
    .refine(
      (value) => !value || /^[A-Z]{3}$/.test(value),
      'customers.people.detail.deals.currencyInvalid',
    )
    .optional(),
  probability: z
    .preprocess((value) => {
      if (value === '' || value === null || value === undefined) return undefined
      if (typeof value === 'number') return value
      if (typeof value === 'string') {
        const trimmed = value.trim()
        if (!trimmed) return undefined
        const parsed = Number(trimmed)
        if (Number.isNaN(parsed)) return value
        return parsed
      }
      return value
    }, z
      .number()
      .min(0, 'customers.people.detail.deals.probabilityInvalid')
      .max(100, 'customers.people.detail.deals.probabilityInvalid')
      .optional())
    .optional(),
  expectedCloseAt: z
    .string()
    .transform((value) => value.trim())
    .refine(
      (value) => {
        if (!value) return true
        const parsed = new Date(value)
        return !Number.isNaN(parsed.getTime())
      },
      'customers.people.detail.deals.expectedCloseInvalid',
    )
    .optional(),
  description: z.string().max(4000, 'customers.people.detail.deals.descriptionTooLong').optional(),
})

function toDateInputValue(value: string | null | undefined): string {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  const year = parsed.getUTCFullYear()
  const month = String(parsed.getUTCMonth() + 1).padStart(2, '0')
  const day = String(parsed.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function normalizeCurrency(value: string | null | undefined): string {
  if (!value) return ''
  return value.trim().slice(0, 3).toUpperCase()
}

const BASE_FIELDS: (t: ReturnType<typeof useT>) => CrudField[] = (t) => [
  {
    id: 'title',
    label: t('customers.people.detail.deals.fields.title', 'Title'),
    type: 'text',
    required: true,
  },
  {
    id: 'status',
    label: t('customers.people.detail.deals.fields.status', 'Status'),
    type: 'text',
    layout: 'half',
  },
  {
    id: 'pipelineStage',
    label: t('customers.people.detail.deals.fields.pipelineStage', 'Pipeline stage'),
    type: 'text',
    layout: 'half',
  },
  {
    id: 'valueAmount',
    label: t('customers.people.detail.deals.fields.valueAmount', 'Amount'),
    type: 'number',
    layout: 'half',
  },
  {
    id: 'valueCurrency',
    label: t('customers.people.detail.deals.fields.valueCurrency', 'Currency'),
    type: 'text',
    layout: 'half',
    placeholder: 'USD',
  },
  {
    id: 'probability',
    label: t('customers.people.detail.deals.fields.probability', 'Probability (%)'),
    type: 'number',
    layout: 'half',
  },
  {
    id: 'expectedCloseAt',
    label: t('customers.people.detail.deals.fields.expectedCloseAt', 'Expected close'),
    type: 'date',
    layout: 'half',
  },
  {
    id: 'description',
    label: t('customers.people.detail.deals.fields.description', 'Description'),
    type: 'textarea',
  },
]

export function DealForm({
  mode,
  initialValues,
  onSubmit,
  onCancel,
  submitLabel,
  cancelLabel,
  isSubmitting = false,
}: DealFormProps) {
  const t = useT()
  const [customFields, setCustomFields] = React.useState<CrudField[]>([])
  const [loadingCustomFields, setLoadingCustomFields] = React.useState(false)
  const [pending, setPending] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoadingCustomFields(true)
      try {
        const { fields } = await fetchCustomFieldFormFieldsWithDefinitions(
          DEAL_ENTITY_IDS,
          apiFetch,
        )
        if (cancelled) return
        setCustomFields(fields)
      } catch {
        if (!cancelled) setCustomFields([])
      } finally {
        if (!cancelled) setLoadingCustomFields(false)
      }
    }
    load().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const fields = React.useMemo<CrudField[]>(() => [...BASE_FIELDS(t), ...customFields], [customFields, t])

  const embeddedInitialValues = React.useMemo(() => {
    const normalizeNumber = (value: unknown): number | null => {
      if (typeof value === 'number' && Number.isFinite(value)) return value
      if (typeof value === 'string') {
        const parsed = Number(value)
        return Number.isNaN(parsed) ? null : parsed
      }
      return null
    }

    return {
      title: initialValues?.title ?? '',
      status: initialValues?.status ?? '',
      pipelineStage: initialValues?.pipelineStage ?? '',
      valueAmount: normalizeNumber(initialValues?.valueAmount ?? null),
      valueCurrency: normalizeCurrency(initialValues?.valueCurrency ?? null),
      probability: normalizeNumber(initialValues?.probability ?? null),
      expectedCloseAt: toDateInputValue(initialValues?.expectedCloseAt ?? null),
      description: initialValues?.description ?? '',
      ...Object.fromEntries(
        Object.entries(initialValues ?? {})
          .filter(([key]) => key.startsWith('cf_'))
          .map(([key, value]) => [key, value]),
      ),
    }
  }, [initialValues])

  const handleSubmit = React.useCallback(
    async (values: Record<string, unknown>) => {
      if (pending || isSubmitting) return
      setPending(true)
      try {
        const parsed = schema.safeParse(values)
        if (!parsed.success) {
          const issue = parsed.error.issues[0]
          const message =
            typeof issue?.message === 'string'
              ? issue.message
              : t('customers.people.detail.deals.error', 'Failed to save deal.')
          throw new Error(message)
        }
        const expectedCloseAt =
          parsed.data.expectedCloseAt && parsed.data.expectedCloseAt.length
            ? new Date(parsed.data.expectedCloseAt).toISOString()
            : undefined
        const base: DealFormBaseValues = {
          title: parsed.data.title,
          status: parsed.data.status || undefined,
          pipelineStage: parsed.data.pipelineStage || undefined,
          valueAmount:
            typeof parsed.data.valueAmount === 'number' ? parsed.data.valueAmount : undefined,
          valueCurrency: parsed.data.valueCurrency || undefined,
          probability:
            typeof parsed.data.probability === 'number' ? parsed.data.probability : undefined,
          expectedCloseAt,
          description: parsed.data.description && parsed.data.description.length
            ? parsed.data.description
            : undefined,
        }
        const customEntries: Record<string, unknown> = {}
        Object.entries(values).forEach(([key, value]) => {
          if (key.startsWith('cf_')) {
            customEntries[key.slice(3)] = value
          }
        })
        await onSubmit({ base, custom: customEntries })
      } finally {
        setPending(false)
      }
    },
    [isSubmitting, onSubmit, pending, t],
  )

  return (
    <CrudForm<Record<string, unknown>>
      embedded
      fields={fields}
      initialValues={embeddedInitialValues}
      schema={schema}
      onSubmit={handleSubmit}
      submitLabel={
        submitLabel ??
        (mode === 'edit'
          ? t('customers.people.detail.deals.update', 'Update deal (⌘/Ctrl + Enter)')
          : t('customers.people.detail.deals.save', 'Save deal (⌘/Ctrl + Enter)'))
      }
      extraActions={(
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={pending || isSubmitting}
        >
          {cancelLabel ?? t('customers.people.detail.deals.cancel', 'Cancel')}
        </Button>
      )}
      isLoading={loadingCustomFields}
    />
  )
}

export default DealForm
