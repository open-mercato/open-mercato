"use client"

import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from '@open-mercato/ui/primitives/button'

export type DealMoreDetailsProps = {
  title: string
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  children: React.ReactNode
}

/**
 * Section card for the optional create-deal fields. Unlike `CollapsibleSection` it keeps
 * its children mounted while collapsed: the custom-attribute loader inside gates the
 * submit button, so unmounting it would leave the form stuck disabled.
 */
export function DealMoreDetails({ title, expanded, onExpandedChange, children }: DealMoreDetailsProps) {
  const contentId = React.useId()
  return (
    <section className={cn('rounded-lg border border-border bg-card p-6', expanded && 'space-y-5')}>
      <h3 className="text-sm font-semibold">
        <Button
          type="button"
          variant="ghost"
          className="h-auto justify-start p-0 font-semibold has-[>svg]:px-0 hover:bg-transparent hover:text-foreground dark:hover:bg-transparent"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => onExpandedChange(!expanded)}
        >
          <ChevronDown
            className={cn('size-4 text-muted-foreground transition-transform duration-200', !expanded && '-rotate-90')}
          />
          {title}
        </Button>
      </h3>
      <div id={contentId} className="space-y-5" hidden={!expanded}>
        {children}
      </div>
    </section>
  )
}

export default DealMoreDetails
