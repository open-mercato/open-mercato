"use client"
import * as React from 'react'
import { Check, X, AlertTriangle, Minus, Circle } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export function BooleanIcon({ value, trueLabel, falseLabel, className }: {
  value?: boolean | null
  trueLabel?: string
  falseLabel?: string
  className?: string
}) {
  const v = !!value
  return (
    <span className={`inline-flex items-center gap-1 ${className ?? ''}`}>
      {v ? (
        <Check className="size-4 text-emerald-600" />
      ) : (
        <X className="size-4 text-muted-foreground" />
      )}
      {v && trueLabel ? <span className="text-xs">{trueLabel}</span> : null}
      {!v && falseLabel ? <span className="text-xs">{falseLabel}</span> : null}
    </span>
  )
}

export type EnumBadgeMap = Record<string, { label: string; className?: string; icon?: React.ReactNode }>

export function EnumBadge({ value, map, fallback }: { value?: string | null; map: EnumBadgeMap; fallback?: string }) {
  if (!value) return <span className="text-muted-foreground text-xs">{fallback ?? '—'}</span>
  const cfg = map[value] || { label: String(value) }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border ${cfg.className ?? ''}`}>
      {cfg.icon}
      <span>{cfg.label}</span>
    </span>
  )
}

// Presets for common enums (optional helper)
export function useSeverityPreset(): EnumBadgeMap {
  const t = useT()
  return {
    low: { label: t('ui.badges.severity.low', 'Low'), className: 'border-amber-200 text-amber-700 bg-amber-50', icon: <Circle className="size-3" /> },
    medium: { label: t('ui.badges.severity.medium', 'Medium'), className: 'border-yellow-200 text-yellow-800 bg-yellow-50', icon: <Minus className="size-3" /> },
    high: { label: t('ui.badges.severity.high', 'High'), className: 'border-red-200 text-red-700 bg-red-50', icon: <AlertTriangle className="size-3" /> },
  }
}

