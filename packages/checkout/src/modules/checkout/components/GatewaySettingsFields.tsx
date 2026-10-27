"use client"
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'

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

  const patchSetting = React.useCallback(
    (fieldKey: string, nextValue: unknown) => {
      const next = { ...(value ?? {}) }
      if (nextValue === undefined || nextValue === null || nextValue === '') {
        delete next[fieldKey]
      } else {
        next[fieldKey] = nextValue
      }
      onChange(next)
    },
    [onChange, value],
  )

  const toggleMultiselectValue = React.useCallback(
    (fieldKey: string, optionValue: string) => {
      const current = Array.isArray(value?.[fieldKey])
        ? value?.[fieldKey].filter((entry): entry is string => typeof entry === 'string')
        : []
      const next = current.includes(optionValue)
        ? current.filter((entry) => entry !== optionValue)
        : [...current, optionValue]
      patchSetting(fieldKey, next.length ? next : undefined)
    },
    [patchSetting, value],
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
      <Alert status="information">
        <AlertDescription>
          {t('checkout.gatewaySettings.notices.chooseProvider')}
        </AlertDescription>
      </Alert>
    )
  }
  if (!fields.length) {
    return (
      <Alert status="information">
        <AlertDescription>
          {t('checkout.gatewaySettings.notices.noSettings')}
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-4">
      {fields.map((field) => {
        const currentValue = value?.[field.key]
        return (
          <div key={field.key} className="space-y-2 rounded-lg border border-border/70 bg-muted/30 p-3">
            <Label>{field.label}</Label>
            {field.type === 'select' ? (
              <Select
                value={typeof currentValue === 'string' ? currentValue : ''}
                onValueChange={(next) => patchSetting(field.key, next)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('checkout.gatewaySettings.selectPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {(field.options ?? []).map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleMultiselectValue(field.key, option.value)}
                      />
                      <span>{option.label}</span>
                    </label>
                  )
                })}
              </div>
            ) : field.type === 'boolean' ? (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={currentValue === true}
                  onCheckedChange={(next) => patchSetting(field.key, next === true)}
                />
                {t('checkout.common.enabled')}
              </label>
            ) : field.type === 'textarea' ? (
              <Textarea
                value={typeof currentValue === 'string' ? currentValue : ''}
                onChange={(event) => patchSetting(field.key, event.target.value)}
              />
            ) : (
              <Input
                type={field.type === 'number' ? 'number' : field.type === 'secret' ? 'password' : 'text'}
                value={typeof currentValue === 'string' || typeof currentValue === 'number' ? `${currentValue}` : ''}
                onChange={(event) => patchSetting(field.key, event.target.value)}
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
