"use client"

import * as React from 'react'
import { Search } from 'lucide-react'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Radio, RadioGroup } from '@open-mercato/ui/primitives/radio'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { TemplatePreview } from './TemplatePreview'
import { TemplateSlotFields } from './TemplateSlotFields'
import { useTemplateInstantiation, type PresetTemplateContext } from './useTemplateInstantiation'

type NewFromTemplateDialogProps = {
  open: boolean
  folderId?: string | null
  presetContext?: PresetTemplateContext
  onOpenChange: (open: boolean) => void
}

export function NewFromTemplateDialog(props: NewFromTemplateDialogProps) {
  const t = useT()
  const titleInputId = React.useId()
  const templateSearchId = React.useId()
  const flow = useTemplateInstantiation(props)
  const canCreate = Boolean(
    flow.selectedTemplate && flow.preview && !flow.missingRequired &&
    flow.preview.unresolvedTokens.length === 0 && !flow.isSubmitting,
  )

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent size="xl" onKeyDown={(event) => {
        if (event.key === 'Escape') props.onOpenChange(false)
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && canCreate) {
          event.preventDefault()
          void flow.submit()
        }
      }}>
        <DialogHeader>
          <DialogTitle>{t('documents.templates.instantiate.title')}</DialogTitle>
          <DialogDescription>{t('documents.templates.instantiate.description')}</DialogDescription>
        </DialogHeader>
        {flow.isLoading ? <LoadingMessage label={t('documents.templates.instantiate.loading')} /> : null}
        {flow.loadError ? (
          <ErrorMessage
            label={flow.loadError}
            action={<Button type="button" size="sm" variant="outline" onClick={flow.retryTemplates}>{t('documents.actions.retry')}</Button>}
          />
        ) : null}
        {!flow.isLoading && !flow.loadError ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor={templateSearchId}>{t('documents.templates.search.label')}</Label>
                <Input id={templateSearchId} value={flow.templateSearch} onChange={(event) => flow.setTemplateSearch(event.target.value)} leftIcon={<Search />} placeholder={t('documents.templates.list.searchPlaceholder')} />
              </div>
              <RadioGroup
                className="max-h-48 overflow-y-auto"
                value={flow.selectedTemplateId ?? ''}
                onValueChange={flow.setSelectedTemplateId}
                aria-label={t('documents.templates.instantiate.template')}
                orientation="vertical"
              >
                {flow.templates.length === 0 ? (
                  <p className="rounded-md border border-border bg-muted/20 p-3 text-sm text-muted-foreground">{t('documents.templates.instantiate.empty')}</p>
                ) : null}
                {flow.templates.map((template) => {
                  const compatible = props.presetContext
                    ? template.contextSlots.some((slot) => slot.entityType === props.presetContext?.entityType)
                    : false
                  const optionId = `${templateSearchId}-${template.id}`
                  return (
                    <Label
                      key={template.id}
                      htmlFor={optionId}
                      className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-md border p-3 text-left font-normal transition-colors ${template.id === flow.selectedTemplateId ? 'border-accent-indigo bg-accent-indigo/5' : 'border-border bg-background hover:bg-muted/50'}`}
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <Radio id={optionId} value={template.id} />
                        <span className="min-w-0"><span className="block truncate font-medium">{template.name}</span>{template.description ? <span className="block truncate text-xs text-muted-foreground">{template.description}</span> : null}</span>
                      </span>
                      {compatible ? <Tag variant="info">{t('documents.templates.compatible')}</Tag> : null}
                    </Label>
                  )
                })}
              </RadioGroup>
              {flow.selectedTemplate ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor={titleInputId}>{t('documents.templates.instantiate.documentTitle')}</Label>
                    <Input id={titleInputId} value={flow.title} onChange={(event) => flow.setTitle(event.target.value)} placeholder={t('documents.templates.instantiate.documentTitlePlaceholder')} />
                  </div>
                  <TemplateSlotFields
                    slots={flow.selectedTemplate.contextSlots}
                    selections={flow.selections}
                    onSelectionChange={(slot, selection) => flow.setSelections((current) => ({ ...current, [slot]: selection }))}
                  />
                </>
              ) : null}
            </div>
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">{t('documents.templates.preview.title')}</h3>
              {flow.previewError ? (
                <Alert status="error">
                  <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                    <span>{flow.previewError}</span>
                    <Button type="button" size="sm" variant="outline" onClick={flow.retryPreview}>{t('documents.actions.retry')}</Button>
                  </AlertDescription>
                </Alert>
              ) : null}
              <TemplatePreview preview={flow.preview} isLoading={flow.isPreviewLoading} />
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)} disabled={flow.isSubmitting}>{t('documents.actions.cancel')}</Button>
          <Button type="button" onClick={() => void flow.submit()} disabled={!canCreate}>{t('documents.templates.instantiate.actions.create')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default NewFromTemplateDialog
