import * as React from 'react'
import { FileCode, Globe, Lock } from 'lucide-react'
import { type CrudField } from '../CrudForm'
import { IconButton } from '../../primitives/icon-button'
import { Input } from '../../primitives/input'
import { Label } from '../../primitives/label'
import { Switch } from '../../primitives/switch'
import { AttachmentsSection } from '../detail/AttachmentsSection'
import { SwitchableMarkdownInput } from '../inputs/SwitchableMarkdownInput'
import { TagsInput } from '../inputs/TagsInput'
import { MessagePrioritySelector } from './MessagePrioritySelector'
import type { UseMessageComposeResult } from './useMessageCompose'

type ComposeProps = {
  compose: UseMessageComposeResult
}

function RecipientTagsInput({ compose }: ComposeProps) {
  return (
    <TagsInput
      value={compose.recipientIds}
      onChange={compose.setRecipientIds}
      selectedOptions={compose.selectedRecipientOptions}
      resolveLabel={compose.resolveRecipientLabel}
      loadSuggestions={compose.loadRecipientSuggestions}
      placeholder={compose.t('messages.placeholders.recipients', 'Search recipients...')}
      allowCustomValues={false}
      showSuggestionsOnFocus={false}
    />
  )
}

function VisibilitySelector({ compose }: ComposeProps) {
  return (
    <>
      <Label>{compose.t('messages.visibility', 'Visibility')}</Label>
      <div
        className="inline-flex items-center gap-1 rounded-md border bg-background p-1"
        role="radiogroup"
        aria-label={compose.t('messages.visibility', 'Visibility')}
      >
        <IconButton
          type="button"
          size="xs"
          variant={compose.visibility === 'internal' ? 'outline' : 'ghost'}
          role="radio"
          aria-checked={compose.visibility === 'internal'}
          aria-label={compose.t('messages.visibilityInternal', 'Internal')}
          title={compose.t('messages.visibilityInternal', 'Internal')}
          className="h-7 w-7"
          onClick={() => compose.setVisibility('internal')}
        >
          <Lock className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton
          type="button"
          size="xs"
          variant={compose.visibility === 'public' ? 'outline' : 'ghost'}
          role="radio"
          aria-checked={compose.visibility === 'public'}
          aria-label={compose.t('messages.visibilityPublic', 'Public')}
          title={compose.t('messages.visibilityPublic', 'Public')}
          className="h-7 w-7"
          onClick={() => compose.setVisibility('public')}
        >
          <Globe className="h-3.5 w-3.5" />
        </IconButton>
      </div>
      <p className="text-xs text-muted-foreground">
        {compose.visibility === 'public'
          ? compose.t('messages.visibilityPublicHint', 'Public messages are sent to external email only.')
          : compose.t('messages.visibilityInternalHint', 'Internal messages are sent to selected system users.')}
      </p>
    </>
  )
}

