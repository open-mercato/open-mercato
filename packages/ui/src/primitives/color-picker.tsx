"use client"

import * as React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { Pipette, Plus, Trash2 } from 'lucide-react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'

// Local types for the experimental EyeDropper API (no DOM lib coverage yet).
interface EyeDropperResult { sRGBHex: string }
interface EyeDropperAPI { open(): Promise<EyeDropperResult> }
interface WindowWithEyeDropper extends Window { EyeDropper?: new () => EyeDropperAPI }

/**
 * Color picker per Figma `Color Picker` frame (DS Open Mercato
 * `167184:38583`, doc page `553:22078`). 4-section layout 316×334:
 *
 *   1. Choose Color  — header row ("Choose color" label + hex preview
 *                       on the right) + a single pill hue slider
 *                       (gradient rainbow, draggable white thumb).
 *   2. Input         — hex input field + eyedropper button (Sip).
 *   3. Saved Colors  — title + row of swatch dots (24×24, rounded-full).
 *   4. Action        — "+ Add new color" footer button (optional).
 *
 * No 2D HSV spectrum, no opacity slider, no format dropdown — those
 * belong to a heavier picker layout that's not in this DS source.
 * Implementation is vanilla (no `react-colorful`): hue is a native
 * `<input type="range">` styled as a gradient pill, hex → RGB → HSL
 * conversion done inline so we can keep dependencies minimal.
 *
 * ```tsx
 * const [color, setColor] = React.useState('#6366F1')
 *
 * // Basic
 * <ColorPicker value={color} onChange={setColor} />
 *
 * // Saved-colors editor (user can append the current color)
 * const [swatches, setSwatches] = React.useState<string[]>([])
 * <ColorPicker
 *   value={color}
 *   onChange={setColor}
 *   swatches={swatches}
 *   onAddSwatch={(c) => setSwatches([...swatches, c])}
 * />
 *
 * // Locked palette — no hex input, no add button
 * <ColorPicker
 *   value={color}
 *   onChange={setColor}
 *   swatches={['#22C55E', '#F59E0B', '#EF4343']}
 *   allowCustom={false}
 * />
 * ```
 */

/**
 * Default swatch list anchored on the Figma `Color Dots [1.1]`
 * component set (DS OM `3365:22464`) — 10 brand-curated colors that
 * also drive the Tag colors. Kept inline so the primitive ships with
 * a sensible default; consumers can override via `swatches`.
 */
export const COLOR_PICKER_DEFAULT_SWATCHES: readonly string[] = [
  '#71777C', // Gray
  '#6366F1', // Blue (= DS OM accent-indigo)
  '#F59E0B', // Orange
  '#EF4343', // Red
  '#22C55E', // Green
  '#F6B51E', // Yellow (= Rating amber)
  '#7D52F3', // Purple
  '#47C2FF', // Sky
  '#FB4BA3', // Pink
  '#22D3BB', // Teal
]

const HEX_PATTERN_3 = /^#?[0-9a-fA-F]{3}$/
const HEX_PATTERN_6 = /^#?[0-9a-fA-F]{6}$/

