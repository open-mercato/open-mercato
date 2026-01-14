'use client'

import * as React from 'react'
import {
  FMS_QUOTE_STATUSES,
  FMS_DIRECTIONS,
  FMS_INCOTERMS,
  FMS_CARGO_TYPES,
  type FmsQuoteStatus,
  type FmsDirection,
  type FmsIncoterm,
  type FmsCargoType,
} from '../data/types'

type ClientRef = {
  id: string
  name: string
  shortName?: string | null
}

type PortRef = {
  id: string
  locode?: string | null
  name: string
  city?: string | null
  country?: string | null
}

type Quote = {
  id: string
  quoteNumber?: string | null
  client?: ClientRef | null
  containerCount?: number | null
  status: FmsQuoteStatus
  direction?: string | null
  incoterm?: string | null
  cargoType?: string | null
  originPorts?: PortRef[]
  destinationPorts?: PortRef[]
  validUntil?: string | null
  currencyCode: string
  createdAt: string
  updatedAt: string
}

type QuoteBasicInfoProps = {
  quote: Quote
  onFieldSave: (field: string, value: unknown) => Promise<void>
}

type FieldType = 'text' | 'number' | 'select' | 'date'

type FieldConfig = {
  key: string
  label: string
  type: FieldType
  options?: { value: string; label: string }[]
  placeholder?: string
}

const STATUS_OPTIONS = FMS_QUOTE_STATUSES.map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))
const DIRECTION_OPTIONS = [
  { value: '', label: 'Select...' },
  ...FMS_DIRECTIONS.map((d) => ({ value: d, label: d.charAt(0).toUpperCase() + d.slice(1) })),
]
const INCOTERM_OPTIONS = [
  { value: '', label: 'Select...' },
  ...FMS_INCOTERMS.map((i) => ({ value: i, label: i.toUpperCase() })),
]
const CARGO_TYPE_OPTIONS = [
  { value: '', label: 'Select...' },
  ...FMS_CARGO_TYPES.map((c) => ({ value: c, label: c.toUpperCase() })),
]

const FIELDS: FieldConfig[] = [
  { key: 'quoteNumber', label: 'Quote Number', type: 'text', placeholder: 'Q-2024-001' },
  { key: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS },
  { key: 'direction', label: 'Direction', type: 'select', options: DIRECTION_OPTIONS },
  { key: 'cargoType', label: 'Cargo Type', type: 'select', options: CARGO_TYPE_OPTIONS },
  { key: 'incoterm', label: 'Incoterm', type: 'select', options: INCOTERM_OPTIONS },
  { key: 'containerCount', label: 'Containers', type: 'number', placeholder: '10' },
  { key: 'currencyCode', label: 'Currency', type: 'text', placeholder: 'USD' },
  { key: 'validUntil', label: 'Valid Until', type: 'date' },
]

// Helper to format multiple ports display
function formatPorts(ports: PortRef[] | null | undefined): string {
  if (!ports || ports.length === 0) return ''
  return ports
    .map((port) => {
      const parts = [port.locode, port.name].filter(Boolean)
      return parts.join(' - ')
    })
    .join(', ')
}

// Helper to format client display
function formatClient(client: ClientRef | null | undefined): string {
  if (!client) return ''
  return client.name
}

