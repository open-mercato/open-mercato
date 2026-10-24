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
  codeBlockPlugin,
  codeMirrorPlugin,
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
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useTheme } from '../../theme'

const CODE_BLOCK_LANGUAGES: Record<string, string> = {
  js: 'JavaScript',
  jsx: 'JavaScript (React)',
  ts: 'TypeScript',
  tsx: 'TypeScript (React)',
  json: 'JSON',
  html: 'HTML',
  css: 'CSS',
  sql: 'SQL',
  python: 'Python',
  bash: 'Bash',
  sh: 'Shell',
  yaml: 'YAML',
  markdown: 'Markdown',
}

type MdxEditorImplProps = {
  value?: string
  onChange: (markdown: string) => void
}

// WYSIWYG Markdown editor (MDXEditor / Lexical) wired to the CrudForm value/onChange
// contract. Markdown is the source of truth. Edits are buffered locally and committed
// on blur to avoid re-rendering the whole form on every keystroke.
export default function MdxEditorImpl({ value = '', onChange }: MdxEditorImplProps) {
  const editorRef = React.useRef<MDXEditorMethods>(null)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const latestRef = React.useRef<string>(value)
  const typingRef = React.useRef(false)
  const { resolvedTheme } = useTheme()
  const t = useT()

  // External value changes (form reset / async initial load) are pushed into the editor,
  // but never while the user is actively typing (would reset the caret).
  React.useEffect(() => {
    if (typingRef.current) return
    if (value !== latestRef.current) {
      latestRef.current = value
      editorRef.current?.setMarkdown(value ?? '')
    }
  }, [value])

  const commit = React.useCallback(() => {
    if (!typingRef.current) return
    typingRef.current = false
    onChange(latestRef.current)
  }, [onChange])

  return (
    <div
      ref={containerRef}
      data-testid="mdx-editor-container"
      className="w-full overflow-hidden rounded-md border border-input bg-background"
      onBlur={commit}
    >
      <MDXEditor
        ref={editorRef}
        markdown={value ?? ''}
        onChange={(markdown, initialMarkdownNormalize) => {
          typingRef.current = true
          latestRef.current = markdown
          // MDXEditor also calls onChange once at mount when it normalizes the initial
          // markdown (initialMarkdownNormalize === true), before the user has touched
          // anything. Buffer that call but never flush it immediately below.
          if (initialMarkdownNormalize) return
          // Some toolbar controls (code block language select, delete) move focus out of
          // the editor before this callback runs, so the `blur` that would normally
          // trigger `commit` fires first and finds `typingRef` still false. Once that
          // happens no further blur arrives to retry, so the edit is silently dropped.
          // If focus has already left the editor by the time we get here, there is no
          // more blur coming — flush immediately instead of waiting for one.
          if (containerRef.current && !containerRef.current.contains(document.activeElement)) {
            commit()
          }
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
          codeBlockPlugin({ defaultCodeBlockLanguage: '' }),
          codeMirrorPlugin({
            codeBlockLanguages: {
              '': t('ui.forms.richtext.plainText', 'Plain text'),
              ...CODE_BLOCK_LANGUAGES,
            },
          }),
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
