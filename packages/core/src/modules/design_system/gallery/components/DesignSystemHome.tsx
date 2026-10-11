'use client'

import * as React from 'react'
import { GalleryLink as Link } from './GalleryLink'
import { ArrowRight, Code2, Keyboard, Layers, Palette } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { GALLERY_BASE_PATH } from '../registry'

const paths = {
  foundations: `${GALLERY_BASE_PATH}?family=foundations`,
  components: `${GALLERY_BASE_PATH}?view=components`,
  button: `${GALLERY_BASE_PATH}?family=buttons&entry=button`,
  patterns: `${GALLERY_BASE_PATH}?family=scaffolding`,
}

const principles = [
  { id: 'semantics', icon: Palette, href: `${paths.foundations}&entry=color-roles` },
  { id: 'states', icon: Layers, href: `${GALLERY_BASE_PATH}?family=feedback` },
  { id: 'keyboard', icon: Keyboard, href: `${GALLERY_BASE_PATH}?family=overlays` },
  { id: 'handoff', icon: Code2, href: paths.button },
] as const

export function DesignSystemPrinciples() {
  const t = useT()
  return <section className="space-y-8" aria-labelledby="ds-principles-title">
    <div className="max-w-2xl space-y-3">
      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">{t('design_system.portal.principles.eyebrow')}</p>
      <h2 id="ds-principles-title" className="text-2xl font-semibold tracking-tight">{t('design_system.portal.principles.title')}</h2>
      <p className="text-base leading-relaxed text-muted-foreground">{t('design_system.portal.principles.description')}</p>
    </div>
    <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
      {principles.map(({ id, icon: Icon, href }) => <article key={id} className="space-y-3 border-t border-border py-6">
        <Icon className="size-5 text-muted-foreground" aria-hidden />
        <h3 className="text-lg font-medium">{t(`design_system.portal.principles.${id}.title`)}</h3>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">{t(`design_system.portal.principles.${id}.description`)}</p>
        <Link href={href} className="inline-flex items-center gap-2 rounded-sm text-sm underline underline-offset-4 focus-visible:outline-none focus-visible:shadow-focus">{t('design_system.portal.seeExamples')}<ArrowRight className="size-4" aria-hidden /></Link>
      </article>)}
    </div>
  </section>
}

export function DesignSystemHome() {
  const t = useT()
  return <div className="space-y-12 pb-8" data-example="design-system-home">
    <header id="gallery-page-heading" className="scroll-mt-36 border-b border-border pb-8 lg:scroll-mt-24">
      <div className="max-w-3xl space-y-6">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">{t('design_system.portal.eyebrow')}</p>
        <h1 className="max-w-2xl text-3xl font-medium leading-tight tracking-tight sm:text-5xl">{t('design_system.portal.title')}</h1>
        <p className="max-w-xl text-base leading-relaxed text-muted-foreground">{t('design_system.portal.description')}</p>
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg"><Link href={paths.components}>{t('design_system.portal.browse')}<ArrowRight aria-hidden /></Link></Button>
          <Button asChild size="lg" variant="outline"><Link href={paths.foundations}>{t('design_system.portal.start')}</Link></Button>
        </div>
      </div>
    </header>

    <section className="space-y-4 rounded-xl border border-border bg-card p-6">
      <Palette className="size-6 text-muted-foreground" aria-hidden />
      <h2 className="text-2xl font-medium">{t('design_system.styleAgents.title')}</h2>
      <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{t('design_system.styleAgents.description')}</p>
      <Button asChild variant="outline"><Link href={`${GALLERY_BASE_PATH}?view=style-agents`}>{t('design_system.styleAgents.open')}<ArrowRight aria-hidden /></Link></Button>
    </section>

  </div>
}
