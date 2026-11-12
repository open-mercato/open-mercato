'use client'

import * as React from 'react'
import { ArrowLeft, ArrowRight, GripVertical, Check, Copy, RotateCcw, Sun, Moon, Paintbrush, MousePointer2, Layers, CircleCheck } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { readThemeTokens, type ThemeTokens } from './themeTokens'
import { contrastRatio, normalizeHex } from './colorPreview'
import { createColorStudio, exportColorStudio, type ColorStudio, type ColorStop, type Harmony, type NeutralTone, type Shade } from './colorStudio'
import { ColorStudioSpecimen } from './ColorStudioSpecimen'
import { ColorStudioCompositions } from './ColorStudioCompositions'

const INITIAL_COLOR = '#F4700D'
const PRESETS = ['#BC9AFF', INITIAL_COLOR, '#2563EB', '#0F766E', '#BE185D']
const THEMES = ['light', 'dark'] as const
const ROLE_ICONS = { action: Paintbrush, selection: MousePointer2, surface: Layers, status: CircleCheck }

function ShadeSelect({ label, scale, value, onChange }: { label: string; scale: ColorStop[]; value: Shade; onChange: (shade: Shade) => void }) {
  const id = React.useId()
  return <div className="min-w-0 space-y-2">
    <Label htmlFor={id}>{label}</Label>
    <Select value={String(value)} onValueChange={next => {
      const stop = scale.find(item => String(item.step) === next)
      if (stop) onChange(stop.step)
    }}>
      <SelectTrigger id={id} aria-label={label}><SelectValue /></SelectTrigger>
      <SelectContent>{scale.map(stop => <SelectItem key={stop.step} value={String(stop.step)}>
        <span className="inline-flex items-center gap-2"><span aria-hidden className="size-4 shrink-0 rounded-sm border border-border" style={{ backgroundColor: stop.hex }} /><span className="font-mono text-xs">{stop.step} · {stop.hex}</span></span>
      </SelectItem>)}</SelectContent>
    </Select>
  </div>
}

const COLOR_ROLES = ['primary', 'secondary', 'tertiary'] as const
type ColorRole = typeof COLOR_ROLES[number]

function ColorRoleSwap({ role, disabled, onSwap, onDragStart, onDragEnd }: {
  role: ColorRole
  disabled: boolean
  onSwap: (first: ColorRole, second: ColorRole) => void
  onDragStart: (event: React.DragEvent) => void
  onDragEnd: () => void
}) {
  const t = useT()
  const index = COLOR_ROLES.indexOf(role)
  return <div className="flex items-center gap-1">
    <span draggable={!disabled} onDragStart={onDragStart} onDragEnd={onDragEnd} title={t('design_system.colorStudio.dragColor')} className="inline-flex size-8 cursor-grab items-center justify-center text-muted-foreground active:cursor-grabbing" aria-hidden>
      <GripVertical className="size-4" />
    </span>
    {(['left', 'right'] as const).map(direction => {
      const target = COLOR_ROLES[index + (direction === 'left' ? -1 : 1)]
      const Icon = direction === 'left' ? ArrowLeft : ArrowRight
      return <Button key={direction} type="button" variant="ghost" size="icon" disabled={disabled || !target} aria-label={`${t(`design_system.colorStudio.move${direction === 'left' ? 'Left' : 'Right'}`)}: ${t(`design_system.colorStudio.${role}`)}`} className="shrink-0 text-muted-foreground" onClick={() => { if (target) onSwap(role, target) }}>
        <Icon aria-hidden className="size-4" />
      </Button>
    })}
  </div>
}