function ContextActionsSection({ compose }: ComposeProps) {
  if (!compose.shouldShowContextActions) return null

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {compose.normalizedRequiredActionMode === 'optional' ? (
        <div className="flex items-center justify-between rounded border px-3 py-2 sm:col-span-2">
          <div>
            <p className="text-sm font-medium">
              {compose.t('messages.composer.objectPicker.actionRequiredLabel', 'Action required')}
            </p>
            <p className="text-xs text-muted-foreground">
              {compose.t('messages.composer.objectPicker.actionRequiredHint', 'Mark this object as requiring recipient action.')}
            </p>
          </div>
          <Switch checked={compose.contextActionRequired} onCheckedChange={compose.setContextActionRequired} />
        </div>
      ) : null}
      {compose.normalizedRequiredActionMode === 'required' || compose.contextActionRequired ? (
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="messages-compose-context-action-type">
            {compose.t('messages.composer.objectPicker.actionTypeLabel', 'Action type')}
          </Label>
          <select
            id="messages-compose-context-action-type"
            value={compose.contextActionType}
            onChange={(event) => compose.setContextActionType(event.target.value)}
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          >
            <option value="">{compose.t('messages.composer.objectPicker.actionTypePlaceholder', 'Select action')}</option>
            {compose.contextActionOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  )
}

function PrioritySelector({ compose }: ComposeProps) {
  return (
    <>
      <Label>{compose.t('messages.priority', 'Priority')}</Label>
      <MessagePrioritySelector
        value={compose.priority}
        onChange={compose.setPriority}
        t={compose.t}
      />
    </>
  )
}

function MarkdownBodySection({
  compose,
  label,
  placeholder,
  inputId,
  rows,
  textareaClassName,
}: ComposeProps & {
  label: string
  placeholder: string
  inputId: string
  rows: number
  textareaClassName: string
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={inputId}>{label}</Label>
        <IconButton
          type="button"
          size="sm"
          variant={compose.bodyFormat === 'markdown' ? 'outline' : 'ghost'}
          aria-pressed={compose.bodyFormat === 'markdown'}
          onClick={() => compose.setBodyFormat((previousValue) => (previousValue === 'markdown' ? 'text' : 'markdown'))}
          title={compose.t('messages.bodyFormat.toggle', 'Toggle markdown')}
        >
          <FileCode className="h-4 w-4" />
        </IconButton>
      </div>
      <div id={inputId}>
        <SwitchableMarkdownInput
          value={compose.body}
          onChange={compose.setBody}
          isMarkdownEnabled={compose.bodyFormat === 'markdown'}
          rows={rows}
          placeholder={placeholder}
          textareaClassName={textareaClassName}
        />
      </div>
    </div>
  )
}

function ComposeModeFields({ compose }: ComposeProps) {
  return (
    <>
      {compose.contextPreview ? (
        <div className="rounded border bg-muted/30 p-3 text-sm">
          {compose.contextPreview}
        </div>
      ) : null}

      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            {compose.visibility === 'public' ? (
              <>
                <Label htmlFor="messages-compose-external-email">{compose.t('messages.externalEmail', 'External email')}</Label>
                <Input
                  id="messages-compose-external-email"
                  type="email"
                  value={compose.externalEmail}
                  onChange={(event) => compose.setExternalEmail(event.target.value)}
                  placeholder={compose.t('messages.placeholders.externalEmail', 'name@example.com')}
                />
              </>
            ) : (
              <>
                <Label htmlFor="messages-compose-recipients">{compose.t('messages.to', 'To')}</Label>
                <RecipientTagsInput compose={compose} />
              </>
            )}
          </div>

          <div className="space-y-2">
            <VisibilitySelector compose={compose} />
          </div>
        </div>

        <ContextActionsSection compose={compose} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="messages-compose-subject">{compose.t('messages.subject', 'Subject')}</Label>
          <Input
            id="messages-compose-subject"
            value={compose.subject}
            onChange={(event) => compose.setSubject(event.target.value)}
            placeholder={compose.t('messages.placeholders.subject', 'Enter subject...')}
          />
        </div>

        <div className="space-y-2">
          <PrioritySelector compose={compose} />
        </div>
      </div>

      <MarkdownBodySection
        compose={compose}
        label={compose.t('messages.body', 'Message')}
        placeholder={compose.t('messages.placeholders.body', 'Write your message...')}
        inputId="messages-compose-body"
        rows={8}
        textareaClassName="min-h-[180px] w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      />

      <div className="space-y-2">
        <Label>{compose.t('messages.attachedFiles', 'Attachments')}</Label>
        <AttachmentsSection
          entityId={compose.attachmentEntityId}
          recordId={compose.attachmentRecordId}
          showHeader={false}
          compact
          onChanged={() => {
            void compose.loadAttachmentIds().catch(() => null)
          }}
        />
      </div>
    </>
  )
}

function ReplyModeFields({ compose }: ComposeProps) {
  return (
    <>
      <MarkdownBodySection
        compose={compose}
        label={compose.t('messages.replyBody', 'Reply')}
        placeholder={compose.t('messages.placeholders.replyBody', 'Write your reply...')}
        inputId="messages-compose-body"
        rows={8}
        textareaClassName="min-h-[180px] w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      />

      <div className="space-y-2">
        <Label>{compose.t('messages.attachedFiles', 'Attachments')}</Label>
        <AttachmentsSection
          entityId={compose.attachmentEntityId}
          recordId={compose.attachmentRecordId}
          showHeader={false}
          compact
          onChanged={() => {
            void compose.loadAttachmentIds().catch(() => null)
          }}
        />
      </div>
    </>
  )
}

function ForwardModeFields({ compose }: ComposeProps) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="messages-compose-recipients">{compose.t('messages.to', 'To')}</Label>
        <RecipientTagsInput compose={compose} />
      </div>

      <MarkdownBodySection
        compose={compose}
        label={compose.t('messages.forwardContent', 'Forwarded content')}
        placeholder={compose.t('messages.placeholders.forwardContent', 'Review and edit forwarded content...')}
        inputId="messages-forward-note"
        rows={6}
        textareaClassName="min-h-[140px] w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      />
    </>
  )
}

