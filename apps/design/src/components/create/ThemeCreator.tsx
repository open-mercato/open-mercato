'use client'

import * as React from 'react'
import { Check, Code2, Columns2, Contrast, Copy, Dices, ImagePlus, Link2, Moon, RotateCcw, Shuffle, Sun, X } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createColorStudio, type Harmony, type NeutralTone, type Shade } from '@open-mercato/core/modules/design_system/gallery/components/colorStudio'
import { readBrandLogo } from '@open-mercato/core/modules/design_system/gallery/components/styleAgentBranding'
import { Button } from '@open-mercato/ui/primitives/button'
import { DesignScope, type DesignScopeMode } from '@open-mercato/ui/primitives/design-scope'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import { AppFrame, PreviewScreenContent, type PreviewScreen } from './PreviewScreens'
import { themeCode, themeTokens, type ThemeCodeFormat } from '@/lib/theme-code'
import { DEFAULT_PRESET, NAMED_PRESETS, SHADES, decodePreset, encodePreset, namedPresetId, shufflePreset, type ThemePreset } from '@/lib/theme-preset'

type PreviewMode = 'light' | 'dark' | 'compare'
const SURPRISE = 'surprise'
const SCREENS: PreviewScreen[] = ['list', 'record', 'dashboard', 'components']

const HEX = /^#[0-9a-fA-F]{6}$/

