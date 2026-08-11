import * as React from 'react'
import Link from 'next/link'
import { ArrowUpRight, Package } from 'lucide-react'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { outcomeDisplayLabel, type ProcessRunOutcome } from '../lib/tasks/outcome'

/**
 * What a completed process run PRODUCED (spec `2026-08-11-triggered-process-model.md`
 * §Outcome), rendered in the one place a reader looks for it.
 *
 * `href` is resolved SERVER-SIDE by the process-runs API and is null whenever
 * the module that owns the record is not part of this deployment. That is the
 * degraded — not broken — case: the LABEL SNAPSHOT was persisted precisely so
 * the reference stays readable without the owning module, so it renders as
 * plain text rather than a link that would 404.
 */
export function ProcessOutcome({
  outcome,
  href,
  t,
}: {
  outcome: ProcessRunOutcome
  href: string | null
  t: TranslateFn
}) {
  const label = outcomeDisplayLabel(outcome)
  if (!href) {
    return (
      <span
        className="inline-flex min-w-0 items-center gap-1.5 text-sm text-foreground"
        title={t('agent_orchestrator.process.outcomeUnlinked')}
        data-testid="process-outcome"
      >
        <Package className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{label}</span>
      </span>
    )
  }
  return (
    <Link
      href={href}
      className="inline-flex min-w-0 items-center gap-1.5 text-sm font-medium text-foreground underline-offset-4 hover:underline"
      data-testid="process-outcome"
    >
      <Package className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{label}</span>
      <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
    </Link>
  )
}
