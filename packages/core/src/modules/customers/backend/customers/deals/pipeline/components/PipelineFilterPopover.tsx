"use client"

import * as React from 'react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@open-mercato/ui/primitives/popover'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { ChipButton } from './ChipButton'
import { FilterPopoverShell } from './FilterPopoverShell'

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

/**
 * Single radio button matching the Figma spec at 1045:11917 — an outlined 16px circle that
 * fills with the accent-indigo when selected. Reused for every row + the "All pipelines"
 * sentinel so the visual is consistent.
 */
function RadioDot({ selected }: { selected: boolean }): React.ReactElement {
  return (
    <span
      className={`flex size-4 shrink-0 items-center justify-center rounded-full border ${
        selected ? 'border-accent-indigo' : 'border-input bg-card'
      }`}
      aria-hidden="true"
    >
      {selected ? <span className="size-2 rounded-full bg-accent-indigo" /> : null}
    </span>
  )
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

  const allSelected = draft === null
  const allRowClass = allSelected ? 'bg-muted' : 'bg-card'

  const footerLeft = draft ? (
    <span>
      {translateWithFallback(
        t,
        'customers.deals.kanban.filter.pipeline.selectedOne',
        '1 selected · {name}',
        { name: pipelines.find((p) => p.id === draft)?.name ?? '' },
      )}
    </span>
  ) : (
    <span>
      {translateWithFallback(
        t,
        'customers.deals.kanban.filter.pipeline.selectedNone',
        'No pipeline filter',
      )}
    </span>
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ChipButton label={chipLabel} value={chipValue} active={!!selectedPipelineId} />
      </PopoverTrigger>
      <PopoverContent
        className="w-96 rounded-2xl border-border bg-transparent p-0 shadow-xl"
        align="start"
        onKeyDown={handleKeyDown}
      >
        <FilterPopoverShell
          title={translateWithFallback(t, 'customers.deals.kanban.filter.pipeline.title', 'Filter · Pipeline')}
          onClose={() => setOpen(false)}
          onCancel={() => setOpen(false)}
          onApply={handleApply}
          footerLeft={footerLeft}
        >
          {/*
            "All pipelines" sentinel row. Per Figma it shows the total deal count in
            accent-indigo (active emphasis), regardless of whether it's selected.
          */}
          <button
            type="button"
            onClick={() => setDraft(null)}
            className={`flex w-full items-center gap-3 rounded-md px-4 py-2.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${allRowClass}`}
          >
            <RadioDot selected={allSelected} />
            <div className="flex min-w-0 flex-1 flex-col gap-px">
              <span
                className={`text-[13px] leading-normal text-foreground ${
                  allSelected ? 'font-semibold' : 'font-normal'
                }`}
              >
                {translateWithFallback(t, 'customers.deals.kanban.filter.pipeline.all', 'All pipelines')}
              </span>
              <span className="text-[11px] font-normal leading-normal text-muted-foreground">
                {translateWithFallback(
                  t,
                  'customers.deals.kanban.filter.pipeline.allHelper',
                  '{count} pipelines',
                  { count: pipelines.length },
                )}
              </span>
            </div>
            <span className="text-[12px] font-semibold leading-normal text-accent-indigo">
              {totalCount}
            </span>
          </button>

          {pipelines.map((pipeline) => {
            const isSelected = draft === pipeline.id
            const rowClass = isSelected ? 'bg-muted' : 'bg-card'
            return (
              <button
                key={pipeline.id}
                type="button"
                onClick={() => setDraft(pipeline.id)}
                className={`flex w-full items-center gap-3 rounded-md px-4 py-2.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${rowClass}`}
              >
                <RadioDot selected={isSelected} />
                <span
                  className={`flex-1 truncate text-[13px] leading-normal text-foreground ${
                    isSelected ? 'font-semibold' : 'font-normal'
                  }`}
                >
                  {pipeline.name}
                </span>
                {typeof pipeline.dealCount === 'number' ? (
                  <span
                    className={`text-[12px] leading-normal ${
                      isSelected
                        ? 'font-semibold text-accent-indigo'
                        : 'font-normal text-muted-foreground'
                    }`}
                  >
                    {pipeline.dealCount}
                  </span>
                ) : null}
              </button>
            )
          })}
        </FilterPopoverShell>
      </PopoverContent>
    </Popover>
  )
}

export default PipelineFilterPopover
