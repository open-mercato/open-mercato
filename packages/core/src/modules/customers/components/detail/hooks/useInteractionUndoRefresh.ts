'use client'

import * as React from 'react'
import { useOperationStore, type UndoneEntry } from '@open-mercato/ui/backend/operations/store'
import { runActivityRefresh, type ActivityRefreshHandler } from '../activityRefresh'

const INTERACTION_RESOURCE_KINDS = new Set(['customers.interaction', 'customers.activity'])

function selectUndoneInteractionOperations(state: { undone: UndoneEntry[] }): string {
  return state.undone
    .filter((entry) => entry.resourceKind !== null && INTERACTION_RESOURCE_KINDS.has(entry.resourceKind))
    .map((entry) => entry.id)
    .join('|')
}

/**
 * Reloads an activity timeline when an interaction operation is undone or redone.
 * The undo bar belongs to AppShell, so its click never reaches the timeline; the
 * operation store is the only signal the page gets. An entry joins the store's `undone`
 * list on undo and leaves it on redo, so any change to the interaction entries in that
 * list means the rows on the server differ from the ones on screen.
 */
export function useInteractionUndoRefresh(
  onRefresh: ActivityRefreshHandler,
  logContext = 'customers.interactionUndoRefresh',
): void {
  const undoneOperations = useOperationStore(selectUndoneInteractionOperations)
  const seenOperationsRef = React.useRef(undoneOperations)

  React.useEffect(() => {
    if (seenOperationsRef.current === undoneOperations) return
    seenOperationsRef.current = undoneOperations
    void runActivityRefresh(onRefresh, logContext)
  }, [logContext, onRefresh, undoneOperations])
}