export function normalizeHex(input: string): string | null {
  const trimmed = input.trim()
  if (HEX_PATTERN_6.test(trimmed)) {
    return ('#' + trimmed.replace(/^#/, '')).toUpperCase()
  }
  if (HEX_PATTERN_3.test(trimmed)) {
    const stripped = trimmed.replace(/^#/, '')
    return ('#' + stripped[0] + stripped[0] + stripped[1] + stripped[1] + stripped[2] + stripped[2]).toUpperCase()
  }
  return null
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = normalizeHex(hex)
  if (!normalized) return null
  const stripped = normalized.replace(/^#/, '')
  return {
    r: parseInt(stripped.slice(0, 2), 16),
    g: parseInt(stripped.slice(2, 4), 16),
    b: parseInt(stripped.slice(4, 6), 16),
  }
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rN = r / 255
  const gN = g / 255
  const bN = b / 255
  const max = Math.max(rN, gN, bN)
  const min = Math.min(rN, gN, bN)
  const delta = max - min
  let h = 0
  let s = 0
  const l = (max + min) / 2
  if (delta !== 0) {
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min)
    if (max === rN) h = ((gN - bN) / delta + (gN < bN ? 6 : 0))
    else if (max === gN) h = (bN - rN) / delta + 2
    else h = (rN - gN) / delta + 4
    h /= 6
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) }
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const sN = s / 100
  const lN = l / 100
  const k = (n: number) => (n + h / 30) % 12
  const a = sN * Math.min(lN, 1 - lN)
  const f = (n: number) => lN - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return {
    r: Math.round(255 * f(0)),
    g: Math.round(255 * f(8)),
    b: Math.round(255 * f(4)),
  }
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  )
}

/**
 * Extract a pure-hue degree (0..360) from a hex color, ignoring its
 * saturation / lightness. Used to position the hue-slider thumb when
 * the controlled `value` changes via swatch click or hex input.
 */
function hexToHueDegrees(hex: string): number {
  const rgb = hexToRgb(hex)
  if (!rgb) return 0
  return rgbToHsl(rgb.r, rgb.g, rgb.b).h
}

const triggerVariants = cva(
  'inline-flex items-center gap-2 rounded-md border border-input bg-background px-2.5 py-1.5 text-sm shadow-xs outline-none transition-colors ' +
    'hover:bg-muted/40 ' +
    'focus-visible:shadow-focus ' +
    'disabled:cursor-not-allowed disabled:opacity-60',
  {
    variants: {
      size: {
        sm: 'h-8',
        default: 'h-9',
      },
    },
    defaultVariants: { size: 'default' },
  },
)

const swatchVariants = cva(
  'inline-flex size-6 items-center justify-center rounded-full outline-none ' +
    'focus-visible:shadow-focus ' +
    'disabled:cursor-not-allowed disabled:opacity-50',
)

const swatchDotVariants = cva(
  // Subtle hairline border keeps very-light / white swatches visible on
  // a white popover background. The Figma `Color Dots [1.1]` ellipse
  // does NOT carry a border by default (only on Selected, via an inset
  // white stroke), but in practice palettes routinely include #FFFFFF
  // and other near-white values that vanish without a 1px outline.
  // We use `border-foreground/10` so the outline stays invisible on
  // saturated colors and only "appears" on light values.
  'inline-block size-4 rounded-full border border-foreground/10 transition-transform ' +
    'group-enabled/swatch:group-hover/swatch:scale-[0.875]',
  {
    variants: {
      selected: {
        true: 'ring-2 ring-inset ring-background',
        false: '',
      },
    },
    defaultVariants: { selected: false },
  },
)

export type ColorPickerProps = Omit<
  React.HTMLAttributes<HTMLButtonElement>,
  'value' | 'onChange'
> &
  VariantProps<typeof triggerVariants> & {
    /** Current selected color, `#RRGGBB`. */
    value: string
    /** Fired when the user picks a swatch, drags the hue slider, or
     *  commits a hex input. */
    onChange: (next: string) => void
    /** Optional palette ("Saved colors" row). When provided, the primitive
     *  runs in **controlled mode** — the consumer owns the list. When
     *  omitted (and `persistKey` is also absent) the primitive falls back
     *  to `COLOR_PICKER_DEFAULT_SWATCHES` read-only. */
    swatches?: readonly string[]
    /** Initial palette for the uncontrolled / persisted mode. Used when
     *  `swatches` is omitted. Defaults to `COLOR_PICKER_DEFAULT_SWATCHES`. */
    defaultSwatches?: readonly string[]
    /** When set, the primitive switches to **persisted mode**: hydrates
     *  the swatch list from `localStorage[persistKey]` on mount, and
     *  auto-saves after every `onAddSwatch` / `onRemoveColor`. Pair with
     *  no `swatches` prop. The "+ Add new color" footer and trash button
     *  render automatically when `persistKey` is provided (no need to
     *  wire `onAddSwatch` / `onRemoveColor` callbacks for the buttons to
     *  appear — they still fire as notification callbacks). */
    persistKey?: string
    /** Optional callback for the "+ Add new color" footer button. When
     *  omitted, the button is hidden — unless `persistKey` is set, in
     *  which case the primitive renders + handles the button itself. */
    onAddSwatch?: (next: string) => void
    /** Allow free-form hex input. Default `true`. */
    allowCustom?: boolean
    /** Block the popover when true; trigger dims. */
    disabled?: boolean
    /** Optional label for screen readers. */
    'aria-label'?: string
    /** Show the eyedropper button in the input row. Default `true`. The
     *  button auto-hides when `window.EyeDropper` is unavailable. */
    enableEyedropper?: boolean
    /** Optional callback. When provided, renders a trash icon button
     *  after the hex container; click fires with the current value
     *  (consumer decides whether to remove from `swatches`, clear the
     *  field, or otherwise act). */
    onRemoveColor?: (current: string) => void
    /** Optional callback. When provided, renders an "Edit" link button
     *  at the right of the "Saved colors" header. Click fires this
     *  callback so the consumer can open a separate management UI. */
    onEditSavedColors?: () => void
    /** Show an opacity percentage badge inside the hex container.
     *  Default `false`. v5 always shows 100% — surface kept for
     *  forward-compatibility with an alpha-aware follow-up release. */
    showOpacity?: boolean
    /** Section title above the hue slider. Default `"Choose color"`. */
    chooseLabel?: string
    /** Section title above the swatch row. Default `"Saved colors"`. */
    savedLabel?: string
    /** Label for the "+ Add new color" footer. Default `"Add new color"`. */
    addLabel?: string
    /** Label for the "Edit" link in the saved-colors header. Default `"Edit"`. */
    editLabel?: string
    /** ARIA label for the trash button. Default `"Remove color"`. */
    removeAriaLabel?: string
  }

export const ColorPicker = React.forwardRef<HTMLButtonElement, ColorPickerProps>(
  (
    {
      className,
      value,
      onChange,
      swatches: swatchesProp,
      defaultSwatches,
      persistKey,
      onAddSwatch,
      allowCustom = true,
      size,
      disabled,
      enableEyedropper = true,
      onRemoveColor,
      onEditSavedColors,
      showOpacity = false,
      chooseLabel = 'Choose color',
      savedLabel = 'Saved colors',
      addLabel = 'Add new color',
      editLabel = 'Edit',
      removeAriaLabel = 'Remove color',
      ...props
    },
    ref,
  ) => {
    const t = useT()
    const normalizedValue = React.useMemo(() => normalizeHex(value) ?? value, [value])
    const [hexInput, setHexInput] = React.useState(normalizedValue)
    const [hexError, setHexError] = React.useState<string | null>(null)
    const [open, setOpen] = React.useState(false)
    const [eyedropperSupported, setEyedropperSupported] = React.useState(false)

    // Swatches state cascade:
    //   1. `swatches` prop  → controlled, primitive never mutates the list.
    //   2. `persistKey` set → uncontrolled + auto-save to localStorage.
    //   3. otherwise        → uncontrolled in-memory only (lost on remount).
    const initialUncontrolled = React.useMemo(
      () => [...(defaultSwatches ?? COLOR_PICKER_DEFAULT_SWATCHES)],
      [defaultSwatches],
    )
    const [internalSwatches, setInternalSwatches] = React.useState<string[]>(initialUncontrolled)

    // Hydrate from localStorage on mount when persistKey is set. We do this
    // in an effect (not initialState) so SSR rendering matches the initial
    // hydration pass — otherwise React warns about mismatched output.
    React.useEffect(() => {
      if (!persistKey || typeof window === 'undefined') return
      try {
        const raw = window.localStorage.getItem(persistKey)
        if (!raw) return
        const parsed = JSON.parse(raw)
        if (
          Array.isArray(parsed) &&
          parsed.every((c) => typeof c === 'string' && normalizeHex(c) !== null)
        ) {
          setInternalSwatches(parsed.map((c) => normalizeHex(c) as string))
        }
      } catch {
        // Corrupt JSON or storage disabled — fall through to the in-memory
        // default. No-op, no flash to user.
      }
    }, [persistKey])

    const isControlled = swatchesProp !== undefined
    const effectiveSwatches = isControlled ? swatchesProp! : internalSwatches

    const persistSwatches = React.useCallback(
      (next: string[]) => {
        if (!persistKey || typeof window === 'undefined') return
        try {
          window.localStorage.setItem(persistKey, JSON.stringify(next))
        } catch {
          // Storage quota exceeded or disabled — silent no-op.
        }
      },
      [persistKey],
    )

    const handleAddSwatch = React.useCallback(
      (color: string) => {
        const normalized = normalizeHex(color) ?? color
        if (!isControlled) {
          setInternalSwatches((prev) => {
            if (prev.some((c) => c.toUpperCase() === normalized.toUpperCase())) return prev
            const next = [...prev, normalized]
            persistSwatches(next)
            return next
          })
        }
        onAddSwatch?.(normalized)
      },
      [isControlled, persistSwatches, onAddSwatch],
    )

    const handleRemoveColor = React.useCallback(
      (color: string) => {
        const normalized = normalizeHex(color) ?? color
        if (!isControlled) {
          setInternalSwatches((prev) => {
            const next = prev.filter((c) => c.toUpperCase() !== normalized.toUpperCase())
            persistSwatches(next)
            return next
          })
        }
        onRemoveColor?.(normalized)
      },
      [isControlled, persistSwatches, onRemoveColor],
    )

    // Auto-render the add + trash buttons when persistKey is set, even if
    // the consumer omitted the callbacks. The primitive owns the list in
    // that mode, so the callbacks are purely "notification" channels.
    const showAddButton = Boolean(onAddSwatch) || Boolean(persistKey)
    const showRemoveButton = Boolean(onRemoveColor) || Boolean(persistKey)

    React.useEffect(() => {
      if (typeof window === 'undefined') return
      setEyedropperSupported(typeof (window as WindowWithEyeDropper).EyeDropper === 'function')
    }, [])

    React.useEffect(() => {
      if (!open) {
        setHexInput(normalizedValue)
        setHexError(null)
      }
    }, [normalizedValue, open])

    const commitHex = React.useCallback(
      (raw: string) => {
        const next = normalizeHex(raw)
        if (next === null) {
          setHexError(t('ui.colorPicker.error.invalidHex', 'Invalid hex'))
          return
        }
        setHexError(null)
        setHexInput(next)
        if (next !== normalizedValue) onChange(next)
      },
      [normalizedValue, onChange, t],
    )

    const handleHueChange = React.useCallback(
      (hueDeg: number) => {
        // Pure saturated color at the picked hue (s=100%, l=50%).
        const rgb = hslToRgb(hueDeg, 100, 50)
        onChange(rgbToHex(rgb.r, rgb.g, rgb.b))
      },
      [onChange],
    )

    const handleEyedropper = React.useCallback(async () => {
      if (!eyedropperSupported) return
      const Ctor = (window as WindowWithEyeDropper).EyeDropper
      if (!Ctor) return
      try {
        const dropper = new Ctor()
        const result = await dropper.open()
        if (result && typeof result.sRGBHex === 'string') {
          const next = normalizeHex(result.sRGBHex)
          if (next) onChange(next)
        }
      } catch {
        // User cancelled — no-op.
      }
    }, [eyedropperSupported, onChange])

    const currentHue = React.useMemo(() => hexToHueDegrees(normalizedValue), [normalizedValue])

    return (
      <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
        <PopoverPrimitive.Trigger asChild>
          <button
            ref={ref}
            type="button"
            disabled={disabled}
            data-slot="color-picker-trigger"
            className={cn(triggerVariants({ size }), className)}
            {...props}
          >
            <span
              data-slot="color-picker-preview"
              aria-hidden="true"
              className="inline-block size-4 shrink-0 rounded-full border border-border/30"
              style={{ backgroundColor: normalizedValue }}
            />
            <span className="font-mono uppercase tracking-tight">{normalizedValue}</span>
          </button>
        </PopoverPrimitive.Trigger>

        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            sideOffset={6}
            align="start"
            data-slot="color-picker-popover"
            className={cn(
              'z-popover w-80 rounded-xl border border-input bg-popover p-0 text-popover-foreground shadow-md outline-none',
              'data-[state=open]:animate-in data-[state=closed]:animate-out',
              'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            )}
          >
            {/* Section 1 — Choose color */}
            <div
              data-slot="color-picker-section-choose"
              className="space-y-2.5 px-5 pt-4 pb-5"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{chooseLabel}</span>
                <span className="font-mono text-xs uppercase tracking-tight text-muted-foreground/80">
                  {normalizedValue}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={360}
                step={1}
                value={currentHue}
                disabled={disabled}
                onChange={(event) => handleHueChange(Number(event.target.value))}
                data-slot="color-picker-hue-slider"
                aria-label={`${chooseLabel} hue`}
                className={cn(
                  'block h-3 w-full cursor-pointer appearance-none rounded-full outline-none',
                  // Native range styling. The track is the gradient itself.
                  '[background-image:linear-gradient(to_right,hsl(0,100%,50%),hsl(60,100%,50%),hsl(120,100%,50%),hsl(180,100%,50%),hsl(240,100%,50%),hsl(300,100%,50%),hsl(360,100%,50%))]',
                  // Thumb: small white pill with shadow per Figma.
                  '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-background [&::-webkit-slider-thumb]:shadow-sm',
                  '[&::-moz-range-thumb]:size-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-background [&::-moz-range-thumb]:shadow-sm',
                  'focus-visible:shadow-focus',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                )}
              />
            </div>

            <div className="h-px w-full bg-border/60" aria-hidden="true" />

            {/* Section 2 — Hex input row.
             *
             * Layout matches Figma `Color Picker` frame 167184:38583 § 2:
             *
             *   [● colored-bullet] [#HEX text] [opacity %?]   (container)
             *   [eyedropper]?
             *   [trash]?
             *
             * The bullet, hex field, and optional opacity badge live
             * INSIDE the rounded container. Eyedropper + trash render
             * as separate icon buttons after the container.
             */}
            {allowCustom ? (
              <div
                data-slot="color-picker-section-input"
                className="flex w-full min-w-0 items-center gap-2.5 px-5 py-4"
              >
                <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-background px-2 shadow-xs">
                  <span
                    aria-hidden="true"
                    data-slot="color-picker-current-dot"
                    className="inline-block size-4 shrink-0 rounded-full border border-foreground/10"
                    style={{ backgroundColor: normalizedValue }}
                  />
                  <input
                    type="text"
                    data-slot="color-picker-hex"
                    value={hexInput}
                    onChange={(event) => {
                      setHexInput(event.target.value)
                      setHexError(null)
                    }}
                    onBlur={(event) => commitHex(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        commitHex(event.currentTarget.value)
                      } else if (event.key === 'Escape') {
                        event.preventDefault()
                        setHexInput(normalizedValue)
                        setHexError(null)
                        setOpen(false)
                      }
                    }}
                    className={cn(
                      'h-full min-w-0 flex-1 bg-transparent font-mono text-sm uppercase tracking-tight outline-none',
                      'placeholder:text-muted-foreground',
                      hexError && 'text-destructive',
                    )}
                  />
                  {showOpacity ? (
                    <span
                      data-slot="color-picker-opacity"
                      aria-hidden="true"
                      className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums"
                    >
                      100%
                    </span>
                  ) : null}
                </div>
                {/* Eyedropper and trash are mutually exclusive — Figma
                 *  section 2 renders ONE button on the right (trash).
                 *  When the consumer wires `onRemoveColor`, the
                 *  eyedropper steps aside so we stay 1:1 with the
                 *  Figma layout. */}
                {!showRemoveButton && enableEyedropper && eyedropperSupported ? (
                  <button
                    type="button"
                    onClick={handleEyedropper}
                    data-slot="color-picker-eyedropper"
                    aria-label={t('ui.colorPicker.eyedropper.ariaLabel', 'Pick color from screen')}
                    className={cn(
                      'inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-input bg-background text-muted-foreground shadow-xs transition-colors',
                      'hover:bg-muted/40 hover:text-foreground',
                      'focus-visible:shadow-focus focus-visible:outline-none',
                    )}
                  >
                    <Pipette aria-hidden="true" className="size-4" />
                  </button>
                ) : null}
                {showRemoveButton ? (
                  <button
                    type="button"
                    onClick={() => handleRemoveColor(normalizedValue)}
                    data-slot="color-picker-remove"
                    aria-label={removeAriaLabel}
                    className={cn(
                      'inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-input bg-background text-muted-foreground shadow-xs transition-colors',
                      'hover:bg-status-error-bg hover:text-status-error-text hover:border-status-error-border',
                      'focus-visible:shadow-focus focus-visible:outline-none',
                    )}
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                  </button>
                ) : null}
              </div>
            ) : null}
            {hexError ? (
              <p
                data-slot="color-picker-error"
                className="px-5 pb-3 -mt-2 text-xs text-status-error-text"
              >
                {hexError}
              </p>
            ) : null}

            <div className="h-px w-full bg-border/60" aria-hidden="true" />

            {/* Section 3 — Saved colors */}
            <div data-slot="color-picker-section-saved" className="px-5 pt-4 pb-5">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{savedLabel}</span>
                {onEditSavedColors ? (
                  <button
                    type="button"
                    onClick={() => onEditSavedColors()}
                    data-slot="color-picker-edit"
                    className={cn(
                      'text-sm font-medium text-accent-indigo outline-none transition-colors',
                      'hover:underline focus-visible:underline',
                      'focus-visible:shadow-focus rounded-sm',
                    )}
                  >
                    {editLabel}
                  </button>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-3" role="radiogroup">
                {effectiveSwatches.map((swatch) => {
                  const normalized = normalizeHex(swatch) ?? swatch
                  const selected = normalized.toUpperCase() === normalizedValue.toUpperCase()
                  return (
                    <button
                      key={normalized}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={normalized}
                      data-slot="color-picker-swatch"
                      data-state={selected ? 'on' : 'off'}
                      className={cn(swatchVariants(), 'group/swatch')}
                      onClick={() => {
                        onChange(normalized)
                        if (!allowCustom && !showAddButton) setOpen(false)
                      }}
                    >
                      <span
                        aria-hidden="true"
                        data-slot="color-picker-swatch-dot"
                        className={swatchDotVariants({ selected })}
                        style={{ backgroundColor: normalized }}
                      />
                      {selected ? <span className="sr-only">Selected</span> : null}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Section 4 — Add new color (optional) */}
            {showAddButton ? (
              <>
                <div className="h-px w-full bg-border/60" aria-hidden="true" />
                <button
                  type="button"
                  onClick={() => handleAddSwatch(normalizedValue)}
                  data-slot="color-picker-add"
                  className={cn(
                    'flex w-full items-center gap-1.5 rounded-b-xl px-4 py-3.5 text-left text-sm text-muted-foreground outline-none transition-colors',
                    'hover:bg-muted/40 hover:text-foreground',
                    'focus-visible:shadow-focus focus-visible:outline-none',
                  )}
                >
                  <Plus aria-hidden="true" className="size-5 text-muted-foreground/70" />
                  <span>{addLabel}</span>
                </button>
              </>
            ) : null}

            <PopoverPrimitive.Arrow className="fill-popover stroke-input" />
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    )
  },
)
ColorPicker.displayName = 'ColorPicker'

export {
  triggerVariants as colorPickerTriggerVariants,
  swatchVariants as colorPickerSwatchVariants,
  swatchDotVariants as colorPickerSwatchDotVariants,
}
