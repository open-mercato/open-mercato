"use client"

import * as React from 'react'
import { Save } from 'lucide-react'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const SETTINGS_API = '/api/freight_operations/settings'
const MUTATION_CONTEXT_ID = 'freight-operations.settings'
const RESOURCE_KIND = 'freight_operations.settings'
const RESOURCE_ID = 'settings'

const BILLING_CYCLES = ['monthly', 'biweekly', 'weekly', 'per_abstract', 'on_demand'] as const

type FreightSettingsResponse = {
  defaultRequiresCustomerApproval: boolean
  defaultPaymentTermsDays: number
  defaultBillingCycle: (typeof BILLING_CYCLES)[number]
  defaultVatRate: number
  salesChannelId: string | null
  requirePodForBilling: boolean
  orderNumberPrefix: string
  contractNumberPrefix: string
  tripNumberPrefix: string
  abstractNumberPrefix: string
  updatedAt: string | null
}

type FormState = {
  defaultRequiresCustomerApproval: boolean
  defaultPaymentTermsDays: string
  defaultBillingCycle: (typeof BILLING_CYCLES)[number]
  vatRatePercent: string
  salesChannelId: string
  requirePodForBilling: boolean
  orderNumberPrefix: string
  contractNumberPrefix: string
  tripNumberPrefix: string
  abstractNumberPrefix: string
}

const EMPTY_FORM: FormState = {
  defaultRequiresCustomerApproval: true,
  defaultPaymentTermsDays: '30',
  defaultBillingCycle: 'monthly',
  vatRatePercent: '15',
  salesChannelId: '',
  requirePodForBilling: false,
  orderNumberPrefix: 'FO',
  contractNumberPrefix: 'FC',
  tripNumberPrefix: 'FT',
  abstractNumberPrefix: 'FA',
}

function toFormState(response: FreightSettingsResponse): FormState {
  return {
    defaultRequiresCustomerApproval: response.defaultRequiresCustomerApproval,
    defaultPaymentTermsDays: String(response.defaultPaymentTermsDays),
    defaultBillingCycle: response.defaultBillingCycle,
    vatRatePercent: String(Number((response.defaultVatRate * 100).toFixed(2))),
    salesChannelId: response.salesChannelId ?? '',
    requirePodForBilling: response.requirePodForBilling,
    orderNumberPrefix: response.orderNumberPrefix,
    contractNumberPrefix: response.contractNumberPrefix,
    tripNumberPrefix: response.tripNumberPrefix,
    abstractNumberPrefix: response.abstractNumberPrefix,
  }
}