export function ColorPlayground({ initialSeeds, initialActionShades, initialView = 'compare', logo, onStudioChange }: {
  initialSeeds?: ColorStudio['seeds']
  initialActionShades?: { light?: Shade; dark?: Shade }
  initialView?: 'light' | 'dark' | 'compare'
  logo?: string | null
  onStudioChange?: (studio: ColorStudio, valid: boolean) => void
} = {}) {
  const t = useT()
  const id = React.useId()
  const [color, setColor] = React.useState(initialSeeds?.primary ?? INITIAL_COLOR)
  const [draft, setDraft] = React.useState(initialSeeds?.primary ?? INITIAL_COLOR)
  const [harmony, setHarmony] = React.useState<Harmony>('triadic')
  const [supporting, setSupporting] = React.useState<{ secondary?: string; tertiary?: string }>(initialSeeds ? { secondary: initialSeeds.secondary, tertiary: initialSeeds.tertiary } : {})
  const [supportingDrafts, setSupportingDrafts] = React.useState<{ secondary?: string; tertiary?: string }>(initialSeeds ? { secondary: initialSeeds.secondary, tertiary: initialSeeds.tertiary } : {})
  const [neutral, setNeutral] = React.useState<NeutralTone>('neutral')
  const [view, setView] = React.useState<'light' | 'dark' | 'compare'>(initialView)
  const [actionShades, setActionShades] = React.useState<{ light?: Shade; dark?: Shade }>(initialActionShades ?? {})
  const [hostTokens, setHostTokens] = React.useState<ThemeTokens | null>(null)
  const [matrixForeground, setMatrixForeground] = React.useState<Shade>(900)
  const [matrixBackground, setMatrixBackground] = React.useState<Shade>(50)
  const [draggedRole, setDraggedRole] = React.useState<ColorRole | null>(null)
  const [dropRole, setDropRole] = React.useState<ColorRole | null>(null)
  const [feedback, setFeedback] = React.useState('')
  const [resetVersion, setResetVersion] = React.useState(0)
  const invalid = !normalizeHex(draft)
  const hasManualColors = Object.keys(supportingDrafts).length > 0
  const studio = React.useMemo(() => createColorStudio(color, neutral, actionShades, { harmony, ...supporting }), [color, neutral, actionShades, harmony, supporting])

  React.useEffect(() => {
    onStudioChange?.(studio, !invalid && Object.values(supportingDrafts).every(value => Boolean(normalizeHex(value))))
  }, [studio, invalid, supportingDrafts, onStudioChange])

  const matrixText = studio.scale.find(stop => stop.step === matrixForeground)!.hex
  const matrixSurface = studio.scale.find(stop => stop.step === matrixBackground)!.hex
  const matrixRatio = contrastRatio(matrixText, matrixSurface)

  React.useEffect(() => { setHostTokens(readThemeTokens(document.styleSheets)) }, [])

  function chooseColor(value: string) {
    setDraft(value)
    const normalized = normalizeHex(value)
    if (normalized) setColor(normalized)
    setFeedback('')
  }

  function swapColors(first: keyof ColorStudio['seeds'], second: keyof ColorStudio['seeds']) {
    if (invalid || Object.values(supportingDrafts).some(value => !normalizeHex(value))) return
    const next = { ...studio.seeds, [first]: studio.seeds[second], [second]: studio.seeds[first] }
    setColor(next.primary)
    setDraft(next.primary)
    setSupporting({ secondary: next.secondary, tertiary: next.tertiary })
    setSupportingDrafts({ secondary: next.secondary, tertiary: next.tertiary })
    if (first === 'primary' || second === 'primary') setActionShades({})
    setFeedback(t('design_system.colorStudio.swapped'))
  }

  function reset() {
    chooseColor(INITIAL_COLOR)
    setNeutral('neutral')
    setHarmony('triadic')
    setSupporting({})
    setSupportingDrafts({})
    setView(initialView)
    setActionShades({})
    setMatrixForeground(900)
    setMatrixBackground(50)
    setResetVersion(previous => previous + 1)
  }

  async function copy(value: string, message: string) {
    try {
      await navigator.clipboard.writeText(value)
      setFeedback(message)
    } catch { setFeedback(t('design_system.colorPreview.copyFailed')) }
  }

  const swapDisabled = invalid || Object.values(supportingDrafts).some(value => !normalizeHex(value))
  function dragStart(role: ColorRole, event: React.DragEvent) {
    if (swapDisabled) { event.preventDefault(); return }
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', role)
    setDraggedRole(role)
  }
  function dragEnd() { setDraggedRole(null); setDropRole(null) }
  function dropProps(role: ColorRole) {
    return {
      'data-color-role': role,
      className: `space-y-2 rounded-lg transition-shadow ${dropRole === role ? 'ring-2 ring-ring' : ''}`,
      onDragOver: (event: React.DragEvent) => {
        if (!draggedRole || draggedRole === role || swapDisabled) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        setDropRole(role)
      },
      onDragLeave: (event: React.DragEvent<HTMLDivElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropRole(null)
      },
      onDrop: (event: React.DragEvent) => {
        event.preventDefault()
        if (draggedRole && draggedRole !== role && !swapDisabled) swapColors(draggedRole, role)
        dragEnd()
      },
    }
  }

  return <section className="space-y-8" aria-labelledby={`${id}-title`} data-example="color-playground">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-2xl space-y-2">
        <h2 id={`${id}-title`} className="text-2xl font-medium tracking-tight">{t('design_system.colorStudio.title')}</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">{t('design_system.colorStudio.description')}</p>
      </div>
      <Button type="button" variant="ghost" onClick={reset}><RotateCcw aria-hidden />{t('design_system.colorPreview.reset')}</Button>
    </header>

    <div className="space-y-6 rounded-xl border border-border bg-card p-5 sm:p-6">
      <div className="grid gap-5 sm:grid-cols-3">
        <div {...dropProps('primary')}>
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor={`${id}-hex`}>{t('design_system.colorStudio.primary')}</Label>
            <ColorRoleSwap role="primary" disabled={swapDisabled} onSwap={swapColors} onDragStart={event => dragStart('primary', event)} onDragEnd={dragEnd} />
          </div>
          <div className="flex items-center gap-2">
            <Input type="color" value={color} aria-label={t('design_system.colorPreview.color')} onChange={event => chooseColor(event.target.value)} className="w-12 shrink-0 p-1" inputClassName="h-full w-full cursor-pointer p-0" />
            <Input id={`${id}-hex`} aria-label={t('design_system.colorPreview.hex')} value={draft} onChange={event => chooseColor(event.target.value)} onBlur={() => { const value = normalizeHex(draft); if (value) setDraft(value) }} inputClassName="font-mono" aria-invalid={invalid} aria-describedby={invalid ? `${id}-error` : undefined} spellCheck={false} maxLength={7} />
          </div>
        </div>
        {(['secondary', 'tertiary'] as const).map(role => {
          const value = supportingDrafts[role] ?? studio.seeds[role]
          const valid = Boolean(normalizeHex(value))
          const change = (next: string) => {
            setSupportingDrafts(previous => ({ ...previous, [role]: next }))
            const normalized = normalizeHex(next)
            if (normalized) setSupporting(previous => ({ ...previous, [role]: normalized }))
            setFeedback('')
          }
          return <div key={role} {...dropProps(role)}>
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor={`${id}-${role}`}>{t(`design_system.colorStudio.${role}`)}</Label>
              <ColorRoleSwap role={role} disabled={swapDisabled} onSwap={swapColors} onDragStart={event => dragStart(role, event)} onDragEnd={dragEnd} />
            </div>
            <div className="flex items-center gap-2">
              <Input type="color" value={studio.seeds[role]} aria-label={t(`design_system.colorStudio.${role}`)} onChange={event => change(event.target.value)} className="w-12 shrink-0 p-1" inputClassName="h-full w-full cursor-pointer p-0" />
              <Input id={`${id}-${role}`} value={value} aria-label={`${t(`design_system.colorStudio.${role}`)} HEX`} onChange={event => change(event.target.value)} inputClassName="font-mono" aria-invalid={!valid} aria-describedby={!valid ? `${id}-${role}-error` : undefined} maxLength={7} spellCheck={false} />
            </div>
            {!valid ? <p id={`${id}-${role}-error`} role="alert" className="text-xs text-status-error-text">{t(`design_system.colorStudio.${role}Invalid`)}</p> : null}
          </div>
        })}
      </div>
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <div className="space-y-2">
          <Label htmlFor={`${id}-harmony`}>{t('design_system.colorStudio.harmony')}</Label>
          <Select value={harmony} onValueChange={value => { if (value === 'analogous' || value === 'triadic' || value === 'split') { setHarmony(value); setSupporting({}); setSupportingDrafts({}); setFeedback('') } }}>
            <SelectTrigger id={`${id}-harmony`} aria-label={t('design_system.colorStudio.harmony')} aria-describedby={`${id}-harmony-description`}><SelectValue /></SelectTrigger>
            <SelectContent>{(['analogous', 'triadic', 'split'] as const).map(mode => <SelectItem key={mode} value={mode}>{t(`design_system.colorStudio.harmony.${mode}`)}</SelectItem>)}</SelectContent>
          </Select>
          <p id={`${id}-harmony-description`} className="text-xs leading-relaxed text-muted-foreground">{t(`design_system.colorStudio.harmonyDescription.${harmony}`)}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-neutral`}>{t('design_system.colorStudio.neutral')}</Label>
          <Select value={neutral} onValueChange={value => { if (value === 'neutral' || value === 'warm' || value === 'cool') { setNeutral(value); setFeedback('') } }}>
            <SelectTrigger id={`${id}-neutral`} aria-label={t('design_system.colorStudio.neutral')}><SelectValue /></SelectTrigger>
            <SelectContent>{(['neutral', 'warm', 'cool'] as const).map(tone => <SelectItem key={tone} value={tone}>{t(`design_system.colorStudio.neutral.${tone}`)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {THEMES.map(theme => <ShadeSelect key={theme} label={t(`design_system.colorStudio.${theme}Action`)} scale={studio.scale} value={studio[theme].actionStep} onChange={shade => { setActionShades(previous => ({ ...previous, [theme]: shade })); setFeedback('') }} />)}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
        <div className="max-w-2xl space-y-2">
          <p className="text-sm leading-relaxed">{t('design_system.colorStudio.harmonyHint')}</p>
          <p role="status" className="text-xs leading-relaxed text-muted-foreground">{t(`design_system.colorStudio.${hasManualColors ? 'harmonyManual' : 'harmonyAutomatic'}`)}</p>
        </div>
        {hasManualColors ? <Button type="button" size="sm" variant="secondary" onClick={() => { setSupporting({}); setSupportingDrafts({}); setFeedback(t('design_system.colorStudio.harmonyRestored')) }}><RotateCcw aria-hidden />{t('design_system.colorStudio.auto')}</Button> : null}
      </div>
      {invalid ? <p id={`${id}-error`} role="alert" className="text-sm text-status-error-text">{t('design_system.colorPreview.invalid')}</p> : null}
      <div className="flex flex-wrap gap-2">{PRESETS.map(preset => <Button type="button" key={preset} variant="ghost" size="sm" onClick={() => chooseColor(preset)} aria-pressed={color === preset}>
        <span aria-hidden className="size-4 shrink-0 rounded-full border border-border" style={{ backgroundColor: preset }} /><span className="font-mono text-xs">{preset}</span>{color === preset ? <Check className="size-3" aria-hidden /> : null}
      </Button>)}</div>
      <div className="space-y-3 border-t border-border pt-5">
        <div className="space-y-1"><h3 className="text-sm font-medium">{t('design_system.colorStudio.scale')}</h3><p className="text-xs leading-relaxed text-muted-foreground">{t('design_system.colorStudio.scaleHint')}</p></div>
        {([
          { role: 'primary', scale: studio.scale, seed: studio.seeds.primary },
          { role: 'secondary', scale: studio.secondaryScale, seed: studio.seeds.secondary },
          { role: 'tertiary', scale: studio.tertiaryScale, seed: studio.seeds.tertiary },
        ] as const).map(({ role, scale, seed }) => <div key={role} className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">{t(`design_system.colorStudio.${role}`)}</h4>
          <div className="grid grid-cols-3 gap-1 sm:grid-cols-6 xl:grid-cols-11">
            {scale.map(stop => <Button type="button" key={stop.step} variant="ghost" className="h-24 min-w-0 flex-col items-start justify-end gap-1 rounded-lg px-2 py-3 text-left" style={{ backgroundColor: stop.hex, color: contrastRatio(stop.hex, '#FFFFFF') >= contrastRatio(stop.hex, '#000000') ? '#FFFFFF' : '#000000' }} aria-label={`${t('design_system.colorStudio.copyColor')} ${t(`design_system.colorStudio.${role}`)} ${stop.step} ${stop.hex}`} onClick={() => copy(stop.hex, `${t('design_system.colorStudio.copiedColor')}: ${stop.hex}`)}>
              <span className="flex w-full items-center justify-between gap-1 text-xs"><span className="font-semibold">{stop.step}</span>{stop.hex === seed ? <span title={t('design_system.colorStudio.base')}><Paintbrush className="size-3" aria-hidden /><span className="sr-only">{t('design_system.colorStudio.base')}</span></span> : null}</span>
              <code className="text-xs font-normal">{stop.hex}</code>
            </Button>)}
          </div>
        </div>)}
      </div>
    </div>

    <section className="space-y-4" aria-labelledby={`${id}-preview-title`}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-xl space-y-1"><h3 id={`${id}-preview-title`} className="text-lg font-medium">{t('design_system.colorStudio.preview')}</h3><p className="text-xs leading-relaxed text-muted-foreground">{t('design_system.colorStudio.previewHint')}</p></div>
        <SegmentedControl value={view} onValueChange={value => { if (value === 'light' || value === 'dark' || value === 'compare') setView(value) }} aria-label={t('design_system.colorPreview.theme')}>
          <SegmentedControlItem value="light">{t('design_system.colorPreview.light')}</SegmentedControlItem>
          <SegmentedControlItem value="dark">{t('design_system.colorPreview.dark')}</SegmentedControlItem>
          <SegmentedControlItem value="compare">{t('design_system.colorStudio.compare')}</SegmentedControlItem>
        </SegmentedControl>
      </div>
      <div className={view === 'compare' ? 'grid min-w-0 gap-5 xl:grid-cols-2' : 'min-w-0'}>
        {THEMES.filter(theme => view === 'compare' || theme === view).map(theme => <div key={theme} className="min-w-0 space-y-3">
          <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">{theme === 'light' ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}{t(`design_system.colorPreview.${theme}`)}</p>
          <ColorStudioCompositions theme={theme} tokens={{ ...hostTokens?.[theme], ...studio[theme].tokens }} />
          <ColorStudioSpecimen logo={logo} key={`${theme}-${resetVersion}`} theme={theme} tokens={{ ...hostTokens?.[theme], ...studio[theme].tokens }} />
        </div>)}
      </div>
    </section>

    <section className="space-y-4" aria-labelledby={`${id}-roles-title`}>
      <h3 id={`${id}-roles-title`} className="text-lg font-medium">{t('design_system.colorStudio.roles')}</h3>
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">{(Object.keys(ROLE_ICONS) as (keyof typeof ROLE_ICONS)[]).map(role => {
        const Icon = ROLE_ICONS[role]
        return <div key={role} className="space-y-3 border-t border-border pt-4"><Icon aria-hidden className="size-5 text-muted-foreground" /><h4 className="text-sm font-medium">{t(`design_system.colorStudio.roles.${role}`)}</h4><p className="text-xs leading-relaxed text-muted-foreground">{t(`design_system.colorStudio.roles.${role}Hint`)}</p></div>
      })}</div>
    </section>

    <section className="space-y-4" aria-labelledby={`${id}-contrast-title`}>
      <div className="max-w-3xl space-y-1"><h3 id={`${id}-contrast-title`} className="text-lg font-medium">{t('design_system.colorStudio.contrast')}</h3><p className="text-xs leading-relaxed text-muted-foreground">{t('design_system.colorStudio.contrastHint')}</p></div>
      <div className="grid gap-5 rounded-xl border border-border p-5 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="space-y-1"><h4 className="text-sm font-medium">{t('design_system.colorStudio.matrix')}</h4><p className="text-xs leading-relaxed text-muted-foreground">{t('design_system.colorStudio.matrixHint')}</p></div>
          <div className="grid grid-cols-2 gap-3"><ShadeSelect label={t('design_system.colorStudio.foreground')} scale={studio.scale} value={matrixForeground} onChange={setMatrixForeground} /><ShadeSelect label={t('design_system.colorStudio.background')} scale={studio.scale} value={matrixBackground} onChange={setMatrixBackground} /></div>
        </div>
        <div className="flex items-center justify-between gap-4 rounded-lg p-6" style={{ backgroundColor: matrixSurface, color: matrixText }}>
          <div className="space-y-2"><span className="text-4xl font-medium">Aa</span><p className="text-sm">{t('design_system.colorStudio.pair.body')}</p></div>
          <div className="space-y-2 rounded-md bg-card px-3 py-2 text-right text-card-foreground"><p className="font-mono text-xl font-semibold">{matrixRatio.toFixed(2)}:1</p><p className="text-xs">{t(`design_system.colorStudio.${matrixRatio >= 4.5 ? 'pass' : 'fail'}`)}</p></div>
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-border">
        <div className="grid grid-cols-3 gap-3 bg-muted px-4 py-3 text-xs font-medium text-muted-foreground"><span>{t('design_system.colorStudio.pair')}</span>{THEMES.map(theme => <span key={theme}>{t(`design_system.colorPreview.${theme}`)}</span>)}</div>
        <dl className="divide-y divide-border">{studio.light.pairs.map(pair => <div key={pair.id} className="grid grid-cols-3 items-center gap-3 px-4 py-3">
          <dt className="space-y-1"><p className="text-sm font-medium">{t(`design_system.colorStudio.pair.${pair.id}`)}</p><p className="text-xs text-muted-foreground">{t('design_system.colorStudio.minimum')}: {pair.minimum}:1</p></dt>
          {THEMES.map(theme => {
            const item = studio[theme].pairs.find(candidate => candidate.id === pair.id)!
            const passing = item.ratio >= item.minimum
            return <dd key={theme} className="flex flex-wrap items-center gap-3">
              <span aria-hidden className="inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-border font-semibold" style={{ backgroundColor: item.background, color: item.foreground }}>Aa</span>
              <div className="space-y-1"><p className="font-mono text-sm">{item.ratio.toFixed(2)}:1</p><Badge variant={passing ? 'success' : 'error'}>{t(`design_system.colorStudio.${passing ? 'pass' : 'fail'}`)}</Badge><p className="font-mono text-xs text-muted-foreground">{item.foreground}<br />{item.background}</p></div>
            </dd>
          })}
        </div>)}</dl>
      </div>
    </section>

    <section className="space-y-4 border-t border-border pt-6" aria-labelledby={`${id}-export-title`}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="max-w-xl space-y-1"><h3 id={`${id}-export-title`} className="text-lg font-medium">{t('design_system.colorStudio.export')}</h3><p className="text-xs leading-relaxed text-muted-foreground">{t('design_system.colorStudio.exportHint')}</p></div>
        <div className="flex flex-wrap gap-2">{(['css', 'json'] as const).map(format => <Button type="button" key={format} variant="secondary" onClick={() => copy(exportColorStudio(studio, format), t('design_system.colorPreview.copied'))}><Copy aria-hidden />{t(`design_system.colorStudio.${format === 'css' ? 'copyCss' : 'copyJson'}`)}</Button>)}</div>
      </div>
      <div className="max-w-3xl space-y-1"><h4 className="text-sm font-medium">{t('design_system.colorStudio.algorithm')}</h4><p className="text-xs leading-relaxed text-muted-foreground">{t('design_system.colorStudio.algorithmHint')}</p></div>
      <section className="rounded-lg border border-border"><h3 className="p-4 text-sm font-medium">{t('design_system.colorStudio.showTokens')}</h3><pre className="max-h-80 overflow-auto border-t border-border bg-muted p-4 text-xs leading-relaxed"><code>{exportColorStudio(studio, 'css')}</code></pre></section>
    </section>
    <p role="status" aria-live="polite" className="sticky bottom-4 z-10 w-fit rounded-lg bg-popover px-3 py-2 text-xs text-popover-foreground empty:hidden">{feedback}</p>
  </section>
}
