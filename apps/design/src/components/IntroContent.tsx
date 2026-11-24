'use client'

import * as React from 'react'
import Link from 'next/link'
import { ArrowRight, Blocks, Palette, Shapes } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { EntryGroup } from '@/lib/groups'
import { PageHeader } from './PageHeader'

type IntroContentProps = {
  counts: Record<EntryGroup, number>
}

const GROUP_ICONS: Record<EntryGroup, typeof Palette> = {
  foundations: Palette,
  components: Shapes,
  blocks: Blocks,
}

const GROUP_DESCRIPTIONS: Record<EntryGroup, string> = {
  foundations: 'design.intro.howFoundations',
  components: 'design.intro.howComponents',
  blocks: 'design.intro.howBlocks',
}

const GROUP_ORDER: EntryGroup[] = ['foundations', 'components', 'blocks']

export function IntroContent({ counts }: IntroContentProps) {
  const t = useT()
  return (
    <div className="mx-auto max-w-5xl space-y-12">
      <PageHeader overline={t('design.intro.overline')} title={t('design.intro.title')} lead={t('design.intro.lead')} />
      <section className="space-y-4" aria-labelledby="intro-browse">
        <h2 id="intro-browse" className="text-xl font-normal text-foreground">{t('design.intro.howTitle')}</h2>
        <ul className="grid gap-4 md:grid-cols-3">
          {GROUP_ORDER.map((group) => {
            const Icon = GROUP_ICONS[group]
            return (
              <li key={group}>
                <Link
                  href={`/${group}/`}
                  className="group flex h-full flex-col gap-3 rounded-xl border border-border bg-card p-5 transition-colors hover:border-input hover:bg-muted/40 focus-visible:outline-none focus-visible:shadow-focus"
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-lg text-foreground">
                      <Icon className="size-5 text-muted-foreground" aria-hidden />
                      {t(`design.nav.${group}`)}
                    </span>
                    <span className="text-sm text-muted-foreground">{counts[group]}</span>
                  </span>
                  <span className="text-sm text-muted-foreground">{t(GROUP_DESCRIPTIONS[group])}</span>
                  <span className="mt-auto flex items-center gap-1 text-sm text-foreground">
                    {t('design.intro.browse')}
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      </section>
      <div className="grid gap-8 md:grid-cols-2">
        <section className="space-y-2">
          <h2 className="text-xl font-normal text-foreground">{t('design.intro.themesTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('design.intro.themesBody')}</p>
        </section>
        <section className="space-y-2">
          <h2 className="text-xl font-normal text-foreground">{t('design.intro.agentsTitle')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('design.intro.agentsBody')}
          </p>
          <a href="/llms.txt" className="inline-flex items-center gap-1 text-sm text-foreground underline underline-offset-4 hover:text-muted-foreground">
            {t('design.intro.agentsLink')}
            <ArrowRight className="size-4" aria-hidden />
          </a>
        </section>
      </div>
    </div>
  )
}
