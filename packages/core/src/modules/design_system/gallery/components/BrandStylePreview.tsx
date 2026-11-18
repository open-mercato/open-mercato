'use client'

import * as React from 'react'
import { Check, Moon, Sun, TriangleAlert } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { FancyButton } from '@open-mercato/ui/primitives/fancy-button'
import { contrastRatio } from './colorPreview'

const DEFAULT_LOGO = '/open-mercato.svg'
const MINIMUM_TEXT_CONTRAST = 4.5

type BrandTokens = Record<string, string | undefined>

function Swatch({ color, label }: { color: string | undefined; label: string }) {
  return (
    <li className="flex min-w-0 items-center gap-2">
      <span aria-hidden className="size-4 shrink-0 rounded-sm border border-border" style={{ backgroundColor: color }} />
      <span className="min-w-0 truncate text-xs text-muted-foreground">{label}</span>
      <code className="ml-auto shrink-0 text-xs uppercase text-foreground">{color}</code>
    </li>
  )
}

function ThemePreview({ theme, tokens, hostTokens, logo }: {
  theme: 'light' | 'dark'
  tokens: BrandTokens
  hostTokens: Record<string, string> | undefined
  logo: string | null
}) {
  const t = useT()
  const primary = tokens['--primary']
  const foreground = tokens['--primary-foreground']
  const ratio = primary && foreground ? contrastRatio(foreground, primary) : null
  const readable = ratio !== null && ratio >= MINIMUM_TEXT_CONTRAST
  const ThemeIcon = theme === 'light' ? Sun : Moon
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background text-foreground shadow-xs" style={{ ...hostTokens, ...tokens } as React.CSSProperties} data-brand-preview={theme}>
      <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-3">
        <img src={logo ?? DEFAULT_LOGO} alt="" className="size-7 shrink-0 rounded-md object-contain" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{t('design_system.styleAgents.previewWorkspace')}</span>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"><ThemeIcon aria-hidden className="size-3.5" />{t(`design_system.colorPreview.${theme}`)}</span>
      </div>
      <div className="space-y-5 p-4 sm:p-5">
        <div className="space-y-1">
          <p className="text-sm font-medium">{t('design_system.styleAgents.previewHeading')}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">{t('design_system.styleAgents.previewBody')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2" inert aria-hidden="true">
          <Button type="button" size="sm">{t('design_system.styleAgents.actionSample')}</Button>
          <Button type="button" size="sm" variant="outline">{t('design_system.styleAgents.secondarySample')}</Button>
          <FancyButton intent="primary" size="xs" htmlType="button">{t('design_system.styleAgents.brandSample')}</FancyButton>
        </div>
        <ul className="space-y-2 border-t border-border pt-4">
          <Swatch color={primary} label={t('design_system.styleAgents.swatchPrimary')} />
          <Swatch color={tokens['--primary-hover']} label={t('design_system.styleAgents.swatchHover')} />
          <li className="flex min-w-0 items-center gap-2">
            <span aria-hidden className="flex shrink-0 -space-x-1">
              {(['--brand-lime', '--brand-yellow', '--brand-violet'] as const).map(name => <span key={name} className="size-4 rounded-full border border-border" style={{ backgroundColor: tokens[name] }} />)}
            </span>
            <span className="min-w-0 truncate text-xs text-muted-foreground">{t('design_system.styleAgents.swatchAccents')}</span>
          </li>
        </ul>
        {ratio !== null ? (
          <p className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${readable ? 'border-status-success-border bg-status-success-bg text-status-success-text' : 'border-status-warning-border bg-status-warning-bg text-status-warning-text'}`}>
            {readable ? <Check aria-hidden className="size-3.5 shrink-0 text-status-success-icon" /> : <TriangleAlert aria-hidden className="size-3.5 shrink-0 text-status-warning-icon" />}
            <span>{t(readable ? 'design_system.styleAgents.contrastPass' : 'design_system.styleAgents.contrastFail', { ratio: ratio.toFixed(1) })}</span>
          </p>
        ) : null}
      </div>
    </div>
  )
}

export function BrandStylePreview({ light, dark, hostTokens, logo }: {
  light: BrandTokens
  dark: BrandTokens
  hostTokens: { light: Record<string, string>; dark: Record<string, string> } | null
  logo: string | null
}) {
  const t = useT()
  return (
    <section className="space-y-3" aria-label={t('design_system.styleAgents.appliedPreview')}>
      <div className="space-y-1">
        <h2 className="text-lg font-medium">{t('design_system.styleAgents.appliedPreview')}</h2>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{t('design_system.styleAgents.previewHint')}</p>
      </div>
      <div className="grid gap-4 @3xl:grid-cols-2">
        <ThemePreview theme="light" tokens={light} hostTokens={hostTokens?.light} logo={logo} />
        <ThemePreview theme="dark" tokens={dark} hostTokens={hostTokens?.dark} logo={logo} />
      </div>
    </section>
  )
}
