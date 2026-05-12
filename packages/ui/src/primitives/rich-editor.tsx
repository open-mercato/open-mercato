"use client"

import * as React from 'react'
import {
  AtSign,
  Bold,
  ChevronDown,
  Code,
  Italic,
  Link,
  List,
  ListOrdered,
  MessageCircle,
  MoreVertical,
  Strikethrough,
  Underline,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Quote,
} from 'lucide-react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@open-mercato/shared/lib/utils'
import {
  sanitizeHtmlRichText,
  sanitizeRichTextHref,
  sanitizeRichTextPasteContent,
} from '@open-mercato/ui/backend/utils/richTextSanitizer'
import { Popover, PopoverContent, PopoverTrigger } from './popover'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './tooltip'

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

const COLOR_LABELS_EN: Record<RichEditorColorKey, string> = {
  gray: 'Gray',
  blue: 'Blue',
  orange: 'Orange',
  red: 'Red',
  green: 'Green',
  yellow: 'Yellow',
  purple: 'Purple',
  sky: 'Sky',
  pink: 'Pink',
  teal: 'Teal',
}

export type RichEditorVariant = 'full' | 'standard' | 'basic' | 'minimal' | 'custom'

export type RichEditorAlign = 'left' | 'center' | 'right' | 'justify'
export type RichEditorFontSize = '12px' | '14px' | '16px' | '18px' | '20px' | '24px'

const ALIGN_ICONS: Record<RichEditorAlign, React.ComponentType<{ className?: string; 'aria-hidden'?: 'true' }>> = {
  left: AlignLeft,
  center: AlignCenter,
  right: AlignRight,
  justify: AlignJustify,
}

const FONT_SIZE_OPTIONS: RichEditorFontSize[] = ['12px', '14px', '16px', '18px', '20px', '24px']

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
  align: RichEditorAlign
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
  align: 'left',
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
  fontSize: string
  align: string
  alignLeft: string
  alignCenter: string
  alignRight: string
  alignJustify: string
  comment: string
  mention: string
  more: string
  placeholder: string
  colors: Record<RichEditorColorKey, string>
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
  heading: 'Header',
  heading1: 'Heading 1',
  heading2: 'Heading 2',
  heading3: 'Heading 3',
  paragraph: 'Paragraph',
  link: 'Link',
  linkUrlPrompt: 'Enter URL',
  color: 'Text color',
  textColor: 'Color',
  fontSize: 'Font size',
  align: 'Align',
  alignLeft: 'Align left',
  alignCenter: 'Align center',
  alignRight: 'Align right',
  alignJustify: 'Justify',
  comment: 'Add comment',
  mention: 'Mention',
  more: 'More',
  placeholder: 'Placeholder text...',
  colors: COLOR_LABELS_EN,
}

