'use client'

import * as React from 'react'
import { Save } from 'lucide-react'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const SETTINGS_API = '/api/financial/posting-settings'
const MUTATION_CONTEXT_ID = 'financial.posting-settings'
const RESOURCE_KIND = 'financial.posting_settings'
const RESOURCE_ID = 'posting'

type FieldKey =
  | 'receivableAccountCode'
  | 'revenueAccountCode'
  | 'outputVatAccountCode'
  | 'payableAccountCode'
  | 'inputVatAccountCode'
  | 'cashAccountCode'
  | 'bankAccountCode'

type SettingsResponse = Record<FieldKey, string | null> & {
  canManage: boolean
  updatedAt: string | null
}

type FormState = Record<FieldKey, string>

const EMPTY_FORM: FormState = {
  receivableAccountCode: '',
  revenueAccountCode: '',
  outputVatAccountCode: '',
  payableAccountCode: '',
  inputVatAccountCode: '',
  cashAccountCode: '',
  bankAccountCode: '',
}

const FIELDS: Array<{ key: FieldKey; label: string; fallback: string; hint: string; hintFallback: string }> = [
  {
    key: 'receivableAccountCode',
    label: 'financial.postingSettings.fields.receivable',
    fallback: 'Accounts receivable account',
    hint: 'financial.postingSettings.hints.receivable',
    hintFallback: 'Leave empty to use the first account of type "receivable".',
  },
  {
    key: 'revenueAccountCode',
    label: 'financial.postingSettings.fields.revenue',
    fallback: 'Sales revenue account',
    hint: 'financial.postingSettings.hints.revenue',
    hintFallback: 'Leave empty to use the first account of type "sales".',
  },
  {
    key: 'outputVatAccountCode',
    label: 'financial.postingSettings.fields.outputVat',
    fallback: 'Output VAT account',
    hint: 'financial.postingSettings.hints.outputVat',
    hintFallback: 'Leave empty to use the jurisdiction tax code account, then the first "tax payable" account.',
  },
  {
    key: 'payableAccountCode',
    label: 'financial.postingSettings.fields.payable',
    fallback: 'Accounts payable account',
    hint: 'financial.postingSettings.hints.payable',
    hintFallback: 'Leave empty to use the first account of type "payable".',
  },
  {
    key: 'inputVatAccountCode',
    label: 'financial.postingSettings.fields.inputVat',
    fallback: 'Input VAT account',
    hint: 'financial.postingSettings.hints.inputVat',
    hintFallback: 'Leave empty to use the jurisdiction purchase tax account, then the first "tax receivable" account.',
  },
  {
    key: 'cashAccountCode',
    label: 'financial.postingSettings.fields.cash',
    fallback: 'Cash account',
    hint: 'financial.postingSettings.hints.cash',
    hintFallback: 'Leave empty to use the first account of type "cash".',
  },
  {
    key: 'bankAccountCode',
    label: 'financial.postingSettings.fields.bank',
    fallback: 'Bank account',
    hint: 'financial.postingSettings.hints.bank',
    hintFallback: 'Leave empty to use the first account of type "bank".',
  },
]

function toForm(response: SettingsResponse): FormState {
  return {
    receivableAccountCode: response.receivableAccountCode ?? '',
    revenueAccountCode: response.revenueAccountCode ?? '',
    outputVatAccountCode: response.outputVatAccountCode ?? '',
    payableAccountCode: response.payableAccountCode ?? '',
    inputVatAccountCode: response.inputVatAccountCode ?? '',
    cashAccountCode: response.cashAccountCode ?? '',
    bankAccountCode: response.bankAccountCode ?? '',
  }
}

type MutationContext = {
  formId: string
  resourceKind: string
  resourceId: string
  retryLastMutation: () => Promise<boolean>
}

