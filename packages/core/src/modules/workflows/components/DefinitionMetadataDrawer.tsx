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
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Switch } from '@open-mercato/ui/primitives/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { TagsInput } from '@open-mercato/ui/backend/inputs/TagsInput'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { Lock } from 'lucide-react'
import { ContextSchemaEditor } from './ContextSchemaEditor'
import { DefinitionErrorHandlerField } from './DefinitionErrorHandlerField'
import { DefinitionTriggersEditor } from './DefinitionTriggersEditor'
import { WorkflowIconPicker } from './WorkflowIconPicker'
import type { WorkflowMetadataHandlers, WorkflowMetadataState } from '../data/types'
import type { WorkflowInterpolationMode } from '../lib/interpolation-pipeline'

/**
 * The drawer's five sections, addressable so another surface can open it AT one
 * of them. The canvas trigger pill (fidelity gap #5) is the first caller: a node
 * that says "here is how this workflow starts" has to lead to the place that
 * edits it, and dropping the author at the top of a twelve-field form to hunt
 * for it would be half-wiring the affordance.
 */
export type DefinitionMetadataSection =
  | 'identity'
  | 'presentation'
  | 'availability'
  | 'inputs'
  | 'runtime'

export type DefinitionMetadataDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Scroll to and focus this section when the drawer opens. Focus, not just a
   * scroll: the keyboard path has to land there too, so the section heading is
   * programmatically focusable and takes focus, which also makes a screen reader
   * announce where it just arrived.
   */
  focusSection?: DefinitionMetadataSection | null
  /** Null while creating — drives the "fixed after create" locks on id + version. */
  definitionId: string | null
  /** Code-defined workflows are read-only; mirrors the editor's `isCodeOnly`. */
  readOnly?: boolean
  metadata: WorkflowMetadataState
  handlers: WorkflowMetadataHandlers
  /** Steps the definition-level error handler may jump to. */
  errorHandlerStepOptions: Array<{ stepId: string; label: string }>
  /** Primary action — bound to Cmd/Ctrl+Enter, per the project-wide dialog rule. */
  onSave?: () => void
  isSaving?: boolean
}

type SectionProps = {
  id: DefinitionMetadataSection
  title: string
  hint: string
  focused?: boolean
  children: React.ReactNode
}

/**
 * One coherent group of definition metadata. Sections rather than tabs: the
 * required identity fields have to stay visible while the author fills the rest
 * in top-to-bottom before the first save, and tabs would hide "Workflow ID is
 * empty" behind a navigation step, split the Tab order, and break Ctrl+F.
 */
