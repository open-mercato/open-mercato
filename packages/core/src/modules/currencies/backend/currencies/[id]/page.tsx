'use client'

import * as React from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@/lib/i18n/context'
import { DataLoader } from '@open-mercato/ui/primitives/DataLoader'

type CurrencyData = {
  id: string
  code: string
  name: string
  symbol: string | null
  decimalPlaces: number
  thousandsSeparator: string | null
  decimalSeparator: string | null
  isBase: boolean
  isActive: boolean
  organizationId: string
  tenantId: string
}

export default function EditCurrencyPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const router = useRouter()

  const [currency, setCurrency] = React.useState<CurrencyData | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    async function loadCurrency() {
      try {
        const response = await apiCall<{ items: CurrencyData[] }>(`/api/currencies/currencies?id=${params?.id}`)
        if (response.ok && response.result && response.result.items.length > 0) {
          setCurrency(response.result.items[0])
        } else {
          setError(t('currencies.form.errors.notFound'))
        }
      } catch (err) {
        setError(t('currencies.form.errors.load'))
      } finally {
        setLoading(false)
      }
    }
    loadCurrency()
  }, [params, t])

  const groups = React.useMemo<CrudFormGroup[]>(
    () => [
      {
        id: 'basic',
        column: 1,
        title: t('currencies.form.group.details'),
        fields: [
          {
            id: 'code',
            type: 'text',
            label: t('currencies.form.field.code'),
            placeholder: t('currencies.form.field.codePlaceholder'),
            required: true,
            maxLength: 3,
            helpText: t('currencies.form.field.codeHelp'),
          },
          {
            id: 'name',
            type: 'text',
            label: t('currencies.form.field.name'),
            placeholder: t('currencies.form.field.namePlaceholder'),
            required: true,
          },
          {
            id: 'symbol',
            type: 'text',
            label: t('currencies.form.field.symbol'),
            placeholder: t('currencies.form.field.symbolPlaceholder'),
          },
        ],
      },
      {
        id: 'formatting',
        column: 2,
        title: t('currencies.form.group.formatting'),
        fields: [
          {
            id: 'decimalPlaces',
            type: 'number',
            label: t('currencies.form.field.decimalPlaces'),
            min: 0,
            max: 8,
          },
          {
            id: 'thousandsSeparator',
            type: 'text',
            label: t('currencies.form.field.thousandsSeparator'),
            placeholder: ',',
            maxLength: 5,
          },
          {
            id: 'decimalSeparator',
            type: 'text',
            label: t('currencies.form.field.decimalSeparator'),
            placeholder: '.',
            maxLength: 5,
          },
          {
            id: 'isBase',
            type: 'checkbox',
            label: t('currencies.form.field.isBase'),
          },
          {
            id: 'isActive',
            type: 'checkbox',
            label: t('currencies.form.field.isActive'),
          },
        ],
      },
    ],
    [t]
  )

  const handleDelete = React.useCallback(async () => {
    if (!currency) return
    
    if (!confirm(t('currencies.list.confirmDelete', { code: currency.code }))) {
      return
    }

    try {
      await apiCall('/api/currencies/currencies', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: currency.id, organizationId: currency.organizationId, tenantId: currency.tenantId }),
      })

      flash(t('currencies.flash.deleted'), 'success')
      router.push('/backend/currencies')
    } catch (error) {
      flash(t('currencies.flash.deleteError'), 'error')
    }
  }, [currency, t, router])

  if (loading) {
    return (
      <Page>
        <PageBody>
          <div className="flex items-center justify-center p-8">
            <div className="text-muted-foreground">{t('currencies.form.loading')}</div>
          </div>
        </PageBody>
      </Page>
    )
  }

  if (error || !currency) {
    return (
      <Page>
        <PageBody>
          <div className="text-destructive">{error || t('currencies.form.errors.notFound')}</div>
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <CrudForm
          title={t('currencies.edit.title')}
          backHref="/backend/currencies"
          fields={[]}
          groups={groups}
          initialValues={{
            code: currency.code,
            name: currency.name,
            symbol: currency.symbol || '',
            decimalPlaces: currency.decimalPlaces,
            thousandsSeparator: currency.thousandsSeparator || '',
            decimalSeparator: currency.decimalSeparator || '',
            isBase: currency.isBase,
            isActive: currency.isActive,
          }}
          submitLabel={t('currencies.form.action.save')}
          cancelHref="/backend/currencies"
          onSubmit={async (values) => {
            // Validate currency code
            const code = String(values.code || '').trim().toUpperCase()
            if (!/^[A-Z]{3}$/.test(code)) {
              throw createCrudFormError(t('currencies.form.errors.codeFormat'), {
                code: t('currencies.form.errors.codeFormat'),
              })
            }

            const payload = {
              id: currency.id,
              code,
              name: String(values.name || '').trim(),
              symbol: values.symbol ? String(values.symbol).trim() : null,
              decimalPlaces: values.decimalPlaces ? parseInt(String(values.decimalPlaces)) : 2,
              thousandsSeparator: values.thousandsSeparator ? String(values.thousandsSeparator) : null,
              decimalSeparator: values.decimalSeparator ? String(values.decimalSeparator) : null,
              isBase: !!values.isBase,
              isActive: values.isActive !== false,
            }

            await updateCrud('currencies/currencies', payload)

            flash(t('currencies.flash.updated'), 'success')
            router.push('/backend/currencies')
          }}
        />
      </PageBody>
    </Page>
  )
}
