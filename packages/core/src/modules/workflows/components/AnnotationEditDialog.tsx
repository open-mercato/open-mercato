'use client'

import * as React from 'react'
import type { Node } from '@xyflow/react'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@open-mercato/ui/primitives/drawer'
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
 * through the step inspector: this panel edits the two fields an annotation
 * actually has and nothing else.
 *
 * It is a Drawer, not a modal, for the same reason the step and route
 * inspectors are rails: an annotation is written ABOUT a region of the canvas,
 * so covering that region while it is edited hides the thing being described.
 * Keyboard contract unchanged — Cmd/Ctrl+Enter saves, Escape cancels.
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
    <Drawer open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
      <DrawerContent
        data-testid="workflow-annotation-drawer"
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            handleSave()
          }
        }}
        closeAriaLabel={t('workflows.annotations.close', 'Close annotation editor')}
      >
        <DrawerHeader>
          <DrawerTitle>
            {isNote
              ? t('workflows.annotations.note.dialogTitle', 'Edit note')
              : t('workflows.annotations.group.dialogTitle', 'Edit group')}
          </DrawerTitle>
          <DrawerDescription>
            {isNote
              ? t('workflows.annotations.note.dialogDescription', 'Notes document the workflow for the people editing it. They are never executed.')
              : t('workflows.annotations.group.dialogDescription', 'Groups label a region of the canvas. Collapsing one changes nothing the engine runs.')}
          </DrawerDescription>
        </DrawerHeader>

        <DrawerBody className="space-y-3 py-2">
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
        </DrawerBody>

        <DrawerFooter leading={(
          <Button type="button" variant="destructive-outline" onClick={handleDelete}>
            {t('common.delete', 'Delete')}
          </Button>
        )}>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={handleSave}>
            {t('workflows.common.save', 'Save')}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