export default function FreightSettingsForm() {
  const t = useT()
  const [form, setForm] = React.useState<FormState>(EMPTY_FORM)
  const [updatedAt, setUpdatedAt] = React.useState<string | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  const { runMutation, retryLastMutation } = useGuardedMutation<{ formId: string; resourceKind: string; resourceId: string; retryLastMutation: () => Promise<boolean> }>({
    contextId: MUTATION_CONTEXT_ID,
    blockedMessage: t('freight_operations.settings.error.save', 'Unable to save the freight settings.'),
  })

  const load = React.useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)
    const call = await apiCall<FreightSettingsResponse>(SETTINGS_API)
    if (!call.ok || !call.result) {
      setLoadError(t('freight_operations.settings.error.load', 'Unable to load the freight settings.'))
      setIsLoading(false)
      return
    }
    setForm(toFormState(call.result))
    setUpdatedAt(call.result.updatedAt)
    setIsLoading(false)
  }, [t])

  React.useEffect(() => {
    void load()
  }, [load])

  const update = React.useCallback(<TKey extends keyof FormState>(key: TKey, value: FormState[TKey]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }, [])

  const save = React.useCallback(async () => {
    setIsSaving(true)
    try {
      const vatFraction = Number(form.vatRatePercent.trim().replace(',', '.')) / 100
      const payload = {
        defaultRequiresCustomerApproval: form.defaultRequiresCustomerApproval,
        defaultPaymentTermsDays: Number(form.defaultPaymentTermsDays),
        defaultBillingCycle: form.defaultBillingCycle,
        defaultVatRate: Number.isFinite(vatFraction) ? vatFraction : 0.15,
        salesChannelId: form.salesChannelId.trim() || null,
        requirePodForBilling: form.requirePodForBilling,
        orderNumberPrefix: form.orderNumberPrefix.trim() || 'FO',
        contractNumberPrefix: form.contractNumberPrefix.trim() || 'FC',
        tripNumberPrefix: form.tripNumberPrefix.trim() || 'FT',
        abstractNumberPrefix: form.abstractNumberPrefix.trim() || 'FA',
      }
      await runMutation<Awaited<ReturnType<typeof apiCallOrThrow>>>({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(updatedAt),
          () => apiCallOrThrow(SETTINGS_API, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          }, { errorMessage: t('freight_operations.settings.error.save', 'Unable to save the freight settings.') }),
        ),
        mutationPayload: { operation: 'settings.update', ...payload },
        context: { formId: MUTATION_CONTEXT_ID, resourceKind: RESOURCE_KIND, resourceId: RESOURCE_ID, retryLastMutation },
      })
      flash(t('freight_operations.settings.saved', 'Freight settings saved.'), 'success')
      await load()
    } catch (error) {
      flash(error instanceof Error && error.message ? error.message : t('freight_operations.settings.error.save', 'Unable to save the freight settings.'), 'error')
    } finally {
      setIsSaving(false)
    }
  }, [form, load, retryLastMutation, runMutation, t, updatedAt])

  if (isLoading) {
    return <Page><PageBody><LoadingMessage label={t('freight_operations.settings.loading', 'Loading settings…')} /></PageBody></Page>
  }
  if (loadError) {
    return <Page><PageBody><ErrorMessage label={loadError} /></PageBody></Page>
  }

  return (
    <Page>
      <PageBody>
        <PageHeader
          title={t('freight_operations.settings.title', 'Freight settings')}
          description={t('freight_operations.settings.description', 'Defaults applied to new contracts and orders. Issued abstracts keep the values they were generated with.')}
        />
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('freight_operations.settings.sections.approval', 'Customer approval')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <SwitchField
                label={t('freight_operations.settings.fields.defaultRequiresCustomerApproval', 'Trip abstracts require customer approval')}
                description={t('freight_operations.settings.hints.defaultRequiresCustomerApproval', 'New contracts inherit this. When off, staff finalize abstracts internally and invoice directly.')}
                checked={form.defaultRequiresCustomerApproval}
                onCheckedChange={(checked) => update('defaultRequiresCustomerApproval', checked)}
              />
              <SwitchField
                label={t('freight_operations.settings.fields.requirePodForBilling', 'Require a proof of delivery before billing')}
                description={t('freight_operations.settings.hints.requirePodForBilling', 'Delivery recording refuses to complete without a POD reference or document.')}
                checked={form.requirePodForBilling}
                onCheckedChange={(checked) => update('requirePodForBilling', checked)}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('freight_operations.settings.sections.billing', 'Billing defaults')}</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="freight-default-terms">{t('freight_operations.settings.fields.defaultPaymentTermsDays', 'Payment terms (days)')}</Label>
                <Input
                  id="freight-default-terms"
                  type="number"
                  value={form.defaultPaymentTermsDays}
                  onChange={(event) => update('defaultPaymentTermsDays', event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="freight-default-cycle">{t('freight_operations.settings.fields.defaultBillingCycle', 'Billing cycle')}</Label>
                <Select value={form.defaultBillingCycle} onValueChange={(value) => update('defaultBillingCycle', value as FormState['defaultBillingCycle'])}>
                  <SelectTrigger id="freight-default-cycle">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BILLING_CYCLES.map((cycle) => (
                      <SelectItem key={cycle} value={cycle}>
                        {t(`freight_operations.contracts.cycle.${cycle}`, cycle)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="freight-default-vat">{t('freight_operations.settings.fields.defaultVatRate', 'VAT rate (%)')}</Label>
                <Input
                  id="freight-default-vat"
                  inputMode="decimal"
                  value={form.vatRatePercent}
                  onChange={(event) => update('vatRatePercent', event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="freight-sales-channel">{t('freight_operations.settings.fields.salesChannelId', 'Sales channel ID for invoices')}</Label>
                <Input
                  id="freight-sales-channel"
                  value={form.salesChannelId}
                  onChange={(event) => update('salesChannelId', event.target.value)}
                  placeholder={t('freight_operations.settings.hints.salesChannelId', 'Optional. Freight invoices attach to this sales channel.')}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('freight_operations.settings.sections.numbering', 'Document numbering')}</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {([
                ['orderNumberPrefix', 'freight_operations.settings.fields.orderNumberPrefix', 'Order prefix'],
                ['contractNumberPrefix', 'freight_operations.settings.fields.contractNumberPrefix', 'Contract prefix'],
                ['tripNumberPrefix', 'freight_operations.settings.fields.tripNumberPrefix', 'Trip prefix'],
                ['abstractNumberPrefix', 'freight_operations.settings.fields.abstractNumberPrefix', 'Abstract prefix'],
              ] as const).map(([key, labelKey, fallback]) => (
                <div key={key} className="flex flex-col gap-2">
                  <Label htmlFor={`freight-prefix-${key}`}>{t(labelKey, fallback)}</Label>
                  <Input
                    id={`freight-prefix-${key}`}
                    value={form[key]}
                    onChange={(event) => update(key, event.target.value)}
                    maxLength={8}
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button onClick={() => { void save() }} disabled={isSaving}>
              {isSaving ? <Spinner className="me-2 size-4" /> : <Save className="me-2 size-4" />}
              {t('freight_operations.settings.save', 'Save settings')}
            </Button>
          </div>
        </div>
      </PageBody>
    </Page>
  )
}
