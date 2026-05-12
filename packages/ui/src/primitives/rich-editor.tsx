"use client"

import * as React from 'react'
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  AtSign,
  Bold,
  ChevronDown,
  Code,
  FileCode,
  HelpCircle,
  Image as ImageIcon,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Maximize2,
  MessageCircle,
  Minus,
  MoreVertical,
  Quote,
  Strikethrough,
  Table as TableIcon,
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './tooltip'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog'
import { Input } from './input'
import { Button } from './button'

// Figma `Rich Editor Colors [1.1]` palette (166331:4100) — 12 tokens.
// Order matches the Figma frame: gray / black / white / blue / orange / red /
// green / yellow / purple / sky / pink / teal.
export const RICH_EDITOR_COLOR_PALETTE = {
  gray: '#7b7b7b',
  black: '#171717',
  white: '#ffffff',
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
  'gray', 'black', 'white', 'blue', 'orange', 'red', 'green', 'yellow', 'purple', 'sky', 'pink', 'teal',
]

const COLOR_LABELS_EN: Record<RichEditorColorKey, string> = {
  gray: 'Gray',
  black: 'Black',
  white: 'White',
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
  /**
   * Open a DS-styled URL prompt (replaces the native `window.prompt`
   * popup). Pre-saves the current selection so the caller's `onConfirm`
   * handler can re-target the same range when running `execCommand`.
   */
  requestUrlPrompt: (request: {
    kind: 'link' | 'image'
    title: string
    placeholder?: string
    onConfirm: (url: string) => void
  }) => void
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
  checklist: string
  blockquote: string
  code: string
  inlineCode: string
  codeBlock: string
  horizontalRule: string
  image: string
  imageUrlPrompt: string
  table: string
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
  help: string
  fullscreen: string
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
  checklist: 'Checklist',
  blockquote: 'Quote',
  code: 'Code',
  inlineCode: 'Inline code',
  codeBlock: 'Code block',
  horizontalRule: 'Horizontal rule',
  image: 'Image',
  imageUrlPrompt: 'Enter image URL',
  table: 'Table',
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
  help: 'Help',
  fullscreen: 'Toggle fullscreen',
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
   * Optional handler for the fullscreen toggle. When provided, the
   * `full` variant renders the fullscreen icon button as the trailing
   * action — the caller is responsible for switching the editor into a
   * full-window layout (modal / portal / dialog).
   */
  onFullscreen?: () => void
  /**
   * Optional handler for the image insert button. When provided,
   * overrides the default `window.prompt(labels.imageUrlPrompt)` URL
   * picker so consumers can wire a file upload pipeline instead.
   */
  onImageInsert?: () => void
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
  onFullscreen,
  onImageInsert,
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
  const savedSelectionRef = React.useRef<Range | null>(null)
  const [selection, setSelection] = React.useState<SelectionState>(EMPTY_SELECTION_STATE)
  const [promptDialog, setPromptDialog] = React.useState<{
    kind: 'link' | 'image'
    title: string
    placeholder?: string
    value: string
    onConfirm: (url: string) => void
  } | null>(null)

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
        // Tell the browser to emit modern <span style="…"> output (forecolor,
        // backColor, fontSize, etc.) instead of the deprecated <font> tag —
        // the sanitizer drops <font> outright, so without this colour /
        // font-size changes silently disappear on the next blur.
        document.execCommand('styleWithCSS', false, 'true' as never)
      } catch {
        // ignore — older browsers without styleWithCSS support
      }
      try {
        document.execCommand(command, false, arg)
      } catch {
        // ignore unsupported commands
      }
      refreshSelectionState()
    },
    [disabled, refreshSelectionState],
  )

  const requestUrlPrompt = React.useCallback<RichEditorContextValue['requestUrlPrompt']>(
    (request) => {
      // Snapshot the current selection so we can restore the same range
      // after the Dialog steals focus.
      if (typeof window !== 'undefined') {
        const sel = window.getSelection()
        if (sel && sel.rangeCount > 0 && editorRef.current?.contains(sel.anchorNode)) {
          savedSelectionRef.current = sel.getRangeAt(0).cloneRange()
        } else {
          savedSelectionRef.current = null
        }
      }
      setPromptDialog({ ...request, value: '' })
    },
    [],
  )

  const ctx = React.useMemo<RichEditorContextValue>(
    () => ({ exec, selection, disabled, requestUrlPrompt }),
    [exec, selection, disabled, requestUrlPrompt],
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
    : <RichEditorPresetItems
        variant={variant}
        labels={labels}
        onComment={onComment}
        onMention={onMention}
        moreMenu={moreMenu}
        onFullscreen={onFullscreen}
        onImageInsert={onImageInsert}
      />

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
        {promptDialog !== null ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setPromptDialog(null)
          }}
        >
          <DialogContent
            className="sm:max-w-md"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && promptDialog) {
                e.preventDefault()
                const url = sanitizeRichTextHref(promptDialog.value)
                const onConfirm = promptDialog.onConfirm
                setPromptDialog(null)
                if (!url) return
                const el = editorRef.current
                const range = savedSelectionRef.current
                if (el) {
                  el.focus()
                  if (range) {
                    const sel = window.getSelection()
                    sel?.removeAllRanges()
                    sel?.addRange(range)
                  }
                }
                onConfirm(url)
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>{promptDialog?.title ?? ''}</DialogTitle>
            </DialogHeader>
            <Input
              autoFocus
              type="url"
              value={promptDialog?.value ?? ''}
              placeholder={promptDialog?.placeholder ?? 'https://…'}
              onChange={(e) => {
                const next = e.target.value
                setPromptDialog((prev) => (prev ? { ...prev, value: next } : prev))
              }}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPromptDialog(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => {
                  if (!promptDialog) return
                  const url = sanitizeRichTextHref(promptDialog.value)
                  const onConfirm = promptDialog.onConfirm
                  setPromptDialog(null)
                  if (!url) return
                  const el = editorRef.current
                  const range = savedSelectionRef.current
                  if (el) {
                    el.focus()
                    if (range) {
                      const sel = window.getSelection()
                      sel?.removeAllRanges()
                      sel?.addRange(range)
                    }
                  }
                  onConfirm(url)
                }}
              >
                OK
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        ) : null}
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
              className="inline-block size-4 shrink-0 rounded-full border border-black/10"
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
              className="size-4 shrink-0 rounded-full border border-black/10"
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

