"use client"

import * as React from 'react'
import { Forward, Reply, Send } from 'lucide-react'
import { CrudForm } from '../CrudForm'
import { Button } from '../../primitives/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../primitives/dialog'
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

  const composePanel = (
    <CrudForm<Record<string, unknown>>
      backHref={backHref}
      title={compose.composerTitle}
      fields={createMessageComposeFormGroups(compose)}
      initialValues={{}}
      submitLabel={compose.submitLabel}
      submitIcon={SubmitIcon}
      extraActions={compose.inline ? inlineExtraActions : dialogExtraActions}
      hideFooterActions
      onSubmit={async () => {
        await compose.handleSubmit()
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
