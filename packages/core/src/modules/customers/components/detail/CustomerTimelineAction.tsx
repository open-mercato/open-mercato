"use client"

import * as React from 'react'
import { ListTodo } from 'lucide-react'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { CustomerTimelinePanel } from './CustomerTimelinePanel'

export type CustomerTimelineActionProps = {
  entityId: string
  entityType: 'company' | 'person'
  t: TranslateFn
}

export function CustomerTimelineAction({ entityId, entityType, t }: CustomerTimelineActionProps) {
  const [open, setOpen] = React.useState(false)

  return (
    <>
      <IconButton
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={t('customers.timeline.open', 'Open timeline')}
        title={t('customers.timeline.open', 'Open timeline')}
      >
        <ListTodo className="size-4" />
      </IconButton>
      <CustomerTimelinePanel
        entityId={entityId}
        entityType={entityType}
        open={open}
        onOpenChange={setOpen}
        t={t}
      />
    </>
  )
}