function normalizeHex(value: string): string | null {
  const trimmed = value.trim()
  const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`
  return HEX.test(withHash) ? withHash.toUpperCase() : null
}

function ColorField({ id, label, value, onChange, hint }: { id: string; label: string; value: string; onChange: (next: string) => void; hint?: string }) {
  const t = useT()
  const [draft, setDraft] = React.useState(value)
  React.useEffect(() => setDraft(value), [value])
  const invalid = normalizeHex(draft) === null
  return (
    <FormField id={id} label={label} description={invalid ? undefined : hint} error={invalid ? t('design.create.invalidHex') : undefined}>
      <Input
        value={draft}
        spellCheck={false}
        maxLength={7}
        inputClassName="font-mono"
        leading={
          <input
            type="color"
            value={normalizeHex(draft) ?? value}
            aria-label={`${label} ${t('design.create.picker')}`}
            onChange={(event) => onChange(event.target.value.toUpperCase())}
            className="size-5 cursor-pointer rounded-sm border-0 bg-transparent p-0"
          />
        }
        onChange={(event) => {
          setDraft(event.target.value)
          const next = normalizeHex(event.target.value)
          if (next) onChange(next)
        }}
      />
    </FormField>
  )
}

function Scale({ label, stops }: { label: string; stops: Array<{ step: Shade; hex: string }> }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="grid grid-cols-11 overflow-hidden rounded-md border border-border" role="list" aria-label={label}>
        {stops.map((stop) => (
          <span key={stop.step} role="listitem" title={`${stop.step} ${stop.hex}`} aria-label={`${stop.step} ${stop.hex}`} className="h-6" style={{ backgroundColor: stop.hex }} />
        ))}
      </div>
    </div>
  )
}

export function ThemeCreator() {
  const t = useT()
  const [preset, setPreset] = React.useState<ThemePreset>(DEFAULT_PRESET)
  const [mode, setMode] = React.useState<PreviewMode>('light')
  const [screen, setScreen] = React.useState<PreviewScreen>('list')
  const [logo, setLogo] = React.useState<string | null>(null)
  const [logoError, setLogoError] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const [codeOpen, setCodeOpen] = React.useState(false)
  const [format, setFormat] = React.useState<ThemeCodeFormat>('css')
  const fileInput = React.useRef<HTMLInputElement>(null)
  const [ready, setReady] = React.useState(false)

  React.useEffect(() => {
    const fromUrl = decodePreset(new URLSearchParams(window.location.search).get('preset'))
    if (fromUrl) setPreset(fromUrl)
    setReady(true)
  }, [])

  const code = React.useMemo(() => encodePreset(preset), [preset])

  React.useEffect(() => {
    if (!ready) return
    const url = new URL(window.location.href)
    url.searchParams.set('preset', namedPresetId(preset) ?? code)
    window.history.replaceState(null, '', url)
  }, [ready, preset, code])

  const studio = React.useMemo(
    () => createColorStudio(preset.primary, preset.neutral as NeutralTone, { light: preset.light as Shade, dark: preset.dark as Shade }, { harmony: preset.harmony as Harmony, secondary: preset.secondary, tertiary: preset.tertiary }),
    [preset],
  )

  const update = (patch: Partial<ThemePreset>) => {
    setNotice('')
    setPreset((current) => ({ ...current, ...patch }))
  }

  const copy = async (text: string, message: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setNotice(message)
    } catch {
      setNotice(t('design.create.copyFailed'))
    }
  }

  const scopeStyle = (scopeMode: DesignScopeMode) => themeTokens(studio, scopeMode) as React.CSSProperties
  const presetId = namedPresetId(preset) ?? 'custom'
  const snippet = themeCode(format, studio, preset, code)

  const failing = (['light', 'dark'] as const).reduce((count, themeMode) => count + studio[themeMode].pairs.filter((pair) => pair.ratio < pair.minimum).length, 0)

  const preview = (scopeMode: DesignScopeMode) => (
    <DesignScope key={scopeMode} mode={scopeMode} density={preset.density} shape={preset.shape} style={scopeStyle(scopeMode)} data-create-preview={scopeMode} className="min-w-0 overflow-hidden rounded-card border border-border">
      <AppFrame screen={screen} logo={logo}>
        <PreviewScreenContent screen={screen} />
      </AppFrame>
    </DesignScope>
  )

  return (
    <div className="flex flex-col gap-4">
      <div role="toolbar" aria-label={t('design.create.settings')} className="top-16 z-sticky flex flex-wrap md:sticky items-center gap-2 rounded-card border border-border bg-card p-2 shadow-xs">
        <SegmentedControl size="sm" value={screen} aria-label={t('design.create.screen')} onValueChange={(value) => { const next = SCREENS.find((candidate) => candidate === value); if (next) setScreen(next) }}>
          {SCREENS.map((id) => <SegmentedControlItem key={id} value={id}>{t(`design.create.screens.${id}`)}</SegmentedControlItem>)}
        </SegmentedControl>
        <Select value={presetId} onValueChange={(value) => { if (value === SURPRISE) update(shufflePreset()); else if (NAMED_PRESETS[value]) update(NAMED_PRESETS[value]) }}>
          <SelectTrigger size="sm" className="w-36" aria-label={t('design.create.preset')}><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(NAMED_PRESETS).map(([id, named]) => (
              <SelectItem key={id} value={id} leading={<span aria-hidden className="size-3 rounded-full" style={{ backgroundColor: named.primary }} />}>{t(`design.create.presets.${id}`)}</SelectItem>
            ))}
            {presetId === 'custom' ? <SelectItem value="custom" disabled leading={<span aria-hidden className="size-3 rounded-full" style={{ backgroundColor: preset.primary }} />}>{t('design.create.presets.custom')}</SelectItem> : null}
            <SelectSeparator />
            <SelectItem value={SURPRISE} leading={<Dices aria-hidden className="size-4" />}>{t('design.create.surprise')}</SelectItem>
          </SelectContent>
        </Select>
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" size="sm" variant="outline">
              <span aria-hidden className="flex">
                {[studio.seeds.primary, studio.seeds.secondary, studio.seeds.tertiary].map((hex, index) => (
                  <span key={index} className={`size-4 rounded-full border-2 border-background ${index > 0 ? '-ml-1' : ''}`} style={{ backgroundColor: hex }} />
                ))}
              </span>
              {t('design.create.brand')}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="flex max-h-(--radix-popover-content-available-height) w-80 flex-col gap-y-field-stack overflow-y-auto p-panel">
            <ColorField id="create-primary" label={t('design.create.primary')} value={preset.primary} onChange={(primary) => update({ primary })} />
            <Scale label={t('design.create.primaryScale')} stops={studio.scale} />
            <FormField id="create-harmony" label={t('design.create.harmony')} description={t('design.create.harmonyHint')}>
              <Select value={preset.harmony} onValueChange={(value) => { if (value === 'analogous' || value === 'triadic' || value === 'split') update({ harmony: value, secondary: undefined, tertiary: undefined }) }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="analogous">{t('design.create.harmonies.analogous')}</SelectItem>
                  <SelectItem value="triadic">{t('design.create.harmonies.triadic')}</SelectItem>
                  <SelectItem value="split">{t('design.create.harmonies.split')}</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <div className="grid grid-cols-2 gap-x-3 gap-y-field-stack">
              <ColorField id="create-secondary" label={t('design.create.secondary')} value={studio.seeds.secondary} onChange={(secondary) => update({ secondary })} />
              <ColorField id="create-tertiary" label={t('design.create.tertiary')} value={studio.seeds.tertiary} onChange={(tertiary) => update({ tertiary })} />
            </div>
            <Scale label={t('design.create.secondaryScale')} stops={studio.secondaryScale} />
            <Scale label={t('design.create.tertiaryScale')} stops={studio.tertiaryScale} />
            {preset.secondary || preset.tertiary ? (
              <Button type="button" size="sm" variant="ghost" className="self-start" onClick={() => update({ secondary: undefined, tertiary: undefined })}>
                <RotateCcw aria-hidden />
                {t('design.create.autoColors')}
              </Button>
            ) : null}
            <FormField id="create-neutral" label={t('design.create.neutral')}>
              <SegmentedControl size="sm" value={preset.neutral} aria-label={t('design.create.neutral')} onValueChange={(value) => { if (value === 'neutral' || value === 'warm' || value === 'cool') update({ neutral: value }) }}>
                <SegmentedControlItem value="neutral">{t('design.create.neutrals.neutral')}</SegmentedControlItem>
                <SegmentedControlItem value="warm">{t('design.create.neutrals.warm')}</SegmentedControlItem>
                <SegmentedControlItem value="cool">{t('design.create.neutrals.cool')}</SegmentedControlItem>
              </SegmentedControl>
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              {(['light', 'dark'] as const).map((themeMode) => (
                <FormField key={themeMode} id={`create-shade-${themeMode}`} label={t(`design.create.actionShade.${themeMode}`)}>
                  <Select value={String(preset[themeMode])} onValueChange={(value) => { const next = Number(value); if ((SHADES as readonly number[]).includes(next)) update({ [themeMode]: next } as Partial<ThemePreset>) }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SHADES.map((step) => <SelectItem key={step} value={String(step)}>{step}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FormField>
              ))}
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-sm text-foreground">{t('design.create.logo')}</span>
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                aria-label={t('design.create.uploadLogo')}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (!file) return
                  setLogoError('')
                  readBrandLogo(file).then(setLogo).catch(() => setLogoError(t('design.create.logoError')))
                }}
              />
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => fileInput.current?.click()}>
                  <ImagePlus aria-hidden />
                  {t('design.create.uploadLogo')}
                </Button>
                {logo ? (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setLogo(null)}>
                    <X aria-hidden />
                    {t('design.create.removeLogo')}
                  </Button>
                ) : null}
              </div>
              {logoError ? <p role="alert" className="text-xs text-status-error-text">{logoError}</p> : <p className="text-xs text-muted-foreground">{t('design.create.logoHint')}</p>}
            </div>
          </PopoverContent>
        </Popover>
        <Select value={preset.shape} onValueChange={(value) => { if (value === 'default' || value === 'round' || value === 'sharp') update({ shape: value }) }}>
          <SelectTrigger size="sm" className="w-28" aria-label={t('design.home.panel.shape')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="default">{t('design.home.panel.shapeDefault')}</SelectItem>
            <SelectItem value="round">{t('design.home.panel.shapeRound')}</SelectItem>
            <SelectItem value="sharp">{t('design.home.panel.shapeSharp')}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={preset.density} onValueChange={(value) => { if (value === 'default' || value === 'compact') update({ density: value }) }}>
          <SelectTrigger size="sm" className="w-32" aria-label={t('design.home.panel.density')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="default">{t('design.home.panel.densityDefault')}</SelectItem>
            <SelectItem value="compact">{t('design.home.panel.densityCompact')}</SelectItem>
          </SelectContent>
        </Select>
        <div className="contents">
          <SegmentedControl size="sm" value={mode} aria-label={t('design.home.panel.mode')} onValueChange={(value) => { if (value === 'light' || value === 'dark' || value === 'compare') setMode(value) }}>
            <SegmentedControlItem value="light" aria-label={t('design.home.panel.modeLight')} title={t('design.home.panel.modeLight')}><Sun aria-hidden className="size-4" /></SegmentedControlItem>
            <SegmentedControlItem value="dark" aria-label={t('design.home.panel.modeDark')} title={t('design.home.panel.modeDark')}><Moon aria-hidden className="size-4" /></SegmentedControlItem>
            <SegmentedControlItem value="compare" aria-label={t('design.create.compare')} title={t('design.create.compare')}><Columns2 aria-hidden className="size-4" /></SegmentedControlItem>
          </SegmentedControl>
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" size="sm" variant="outline" aria-label={t('design.create.contrast')} title={t('design.create.contrast')}>
                <Contrast aria-hidden />
                <StatusBadge variant={failing === 0 ? 'success' : 'error'}>{failing === 0 ? t('design.create.pass') : t('design.create.failCount', { count: failing })}</StatusBadge>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="flex max-h-(--radix-popover-content-available-height) w-80 flex-col gap-4 overflow-y-auto p-panel">
              {(['light', 'dark'] as const).map((themeMode) => (
                <ul key={themeMode} aria-label={t(`design.home.panel.mode${themeMode === 'light' ? 'Light' : 'Dark'}`)} className="flex flex-col gap-2">
                  <li className="text-xs text-muted-foreground">{t(`design.home.panel.mode${themeMode === 'light' ? 'Light' : 'Dark'}`)}</li>
                  {studio[themeMode].pairs.map((pair) => {
                    const pass = pair.ratio >= pair.minimum
                    return (
                      <li key={pair.id} className="flex items-center justify-between gap-3 text-sm">
                        <span className="flex min-w-0 items-center gap-2">
                          <span aria-hidden className="flex h-6 w-10 shrink-0 items-center justify-center rounded-sm border border-border text-xs" style={{ backgroundColor: pair.background, color: pair.foreground }}>Aa</span>
                          <span className="truncate text-foreground">{t(`design.create.pairs.${pair.id}`)}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="font-mono text-xs tabular-nums text-muted-foreground">{pair.ratio.toFixed(1)}:1</span>
                          <StatusBadge variant={pass ? 'success' : 'error'}>{pass ? t('design.create.pass') : t('design.create.fail')}</StatusBadge>
                        </span>
                      </li>
                    )
                  })}
                </ul>
              ))}
            </PopoverContent>
          </Popover>
          <SimpleTooltip content={t('design.create.shuffle')}>
            <IconButton type="button" size="default" variant="outline" aria-label={t('design.create.shuffle')} onClick={() => update(shufflePreset())}><Shuffle aria-hidden /></IconButton>
          </SimpleTooltip>
          <SimpleTooltip content={t('design.create.reset')}>
            <IconButton type="button" size="default" variant="outline" aria-label={t('design.create.reset')} onClick={() => { update(DEFAULT_PRESET); setLogo(null) }}><RotateCcw aria-hidden /></IconButton>
          </SimpleTooltip>
          <SimpleTooltip content={t('design.create.copyLink')}>
            <IconButton type="button" size="default" variant="outline" aria-label={t('design.create.copyLink')} onClick={() => void copy(window.location.href, t('design.create.linkCopied'))}><Link2 aria-hidden /></IconButton>
          </SimpleTooltip>
          <Button type="button" size="sm" onClick={() => setCodeOpen(true)}>
            <Code2 aria-hidden />
            {t('design.create.getCode')}
          </Button>
        </div>
      </div>
      <p aria-live="polite" className="sr-only">{notice}</p>

      <section aria-labelledby="create-preview-title" className="min-w-0">
        <h2 id="create-preview-title" className="sr-only">{t('design.create.preview')}</h2>
        {mode === 'compare' ? <div className="grid gap-gutter 2xl:grid-cols-2">{preview('light')}{preview('dark')}</div> : preview(mode)}
      </section>

      <Dialog open={codeOpen} onOpenChange={setCodeOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('design.create.codeTitle')}</DialogTitle>
            <DialogDescription>{t('design.create.codeBody')}</DialogDescription>
          </DialogHeader>
          <SegmentedControl size="sm" value={format} aria-label={t('design.create.format')} onValueChange={(value) => { if (value === 'css' || value === 'react' || value === 'json') setFormat(value) }}>
            <SegmentedControlItem value="css">CSS</SegmentedControlItem>
            <SegmentedControlItem value="react">React</SegmentedControlItem>
            <SegmentedControlItem value="json">JSON</SegmentedControlItem>
          </SegmentedControl>
          <pre data-create-code={format} className="max-h-96 overflow-auto rounded-md border border-border bg-muted p-3 font-mono text-xs text-foreground">{snippet}</pre>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p aria-live="polite" className="text-xs text-muted-foreground">{notice}</p>
            <Button type="button" onClick={() => void copy(snippet, t('design.create.codeCopied'))}>
              {notice === t('design.create.codeCopied') ? <Check aria-hidden /> : <Copy aria-hidden />}
              {t('design.create.copyCode')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
