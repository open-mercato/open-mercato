'use client'

/**
 * Reusable, controlled color picker for the forms styling vocabulary (spec D3).
 *
 * A color is ONLY ever a curated DS-role token OR a strict hex literal — there
 * is no free-text CSS path. The hex `Input` validates every keystroke against
 * `OM_HEX_COLOR` and never propagates a non-matching value upstream; invalid
 * input surfaces an inline error but leaves the persisted value untouched
 * (R-CS-1). Token swatches are keyboard-focusable DS `Button`s (R-CS-4 a11y).
 * Reused at form/section/field level (Tasks E & F).
 */

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { Input } from '@open-mercato/ui/primitives/input'
import { Button } from '@open-mercato/ui/primitives/button'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import {
  OM_HEX_COLOR,
  type OmColor,
  type OmColorToken,
} from '../../../../../schema/style-extensions'
import { belowAaForPair } from './contrast'

type SwatchSpec = {
  token: OmColorToken
  labelKey: string
  fallbackLabel: string
  /** Inline preview backed by a DS CSS var — never user data. */
  previewStyle: React.CSSProperties
}

const SWATCHES: ReadonlyArray<SwatchSpec> = [
  { token: 'surface', labelKey: 'forms.studio.style.color.token.surface', fallbackLabel: 'Surface', previewStyle: { background: 'var(--card)' } },
  { token: 'surface-muted', labelKey: 'forms.studio.style.color.token.surfaceMuted', fallbackLabel: 'Surface muted', previewStyle: { background: 'var(--muted)' } },
  { token: 'foreground', labelKey: 'forms.studio.style.color.token.foreground', fallbackLabel: 'Foreground', previewStyle: { background: 'var(--foreground)' } },
  { token: 'muted-foreground', labelKey: 'forms.studio.style.color.token.mutedForeground', fallbackLabel: 'Muted text', previewStyle: { background: 'var(--muted-foreground)' } },
  { token: 'accent', labelKey: 'forms.studio.style.color.token.accent', fallbackLabel: 'Accent', previewStyle: { background: 'var(--primary)' } },
  { token: 'border', labelKey: 'forms.studio.style.color.token.border', fallbackLabel: 'Border', previewStyle: { background: 'var(--border)' } },
  { token: 'transparent', labelKey: 'forms.studio.style.color.token.transparent', fallbackLabel: 'Transparent', previewStyle: { background: 'transparent' } },
  { token: 'inherit', labelKey: 'forms.studio.style.color.token.inherit', fallbackLabel: 'Inherit', previewStyle: { background: 'transparent' } },
]

function isHex(value: string): boolean {
  return OM_HEX_COLOR.test(value)
}

/**
 * Coerce the current draft into the `#rrggbb` literal the native `<input
 * type="color">` requires (it cannot represent `#rgb`, an 8-digit alpha hex, or
 * a DS token). 3-digit shorthand expands; anything else falls back to black so
 * the swatch always has a valid value. The picker only ever EMITS a 6-digit
 * lowercase hex, which passes `OM_HEX_COLOR` — so it stays inside the token-or-
 * hex security model (R-CS-1) with no free-text CSS path.
 */
function toNativeHex(draft: string): string {
  const value = draft.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value
  if (/^#[0-9a-fA-F]{3}$/.test(value)) {
    return `#${value.slice(1).split('').map((char) => char + char).join('')}`
  }
  return '#000000'
}

/**
 * Concrete light-mode hex for each curated token, so the native color picker
 * reflects the *selected token's* color instead of a misleading black `#000000`
 * (`transparent` / `inherit` have no concrete color → neutral white). Display
 * only — never persisted; selecting a token still emits the token, not this hex.
 */
const TOKEN_NATIVE_HEX: Record<OmColorToken, string> = {
  surface: '#ffffff',
  'surface-muted': '#f5f5f5',
  foreground: '#0a0a0a',
  'muted-foreground': '#737373',
  accent: '#171717',
  border: '#e5e5e5',
  transparent: '#ffffff',
  inherit: '#ffffff',
}

export type ColorControlProps = {
  value?: OmColor
  onChange: (next: OmColor | undefined) => void
  label: string
  /** When false, the `transparent` token swatch is hidden. */
  allowTransparent?: boolean
  /**
   * Optional companion color for a foreground/background AA check (R-CS-4).
   * Only evaluated when BOTH this value and the companion are custom hex
   * literals; tokens are always treated as contrast-safe.
   */
  contrastAgainst?: OmColor
}

