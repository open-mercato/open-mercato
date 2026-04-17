'use client'

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@open-mercato/ui/primitives/tooltip'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { AI_CARD_ACTIONS_BY_TYPE, resolveAiActions } from './aiActionCatalog'

type ActivityAiActionsProps = {
  activityType: string
}

export function ActivityAiActions({ activityType }: ActivityAiActionsProps) {
  const t = useT()
  const actions = resolveAiActions(activityType, AI_CARD_ACTIONS_BY_TYPE)

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex flex-wrap items-center gap-1.5">
        {actions.map((action) => {
          const Icon = action.icon
          return (
            <Tooltip key={action.key}>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled
                    className="h-auto rounded-full px-2 py-1 text-xs text-muted-foreground opacity-100"
                  >
                    <Icon className="mr-1 size-3" />
                    {t(action.i18nKey, action.fallback)}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                {t('customers.ai.comingSoon', 'Coming soon')}
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </TooltipProvider>
  )
}

export default ActivityAiActions
