"use client"

import * as React from 'react'
import {
  Bold,
  ChevronDown,
  Code,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Quote,
  Strikethrough,
  Underline,
} from 'lucide-react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@open-mercato/shared/lib/utils'
import {
  sanitizeHtmlRichText,
  sanitizeRichTextHref,
  sanitizeRichTextPasteContent,
} from '@open-mercato/ui/backend/utils/richTextSanitizer'
import { Popover, PopoverContent, PopoverTrigger } from './popover'

// Figma `Rich Editor Colors` palette (164611:20259) — 10 tokens.
export const RICH_EDITOR_COLOR_PALETTE = {
  gray: '#7b7b7b',
  blue: '#6366f1',
  orange: '#f59e0b',
  red: '#ef4444',
  green: '#22c55e',
  yellow: '#f6b51e',
  purple: '#7d52f4',
  sky: '#47c2ff',
  pink: '#fb4ba3',
  teal: '#22d3bb',
} as const

export type RichEditorColorKey = keyof typeof RICH_EDITOR_COLOR_PALETTE
const COLOR_KEYS: RichEditorColorKey[] = [
  'gray', 'blue', 'orange', 'red', 'green', 'yellow', 'purple', 'sky', 'pink', 'teal',
]

export type RichEditorVariant = 'full' | 'standard' | 'basic' | 'minimal' | 'custom'

type SelectionState = {
  bold: boolean
  italic: boolean
  underline: boolean
  strikethrough: boolean
  unorderedList: boolean
  orderedList: boolean
  blockquote: boolean
  code: boolean
  heading: '' | 'h1' | 'h2' | 'h3'
}

const EMPTY_SELECTION_STATE: SelectionState = {
  bold: false,
  italic: false,
  underline: false,
  strikethrough: false,
  unorderedList: false,
  orderedList: false,
  blockquote: false,
  code: false,
  heading: '',
}

type RichEditorContextValue = {
  exec: (command: string, arg?: string) => void
  selection: SelectionState
  disabled: boolean
}

const RichEditorContext = React.createContext<RichEditorContextValue | null>(null)

function useRichEditorContext(component: string): RichEditorContextValue {
  const ctx = React.useContext(RichEditorContext)
  if (!ctx) {
    throw new Error(`${component} must be rendered inside <RichEditor>`)
  }
  return ctx
}

export type RichEditorProps = {
  /** HTML string value (sanitized by `sanitizeHtmlRichText`). */
  value?: string
  /** Called with sanitized HTML on blur. */
  onChange: (html: string) => void
  /**
   * Toolbar preset:
   * - `'full'`     — heading dropdown, bold/italic/underline/strike, color, lists, quote/code, link
   * - `'standard'` — heading, bold/italic/underline, list, link (default — matches the legacy `editor='html'` toolbar)
   * - `'basic'`    — bold/italic/underline, list, link
   * - `'minimal'`  — bold/italic/underline
   * - `'custom'`   — render toolbar children passed via `children`
   */
  variant?: RichEditorVariant
  placeholder?: string
  minRows?: number
  disabled?: boolean
  className?: string
  contentClassName?: string
  /** Translation labels — pass through `useT()` for i18n. */
  labels?: Partial<RichEditorLabels>
  /** When `variant='custom'`, render `<RichEditorToolbar>{...}</RichEditorToolbar>` and `<RichEditorContent />`. */
  children?: React.ReactNode
  id?: string
  name?: string
  'aria-invalid'?: boolean | 'true' | 'false'
}

export type RichEditorLabels = {
  bold: string
  italic: string
  underline: string
  strikethrough: string
  unorderedList: string
  orderedList: string
  blockquote: string
  code: string
  heading: string
  heading1: string
  heading2: string
  heading3: string
  paragraph: string
  link: string
  linkUrlPrompt: string
  color: string
  textColor: string
  more: string
  placeholder: string
}

const DEFAULT_LABELS: RichEditorLabels = {
  bold: 'Bold',
  italic: 'Italic',
  underline: 'Underline',
  strikethrough: 'Strikethrough',
  unorderedList: 'Bullet list',
  orderedList: 'Numbered list',
  blockquote: 'Quote',
  code: 'Code',
  heading: 'Heading',
  heading1: 'Heading 1',
  heading2: 'Heading 2',
  heading3: 'Heading 3',
  paragraph: 'Paragraph',
  link: 'Link',
  linkUrlPrompt: 'Enter URL',
  color: 'Text color',
  textColor: 'Color',
  more: 'More',
  placeholder: 'Type here…',
}

