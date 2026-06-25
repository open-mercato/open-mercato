'use client'

import * as React from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader, extractOptimisticLockConflict } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { SendObjectMessageDialog } from '@open-mercato/ui/backend/messages'
import { DataLoader } from '@open-mercato/ui/primitives/DataLoader'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { RecordNotFoundState, ErrorMessage } from '@open-mercato/ui/backend/detail'

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
  updatedAt?: string | null
  updated_at?: string | null
}

export default function EditCurrencyPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const router = useRouter()
  const { confirm: confirmDialog, ConfirmDialogElement } = useConfirmDialog()
  const mutationContextId = 'currencies-edit:delete'
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: mutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const [currency, setCurrency] = React.useState<CurrencyData | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)

  React.useEffect(() => {
    async function loadCurrency() {
      try {
        const response = await apiCall<{ items: CurrencyData[] }>(`/api/currencies/currencies?id=${params?.id}`)
        if (response.ok && response.result && response.result.items.length > 0) {
          setCurrency(response.result.items[0])
        } else if (!response.ok) {
          setError(t('currencies.form.errors.load'))
        } else {
          setIsNotFound(true)
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

    const confirmed = await confirmDialog({
      title: t('currencies.list.confirmDelete', { code: currency.code }),
      variant: 'destructive',
    })
    if (!confirmed) return

    try {
      await runMutation({
        operation: async () => {
          const headers = buildOptimisticLockHeader(currency.updatedAt ?? currency.updated_at ?? null)
          const call = await withScopedApiRequestHeaders(headers, () => (
            apiCall('/api/currencies/currencies', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: currency.id, organizationId: currency.organizationId, tenantId: currency.tenantId }),
            })
          ))
          if (!call.ok) {
            throw Object.assign(new Error('[internal] currencies.delete failed'), {
              status: call.status,
              ...((call.result as Record<string, unknown> | null) ?? {}),
            })
          }
          return call
        },
        context: {
          formId: mutationContextId,
          resourceKind: 'currencies.currency',
          resourceId: currency.id,
          retryLastMutation,
        },
        mutationPayload: { id: currency.id },
      })

      flash(t('currencies.flash.deleted'), 'success')
      router.push('/backend/currencies')
    } catch (error) {
      if (extractOptimisticLockConflict(error)) return
      flash(t('currencies.flash.deleteError'), 'error')
    }
  }, [currency, t, router, confirmDialog, mutationContextId, retryLastMutation, runMutation])

  if (loading) {
    return (
      <Page>
        <PageBody>
          <div className="flex items-center justify-center p-8">
            <div className="text-muted-foreground">{t('currencies.form.loading')}</div>
          </div>
        </PageBody>
        {ConfirmDialogElement}
      </Page>
    )
  }

  if (isNotFound) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('currencies.form.errors.notFound', 'Currency not found.')}
            backHref="/backend/currencies"
            backLabel={t('currencies.form.actions.backToList', 'Back to currencies')}
          />
        </PageBody>
        {ConfirmDialogElement}
      </Page>
    )
  }

  if (error || !currency) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error ?? t('currencies.form.errors.notFound', 'Currency not found.')} />
        </PageBody>
        {ConfirmDialogElement}
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <CrudForm
          title={t('currencies.edit.title')}
          backHref="/backend/currencies"
          versionHistory={{ resourceKind: 'currencies.currency', resourceId: currency.id }}
          extraActions={(
            <SendObjectMessageDialog
              object={{
                entityModule: 'currencies',
                entityType: 'currency',
                entityId: currency.id,
                previewData: {
                  title: currency.name,
                  subtitle: currency.code,
                  metadata: {
                    [t('currencies.form.field.code')]: currency.code,
                    [t('currencies.form.field.name')]: currency.name,
                    [t('currencies.form.field.symbol')]: currency.symbol || '-',
                  },
                },
              }}
              viewHref={`/backend/currencies/${currency.id}`}
            />
          )}
          fields={[]}
          groups={groups}
          optimisticLockUpdatedAt={currency.updatedAt ?? currency.updated_at ?? null}
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
      {ConfirmDialogElement}
    </Page>
  )
}
