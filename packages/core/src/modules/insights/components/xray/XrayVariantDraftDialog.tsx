"use client"

import * as React from 'react'
import Link from 'next/link'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Input } from '@open-mercato/ui/primitives/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import {
  isAbortError,
  workflowDefinitionPagePath,
  xrayVariantDraftApiPath,
  type XrayRequestError,
} from '../../lib/client/xray/api'
import { summarizeDraftPayload } from '../../lib/client/xray/draft'
import { formatActivitySequence, type XrayActivityLabelMap } from '../../lib/client/xray/format'
import type { XrayVariantItem, XrayWorkflowDraftResponse } from '../../lib/client/xray/types'
import { windowQueryParams, type XrayWindowState } from '../../lib/client/xray/window'
import { XrayDraftSummary } from './XrayDraftSummary'
import { XrayErrorNotice } from './XrayErrorNotice'
import { describeCreateError } from './XraySuggestionReviewDialog'
import { XrayWorkflowIdField } from './XrayWorkflowIdField'
import {
  loadWorkflowCommandOptions,
  useXrayMutations,
  xrayRequest,
  type XrayPermissions,
  type XrayWorkflowCommandOption,
} from '../../lib/client/xray/hooks'

export const XRAY_VARIANT_DRAFT_CONTEXT_ID = 'insights-xray:variant-draft'

const COMMAND_ID_PATTERN = /^[a-z0-9_.:-]{1,200}$/i

export type XrayVariantDraftDialogProps = {
  processKey: string
  variant: XrayVariantItem | null
  /** Server-resolved labels of the variants response (`activityLabels`). */
  activityLabels?: XrayActivityLabelMap
  window: XrayWindowState
  permissions: XrayPermissions
  onClose: () => void
}

/**
 * Turns an observed path into a disabled draft workflow: the user picks the workflow-safe
 * command that updates the case (`POST …/variants/{hash}/workflow-draft` validates the draft and
 * stores nothing), reviews it and, after a confirmation, creates it as themselves through
 * `POST /api/workflows/definitions`. Cmd/Ctrl+Enter runs the current step, Escape cancels.
 */
