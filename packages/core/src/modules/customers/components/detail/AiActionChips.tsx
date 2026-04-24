'use client'

import * as React from 'react'
import { Sparkles } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
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
      <div className="flex items-center gap-0.5">
        <span className="mr-1 text-xs text-muted-foreground">
          {t('customers.ai.prefix', 'AI:')}
        </span>
        {actions.map((action, index) => (
          <React.Fragment key={action.key}>
            {index > 0 && <span className="text-xs text-muted-foreground/40">|</span>}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto inline-flex items-center gap-0.5 px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  <Sparkles className="size-2.5" />
                  {t(action.i18nKey, action.fallback)}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                {t('customers.ai.comingSoon', 'Coming soon')}
              </TooltipContent>
            </Tooltip>
          </React.Fragment>
        ))}
      </div>
    </TooltipProvider>
  )
}
