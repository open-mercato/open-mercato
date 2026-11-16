/// <reference path="../../types/css.d.ts" />
"use client"

import * as React from 'react'
import {
  MDXEditor,
  type MDXEditorMethods,
  type ViewMode,
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
  Separator,
  diffSourcePlugin,
  viewMode$,
  applyFormat$,
  insertThematicBreak$,
  usePublisher,
  useCellValue,
} from '@mdxeditor/editor'
import '@mdxeditor/editor/style.css'
import { EditorView } from '@codemirror/view'
import { Check, Minus, MoreHorizontal, Subscript, Superscript } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { IconButton } from '../../primitives/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '../../primitives/popover'
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

// Overflow menu for the toolbar's long tail: sub/superscript, horizontal rule,
// and the rich-text/source/diff view switch. Keeping them here (instead of
// inline buttons) is what lets the toolbar hold a single row in dialog-width
// hosts without losing the options.
function ToolbarMoreMenu() {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const setViewMode = usePublisher(viewMode$)
  const currentViewMode = useCellValue(viewMode$)
  const applyFormat = usePublisher(applyFormat$)
  const insertThematicBreak = usePublisher(insertThematicBreak$)
  const rowClass =
    'flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-sm text-foreground hover:bg-accent'
  const viewModes: Array<{ mode: ViewMode; label: string }> = [
    { mode: 'rich-text', label: t('ui.markdown.viewMode.richText', 'Rich text') },
    { mode: 'source', label: t('ui.markdown.viewMode.source', 'Markdown source') },
    { mode: 'diff', label: t('ui.markdown.viewMode.diff', 'Diff') },
  ]
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton type="button" variant="ghost" size="sm" aria-label={t('ui.markdown.moreTools', 'More tools')}>
          <MoreHorizontal className="size-4" />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="min-w-0 w-56 p-1">
        <ul role="menu" className="flex flex-col">
          <li role="none">
            <button type="button" role="menuitem" className={rowClass} onClick={() => { applyFormat('superscript'); setOpen(false) }}>
              <Superscript className="size-4 text-muted-foreground" aria-hidden />
              {t('ui.markdown.superscript', 'Superscript')}
            </button>
          </li>
          <li role="none">
            <button type="button" role="menuitem" className={rowClass} onClick={() => { applyFormat('subscript'); setOpen(false) }}>
              <Subscript className="size-4 text-muted-foreground" aria-hidden />
              {t('ui.markdown.subscript', 'Subscript')}
            </button>
          </li>
          <li role="none">
            <button type="button" role="menuitem" className={rowClass} onClick={() => { insertThematicBreak(); setOpen(false) }}>
              <Minus className="size-4 text-muted-foreground" aria-hidden />
              {t('ui.markdown.horizontalRule', 'Horizontal rule')}
            </button>
          </li>
        </ul>
        <div className="my-1 h-px bg-border" aria-hidden />
        <ul role="menu" className="flex flex-col">
          {viewModes.map(({ mode, label }) => (
            <li key={mode} role="none">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={currentViewMode === mode}
                onClick={() => { setViewMode(mode); setOpen(false) }}
                className={cn(rowClass, currentViewMode === mode && 'font-medium')}
              >
                <Check className={cn('size-4', currentViewMode === mode ? 'text-accent-indigo' : 'invisible')} aria-hidden />
                {label}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

type MdxEditorImplProps = {
  value?: string
  onChange: (markdown: string) => void
}

export default function MdxEditorImpl({ value = '', onChange }: MdxEditorImplProps) {
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
            codeBlockLanguages: {
              '': t('ui.forms.richtext.plainText', 'Plain text'),
              ...CODE_BLOCK_LANGUAGES,
            },
          }),
          markdownShortcutPlugin(),
          diffSourcePlugin({ viewMode: 'rich-text', codeMirrorExtensions }),
          toolbarPlugin({
            // No DiffSourceToggleWrapper: the rich/diff/source view toggles are a
            // developer affordance (hosts that need raw Markdown already switch to
            // a plain textarea via SwitchableMarkdownInput), and their three
            // buttons were what pushed the toolbar onto a second row in
            // dialog-width hosts.
            toolbarContents: () => (
              <>
                <UndoRedo />
                <Separator />
                <BoldItalicUnderlineToggles />
                <CodeToggle />
                {/* Sub/superscript stay available via markdown; their buttons (and the
                    thematic-break one — `---` still works as a shortcut) are dropped so
                    the toolbar fits one row inside dialog-width hosts. */}
                <StrikeThroughSupSubToggles options={['Strikethrough']} />
                <Separator />
                <ListsToggle />
                <Separator />
                <BlockTypeSelect />
                <Separator />
                <CreateLink />
                <InsertImage />
                <Separator />
                <InsertTable />
                <Separator />
                <ToolbarMoreMenu />
              </>
            ),
          }),
        ]}
      />}
    </div>
  )
}
