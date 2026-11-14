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
import { EditorView } from '@codemirror/view'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useTheme } from '../../theme'
import { useContentSecurityPolicyNonce } from '../../theme/ContentSecurityPolicyProvider'

import type { MarkdownFieldProps } from './MarkdownField'
import { resolveMarkdownCodeBlockLanguages } from '../markdown/codeBlockLanguages'

export default function MdxEditorImpl({ value = '', onChange, codeBlockLanguages }: MarkdownFieldProps) {
  const editorRef = React.useRef<MDXEditorMethods>(null)
  const [container, setContainer] = React.useState<HTMLDivElement | null>(null)
  const latestRef = React.useRef<string>(value)
  const { resolvedTheme } = useTheme()
  const t = useT()
  const nonce = useContentSecurityPolicyNonce()
  const codeMirrorExtensions = React.useMemo(() => nonce ? [EditorView.cspNonce.of(nonce)] : [], [nonce])

  React.useEffect(() => {
    if (value !== latestRef.current) {
      latestRef.current = value
      editorRef.current?.setMarkdown(value ?? '')
    }
  }, [value])

  return (
    <div
      ref={setContainer}
      data-testid="mdx-editor-container"
      className="w-full overflow-hidden rounded-md border border-input bg-background"
    >
      {container && <MDXEditor
        ref={editorRef}
        overlayContainer={container.closest<HTMLElement>('[role="dialog"]') ?? undefined}
        markdown={value ?? ''}
        onChange={(markdown, initialMarkdownNormalize) => {
          if (initialMarkdownNormalize || markdown === latestRef.current) return
          latestRef.current = markdown
          onChange(markdown)
        }}
        className={cn(
          'om-mdx-editor [&.mdxeditor-popup-container]:z-popover! [&_[class*=codeMirrorToolbar]]:static! [&_[class*=codeMirrorToolbar]]:flex-wrap [&_[class*=codeMirrorToolbar]]:justify-end',
          resolvedTheme === 'dark' && 'dark-theme',
        )}
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
            codeMirrorExtensions,
            codeBlockLanguages: resolveMarkdownCodeBlockLanguages(t, codeBlockLanguages),
          }),
          markdownShortcutPlugin(),
          diffSourcePlugin({ viewMode: 'rich-text', codeMirrorExtensions }),
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
      />}
    </div>
  )
}
