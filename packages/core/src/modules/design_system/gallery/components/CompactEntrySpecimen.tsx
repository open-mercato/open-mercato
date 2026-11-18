'use client'

import * as React from 'react'
import { Plus } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Banner } from '@open-mercato/ui/primitives/banner'
import { Button } from '@open-mercato/ui/primitives/button'
import { CompactButton } from '@open-mercato/ui/primitives/compact-button'
import { KeyIcon, KeyIconGlyph } from '@open-mercato/ui/primitives/key-icon'
import { EmptyStateIllustration } from '@open-mercato/ui/primitives/empty-state-illustration'

function CompactButtons() {
  const t = useT()
  const [pressed, setPressed] = React.useState<Record<string, boolean>>({})
  return <div className="flex flex-wrap items-center gap-4">
    {(['stroke', 'ghost', 'white', 'modifiable'] as const).map(appearance => <div key={appearance} className={appearance === 'modifiable' ? 'rounded-md bg-primary p-2 text-primary-foreground' : 'p-2'}>
      <CompactButton type="button" appearance={appearance} size={24}
        aria-label={t('design_system.gallery.examples.buttons.compactAction')}
        aria-pressed={pressed[appearance] ?? false}
        onClick={() => setPressed(current => ({ ...current, [appearance]: !current[appearance] }))}>
        <Plus aria-hidden />
      </CompactButton>
    </div>)}
  </div>
}

function KeyIcons() {
  const t = useT()
  return <div className="flex flex-wrap items-center gap-4">
    {(['gray', 'blue', 'green', 'orange', 'purple'] as const).map((color, index) => <KeyIcon key={color} color={color} size={40} appearance={index < 2 ? 'stroke' : 'lighter'} aria-label={t(`design_system.gallery.examples.keyComponents.color.${color}`)}><KeyIconGlyph /></KeyIcon>)}
  </div>
}

function AlertSpecimen() {
  const t = useT()
  return <Alert status="information" style="light" size="default" className="w-full">
    <AlertTitle>{t('design_system.gallery.samples.banner.title')}</AlertTitle>
    <AlertDescription>{t('design_system.gallery.samples.banner.description')}</AlertDescription>
  </Alert>
}

function BannerSpecimen() {
  const t = useT()
  const [dismissed, setDismissed] = React.useState(false)
  const [expanded, setExpanded] = React.useState(false)
  if (dismissed) return <Button variant="outline" size="sm" onClick={() => { setDismissed(false); setExpanded(false) }}>{t('design_system.gallery.samples.banner.restore')}</Button>
  return <div className="w-full space-y-3">
    <Banner status="information" style="lighter" title={t('design_system.gallery.samples.banner.title')}
      onDismiss={() => setDismissed(true)}
      action={<Button variant="link" className="h-auto p-0 text-inherit underline" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{t('design_system.gallery.samples.banner.details')}</Button>} />
    {expanded ? <p role="status" className="text-sm text-muted-foreground">{t('design_system.gallery.samples.banner.detailsBody')}</p> : null}
  </div>
}

export function getCompactEntrySpecimen(entryId: string): React.ReactNode | undefined {
  switch (entryId) {
    case 'compact-button': return <CompactButtons />
    case 'key-icon': return <KeyIcons />
    case 'alert': return <AlertSpecimen />
    case 'banner': return <BannerSpecimen />
    case 'empty-state-illustration': return <EmptyStateIllustration kind="mercato-records" />
    default: return undefined
  }
}
