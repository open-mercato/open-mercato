'use client'

import { useEffect, useState, type KeyboardEvent } from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
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
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { PortFieldArrayEditor } from './PortFieldArrayEditor'
import type { PortField, WorkflowIoContract } from '../../data/validators'

export interface SchemaBuilderDialogProps {
  open: boolean
  /** Current IO contract (child definition.io); undefined → start empty. */
  value?: WorkflowIoContract | null
  /** Name of the workflow whose schema is being edited (header context). */
  workflowName?: string
  disabled?: boolean
  onSave: (io: WorkflowIoContract) => void
  onClose: () => void
}

/**
 * SchemaBuilderDialog — "Schemat portów" editor for a sub-workflow's IO contract.
 *
 * Lets a business user declare the input (IN) and output (OUT) ports a
 * sub-workflow accepts/returns, each with one of the five simple types and a
 * `required` flag. Edits a draft copy and commits via `onSave`; changing or
 * removing a port can break existing mappings in callers, so a warning banner is
 * always shown (the affected-connection count arrives with breaking-change
 * detection in a later phase).
 *
 * A rail rather than a modal — two port lists plus a warning banner are a
 * secondary FORM, and the sub-workflow node whose contract is being declared
 * stays readable behind it. UX contract unchanged: `Cmd/Ctrl+Enter` submits,
 * `Escape` cancels.
 */
export function SchemaBuilderDialog({
  open,
  value,
  workflowName,
  disabled,
  onSave,
  onClose,
}: SchemaBuilderDialogProps) {
  const t = useT()
  const [inputs, setInputs] = useState<PortField[]>([])
  const [outputs, setOutputs] = useState<PortField[]>([])

  // Re-seed the draft whenever the dialog opens or the source contract changes.
  useEffect(() => {
    if (!open) return
    setInputs(Array.isArray(value?.inputs) ? value!.inputs : [])
    setOutputs(Array.isArray(value?.outputs) ? value!.outputs : [])
  }, [open, value])

  const handleSave = () => {
    if (disabled) return
    onSave({ inputs, outputs })
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      handleSave()
    }
  }

  return (
    <Drawer open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DrawerContent
        data-testid="workflow-schema-builder-drawer"
        onKeyDown={handleKeyDown}
        closeAriaLabel={t('workflows.ports.close')}
      >
        <DrawerHeader>
          <DrawerTitle>{t('workflows.ports.title')}</DrawerTitle>
          <DrawerDescription>
            {workflowName ? `${workflowName} — ${t('workflows.ports.description')}` : t('workflows.ports.description')}
          </DrawerDescription>
        </DrawerHeader>

        <DrawerBody className="space-y-5 py-2">
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
              {t('workflows.ports.inputs')}
            </h3>
            <PortFieldArrayEditor
              id="schema-builder-inputs"
              value={inputs}
              onChange={setInputs}
              disabled={disabled}
              addLabelKey="workflows.ports.addInput"
              emptyLabelKey="workflows.ports.emptyInputs"
            />
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <span className="size-2 rounded-full bg-secondary-foreground" aria-hidden="true" />
              {t('workflows.ports.outputs')}
            </h3>
            <PortFieldArrayEditor
              id="schema-builder-outputs"
              value={outputs}
              onChange={setOutputs}
              disabled={disabled}
              addLabelKey="workflows.ports.addOutput"
              emptyLabelKey="workflows.ports.emptyOutputs"
            />
          </section>

          <Alert status="warning" size="sm">
            <AlertDescription className="text-xs">
              {t('workflows.ports.breakingWarning')}
            </AlertDescription>
          </Alert>
        </DrawerBody>

        <DrawerFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('workflows.ports.cancel')}
          </Button>
          <Button type="button" onClick={handleSave} disabled={disabled}>
            {t('workflows.ports.save')}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
