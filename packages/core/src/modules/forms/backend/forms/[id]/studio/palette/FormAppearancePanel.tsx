'use client'

/**
 * Form-level Appearance panel — authors the `x-om-theme` vocabulary (spec
 * Step 6 / D4). Reads the current theme from the studio schema and emits a new
 * `OmTheme` (or `undefined` to clear) through `onThemeChange`, which the studio
 * routes into `setFormTheme(...)` on the existing autosave path. Every color
 * goes through `ColorControl` (token / hex only) and the background through
 * `BackgroundControl` (none / color / gradient) — there is no raw CSS channel.
 */

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from '@open-mercato/ui/primitives/button'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { buildLogoSrc } from '../../../../../ui/public/style/LogoHeader'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import type {
  OmBackground,
  OmColor,
  OmContentWidth,
  OmFontFamily,
  OmFontScale,
  OmLogoSize,
  OmRadiusScale,
  OmTextAlign,
  OmTextWeight,
  OmTheme,
  OmThemeLogo,
} from '../../../../../schema/style-extensions'
import { ColorControl } from '../style/ColorControl'
import { BackgroundControl } from '../style/BackgroundControl'
import { FORM_THEME_PRESETS } from '../style/presets'
import { belowAaForPair } from '../style/contrast'

export type FormAppearancePanelProps = {
  formId: string
  theme: OmTheme | undefined
  onThemeChange: (next: OmTheme | undefined) => void
}

const LOGO_SIZES: ReadonlyArray<{ value: OmLogoSize; fallback: string }> = [
  { value: 'sm', fallback: 'Small' },
  { value: 'md', fallback: 'Medium' },
  { value: 'lg', fallback: 'Large' },
]

const LOGO_ALIGNS: ReadonlyArray<{ value: OmTextAlign; fallback: string }> = [
  { value: 'start', fallback: 'Start' },
  { value: 'center', fallback: 'Center' },
  { value: 'end', fallback: 'End' },
]

/** Map an `OmColor` to a CSS value for a non-interactive preview swatch only. */
const TOKEN_PREVIEW_CSS: Record<string, string> = {
  surface: 'var(--card)',
  'surface-muted': 'var(--muted)',
  foreground: 'var(--foreground)',
  'muted-foreground': 'var(--muted-foreground)',
  accent: 'var(--primary)',
  border: 'var(--border)',
  transparent: 'transparent',
  inherit: 'transparent',
}

function colorToPreviewCss(color: OmColor | undefined): string {
  if (typeof color !== 'string' || color.length === 0) return 'transparent'
  if (color.startsWith('#')) return color
  return TOKEN_PREVIEW_CSS[color] ?? 'transparent'
}

function backgroundToPreviewCss(background: OmBackground | undefined): string | null {
  if (!background || background.kind === 'none') return null
  if (background.kind === 'color') return colorToPreviewCss(background.color)
  return `linear-gradient(${background.angle}deg, ${background.from}, ${background.to})`
}

