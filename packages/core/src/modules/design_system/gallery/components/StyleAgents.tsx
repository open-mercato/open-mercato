'use client'

import * as React from 'react'
import { Check, ImagePlus, RotateCcw, Upload, X } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import { getBrandStyle, saveBrandStyle, type BrandStyle } from '@open-mercato/ui/theme/brand-style'
import { ColorPlayground } from './ColorPlayground'
import { BrandStylePreview } from './BrandStylePreview'
import { readThemeTokens, type ThemeTokens } from './themeTokens'
import type { Shade } from './colorStudio'
import type { ColorStudio } from './colorStudio'
import { readBrandLogo, studioBrandStyle } from './styleAgentBranding'

function brandPreview(studio: ColorStudio, logo: string | null) {
  const style = studioBrandStyle(studio, logo)
  return { light: style.light, dark: style.dark }
}

export function StyleAgents() {
  const t = useT()
  const input = React.useRef<HTMLInputElement>(null)
  const uploadVersion = React.useRef(0)
  const [initial, setInitial] = React.useState<BrandStyle | null | undefined>(undefined)
  const [hostTokens, setHostTokens] = React.useState<ThemeTokens | null>(null)
  const [logo, setLogo] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState<{ studio: ColorStudio; valid: boolean } | null>(null)
  const [uploading, setUploading] = React.useState(false)
  const [notice, setNotice] = React.useState('')
  const [error, setError] = React.useState('')
  React.useEffect(() => {
    setHostTokens(readThemeTokens(document.styleSheets))
    const applied = getBrandStyle()
    setInitial(applied)
    setLogo(applied?.logo ?? null)
    return () => { uploadVersion.current += 1 }
  }, [])
  const updateStudio = React.useCallback((studio: ColorStudio, valid: boolean) => {
    setDraft({ studio, valid })
    setNotice('')
  }, [])

  async function upload(file: File | undefined) {
    if (!file) return
    const version = ++uploadVersion.current
    setUploading(true)
    setError('')
    setNotice('')
    try {
      const data = await readBrandLogo(file)
      if (uploadVersion.current === version) setLogo(data)
    } catch (failure) {
      if (uploadVersion.current === version) setError(failure instanceof Error ? failure.message : 'fileDecode')
    } finally {
      if (uploadVersion.current === version) setUploading(false)
    }
  }

  function apply() {
    if (!draft?.valid || uploading) return
    try {
      saveBrandStyle(studioBrandStyle(draft.studio, logo))
      setError('')
      setNotice('applied')
    } catch { setError('saveFailed'); setNotice('') }
  }

  function restore() {
    try {
      saveBrandStyle(null)
      setError('')
      setNotice('restored')
    } catch { setError('saveFailed'); setNotice('') }
  }

  return <div className="space-y-8 pb-8" data-example="style-agents">
    <header id="gallery-page-heading" className="scroll-mt-36 space-y-3 lg:scroll-mt-24">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-3">
          <h1 className="text-3xl font-medium tracking-tight">{t('design_system.styleAgents.title')}</h1>
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{t('design_system.styleAgents.description')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SimpleTooltip content={t('design_system.styleAgents.restoreHint')}>
            <Button type="button" variant="ghost" onClick={restore}><RotateCcw aria-hidden />{t('design_system.styleAgents.restore')}</Button>
          </SimpleTooltip>
          <Button type="button" onClick={apply} disabled={!draft?.valid || uploading}><Check aria-hidden />{t('design_system.styleAgents.apply')}</Button>
        </div>
      </div>
      {notice ? <p role="status" className="text-sm text-status-success-text">{t(`design_system.styleAgents.${notice}`)}</p> : null}
      {error ? <p role="alert" className="text-sm text-status-error-text">{t(`design_system.styleAgents.${error}`)}</p> : null}
    </header>
    <section className="grid gap-6 rounded-xl border border-border bg-card p-5 sm:p-6 lg:grid-cols-2" aria-label={t('design_system.styleAgents.identity')}>
      <div className="space-y-4">
        <div className="space-y-1"><h2 className="text-lg font-medium">{t('design_system.styleAgents.logo')}</h2><p className="text-xs leading-relaxed text-muted-foreground">{t('design_system.styleAgents.logoHint')}</p></div>
        <div className="flex min-h-28 items-center justify-center rounded-lg border border-dashed border-border bg-background p-6">
          {logo ? <img src={logo} alt={t('design_system.styleAgents.logoPreview')} className="max-h-20 max-w-full object-contain" /> : <ImagePlus className="size-8 text-muted-foreground" aria-hidden />}
        </div>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label={t('design_system.styleAgents.upload')} onChange={event => { void upload(event.target.files?.[0]); event.target.value = '' }} />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => input.current?.click()}><Upload aria-hidden />{t(`design_system.styleAgents.${uploading ? 'uploading' : 'upload'}`)}</Button>
          {logo ? <Button type="button" variant="ghost" onClick={() => { uploadVersion.current += 1; setUploading(false); setLogo(null); setNotice(''); setError('') }}><X aria-hidden />{t('design_system.styleAgents.removeLogo')}</Button> : null}
        </div>
      </div>
      <div className="flex flex-col justify-between gap-5">
        <div className="space-y-3"><h2 className="text-lg font-medium">{t('design_system.styleAgents.applyTitle')}</h2><p className="text-sm leading-relaxed text-muted-foreground">{t('design_system.styleAgents.scope')}</p><p className="text-xs leading-relaxed text-muted-foreground">{t('design_system.styleAgents.tokenScope')}</p></div>

      </div>
    </section>
    {draft ? <BrandStylePreview {...brandPreview(draft.studio, logo)} hostTokens={hostTokens} logo={logo} /> : null}
    {initial !== undefined ? <ColorPlayground initialView="light" initialSeeds={initial?.seeds} initialActionShades={initial?.actionShades as { light?: Shade; dark?: Shade } | undefined} logo={logo} onStudioChange={updateStudio} /> : null}

  </div>
}
