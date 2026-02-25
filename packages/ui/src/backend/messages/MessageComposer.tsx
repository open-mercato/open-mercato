"use client"

import * as React from 'react'
import { Forward, Reply, Send } from 'lucide-react'
import { CrudForm } from '../CrudForm'
import { Button } from '../../primitives/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../primitives/dialog'
import { getMessageUiComponentRegistry } from '@open-mercato/core/modules/messages/components/utils/typeUiRegistry'
import { createMessageComposeFormGroups } from './message-compose-form-groups'
import { useMessageCompose } from './useMessageCompose'
import type { MessageComposerProps } from './message-composer.types'

export type {
  MessageComposerContextObject,
  MessageComposerProps,
  MessageComposerRequiredActionConfig,
  MessageComposerRequiredActionOption,
  MessageComposerVariant,
  MessageTypeItem,
} from './message-composer.types'

export function MessageComposer(props: MessageComposerProps) {
  const compose = useMessageCompose(props)
  const inlineBackHref = props.inlineBackHref
  const messageUiRegistry = React.useMemo(() => getMessageUiComponentRegistry(), [])
  const SubmitIcon = compose.variant === 'reply'
    ? Reply
    : compose.variant === 'forward'
      ? Forward
      : Send

  const inlineExtraActions = compose.inline
    ? (
      <>
        {compose.variant === 'compose' ? (
          <Button
            type="button"
            variant="outline"
            onClick={compose.handleSaveDraft}
            disabled={compose.submitting}
          >
            {compose.t('messages.saveDraft', 'Save draft')}
          </Button>
        ) : null}
        {compose.variant !== 'compose' ? (
          <Button
            type="button"
            variant="outline"
            onClick={compose.handleBack}
            disabled={compose.submitting}
          >
            {compose.t('ui.forms.actions.cancel', 'Cancel')}
          </Button>
        ) : null}
      </>
    )
    : null

  const dialogExtraActions = !compose.inline
    ? (
      <>
        {compose.variant === 'compose' ? (
          <Button
            type="button"
            variant="outline"
            onClick={compose.handleSaveDraft}
            disabled={compose.submitting}
          >
            {compose.t('messages.saveDraft', 'Save draft')}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          onClick={compose.handleBack}
          disabled={compose.submitting}
        >
          {compose.t('ui.forms.actions.cancel', 'Cancel')}
        </Button>
      </>
    )
    : null

  const backHref = compose.inline
    ? inlineBackHref === undefined
      ? '/backend/messages'
      : inlineBackHref ?? undefined
    : undefined

  const fallbackContextPreview = React.useMemo(() => {
    if (compose.contextPreview) return compose.contextPreview
    if (!props.contextObject) return null

    const previewComponentKey = `${props.contextObject.entityModule}:${props.contextObject.entityType}`
    const PreviewComponent = messageUiRegistry.objectPreviewComponents[previewComponentKey]
      ?? messageUiRegistry.objectPreviewComponents['messages:default']

    if (PreviewComponent) {
      return (
        <PreviewComponent
          entityId={props.contextObject.entityId}
          entityModule={props.contextObject.entityModule}
          entityType={props.contextObject.entityType}
          actionRequired={props.contextObject.actionRequired}
          actionType={props.contextObject.actionType}
          actionLabel={props.contextObject.actionLabel}
        />
      )
    }

    return (
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {compose.t('messages.composer.contextPreview.title', 'Context object')}
        </p>
        <p className="text-sm font-medium">
          {props.contextObject.entityModule}:{props.contextObject.entityType}
        </p>
        <p className="text-xs font-mono text-muted-foreground">
          {props.contextObject.entityId}
        </p>
      </div>
    )
  }, [compose.contextPreview, compose.t, messageUiRegistry.objectPreviewComponents, props.contextObject])

  const composeWithContextPreview = React.useMemo(
    () => ({ ...compose, contextPreview: fallbackContextPreview }),
    [compose, fallbackContextPreview],
  )

  const composePanel = (
    <CrudForm<Record<string, unknown>>
      backHref={backHref}
      title={composeWithContextPreview.composerTitle}
      fields={createMessageComposeFormGroups(composeWithContextPreview)}
      initialValues={{}}
      submitLabel={composeWithContextPreview.submitLabel}
      submitIcon={SubmitIcon}
      extraActions={composeWithContextPreview.inline ? inlineExtraActions : dialogExtraActions}
      hideFooterActions
      onSubmit={async () => {
        await composeWithContextPreview.handleSubmit()
      }}
    />
  )

  if (compose.inline) {
    return (
      <div className="space-y-4">
        {composePanel}
      </div>
    )
  }

  return (
    <Dialog open={Boolean(compose.open)} onOpenChange={compose.handleDialogOpenChange}>
      <DialogContent className="sm:max-w-3xl [&>button]:hidden">
        <DialogHeader className="sr-only">
          <DialogTitle>{compose.composerTitle}</DialogTitle>
        </DialogHeader>
        {composePanel}
        <div className="flex items-center justify-end gap-2 border-t pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={compose.handleBack}
            disabled={compose.submitting}
          >
            {compose.t('ui.forms.actions.cancel', 'Cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => {
              void compose.handleSubmit()
            }}
            disabled={compose.submitting}
          >
            <SubmitIcon className="mr-2 size-4" />
            {compose.submitLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
