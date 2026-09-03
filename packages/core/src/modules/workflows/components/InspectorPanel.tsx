'use client'

import * as React from 'react'
import { X } from 'lucide-react'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from '@open-mercato/ui/primitives/drawer'
import { useT } from '@open-mercato/shared/lib/i18n/context'

/**
 * How the inspector is presented.
 *
 * `docked` is the spec §4.1 right rail: it lives IN the editor's layout row, so
 * opening it shrinks the canvas rather than covering it, and the canvas stays
 * interactive underneath — clicking another step re-targets the same rail. That
 * is the whole point of an inspector, and it is what the 1280×675 modal this
 * replaces could not do.
 *
 * `overlay` is the same content in a modal Drawer, for viewports with no room
 * for a rail beside the canvas. Below the docking threshold a 384px rail leaves
 * the graph unusable, so covering it is the honest answer.
 */
export type InspectorPanelVariant = 'docked' | 'overlay'

export interface InspectorPanelProps {
  open: boolean
  onClose: () => void
  variant: InspectorPanelVariant
  /** Panel heading — what KIND of thing is being inspected ("Edit step"). */
  title: string
  /** Optional type chip beside the heading ("User task", "Route"). */
  typeLabel?: string
  /** Badge variant for the type chip — the route inspector colours it by trigger. */
  typeLabelVariant?: React.ComponentProps<typeof Badge>['variant']
  /** Optional one-line explanation under the heading. */
  description?: string
  /** Optional durable id rendered as a monospace chip. */
  recordId?: string
  /** Label for the id chip; defaults to the shared "ID" string. */
  recordIdLabel?: string
  /**
   * Extra header rows below the id chip. The route inspector uses it for the
   * `source → target` line, which is identity rather than configuration and so
   * belongs beside the id rather than inside the scrolling form.
   */
  headerExtra?: React.ReactNode
  /**
   * Widen the `overlay` Drawer to match the definition metadata drawer
   * (`sm:w-4/5`) instead of the DS default 400px. Content-dense inspectors — the
   * step editor with its Invoke-Agent, timeout and sub-editor sections — are
   * unusable at 400px, so they opt in. No effect on the `docked` rail.
   */
  wide?: boolean
  children: React.ReactNode
}

/**
 * The panel is `w-96` (384px) rather than the design's 380px: arbitrary
 * Tailwind values are banned repo-wide and 384px is the nearest DS step. Four
 * pixels do not read at this size.
 */
const DOCKED_WIDTH_CLASS = 'w-96'

function InspectorHeading({
  title,
  typeLabel,
  typeLabelVariant,
  description,
  recordId,
  recordIdLabel,
  headerExtra,
  titleId,
  descriptionId,
  as,
}: {
  title: string
  typeLabel?: string
  typeLabelVariant?: React.ComponentProps<typeof Badge>['variant']
  description?: string
  recordId?: string
  recordIdLabel: string
  headerExtra?: React.ReactNode
  titleId: string
  descriptionId: string
  as: 'plain' | 'drawer'
}) {
  return (
    <>
      <div className="flex items-center gap-2">
        {as === 'drawer' ? (
          <DrawerTitle id={titleId}>{title}</DrawerTitle>
        ) : (
          <h2 id={titleId} className="text-base font-semibold leading-tight text-foreground">
            {title}
          </h2>
        )}
        {typeLabel ? (
          <Badge variant={typeLabelVariant ?? 'secondary'} className="text-xs">
            {typeLabel}
          </Badge>
        ) : null}
      </div>
      {description ? (
        as === 'drawer' ? (
          <DrawerDescription id={descriptionId}>{description}</DrawerDescription>
        ) : (
          <p id={descriptionId} className="text-sm text-muted-foreground">
            {description}
          </p>
        )
      ) : null}
      {recordId ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium">{recordIdLabel}:</span>
          <code className="truncate rounded bg-muted px-1.5 py-0.5 font-mono">{recordId}</code>
        </div>
      ) : null}
      {headerExtra}
    </>
  )
}

/**
 * Shared shell for the step and route inspectors.
 *
 * Both surfaces render the SAME content through this component, so a step and a
 * route are always inspected in the same place with the same chrome — the two
 * used to be independent modals that had drifted apart in padding, heading
 * shape and close affordance.
 */
export function InspectorPanel({
  open,
  onClose,
  variant,
  title,
  typeLabel,
  typeLabelVariant,
  description,
  recordId,
  recordIdLabel,
  headerExtra,
  wide,
  children,
}: InspectorPanelProps) {
  const t = useT()
  const reactId = React.useId()
  const titleId = `${reactId}-title`
  const descriptionId = `${reactId}-description`
  const idLabel = recordIdLabel ?? t('workflows.fields.id', 'ID')

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key !== 'Escape') return
      // Only claim Escape that originated inside the rail. The docked panel is
      // not modal, so a global handler would steal Escape from the canvas.
      event.stopPropagation()
      onClose()
    },
    [onClose],
  )

  if (variant === 'overlay') {
    return (
      <Drawer open={open} onOpenChange={(next) => { if (!next) onClose() }}>
        <DrawerContent
          side="right"
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
          closeAriaLabel={t('workflows.inspector.close', 'Close inspector')}
          className={wide ? 'p-0 w-full max-w-none sm:w-4/5' : 'p-0'}
        >
          {/* Both variants carry the same `data-slot` marker: it is how any
              consumer addresses "the inspector" without knowing which layout it
              got. It cannot be spread onto `DrawerContent`, whose own
              `data-slot="drawer-content"` the spread would clobber. */}
          <div
            data-slot="workflow-inspector"
            data-variant="overlay"
            className="flex min-h-0 flex-1 flex-col"
          >
            <DrawerHeader className="border-b border-border/70">
              <InspectorHeading
                title={title}
                typeLabel={typeLabel}
                typeLabelVariant={typeLabelVariant}
                description={description}
                recordId={recordId}
                recordIdLabel={idLabel}
                headerExtra={headerExtra}
                titleId={titleId}
                descriptionId={descriptionId}
                as="drawer"
              />
            </DrawerHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">{children}</div>
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  if (!open) return null

  return (
    <aside
      role="complementary"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      data-slot="workflow-inspector"
      data-variant="docked"
      onKeyDown={handleKeyDown}
      className={`flex ${DOCKED_WIDTH_CLASS} min-h-0 shrink-0 flex-col overflow-hidden border-l border-border bg-card`}
    >
      <div className="flex shrink-0 items-start gap-2 border-b border-border/70 px-4 py-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <InspectorHeading
            title={title}
            typeLabel={typeLabel}
            typeLabelVariant={typeLabelVariant}
            description={description}
            recordId={recordId}
            recordIdLabel={idLabel}
            headerExtra={headerExtra}
            titleId={titleId}
            descriptionId={descriptionId}
            as="plain"
          />
        </div>
        <IconButton
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t('workflows.inspector.close', 'Close inspector')}
          onClick={onClose}
        >
          <X className="size-4" />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
    </aside>
  )
}

export default InspectorPanel