function deriveSelectionState(): SelectionState {
  if (typeof document === 'undefined' || !document.queryCommandState) {
    return EMPTY_SELECTION_STATE
  }
  try {
    const block = document.queryCommandValue?.('formatBlock') ?? ''
    const lower = String(block).toLowerCase().replace(/[<>]/g, '')
    const heading: SelectionState['heading'] =
      lower === 'h1' || lower === 'h2' || lower === 'h3' ? lower : ''
    return {
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      underline: document.queryCommandState('underline'),
      strikethrough: document.queryCommandState('strikeThrough'),
      unorderedList: document.queryCommandState('insertUnorderedList'),
      orderedList: document.queryCommandState('insertOrderedList'),
      blockquote: lower === 'blockquote',
      code: lower === 'pre',
      heading,
    }
  } catch {
    return EMPTY_SELECTION_STATE
  }
}

export const RichEditor = React.memo(function RichEditor({
  value = '',
  onChange,
  variant = 'standard',
  placeholder,
  minRows = 4,
  disabled = false,
  className,
  contentClassName,
  labels: labelsProp,
  children,
  id,
  name,
  'aria-invalid': ariaInvalid,
}: RichEditorProps) {
  const labels = React.useMemo<RichEditorLabels>(
    () => ({ ...DEFAULT_LABELS, ...(labelsProp ?? {}) }),
    [labelsProp],
  )

  const editorRef = React.useRef<HTMLDivElement | null>(null)
  const applyingExternal = React.useRef(false)
  const typingRef = React.useRef(false)
  const [selection, setSelection] = React.useState<SelectionState>(EMPTY_SELECTION_STATE)

  React.useEffect(() => {
    const el = editorRef.current
    if (!el) return
    const sanitizedValue = sanitizeHtmlRichText(value)
    if (!typingRef.current && el.innerHTML !== sanitizedValue) {
      applyingExternal.current = true
      el.innerHTML = sanitizedValue
      requestAnimationFrame(() => {
        applyingExternal.current = false
      })
    }
  }, [value])

  const refreshSelectionState = React.useCallback(() => {
    setSelection(deriveSelectionState())
  }, [])

  const exec = React.useCallback(
    (command: string, arg?: string) => {
      const el = editorRef.current
      if (!el || disabled) return
      el.focus()
      try {
        document.execCommand(command, false, arg)
      } catch {
        // ignore unsupported commands
      }
      refreshSelectionState()
    },
    [disabled, refreshSelectionState],
  )

  const ctx = React.useMemo<RichEditorContextValue>(
    () => ({ exec, selection, disabled }),
    [exec, selection, disabled],
  )

  React.useEffect(() => {
    if (typeof document === 'undefined') return
    const onSelectionChange = () => {
      if (!editorRef.current) return
      const sel = window.getSelection()
      if (!sel || !sel.anchorNode) return
      if (!editorRef.current.contains(sel.anchorNode)) return
      refreshSelectionState()
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
    }
  }, [refreshSelectionState])

  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const isMod = e.metaKey || e.ctrlKey
      if (!isMod) return
      const k = e.key.toLowerCase()
      if (k === 'b') {
        e.preventDefault()
        exec('bold')
      } else if (k === 'i') {
        e.preventDefault()
        exec('italic')
      } else if (k === 'u') {
        e.preventDefault()
        exec('underline')
      }
    },
    [exec],
  )

  const onPaste = React.useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      const html = e.clipboardData.getData('text/html')
      const text = e.clipboardData.getData('text/plain')
      const sanitizedPaste = sanitizeRichTextPasteContent(html, text)
      if (!sanitizedPaste) return
      e.preventDefault()
      exec(sanitizedPaste.command, sanitizedPaste.value)
    },
    [exec],
  )

  const onBlur = React.useCallback(() => {
    const el = editorRef.current
    if (!el) return
    typingRef.current = false
    const sanitized = sanitizeHtmlRichText(el.innerHTML)
    if (el.innerHTML !== sanitized) {
      applyingExternal.current = true
      el.innerHTML = sanitized
      requestAnimationFrame(() => {
        applyingExternal.current = false
      })
    }
    onChange(sanitized)
  }, [onChange])

  const toolbar = variant === 'custom'
    ? children
    : <RichEditorToolbar><RichEditorPresetItems variant={variant} labels={labels} /></RichEditorToolbar>

  // When variant='custom', children may include both Toolbar and Content overrides.
  // Otherwise we render a default Content area below the preset toolbar.
  const renderDefaultContent = variant !== 'custom'

  return (
    <RichEditorContext.Provider value={ctx}>
      <div
        className={cn(
          'w-full overflow-hidden rounded-lg border border-border bg-card',
          disabled && 'opacity-60',
          className,
        )}
        data-slot="rich-editor"
        data-disabled={disabled ? 'true' : 'false'}
        aria-invalid={ariaInvalid}
      >
        {toolbar}
        {renderDefaultContent ? (
          <RichEditorContent
            ref={editorRef}
            placeholder={placeholder ?? labels.placeholder}
            minRows={minRows}
            disabled={disabled}
            className={contentClassName}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onBlur={onBlur}
            onInput={() => {
              if (!applyingExternal.current) typingRef.current = true
            }}
            id={id}
            name={name}
          />
        ) : null}
      </div>
    </RichEditorContext.Provider>
  )
}, (prev, next) => prev.value === next.value && prev.disabled === next.disabled && prev.variant === next.variant)
RichEditor.displayName = 'RichEditor'