export type RichEditorProps = {
  /** HTML string value (sanitized by `sanitizeHtmlRichText`). */
  value?: string
  /** Called with sanitized HTML on blur. */
  onChange: (html: string) => void
  /**
   * Toolbar preset:
   * - `'full'`     — Figma 166331:4006 reference: heading + font size + color + B/I/U/S + lists + align + comment + link + mention + more
   * - `'standard'` — heading + bold/italic/underline + lists + link (CrudForm `editor='html'` default)
   * - `'basic'`    — bold/italic/underline + bullet list + link
   * - `'minimal'`  — bold/italic/underline
   * - `'custom'`   — render `<RichEditorToolbar>{...}</RichEditorToolbar>` + `<RichEditorContent />` children manually
   */
  variant?: RichEditorVariant
  placeholder?: string
  minRows?: number
  disabled?: boolean
  className?: string
  contentClassName?: string
  labels?: Partial<RichEditorLabels>
  /** Optional handler for the comment button (only rendered in `full` variant). */
  onComment?: () => void
  /** Optional handler for the mention `@` button. */
  onMention?: () => void
  /** Optional menu rendered inside the More `⋮` dropdown popover. */
  moreMenu?: React.ReactNode
  /**
   * Optional max length for the rich text content. When provided, renders a
   * `<currentLength>/<maxLength>` counter in the bottom-right corner of the
   * content card (Figma 166331:6589 reference). Counts the plaintext length
   * of the sanitized HTML so users see a meaningful character budget.
   */
  maxLength?: number
  children?: React.ReactNode
  id?: string
  name?: string
  'aria-invalid'?: boolean | 'true' | 'false'
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
    const align: RichEditorAlign = document.queryCommandState('justifyCenter')
      ? 'center'
      : document.queryCommandState('justifyRight')
        ? 'right'
        : document.queryCommandState('justifyFull')
          ? 'justify'
          : 'left'
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
      align,
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
  onComment,
  onMention,
  moreMenu,
  maxLength,
  children,
  id,
  name,
  'aria-invalid': ariaInvalid,
}: RichEditorProps) {
  const labels = React.useMemo<RichEditorLabels>(
    () => ({
      ...DEFAULT_LABELS,
      ...(labelsProp ?? {}),
      colors: { ...DEFAULT_LABELS.colors, ...(labelsProp?.colors ?? {}) },
    }),
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

  const toolbarContent = variant === 'custom'
    ? null
    : <RichEditorPresetItems variant={variant} labels={labels} onComment={onComment} onMention={onMention} moreMenu={moreMenu} />

  const plaintextLength = React.useMemo(() => {
    if (!maxLength) return 0
    if (typeof document === 'undefined') return 0
    const tmp = document.createElement('div')
    tmp.innerHTML = sanitizeHtmlRichText(value)
    return (tmp.textContent ?? '').length
  }, [value, maxLength])

  return (
    <RichEditorContext.Provider value={ctx}>
      <TooltipProvider delayDuration={400}>
        <div
          className={cn('w-full space-y-2', disabled && 'opacity-60', className)}
          data-slot="rich-editor"
          data-disabled={disabled ? 'true' : 'false'}
          aria-invalid={ariaInvalid}
        >
          {variant === 'custom'
            ? children
            : (
              <>
                <RichEditorToolbar>{toolbarContent}</RichEditorToolbar>
                <div className="relative">
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
                  {maxLength ? (
                    <span
                      className={cn(
                        'pointer-events-none absolute bottom-2 right-3 select-none text-xs leading-4 text-muted-foreground',
                        plaintextLength > maxLength && 'text-destructive',
                      )}
                      data-slot="rich-editor-counter"
                      aria-live="polite"
                    >
                      {plaintextLength}/{maxLength}
                    </span>
                  ) : null}
                </div>
              </>
            )}
        </div>
      </TooltipProvider>
    </RichEditorContext.Provider>
  )
}, (prev, next) =>
  prev.value === next.value &&
  prev.disabled === next.disabled &&
  prev.variant === next.variant &&
  prev.maxLength === next.maxLength,
)
RichEditor.displayName = 'RichEditor'

export type RichEditorToolbarProps = React.HTMLAttributes<HTMLDivElement>