export function ColorControl({
  value,
  onChange,
  label,
  allowTransparent = true,
  contrastAgainst,
}: ColorControlProps) {
  const t = useT()
  const valueIsHex = typeof value === 'string' && isHex(value)
  const [hexDraft, setHexDraft] = React.useState(valueIsHex ? (value as string) : '')
  const [hexError, setHexError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (valueIsHex) setHexDraft(value as string)
  }, [value, valueIsHex])

  const handleHexChange = React.useCallback(
    (raw: string) => {
      setHexDraft(raw)
      const trimmed = raw.trim()
      if (trimmed === '') {
        setHexError(null)
        onChange(undefined)
        return
      }
      if (isHex(trimmed)) {
        setHexError(null)
        onChange(trimmed as OmColor)
        return
      }
      // Invalid: surface an inline error and DO NOT propagate (R-CS-1).
      setHexError(t('forms.studio.style.color.hexError', 'Use a hex value like #0f766e'))
    },
    [onChange, t],
  )

  const selectToken = React.useCallback(
    (token: OmColorToken) => {
      setHexError(null)
      onChange(token)
    },
    [onChange],
  )

  // AA check: token-aware, fires whenever at least one side is a custom hex
  // (the branded case the old hex-only check missed). Token-vs-token pairs are
  // DS-curated and skipped to avoid false positives.
  const aaWarning = React.useMemo(() => {
    const ratio = belowAaForPair(value, contrastAgainst)
    if (ratio === null) return null
    return t('forms.studio.style.color.aaWarning', 'Low contrast — may be hard to read')
  }, [value, contrastAgainst, t])

  const swatches = SWATCHES.filter((swatch) => allowTransparent || swatch.token !== 'transparent')
  const [tokenOpen, setTokenOpen] = React.useState(false)

  // Native picker reflects the current value: the hex draft, or the concrete
  // color of a selected token (instead of a misleading black square).
  const nativeColorValue = valueIsHex
    ? toNativeHex(hexDraft)
    : typeof value === 'string' && value in TOKEN_NATIVE_HEX
      ? TOKEN_NATIVE_HEX[value as OmColorToken]
      : '#ffffff'

  // Current selection summarized on the popover trigger (chip + caption) so the
  // 8 token swatches collapse from a 3-row grid into one row (rail height).
  const currentToken = !valueIsHex ? swatches.find((swatch) => swatch.token === value) : undefined
  const triggerChipStyle: React.CSSProperties = valueIsHex
    ? { background: value as string }
    : currentToken?.previewStyle ?? { background: 'transparent' }
  const triggerCaption = valueIsHex
    ? (value as string)
    : currentToken
      ? t(currentToken.labelKey, currentToken.fallbackLabel)
      : t('forms.studio.style.color.tokenTrigger', 'Choose a token')

  return (
    <div className="space-y-1">
      <span className="block text-xs font-medium text-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        <Popover open={tokenOpen} onOpenChange={setTokenOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="2xs"
              className="h-7 w-7 shrink-0 justify-center p-0"
              title={triggerCaption}
              aria-label={t('forms.studio.style.color.tokenPickerLabel', 'Choose a color token')}
            >
              <span
                aria-hidden="true"
                style={triggerChipStyle}
                className="size-3.5 rounded-sm border border-border"
              />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 p-2">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
              {swatches.map((swatch) => {
                const selected = value === swatch.token
                const swatchLabel = t(swatch.labelKey, swatch.fallbackLabel)
                return (
                  <Button
                    key={swatch.token}
                    type="button"
                    variant="outline"
                    size="2xs"
                    aria-pressed={selected}
                    title={swatchLabel}
                    onClick={() => {
                      selectToken(swatch.token)
                      setTokenOpen(false)
                    }}
                    className={cn(selected ? 'border-primary ring-1 ring-primary' : undefined)}
                  >
                    <span
                      aria-hidden="true"
                      style={swatch.previewStyle}
                      className="size-3.5 shrink-0 rounded-sm border border-border"
                    />
                    <span className="text-muted-foreground">{swatchLabel}</span>
                  </Button>
                )
              })}
            </div>
          </PopoverContent>
        </Popover>
        <input
          type="color"
          value={nativeColorValue}
          aria-label={t('forms.studio.style.color.pickerLabel', 'Pick a custom color')}
          title={t('forms.studio.style.color.pickerLabel', 'Pick a custom color')}
          className="h-7 w-7 shrink-0 cursor-pointer rounded-md border border-input bg-background p-0.5"
          onChange={(event) => handleHexChange(event.target.value)}
        />
        <Input
          value={hexDraft}
          inputMode="text"
          spellCheck={false}
          placeholder={t('forms.studio.style.color.hexPlaceholder', '#0f766e')}
          aria-label={t('forms.studio.style.color.hexLabel', 'Custom hex color')}
          aria-invalid={hexError ? true : undefined}
          className="h-7 flex-1 font-mono text-xs"
          onChange={(event) => handleHexChange(event.target.value)}
        />
      </div>
      {hexError ? (
        <p className="text-xs text-status-error-text" role="alert">
          {hexError}
        </p>
      ) : null}
      {aaWarning ? (
        <p className="text-xs text-status-warning-text" role="status">
          {aaWarning}
        </p>
      ) : null}
    </div>
  )
}
