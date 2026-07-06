"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { commodityOptions, statementStatusOptions } from '../../../../components/formConfig'

type StatementFormValues = {
  title: string
  commodity: string
  referenceNumber: string
  verificationNumber: string
  status: string
  quantityKg: string
  orderId: string
  notes: string
} & Record<string, unknown>

function optionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function optionalNumber(value: unknown, translate: ReturnType<typeof useT>): number | null {
  const text = optionalText(value)
  if (!text) return null
  const parsedNumber = Number(text)
  if (!Number.isFinite(parsedNumber)) {
    const message = translate('eudr.statements.form.quantityKgInvalid')
    throw createCrudFormError(message, { quantityKg: message })
  }
  return parsedNumber
}

export default function CreateEudrStatementPage() {
  const translate = useT()
  const router = useRouter()

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'title',
      label: translate('eudr.statements.form.title'),
      type: 'text',
      required: true,
    },
    {
      id: 'commodity',
      label: translate('eudr.statements.form.commodity'),
      type: 'select',
      required: true,
      options: commodityOptions(translate),
    },
    {
      id: 'referenceNumber',
      label: translate('eudr.statements.form.referenceNumber'),
      type: 'text',
    },
    {
      id: 'verificationNumber',
      label: translate('eudr.statements.form.verificationNumber'),
      type: 'text',
    },
    {
      id: 'status',
      label: translate('eudr.statements.form.status'),
      type: 'select',
      options: statementStatusOptions(translate),
    },
    {
      id: 'quantityKg',
      label: translate('eudr.statements.form.quantityKg'),
      type: 'text',
    },
    {
      id: 'orderId',
      label: translate('eudr.statements.form.orderId'),
      type: 'text',
      description: translate('eudr.form.orderIdHint'),
    },
    {
      id: 'notes',
      label: translate('eudr.statements.form.notes'),
      type: 'textarea',
    },
  ], [translate])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'details',
      title: translate('eudr.statements.form.details'),
      column: 1,
      fields: ['title', 'commodity', 'status', 'referenceNumber', 'verificationNumber', 'quantityKg', 'orderId', 'notes'],
    },
  ], [translate])

  return (
    <Page>
      <PageBody>
        <CrudForm<StatementFormValues>
          title={translate('eudr.statements.create.title')}
          backHref="/backend/eudr/statements"
          cancelHref="/backend/eudr/statements"
          submitLabel={translate('eudr.statements.form.submitCreate')}
          fields={fields}
          groups={groups}
          initialValues={{
            title: '',
            commodity: '',
            referenceNumber: '',
            verificationNumber: '',
            status: 'draft',
            quantityKg: '',
            orderId: '',
            notes: '',
          }}
          onSubmit={async (values) => {
            const title = optionalText(values.title)
            if (!title) {
              const message = translate('eudr.statements.form.titleRequired')
              throw createCrudFormError(message, { title: message })
            }
            const commodity = optionalText(values.commodity)
            if (!commodity) {
              const message = translate('eudr.statements.form.commodityRequired')
              throw createCrudFormError(message, { commodity: message })
            }
            await createCrud('eudr/statements', {
              title,
              commodity,
              referenceNumber: optionalText(values.referenceNumber),
              verificationNumber: optionalText(values.verificationNumber),
              status: optionalText(values.status) ?? 'draft',
              quantityKg: optionalNumber(values.quantityKg, translate),
              orderId: optionalText(values.orderId),
              notes: optionalText(values.notes),
            }, {
              errorMessage: translate('eudr.statements.form.createError'),
            })
            flash(translate('eudr.statements.form.createSuccess'), 'success')
            router.push('/backend/eudr/statements')
          }}
        />
      </PageBody>
    </Page>
  )
}