/** Order-insensitive deep compare so an applied preset can show as active. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key])
    }
    return out
  }
  return value
}

function themesEqual(a: OmTheme | undefined, b: OmTheme | undefined): boolean {
  return JSON.stringify(canonicalize(a ?? {})) === JSON.stringify(canonicalize(b ?? {}))
}

const FONT_FAMILIES: ReadonlyArray<{ value: OmFontFamily; fallback: string }> = [
  { value: 'system', fallback: 'System' },
  { value: 'sans', fallback: 'Sans' },
  { value: 'serif', fallback: 'Serif' },
  { value: 'mono', fallback: 'Mono' },
  { value: 'rounded', fallback: 'Rounded' },
]

const FONT_SCALES: ReadonlyArray<{ value: OmFontScale; fallback: string }> = [
  { value: 'sm', fallback: 'Small' },
  { value: 'md', fallback: 'Medium' },
  { value: 'lg', fallback: 'Large' },
]

const LABEL_WEIGHTS: ReadonlyArray<{ value: OmTextWeight; fallback: string }> = [
  { value: 'normal', fallback: 'Normal' },
  { value: 'medium', fallback: 'Medium' },
  { value: 'semibold', fallback: 'Semibold' },
  { value: 'bold', fallback: 'Bold' },
]

const RADIUS_SCALES: ReadonlyArray<{ value: OmRadiusScale; fallback: string }> = [
  { value: 'none', fallback: 'None' },
  { value: 'sm', fallback: 'Small' },
  { value: 'md', fallback: 'Medium' },
  { value: 'lg', fallback: 'Large' },
  { value: 'full', fallback: 'Full' },
]

const CONTENT_WIDTHS: ReadonlyArray<{ value: OmContentWidth; fallback: string }> = [
  { value: 'sm', fallback: 'Narrow' },
  { value: 'md', fallback: 'Medium' },
  { value: 'lg', fallback: 'Wide' },
  { value: 'full', fallback: 'Full' },
]

const NONE_VALUE = '__none__'

export function FormAppearancePanel({ formId, theme, onThemeChange }: FormAppearancePanelProps) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const hasTheme = !!theme && Object.keys(theme).length > 0
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const [logoBusy, setLogoBusy] = React.useState(false)
  const [logoError, setLogoError] = React.useState<string | null>(null)

  const patch = React.useCallback(
    (next: Partial<OmTheme>) => {
      const merged: OmTheme = { ...(theme ?? {}), ...next }
      for (const key of Object.keys(merged) as Array<keyof OmTheme>) {
        if (merged[key] === undefined) delete merged[key]
      }
      onThemeChange(Object.keys(merged).length === 0 ? undefined : merged)
    },
    [theme, onThemeChange],
  )

  const applyPreset = React.useCallback(
    async (presetId: string) => {
      const preset = FORM_THEME_PRESETS.find((entry) => entry.id === presetId)
      if (!preset) return
      const target: OmTheme = { ...preset.theme }
      if (themesEqual(theme, target)) return
      // Non-destructive: confirm before overwriting an existing theme.
      if (hasTheme) {
        const ok = await confirm({
          title: t('forms.studio.style.preset.confirm.title', 'Replace current styling?'),
          text: t(
            'forms.studio.style.preset.confirm.body',
            'Applying a preset overwrites the current colors, background, and typography for this form.',
          ),
          confirmText: t('forms.studio.style.preset.confirm.submit', 'Apply preset'),
        })
        if (!ok) return
      }
      onThemeChange(target)
    },
    [confirm, hasTheme, onThemeChange, t, theme],
  )

  const resetStyling = React.useCallback(async () => {
    if (!hasTheme) return
    const ok = await confirm({
      title: t('forms.studio.style.reset.confirm.title', 'Reset styling?'),
      text: t(
        'forms.studio.style.reset.confirm.body',
        'This clears all custom colors, background, and typography. The form returns to the default theme.',
      ),
      confirmText: t('forms.studio.style.reset.confirm.submit', 'Reset styling'),
      variant: 'destructive',
    })
    if (!ok) return
    onThemeChange(undefined)
  }, [confirm, hasTheme, onThemeChange, t])

  const patchLogo = React.useCallback(
    (next: Partial<OmThemeLogo>) => {
      if (!theme?.logo) return
      patch({ logo: { ...theme.logo, ...next } })
    },
    [patch, theme],
  )

  const handleLogoFile = React.useCallback(
    async (file: File | undefined) => {
      if (!file) return
      setLogoError(null)
      setLogoBusy(true)
      try {
        const body = new FormData()
        body.append('file', file)
        const response = await apiCall<{ assetId: string }>(
          `/api/forms/${encodeURIComponent(formId)}/theme-logo`,
          { method: 'POST', body },
        )
        if (!response.ok || !response.result?.assetId) {
          setLogoError(t('forms.studio.style.logo.error', 'Could not upload that image.'))
          return
        }
        patch({ logo: { ...(theme?.logo ?? {}), assetId: response.result.assetId } })
      } catch {
        setLogoError(t('forms.studio.style.logo.error', 'Could not upload that image.'))
      } finally {
        setLogoBusy(false)
      }
    },
    [formId, patch, t, theme],
  )

  // Token-aware AA summary for the brand-color pairs an author actually controls
  // (text-on-surface, accent-on-surface). Advisory only — never blocks save.
  const contrastIssues = React.useMemo(() => {
    const issues: string[] = []
    if (belowAaForPair(theme?.foreground, theme?.surface) !== null) {
      issues.push(t('forms.studio.style.a11y.textOnSurface', 'Text on surface'))
    }
    if (belowAaForPair(theme?.inputText, theme?.surface) !== null) {
      issues.push(t('forms.studio.style.a11y.inputOnSurface', 'Input text on surface'))
    }
    if (belowAaForPair(theme?.accent, theme?.surface) !== null) {
      issues.push(t('forms.studio.style.a11y.accentOnSurface', 'Accent on surface'))
    }
    return issues
  }, [theme, t])

  const renderEnumSelect = <Value extends string>(
    id: string,
    label: string,
    current: Value | undefined,
    options: ReadonlyArray<{ value: Value; fallback: string }>,
    labelKeyPrefix: string,
    onPick: (next: Value | undefined) => void,
  ) => (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-medium text-foreground">
        {label}
      </label>
      <Select
        value={current ?? NONE_VALUE}
        onValueChange={(next) => onPick(next === NONE_VALUE ? undefined : (next as Value))}
      >
        <SelectTrigger id={id} className="h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE_VALUE}>{t('forms.studio.style.inherit', 'Default')}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {t(`${labelKeyPrefix}.${option.value}`, option.fallback)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <div className="space-y-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('forms.studio.style.appearance.title', 'Appearance')}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t('forms.studio.style.appearance.helper', 'Brand colors, background, and typography for this form.')}
        </p>
      </div>

      {contrastIssues.length > 0 ? (
        <div className="rounded-md border border-status-warning-border bg-status-warning-bg p-2" role="status">
          <p className="text-xs font-medium text-status-warning-text">
            {t('forms.studio.style.a11y.title', 'Low contrast')}
          </p>
          <ul className="mt-1 list-disc pl-4 text-xs text-status-warning-text">
            {contrastIssues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="block text-sm font-medium text-foreground">
            {t('forms.studio.style.preset.label', 'Preset')}
          </span>
          {hasTheme ? (
            <Button
              type="button"
              variant="ghost"
              size="2xs"
              className="text-muted-foreground"
              onClick={() => { void resetStyling() }}
            >
              {t('forms.studio.style.reset.label', 'Reset')}
            </Button>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {FORM_THEME_PRESETS.map((preset) => {
            const active = themesEqual(theme, preset.theme)
            const bg = backgroundToPreviewCss(preset.theme.background)
              ?? colorToPreviewCss(preset.theme.surface)
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={active}
                onClick={() => { void applyPreset(preset.id) }}
                className={cn(
                  'flex items-center gap-2 rounded-md border p-1.5 text-left transition-colors hover:bg-muted/50',
                  active ? 'border-primary ring-1 ring-primary' : 'border-border',
                )}
              >
                <span
                  aria-hidden="true"
                  className="flex h-7 w-9 shrink-0 items-center justify-center gap-0.5 rounded border border-border"
                  style={{ background: bg }}
                >
                  <span
                    className="h-3 w-3 rounded-full border border-border"
                    style={{ background: colorToPreviewCss(preset.theme.surface) }}
                  />
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ background: colorToPreviewCss(preset.theme.accent) }}
                  />
                </span>
                <span className="truncate text-xs font-medium text-foreground">
                  {t(preset.displayNameKey, preset.fallbackName)}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="space-y-1.5">
        <span className="block text-sm font-medium text-foreground">
          {t('forms.studio.style.logo.label', 'Logo')}
        </span>
        {theme?.logo ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-2">
              <img
                src={buildLogoSrc(theme.logo.assetId)}
                alt=""
                className="max-h-10 w-auto object-contain"
              />
              <div className="ml-auto flex gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="2xs"
                  disabled={logoBusy}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {t('forms.studio.style.logo.replace', 'Replace')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="2xs"
                  className="text-status-error-text"
                  onClick={() => patch({ logo: undefined })}
                >
                  {t('forms.studio.style.logo.remove', 'Remove')}
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-muted-foreground">
                  {t('forms.studio.style.logo.size', 'Size')}
                </label>
                <Select
                  value={theme.logo.size ?? 'md'}
                  onValueChange={(value) => patchLogo({ size: value as OmLogoSize })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LOGO_SIZES.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {t(`forms.studio.style.logo.sizeOption.${option.value}`, option.fallback)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-muted-foreground">
                  {t('forms.studio.style.logo.align', 'Alignment')}
                </label>
                <Select
                  value={theme.logo.align ?? 'start'}
                  onValueChange={(value) => patchLogo({ align: value as OmTextAlign })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LOGO_ALIGNS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {t(`forms.studio.style.align.${option.value}`, option.fallback)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="2xs"
            disabled={logoBusy}
            onClick={() => fileInputRef.current?.click()}
          >
            {logoBusy
              ? t('forms.studio.style.logo.uploading', 'Uploading…')
              : t('forms.studio.style.logo.upload', 'Upload logo')}
          </Button>
        )}
        {logoError ? (
          <p className="text-xs text-status-error-text" role="alert">
            {logoError}
          </p>
        ) : null}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            void handleLogoFile(file ?? undefined)
          }}
        />
      </div>

      <BackgroundControl
        label={t('forms.studio.style.theme.background', 'Background')}
        value={theme?.background}
        onChange={(next) => patch({ background: next })}
      />

      <ColorControl
        label={t('forms.studio.style.theme.surface', 'Surface')}
        value={theme?.surface}
        onChange={(next) => patch({ surface: next })}
      />
      <ColorControl
        label={t('forms.studio.style.theme.foreground', 'Body text')}
        value={theme?.foreground}
        onChange={(next) => patch({ foreground: next })}
        contrastAgainst={theme?.surface}
      />
      <ColorControl
        label={t('forms.studio.style.theme.inputText', 'Input text')}
        value={theme?.inputText}
        onChange={(next) => patch({ inputText: next })}
        contrastAgainst={theme?.surface}
      />
      <ColorControl
        label={t('forms.studio.style.theme.labelColor', 'Label color')}
        value={theme?.labelColor}
        onChange={(next) => patch({ labelColor: next })}
        contrastAgainst={theme?.surface}
      />
      {renderEnumSelect(
        'forms-studio-theme-label-weight',
        t('forms.studio.style.theme.labelWeight', 'Label weight'),
        theme?.labelWeight,
        LABEL_WEIGHTS,
        'forms.studio.style.weight',
        (next) => patch({ labelWeight: next }),
      )}
      <ColorControl
        label={t('forms.studio.style.theme.accent', 'Accent')}
        value={theme?.accent}
        onChange={(next) => patch({ accent: next })}
        contrastAgainst={theme?.surface}
      />
      <ColorControl
        label={t('forms.studio.style.theme.border', 'Border')}
        value={theme?.border}
        onChange={(next) => patch({ border: next })}
      />

      {renderEnumSelect(
        'forms-studio-theme-font-family',
        t('forms.studio.style.theme.fontFamily', 'Font'),
        theme?.fontFamily,
        FONT_FAMILIES,
        'forms.studio.style.fontFamily',
        (next) => patch({ fontFamily: next }),
      )}
      {renderEnumSelect(
        'forms-studio-theme-font-scale',
        t('forms.studio.style.theme.fontScale', 'Text size'),
        theme?.fontScale,
        FONT_SCALES,
        'forms.studio.style.fontScale',
        (next) => patch({ fontScale: next }),
      )}
      {renderEnumSelect(
        'forms-studio-theme-radius',
        t('forms.studio.style.theme.radius', 'Corner radius'),
        theme?.radius,
        RADIUS_SCALES,
        'forms.studio.style.radius',
        (next) => patch({ radius: next }),
      )}
      {renderEnumSelect(
        'forms-studio-theme-content-width',
        t('forms.studio.style.theme.contentWidth', 'Content width'),
        theme?.contentWidth,
        CONTENT_WIDTHS,
        'forms.studio.style.contentWidth',
        (next) => patch({ contentWidth: next }),
      )}
      {ConfirmDialogElement}
    </div>
  )
}
