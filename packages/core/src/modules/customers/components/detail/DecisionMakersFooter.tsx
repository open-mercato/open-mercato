'use client'

import * as React from 'react'
import { Lightbulb, Send } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'

interface DecisionMakersFooterProps {
  names: string[]
  suggestion?: string
  onSendInvitation?: () => void
}

export function DecisionMakersFooter({ names, suggestion, onSendInvitation }: DecisionMakersFooterProps) {
  const t = useT()

  if (names.length === 0) return null

  return (
    <div className="sticky bottom-0 flex items-center justify-between rounded-lg border bg-card px-4 py-3 shadow-sm">
      <div className="flex items-start gap-3 min-w-0">
        <Lightbulb className="size-4 text-muted-foreground shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t('customers.people.decisionMakers.label', 'Decision Makers')}
          </p>
          <p className="text-sm font-medium truncate">
            {t('customers.people.decisionMakers.count', '{{count}} key people', { count: names.length })}:
            {' '}{names.join(' · ')}
          </p>
          {suggestion && (
            <p className="text-xs text-muted-foreground mt-0.5">{suggestion}</p>
          )}
        </div>
      </div>
      {onSendInvitation && (
        <Button type="button" size="sm" onClick={onSendInvitation} className="shrink-0">
          <Send className="mr-1.5 size-3.5" />
          {t('customers.people.decisionMakers.sendInvitation', 'Send invitation')}
        </Button>
      )}
    </div>
  )
}
