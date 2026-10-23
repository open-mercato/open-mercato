"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Save, ShieldAlert } from 'lucide-react'

type SettingsData = {
  approvalThresholdAmount: string
  approvalThresholdCurrency: string
  doubleValidationEnabled: boolean
  defaultControlPolicy: 'on_received' | 'on_ordered'
  autoCreateReceiptOnConfirm: boolean
}

export default function PurchasesConfigPage() {
  const t = useT()
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)

  const [thresholdAmount, setThresholdAmount] = React.useState('10000.0000')
  const [thresholdCurrency, setThresholdCurrency] = React.useState('PLN')
  const [doubleValidation, setDoubleValidation] = React.useState(true)
  const [controlPolicy, setControlPolicy] = React.useState<'on_received' | 'on_ordered'>('on_received')
  const [autoReceipt, setAutoReceipt] = React.useState(true)

  React.useEffect(() => {
    async function load() {
      try {
        const call = await apiCall<SettingsData>('/api/purchases/settings')
        if (call.ok && call.result) {
          const data = call.result
          setThresholdAmount(String(data.approvalThresholdAmount))
          setThresholdCurrency(data.approvalThresholdCurrency || 'PLN')
          setDoubleValidation(data.doubleValidationEnabled)
          setControlPolicy(data.defaultControlPolicy || 'on_received')
          setAutoReceipt(data.autoCreateReceiptOnConfirm)
        }
      } catch (err: unknown) {
        flash((err as Error).message, 'error')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const call = await apiCall<{ error?: string }>('/api/purchases/settings', {
        method: 'PUT',
        body: JSON.stringify({
          approvalThresholdAmount: Number(thresholdAmount),
          approvalThresholdCurrency: thresholdCurrency,
          doubleValidationEnabled: doubleValidation,
          defaultControlPolicy: controlPolicy,
          autoCreateReceiptOnConfirm: autoReceipt,
        }),
      })
      if (!call.ok) {
        throw new Error(call.result?.error || 'Failed to save settings')
      }
      flash(t('purchases.settings.saved_success', 'Procurement settings saved successfully'), 'success')
    } catch (err: unknown) {
      flash((err as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Page>
        <PageBody>
          <div className="flex h-48 items-center justify-center text-muted-foreground">
            {t('common.loading', 'Loading settings...')}
          </div>
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">
            {t('purchases.settings.title', 'Procurement & Purchasing Configuration')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('purchases.settings.subtitle', 'Configure managerial double authorization, default control policies, and billing limits.')}
          </p>
        </div>

        <form onSubmit={handleSave} className="max-w-2xl space-y-6 rounded-lg border bg-card p-6 shadow-sm">
          {/* Manager Approval / Double Authorization */}
          <div className="space-y-4 border-b pb-6">
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 h-5 w-5 text-primary" />
              <div>
                <h2 className="text-base font-semibold">
                  {t('purchases.settings.approval_title', 'Purchase Order Double Authorization')}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {t(
                    'purchases.settings.approval_desc',
                    'When enabled, purchase orders with total gross exceeding the threshold pause in "To Approve" state for manager validation.'
                  )}
                </p>
              </div>
            </div>

            <div className="ml-8 space-y-4 pt-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={doubleValidation}
                  onChange={(e) => setDoubleValidation(e.target.checked)}
                  className="rounded border-input text-primary focus:ring-primary"
                />
                <span className="text-sm font-medium">
                  {t('purchases.settings.enable_double_validation', 'Require Manager Approval for High-Value POs')}
                </span>
              </label>

              {doubleValidation && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">
                      {t('purchases.settings.threshold_amount', 'Approval Threshold Limit')}
                    </label>
                    <Input
                      type="number"
                      step="any"
                      min="0"
                      value={thresholdAmount}
                      onChange={(e) => setThresholdAmount(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">
                      {t('purchases.settings.threshold_currency', 'Currency')}
                    </label>
                    <Input
                      value={thresholdCurrency}
                      onChange={(e) => setThresholdCurrency(e.target.value.toUpperCase())}
                      maxLength={3}
                      required
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Invoicing Control Policy */}
          <div className="space-y-4 border-b pb-6">
            <h2 className="text-base font-semibold">
              {t('purchases.settings.policy_title', 'Default Billing Control Policy')}
            </h2>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="controlPolicy"
                  value="on_received"
                  checked={controlPolicy === 'on_received'}
                  onChange={() => setControlPolicy('on_received')}
                />
                <div>
                  <span className="text-sm font-medium">On Received Quantities (Default)</span>
                  <p className="text-xs text-muted-foreground">
                    Vendor bills can only be issued for items that have been physically checked in by the warehouse.
                  </p>
                </div>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="controlPolicy"
                  value="on_ordered"
                  checked={controlPolicy === 'on_ordered'}
                  onChange={() => setControlPolicy('on_ordered')}
                />
                <div>
                  <span className="text-sm font-medium">On Ordered Quantities</span>
                  <p className="text-xs text-muted-foreground">
                    Vendor bills can be issued as soon as the PO is confirmed (e.g. for pre-paid services or advance payments).
                  </p>
                </div>
              </label>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button type="submit" disabled={saving} className="gap-2">
              <Save className="h-4 w-4" />
              {t('common.save_changes', 'Save Configuration')}
            </Button>
          </div>
        </form>
      </PageBody>
    </Page>
  )
}
