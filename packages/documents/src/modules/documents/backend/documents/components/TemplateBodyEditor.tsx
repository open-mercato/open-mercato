"use client"

import * as React from 'react'
import type { Editor } from '@tiptap/core'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import { Bold, Heading1, Heading2, Italic, List, ListOrdered } from 'lucide-react'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Label } from '@open-mercato/ui/primitives/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { getDocumentEditorExtensions } from '../../../lib/editorConfig'

const EMPTY_TEMPLATE_EDITOR_STATE = {
  bold: false,
  italic: false,
  heading1: false,
  heading2: false,
  bulletList: false,
  orderedList: false,
}

function EditorButton({ editor, label, active, children, onClick }: {
  editor: Editor | null
  label: string
  active: boolean
  children: React.ReactNode
  onClick: (editor: Editor) => void
}) {
  return <IconButton type="button" variant={active ? 'outline' : 'ghost'} aria-label={label} aria-pressed={active} title={label} disabled={!editor} onMouseDown={(event) => event.preventDefault()} onClick={() => { if (editor) onClick(editor) }}>{children}</IconButton>
}

export function TemplateBodyEditor({ bodyHtml, tokenOptions, onChange }: {
  bodyHtml: string
  tokenOptions: string[]
  onChange: (html: string) => void
}) {
  const t = useT()
  const editorLabelId = React.useId()
  const [token, setToken] = React.useState<string | undefined>()
  const editor = useEditor({
    extensions: getDocumentEditorExtensions({
      entityRefFallbackLabel: t('documents.editor.entityRef.fallbackLabel'),
    }),
    content: bodyHtml,
    editable: true,
    editorProps: {
      attributes: {
        class: 'min-h-80 text-base leading-7 text-foreground focus-visible:outline-none',
        role: 'textbox',
        'aria-labelledby': editorLabelId,
        'aria-multiline': 'true',
      },
    },
    onUpdate: ({ editor: updated }) => onChange(updated.getHTML()),
  }, [])
  React.useEffect(() => {
    if (editor && editor.getHTML() !== bodyHtml) editor.commands.setContent(bodyHtml)
  }, [bodyHtml, editor])
  const editorState = useEditorState({
    editor,
    selector: ({ editor: current }) => current ? {
      bold: current.isActive('bold'),
      italic: current.isActive('italic'),
      heading1: current.isActive('heading', { level: 1 }),
      heading2: current.isActive('heading', { level: 2 }),
      bulletList: current.isActive('bulletList'),
      orderedList: current.isActive('orderedList'),
    } : EMPTY_TEMPLATE_EDITOR_STATE,
  }) ?? EMPTY_TEMPLATE_EDITOR_STATE
  return (
    <div className="space-y-3">
      <Label id={editorLabelId}>{t('documents.templates.fields.body')}</Label>
      <div className="rounded-md border border-border bg-card">
        <div className="flex flex-wrap items-center gap-1 border-b border-border p-2">
          <EditorButton editor={editor} label={t('documents.editor.toolbar.bold')} active={editorState.bold} onClick={(current) => { current.chain().focus().toggleBold().run() }}><Bold /></EditorButton>
          <EditorButton editor={editor} label={t('documents.editor.toolbar.italic')} active={editorState.italic} onClick={(current) => { current.chain().focus().toggleItalic().run() }}><Italic /></EditorButton>
          <EditorButton editor={editor} label={t('documents.editor.toolbar.heading1')} active={editorState.heading1} onClick={(current) => { current.chain().focus().toggleHeading({ level: 1 }).run() }}><Heading1 /></EditorButton>
          <EditorButton editor={editor} label={t('documents.editor.toolbar.heading2')} active={editorState.heading2} onClick={(current) => { current.chain().focus().toggleHeading({ level: 2 }).run() }}><Heading2 /></EditorButton>
          <EditorButton editor={editor} label={t('documents.editor.toolbar.bulletList')} active={editorState.bulletList} onClick={(current) => { current.chain().focus().toggleBulletList().run() }}><List /></EditorButton>
          <EditorButton editor={editor} label={t('documents.editor.toolbar.orderedList')} active={editorState.orderedList} onClick={(current) => { current.chain().focus().toggleOrderedList().run() }}><ListOrdered /></EditorButton>
          <div className="min-w-52">
            <Select value={token} onValueChange={(value) => {
              setToken(value)
              editor?.chain().focus().insertContent(value).run()
              window.setTimeout(() => setToken(undefined), 0)
            }}>
              <SelectTrigger aria-label={t('documents.templates.editor.insertField')}><SelectValue placeholder={t('documents.templates.editor.insertField')} /></SelectTrigger>
              <SelectContent>{tokenOptions.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <EditorContent editor={editor} className="max-w-none p-4 text-foreground [&_.ProseMirror]:min-h-80 [&_.ProseMirror]:focus-visible:outline-none" />
      </div>
    </div>
  )
}