export type RichEditorToolbarProps = React.HTMLAttributes<HTMLDivElement>

export const RichEditorToolbar = React.forwardRef<HTMLDivElement, RichEditorToolbarProps>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      role="toolbar"
      aria-label="Rich text formatting"
      className={cn(
        // Figma reference: 32px row, 2-4px gap between items, 1px bottom border to separate from content.
        'flex h-8 items-center gap-0.5 border-b border-border bg-card px-2',
        className,
      )}
      data-slot="rich-editor-toolbar"
      {...props}
    >
      {children}
    </div>
  ),
)
RichEditorToolbar.displayName = 'RichEditorToolbar'

const richEditorItemVariants = cva(
  // All four Figma types share: rounded-6, 28px size baseline, white default bg,
  // weak-50 on hover/active. `active=true` keeps the weak-50 fill so a pressed
  // toggle (e.g. bold while inside bold selection) stays visually held.
  'inline-flex h-7 shrink-0 items-center justify-center gap-0.5 rounded-md text-sm font-medium leading-5 tracking-tight text-foreground/80 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-40 data-[active=true]:bg-muted data-[active=true]:text-foreground',
  {
    variants: {
      type: {
        // Figma 166251:2698 — pl-[10px] pr-[4px] for the text label.
        text: 'min-w-0 px-2.5 pr-1 [&>svg]:size-5',
        // Figma 166251:2700 — square icon button.
        icon: 'aspect-square p-1 [&>svg]:size-5',
        // Figma 166251:3337 — icon + caret.
        dropdown: 'px-1 [&>svg]:size-5',
        // Figma 166331:4437 — color swatch + caret.
        color: 'pl-2 pr-1 [&>svg]:size-5',
      },
    },
    defaultVariants: { type: 'icon' },
  },
)

type ToolbarButtonBaseProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'children'> &
  VariantProps<typeof richEditorItemVariants> & {
    active?: boolean
    /** Optional tooltip label (forwarded as `title` for now — swap to `<Tooltip>` per consumer). */
    tooltipLabel?: string
  }