function InlineField({
  label,
  value,
  field,
  type,
  options,
  placeholder,
  onSave,
}: {
  label: string
  value: unknown
  field: string
  type: FieldType
  options?: { value: string; label: string }[]
  placeholder?: string
  onSave: (field: string, value: unknown) => Promise<void>
}) {
  const [editing, setEditing] = React.useState(false)
  const [tempValue, setTempValue] = React.useState<string>(String(value ?? ''))
  const [isSaving, setIsSaving] = React.useState(false)

  React.useEffect(() => {
    setTempValue(String(value ?? ''))
  }, [value])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      let finalValue: unknown = tempValue
      if (type === 'number' && tempValue) {
        finalValue = parseInt(tempValue, 10)
      } else if (tempValue === '' && type !== 'text') {
        finalValue = null
      }
      await onSave(field, finalValue)
      setEditing(false)
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    setTempValue(String(value ?? ''))
    setEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave()
    } else if (e.key === 'Escape') {
      handleCancel()
    }
  }

  const isEmpty = !value || value === ''

  const displayValue = React.useMemo(() => {
    if (isEmpty) return null
    if (type === 'select' && options) {
      const opt = options.find((o) => o.value === value)
      return opt?.label || String(value)
    }
    if (type === 'date' && value) {
      return new Date(String(value)).toLocaleDateString()
    }
    return String(value)
  }, [isEmpty, type, options, value])

  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100">
      <span className="text-xs font-semibold text-gray-600 w-32">{label}</span>
      {editing ? (
        <div className="flex items-center gap-2 flex-1 justify-end">
          {type === 'select' && options ? (
            <select
              value={tempValue}
              onChange={(e) => setTempValue(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
              disabled={isSaving}
              className="bg-white border border-gray-300 text-gray-900 px-2 py-1 rounded text-xs min-w-[120px]"
            >
              {options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          ) : type === 'date' ? (
            <input
              type="date"
              value={tempValue ? tempValue.split('T')[0] : ''}
              onChange={(e) => setTempValue(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
              disabled={isSaving}
              className="bg-white border border-gray-300 text-gray-900 px-2 py-1 rounded text-xs"
            />
          ) : (
            <input
              type={type}
              value={tempValue}
              onChange={(e) => setTempValue(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
              disabled={isSaving}
              placeholder={placeholder}
              className="bg-white border border-gray-300 text-gray-900 px-2 py-1 rounded text-xs min-w-[120px]"
            />
          )}
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="text-green-600 hover:text-green-800 text-xs font-medium"
          >
            {isSaving ? '...' : '✓'}
          </button>
          <button
            onClick={handleCancel}
            disabled={isSaving}
            className="text-red-600 hover:text-red-800 text-xs font-medium"
          >
            ✕
          </button>
        </div>
      ) : isEmpty ? (
        <button
          onClick={() => setEditing(true)}
          className="text-gray-400 text-xs border border-dashed border-gray-300 px-2 py-1 rounded hover:border-gray-400"
        >
          + Add {label}
        </button>
      ) : (
        <span
          onClick={() => setEditing(true)}
          className="text-xs text-gray-900 cursor-pointer hover:bg-gray-50 px-2 py-1 rounded"
        >
          {displayValue}
        </span>
      )}
    </div>
  )
}

export function QuoteBasicInfo({ quote, onFieldSave }: QuoteBasicInfoProps) {
  const clientDisplay = formatClient(quote.client)
  const originDisplay = formatPorts(quote.originPorts)
  const destinationDisplay = formatPorts(quote.destinationPorts)

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
      <div>
        {FIELDS.slice(0, 4).map((field) => (
          <InlineField
            key={field.key}
            label={field.label}
            value={(quote as Record<string, unknown>)[field.key]}
            field={field.key}
            type={field.type}
            options={field.options}
            placeholder={field.placeholder}
            onSave={onFieldSave}
          />
        ))}
        {/* Client - read-only relation display */}
        <div className="flex items-center justify-between py-2 border-b border-gray-100">
          <span className="text-xs font-semibold text-gray-600 w-32">Client</span>
          <span className="text-xs text-gray-900">
            {clientDisplay || <span className="text-gray-400">-</span>}
          </span>
        </div>
        {/* Origin Ports - read-only relation display */}
        <div className="flex items-center justify-between py-2 border-b border-gray-100">
          <span className="text-xs font-semibold text-gray-600 w-32">Origin Ports</span>
          <span className="text-xs text-gray-900 text-right flex-1 ml-4">
            {originDisplay || <span className="text-gray-400">-</span>}
          </span>
        </div>
      </div>
      <div>
        {/* Destination Ports - read-only relation display */}
        <div className="flex items-center justify-between py-2 border-b border-gray-100">
          <span className="text-xs font-semibold text-gray-600 w-32">Destination Ports</span>
          <span className="text-xs text-gray-900 text-right flex-1 ml-4">
            {destinationDisplay || <span className="text-gray-400">-</span>}
          </span>
        </div>
        {FIELDS.slice(4).map((field) => (
          <InlineField
            key={field.key}
            label={field.label}
            value={(quote as Record<string, unknown>)[field.key]}
            field={field.key}
            type={field.type}
            options={field.options}
            placeholder={field.placeholder}
            onSave={onFieldSave}
          />
        ))}
        <div className="flex items-center justify-between py-2 border-b border-gray-100">
          <span className="text-xs font-semibold text-gray-600 w-32">Created</span>
          <span className="text-xs text-gray-500">
            {new Date(quote.createdAt).toLocaleString()}
          </span>
        </div>
        <div className="flex items-center justify-between py-2 border-b border-gray-100">
          <span className="text-xs font-semibold text-gray-600 w-32">Updated</span>
          <span className="text-xs text-gray-500">
            {new Date(quote.updatedAt).toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  )
}
