'use client'

/**
 * Where a host-owned task is finished (issue #7179).
 *
 * A step that declares `userTaskConfig.completion.surface: 'host'` is completed
 * inside its host module's own flow, so the task page offers no generic form or
 * Complete button. Hiding them alone would leave a dead end; this states why and
 * links to the declared host `href`. Without an `href`, the host renders its UI
 * in the `workflows.task.detail:context` injection spot on this same page.
 */

import * as React from 'react'
import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { TaskCompletion } from '../../lib/task-completion'

export type HostCompletionNoticeProps = {
  completion: TaskCompletion
}

export function HostCompletionNotice({ completion }: HostCompletionNoticeProps) {
  const t = useT()

  return (
    <Alert status="information" data-testid="task-host-completion">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm">
          {completion.href
            ? t('workflows.tasks.detail.hostCompletion.description')
            : t('workflows.tasks.detail.hostCompletion.descriptionInline')}
        </p>
        {completion.href ? (
          <Button asChild size="sm">
            <Link href={completion.href} data-testid="task-host-completion-link">
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              {t('workflows.tasks.detail.hostCompletion.open')}
            </Link>
          </Button>
        ) : null}
      </div>
    </Alert>
  )
}