const RichEditorButton = React.forwardRef<HTMLButtonElement, ToolbarButtonBaseProps & { children?: React.ReactNode }>(
  ({ className, type, active, tooltipLabel, children, onMouseDown, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      // Prevent the toolbar button from stealing focus and collapsing the editor's
      // text selection before exec() runs (matches the legacy editor behaviour).
      onMouseDown={(e) => {
        e.preventDefault()
        onMouseDown?.(e)
      }}
      data-active={active ? 'true' : 'false'}
      title={tooltipLabel}
      aria-pressed={active}
      className={cn(richEditorItemVariants({ type }), className)}
      {...props}
    >
      {children}
    </button>
  ),
)
RichEditorButton.displayName = 'RichEditorButton'

export type RichEditorIconButtonProps = Omit<ToolbarButtonBaseProps, 'type'> & {
  icon: React.ReactNode
  ariaLabel: string
  command?: string
  commandArg?: string
  onActivate?: () => void
}

export const RichEditorIconButton = React.forwardRef<HTMLButtonElement, RichEditorIconButtonProps>(
  ({ icon, ariaLabel, command, commandArg, onActivate, active, onClick, ...props }, ref) => {
    const { exec, disabled } = useRichEditorContext('RichEditorIconButton')
    return (
      <RichEditorButton
        ref={ref}
        type="icon"
        active={active}
        aria-label={ariaLabel}
        disabled={disabled || props.disabled}
        onClick={(e) => {
          if (command) exec(command, commandArg)
          onActivate?.()
          onClick?.(e)
        }}
        {...props}
      >
        <span data-slot="rich-editor-item-icon" aria-hidden="true">
          {icon}
        </span>
      </RichEditorButton>
    )
  },
)
RichEditorIconButton.displayName = 'RichEditorIconButton'

export type RichEditorTextDropdownProps = Omit<ToolbarButtonBaseProps, 'type' | 'children'> & {
  label: React.ReactNode
  /** Translatable accessible name. */
  ariaLabel: string
  /** Popover content rendered when the trigger opens. */
  menu?: React.ReactNode
  /** Skip the popover and call this handler directly (when the dropdown is just a labelled caret button). */
  onActivate?: () => void
}

export const RichEditorTextDropdown = React.forwardRef<HTMLButtonElement, RichEditorTextDropdownProps>(
  ({ label, ariaLabel, menu, onActivate, ...props }, ref) => {
    const { disabled } = useRichEditorContext('RichEditorTextDropdown')
    const button = (
      <RichEditorButton
        ref={ref}
        type="text"
        aria-label={ariaLabel}
        disabled={disabled || props.disabled}
        onClick={onActivate}
        {...props}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="opacity-60" aria-hidden="true" />
      </RichEditorButton>
    )
    if (!menu) return button
    return (
      <Popover>
        <PopoverTrigger asChild>{button}</PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} className="w-44 p-1">
          {menu}
        </PopoverContent>
      </Popover>
    )
  },
)
RichEditorTextDropdown.displayName = 'RichEditorTextDropdown'

export type RichEditorDropdownButtonProps = Omit<ToolbarButtonBaseProps, 'type' | 'children'> & {
  icon: React.ReactNode
  ariaLabel: string
  menu: React.ReactNode
}

export const RichEditorDropdownButton = React.forwardRef<HTMLButtonElement, RichEditorDropdownButtonProps>(
  ({ icon, ariaLabel, menu, ...props }, ref) => {
    const { disabled } = useRichEditorContext('RichEditorDropdownButton')
    return (
      <Popover>
        <PopoverTrigger asChild>
          <RichEditorButton
            ref={ref}
            type="dropdown"
            aria-label={ariaLabel}
            disabled={disabled || props.disabled}
            {...props}
          >
            <span data-slot="rich-editor-item-icon" aria-hidden="true">
              {icon}
            </span>
            <ChevronDown className="opacity-60" aria-hidden="true" />
          </RichEditorButton>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} className="w-44 p-1">
          {menu}
        </PopoverContent>
      </Popover>
    )
  },
)
RichEditorDropdownButton.displayName = 'RichEditorDropdownButton'

export type RichEditorColorButtonProps = Omit<ToolbarButtonBaseProps, 'type' | 'children' | 'value'> & {
  colorValue?: RichEditorColorKey | null
  ariaLabel: string
  /** Defaults to the standard `foreColor` command (text color). Pass `'hiliteColor'` for highlight. */
  command?: string
  onSelect?: (color: RichEditorColorKey | null) => void
}

