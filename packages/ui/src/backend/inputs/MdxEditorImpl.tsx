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
  id?: string
  ariaLabelledBy?: string
  value?: string
  onChange: (markdown: string) => void
}

export default function MdxEditorImpl({ id, ariaLabelledBy, value = '', onChange }: MdxEditorImplProps) {
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

  React.useEffect(() => {
    if (!ariaLabelledBy || !container) return

    const applyLabelAttributes = () => {
      const contentEditable = container.querySelector<HTMLElement>('[contenteditable="true"]')
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
    observer.observe(container, { childList: true, subtree: true })

    return () => {
      observer.disconnect()
      const contentEditable = container.querySelector<HTMLElement>('[contenteditable="true"]')
      if (!contentEditable) return
      if (id && contentEditable.getAttribute('id') === id) {
        contentEditable.removeAttribute('id')
      }
      if (contentEditable.getAttribute('aria-labelledby') === ariaLabelledBy) {
        contentEditable.removeAttribute('aria-labelledby')
      }
    }
  }, [ariaLabelledBy, container, id])

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
            codeBlockLanguages: {
              '': t('ui.forms.richtext.plainText', 'Plain text'),
              ...CODE_BLOCK_LANGUAGES,
            },
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
