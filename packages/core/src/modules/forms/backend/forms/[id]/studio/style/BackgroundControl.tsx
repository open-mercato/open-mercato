'use client'

/**
 * Reusable, controlled editor for an `OmBackground` (spec D6 — v1 = none /
 * color / gradient; image is Phase 2). Composes `ColorControl` so the same
 * hex-only / token-only safety applies to every color stop; the gradient angle
 * is a validated/clamped integer in [0, 360]. No raw CSS path anywhere.
 * Reused at form/section level (Tasks E & F).
 */

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Input } from '@open-mercato/ui/primitives/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import type { OmBackground, OmBackgroundKind, OmColor } from '../../../../../schema/style-extensions'
import { ColorControl } from './ColorControl'

export type BackgroundControlProps = {
  value?: OmBackground
  onChange: (next: OmBackground | undefined) => void
  label: string
}

const DEFAULT_COLOR: OmColor = 'surface'
const DEFAULT_FROM: OmColor = 'surface'
const DEFAULT_TO: OmColor = 'accent'
const DEFAULT_ANGLE = 90

function clampAngle(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const parsed = Number.parseInt(trimmed, 10)
  if (!Number.isFinite(parsed)) return null
  return Math.min(360, Math.max(0, parsed))
}

export function BackgroundControl({ value, onChange, label }: BackgroundControlProps) {
  const t = useT()
  const kind: OmBackgroundKind = value?.kind ?? 'none'

  const handleKindChange = React.useCallback(
    (next: OmBackgroundKind) => {
      if (next === 'none') {
        onChange(undefined)
        return
      }
      if (next === 'color') {
        const previousColor = value?.kind === 'color' ? value.color : DEFAULT_COLOR
        onChange({ kind: 'color', color: previousColor })
        return
      }
      const from = value?.kind === 'gradient' ? value.from : DEFAULT_FROM
      const to = value?.kind === 'gradient' ? value.to : DEFAULT_TO
      const angle = value?.kind === 'gradient' ? value.angle : DEFAULT_ANGLE
      onChange({ kind: 'gradient', from, to, angle })
    },
    [onChange, value],
  )

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <label
          htmlFor="forms-studio-bg-kind"
          className="block text-sm font-medium text-foreground"
        >
          {label}
        </label>
        <Select value={kind} onValueChange={(next) => handleKindChange(next as OmBackgroundKind)}>
          <SelectTrigger id="forms-studio-bg-kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t('forms.studio.style.background.none', 'None')}</SelectItem>
            <SelectItem value="color">{t('forms.studio.style.background.color', 'Solid color')}</SelectItem>
            <SelectItem value="gradient">{t('forms.studio.style.background.gradient', 'Gradient')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {value?.kind === 'color' ? (
        <ColorControl
          label={t('forms.studio.style.background.colorLabel', 'Background color')}
          value={value.color}
          onChange={(next) => onChange(next ? { kind: 'color', color: next } : undefined)}
        />
      ) : null}

      {value?.kind === 'gradient' ? (
        <div className="space-y-2 rounded-md border border-border p-2">
          <ColorControl
            label={t('forms.studio.style.background.from', 'Gradient from')}
            value={value.from}
            onChange={(next) => onChange({ ...value, from: next ?? DEFAULT_FROM })}
          />
          <ColorControl
            label={t('forms.studio.style.background.to', 'Gradient to')}
            value={value.to}
            onChange={(next) => onChange({ ...value, to: next ?? DEFAULT_TO })}
          />
          <div className="space-y-1">
            <label
              htmlFor="forms-studio-bg-angle"
              className="block text-sm font-medium text-foreground"
            >
              {t('forms.studio.style.background.angle', 'Angle (deg)')}
            </label>
            <Input
              id="forms-studio-bg-angle"
              type="number"
              min={0}
              max={360}
              step={1}
              value={String(value.angle)}
              className="h-8 text-xs"
              onChange={(event) => {
                const angle = clampAngle(event.target.value)
                if (angle === null) return
                onChange({ ...value, angle })
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
