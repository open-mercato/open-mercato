import { Input } from '@open-mercato/ui/primitives/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
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
        <div className="py-1">
          <SwitchField
            id={field.key}
            label={field.placeholder ?? ''}
            flip
            checked={Boolean(value)}
            onCheckedChange={(checked) => onChange(checked)}
          />
        </div>
      )
    case 'select':
      return (
        <Select
          value={typeof value === 'string' && value ? value : undefined}
          onValueChange={(next) => onChange(next ?? '')}
        >
          <SelectTrigger {...common}>
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
