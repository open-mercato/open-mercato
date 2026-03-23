"use client"
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Notice } from '@open-mercato/ui/primitives/Notice'
import { Textarea } from '@open-mercato/ui/primitives/textarea'

type Descriptor = {
  providerKey: string
  label: string
  sessionConfig?: {
    fields?: Array<{
      key: string
      label: string
      type: 'text' | 'number' | 'select' | 'multiselect' | 'boolean' | 'textarea' | 'secret' | 'url'
      description?: string
      options?: Array<{ value: string; label: string }>
    }>
  }
}

type Props = {
  providerKey: string | null | undefined
  value: Record<string, unknown> | null | undefined
  onChange: (next: Record<string, unknown>) => void
}

export function GatewaySettingsFields({ providerKey, value, onChange }: Props) {
  const t = useT()
  const [descriptor, setDescriptor] = React.useState<Descriptor | null>(null)

  const toggleMultiselectValue = React.useCallback(
    (fieldKey: string, optionValue: string) => {
      const current = Array.isArray(value?.[fieldKey])
        ? value?.[fieldKey].filter((entry): entry is string => typeof entry === 'string')
        : []
      const next = current.includes(optionValue)
        ? current.filter((entry) => entry !== optionValue)
        : [...current, optionValue]
      onChange({ ...(value ?? {}), [fieldKey]: next })
    },
    [onChange, value],
  )

  React.useEffect(() => {
    let active = true
    if (!providerKey) {
      setDescriptor(null)
      return () => { active = false }
    }
    void readApiResultOrThrow<Descriptor>(`/api/payment_gateways/providers/${encodeURIComponent(providerKey)}`)
      .then((result) => {
        if (active) setDescriptor(result)
      })
      .catch(() => {
        if (active) setDescriptor(null)
      })
    return () => { active = false }
  }, [providerKey])

  const fields = descriptor?.sessionConfig?.fields ?? []
  if (!providerKey) {
    return (
      <Notice compact>
        {t('checkout.gatewaySettings.notices.chooseProvider')}
      </Notice>
    )
  }
  if (!fields.length) {
    return (
      <Notice compact>
        {t('checkout.gatewaySettings.notices.noSettings')}
      </Notice>
    )
  }

  return (
    <div className="space-y-4">
      {fields.map((field) => {
        const currentValue = value?.[field.key]
        return (
          <div key={field.key} className="space-y-2 rounded-lg border border-border/70 bg-muted/20 p-3">
            <Label>{field.label}</Label>
            {field.type === 'select' ? (
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={typeof currentValue === 'string' ? currentValue : ''}
                onChange={(event) => onChange({ ...(value ?? {}), [field.key]: event.target.value })}
              >
                <option value="">{t('checkout.gatewaySettings.selectPlaceholder')}</option>
                {(field.options ?? []).map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            ) : field.type === 'multiselect' ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {(field.options ?? []).map((option) => {
                  const selectedValues = Array.isArray(currentValue)
                    ? currentValue.filter((entry): entry is string => typeof entry === 'string')
                    : []
                  const checked = selectedValues.includes(option.value)
                  return (
                    <label
                      key={option.value}
                      className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleMultiselectValue(field.key, option.value)}
                      />
                      <span>{option.label}</span>
                    </label>
                  )
                })}
              </div>
            ) : field.type === 'boolean' ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={currentValue === true}
                  onChange={(event) => onChange({ ...(value ?? {}), [field.key]: event.target.checked })}
                />
                {t('checkout.common.enabled')}
              </label>
            ) : field.type === 'textarea' ? (
              <Textarea
                value={typeof currentValue === 'string' ? currentValue : ''}
                onChange={(event) => onChange({ ...(value ?? {}), [field.key]: event.target.value })}
              />
            ) : (
              <Input
                type={field.type === 'number' ? 'number' : field.type === 'secret' ? 'password' : 'text'}
                value={typeof currentValue === 'string' || typeof currentValue === 'number' ? `${currentValue}` : ''}
                onChange={(event) => onChange({ ...(value ?? {}), [field.key]: event.target.value })}
              />
            )}
            {field.description ? <p className="text-xs text-muted-foreground">{field.description}</p> : null}
          </div>
        )
      })}
    </div>
  )
}

export default GatewaySettingsFields
