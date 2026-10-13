"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { StepIndicator, type StepIndicatorStep } from '@open-mercato/ui/primitives/step-indicator'
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
  const steps: StepIndicatorStep[] = sections.map((section, index) => ({
    id: section.key,
    label: resolveSectionTitle(section, locale, defaultLocale),
    status: index === currentIndex
      ? 'current'
      : completedSet.has(index) || index < currentIndex
        ? 'complete'
        : 'pending',
  }))
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
      <StepIndicator
        steps={steps}
        size="sm"
        showNumbers
        className="flex-wrap gap-2"
        onStepClick={(stepId) => {
          const index = sections.findIndex((section) => section.key === stepId)
          if (index >= 0) onSelect(index)
        }}
      />
    </nav>
  )
}