function MetadataSection({ id, title, hint, focused = false, children }: SectionProps) {
  const sectionRef = React.useRef<HTMLElement | null>(null)

  React.useEffect(() => {
    if (!focused) return
    const element = sectionRef.current
    if (!element) return
    // One frame later: the drawer animates in, and scrolling a panel that has
    // not settled lands somewhere else.
    const frame = requestAnimationFrame(() => {
      element.scrollIntoView({ block: 'start' })
      element.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [focused])

  return (
    <section
      ref={sectionRef}
      id={`workflow-metadata-section-${id}`}
      data-metadata-section={id}
      tabIndex={-1}
      aria-labelledby={`workflow-metadata-section-${id}-title`}
      className="border-b border-border py-5 outline-none first:pt-2 last:border-b-0 last:pb-2"
    >
      <div className="mb-4">
        <h3 id={`workflow-metadata-section-${id}-title`} className="text-sm font-semibold text-foreground">
          {title}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </div>
      {children}
    </section>
  )
}

type FieldProps = {
  htmlFor?: string
  label: string
  required?: boolean
  hint?: string
  className?: string
  children: React.ReactNode
}

/** Uniform label → control → hint rhythm, so no two fields sit at different heights. */
function MetadataField({ htmlFor, label, required, hint, className, children }: FieldProps) {
  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      <Label htmlFor={htmlFor} className="text-xs">
        {label}
        {required ? ' *' : ''}
      </Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

/**
 * Definition metadata for the Studio, in a wide right-side Drawer.
 *
 * It used to render inline above the canvas inside a `max-h-[45svh]` band
 * (`60svh` on compact viewports), so on the page whose entire purpose is the
 * canvas the form was designed to eat up to half the viewport and everything
 * past the second row of fields was reachable only by scrolling inside the
 * band. A Drawer costs the canvas nothing and can take the width these fields
 * actually need.
 */
export function DefinitionMetadataDrawer({
  open,
  onOpenChange,
  focusSection = null,
  definitionId,
  readOnly = false,
  metadata,
  handlers,
  errorHandlerStepOptions,
  onSave,
  isSaving = false,
}: DefinitionMetadataDrawerProps) {
  const t = useT()

  const {
    workflowId, workflowName, description, version,
    enabled, category, tags, icon,
    effectiveFrom, effectiveTo, triggers,
    contextSchema, interpolation, errorHandler,
  } = metadata

  const {
    setWorkflowId, setWorkflowName, setDescription, setVersion,
    setEnabled, setCategory, setTags, setIcon,
    setEffectiveFrom, setEffectiveTo, setTriggers,
    setContextSchema, setInterpolation, setErrorHandler,
  } = handlers

  const isExisting = !!definitionId
  const lockedHint = isExisting ? t('workflows.visualEditor.metadata.lockedAfterCreate') : undefined

  const contentRef = React.useRef<HTMLDivElement | null>(null)

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== 'Enter') return
      if (!onSave || readOnly || isSaving) return
      // Radix portals a nested dialog (the trigger editor) outside this DOM
      // subtree but INSIDE the React tree, so its keystrokes bubble here.
      // Saving the workflow from a half-filled trigger form would be exactly
      // the wrong thing, so only keystrokes that really happened in the drawer
      // count.
      const target = event.target
      if (!(target instanceof Node) || !contentRef.current?.contains(target)) return
      event.preventDefault()
      onSave()
    },
    [onSave, readOnly, isSaving],
  )

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        ref={contentRef}
        // The maintainer sanctioned the width explicitly: these are twelve
        // fields plus three sub-editors, and the DS default 400px panel would
        // reproduce the cramped three-column grid this replaces.
        className="w-full max-w-none sm:w-4/5"
        onKeyDown={handleKeyDown}
        closeAriaLabel={t('workflows.visualEditor.metadata.close')}
      >
        <DrawerHeader>
          <DrawerTitle>{t('workflows.visualEditor.metadata.title')}</DrawerTitle>
          <DrawerDescription>{t('workflows.visualEditor.metadata.description')}</DrawerDescription>
        </DrawerHeader>

        <DrawerBody>
          <fieldset disabled={readOnly} className="disabled:opacity-70">
            <MetadataSection
              id="identity"
              focused={focusSection === 'identity'}
              title={t('workflows.visualEditor.metadata.sections.identity')}
              hint={t('workflows.visualEditor.metadata.sections.identityHint')}
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <MetadataField
                  htmlFor="workflowId"
                  label={t('workflows.form.workflowId')}
                  required
                  hint={lockedHint}
                >
                  <Input
                    id="workflowId"
                    value={workflowId}
                    onChange={(event) => setWorkflowId(event.target.value)}
                    placeholder={t('workflows.form.placeholders.workflowId')}
                    disabled={isExisting}
                  />
                </MetadataField>

                <MetadataField
                  htmlFor="version"
                  label={t('workflows.form.version')}
                  required
                  hint={lockedHint}
                >
                  <Input
                    id="version"
                    type="number"
                    value={version}
                    onChange={(event) => setVersion(parseInt(event.target.value, 10) || 1)}
                    min={1}
                    disabled={isExisting}
                  />
                </MetadataField>

                <MetadataField
                  htmlFor="workflowName"
                  label={t('workflows.form.workflowName')}
                  required
                  className="sm:col-span-2"
                >
                  <Input
                    id="workflowName"
                    value={workflowName}
                    onChange={(event) => setWorkflowName(event.target.value)}
                    placeholder={t('workflows.form.placeholders.workflowName')}
                  />
                </MetadataField>

                <MetadataField
                  htmlFor="description"
                  label={t('workflows.form.description')}
                  className="sm:col-span-2"
                >
                  <Textarea
                    id="description"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder={t('workflows.form.placeholders.description')}
                    autoResize
                    maxRows={12}
                    rows={3}
                  />
                </MetadataField>
              </div>
            </MetadataSection>

            <MetadataSection
              id="presentation"
              focused={focusSection === 'presentation'}
              title={t('workflows.visualEditor.metadata.sections.presentation')}
              hint={t('workflows.visualEditor.metadata.sections.presentationHint')}
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <MetadataField htmlFor="icon" label={t('workflows.form.icon')}>
                  <WorkflowIconPicker id="icon" value={icon} onChange={setIcon} disabled={readOnly} />
                </MetadataField>

                <MetadataField htmlFor="category" label={t('workflows.form.category')}>
                  <Input
                    id="category"
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                    placeholder={t('workflows.form.placeholders.category')}
                  />
                </MetadataField>

                <MetadataField label={t('workflows.form.tags')} className="sm:col-span-2">
                  <TagsInput
                    value={tags}
                    onChange={setTags}
                    placeholder={t('workflows.form.placeholders.tags')}
                  />
                </MetadataField>
              </div>
            </MetadataSection>

            <MetadataSection
              id="availability"
              focused={focusSection === 'availability'}
              title={t('workflows.visualEditor.metadata.sections.availability')}
              hint={t('workflows.visualEditor.metadata.sections.availabilityHint')}
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <MetadataField label={t('common.enabled', 'Enabled')}>
                  <div className="flex h-9 items-center gap-2">
                    <Switch id="enabled" checked={enabled} onCheckedChange={setEnabled} />
                    <Label htmlFor="enabled" className="cursor-pointer text-xs font-normal">
                      {enabled ? t('common.on', 'On') : t('common.off', 'Off')}
                    </Label>
                  </div>
                </MetadataField>

                <MetadataField htmlFor="effectiveFrom" label={t('workflows.form.effectiveFrom')}>
                  <Input
                    id="effectiveFrom"
                    type="date"
                    value={effectiveFrom}
                    onChange={(event) => setEffectiveFrom(event.target.value)}
                  />
                </MetadataField>

                <MetadataField htmlFor="effectiveTo" label={t('workflows.form.effectiveTo')}>
                  <Input
                    id="effectiveTo"
                    type="date"
                    value={effectiveTo}
                    onChange={(event) => setEffectiveTo(event.target.value)}
                  />
                </MetadataField>
              </div>
            </MetadataSection>

            <MetadataSection
              id="inputs"
              focused={focusSection === 'inputs'}
              title={t('workflows.visualEditor.metadata.sections.inputs')}
              hint={t('workflows.visualEditor.metadata.sections.inputsHint')}
            >
              <div className="space-y-4">
                {setContextSchema ? (
                  <ContextSchemaEditor value={contextSchema} onChange={setContextSchema} />
                ) : null}
                <DefinitionTriggersEditor value={triggers} onChange={setTriggers} />
              </div>
            </MetadataSection>

            {setInterpolation || setErrorHandler ? (
              <MetadataSection
                id="runtime"
                focused={focusSection === 'runtime'}
                title={t('workflows.visualEditor.metadata.sections.runtime')}
                hint={t('workflows.visualEditor.metadata.sections.runtimeHint')}
              >
                <div className="space-y-5">
                  {setInterpolation ? (
                    <MetadataField
                      htmlFor="interpolation-mode"
                      label={t('workflows.visualEditor.interpolation.label', 'Missing variables')}
                      hint={t(
                        'workflows.visualEditor.interpolation.help',
                        'Controls what happens when a variable placeholder cannot be resolved at run time: strict fails the step so problems surface immediately; lenient keeps the unresolved text unchanged. New workflows start strict.',
                      )}
                    >
                      <Select
                        value={interpolation ?? 'lenient'}
                        onValueChange={(mode) => setInterpolation(mode as WorkflowInterpolationMode)}
                      >
                        <SelectTrigger
                          id="interpolation-mode"
                          aria-label={t('workflows.visualEditor.interpolation.label', 'Missing variables')}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="strict">
                            {t('workflows.visualEditor.interpolation.strict', 'Strict — fail the step')}
                          </SelectItem>
                          <SelectItem value="lenient">
                            {t('workflows.visualEditor.interpolation.lenient', 'Lenient — keep the text as written')}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </MetadataField>
                  ) : null}

                  {setErrorHandler ? (
                    <DefinitionErrorHandlerField
                      value={errorHandler ?? null}
                      onChange={(next) => setErrorHandler(next ?? undefined)}
                      stepOptions={errorHandlerStepOptions}
                    />
                  ) : null}
                </div>
              </MetadataSection>
            ) : null}
          </fieldset>
        </DrawerBody>

        <DrawerFooter
          leading={
            readOnly ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Lock className="size-3.5" aria-hidden="true" />
                {t('workflows.visualEditor.metadata.readOnlyNotice')}
              </span>
            ) : onSave ? (
              <span className="text-xs text-muted-foreground">
                {t('workflows.visualEditor.metadata.saveHint')}
              </span>
            ) : undefined
          }
        >
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('workflows.visualEditor.metadata.close')}
          </Button>
          {onSave && !readOnly ? (
            <Button type="button" onClick={onSave} disabled={isSaving}>
              {isSaving
                ? t('workflows.mobile.saving')
                : isExisting
                  ? t('workflows.common.update')
                  : t('workflows.common.save')}
            </Button>
          ) : null}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

export default DefinitionMetadataDrawer