export const RichEditorToolbar = React.forwardRef<HTMLDivElement, RichEditorToolbarProps>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      role="toolbar"
      aria-label="Rich text formatting"
      className={cn(
        // Figma 166331:4006 reference: standalone card with rounded-8 + border + shadow-xs.
        // 2px outer padding, 2px gap between items.
        'flex w-fit max-w-full flex-wrap items-center gap-0.5 overflow-x-auto rounded-lg border border-border bg-card p-0.5 shadow-xs',
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
  // Figma Rich Editor Items (166251 family): 28×h, rounded-6, bg-white default,
  // bg-weak-50 (= bg-muted token) on hover, on toggle-active (data-active=true,
  // e.g. Bold inside a bold selection), and on dropdown-open
  // (data-state=open from Radix PopoverTrigger). Text / icon colours move from
  // sub-600 (= text-muted-foreground, #5c5c5c) in the default state to
  // strong-950 (= text-foreground, #171717) in the active / open states per
  // Figma 166261:22214 / 166261:22217 reference cells.
  'group/rich-editor-item inline-flex h-7 shrink-0 items-center justify-center rounded-md bg-transparent text-sm font-medium leading-5 text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-40 data-[active=true]:bg-muted data-[active=true]:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground',
  {
    variants: {
      type: {
        // Figma 166251:2698 — pl-[10px] pr-[4px] py-[4px], gap-[2px].
        text: 'min-w-0 gap-0.5 pl-2.5 pr-1 py-1 tracking-[-0.084px] [&_svg]:size-4',
        // Figma 166251:2700 — square icon button p-[4px].
        icon: 'aspect-square p-1 [&_svg]:size-4',
        // Figma 166251:3337 — icon + caret p-[4px] gap-[2px].
        dropdown: 'gap-0.5 p-1 [&_svg]:size-4',
        // Figma 166331:4437 — color swatch + caret pl-[8px] pr-[4px] py-[4px].
        color: 'gap-0.5 pl-2 pr-1 py-1 [&_svg]:size-4',
      },
    },
    defaultVariants: { type: 'icon' },
  },
)

type ToolbarButtonBaseProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'children'> &
  VariantProps<typeof richEditorItemVariants> & {
    active?: boolean
    tooltipLabel?: string
  }

const RichEditorButton = React.forwardRef<HTMLButtonElement, ToolbarButtonBaseProps & { children?: React.ReactNode }>(
  ({ className, type, active, tooltipLabel, children, onMouseDown, ...props }, ref) => {
    const button = (
      <button
        ref={ref}
        type="button"
        onMouseDown={(e) => {
          e.preventDefault()
          onMouseDown?.(e)
        }}
        data-active={active ? 'true' : 'false'}
        aria-pressed={active}
        className={cn(richEditorItemVariants({ type }), className)}
        {...props}
      >
        {children}
      </button>
    )
    // Wrap in DS Tooltip when tooltipLabel is provided — matches Figma
    // 166331:4027 (dark rounded popover above the trigger).
    if (!tooltipLabel) return button
    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="top" sideOffset={6}>{tooltipLabel}</TooltipContent>
      </Tooltip>
    )
  },
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
  ariaLabel: string
  menu?: React.ReactNode
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
        <ChevronDown className="opacity-60 transition-transform group-data-[state=open]/rich-editor-item:rotate-180" aria-hidden="true" />
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
            <ChevronDown className="opacity-60 transition-transform group-data-[state=open]/rich-editor-item:rotate-180" aria-hidden="true" />
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
  command?: string
  onSelect?: (color: RichEditorColorKey | null) => void
  /** Optional translated labels per palette key (defaults to English names). */
  colorLabels?: Partial<Record<RichEditorColorKey, string>>
  /**
   * Restrict the popover palette to a subset of colour keys. Defaults to all
   * 10 colours from the Figma `Rich Editor Colors [1.1]` master frame
   * (166331:4100); pass a 5-key subset for the compact popover variant seen
   * in some Figma mockups.
   */
  palette?: RichEditorColorKey[]
}

