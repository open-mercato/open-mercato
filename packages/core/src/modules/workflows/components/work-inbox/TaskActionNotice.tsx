'use client'

/**
 * Why an act surface is closed, in a form a human can act on.
 *
 * A disabled Complete button with no explanation is the same dead end the §6.4
 * refusal already was — the operator learns nothing and has no next step. This
 * renders the SERVER's reason (`data.actBlockedReason`) as a sentence plus, when
 * the remedy is reassignment and the caller may reassign, the control that
 * performs it.
 *
 * The reason is never re-derived here: the component receives the descriptor and
 * renders it. Status is never colour-only — every tone is paired with its own
 * icon and a translated sentence.
 */

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { TaskActionBlockDescriptor } from '../../lib/work-inbox/presentation'
import { WORK_INBOX_ICONS } from './StatusChip'

export type TaskActionNoticeProps = {
  descriptor: TaskActionBlockDescriptor
  /** The caller holds `workflows.tasks.reassign` and the row is still open. */
  canReassign: boolean
  disabled?: boolean
  onReassign: () => void
}

export function TaskActionNotice({
  descriptor,
  canReassign,
  disabled,
  onReassign,
}: TaskActionNoticeProps) {
  const t = useT()
  const Icon = WORK_INBOX_ICONS[descriptor.iconName]
  const showRemedy = descriptor.remedy === 'reassign'

  return (
    <div
      data-testid="task-act-blocked"
      data-block-reason={descriptor.messageKey}
      className={`flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between ${descriptor.badge}`}
    >
      <p className={`flex items-start gap-2 text-sm ${descriptor.text}`}>
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${descriptor.icon}`} aria-hidden="true" />
        <span>
          {t(descriptor.messageKey)}
          {showRemedy ? (
            <>
              {' '}
              {canReassign
                ? t('workflows.tasks.detail.blocked.reassignRemedy')
                : t('workflows.tasks.detail.blocked.reassignUnavailable')}
            </>
          ) : null}
        </span>
      </p>
      {showRemedy && canReassign ? (
        <Button
          type="button"
          variant="outline"
          data-testid="task-reassign"
          disabled={disabled}
          onClick={onReassign}
          className="w-full sm:w-auto"
        >
          {t('workflows.tasks.actions.reassign')}
        </Button>
      ) : null}
    </div>
  )
}

export default TaskActionNotice
