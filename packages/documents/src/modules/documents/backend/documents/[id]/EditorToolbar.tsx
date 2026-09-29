"use client"

import * as React from 'react'
import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Code2, Database, Heading1, Heading2,
  Heading3, ImagePlus, Italic, Link2, List, ListOrdered, ListTodo, Loader2, PanelLeft, Pilcrow,
  Redo2, Strikethrough, Table2, Underline, Undo2,
} from 'lucide-react'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { EditorColorTools } from './EditorColorTools'

type ToolbarAction = { key: string; label: string; icon: React.ReactNode; active?: boolean; disabled?: boolean; run: () => void }

const EMPTY_EDITOR_STATE = {
  canUndo: false,
  canRedo: false,
  paragraph: false,
  heading1: false,
  heading2: false,
  heading3: false,
  alignLeft: false,
  alignCenter: false,
  alignRight: false,
  alignJustify: false,
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  bulletList: false,
  orderedList: false,
  taskList: false,
  link: false,
  codeBlock: false,
}

function ToolbarButtons({ actions }: { actions: ToolbarAction[] }) {
  return <>{actions.map((action) => <IconButton className="shrink-0" key={action.key} type="button" variant={action.active ? 'outline' : 'ghost'} aria-label={action.label} aria-pressed={action.active ?? false} title={action.label} disabled={action.disabled} onClick={action.run}>{action.icon}</IconButton>)}</>
}

