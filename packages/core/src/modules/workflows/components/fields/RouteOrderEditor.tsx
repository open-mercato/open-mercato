'use client'

import { useState } from 'react'
import { ArrowDown, ArrowUp, CornerDownLeft, GripVertical } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
import {
  applyDerivedPriorities,
  moveRoute,
  type RouteOrderEntry,
} from '../../lib/route-priority'

/**
 * RouteOrderEditor — drag-to-reorder of a step's outgoing routes (spec section
 * 4.4). The list order IS the evaluation order; the priority number is derived
 * from it and demoted behind an advanced toggle, where it stays editable for
 * authors who need an exact value.
 *
 * Drag is an enhancement: every row also carries keyboard-reachable move-up /
 * move-down buttons, so reordering never depends on a pointer.
 */

export interface RouteOrderEditorProps {
  id: string
  value?: RouteOrderEntry[]
  setValue: (next: RouteOrderEntry[]) => void
  disabled?: boolean
}

export function RouteOrderEditor({ id, value, setValue, disabled }: RouteOrderEditorProps) {
  const t = useT()
  const entries = Array.isArray(value) ? value : []
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)

  const commitOrder = (next: RouteOrderEntry[]) => {
    setValue(applyDerivedPriorities(next))
  }

  const move = (fromIndex: number, toIndex: number) => {
    if (disabled) return
    commitOrder(moveRoute(entries, fromIndex, toIndex))
  }

  const setPriority = (transitionId: string, raw: string) => {
    const parsed = Number.parseInt(raw, 10)
    setValue(
      entries.map((entry) =>
        entry.transitionId === transitionId
          ? { ...entry, priority: Number.isFinite(parsed) ? Math.max(0, Math.min(9999, parsed)) : 0 }
          : entry,
      ),
    )
  }

  if (entries.length === 0) {
    return (
      <Alert variant="info">
        <AlertDescription>
          {t('workflows.routeOrder.empty')}
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="flex flex-col gap-2" data-testid="route-order-editor">
      <p className="text-xs text-muted-foreground">
        {t('workflows.routeOrder.hint')}
      </p>

      <ol className="flex flex-col gap-2">
        {entries.map((entry, index) => (
          <li
            key={entry.transitionId}
            draggable={!disabled}
            onDragStart={() => setDraggingIndex(index)}
            onDragEnd={() => setDraggingIndex(null)}
            onDragOver={(event) => {
              if (draggingIndex === null) return
              event.preventDefault()
            }}
            onDrop={(event) => {
              event.preventDefault()
              if (draggingIndex === null) return
              move(draggingIndex, index)
              setDraggingIndex(null)
            }}
            className="flex items-center gap-2 rounded-md border border-border bg-card p-2"
            data-testid={`route-order-row-${entry.transitionId}`}
          >
            <GripVertical className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">
                  {entry.label || entry.transitionId}
                </span>
                {entry.isOtherwise ? (
                  <Badge variant="secondary" className="gap-1 text-xs">
                    <CornerDownLeft className="size-3" aria-hidden="true" />
                    {t('workflows.routeChips.otherwise')}
                  </Badge>
                ) : null}
              </div>
              <span className="text-xs text-muted-foreground">
                {t('workflows.routeOrder.target', { stepId: entry.toStepId })}
              </span>
            </div>

            {showAdvanced ? (
              <div className="flex shrink-0 items-center gap-1">
                <Label htmlFor={`${id}-${entry.transitionId}-priority`} className="text-xs text-muted-foreground">
                  {t('workflows.edgeEditor.priority')}
                </Label>
                <Input
                  id={`${id}-${entry.transitionId}-priority`}
                  type="number"
                  className="w-20 text-xs"
                  value={String(entry.priority)}
                  onChange={(event) => setPriority(entry.transitionId, event.target.value)}
                  disabled={disabled}
                />
              </div>
            ) : (
              <span className="shrink-0 font-mono text-xs text-muted-foreground">{entry.priority}</span>
            )}

            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled || index === 0}
                aria-label={t('workflows.routeOrder.moveUp')}
                onClick={() => move(index, index - 1)}
              >
                <ArrowUp className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled || index === entries.length - 1}
                aria-label={t('workflows.routeOrder.moveDown')}
                onClick={() => move(index, index + 1)}
              >
                <ArrowDown className="size-4" />
              </Button>
            </div>
          </li>
        ))}
      </ol>

      <SwitchField
        id={`${id}-advanced`}
        label={t('workflows.routeOrder.showPriorityNumbers')}
        checked={showAdvanced}
        onCheckedChange={setShowAdvanced}
        disabled={disabled}
      />
    </div>
  )
}
