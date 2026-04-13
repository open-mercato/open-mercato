'use client'

import * as React from 'react'
import { Sparkles, FileText, Mail, Reply, BarChart3, Play, ListTodo, Users, NotebookPen } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@open-mercato/ui/primitives/tooltip'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type ActivityAiActionsProps = {
  activityType: string
}

const ACTIONS_BY_TYPE = {
  call: [
    { key: 'customers.ai.actions.ai', fallback: 'AI', icon: Sparkles },
    { key: 'customers.ai.actions.summarize', fallback: 'Summarize', icon: FileText },
    { key: 'customers.ai.actions.replay', fallback: 'Play', icon: Play },
    { key: 'customers.ai.actions.transcription', fallback: 'Transcription', icon: NotebookPen },
    { key: 'customers.ai.actions.actionItems', fallback: 'Action items', icon: ListTodo },
  ],
  email: [
    { key: 'customers.ai.actions.ai', fallback: 'AI', icon: Sparkles },
    { key: 'customers.ai.actions.summarize', fallback: 'Summarize', icon: FileText },
    { key: 'customers.ai.actions.showEmail', fallback: 'Show email', icon: Mail },
    { key: 'customers.ai.actions.reply', fallback: 'Reply', icon: Reply },
    { key: 'customers.ai.actions.sentiment', fallback: 'Sentiment', icon: BarChart3 },
  ],
  meeting: [
    { key: 'customers.ai.actions.ai', fallback: 'AI', icon: Sparkles },
    { key: 'customers.ai.actions.summarize', fallback: 'Summarize', icon: FileText },
    { key: 'customers.ai.actions.notes', fallback: 'Notes', icon: NotebookPen },
    { key: 'customers.ai.actions.attendees', fallback: 'Attendees', icon: Users },
  ],
  note: [
    { key: 'customers.ai.actions.ai', fallback: 'AI', icon: Sparkles },
    { key: 'customers.ai.actions.summarize', fallback: 'Summarize', icon: FileText },
  ],
} as const

export function ActivityAiActions({ activityType }: ActivityAiActionsProps) {
  const t = useT()
  const actions = ACTIONS_BY_TYPE[activityType as keyof typeof ACTIONS_BY_TYPE] ?? ACTIONS_BY_TYPE.note

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex flex-wrap items-center gap-1.5">
        {actions.map((action) => (
          <Tooltip key={action.key}>
            <TooltipTrigger asChild>
              <span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled
                  className="h-auto rounded-full px-2 py-1 text-[10px] text-muted-foreground opacity-100"
                >
                  <action.icon className="mr-1 size-3" />
                  {t(action.key, action.fallback)}
                </Button>
              </span>
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

export default ActivityAiActions
