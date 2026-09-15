"use client"

import * as React from 'react'
import { ShieldCheck } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'

/**
 * The module's defining guarantee, stated once and reused verbatim (F6): agents
 * produce proposals, and the domain is mutated only after a disposition. One
 * translation key backs every surface so the wording cannot drift between the
 * places a first-time user meets it — Overview, Agents, Playground, Caseload.
 *
 * The copy covers auto-approval too ("or cleared automatically by a rule you
 * configured"), so it stays true on tenants that raised the autonomy ceiling
 * rather than promising a human gate that no longer applies there.
 *
 * Deliberately static: this is a standing property of the system, not an
 * announcement, so it is never a modal and never dismissible.
 */
export function ProposeOnlyNotice({ variant = 'inline' }: { variant?: 'inline' | 'block' }) {
  const t = useT()
  const text = t(
    'agent_orchestrator.proposeOnly.notice',
    'Agents only propose. Nothing changes in the system until a proposal is approved in the Caseload — or cleared automatically by a rule you configured.',
  )
  if (variant === 'block') {
    return (
      <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span>{text}</span>
      </div>
    )
  }
  return (
    <p className="flex items-start gap-2 text-sm text-muted-foreground">
      <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{text}</span>
    </p>
  )
}
