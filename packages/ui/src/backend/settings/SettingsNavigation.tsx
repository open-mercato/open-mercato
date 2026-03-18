'use client'
import * as React from 'react'
import Link from 'next/link'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type SettingsCard = {
  id: string
  titleKey: string
  title: string
  descriptionKey: string
  description: string
  href: string
  icon: React.ReactNode
  requireFeatures?: string[]
}

export type SettingsSection = {
  id: string
  titleKey: string
  title: string
  cards: SettingsCard[]
}

export type SettingsNavigationProps = {
  sections: SettingsSection[]
  /** Optional set of user features to filter cards by requireFeatures */
  userFeatures?: Set<string>
}

export function SettingsNavigation({ sections, userFeatures }: SettingsNavigationProps) {
  const t = useT()

  const hasRequiredFeatures = (card: SettingsCard): boolean => {
    if (!card.requireFeatures || card.requireFeatures.length === 0) return true
    if (!userFeatures) return true // If no userFeatures provided, show all cards
    return card.requireFeatures.every((f) => userFeatures.has(f))
  }

  const renderCard = (card: SettingsCard) => (
    <Link
      key={card.href}
      href={card.href}
      className="group flex flex-col gap-2 rounded-lg border bg-background p-4 shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      <div className="flex items-center gap-3">
        <span className="text-muted-foreground group-hover:text-accent-foreground">
          {card.icon}
        </span>
        <h3 className="font-medium">{t(card.titleKey, card.title)}</h3>
      </div>
      <p className="text-sm text-muted-foreground group-hover:text-accent-foreground/80">
        {t(card.descriptionKey, card.description)}
      </p>
    </Link>
  )

  const renderSection = (section: SettingsSection) => {
    const visibleCards = section.cards.filter(hasRequiredFeatures)
    if (visibleCards.length === 0) return null

    return (
      <div key={section.id} className="space-y-3">
        <h2 className="text-lg font-semibold">{t(section.titleKey, section.title)}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleCards.map(renderCard)}
        </div>
      </div>
    )
  }

  return <>{sections.map(renderSection)}</>
}
