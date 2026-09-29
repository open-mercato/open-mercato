"use client"

import * as React from 'react'
import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { Highlighter, Palette, X } from 'lucide-react'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { useT } from '@open-mercato/shared/lib/i18n/context'

// These literal values are persisted as authored document-content colors. They
// are not application chrome and therefore intentionally do not use DS tokens.
const HIGHLIGHTS = [
  ['#fef08a', 'documents.editor.colors.yellow'], ['#bbf7d0', 'documents.editor.colors.green'],
  ['#bfdbfe', 'documents.editor.colors.blue'], ['#e9d5ff', 'documents.editor.colors.purple'],
  ['#fbcfe8', 'documents.editor.colors.pink'], ['#fed7aa', 'documents.editor.colors.orange'],
  ['#fecaca', 'documents.editor.colors.red'], ['#e5e7eb', 'documents.editor.colors.gray'],
] as const
const TEXT_COLORS = [
  ['#111827', 'documents.editor.colors.black'], ['#dc2626', 'documents.editor.colors.red'],
  ['#ea580c', 'documents.editor.colors.orange'], ['#ca8a04', 'documents.editor.colors.yellow'],
  ['#16a34a', 'documents.editor.colors.green'], ['#2563eb', 'documents.editor.colors.blue'],
  ['#7c3aed', 'documents.editor.colors.purple'], ['#db2777', 'documents.editor.colors.pink'],
] as const
const EMPTY_COLOR_STATE = { textColor: null, highlight: null }

function ColorPicker({ label, icon, colors, active, disabled, onSelect, onClear }: {
  label: string
  icon: React.ReactNode
  colors: ReadonlyArray<readonly [value: string, labelKey: string]>
  active: string | null
  disabled: boolean
  onSelect: (color: string) => void
  onClear: () => void
}) {
  const t = useT()
  return (
    <Popover>
      <PopoverTrigger asChild><IconButton type="button" variant={active ? 'outline' : 'ghost'} aria-label={label} aria-pressed={Boolean(active)} title={label} disabled={disabled}>{icon}</IconButton></PopoverTrigger>
      <PopoverContent className="flex min-w-0 items-center gap-1 p-1">
        <IconButton type="button" size="sm" variant={!active ? 'outline' : 'ghost'} aria-label={t('documents.editor.colors.clear')} onClick={onClear}><X /></IconButton>
        {colors.map(([color, labelKey]) => (
          <IconButton key={color} type="button" size="sm" variant={active?.toLowerCase() === color ? 'outline' : 'ghost'} aria-label={t('documents.editor.colors.selectNamed', { color: t(labelKey) })} onClick={() => onSelect(color)}>
            <span className="size-4 rounded-sm border border-border" style={{ backgroundColor: color }} aria-hidden="true" />
          </IconButton>
        ))}
      </PopoverContent>
    </Popover>
  )
}

export function EditorColorTools({ editor, disabled }: { editor: Editor | null; disabled: boolean }) {
  const t = useT()
  const editorState = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const textColor = current?.getAttributes('textStyle').color
      const highlight = current?.getAttributes('highlight').color
      return {
        textColor: typeof textColor === 'string' ? textColor : null,
        highlight: typeof highlight === 'string' ? highlight : null,
      }
    },
  }) ?? EMPTY_COLOR_STATE
  return (
    <>
      <ColorPicker label={t('documents.editor.toolbar.highlight')} icon={<Highlighter />} colors={HIGHLIGHTS} active={editorState.highlight} disabled={disabled} onSelect={(color) => { editor?.chain().focus().setHighlight({ color }).run() }} onClear={() => { editor?.chain().focus().unsetHighlight().run() }} />
      <ColorPicker label={t('documents.editor.toolbar.textColor')} icon={<Palette />} colors={TEXT_COLORS} active={editorState.textColor} disabled={disabled} onSelect={(color) => { editor?.chain().focus().setColor(color).run() }} onClear={() => { editor?.chain().focus().unsetColor().run() }} />
    </>
  )
}