export const RichEditorColorButton = React.forwardRef<HTMLButtonElement, RichEditorColorButtonProps>(
  ({ colorValue, ariaLabel, command = 'foreColor', onSelect, ...props }, ref) => {
    const { exec, disabled } = useRichEditorContext('RichEditorColorButton')
    const swatchColor = colorValue ? RICH_EDITOR_COLOR_PALETTE[colorValue] : RICH_EDITOR_COLOR_PALETTE.gray
    return (
      <Popover>
        <PopoverTrigger asChild>
          <RichEditorButton
            ref={ref}
            type="color"
            aria-label={ariaLabel}
            disabled={disabled || props.disabled}
            {...props}
          >
            <span
              className="inline-block size-4 shrink-0 rounded-full border border-black/10"
              style={{ backgroundColor: swatchColor }}
              data-slot="rich-editor-color-swatch"
              aria-hidden="true"
            />
            <ChevronDown className="opacity-60" aria-hidden="true" />
          </RichEditorButton>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} className="w-auto p-2">
          <RichEditorColorPalette
            value={colorValue}
            onChange={(key) => {
              if (key) exec(command, RICH_EDITOR_COLOR_PALETTE[key])
              onSelect?.(key)
            }}
          />
        </PopoverContent>
      </Popover>
    )
  },
)
RichEditorColorButton.displayName = 'RichEditorColorButton'

export type RichEditorColorPaletteProps = {
  value?: RichEditorColorKey | null
  onChange?: (next: RichEditorColorKey | null) => void
  className?: string
}

export function RichEditorColorPalette({ value, onChange, className }: RichEditorColorPaletteProps) {
  return (
    <div
      className={cn('flex flex-wrap items-center gap-1.5', className)}
      data-slot="rich-editor-color-palette"
      role="listbox"
      aria-label="Color palette"
    >
      {COLOR_KEYS.map((key) => {
        const isActive = value === key
        return (
          <button
            key={key}
            type="button"
            role="option"
            aria-selected={isActive}
            aria-label={key}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onChange?.(key)}
            className={cn(
              'size-5 shrink-0 rounded-full border border-black/10 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
              isActive ? 'ring-2 ring-foreground ring-offset-1' : 'hover:scale-110',
            )}
            style={{ backgroundColor: RICH_EDITOR_COLOR_PALETTE[key] }}
            data-color-key={key}
          />
        )
      })}
    </div>
  )
}

export function RichEditorDivider({ className }: { className?: string }) {
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      className={cn('mx-1 inline-block h-4 w-px shrink-0 bg-border', className)}
      data-slot="rich-editor-divider"
    />
  )
}

export type RichEditorContentProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'contentEditable' | 'children'> & {
  placeholder?: string
  minRows?: number
  disabled?: boolean
  id?: string
  name?: string
}

export const RichEditorContent = React.forwardRef<HTMLDivElement, RichEditorContentProps>(
  ({ className, placeholder, minRows = 4, disabled, onBlur, onInput, onKeyDown, onPaste, id, name, ...props }, ref) => {
    // Empty-content placeholder via CSS — content area inherits its sizing from
    // the configured minRows (assumes the line-height token resolves to 20px).
    const minHeight = `${Math.max(1, minRows) * 1.5}rem`
    return (
      <div
        ref={ref}
        contentEditable={!disabled}
        suppressContentEditableWarning
        spellCheck
        role="textbox"
        aria-multiline="true"
        data-slot="rich-editor-content"
        data-placeholder={placeholder ?? ''}
        data-name={name}
        id={id}
        className={cn(
          'prose prose-sm max-w-none w-full px-3 py-3 focus-visible:outline-none',
          'data-[placeholder]:before:pointer-events-none data-[placeholder]:empty:before:content-[attr(data-placeholder)] data-[placeholder]:empty:before:text-muted-foreground',
          className,
        )}
        style={{ minHeight }}
        onBlur={onBlur}
        onInput={onInput}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        {...props}
      />
    )
  },
)
RichEditorContent.displayName = 'RichEditorContent'

// ── Preset toolbar ────────────────────────────────────────────────────────

