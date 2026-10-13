'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import { resolveLucideIcon } from '../lucide-icons'
import { InputParametersTab, type InputParametersTabProps } from './InputParametersTab'
import { buildPaletteEntries } from './entries'
import { PaletteCard } from './PaletteCard'
import type { PaletteEntry } from '../types'

function PaletteSection({ title, entries }: { title: string; entries: PaletteEntry[] }) {
  const t = useT()
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="space-y-2">
        {entries.map((entry) => (
          <PaletteCard
            key={entry.id}
            id={entry.id}
            Icon={resolveLucideIcon(entry.iconName)}
            label={t(entry.displayNameKey)}
          />
        ))}
      </div>
    </section>
  )
}

export function FormPalettePanel({ parameters }: { parameters: InputParametersTabProps }) {
  const t = useT()
  const entries = React.useMemo(() => buildPaletteEntries(), [])
  return (
    <aside className="rounded-lg border border-border bg-card p-4">
      <Tabs defaultValue="elements">
        <TabsList className="mb-3 grid w-full grid-cols-2">
          <TabsTrigger value="elements">{t('forms.studio.palette.tabs.elements')}</TabsTrigger>
          <TabsTrigger value="parameters">{t('forms.studio.palette.tabs.parameters')}</TabsTrigger>
        </TabsList>
        <TabsContent value="elements" className="space-y-4">
          <PaletteSection title={t('forms.studio.palette.section.input')} entries={entries.input} />
          <PaletteSection title={t('forms.studio.palette.section.survey')} entries={entries.survey} />
          <PaletteSection title={t('forms.studio.palette.section.layout')} entries={entries.layout} />
        </TabsContent>
        <TabsContent value="parameters">
          <InputParametersTab {...parameters} />
        </TabsContent>
      </Tabs>
    </aside>
  )
}
