"use client"

/**
 * The Work Inbox's empty state.
 *
 * Renders only — `lib/work-inbox/empty-state.ts` decides which case this is, and
 * the `filtered` case never reaches here (it is served by the shared
 * `FilteredEmptyResults` through `DataTable`'s `filterAwareEmptyState`, which
 * carries the clear-filters affordance).
 *
 * The icon is a second, non-colour channel for the case — the states are drawn
 * with neutral tokens on purpose, so nothing here depends on hue.
 */

import * as React from 'react'
import { AlertTriangle, EyeOff, Inbox } from 'lucide-react'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { WorkInboxEmptyState as WorkInboxEmptyStateDecision } from '../../lib/work-inbox/empty-state'

type NarratedEmptyState = Exclude<WorkInboxEmptyStateDecision, { kind: 'filtered' }>

const EMPTY_STATE_ICONS: Record<NarratedEmptyState['kind'], React.ComponentType<{ className?: string }>> = {
  degraded: AlertTriangle,
  'entity-hidden': EyeOff,
  'no-relationship': Inbox,
}

export function WorkInboxEmptyState({ state }: { state: NarratedEmptyState }) {
  const t = useT()
  const Icon = EMPTY_STATE_ICONS[state.kind]

  return (
    <div data-testid={`work-inbox-empty-${state.kind}`}>
      <EmptyState
        variant="subtle"
        icon={<Icon className="size-6" />}
        title={t(state.titleKey)}
        description={t(state.descriptionKey, state.descriptionVars)}
      />
    </div>
  )
}