export const RichEditorColorButton = React.forwardRef<HTMLButtonElement, RichEditorColorButtonProps>(
  ({ colorValue, ariaLabel, command = 'foreColor', onSelect, colorLabels, palette = COLOR_KEYS, ...props }, ref) => {
    const { exec, disabled } = useRichEditorContext('RichEditorColorButton')
    const swatchColor = colorValue ? RICH_EDITOR_COLOR_PALETTE[colorValue] : RICH_EDITOR_COLOR_PALETTE.blue
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
              className="inline-block size-4 shrink-0 rounded-full"
              style={{ backgroundColor: swatchColor }}
              data-slot="rich-editor-color-swatch"
              aria-hidden="true"
            />
            <ChevronDown className="opacity-60 transition-transform group-data-[state=open]/rich-editor-item:rotate-180" aria-hidden="true" />
          </RichEditorButton>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} className="w-36 p-1">
          <RichEditorColorPalette
            value={colorValue}
            labels={colorLabels}
            palette={palette}
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
  /** Translatable labels per palette key (defaults to English). */
  labels?: Partial<Record<RichEditorColorKey, string>>
  /**
   * Restrict the palette to a subset of colour keys (defaults to all 10). Use
   * the same subset list on `RichEditorColorButton` and standalone palette
   * popovers so the trigger swatch and the popover stay in sync.
   */
  palette?: RichEditorColorKey[]
  className?: string
}