function RichEditorPresetItems({ variant, labels }: { variant: Exclude<RichEditorVariant, 'custom'>; labels: RichEditorLabels }) {
  const { exec, selection } = useRichEditorContext('RichEditorPresetItems')
  const onLink = React.useCallback(() => {
    const url = sanitizeRichTextHref(typeof window !== 'undefined' ? window.prompt(labels.linkUrlPrompt) : null)
    if (url) exec('createLink', url)
  }, [exec, labels.linkUrlPrompt])

  const showHeading = variant === 'full' || variant === 'standard'
  const showStrike = variant === 'full'
  const showColor = variant === 'full'
  const showOrdered = variant === 'full' || variant === 'standard' || variant === 'basic'
  const showQuoteCode = variant === 'full'
  const showLink = variant === 'full' || variant === 'standard' || variant === 'basic'
  const showLists = variant !== 'minimal'

  const headingMenu = (
    <div className="flex flex-col gap-0.5" role="menu">
      <button
        type="button"
        role="menuitem"
        className="cursor-pointer rounded px-2 py-1 text-left text-sm hover:bg-muted"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => exec('formatBlock', '<p>')}
      >
        {labels.paragraph}
      </button>
      <button
        type="button"
        role="menuitem"
        className="cursor-pointer rounded px-2 py-1 text-left text-lg font-semibold hover:bg-muted"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => exec('formatBlock', '<h1>')}
      >
        {labels.heading1}
      </button>
      <button
        type="button"
        role="menuitem"
        className="cursor-pointer rounded px-2 py-1 text-left text-base font-semibold hover:bg-muted"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => exec('formatBlock', '<h2>')}
      >
        {labels.heading2}
      </button>
      <button
        type="button"
        role="menuitem"
        className="cursor-pointer rounded px-2 py-1 text-left text-sm font-semibold hover:bg-muted"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => exec('formatBlock', '<h3>')}
      >
        {labels.heading3}
      </button>
    </div>
  )

  const headingLabel: string = (() => {
    switch (selection.heading) {
      case 'h1':
        return labels.heading1
      case 'h2':
        return labels.heading2
      case 'h3':
        return labels.heading3
      default:
        return labels.paragraph
    }
  })()

  return (
    <>
      {showHeading ? (
        <>
          <RichEditorTextDropdown ariaLabel={labels.heading} label={headingLabel} menu={headingMenu} />
          <RichEditorDivider />
        </>
      ) : null}
      <RichEditorIconButton icon={<Bold />} command="bold" ariaLabel={labels.bold} tooltipLabel={labels.bold} active={selection.bold} />
      <RichEditorIconButton icon={<Italic />} command="italic" ariaLabel={labels.italic} tooltipLabel={labels.italic} active={selection.italic} />
      <RichEditorIconButton icon={<Underline />} command="underline" ariaLabel={labels.underline} tooltipLabel={labels.underline} active={selection.underline} />
      {showStrike ? (
        <RichEditorIconButton icon={<Strikethrough />} command="strikeThrough" ariaLabel={labels.strikethrough} tooltipLabel={labels.strikethrough} active={selection.strikethrough} />
      ) : null}
      {showColor ? (
        <>
          <RichEditorDivider />
          <RichEditorColorButton ariaLabel={labels.color} />
        </>
      ) : null}
      {showLists ? (
        <>
          <RichEditorDivider />
          <RichEditorIconButton icon={<List />} command="insertUnorderedList" ariaLabel={labels.unorderedList} tooltipLabel={labels.unorderedList} active={selection.unorderedList} />
          {showOrdered ? (
            <RichEditorIconButton icon={<ListOrdered />} command="insertOrderedList" ariaLabel={labels.orderedList} tooltipLabel={labels.orderedList} active={selection.orderedList} />
          ) : null}
        </>
      ) : null}
      {showQuoteCode ? (
        <>
          <RichEditorDivider />
          <RichEditorIconButton
            icon={<Quote />}
            ariaLabel={labels.blockquote}
            tooltipLabel={labels.blockquote}
            active={selection.blockquote}
            onActivate={() => exec('formatBlock', selection.blockquote ? '<p>' : '<blockquote>')}
          />
          <RichEditorIconButton
            icon={<Code />}
            ariaLabel={labels.code}
            tooltipLabel={labels.code}
            active={selection.code}
            onActivate={() => exec('formatBlock', selection.code ? '<p>' : '<pre>')}
          />
        </>
      ) : null}
      {showLink ? (
        <>
          <RichEditorDivider />
          <RichEditorIconButton icon={<Link2 />} ariaLabel={labels.link} tooltipLabel={labels.link} onActivate={onLink} />
        </>
      ) : null}
    </>
  )
}

// Re-export the divider Minus icon symbol so consumers that want to render an
// "em-dash" placeholder for empty selections have something to import.
export { Minus as RichEditorEmDashIcon }

export { richEditorItemVariants }
