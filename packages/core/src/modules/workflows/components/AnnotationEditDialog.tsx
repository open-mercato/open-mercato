'use client'

import * as React from 'react'
import type { Node } from '@xyflow/react'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  ANNOTATION_GROUP_NODE_TYPE,
  ANNOTATION_NOTE_NODE_TYPE,
  type WorkflowGroupNodeData,
  type WorkflowNoteNodeData,
} from '../lib/editor-annotations'

export interface AnnotationEditDialogProps {
  node: Node | null
  isOpen: boolean
  onClose: () => void
  onSave: (nodeId: string, updates: Partial<WorkflowNoteNodeData & WorkflowGroupNodeData>) => void
  onDelete: (nodeId: string) => void
}

/**
 * Inspector for a sticky note or a named group (spec section 4.5).
 *
 * Notes and groups carry no step configuration, so they deliberately do not go
 * through the step inspector: this dialog edits the two fields an annotation
 * actually has and nothing else.
 */
export function AnnotationEditDialog({ node, isOpen, onClose, onSave, onDelete }: AnnotationEditDialogProps) {
  const t = useT()
  const isNote = node?.type === ANNOTATION_NOTE_NODE_TYPE
  const isGroup = node?.type === ANNOTATION_GROUP_NODE_TYPE
  const [markdown, setMarkdown] = React.useState('')
  const [name, setName] = React.useState('')
  const [collapsed, setCollapsed] = React.useState(false)

  React.useEffect(() => {
    if (!node) return
    const data = node.data as Partial<WorkflowNoteNodeData & WorkflowGroupNodeData> | undefined
    setMarkdown(typeof data?.markdown === 'string' ? data.markdown : '')
    setName(typeof data?.name === 'string' ? data.name : '')
    setCollapsed(data?.collapsed === true)
  }, [node])

  const handleSave = React.useCallback(() => {
    if (!node) return
    onSave(node.id, isNote ? { markdown } : { name, collapsed })
    onClose()
  }, [node, onSave, onClose, isNote, markdown, name, collapsed])

  const handleDelete = React.useCallback(() => {
    if (!node) return
    onClose()
    onDelete(node.id)
  }, [node, onClose, onDelete])

  if (!node || (!isNote && !isGroup)) return null

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent
        className="sm:max-w-lg"
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            handleSave()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {isNote
              ? t('workflows.annotations.note.dialogTitle', 'Edit note')
              : t('workflows.annotations.group.dialogTitle', 'Edit group')}
          </DialogTitle>
          <DialogDescription>
            {isNote
              ? t('workflows.annotations.note.dialogDescription', 'Notes document the workflow for the people editing it. They are never executed.')
              : t('workflows.annotations.group.dialogDescription', 'Groups label a region of the canvas. Collapsing one changes nothing the engine runs.')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 px-1 py-2">
          {isNote ? (
            <div className="space-y-1">
              <Label htmlFor="annotation-markdown" className="text-xs">
                {t('workflows.annotations.note.markdownLabel', 'Markdown')}
              </Label>
              <Textarea
                id="annotation-markdown"
                value={markdown}
                onChange={(event) => setMarkdown(event.target.value)}
                rows={8}
                spellCheck={false}
                className="font-mono text-sm"
                placeholder={t('workflows.annotations.note.markdownPlaceholder', '## Why this branch exists')}
              />
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <Label htmlFor="annotation-name" className="text-xs">
                  {t('workflows.annotations.group.nameLabel', 'Group name')}
                </Label>
                <Input
                  id="annotation-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t('workflows.annotations.group.namePlaceholder', 'Fulfillment')}
                  className="h-8 text-sm"
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch id="annotation-collapsed" checked={collapsed} onCheckedChange={setCollapsed} />
                <Label htmlFor="annotation-collapsed" className="cursor-pointer text-xs font-normal">
                  {t('workflows.annotations.group.collapsedLabel', 'Collapsed (visual only)')}
                </Label>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="destructive-outline" onClick={handleDelete}>
            {t('common.delete', 'Delete')}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={handleSave}>
            {t('workflows.common.save', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