export function RichEditorColorPalette({ value, onChange, labels, palette, className }: RichEditorColorPaletteProps) {
  const resolvedLabels = { ...COLOR_LABELS_EN, ...(labels ?? {}) }
  const keys = palette && palette.length > 0 ? palette : COLOR_KEYS
  return (
    <div
      className={cn('flex flex-col gap-0.5', className)}
      data-slot="rich-editor-color-palette"
      role="listbox"
      aria-label="Color palette"
    >
      {keys.map((key) => {
        const isActive = value === key
        return (
          <button
            key={key}
            type="button"
            role="option"
            aria-selected={isActive}
            aria-label={resolvedLabels[key]}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onChange?.(key)}
            className={cn(
              'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
              isActive && 'font-medium text-foreground',
            )}
            data-color-key={key}
          >
            <span
              className="size-4 shrink-0 rounded-full"
              style={{ backgroundColor: RICH_EDITOR_COLOR_PALETTE[key] }}
              aria-hidden="true"
            />
            <span className="truncate">{resolvedLabels[key]}</span>
          </button>
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
      // Figma 166416:52475 — 4×16 container, 1px line. Toolbar `gap-0.5`
      // already provides the surrounding 2px gap on each side, so the divider
      // itself only carries the 1px line + 1.5px horizontal padding (mx-px).
      className={cn('mx-px inline-block h-4 w-px shrink-0 bg-border', className)}
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
          // Figma reference: content lives in its own bordered card with rounded-8 + shadow-xs,
          // visually separated from the toolbar by the small vertical gap from the parent
          // wrapper's `space-y-2`.
          'prose prose-sm w-full max-w-none rounded-lg border border-border bg-card px-3 py-3 text-sm leading-6 text-foreground shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
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

function RichEditorPresetItems({
  variant,
  labels,
  onComment,
  onMention,
  moreMenu,
}: {
  variant: Exclude<RichEditorVariant, 'custom'>
  labels: RichEditorLabels
  onComment?: () => void
  onMention?: () => void
  moreMenu?: React.ReactNode
}) {
  const { exec, selection } = useRichEditorContext('RichEditorPresetItems')
  const onLink = React.useCallback(() => {
    const url = sanitizeRichTextHref(typeof window !== 'undefined' ? window.prompt(labels.linkUrlPrompt) : null)
    if (url) exec('createLink', url)
  }, [exec, labels.linkUrlPrompt])

  const showHeading = variant === 'full' || variant === 'standard'
  const showFontSize = variant === 'full'
  const showColor = variant === 'full'
  const showStrike = variant === 'full'
  const showOrdered = variant === 'full' || variant === 'standard' || variant === 'basic'
  const showAlign = variant === 'full'
  const showComment = variant === 'full' && (onComment !== undefined)
  const showMention = variant === 'full' && (onMention !== undefined)
  const showMore = variant === 'full' && moreMenu !== undefined
  const showQuoteCode = variant === 'full' && !showAlign
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
        return labels.heading
    }
  })()

  const fontSizeMenu = (
    <div className="flex flex-col gap-0.5" role="menu">
      {FONT_SIZE_OPTIONS.map((size) => (
        <button
          key={size}
          type="button"
          role="menuitem"
          className="cursor-pointer rounded px-2 py-1 text-left text-sm hover:bg-muted"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            // execCommand('fontSize', …) requires 1–7 — translate the px label
            // through a CSS-driven span instead.
            exec('removeFormat')
            const px = parseInt(size, 10)
            if (px > 0) {
              exec('insertHTML', `<span style="font-size:${px}px">${window.getSelection()?.toString() ?? ''}</span>`)
            }
          }}
        >
          {size}
        </button>
      ))}
    </div>
  )

  const alignMenu = (
    <div className="flex flex-col gap-0.5" role="menu">
      {(['left', 'center', 'right', 'justify'] as RichEditorAlign[]).map((option) => {
        const Icon = ALIGN_ICONS[option]
        const command = option === 'justify' ? 'justifyFull' : `justify${option[0].toUpperCase()}${option.slice(1)}`
        const label = option === 'left'
          ? labels.alignLeft
          : option === 'center'
            ? labels.alignCenter
            : option === 'right'
              ? labels.alignRight
              : labels.alignJustify
        return (
          <button
            key={option}
            type="button"
            role="menuitem"
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-muted"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => exec(command)}
          >
            <Icon className="size-4" aria-hidden="true" />
            <span>{label}</span>
          </button>
        )
      })}
    </div>
  )

  const AlignActiveIcon = ALIGN_ICONS[selection.align]

  return (
    <>
      {showHeading ? (
        <>
          <RichEditorTextDropdown ariaLabel={labels.heading} label={headingLabel} menu={headingMenu} />
          <RichEditorDivider />
        </>
      ) : null}
      {showFontSize ? (
        <>
          <RichEditorTextDropdown ariaLabel={labels.fontSize} label="14px" menu={fontSizeMenu} />
          <RichEditorDivider />
        </>
      ) : null}
      {showColor ? (
        <>
          <RichEditorColorButton ariaLabel={labels.color} colorLabels={labels.colors} />
          <RichEditorDivider />
        </>
      ) : null}
      <RichEditorIconButton icon={<Bold />} command="bold" ariaLabel={labels.bold} tooltipLabel={labels.bold} active={selection.bold} />
      <RichEditorIconButton icon={<Italic />} command="italic" ariaLabel={labels.italic} tooltipLabel={labels.italic} active={selection.italic} />
      <RichEditorIconButton icon={<Underline />} command="underline" ariaLabel={labels.underline} tooltipLabel={labels.underline} active={selection.underline} />
      {showStrike ? (
        <RichEditorIconButton icon={<Strikethrough />} command="strikeThrough" ariaLabel={labels.strikethrough} tooltipLabel={labels.strikethrough} active={selection.strikethrough} />
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
      {showAlign ? (
        <>
          <RichEditorDivider />
          <RichEditorDropdownButton icon={<AlignActiveIcon />} ariaLabel={labels.align} menu={alignMenu} />
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
      {(showLink || showComment || showMention) ? <RichEditorDivider /> : null}
      {showComment ? (
        <RichEditorIconButton icon={<MessageCircle />} ariaLabel={labels.comment} tooltipLabel={labels.comment} onActivate={onComment} />
      ) : null}
      {showLink ? (
        <RichEditorIconButton icon={<Link />} ariaLabel={labels.link} tooltipLabel={labels.link} onActivate={onLink} />
      ) : null}
      {showMention ? (
        <RichEditorIconButton icon={<AtSign />} ariaLabel={labels.mention} tooltipLabel={labels.mention} onActivate={onMention} />
      ) : null}
      {showMore ? (
        <>
          <RichEditorDivider />
          <RichEditorDropdownButton icon={<MoreVertical />} ariaLabel={labels.more} menu={moreMenu} />
        </>
      ) : null}
    </>
  )
}

export { richEditorItemVariants }