export type RichEditorMenuItemProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  /** Optional 16×16 leading icon (typically a Lucide glyph). */
  icon?: React.ReactNode
  /** Item label (also forwarded as the accessible name). */
  children: React.ReactNode
  /** Destructive variant — flips the label colour to `text-destructive`. */
  destructive?: boolean
}

/**
 * Menu item helper for `RichEditor` popovers (More `⋮` kebab, custom heading
 * menus, etc.). Renders a Figma `Profile Dropdown Items`-style row: a 16×16
 * icon slot, gap-2, full-width hover background. Use inside the `moreMenu`
 * prop of `<RichEditor>` or the `menu` prop of a compound `RichEditorTextDropdown`
 * / `RichEditorDropdownButton`.
 */
export const RichEditorMenuItem = React.forwardRef<HTMLButtonElement, RichEditorMenuItemProps>(
  ({ className, icon, children, destructive, onMouseDown, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      role="menuitem"
      onMouseDown={(e) => {
        e.preventDefault()
        onMouseDown?.(e)
      }}
      className={cn(
        'flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50',
        destructive && 'text-destructive hover:bg-destructive/10',
        className,
      )}
      data-slot="rich-editor-menu-item"
      {...props}
    >
      {icon ? (
        <span
          className="inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-4"
          data-slot="rich-editor-menu-item-icon"
          aria-hidden="true"
        >
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  ),
)
RichEditorMenuItem.displayName = 'RichEditorMenuItem'

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
          'w-full max-w-none rounded-lg border border-border bg-card px-3 py-3 text-sm leading-6 text-foreground shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
          // The project does not include `@tailwindcss/typography`, so we have to
          // re-implement the rich text rendering ourselves via descendant-arbitrary
          // selectors. Cover every tag the toolbar can produce so the user sees
          // the formatting instantly after each execCommand.
          '[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-2xl [&_h1]:font-bold',
          '[&_h2]:mt-3 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-semibold',
          '[&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-lg [&_h3]:font-semibold',
          '[&_p]:my-1',
          '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6',
          '[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6',
          '[&_li]:my-0.5',
          // Task list checklist override — when <ul data-task-list> we drop the
          // disc bullet so the <input type=checkbox> child stands alone.
          '[&_ul[data-task-list]]:list-none [&_ul[data-task-list]]:pl-0',
          '[&_ul[data-task-list]_input[type=checkbox]]:mr-2',
          '[&_blockquote]:my-2 [&_blockquote]:border-l-4 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-muted-foreground',
          '[&_pre]:my-2 [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-xs',
          '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs',
          '[&_a]:text-primary [&_a]:underline',
          '[&_hr]:my-3 [&_hr]:border-border',
          '[&_img]:my-2 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded',
          '[&_table]:my-2 [&_table]:border-collapse',
          '[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1',
          '[&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1',
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
  onFullscreen,
  onImageInsert,
}: {
  variant: Exclude<RichEditorVariant, 'custom'>
  labels: RichEditorLabels
  onComment?: () => void
  onMention?: () => void
  moreMenu?: React.ReactNode
  onFullscreen?: () => void
  onImageInsert?: () => void
}) {
  const { exec, selection, requestUrlPrompt } = useRichEditorContext('RichEditorPresetItems')
  const onLink = React.useCallback(() => {
    requestUrlPrompt({
      kind: 'link',
      title: labels.linkUrlPrompt,
      placeholder: 'https://example.com',
      onConfirm: (url) => exec('createLink', url),
    })
  }, [requestUrlPrompt, exec, labels.linkUrlPrompt])

  const onImage = React.useCallback(() => {
    if (onImageInsert) {
      onImageInsert()
      return
    }
    requestUrlPrompt({
      kind: 'image',
      title: labels.imageUrlPrompt,
      placeholder: 'https://example.com/image.png',
      onConfirm: (url) => exec('insertImage', url),
    })
  }, [requestUrlPrompt, exec, labels.imageUrlPrompt, onImageInsert])

  const onInsertTable = React.useCallback(() => {
    const html = '<table style="border-collapse:collapse;width:100%"><tbody>'
      + '<tr><td style="border:1px solid #ebebeb;padding:8px">&nbsp;</td><td style="border:1px solid #ebebeb;padding:8px">&nbsp;</td><td style="border:1px solid #ebebeb;padding:8px">&nbsp;</td></tr>'
      + '<tr><td style="border:1px solid #ebebeb;padding:8px">&nbsp;</td><td style="border:1px solid #ebebeb;padding:8px">&nbsp;</td><td style="border:1px solid #ebebeb;padding:8px">&nbsp;</td></tr>'
      + '<tr><td style="border:1px solid #ebebeb;padding:8px">&nbsp;</td><td style="border:1px solid #ebebeb;padding:8px">&nbsp;</td><td style="border:1px solid #ebebeb;padding:8px">&nbsp;</td></tr>'
      + '</tbody></table><p>&nbsp;</p>'
    exec('insertHTML', html)
  }, [exec])

  const onInsertChecklist = React.useCallback(() => {
    const html = '<ul data-task-list="true" style="list-style:none;padding-left:0">'
      + '<li><label><input type="checkbox" /> </label></li>'
      + '</ul>'
    exec('insertHTML', html)
  }, [exec])

  const onInsertInlineCode = React.useCallback(() => {
    const selectionText = typeof window !== 'undefined' ? window.getSelection()?.toString() ?? '' : ''
    if (!selectionText) {
      exec('insertHTML', '<code>&nbsp;</code>')
      return
    }
    exec('insertHTML', `<code>${selectionText}</code>`)
  }, [exec])

  const showHeading = variant === 'full' || variant === 'standard'
  const showFontSize = variant === 'full'
  const showColor = variant === 'full'
  const showStrike = variant === 'full'
  const showHr = variant === 'full'
  const showQuoteAndCode = variant === 'full'
  const showImageTable = variant === 'full'
  const showChecklist = variant === 'full'
  const showOrdered = variant === 'full' || variant === 'standard' || variant === 'basic'
  const showAlign = variant === 'full'
  const showComment = variant === 'full' && (onComment !== undefined)
  const showMention = variant === 'full' && (onMention !== undefined)
  const showMore = variant === 'full' && moreMenu !== undefined
  const showLink = variant === 'full' || variant === 'standard' || variant === 'basic'
  const showLists = variant !== 'minimal'
  const showHelp = variant === 'full'
  const showFullscreen = variant === 'full' && (onFullscreen !== undefined)

  const keyboardShortcutsHelp = (
    <div className="flex w-64 flex-col gap-1 p-1 text-sm" role="menu">
      <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Keyboard</div>
      <div className="flex items-center justify-between rounded px-2 py-1 hover:bg-muted">
        <span>{labels.bold}</span>
        <kbd className="rounded border bg-card px-1.5 py-0.5 text-xs">⌘ B</kbd>
      </div>
      <div className="flex items-center justify-between rounded px-2 py-1 hover:bg-muted">
        <span>{labels.italic}</span>
        <kbd className="rounded border bg-card px-1.5 py-0.5 text-xs">⌘ I</kbd>
      </div>
      <div className="flex items-center justify-between rounded px-2 py-1 hover:bg-muted">
        <span>{labels.underline}</span>
        <kbd className="rounded border bg-card px-1.5 py-0.5 text-xs">⌘ U</kbd>
      </div>
    </div>
  )

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
      {showHr || showQuoteAndCode ? (
        <>
          <RichEditorDivider />
          {showHr ? (
            <RichEditorIconButton
              icon={<Minus />}
              ariaLabel={labels.horizontalRule}
              tooltipLabel={labels.horizontalRule}
              onActivate={() => exec('insertHorizontalRule')}
            />
          ) : null}
          {showQuoteAndCode ? (
            <>
              <RichEditorIconButton
                icon={<Quote />}
                ariaLabel={labels.blockquote}
                tooltipLabel={labels.blockquote}
                active={selection.blockquote}
                onActivate={() => exec('formatBlock', selection.blockquote ? '<p>' : '<blockquote>')}
              />
              <RichEditorIconButton
                icon={<Code />}
                ariaLabel={labels.inlineCode}
                tooltipLabel={labels.inlineCode}
                onActivate={onInsertInlineCode}
              />
              <RichEditorIconButton
                icon={<FileCode />}
                ariaLabel={labels.codeBlock}
                tooltipLabel={labels.codeBlock}
                active={selection.code}
                onActivate={() => exec('formatBlock', selection.code ? '<p>' : '<pre>')}
              />
            </>
          ) : null}
        </>
      ) : null}
      {showImageTable ? (
        <>
          <RichEditorDivider />
          <RichEditorIconButton
            icon={<ImageIcon />}
            ariaLabel={labels.image}
            tooltipLabel={labels.image}
            onActivate={onImage}
          />
          <RichEditorIconButton
            icon={<TableIcon />}
            ariaLabel={labels.table}
            tooltipLabel={labels.table}
            onActivate={onInsertTable}
          />
        </>
      ) : null}
      {showChecklist ? (
        <RichEditorIconButton
          icon={<ListChecks />}
          ariaLabel={labels.checklist}
          tooltipLabel={labels.checklist}
          onActivate={onInsertChecklist}
        />
      ) : null}
      {showAlign ? (
        <>
          <RichEditorDivider />
          <RichEditorDropdownButton icon={<AlignActiveIcon />} ariaLabel={labels.align} menu={alignMenu} />
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
      {showHelp || showMore || showFullscreen ? (
        <>
          <RichEditorDivider />
          {showHelp ? (
            <RichEditorDropdownButton icon={<HelpCircle />} ariaLabel={labels.help} menu={keyboardShortcutsHelp} />
          ) : null}
          {showMore ? (
            <RichEditorDropdownButton icon={<MoreVertical />} ariaLabel={labels.more} menu={moreMenu} />
          ) : null}
          {showFullscreen ? (
            <RichEditorIconButton
              icon={<Maximize2 />}
              ariaLabel={labels.fullscreen}
              tooltipLabel={labels.fullscreen}
              onActivate={onFullscreen}
            />
          ) : null}
        </>
      ) : null}
    </>
  )
}

export { richEditorItemVariants }
