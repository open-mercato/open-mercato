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
  value?: string
  onChange: (markdown: string) => void
}

export default function MdxEditorImpl({ value = '', onChange }: MdxEditorImplProps) {
  const editorRef = React.useRef<MDXEditorMethods>(null)
  const latestRef = React.useRef<string>(value)
  const { resolvedTheme } = useTheme()

  React.useEffect(() => {
    if (value !== latestRef.current) {
      latestRef.current = value
      editorRef.current?.setMarkdown(value ?? '')
    }
  }, [value])

  return (
    <div className="w-full overflow-hidden rounded-md border border-input bg-background">
      <MDXEditor
        ref={editorRef}
        markdown={value ?? ''}
        onChange={(markdown, initialMarkdownNormalize) => {
          if (initialMarkdownNormalize || markdown === latestRef.current) return
          latestRef.current = markdown
          onChange(markdown)
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
