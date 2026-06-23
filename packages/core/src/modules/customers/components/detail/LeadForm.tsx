"use client"

import * as React from 'react'
import { z } from 'zod'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { E } from '#generated/entities.ids.generated'

export type LeadFormBaseValues = {
  title: string
  description?: string | null
  source?: string | null
  estimatedValueAmount?: number | null
  estimatedValueCurrency?: string | null
  status?: string | null
  companyName?: string | null
  companyVatId?: string | null
  contactFirstName?: string | null
  contactLastName?: string | null
  contactPhone?: string | null
  contactEmail?: string | null
}

export type LeadFormSubmitPayload = {
  base: LeadFormBaseValues
  custom: Record<string, unknown>
}

export type LeadFormProps = {
  mode: 'create' | 'edit'
  initialValues?: Partial<LeadFormBaseValues & Record<string, unknown>>
  onSubmit: (payload: LeadFormSubmitPayload) => Promise<void>
  onCancel: () => void
  onDelete?: () => Promise<void> | void
  submitLabel?: string
  cancelLabel?: string
  isSubmitting?: boolean
  embedded?: boolean
  title?: string
  backHref?: string
  isConverted?: boolean
}

const LEAD_ENTITY_IDS = [E.customers.customer_lead]

const LEAD_STATUSES = ['open', 'in_progress', 'rejected'] as const

const schema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'customers.leads.form.titleRequired')
    .max(200, 'customers.leads.form.titleTooLong'),
  description: z.string().max(4000, 'customers.leads.form.descriptionTooLong').optional(),
  source: z.string().max(150, 'customers.leads.form.sourceTooLong').optional(),
  estimatedValueAmount: z
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
    }, z.number().min(0, 'customers.leads.form.valueInvalid').optional())
    .optional(),
  estimatedValueCurrency: z
    .string()
    .transform((value) => value.trim().toUpperCase())
    .refine((value) => !value || /^[A-Z]{3}$/.test(value), 'customers.leads.form.currencyInvalid')
    .optional(),
  status: z
    .string()
    .refine((val) => val !== 'qualified', 'customers.leads.form.status.qualifiedNotAllowed')
    .optional(),
  companyName: z.string().max(200, 'customers.leads.form.companyNameTooLong').optional(),
  companyVatId: z.string().max(50, 'customers.leads.form.companyVatIdTooLong').optional(),
  contactFirstName: z.string().max(120, 'customers.leads.form.contactFirstNameTooLong').optional(),
  contactLastName: z.string().max(120, 'customers.leads.form.contactLastNameTooLong').optional(),
  contactPhone: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().max(50, 'customers.leads.form.contactPhoneTooLong').optional(),
  ),
  contactEmail: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z
      .string()
      .trim()
      .email('customers.leads.form.contactEmailInvalid')
      .max(320, 'customers.leads.form.contactEmailTooLong')
      .optional(),
  ),
}).passthrough()

function normalizeCurrency(value: string | null | undefined): string {
  if (!value) return ''
  return value.trim().slice(0, 3).toUpperCase()
}

