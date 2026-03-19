"use client"
import * as React from 'react'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Textarea } from '@open-mercato/ui/primitives/textarea'

type Descriptor = {
  providerKey: string
  label: string
  sessionConfig?: {
    fields?: Array<{
      key: string
      label: string
      type: 'text' | 'number' | 'select' | 'boolean' | 'textarea' | 'secret' | 'url'
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
  const [descriptor, setDescriptor] = React.useState<Descriptor | null>(null)

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
    return <p className="text-sm text-muted-foreground">Choose a gateway provider to configure checkout session settings.</p>
  }
  if (!fields.length) {
    return <p className="text-sm text-muted-foreground">This provider does not expose additional session settings.</p>
  }

  return (
    <div className="space-y-4">
      {fields.map((field) => {
        const currentValue = value?.[field.key]
        return (
          <div key={field.key} className="space-y-2">
            <Label>{field.label}</Label>
            {field.type === 'select' ? (
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={typeof currentValue === 'string' ? currentValue : ''}
                onChange={(event) => onChange({ ...(value ?? {}), [field.key]: event.target.value })}
              >
                <option value="">Select…</option>
                {(field.options ?? []).map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            ) : field.type === 'boolean' ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={currentValue === true}
                  onChange={(event) => onChange({ ...(value ?? {}), [field.key]: event.target.checked })}
                />
                Enabled
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
