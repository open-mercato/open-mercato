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
import { Check, Minus, MoreHorizontal, Subscript, Superscript } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { IconButton } from '../../primitives/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '../../primitives/popover'
import { useTheme } from '../../theme'

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

// WYSIWYG Markdown editor (MDXEditor / Lexical) wired to the CrudForm value/onChange
// contract. Markdown is the source of truth. Edits are buffered locally and committed
// on blur to avoid re-rendering the whole form on every keystroke.
export default function MdxEditorImpl({ value = '', onChange }: MdxEditorImplProps) {
  const editorRef = React.useRef<MDXEditorMethods>(null)
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

  const commit = React.useCallback(() => {
    if (!typingRef.current) return
    typingRef.current = false
    onChange(latestRef.current)
  }, [onChange])

  return (
    <div className="w-full overflow-hidden rounded-md border border-input bg-background" onBlur={commit}>
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
      />
    </div>
  )
}