export function LeadForm({
  mode,
  initialValues,
  onSubmit,
  onCancel,
  onDelete,
  submitLabel,
  cancelLabel,
  isSubmitting,
  embedded,
  title,
  backHref,
  isConverted,
}: LeadFormProps) {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()

  const fields: CrudField[] = React.useMemo(
    () => [
      {
        id: 'title',
        label: t('customers.leads.detail.fields.title', 'Title'),
        type: 'text',
        required: true,
        layout: 'full',
        placeholder: t('customers.leads.form.titlePlaceholder', 'Enter lead title'),
      },
      {
        id: 'description',
        label: t('customers.leads.detail.fields.description', 'Description'),
        type: 'textarea',
        layout: 'full',
        placeholder: t('customers.leads.form.descriptionPlaceholder', 'Add a description…'),
      },
      {
        id: 'status',
        label: t('customers.leads.detail.fields.status', 'Status'),
        type: 'select',
        layout: 'half',
        disabled: isConverted === true,
        options: LEAD_STATUSES.map((status) => ({
          value: status,
          label: t(`customers.leads.status.${status}`, status),
        })),
      },
      {
        id: 'source',
        label: t('customers.leads.detail.fields.source', 'Source'),
        type: 'text',
        layout: 'half',
        placeholder: t('customers.leads.form.sourcePlaceholder', 'e.g. Website, Referral'),
      },
      {
        id: 'estimatedValueAmount',
        label: t('customers.leads.detail.fields.estimatedValue', 'Estimated value'),
        type: 'number',
        layout: 'half',
        placeholder: t('customers.leads.form.valuePlaceholder', '0.00'),
      },
      {
        id: 'estimatedValueCurrency',
        label: t('customers.leads.form.currency', 'Currency'),
        type: 'text',
        layout: 'half',
        placeholder: 'EUR',
        suggestions: ['EUR', 'USD', 'GBP', 'PLN'],
      },
      {
        id: 'companyName',
        label: t('customers.leads.detail.fields.companyName', 'Company name'),
        type: 'text',
        layout: 'half',
        placeholder: t('customers.leads.form.companyNamePlaceholder', 'Acme Inc.'),
      },
      {
        id: 'companyVatId',
        label: t('customers.leads.detail.fields.companyVatId', 'VAT ID'),
        type: 'text',
        layout: 'half',
        placeholder: t('customers.leads.form.companyVatIdPlaceholder', 'EU123456789'),
      },
      {
        id: 'contactFirstName',
        label: t('customers.leads.detail.fields.contactFirstName', 'First name'),
        type: 'text',
        layout: 'half',
        placeholder: t('customers.leads.form.contactFirstNamePlaceholder', 'Jane'),
      },
      {
        id: 'contactLastName',
        label: t('customers.leads.detail.fields.contactLastName', 'Last name'),
        type: 'text',
        layout: 'half',
        placeholder: t('customers.leads.form.contactLastNamePlaceholder', 'Doe'),
      },
      {
        id: 'contactPhone',
        label: t('customers.leads.detail.fields.contactPhone', 'Contact phone'),
        type: 'text',
        layout: 'half',
        placeholder: t('customers.leads.form.contactPhonePlaceholder', '+1 555 000 0000'),
      },
      {
        id: 'contactEmail',
        label: t('customers.leads.detail.fields.contactEmail', 'Contact email'),
        type: 'text',
        layout: 'half',
        placeholder: t('customers.leads.form.contactEmailPlaceholder', 'jane@acme.com'),
      },
    ],
    [t, isConverted],
  )

  const groups: CrudFormGroup[] = React.useMemo(
    () => [
      {
        id: 'basics',
        title: t('customers.leads.form.group.basics', 'Lead details'),
        column: 1,
        fields: ['title', 'status', 'source', 'estimatedValueAmount', 'estimatedValueCurrency'],
      },
      {
        id: 'company',
        title: t('customers.leads.form.group.company', 'Potential company'),
        column: 1,
        fields: ['companyName', 'companyVatId'],
      },
      {
        id: 'contact',
        title: t('customers.leads.form.group.contact', 'Potential contact'),
        column: 1,
        fields: ['contactFirstName', 'contactLastName', 'contactPhone', 'contactEmail'],
      },
      {
        id: 'notes',
        title: t('customers.leads.form.group.notes', 'Notes'),
        column: 2,
        fields: ['description'],
      },
      {
        id: 'customFields',
        title: t('customers.leads.form.group.custom', 'Custom fields'),
        column: 2,
        kind: 'customFields',
      },
    ],
    [t],
  )

  const normalizedInitialValues = React.useMemo(() => {
    const values: Record<string, unknown> = {
      title: '',
      description: '',
      source: '',
      status: 'open',
      estimatedValueAmount: '',
      estimatedValueCurrency: '',
      companyName: '',
      companyVatId: '',
      contactFirstName: '',
      contactLastName: '',
      contactPhone: '',
      contactEmail: '',
      ...initialValues,
    }
    if (typeof values.estimatedValueCurrency === 'string') {
      values.estimatedValueCurrency = normalizeCurrency(values.estimatedValueCurrency)
    }
    return values
  }, [initialValues])

  const handleSubmit = React.useCallback(
    async (values: Record<string, unknown>) => {
      const base: LeadFormBaseValues = {
        title: typeof values.title === 'string' ? values.title.trim() : '',
        description: typeof values.description === 'string' ? values.description.trim() : undefined,
        source: typeof values.source === 'string' ? values.source.trim() : undefined,
        estimatedValueAmount:
          typeof values.estimatedValueAmount === 'number'
            ? values.estimatedValueAmount
            : typeof values.estimatedValueAmount === 'string' && values.estimatedValueAmount.trim()
              ? Number(values.estimatedValueAmount)
              : undefined,
        estimatedValueCurrency:
          typeof values.estimatedValueCurrency === 'string' && values.estimatedValueCurrency.trim()
            ? normalizeCurrency(values.estimatedValueCurrency)
            : undefined,
        status: typeof values.status === 'string' && values.status ? values.status : undefined,
        companyName: typeof values.companyName === 'string' ? values.companyName.trim() : undefined,
        companyVatId: typeof values.companyVatId === 'string' ? values.companyVatId.trim() : undefined,
        contactFirstName: typeof values.contactFirstName === 'string' ? values.contactFirstName.trim() : undefined,
        contactLastName: typeof values.contactLastName === 'string' ? values.contactLastName.trim() : undefined,
        contactPhone: typeof values.contactPhone === 'string' ? values.contactPhone.trim() : undefined,
        contactEmail: typeof values.contactEmail === 'string' ? values.contactEmail.trim() : undefined,
      }
      const custom: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(values)) {
        if (key.startsWith('cf_')) {
          custom[key.slice(3)] = value
        }
      }
      await onSubmit({ base, custom })
    },
    [onSubmit],
  )

  return (
    <CrudForm
      schema={schema}
      fields={fields}
      groups={groups}
      initialValues={normalizedInitialValues}
      onSubmit={handleSubmit}
      onDelete={onDelete}
      submitLabel={submitLabel ?? t('customers.leads.form.submit', 'Save lead')}
      cancelHref={backHref ?? '/backend/customers/leads'}
      successRedirect={mode === 'create' ? '/backend/customers/leads' : undefined}
      deleteRedirect="/backend/customers/leads"
      title={title}
      backHref={backHref ?? '/backend/customers/leads'}
      embedded={embedded}
      entityId={E.customers.customer_lead}
      entityIds={LEAD_ENTITY_IDS}
      readOnly={isConverted === true}
      deleteVisible={mode === 'edit'}
    />
  )
}