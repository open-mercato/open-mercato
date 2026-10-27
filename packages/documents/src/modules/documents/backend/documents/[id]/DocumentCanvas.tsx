"use client"

import * as React from 'react'
import type { Editor } from '@tiptap/core'
import { EditorContent, useEditorState } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { Bold, Italic, Link2, MessageSquare, Underline } from 'lucide-react'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { OutlinePane } from './OutlinePane'
import { captureCommentAnchor, type CommentAnchor } from './CommentAnchorNavigation'
import { DOCUMENT_EDITOR_CONTENT_CLASS } from './editorTypes'
import { DOCUMENT_PAGINATION_STYLES } from './documentPagination'

type TitleModel = {
  value: string
  setValue: (value: string) => void
  saving: boolean
  commit: () => Promise<void>
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
}

const EMPTY_BUBBLE_MENU_STATE = {
  bold: false,
  italic: false,
  underline: false,
  link: false,
}

export function DocumentCanvas({
  editor,
  title,
  readOnly,
  outlineOpen,
  notice,
  onOpenLink,
  onComment,
}: {
  editor: Editor | null
  title: TitleModel
  readOnly: boolean
  outlineOpen: boolean
  notice: string | null
  onOpenLink: () => void
  onComment?: (anchor: CommentAnchor) => void
}) {
  const t = useT()
  const editorState = useEditorState({
    editor,
    selector: ({ editor: current }) => current ? {
      bold: current.isActive('bold'),
      italic: current.isActive('italic'),
      underline: current.isActive('underline'),
      link: current.isActive('link'),
    } : EMPTY_BUBBLE_MENU_STATE,
  }) ?? EMPTY_BUBBLE_MENU_STATE
  const keepSelection = React.useCallback((event: React.MouseEvent<HTMLButtonElement>) => event.preventDefault(), [])
  const comment = React.useCallback(() => {
    if (!editor || !onComment) return
    const anchor = captureCommentAnchor(editor)
    if (anchor) onComment(anchor)
  }, [editor, onComment])
  const shouldShow = React.useCallback(
    ({ from, to }: { from: number; to: number }) => from !== to && (!readOnly || Boolean(onComment)),
    [onComment, readOnly],
  )

  return (
    <div className="om-doc-canvas max-h-[calc(100dvh-var(--topbar-height,0px)-12rem)] min-h-96 overflow-auto bg-muted p-0 sm:px-4 sm:py-8 md:px-8 md:py-10">
      <style>{DOCUMENT_PAGINATION_STYLES}</style>
      {notice ? <Alert status="information" style="lighter" className="mx-auto mb-4 max-w-3xl"><AlertDescription>{notice}</AlertDescription></Alert> : null}
      <div className="mx-auto flex w-fit min-w-full flex-col gap-4 lg:flex-row lg:items-start">
        {outlineOpen ? <OutlinePane editor={editor} /> : null}
        <article className="om-doc-paper mx-auto flex-none bg-card sm:rounded-sm sm:shadow-lg">
          {readOnly ? (
            <h1 className="mb-6 text-xl font-semibold leading-tight text-foreground sm:mb-8 sm:text-3xl">{title.value}</h1>
          ) : (
            <Input
              value={title.value}
              onChange={(event) => title.setValue(event.target.value)}
              onBlur={() => void title.commit()}
              onKeyDown={title.onKeyDown}
              maxLength={512}
              disabled={title.saving}
              aria-label={t('documents.editor.title.ariaLabel')}
              className="mb-6 h-auto border-0 bg-transparent px-0 py-0 text-xl font-semibold leading-tight text-foreground shadow-none focus-visible:shadow-focus sm:mb-8 sm:text-3xl"
            />
          )}
          {editor ? (
            <BubbleMenu editor={editor} shouldShow={shouldShow} className="z-popover flex items-center gap-1 rounded-md border border-border bg-card p-1 shadow-md">
              {!readOnly ? (
                <>
                  <IconButton type="button" size="sm" variant={editorState.bold ? 'outline' : 'ghost'} aria-label={t('documents.editor.toolbar.bold')} aria-pressed={editorState.bold} onMouseDown={keepSelection} onClick={() => editor.chain().focus().toggleBold().run()}><Bold /></IconButton>
                  <IconButton type="button" size="sm" variant={editorState.italic ? 'outline' : 'ghost'} aria-label={t('documents.editor.toolbar.italic')} aria-pressed={editorState.italic} onMouseDown={keepSelection} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic /></IconButton>
                  <IconButton type="button" size="sm" variant={editorState.underline ? 'outline' : 'ghost'} aria-label={t('documents.editor.toolbar.underline')} aria-pressed={editorState.underline} onMouseDown={keepSelection} onClick={() => editor.chain().focus().toggleMark('underline').run()}><Underline /></IconButton>
                  <IconButton type="button" size="sm" variant={editorState.link ? 'outline' : 'ghost'} aria-label={t('documents.editor.toolbar.link')} aria-pressed={editorState.link} onMouseDown={keepSelection} onClick={onOpenLink}><Link2 /></IconButton>
                </>
              ) : null}
              {onComment ? <Button type="button" size="sm" variant="ghost" onMouseDown={keepSelection} onClick={comment}><MessageSquare />{t('documents.editor.toolbar.comment')}</Button> : null}
            </BubbleMenu>
          ) : null}
          <EditorContent className={cn(DOCUMENT_EDITOR_CONTENT_CLASS, readOnly && 'select-text')} editor={editor} />
        </article>
      </div>
    </div>
  )
}
