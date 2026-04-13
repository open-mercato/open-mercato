'use client'

import * as React from 'react'
import { Lightbulb, Send } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@open-mercato/ui/primitives/tooltip'

interface DecisionMakersFooterProps {
  names: string[]
  suggestion?: string
  onSendInvitation?: () => void
}

export function DecisionMakersFooter({ names, suggestion, onSendInvitation }: DecisionMakersFooterProps) {
  const t = useT()

  if (names.length === 0) return null

  return (
    <div className="sticky bottom-0 flex flex-col gap-3 rounded-lg border bg-card px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3 min-w-0">
        <Lightbulb className="size-4 text-muted-foreground shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t('customers.people.decisionMakers.label', 'Decision Makers')}
          </p>
          <p className="text-sm font-medium truncate">
            {t('customers.people.decisionMakers.count', '{count} key people', { count: names.length })}:
            {' '}{names.join(' \u00b7 ')}
          </p>
          {suggestion && (
            <p className="text-xs text-muted-foreground mt-0.5">{suggestion}</p>
          )}
        </div>
      </div>
      {onSendInvitation && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="w-full shrink-0 sm:w-auto">
              <Button type="button" size="sm" disabled className="pointer-events-none w-full sm:w-auto">
                <Send className="mr-1.5 size-3.5" />
                {t('customers.people.decisionMakers.sendInvitation', 'Send invitation')}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{t('customers.ai.comingSoon', 'Coming soon')}</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
