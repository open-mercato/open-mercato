'use client'

import * as React from 'react'
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@open-mercato/ui/primitives/drawer'
import { Button } from '@open-mercato/ui/primitives/button'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type RerunStepDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  stepId: string | null
  stepLabel?: string | null
  isSubmitting?: boolean
  /** Resolves once the rerun has been requested; the host closes the dialog. */
  onConfirm: (contextPatch: Record<string, unknown> | undefined) => void
}

/**
 * Rerun-from-step confirmation (spec §8.4: "optionally with edited context").
 *
 * The patch is authored as JSON and MERGED over the run context — only the keys
 * present are changed, and the `STEP_RERUN` event records exactly which ones
 * moved. Parsing happens here so an unparseable patch never reaches the API as
 * a silently-dropped edit.
 */
export function RerunStepDialog({
  open,
  onOpenChange,
  stepId,
  stepLabel,
  isSubmitting = false,
  onConfirm,
}: RerunStepDialogProps) {
  const t = useT()
  const [patchText, setPatchText] = React.useState('')
  const [parseError, setParseError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) {
      setPatchText('')
      setParseError(null)
    }
  }, [open])

  const submit = React.useCallback(() => {
    const trimmed = patchText.trim()
    if (!trimmed) {
      setParseError(null)
      onConfirm(undefined)
      return
    }
    try {
      const parsed = JSON.parse(trimmed)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setParseError(
          t('workflows.rerunStep.patchNotAnObject', 'The context patch must be a JSON object.')
        )
        return
      }
      setParseError(null)
      onConfirm(parsed as Record<string, unknown>)
    } catch {
      setParseError(t('workflows.rerunStep.patchInvalid', 'The context patch is not valid JSON.'))
    }
  }, [patchText, onConfirm, t])

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        data-testid="workflow-rerun-step-drawer"
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            submit()
          }
        }}
        closeAriaLabel={t('workflows.rerunStep.close', 'Close rerun panel')}
      >
        <DrawerHeader>
          <DrawerTitle>{t('workflows.rerunStep.title', 'Rerun from this step')}</DrawerTitle>
          <DrawerDescription>
            {t(
              'workflows.rerunStep.description',
              'The run continues from {step}. The previous attempt is kept in the history, and the rerun is recorded in the audit log.',
              { step: stepLabel || stepId || '' }
            )}
          </DrawerDescription>
        </DrawerHeader>

        <DrawerBody className="space-y-2">
          <label className="text-sm font-medium text-foreground" htmlFor="workflow-rerun-context-patch">
            {t('workflows.rerunStep.patchLabel', 'Context patch (optional JSON)')}
          </label>
          <Textarea
            id="workflow-rerun-context-patch"
            value={patchText}
            onChange={(event) => setPatchText(event.target.value)}
            rows={6}
            className="font-mono text-xs"
            placeholder={'{\n  "amount": 250\n}'}
          />
          <p className="text-xs text-muted-foreground">
            {t(
              'workflows.rerunStep.patchHint',
              'Merged over the run context. Only the keys you provide change.'
            )}
          </p>
          {parseError ? <p className="text-xs text-status-error-text">{parseError}</p> : null}
        </DrawerBody>

        <DrawerFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={submit} disabled={isSubmitting || !stepId}>
            {t('workflows.rerunStep.confirm', 'Rerun step')}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

export default RerunStepDialog
