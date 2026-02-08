'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Label } from '@open-mercato/ui/primitives/label'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { TagsInput } from '@open-mercato/ui/backend/inputs/TagsInput'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DefinitionTriggersEditor } from '../DefinitionTriggersEditor'
import type { WorkflowDefinitionTrigger } from '../../data/entities'

export interface MobileMetadataSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  definitionId: string | null
  workflowId: string
  setWorkflowId: (v: string) => void
  workflowName: string
  setWorkflowName: (v: string) => void
  description: string
  setDescription: (v: string) => void
  version: number
  setVersion: (v: number) => void
  enabled: boolean
  setEnabled: (v: boolean) => void
  category: string
  setCategory: (v: string) => void
  tags: string[]
  setTags: (v: string[]) => void
  icon: string
  setIcon: (v: string) => void
  effectiveFrom: string
  setEffectiveFrom: (v: string) => void
  effectiveTo: string
  setEffectiveTo: (v: string) => void
  triggers: WorkflowDefinitionTrigger[]
  setTriggers: (v: WorkflowDefinitionTrigger[]) => void
}

export function MobileMetadataSheet({
  open,
  onOpenChange,
  definitionId,
  workflowId,
  setWorkflowId,
  workflowName,
  setWorkflowName,
  description,
  setDescription,
  version,
  setVersion,
  enabled,
  setEnabled,
  category,
  setCategory,
  tags,
  setTags,
  icon,
  setIcon,
  effectiveFrom,
  setEffectiveFrom,
  effectiveTo,
  setEffectiveTo,
  triggers,
  setTriggers,
}: MobileMetadataSheetProps) {
  const t = useT()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('workflows.mobile.metadata', 'Metadata')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="m-workflowId" className="text-xs">{t('workflows.form.workflowId')} *</Label>
            <Input
              id="m-workflowId"
              value={workflowId}
              onChange={(e) => setWorkflowId(e.target.value)}
              placeholder={t('workflows.form.placeholders.workflowId')}
              disabled={!!definitionId}
              className="h-11 text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="m-workflowName" className="text-xs">{t('workflows.form.workflowName')} *</Label>
            <Input
              id="m-workflowName"
              value={workflowName}
              onChange={(e) => setWorkflowName(e.target.value)}
              placeholder={t('workflows.form.placeholders.workflowName')}
              className="h-11 text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="m-description" className="text-xs">{t('workflows.form.description')}</Label>
            <Textarea
              id="m-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('workflows.form.placeholders.description')}
              rows={2}
              className="min-h-[60px] text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="m-category" className="text-xs">{t('workflows.form.category')}</Label>
            <Input
              id="m-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder={t('workflows.form.placeholders.category')}
              className="h-11 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="m-version" className="text-xs">{t('workflows.form.version')} *</Label>
              <Input
                id="m-version"
                type="number"
                value={version}
                onChange={(e) => setVersion(parseInt(e.target.value) || 1)}
                min={1}
                disabled={!!definitionId}
                className="h-11 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">{t('workflows.form.enabled')}</Label>
              <div className="flex h-11 items-center gap-2">
                <Switch
                  id="m-enabled"
                  checked={enabled}
                  onCheckedChange={setEnabled}
                />
                <Label htmlFor="m-enabled" className="cursor-pointer text-xs font-normal">
                  {enabled ? t('common.on') : t('common.off')}
                </Label>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">{t('workflows.form.tags')}</Label>
            <TagsInput
              value={tags}
              onChange={setTags}
              placeholder={t('workflows.form.placeholders.tags')}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="m-icon" className="text-xs">{t('workflows.form.icon')}</Label>
            <Input
              id="m-icon"
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              placeholder={t('workflows.form.placeholders.icon')}
              className="h-11 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="m-effectiveFrom" className="text-xs">{t('workflows.form.effectiveFrom')}</Label>
              <Input
                id="m-effectiveFrom"
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                className="h-11 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="m-effectiveTo" className="text-xs">{t('workflows.form.effectiveTo')}</Label>
              <Input
                id="m-effectiveTo"
                type="date"
                value={effectiveTo}
                onChange={(e) => setEffectiveTo(e.target.value)}
                className="h-11 text-sm"
              />
            </div>
          </div>

          <DefinitionTriggersEditor
            value={triggers}
            onChange={setTriggers}
          />

          <Button
            className="w-full h-11"
            onClick={() => onOpenChange(false)}
          >
            {t('common.done')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
