"use client"

import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Button } from '@open-mercato/ui/primitives/button'
import { cn } from '@open-mercato/shared/lib/utils'
import type { EntitySearchItem } from './useEntitySearch'

type EntityPickerResultsProps = {
  listId: string
  items: EntitySearchItem[]
  activeIndex: number
  hasQuery: boolean
  isLoading: boolean
  hasSearched: boolean
  prompt: string
  loadingLabel: string
  emptyLabel: string
  onActiveIndexChange: (index: number) => void
  onSelect: (item: EntitySearchItem) => void
}

export function EntityPickerResults(props: EntityPickerResultsProps) {
  return (
    <div id={props.listId} role="listbox" className="min-h-56 max-h-80 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground">
      {!props.hasQuery ? <div className="px-3 py-8 text-center text-sm text-muted-foreground">{props.prompt}</div> : null}
      {props.hasQuery && props.isLoading ? (
        <div className="flex items-center justify-center gap-2 px-3 py-8 text-sm text-muted-foreground"><Spinner className="size-4" /><span>{props.loadingLabel}</span></div>
      ) : null}
      {props.hasQuery && !props.isLoading && props.hasSearched && props.items.length === 0 ? (
        <div className="px-3 py-8 text-center text-sm text-muted-foreground">{props.emptyLabel}</div>
      ) : null}
      {!props.isLoading && props.items.map((item, index) => (
        <Button
          id={`${props.listId}-option-${index}`}
          key={item.id}
          type="button"
          variant="ghost"
          role="option"
          aria-selected={index === props.activeIndex}
          className={cn('h-auto w-full justify-start px-3 py-2 text-left', index === props.activeIndex ? 'bg-accent text-accent-foreground' : null)}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => props.onActiveIndexChange(index)}
          onClick={() => props.onSelect(item)}
        >
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{item.label}</span>
            {item.subtitle ? <span className="block truncate text-xs text-muted-foreground">{item.subtitle}</span> : null}
          </span>
        </Button>
      ))}
    </div>
  )
}