export function XrayVariantDraftDialog({ processKey, variant, activityLabels, window, permissions, onClose }: XrayVariantDraftDialogProps) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { createWorkflowDefinition } = useXrayMutations(XRAY_VARIANT_DRAFT_CONTEXT_ID)
  const [commands, setCommands] = React.useState<XrayWorkflowCommandOption[] | null>(null)
  const [commandId, setCommandId] = React.useState('')
  const [workflowName, setWorkflowName] = React.useState('')
  const [workflowId, setWorkflowId] = React.useState<string | null>(null)
  const [preview, setPreview] = React.useState<XrayWorkflowDraftResponse | null>(null)
  const [previewError, setPreviewError] = React.useState<XrayRequestError | null>(null)
  const [previewing, setPreviewing] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [createdId, setCreatedId] = React.useState<string | null>(null)
  const open = variant !== null
  const previewAbortRef = React.useRef<AbortController | null>(null)

  React.useEffect(() => {
    previewAbortRef.current?.abort()
    previewAbortRef.current = null
    setCommandId('')
    setWorkflowName('')
    setWorkflowId(null)
    setPreview(null)
    setPreviewError(null)
    setPreviewing(false)
    setCreatedId(null)
    setBusy(false)
  }, [variant?.variantHash])

  React.useEffect(() => {
    if (!open || permissions.loading) return
    if (!permissions.canEditWorkflows) {
      setCommands([])
      return
    }
    const controller = new AbortController()
    loadWorkflowCommandOptions(controller.signal).then((options) => {
      if (!controller.signal.aborted) setCommands(options)
    })
    return () => controller.abort()
  }, [open, permissions.canEditWorkflows, permissions.loading])

  React.useEffect(() => () => previewAbortRef.current?.abort(), [])

  const requestPreview = React.useCallback(async (overrideWorkflowId?: string | null) => {
    if (!variant || !COMMAND_ID_PATTERN.test(commandId)) return
    const windowParams = windowQueryParams(window)
    if (!windowParams) return
    previewAbortRef.current?.abort()
    const controller = new AbortController()
    previewAbortRef.current = controller
    const nextWorkflowId = overrideWorkflowId === undefined ? workflowId : overrideWorkflowId
    const body: Record<string, unknown> = { ...windowParams, commandId }
    const trimmedName = workflowName.trim()
    if (trimmedName) body.workflowName = trimmedName
    if (nextWorkflowId) body.workflowId = nextWorkflowId
    setPreviewing(true)
    setPreviewError(null)
    try {
      const result = await xrayRequest<XrayWorkflowDraftResponse>(xrayVariantDraftApiPath(processKey, variant.variantHash), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      if (result.ok) {
        setPreview(result.body)
        setWorkflowId(nextWorkflowId)
      } else {
        setPreview(null)
        setPreviewError(result.error)
      }
    } catch (error) {
      if (!isAbortError(error)) setPreviewError({ httpStatus: null, code: null, hint: null, message: null })
    } finally {
      if (!controller.signal.aborted) setPreviewing(false)
    }
  }, [commandId, processKey, variant, window, workflowId, workflowName])

  const summary = preview ? summarizeDraftPayload(preview.payload) : null

  const handleCreate = React.useCallback(async () => {
    if (!preview || !summary || busy) return
    setBusy(true)
    try {
      const confirmed = await confirm({
        title: t('insights.xray.ui.draft.confirmTitle'),
        text: t('insights.xray.ui.draft.confirmText', { name: summary.workflowName }),
        confirmText: t('insights.xray.ui.draft.create'),
      })
      if (!confirmed) return
      try {
        const definitionId = await createWorkflowDefinition(preview.payload)
        if (!definitionId) {
          flash(t('insights.xray.ui.draft.createFailed'), 'error')
          return
        }
        setCreatedId(definitionId)
        flash(t('insights.xray.ui.draft.createdNotMarked'), 'success')
      } catch (error) {
        if (!surfaceRecordConflict(error, t)) flash(describeCreateError(error, t), 'error')
      }
    } finally {
      setBusy(false)
    }
  }, [busy, confirm, createWorkflowDefinition, preview, summary, t])

  const canPreview = Boolean(variant && COMMAND_ID_PATTERN.test(commandId) && !previewing && !busy && !createdId)
  const canCreate = Boolean(summary && preview?.workflowIdAvailable !== false && permissions.canCreateWorkflows && !busy && !previewing && !createdId)
  const primary = summary ? handleCreate : () => requestPreview()
  const handleKeyDown = useDialogKeyHandler({ onConfirm: () => { void primary() }, disabled: summary ? !canCreate : !canPreview })
  const commandSelectable = commands !== null && commands.length > 0

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onClose() }}>
      <DialogContent size="lg" onKeyDown={handleKeyDown} data-testid="xray-variant-draft-dialog">
        {ConfirmDialogElement}
        <DialogHeader>
          <DialogTitle>{t('insights.xray.ui.variants.draftTitle')}</DialogTitle>
          <DialogDescription>{variant ? formatActivitySequence(variant.activityKeys, t, activityLabels) : null}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {commands === null ? <LoadingMessage label={t('insights.xray.ui.variants.loadingCommands')} /> : null}
          {commands !== null && !createdId ? (
            <div className="grid gap-3 md:grid-cols-2">
              <FormField
                label={t('insights.xray.ui.variants.command')}
                description={permissions.canEditWorkflows
                  ? t('insights.xray.ui.variants.commandHelp')
                  : <span data-testid="xray-commands-unavailable">{t('insights.xray.ui.variants.commandsUnavailable')}</span>}
                required
                disabled={previewing || busy}
              >
                {commandSelectable ? (
                  <Select value={commandId || undefined} onValueChange={(next) => { setCommandId(next); setPreview(null); setWorkflowId(null) }}>
                    <SelectTrigger aria-label={t('insights.xray.ui.variants.command')}>
                      <SelectValue placeholder={t('insights.xray.ui.variants.commandPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {commands.map((command) => (
                        <SelectItem key={command.commandId} value={command.commandId}>
                          {command.labelKey ? `${t(command.labelKey)} (${command.commandId})` : command.commandId}
                          {command.enabled === false ? ` — ${t('insights.xray.ui.variants.commandNotEnabled')}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input value={commandId} onChange={(event) => { setCommandId(event.target.value.trim()); setPreview(null); setWorkflowId(null) }} placeholder={t('insights.xray.ui.variants.commandExample')} />
                )}
              </FormField>
              <FormField label={t('insights.xray.ui.variants.workflowName')} description={t('insights.xray.ui.variants.workflowNameHelp')} disabled={previewing || busy}>
                <Input value={workflowName} maxLength={255} onChange={(event) => { setWorkflowName(event.target.value); setPreview(null) }} />
              </FormField>
            </div>
          ) : null}
          {previewing ? <LoadingMessage label={t('insights.xray.ui.draft.loading')} /> : null}
          {previewError ? <XrayErrorNotice error={previewError} /> : null}
          {summary && preview ? (
            <XrayDraftSummary
              summary={summary}
              commands={preview.commands}
              skippedActivities={preview.skippedActivities}
              activityLabels={{ ...activityLabels, ...preview.activityLabels }}
              workflowIdAvailable={preview.workflowIdAvailable}
            />
          ) : null}
          {summary && preview && !preview.workflowIdAvailable && !createdId ? (
            <XrayWorkflowIdField initialValue={`${summary.workflowId}-2`} disabled={busy || previewing} onApply={(next) => { void requestPreview(next) }} />
          ) : null}
          {!permissions.loading && !permissions.canCreateWorkflows ? (
            <p className="text-xs text-muted-foreground">{t('insights.xray.ui.draft.createNotAllowed')}</p>
          ) : null}
          {createdId ? (
            <Alert
              status="success"
              size="default"
              data-testid="xray-draft-created"
              footer={permissions.canViewWorkflows ? (
                <Button asChild size="sm" variant="outline">
                  <Link href={workflowDefinitionPagePath(createdId)}>{t('insights.xray.ui.draft.openDraft')}</Link>
                </Button>
              ) : undefined}
            >
              <AlertTitle>{t('insights.xray.ui.draft.createdTitle')}</AlertTitle>
              <AlertDescription>{t('insights.xray.ui.draft.createdDescription')}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {createdId ? t('insights.xray.ui.actions.close') : t('insights.xray.ui.actions.cancel')}
          </Button>
          {!createdId ? (
            summary ? (
              <Button type="button" onClick={() => { void handleCreate() }} disabled={!canCreate} data-testid="xray-draft-create">
                {t('insights.xray.ui.draft.create')}
              </Button>
            ) : (
              <Button type="button" onClick={() => { void requestPreview() }} disabled={!canPreview} data-testid="xray-draft-preview">
                {t('insights.xray.ui.variants.preview')}
              </Button>
            )
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
