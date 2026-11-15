"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Input } from '../../primitives/input'
import { Button } from '../../primitives/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../primitives/select'

export type DurationUnit = 'seconds' | 'minutes' | 'hours' | 'days'

export type ParsedSingleUnitDuration = { amount: number; unit: DurationUnit }

const singleUnitPatterns: Array<{ regex: RegExp; unit: DurationUnit }> = [
  { regex: /^PT(\d+)S$/, unit: 'seconds' },
  { regex: /^PT(\d+)M$/, unit: 'minutes' },
  { regex: /^PT(\d+)H$/, unit: 'hours' },
  { regex: /^P(\d+)D$/, unit: 'days' },
]

export function parseSingleUnitDuration(value: string): ParsedSingleUnitDuration | null {
  for (const { regex, unit } of singleUnitPatterns) {
    const match = value.match(regex)
    if (match) {
      const amount = parseInt(match[1], 10)
      if (!isNaN(amount)) return { amount, unit }
    }
  }
  return null
}

export function formatSingleUnitDuration(amount: number, unit: DurationUnit): string {
  switch (unit) {
    case 'seconds':
      return `PT${amount}S`
    case 'minutes':
      return `PT${amount}M`
    case 'hours':
      return `PT${amount}H`
    case 'days':
      return `P${amount}D`
  }
}

export function isCompositeCompatibleDuration(value: string | null | undefined): boolean {
  if (!value) return true
  if (value.includes('{{')) return false
  return parseSingleUnitDuration(value) !== null
}

export type DurationInputProps = {
  value?: string
  onChange: (value: string) => void
  disabled?: boolean
  id?: string
  'aria-label'?: string
  className?: string
}

const durationUnits: DurationUnit[] = ['seconds', 'minutes', 'hours', 'days']

export function DurationInput({
  value,
  onChange,
  disabled = false,
  id,
  'aria-label': ariaLabel,
  className,
}: DurationInputProps) {
  const t = useT()
  const currentValue = value ?? ''
  const parsed = React.useMemo(() => parseSingleUnitDuration(currentValue), [currentValue])
  const compositeCompatible = isCompositeCompatibleDuration(currentValue)

  const [mode, setMode] = React.useState<'composite' | 'raw'>(() =>
    compositeCompatible ? 'composite' : 'raw'
  )
  const [unit, setUnit] = React.useState<DurationUnit>(parsed?.unit ?? 'minutes')

  React.useEffect(() => {
    if (!isCompositeCompatibleDuration(currentValue)) setMode('raw')
  }, [currentValue])

  React.useEffect(() => {
    if (parsed && parsed.unit !== unit) setUnit(parsed.unit)
  }, [parsed, unit])

  const amountLabel = ariaLabel ?? t('ui.durationInput.amountLabel', 'Duration amount')
  const unitLabel = t('ui.durationInput.unitLabel', 'Duration unit')
  const rawLabel = ariaLabel ?? t('ui.durationInput.rawLabel', 'Duration expression')
  const unitOptionLabels: Record<DurationUnit, string> = {
    seconds: t('ui.durationInput.units.seconds', 'Seconds'),
    minutes: t('ui.durationInput.units.minutes', 'Minutes'),
    hours: t('ui.durationInput.units.hours', 'Hours'),
    days: t('ui.durationInput.units.days', 'Days'),
  }

  const handleAmountChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      if (disabled) return
      const raw = event.target.value
      if (raw === '') {
        onChange('')
        return
      }
      const amount = parseInt(raw, 10)
      if (isNaN(amount) || amount < 0) return
      onChange(formatSingleUnitDuration(amount, unit))
    },
    [disabled, onChange, unit]
  )

  const handleUnitChange = React.useCallback(
    (nextUnit: string) => {
      if (disabled) return
      const resolved = durationUnits.find((candidate) => candidate === nextUnit)
      if (!resolved) return
      setUnit(resolved)
      if (parsed) onChange(formatSingleUnitDuration(parsed.amount, resolved))
    },
    [disabled, onChange, parsed]
  )

  const handleRawChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      if (disabled) return
      onChange(event.target.value)
    },
    [disabled, onChange]
  )

  const switchToRaw = React.useCallback(() => {
    setMode('raw')
  }, [])

  const switchToComposite = React.useCallback(() => {
    if (!isCompositeCompatibleDuration(currentValue)) return
    setMode('composite')
  }, [currentValue])

  if (mode === 'raw') {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <Input
          id={id}
          type="text"
          value={currentValue}
          onChange={handleRawChange}
          disabled={disabled}
          aria-label={rawLabel}
          className="flex-1"
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={switchToComposite}
          disabled={disabled || !compositeCompatible}
        >
          {t('ui.durationInput.switchToComposite', 'Use picker')}
        </Button>
      </div>
    )
  }

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Input
        id={id}
        type="number"
        min={0}
        value={parsed ? String(parsed.amount) : ''}
        onChange={handleAmountChange}
        disabled={disabled}
        aria-label={amountLabel}
        className="w-24"
      />
      <Select value={unit} onValueChange={handleUnitChange} disabled={disabled}>
        <SelectTrigger aria-label={unitLabel} className="w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {durationUnits.map((option) => (
            <SelectItem key={option} value={option}>
              {unitOptionLabels[option]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={switchToRaw}
        disabled={disabled}
      >
        {t('ui.durationInput.switchToRaw', 'Edit as text')}
      </Button>
    </div>
  )
}
