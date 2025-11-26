"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { useT } from '@/lib/i18n/context'

import { Badge } from '@open-mercato/ui/primitives/badge'

type OrderStatusOption = {
  id: string
  value: string
  label: string
}

type SettingsResponse = {
  orderCustomerEditableStatuses: string[] | null
  orderAddressEditableStatuses: string[] | null
  orderStatuses: OrderStatusOption[]
}

const normalizeStatusList = (list: unknown): string[] | null => {
  if (list === null) return null
  if (!Array.isArray(list)) return []
  const set = new Set<string>()
  list.forEach((value) => {
    if (typeof value === 'string' && value.trim().length) {
      set.add(value.trim())
    }
  })
  return Array.from(set)
}

export function OrderEditingSettings() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [options, setOptions] = React.useState<OrderStatusOption[]>([])
  const [customerStatuses, setCustomerStatuses] = React.useState<string[] | null>(null)
  const [addressStatuses, setAddressStatuses] = React.useState<string[] | null>(null)

  const translations = React.useMemo(
    () => ({
      title: t('sales.config.orderEditing.title', 'Order editing guards'),
      description: t(
        'sales.config.orderEditing.description',
        'Control when customers and addresses can be changed on an order.'
      ),
      customerLabel: t('sales.config.orderEditing.customerLabel', 'Edit customer allowed at'),
      addressLabel: t('sales.config.orderEditing.addressLabel', 'Edit addresses allowed at'),
      allowAny: t('sales.config.orderEditing.allowAny', 'Allow at any status'),
      note: t(
        'sales.config.orderEditing.note',
        'Changing the customer clears assigned addresses to avoid mixing contact data.'
      ),
      actions: {
        refresh: t('sales.config.orderEditing.actions.refresh', 'Refresh'),
        save: t('sales.config.orderEditing.actions.save', 'Save settings'),
      },
      messages: {
        loadError: t('sales.config.orderEditing.errors.load', 'Failed to load order editing settings.'),
        saveError: t('sales.config.orderEditing.errors.save', 'Failed to save order editing settings.'),
        saved: t('sales.config.orderEditing.success.save', 'Order editing settings saved.'),
      },
    }),
    [t]
  )

  const loadSettings = React.useCallback(async () => {
    setLoading(true)
    try {
      const call = await apiCall<SettingsResponse>('/api/sales/settings/order-editing')
      if (!call.ok) {
        flash(translations.messages.loadError, 'error')
        return
      }
      setOptions(Array.isArray(call.result?.orderStatuses) ? call.result.orderStatuses : [])
      setCustomerStatuses(normalizeStatusList(call.result?.orderCustomerEditableStatuses))
      setAddressStatuses(normalizeStatusList(call.result?.orderAddressEditableStatuses))
    } catch (err) {
      console.error('sales.order-editing-settings.load failed', err)
      flash(translations.messages.loadError, 'error')
    } finally {
      setLoading(false)
    }
  }, [translations.messages.loadError])

  React.useEffect(() => {
    void loadSettings()
  }, [loadSettings, scopeVersion])

  const toggleAny = React.useCallback((kind: 'customer' | 'address') => {
    if (kind === 'customer') {
      setCustomerStatuses((prev) => (prev === null ? [] : null))
    } else {
      setAddressStatuses((prev) => (prev === null ? [] : null))
    }
  }, [])

  const toggleStatus = React.useCallback((kind: 'customer' | 'address', value: string) => {
    const updater = kind === 'customer' ? setCustomerStatuses : setAddressStatuses
    updater((prev) => {
      const current = prev ?? []
      if (current.includes(value)) {
        return current.filter((entry) => entry !== value)
      }
      return [...current, value]
    })
  }, [])

  const handleSubmit = React.useCallback(async () => {
    setSaving(true)
    try {
      const payload = {
        orderCustomerEditableStatuses: customerStatuses,
        orderAddressEditableStatuses: addressStatuses,
      }
      const call = await apiCall<SettingsResponse>('/api/sales/settings/order-editing', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!call.ok) {
        flash(translations.messages.saveError, 'error')
        return
      }
      setCustomerStatuses(normalizeStatusList(call.result?.orderCustomerEditableStatuses))
      setAddressStatuses(normalizeStatusList(call.result?.orderAddressEditableStatuses))
      setOptions(Array.isArray(call.result?.orderStatuses) ? call.result.orderStatuses : [])
      flash(translations.messages.saved, 'success')
    } catch (err) {
      console.error('sales.order-editing-settings.save failed', err)
      flash(translations.messages.saveError, 'error')
    } finally {
      setSaving(false)
    }
  }, [addressStatuses, customerStatuses, translations.messages.saveError, translations.messages.saved])

  const renderStatusList = React.useCallback(
    (kind: 'customer' | 'address', values: string[] | null, label: string) => {
      const allowedAny = values === null
      return (
        <div className="space-y-3 rounded-lg border bg-card/30 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="space-y-1">
              <p className="text-sm font-medium">{label}</p>
              <p className="text-xs text-muted-foreground">
                {allowedAny
                  ? t('sales.config.orderEditing.anyStatus', 'Allowed at any status')
                  : t('sales.config.orderEditing.pickStatuses', 'Select statuses that allow this change')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={allowedAny} onCheckedChange={() => toggleAny(kind)} disabled={loading || saving} />
              <span className="text-xs text-muted-foreground">{translations.allowAny}</span>
            </div>
          </div>
          {!allowedAny && (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {options.map((status) => {
                const checked = values?.includes(status.value) ?? false
                return (
                  <label key={status.id} className="flex items-center gap-2 rounded-md border bg-background p-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border"
                      checked={checked}
                      onChange={() => toggleStatus(kind, status.value)}
                      disabled={loading || saving}
                    />
                    <span className="truncate" title={status.label || status.value}>
                      {status.label || status.value}
                    </span>
                    <Badge variant="outline" className="ml-auto text-[11px] uppercase tracking-wide">
                      {status.value}
                    </Badge>
                  </label>
                )
              })}
            </div>
          )}
        </div>
      )
    },
    [loading, options, saving, t, toggleAny, toggleStatus, translations.allowAny]
  )

  return (
    <section className="space-y-4 rounded-lg border bg-card/30 p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{translations.title}</h2>
          <p className="text-sm text-muted-foreground">{translations.description}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" type="button" onClick={() => void loadSettings()} disabled={loading || saving}>
            {translations.actions.refresh}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{translations.note}</p>
      <div className="space-y-3">
        {renderStatusList('customer', customerStatuses, translations.customerLabel)}
        {renderStatusList('address', addressStatuses, translations.addressLabel)}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => void loadSettings()} disabled={loading || saving}>
          {translations.actions.refresh}
        </Button>
        <Button type="button" onClick={() => void handleSubmit()} disabled={loading || saving}>
          {translations.actions.save}
        </Button>
      </div>
    </section>
  )
}
