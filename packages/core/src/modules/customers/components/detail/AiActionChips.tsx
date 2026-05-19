'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { AiIcon } from '@open-mercato/ui/ai/AiIcon'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@open-mercato/ui/primitives/tooltip'
import { AI_TIMELINE_ACTIONS_BY_TYPE, resolveAiActions } from './aiActionCatalog'

interface AiActionChipsProps {
  activityType: string
}

export function AiActionChips({ activityType }: AiActionChipsProps) {
  const t = useT()
  const actions = resolveAiActions(activityType, AI_TIMELINE_ACTIONS_BY_TYPE)

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] font-bold text-muted-foreground/70">
          {t('customers.ai.prefix', 'AI:')}
        </span>
        {actions.map((action) => (
          <Tooltip key={action.key}>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-[4px] border border-dashed border-border bg-card pl-1.5 pr-[7px] py-[3px] text-[9px] font-medium text-muted-foreground/70 transition-colors hover:border-muted-foreground hover:text-foreground"
              >
                <AiIcon className="size-2.5 shrink-0" />
                {t(action.i18nKey, action.fallback)}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {t('customers.ai.comingSoon', 'Coming soon')}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  )
}
