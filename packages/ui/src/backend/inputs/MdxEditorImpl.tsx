/// <reference path="../../types/css.d.ts" />
"use client"

import * as React from 'react'
import {
  MDXEditor,
  type MDXEditorMethods,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  thematicBreakPlugin,
  linkPlugin,
  linkDialogPlugin,
  imagePlugin,
  tablePlugin,
  markdownShortcutPlugin,
  diffSourcePlugin,
  toolbarPlugin,
  UndoRedo,
  BoldItalicUnderlineToggles,
  CodeToggle,
  StrikeThroughSupSubToggles,
  ListsToggle,
  BlockTypeSelect,
  CreateLink,
  InsertImage,
  InsertTable,
  InsertThematicBreak,
  Separator,
  DiffSourceToggleWrapper,
} from '@mdxeditor/editor'
import '@mdxeditor/editor/style.css'
import { cn } from '@open-mercato/shared/lib/utils'
import { useTheme } from '../../theme'

type MdxEditorImplProps = {
  id?: string
  ariaLabelledBy?: string
  value?: string
  onChange: (markdown: string) => void
}

// WYSIWYG Markdown editor (MDXEditor / Lexical) wired to the CrudForm value/onChange
// contract. Markdown is the source of truth. Edits are buffered locally and committed
// on blur to avoid re-rendering the whole form on every keystroke.
export default function MdxEditorImpl({ id, ariaLabelledBy, value = '', onChange }: MdxEditorImplProps) {
  const editorRef = React.useRef<MDXEditorMethods>(null)
  const wrapperRef = React.useRef<HTMLDivElement | null>(null)
  const latestRef = React.useRef<string>(value)
  const typingRef = React.useRef(false)
  const { resolvedTheme } = useTheme()

  // External value changes (form reset / async initial load) are pushed into the editor,
  // but never while the user is actively typing (would reset the caret).
  React.useEffect(() => {
    if (typingRef.current) return
    if (value !== latestRef.current) {
      latestRef.current = value
      editorRef.current?.setMarkdown(value ?? '')
    }
  }, [value])

  React.useEffect(() => {
    if (!ariaLabelledBy || typeof document === 'undefined') return
    const wrapper = wrapperRef.current
    if (!wrapper) return

    const applyLabelAttributes = () => {
      const contentEditable = wrapper.querySelector<HTMLElement>('[contenteditable="true"]')
      if (!contentEditable) return
      if (id && contentEditable.getAttribute('id') !== id) {
        contentEditable.setAttribute('id', id)
      }
      if (contentEditable.getAttribute('aria-labelledby') !== ariaLabelledBy) {
        contentEditable.setAttribute('aria-labelledby', ariaLabelledBy)
      }
    }

    applyLabelAttributes()
    const observer = new MutationObserver(applyLabelAttributes)
    observer.observe(wrapper, { childList: true, subtree: true })

    return () => {
      observer.disconnect()
      const contentEditable = wrapper.querySelector<HTMLElement>('[contenteditable="true"]')
      if (!contentEditable) return
      if (id && contentEditable.getAttribute('id') === id) {
        contentEditable.removeAttribute('id')
      }
      if (contentEditable.getAttribute('aria-labelledby') === ariaLabelledBy) {
        contentEditable.removeAttribute('aria-labelledby')
      }
    }
  }, [ariaLabelledBy, id])

  const commit = React.useCallback(() => {
    if (!typingRef.current) return
    typingRef.current = false
    onChange(latestRef.current)
  }, [onChange])

  return (
    <div
      ref={wrapperRef}
      className="w-full overflow-hidden rounded-md border border-input bg-background"
      onBlur={commit}
    >
      <MDXEditor
        ref={editorRef}
        markdown={value ?? ''}
        onChange={(markdown) => {
          typingRef.current = true
          latestRef.current = markdown
        }}
        className={cn('om-mdx-editor', resolvedTheme === 'dark' && 'dark-theme')}
        contentEditableClassName="om-mdx-prose"
        plugins={[
          headingsPlugin(),
          listsPlugin(),
          quotePlugin(),
          thematicBreakPlugin(),
          linkPlugin(),
          linkDialogPlugin(),
          imagePlugin(),
          tablePlugin(),
          markdownShortcutPlugin(),
          diffSourcePlugin({ viewMode: 'rich-text' }),
          toolbarPlugin({
            toolbarContents: () => (
              <DiffSourceToggleWrapper>
                <UndoRedo />
                <Separator />
                <BoldItalicUnderlineToggles />
                <CodeToggle />
                <StrikeThroughSupSubToggles />
                <Separator />
                <ListsToggle />
                <Separator />
                <BlockTypeSelect />
                <Separator />
                <CreateLink />
                <InsertImage />
                <Separator />
                <InsertTable />
                <InsertThematicBreak />
              </DiffSourceToggleWrapper>
            ),
          }),
        ]}
      />
    </div>
  )
}
