"use client"

import * as React from 'react'
import { Forward, Reply, Send } from 'lucide-react'
import { CrudForm } from '../CrudForm'
import { Button } from '../../primitives/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../primitives/dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { getMessageUiComponentRegistry } from '@open-mercato/core/modules/messages/components/utils/typeUiRegistry'
import { createMessageComposeFormGroups } from './message-compose-form-groups'
import { useMessageCompose } from './useMessageCompose'
import type { MessageComposerContextObject, MessageComposerProps } from './message-composer.types'

export type {
  MessageComposerContextObject,
  MessageComposerProps,
  MessageComposerRequiredActionConfig,
  MessageComposerRequiredActionOption,
  MessageComposerVariant,
  MessageTypeItem,
} from './message-composer.types'

function ContextObjectPreview({ contextObject }: { contextObject: MessageComposerContextObject }) {
  const t = useT()
  const registry = getMessageUiComponentRegistry()
  const previewComponentKey = `${contextObject.entityModule}:${contextObject.entityType}`
  const PreviewComponent = registry.objectPreviewComponents[previewComponentKey]
    ?? registry.objectPreviewComponents['messages:default']

  if (PreviewComponent) {
    return (
      <PreviewComponent
        entityId={contextObject.entityId}
        entityModule={contextObject.entityModule}
        entityType={contextObject.entityType}
        actionRequired={contextObject.actionRequired}
        actionType={contextObject.actionType}
        actionLabel={contextObject.actionLabel}
        previewData={contextObject.previewData ?? undefined}
      />
    )
  }

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t('messages.composer.contextPreview.title', 'Context object')}
      </p>
      <p className="text-sm font-medium">
        {contextObject.entityModule}:{contextObject.entityType}
      </p>
      <p className="text-xs font-mono text-muted-foreground">
        {contextObject.entityId}
      </p>
    </div>
  )
}

export function MessageComposer(props: MessageComposerProps) {
  const compose = useMessageCompose(props)
  const inlineBackHref = props.inlineBackHref
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
    return <ContextObjectPreview contextObject={props.contextObject} />
  }, [compose.contextPreview, props.contextObject])

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
