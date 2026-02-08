"use client"

import * as React from 'react'
import Link from 'next/link'
import { Trash2, Loader2 } from 'lucide-react'
import { Button } from '../../primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { FormActionButtons, type FormActionButtonsProps } from './FormActionButtons'
import { ActionsDropdown, type ActionItem } from './ActionsDropdown'

/** Base props shared by both modes */
type FormHeaderBaseProps = {
  /** Back link URL */
  backHref?: string
  /** Back link label */
  backLabel?: string
}

/** Edit mode: compact header for CrudForm pages */
export type FormHeaderEditProps = FormHeaderBaseProps & {
  mode?: 'edit'
  /** Small title next to the back link */
  title?: string
  /** Structured action buttons (Delete/Cancel/Save) */
  actions?: FormActionButtonsProps
  /** Custom right-side content (overrides `actions`) */
  actionsContent?: React.ReactNode
}

/** Detail mode: large header for view/detail pages */
export type FormHeaderDetailProps = FormHeaderBaseProps & {
  mode: 'detail'
  /** Large title -- string renders as h1; ReactNode for InlineTextEditor */
  title?: React.ReactNode
  /** Small uppercase entity type label above the title */
  entityTypeLabel?: string
  /** Subtitle text below the title */
  subtitle?: string
  /** Status badge or similar element below the title */
  statusBadge?: React.ReactNode
  /** Context actions grouped into an "Actions" dropdown (preferred) */
  menuActions?: ActionItem[]
  /** Optional utility actions (icon-only) displayed before menu actions */
  utilityActions?: React.ReactNode
  /** Delete action -- rendered as a standalone destructive button next to the dropdown */
  onDelete?: () => void
  /** Delete button label */
  deleteLabel?: string
  /** Whether delete is in progress */
  isDeleting?: boolean
  /** Fallback: fully custom right-side content (overrides menuActions + onDelete) */
  actionsContent?: React.ReactNode
}

export type FormHeaderProps = FormHeaderEditProps | FormHeaderDetailProps

export function FormHeader(props: FormHeaderProps) {
  const t = useT()
  const resolvedBackLabel = props.backLabel ?? t('ui.navigation.back')

  if (props.mode === 'detail') {
    return <DetailHeader {...props} resolvedBackLabel={resolvedBackLabel} />
  }

  return <EditHeader {...props} resolvedBackLabel={resolvedBackLabel} />
}

function EditHeader({
  backHref,
  resolvedBackLabel,
  title,
  actions,
  actionsContent,
}: FormHeaderEditProps & { resolvedBackLabel: string }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <div className="flex items-center gap-3">
        {backHref ? (
          <Link href={backHref} className="text-sm text-muted-foreground hover:text-foreground">
            &larr; {resolvedBackLabel}
          </Link>
        ) : null}
        {title ? <div className="text-base font-medium">{title}</div> : null}
      </div>
      {actionsContent ?? (actions ? <FormActionButtons {...actions} /> : null)}
    </div>
  )
}

function DetailHeader({
  backHref,
  resolvedBackLabel,
  title,
  entityTypeLabel,
  subtitle,
  statusBadge,
  menuActions,
  utilityActions,
  onDelete,
  deleteLabel,
  isDeleting,
  actionsContent,
}: FormHeaderDetailProps & { resolvedBackLabel: string }) {
  const t = useT()
  const resolvedDeleteLabel = deleteLabel ?? t('ui.forms.actions.delete')

  const hasActions = actionsContent || utilityActions || menuActions?.length || onDelete

  return (
    <div className="flex flex-col gap-2 md:gap-3 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-wrap items-center gap-2 md:gap-3 min-w-0">
        {backHref ? (
          <Link
            href={backHref}
            className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground shrink-0"
          >
            <span aria-hidden className="mr-1 text-base">&larr;</span>
            <span className="sr-only">{resolvedBackLabel}</span>
          </Link>
        ) : null}
        <div className="space-y-0.5 md:space-y-1 min-w-0">
          {entityTypeLabel ? (
            <p className="text-xs uppercase text-muted-foreground">{entityTypeLabel}</p>
          ) : null}
          {title ? (
            typeof title === 'string' ? (
              <h1 className="text-lg md:text-2xl font-semibold leading-tight truncate">{title}</h1>
            ) : (
              <div className="text-lg md:text-2xl font-semibold leading-tight">{title}</div>
            )
          ) : null}
          {statusBadge}
          {subtitle ? (
            <p className="text-xs md:text-sm text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
      </div>
      {hasActions ? (
        <div className="flex flex-wrap items-center gap-2">
          {actionsContent ? actionsContent : (
            <>
              {utilityActions}
              {menuActions?.length ? <ActionsDropdown items={menuActions} /> : null}
              {onDelete ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onDelete}
                  disabled={isDeleting}
                  className="text-red-600 border-red-200 hover:bg-red-50 rounded"
                >
                  {isDeleting ? (
                    <Loader2 className="size-4 mr-2 animate-spin" />
                  ) : (
                    <Trash2 className="size-4 mr-2" />
                  )}
                  {resolvedDeleteLabel}
                </Button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
