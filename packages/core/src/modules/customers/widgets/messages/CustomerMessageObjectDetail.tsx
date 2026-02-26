"use client"

import * as React from 'react'
import Link from 'next/link'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ObjectDetailProps } from '@open-mercato/shared/modules/messages/types'
import { Button } from '@open-mercato/ui/primitives/button'
import { CustomerMessageObjectPreview } from './CustomerMessageObjectPreview'

function resolveActionHref(template: string, entityId: string): string {
  return template.replace('{entityId}', encodeURIComponent(entityId))
}

export function CustomerMessageObjectDetail(props: ObjectDetailProps) {
  const t = useT()
  const [executingActionId, setExecutingActionId] = React.useState<string | null>(null)

  const viewAction = props.actions.find((a) => a.id === 'view')
  const otherActions = props.actions.filter((a) => a.id !== 'view')

  const preview = (
    <CustomerMessageObjectPreview
      entityId={props.entityId}
      entityModule={props.entityModule}
      entityType={props.entityType}
      snapshot={props.snapshot}
      previewData={props.previewData}
      actionRequired={props.actionRequired}
      actionType={props.actionType}
      actionLabel={props.actionLabel}
    />
  )

  return (
    <div className="space-y-3 rounded border p-3">
      {viewAction?.href ? (
        <Link
          href={resolveActionHref(viewAction.href, props.entityId)}
          className="block rounded-md transition-opacity hover:opacity-75"
        >
          {preview}
        </Link>
      ) : (
        preview
      )}

      {otherActions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {otherActions.map((action) => {
            if (action.href) {
              return (
                <Button
                  key={action.id}
                  type="button"
                  size="sm"
                  variant={action.variant ?? 'default'}
                  asChild
                >
                  <Link href={resolveActionHref(action.href, props.entityId)}>
                    {t(action.labelKey ?? action.id, action.id)}
                  </Link>
                </Button>
              )
            }
            return (
              <Button
                key={action.id}
                type="button"
                size="sm"
                variant={action.variant ?? 'default'}
                disabled={executingActionId !== null}
                onClick={async () => {
                  if (executingActionId) return
                  setExecutingActionId(action.id)
                  try {
                    await props.onAction(action.id, { id: props.entityId })
                  } finally {
                    setExecutingActionId(null)
                  }
                }}
              >
                {executingActionId === action.id
                  ? t('messages.actions.executing', 'Executing...')
                  : t(action.labelKey ?? action.id, action.id)}
              </Button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

export default CustomerMessageObjectDetail