function EmailDeliverySection({ compose }: ComposeProps) {
  if (compose.variant === 'reply' || compose.variant === 'forward') {
    return null
  }

  if (compose.isComposePublicVisibility) {
    return (
      <div className="rounded border px-3 py-2">
        <p className="text-sm font-medium">{compose.t('messages.sendViaEmail', 'Also send via email')}</p>
        <p className="text-xs text-muted-foreground">{compose.t('messages.sendViaEmailForcedPublic', 'For public visibility, email delivery is always enabled.')}</p>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between rounded border px-3 py-2">
      <div>
        <p className="text-sm font-medium">{compose.t('messages.sendViaEmail', 'Also send via email')}</p>
        <p className="text-xs text-muted-foreground">{compose.t('messages.sendViaEmailHint', 'Recipients will receive an email copy with a secure link.')}</p>
      </div>
      <Switch checked={compose.sendViaEmail} onCheckedChange={compose.setSendViaEmail} />
    </div>
  )
}

function ReplyForwardOptionsRow({ compose }: ComposeProps) {
  if (compose.variant !== 'reply' && compose.variant !== 'forward') {
    return null
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {compose.variant === 'forward' ? (
        <div className="flex items-center justify-between rounded border px-3 py-2">
          <div>
            <p className="text-sm font-medium">{compose.t('messages.includeAttachments', 'Include attachments')}</p>
            <p className="text-xs text-muted-foreground">{compose.t('messages.includeAttachmentsHint', 'Carry over attachments from the original message.')}</p>
          </div>
          <Switch checked={compose.includeAttachments} onCheckedChange={compose.setIncludeAttachments} />
        </div>
      ) : (
        <div className="flex items-center justify-between rounded border px-3 py-2">
          <div>
            <p className="text-sm font-medium">{compose.t('messages.replyAll', 'Reply all')}</p>
            <p className="text-xs text-muted-foreground">{compose.t('messages.replyAllHint', 'Include all original recipients.')}</p>
          </div>
          <Switch checked={compose.replyAll} onCheckedChange={compose.setReplyAll} />
        </div>
      )}
      <div className="flex items-center justify-between rounded border px-3 py-2">
        <div>
          <p className="text-sm font-medium">{compose.t('messages.sendViaEmail', 'Also send via email')}</p>
          <p className="text-xs text-muted-foreground">{compose.t('messages.sendViaEmailHint', 'Recipients will receive an email copy with a secure link.')}</p>
        </div>
        <Switch checked={compose.sendViaEmail} onCheckedChange={compose.setSendViaEmail} />
      </div>
    </div>
  )
}

function MessageComposeFormBody({ compose }: ComposeProps) {
  return (
    <div className="space-y-4" onKeyDown={compose.handleKeyDown}>
      {compose.variant === 'compose' ? <ComposeModeFields compose={compose} /> : null}
      {compose.variant === 'reply' ? <ReplyModeFields compose={compose} /> : null}
      {compose.variant === 'forward' ? <ForwardModeFields compose={compose} /> : null}
      <ReplyForwardOptionsRow compose={compose} />
      <EmailDeliverySection compose={compose} />
      {compose.submitError ? <p className="text-sm text-destructive">{compose.submitError}</p> : null}
    </div>
  )
}

export function createMessageComposeFormGroups(compose: UseMessageComposeResult): CrudField[] {
  return [{
    id: 'composer',
    label: '',
    type: 'custom',
    component: () => <MessageComposeFormBody compose={compose} />,
  }]
}