export default function PostingSettingsPage() {
  const t = useT()
  const { runMutation, retryLastMutation } = useGuardedMutation<MutationContext>({
    contextId: MUTATION_CONTEXT_ID,
    blockedMessage: t('financial.postingSettings.errors.save', 'Unable to save the posting account mapping.'),
  })
  const [form, setForm] = React.useState<FormState>(EMPTY_FORM)
  const [updatedAt, setUpdatedAt] = React.useState<string | null>(null)
  const [canManage, setCanManage] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)
    const call = await apiCall<SettingsResponse>(SETTINGS_API)
    if (!call.ok || !call.result) {
      setLoadError(t('financial.postingSettings.errors.load', 'Could not load the posting account mapping.'))
      setIsLoading(false)
      return
    }
    setForm(toForm(call.result))
    setUpdatedAt(call.result.updatedAt)
    setCanManage(call.result.canManage === true)
    setIsLoading(false)
  }, [t])

  React.useEffect(() => {
    void load()
  }, [load])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!canManage || isSaving) return
    setIsSaving(true)
    const body = Object.fromEntries(
      FIELDS.map((field) => [field.key, form[field.key].trim() || null]),
    ) as Record<FieldKey, string | null>
    try {
      const call = await runMutation({
        operation: () =>
          withScopedApiRequestHeaders(buildOptimisticLockHeader(updatedAt), () =>
            apiCallOrThrow<SettingsResponse>(SETTINGS_API, {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            }),
          ),
        context: {
          formId: MUTATION_CONTEXT_ID,
          resourceKind: RESOURCE_KIND,
          resourceId: RESOURCE_ID,
          retryLastMutation,
        },
        mutationPayload: body,
      })
      if (!call.result) {
        flash(t('financial.postingSettings.errors.save', 'Unable to save the posting account mapping.'), 'error')
        return
      }
      setForm(toForm(call.result))
      setUpdatedAt(call.result.updatedAt)
      setCanManage(call.result.canManage === true)
      flash(t('financial.postingSettings.messages.saved', 'Posting account mapping saved.'), 'success')
    } catch (error) {
      if ((error as { status?: number } | null)?.status === 403) {
        setCanManage(false)
        flash(t('financial.postingSettings.errors.forbidden', 'You do not have permission to change the posting account mapping.'), 'error')
        return
      }
      flash(t('financial.postingSettings.errors.save', 'Unable to save the posting account mapping.'), 'error')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <>
      <PageHeader
        title={t('financial.postingSettings.pageTitle', 'Automatic posting')}
        description={t(
          'financial.postingSettings.pageDescription',
          'Which accounts sales invoices and payments post to. Leave a field empty to resolve it from the chart by account type.',
        )}
      />
      <PageBody>
        {isLoading ? (
          <LoadingMessage label={t('financial.postingSettings.loading', 'Loading posting settings…')} />
        ) : null}
        {!isLoading && loadError ? (
          <ErrorMessage
            label={loadError}
            action={(
              <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
                {t('financial.postingSettings.actions.retry', 'Retry')}
              </Button>
            )}
          />
        ) : null}
        {!isLoading && !loadError ? (
          <form onSubmit={handleSubmit} className="grid max-w-2xl gap-6">
            {!canManage ? (
              <Alert variant="info">
                <AlertTitle>{t('financial.postingSettings.readOnly.title', 'Read-only view')}</AlertTitle>
                <AlertDescription>
                  {t(
                    'financial.postingSettings.readOnly.body',
                    'You can see the posting account mapping but not change it. Ask an administrator for the "financial.admin" permission to edit it.',
                  )}
                </AlertDescription>
              </Alert>
            ) : null}
            <Card>
              <CardHeader>
                <CardTitle>{t('financial.postingSettings.cardTitle', 'Posting accounts')}</CardTitle>
                <CardDescription>
                  {t(
                    'financial.postingSettings.cardDescription',
                    'A sales invoice debits receivables and credits revenue and output VAT. A payment debits cash or bank and credits receivables.',
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                {FIELDS.map((field) => (
                  <div key={field.key} className="grid gap-1.5">
                    <Label htmlFor={field.key}>{t(field.label, field.fallback)}</Label>
                    <Input
                      id={field.key}
                      value={form[field.key]}
                      disabled={!canManage || isSaving}
                      onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))}
                      placeholder={t(`${field.label}Placeholder`, 'Code, e.g. 1100')}
                    />
                    <p className="text-xs text-muted-foreground">{t(field.hint, field.hintFallback)}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
            {canManage ? (
              <div className="flex justify-end">
                <Button type="submit" disabled={isSaving}>
                  {isSaving ? <Spinner size="sm" /> : <Save className="me-2 h-4 w-4" />}
                  {t('financial.postingSettings.actions.save', 'Save')}
                </Button>
              </div>
            ) : null}
          </form>
        ) : null}
      </PageBody>
    </>
  )
}
