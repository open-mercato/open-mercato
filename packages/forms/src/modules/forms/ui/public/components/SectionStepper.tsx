"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { resolveSectionTitle, type RunnerSection } from '../types'

export type SectionStepperProps = {
  sections: RunnerSection[]
  currentIndex: number
  completedSet: Set<number>
  locale: string
  defaultLocale: string
  onSelect: (index: number) => void
}

export function SectionStepper({
  sections,
  currentIndex,
  completedSet,
  locale,
  defaultLocale,
  onSelect,
}: SectionStepperProps) {
  const t = useT()
  if (sections.length === 0) return null
  return (
    <nav
      aria-label={t('forms.runner.section.progress_aria', { fallback: 'Form progress' })}
      className="flex flex-col gap-2"
    >
      <p className="text-sm font-medium text-foreground">
        {t('forms.runner.section.label', {
          fallback: 'Section {current} of {total}',
          current: String(currentIndex + 1),
          total: String(sections.length),
        })}
      </p>
      <ol className="flex flex-wrap gap-2">
        {sections.map((section, index) => {
          const completed = completedSet.has(index)
          const active = index === currentIndex
          const visited = completed || index < currentIndex
          const tone = active
            ? 'border-primary bg-primary text-primary-foreground'
            : completed
              ? 'border-status-success-border bg-status-success text-status-success-foreground'
              : visited
                ? 'border-border bg-muted text-foreground'
                : 'border-border bg-background text-muted-foreground'
          const title = resolveSectionTitle(section, locale, defaultLocale)
          const ordinal = `${index + 1}`
          return (
            <li key={section.key}>
              <button
                type="button"
                onClick={() => onSelect(index)}
                aria-current={active ? 'step' : undefined}
                aria-label={title}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition-colors hover:opacity-90 ${tone}`}
                disabled={!visited && !active}
              >
                <span
                  aria-hidden="true"
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-current text-[10px]"
                >
                  {ordinal}
                </span>
                <span className="hidden sm:inline">{title}</span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
