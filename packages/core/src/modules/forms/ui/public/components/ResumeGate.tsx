"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { RunnerSubmission } from '../types'

export type ResumeGateProps = {
  candidates: RunnerSubmission[]
  onContinue: (submissionId: string) => void
  onStartOver: () => void
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function ResumeGate({ candidates, onContinue, onStartOver }: ResumeGateProps) {
  const t = useT()
  const latest = candidates[0]
  const lastSavedAt = latest ? formatDate(latest.updatedAt ?? latest.firstSavedAt ?? null) : ''
  const revisionCount = candidates.length

  return (
    <section className="mx-auto flex w-full max-w-xl flex-col gap-4 rounded-xl border border-border bg-card p-6 shadow-sm">
      <header>
        <h2 className="text-xl font-semibold text-foreground">
          {t('forms.runner.resume.title', { fallback: 'Continue where you left off' })}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('forms.runner.resume.subtitle', {
            fallback: 'We saved your progress on {date} ({revisions} revisions).',
            date: lastSavedAt || '—',
            revisions: String(revisionCount),
          })}
        </p>
      </header>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button
          type="button"
          onClick={() => latest && onContinue(latest.id)}
          disabled={!latest}
          className="flex-1"
        >
          {t('forms.runner.resume.continue', { fallback: 'Continue filling' })}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onStartOver}
          className="flex-1"
        >
          {t('forms.runner.resume.start_over', { fallback: 'Start over' })}
        </Button>
      </div>
    </section>
  )
}
