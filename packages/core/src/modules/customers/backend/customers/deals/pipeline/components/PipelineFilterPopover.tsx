"use client"

import * as React from 'react'
import { Check, X } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@open-mercato/ui/primitives/popover'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { ChipButton } from './ChipButton'

export type PipelineFilterOption = {
  id: string
  name: string
  dealCount?: number
}

type PipelineFilterPopoverProps = {
  pipelines: PipelineFilterOption[]
  selectedPipelineId: string | null
  onApply: (pipelineId: string | null) => void
}

export function PipelineFilterPopover({
  pipelines,
  selectedPipelineId,
  onApply,
}: PipelineFilterPopoverProps): React.ReactElement {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState<string | null>(selectedPipelineId)

  React.useEffect(() => {
    if (open) setDraft(selectedPipelineId)
  }, [open, selectedPipelineId])

  const activePipeline = pipelines.find((p) => p.id === selectedPipelineId)
  const totalCount = pipelines.reduce((sum, p) => sum + (p.dealCount ?? 0), 0)
  const chipLabel = translateWithFallback(t, 'customers.deals.kanban.filter.pipeline', 'Pipeline')
  const chipValue = activePipeline
    ? activePipeline.name
    : translateWithFallback(t, 'customers.deals.kanban.filter.allCount', 'All ({count})', {
        count: pipelines.length,
      })

  const handleApply = () => {
    onApply(draft)
    setOpen(false)
  }

  // Cmd/Ctrl+Enter from anywhere inside the popover confirms — parity with the dialog
  // primary-action shortcut (`AGENTS.md` UI Interaction rules).
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      handleApply()
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ChipButton label={chipLabel} value={chipValue} active={!!selectedPipelineId} />
      </PopoverTrigger>
      <PopoverContent className="w-[420px] p-0" align="start" onKeyDown={handleKeyDown}>
        <div className="flex items-center justify-between border-b border-border p-3">
          <span className="text-sm font-semibold text-foreground">
            {translateWithFallback(
              t,
              'customers.deals.kanban.filter.pipeline.title',
              'Filter · Pipeline',
            )}
          </span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={translateWithFallback(t, 'customers.deals.kanban.filter.close', 'Close')}
            className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex flex-col gap-1 p-1">
          <button
            type="button"
            onClick={() => setDraft(null)}
            className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
              draft === null ? 'bg-muted' : ''
            }`}
          >
            <span className="flex flex-col">
              <span className="font-medium text-foreground">
                {translateWithFallback(
                  t,
                  'customers.deals.kanban.filter.pipeline.all',
                  'All pipelines',
                )}
              </span>
              <span className="text-xs text-muted-foreground">
                {translateWithFallback(
                  t,
                  'customers.deals.kanban.filter.pipeline.allHelper',
                  '{count} pipelines',
                  { count: pipelines.length },
                )}
              </span>
            </span>
            <span className="text-sm font-medium text-primary">
              {draft === null ? <Check className="size-4" aria-hidden="true" /> : totalCount}
            </span>
          </button>
          {pipelines.map((pipeline) => {
            const isSelected = draft === pipeline.id
            return (
              <button
                key={pipeline.id}
                type="button"
                onClick={() => setDraft(pipeline.id)}
                className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  isSelected ? 'bg-muted' : ''
                }`}
              >
                <span className="font-medium text-foreground">{pipeline.name}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {typeof pipeline.dealCount === 'number' ? <span>{pipeline.dealCount}</span> : null}
                  {isSelected ? (
                    <Check className="size-4 text-primary" aria-hidden="true" />
                  ) : null}
                </span>
              </button>
            )
          })}
        </div>

        <div className="flex items-center justify-between border-t border-border p-3 text-xs text-muted-foreground">
          <span>
            {draft
              ? translateWithFallback(
                  t,
                  'customers.deals.kanban.filter.pipeline.selectedOne',
                  '1 selected · {name}',
                  { name: pipelines.find((p) => p.id === draft)?.name ?? '' },
                )
              : translateWithFallback(
                  t,
                  'customers.deals.kanban.filter.pipeline.selectedNone',
                  'No pipeline filter',
                )}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" type="button" onClick={() => setOpen(false)}>
              {translateWithFallback(t, 'customers.deals.kanban.filter.cancel', 'Cancel')}
            </Button>
            <Button size="sm" type="button" onClick={handleApply}>
              {translateWithFallback(t, 'customers.deals.kanban.filter.apply', 'Apply')}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default PipelineFilterPopover
