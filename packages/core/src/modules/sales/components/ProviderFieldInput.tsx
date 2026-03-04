import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { isRecord } from '@open-mercato/shared/lib/utils'
import type { ProviderSettingField } from '../lib/providers'

export function renderProviderFieldInput(opts: {
  field: ProviderSettingField
  value: unknown
  onChange: (next: unknown) => void
}) {
  const { field, value, onChange } = opts
  const common = { id: field.key, 'data-provider-setting': field.key }
  switch (field.type) {
    case 'textarea':
      return (
        <Textarea
          {...common}
          value={typeof value === 'string' ? value : ''}
          onChange={(evt) => onChange(evt.target.value)}
          placeholder={field.placeholder}
        />
      )
    case 'number':
      return (
        <Input
          {...common}
          type="number"
          value={typeof value === 'number' || typeof value === 'string' ? String(value) : ''}
          onChange={(evt) => onChange(evt.target.value === '' ? '' : Number(evt.target.value))}
          placeholder={field.placeholder}
        />
      )
    case 'boolean':
      return (
        <div className="flex items-center gap-2 py-1">
          <Switch
            id={field.key}
            checked={Boolean(value)}
            onCheckedChange={(checked) => onChange(checked)}
          />
          <Label htmlFor={field.key}>{field.placeholder ?? ''}</Label>
        </div>
      )
    case 'select':
      return (
        <select
          {...common}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={typeof value === 'string' ? value : ''}
          onChange={(evt) => onChange(evt.target.value)}
        >
          <option value="">—</option>
          {(field.options ?? []).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      )
    case 'secret':
      return (
        <Input
          {...common}
          type="password"
          value={typeof value === 'string' ? value : ''}
          onChange={(evt) => onChange(evt.target.value)}
          placeholder={field.placeholder}
        />
      )
    case 'url':
    case 'text':
    default:
      return (
        <Input
          {...common}
          type={field.type === 'url' ? 'url' : 'text'}
          value={typeof value === 'string' ? value : ''}
          onChange={(evt) => onChange(evt.target.value)}
          placeholder={field.placeholder}
        />
      )
  }
}