export function EditorToolbar({ editor, disabled, outlineOpen, uploading, onToggleOutline, onOpenEntityPicker, onOpenLink, onImage }: {
  editor: Editor | null
  disabled: boolean
  outlineOpen: boolean
  uploading: boolean
  onToggleOutline: () => void
  onOpenEntityPicker: () => void
  onOpenLink: () => void
  onImage: () => void
}) {
  const t = useT()
  const editorState = useEditorState({
    editor,
    selector: ({ editor: current }) => current ? {
      canUndo: current.can().undo(),
      canRedo: current.can().redo(),
      paragraph: current.isActive('paragraph'),
      heading1: current.isActive('heading', { level: 1 }),
      heading2: current.isActive('heading', { level: 2 }),
      heading3: current.isActive('heading', { level: 3 }),
      alignLeft: current.isActive({ textAlign: 'left' }),
      alignCenter: current.isActive({ textAlign: 'center' }),
      alignRight: current.isActive({ textAlign: 'right' }),
      alignJustify: current.isActive({ textAlign: 'justify' }),
      bold: current.isActive('bold'),
      italic: current.isActive('italic'),
      underline: current.isActive('underline'),
      strike: current.isActive('strike'),
      bulletList: current.isActive('bulletList'),
      orderedList: current.isActive('orderedList'),
      taskList: current.isActive('taskList'),
      link: current.isActive('link'),
      codeBlock: current.isActive('codeBlock'),
    } : EMPTY_EDITOR_STATE,
  }) ?? EMPTY_EDITOR_STATE
  const command = (run: (editor: Editor) => void) => () => { if (editor && !disabled) run(editor) }
  const actions: ToolbarAction[] = [
    { key: 'undo', label: t('documents.editor.toolbar.undo'), icon: <Undo2 />, disabled: disabled || !editorState.canUndo, run: command((current) => { current.chain().focus().undo().run() }) },
    { key: 'redo', label: t('documents.editor.toolbar.redo'), icon: <Redo2 />, disabled: disabled || !editorState.canRedo, run: command((current) => { current.chain().focus().redo().run() }) },
    { key: 'outline', label: t('documents.editor.toolbar.outline'), icon: <PanelLeft />, active: outlineOpen, disabled: !editor, run: onToggleOutline },
    { key: 'paragraph', label: t('documents.editor.toolbar.paragraph'), icon: <Pilcrow />, active: editorState.paragraph, disabled, run: command((current) => { current.chain().focus().setParagraph().run() }) },
    ...([1, 2, 3] as const).map((level) => ({ key: `h${level}`, label: t(`documents.editor.toolbar.heading${level}`), icon: level === 1 ? <Heading1 /> : level === 2 ? <Heading2 /> : <Heading3 />, active: editorState[`heading${level}`], disabled, run: command((current) => { current.chain().focus().toggleHeading({ level }).run() }) })),
    { key: 'left', label: t('documents.editor.toolbar.alignLeft'), icon: <AlignLeft />, active: editorState.alignLeft, disabled, run: command((current) => { current.chain().focus().setTextAlign('left').run() }) },
    { key: 'center', label: t('documents.editor.toolbar.alignCenter'), icon: <AlignCenter />, active: editorState.alignCenter, disabled, run: command((current) => { current.chain().focus().setTextAlign('center').run() }) },
    { key: 'right', label: t('documents.editor.toolbar.alignRight'), icon: <AlignRight />, active: editorState.alignRight, disabled, run: command((current) => { current.chain().focus().setTextAlign('right').run() }) },
    { key: 'justify', label: t('documents.editor.toolbar.alignJustify'), icon: <AlignJustify />, active: editorState.alignJustify, disabled, run: command((current) => { current.chain().focus().setTextAlign('justify').run() }) },
    { key: 'bold', label: t('documents.editor.toolbar.bold'), icon: <Bold />, active: editorState.bold, disabled, run: command((current) => { current.chain().focus().toggleBold().run() }) },
    { key: 'italic', label: t('documents.editor.toolbar.italic'), icon: <Italic />, active: editorState.italic, disabled, run: command((current) => { current.chain().focus().toggleItalic().run() }) },
    { key: 'underline', label: t('documents.editor.toolbar.underline'), icon: <Underline />, active: editorState.underline, disabled, run: command((current) => { current.chain().focus().toggleMark('underline').run() }) },
    { key: 'strike', label: t('documents.editor.toolbar.strike'), icon: <Strikethrough />, active: editorState.strike, disabled, run: command((current) => { current.chain().focus().toggleStrike().run() }) },
    { key: 'bullet', label: t('documents.editor.toolbar.bulletList'), icon: <List />, active: editorState.bulletList, disabled, run: command((current) => { current.chain().focus().toggleBulletList().run() }) },
    { key: 'ordered', label: t('documents.editor.toolbar.orderedList'), icon: <ListOrdered />, active: editorState.orderedList, disabled, run: command((current) => { current.chain().focus().toggleOrderedList().run() }) },
    { key: 'tasks', label: t('documents.editor.toolbar.taskList'), icon: <ListTodo />, active: editorState.taskList, disabled, run: command((current) => { current.chain().focus().toggleTaskList().run() }) },
    { key: 'table', label: t('documents.editor.toolbar.table'), icon: <Table2 />, disabled, run: command((current) => { current.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() }) },
    { key: 'record', label: t('documents.editor.toolbar.insertRecord'), icon: <Database />, disabled, run: onOpenEntityPicker },
    { key: 'link', label: t('documents.editor.toolbar.link'), icon: <Link2 />, active: editorState.link, disabled, run: onOpenLink },
    { key: 'image', label: t('documents.editor.toolbar.image'), icon: uploading ? <Loader2 className="animate-spin" /> : <ImagePlus />, disabled: disabled || uploading, run: onImage },
    { key: 'code', label: t('documents.editor.toolbar.codeBlock'), icon: <Code2 />, active: editorState.codeBlock, disabled, run: command((current) => { current.chain().focus().toggleCodeBlock().run() }) },
  ]
  return (
    <div className="flex max-w-full flex-nowrap items-center gap-1 overflow-x-auto border-b border-border px-2 py-2 overscroll-x-contain sm:px-3" role="toolbar" aria-label={t('documents.editor.toolbar.label')}>
      <ToolbarButtons actions={actions} />
      <EditorColorTools editor={editor} disabled={disabled} />
    </div>
  )
}
