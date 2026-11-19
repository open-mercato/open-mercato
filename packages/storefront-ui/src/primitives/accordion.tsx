'use client'

import * as React from 'react'
import * as AccordionPrimitive from '@radix-ui/react-accordion'
import { cn } from '../lib/cn'
import { ChevronDownIcon, PlusIcon } from '../lib/icons'

type Icon = 'plus' | 'chevron'
const DEFAULT_GLYPH: Icon = 'plus'
const IconContext = React.createContext<Icon>(DEFAULT_GLYPH)

type RootProps = React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Root> & { icon?: Icon }

const AccordionRoot = React.forwardRef<React.ElementRef<typeof AccordionPrimitive.Root>, RootProps>(function Accordion(
  { icon, className, ...props },
  ref,
) {
  return (
    <IconContext.Provider value={icon ?? DEFAULT_GLYPH}>
      <AccordionPrimitive.Root ref={ref} data-slot="accordion" className={cn('flex flex-col border-t border-border', className)} {...props} />
    </IconContext.Provider>
  )
})

const AccordionItem = React.forwardRef<React.ElementRef<typeof AccordionPrimitive.Item>, React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Item>>(
  function AccordionItem({ className, ...props }, ref) {
    return <AccordionPrimitive.Item ref={ref} data-slot="accordion-item" className={cn('border-b border-border', className)} {...props} />
  },
)

export type AccordionTriggerProps = React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Trigger> & {
  /** Heading level wrapping the trigger, for document outline. */
  headingLevel?: 2 | 3 | 4
  icon?: React.ReactNode
}

const AccordionTrigger = React.forwardRef<React.ElementRef<typeof AccordionPrimitive.Trigger>, AccordionTriggerProps>(function AccordionTrigger(
  { className, headingLevel = 3, icon, children, ...props },
  ref,
) {
  const glyph = React.useContext(IconContext)
  const Heading = `h${headingLevel}` as const
  return (
    <AccordionPrimitive.Header asChild>
      <Heading className="flex">
        <AccordionPrimitive.Trigger
          ref={ref}
          data-slot="accordion-trigger"
          className={cn(
            'group flex min-h-13 flex-1 cursor-pointer items-center justify-between gap-4 py-3 text-left text-sf-body text-foreground outline-none transition-colors',
            'hover:text-muted-foreground focus-visible:shadow-focus disabled:cursor-not-allowed disabled:text-text-disabled',
            '[&>svg]:size-5 [&>svg]:shrink-0 [&>svg]:text-muted-foreground [&>svg]:transition-transform [&>svg]:duration-(--sf-motion-base)',
            className,
          )}
          {...props}
        >
          <span className="flex items-center gap-3">{icon}{children}</span>
          {glyph === 'chevron' ? <ChevronDownIcon className="group-data-[state=open]:rotate-180" /> : <PlusIcon className="group-data-[state=open]:rotate-45" />}
        </AccordionPrimitive.Trigger>
      </Heading>
    </AccordionPrimitive.Header>
  )
})

const AccordionContent = React.forwardRef<React.ElementRef<typeof AccordionPrimitive.Content>, React.ComponentPropsWithoutRef<typeof AccordionPrimitive.Content>>(
  function AccordionContent({ className, children, ...props }, ref) {
    return (
      <AccordionPrimitive.Content
        ref={ref}
        data-slot="accordion-content"
        className="overflow-hidden text-sf-body text-muted-foreground data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up"
        {...props}
      >
        <div className={cn('pb-4 pt-1', className)}>{children}</div>
      </AccordionPrimitive.Content>
    )
  },
)

export const Accordion = Object.assign(AccordionRoot, { Item: AccordionItem, Trigger: AccordionTrigger, Content: AccordionContent })
