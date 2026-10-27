"use client"

import * as React from 'react'
import Link from 'next/link'
import { Loader2, Save, Trash2 } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { Button } from '@open-mercato/ui/primitives/button'

export type PlacementFormShellProps<TValues extends Record<string, unknown>> = {
  title: string
  subtitle?: string
  backHref: string
  formId: string
  fields: CrudField[]
  groups: CrudFormGroup[]
  initialValues: Partial<TValues>
  submitLabel: string
  blocked: boolean
  blockedMessage: string
  onSubmit: (values: TValues) => Promise<void>
  onDelete?: () => Promise<void>
  deleteLabel?: string
  deleteDisabledReason?: string | null
  contentHeader?: React.ReactNode
  children?: React.ReactNode
}

export function PlacementFormShell<TValues extends Record<string, unknown>>(props: PlacementFormShellProps<TValues>) {
  const t = useT()
  const [pending, setPending] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const { blocked, blockedMessage, onSubmit, onDelete } = props

  const handleSubmit = React.useCallback(async (values: TValues) => {
    if (blocked) throw createCrudFormError(blockedMessage)
    setPending(true)
    try {
      await onSubmit(values)
    } finally {
      setPending(false)
    }
  }, [blocked, blockedMessage, onSubmit])

  const handleDelete = React.useCallback(async () => {
    if (!onDelete) return
    setDeleting(true)
    try {
      await onDelete()
    } finally {
      setDeleting(false)
    }
  }, [onDelete])

  const deleteDisabled = Boolean(props.deleteDisabledReason) || deleting
  const buttons = (
    <div className="flex flex-wrap items-center gap-2">
      {onDelete ? (
        <Button type="button" variant="destructive-outline" onClick={() => { void handleDelete() }} disabled={deleteDisabled}>
          {deleting ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Trash2 className="mr-2 size-4" />}
          {props.deleteLabel ?? t('property_management.common.delete', 'Delete')}
        </Button>
      ) : null}
      <Button asChild variant="outline">
        <Link href={props.backHref}>{t('property_management.common.cancel', 'Cancel')}</Link>
      </Button>
      <Button type="submit" form={props.formId} disabled={blocked || pending} data-testid="placement-submit">
        {pending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
        {props.submitLabel}
      </Button>
    </div>
  )

  return (
    <Page>
      <PageBody>
        <div className="space-y-4">
          <FormHeader mode="edit" backHref={props.backHref} title={props.title} titleHeadingLevel={1} actionsContent={buttons} />
          {props.subtitle ? <p className="text-sm text-muted-foreground">{props.subtitle}</p> : null}
          {props.contentHeader}
          <CrudForm<TValues>
            embedded
            hideFooterActions
            formId={props.formId}
            fields={props.fields}
            groups={props.groups}
            initialValues={props.initialValues}
            submitLabel={props.submitLabel}
            onSubmit={handleSubmit}
          />
          {props.children}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
            <p className="text-sm text-muted-foreground">{props.deleteDisabledReason ?? (blocked ? blockedMessage : '')}</p>
            {buttons}
          </div>
        </div>
      </PageBody>
    </Page>
  )
}

export type PlacementPageStateProps = {
  loading: boolean
  notFound: boolean
  error: boolean
  backHref: string
}

export function PlacementPageState({ loading, notFound, error, backHref }: PlacementPageStateProps) {
  const t = useT()
  return (
    <Page>
      <PageBody>
        {loading ? <LoadingMessage label={t('property_management.common.loading', 'Loading…')} /> : null}
        {!loading && notFound ? (
          <RecordNotFoundState
            label={t('property_management.common.notFound', 'This record was not found.')}
            backHref={backHref}
            backLabel={t('property_management.common.back', 'Back')}
          />
        ) : null}
        {!loading && !notFound && error ? <ErrorMessage label={t('property_management.common.loadError', 'Could not load the data.')} /> : null}
      </PageBody>
    </Page>
  )
}
