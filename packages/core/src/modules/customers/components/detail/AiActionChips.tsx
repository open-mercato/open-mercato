'use client'

import * as React from 'react'
import { Sparkles } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@open-mercato/ui/primitives/tooltip'

type ActivityType = 'call' | 'email' | 'meeting' | 'note' | string

const ACTION_MAP: Record<string, Array<{ labelKey: string; fallback: string }>> = {
  call: [
    { labelKey: 'customers.ai.actions.summarize', fallback: 'Summarize' },
    { labelKey: 'customers.ai.actions.replay', fallback: 'Replay' },
    { labelKey: 'customers.ai.actions.transcription', fallback: 'Transcription' },
    { labelKey: 'customers.ai.actions.actionItems', fallback: 'Action items' },
  ],
  email: [
    { labelKey: 'customers.ai.actions.summarize', fallback: 'Summarize' },
    { labelKey: 'customers.ai.actions.showEmail', fallback: 'Show email' },
    { labelKey: 'customers.ai.actions.reply', fallback: 'Reply' },
    { labelKey: 'customers.ai.actions.sentiment', fallback: 'Sentiment' },
  ],
  meeting: [
    { labelKey: 'customers.ai.actions.summarize', fallback: 'Summarize' },
    { labelKey: 'customers.ai.actions.replay', fallback: 'Replay' },
    { labelKey: 'customers.ai.actions.actionItems', fallback: 'Action items' },
    { labelKey: 'customers.ai.actions.leadScore', fallback: 'Lead score' },
  ],
  note: [
    { labelKey: 'customers.ai.actions.expand', fallback: 'Expand' },
    { labelKey: 'customers.ai.actions.bulletize', fallback: 'Bulletize' },
    { labelKey: 'customers.ai.actions.translate', fallback: 'Translate' },
  ],
}

interface AiActionChipsProps {
  activityType: ActivityType
}

export function AiActionChips({ activityType }: AiActionChipsProps) {
  const t = useT()
  const actions = ACTION_MAP[activityType] ?? ACTION_MAP.note

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center gap-0.5">
        <span className="mr-1 text-[10px] text-muted-foreground">AI:</span>
        {actions.map((action, index) => (
          <React.Fragment key={action.labelKey}>
            {index > 0 && <span className="text-[10px] text-muted-foreground/40">|</span>}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto inline-flex items-center gap-0.5 px-1 py-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  <Sparkles className="size-2.5" />
                  {t(action.labelKey, action.fallback)}
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
