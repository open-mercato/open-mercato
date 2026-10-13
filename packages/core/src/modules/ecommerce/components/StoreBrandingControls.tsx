'use client'

import * as React from 'react'
import { Input } from '@open-mercato/ui/primitives/input'
import { Slider } from '@open-mercato/ui/primitives/slider'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { normalizeBrandingColor } from '../lib/brandingStyles'
import {
  RADIUS_SLIDER_MAX,
  RADIUS_SLIDER_MIN,
  RADIUS_SLIDER_STEP,
  formatRadiusRem,
  parseRadiusRem,
} from './storeBrandingForm'

type ControlProps = {
  id: string
  value: unknown
  error?: string
  disabled?: boolean
  setValue: (value: unknown) => void
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function BrandingColorInput({ id, value, error, disabled, setValue }: ControlProps) {
  const t = useT()
  const text = readText(value)
  const swatch = normalizeBrandingColor(text.trim())
  return (
    <Input
      id={id}
      value={text}
      disabled={disabled}
      aria-invalid={error ? true : undefined}
      placeholder={t('ecommerce.backend.store.branding.colorPlaceholder', 'oklch(0.3 0.15 270) or #1a2b3c')}
      leading={
        <span
          aria-hidden="true"
          data-testid={`branding-swatch-${id}`}
          className="size-5 rounded-sm border border-input"
          style={swatch ? { backgroundColor: swatch } : undefined}
        />
      }
      onChange={(event) => setValue(event.target.value)}
    />
  )
}

export function BrandingRadiusSlider({ id, value, disabled, setValue }: ControlProps) {
  const t = useT()
  const text = readText(value)
  const rem = parseRadiusRem(text)
  return (
    <div className="flex items-center gap-4">
      <Slider
        id={id}
        min={RADIUS_SLIDER_MIN}
        max={RADIUS_SLIDER_MAX}
        step={RADIUS_SLIDER_STEP}
        value={[rem]}
        disabled={disabled}
        aria-label={t('ecommerce.backend.store.branding.radius', 'Corner radius')}
        onValueChange={(next) => setValue(formatRadiusRem(next[0] ?? rem))}
      />
      <span className="w-20 shrink-0 text-right text-sm tabular-nums text-muted-foreground" data-testid="branding-radius-value">
        {text}
      </span>
    </div>
  )
}
