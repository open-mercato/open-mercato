import * as React from 'react'
import { Circle } from 'lucide-react'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import type { GalleryEntry } from '../types'

// Token names are proper nouns from the codebase and are deliberately not
// translated. Structure mirrors the DS Figma color-system sheet (node
// 553:14956): Brand Colors → Color Tokens by role → State Color Tokens.
// Figma state names map to code tokens per the contract documented in
// globals.css: state/{x}/base→icon, /light→border, /lighter→bg.

const TOKENS_IMPORT = 'apps/mercato/src/app/globals.css'
const FIGMA_COLORS_NODE = '553:14956'

function SwatchCard({ copyText, label, children }: { copyText: string; label: string; children: React.ReactNode }) {
  const onCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(copyText)
      flash(`${copyText} copied`, 'success')
    } catch {
      flash('Could not copy the token', 'error')
    }
  }, [copyText])
  return (
    <button
      type="button"
      onClick={onCopy}
      className="flex w-36 flex-col items-start gap-1 rounded-md border border-border bg-background p-2 text-left transition-colors hover:bg-muted/40"
      title={`Copy ${copyText}`}
    >
      {children}
      <code className="break-all text-[11px] leading-tight text-muted-foreground">{label}</code>
    </button>
  )
}

function TokenSwatch({ tokenClass, label }: { tokenClass: string; label: string }) {
  return (
    <SwatchCard copyText={label} label={label}>
      <span aria-hidden className={`h-10 w-full rounded-sm border border-border ${tokenClass}`} />
    </SwatchCard>
  )
}

// A text-color token shown in its actual role — as type, not as a fill.
function TextSwatch({ textClass, label }: { textClass: string; label: string }) {
  return (
    <SwatchCard copyText={textClass} label={label}>
      <span aria-hidden className="flex h-10 w-full items-center justify-center rounded-sm border border-border bg-background">
        <span className={`text-xl font-semibold leading-none ${textClass}`}>Aa</span>
      </span>
    </SwatchCard>
  )
}

// A border-color token shown as a 2px outline on the neutral surface.
function BorderSwatch({ borderClass, label }: { borderClass: string; label: string }) {
  return (
    <SwatchCard copyText={borderClass} label={label}>
      <span aria-hidden className={`h-10 w-full rounded-sm border-2 bg-background ${borderClass}`} />
    </SwatchCard>
  )
}

// An icon-color token shown on a real glyph.
function IconSwatch({ iconClass, label }: { iconClass: string; label: string }) {
  return (
    <SwatchCard copyText={iconClass} label={label}>
      <span aria-hidden className="flex h-10 w-full items-center justify-center rounded-sm border border-border bg-background">
        <Circle className={`size-4 fill-current ${iconClass}`} />
      </span>
    </SwatchCard>
  )
}

function SwatchRow({ items }: { items: Array<{ tokenClass: string; label: string }> }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <TokenSwatch key={item.label} tokenClass={item.tokenClass} label={item.label} />
      ))}
    </div>
  )
}

const brandColorsEntry: GalleryEntry = {
  id: 'brand-colors',
  title: 'Brand colors',
  importPath: TOKENS_IMPORT,
  usage: {
    do: ['brand-violet 10/30/100 pattern (bg/border/text) for proposed and feature accents.'],
    dont: ['Never theme or repurpose accent-indigo — it is the selection-control contract.'],
  },
  figmaNodeId: FIGMA_COLORS_NODE,
  variants: [
    {
      id: 'gradient',
      title: 'gradient 135°',
      render: () => (
        <div className="space-y-2">
          <div
            aria-hidden
            className="h-16 w-full max-w-md rounded-md border border-border bg-linear-135 from-brand-lime from-0% via-brand-yellow via-35% to-brand-violet to-70%"
          />
          <code className="text-xs text-muted-foreground">brand-lime 0%, brand-yellow 35%, brand-violet 70%</code>
        </div>
      ),
      code: `<div className="bg-linear-135 from-brand-lime from-0% via-brand-yellow via-35% to-brand-violet to-70%" />`,
    },
    {
      id: 'identity',
      title: 'identity',
      render: () => (
        <SwatchRow
          items={[
            { tokenClass: 'bg-brand-lime', label: 'brand-lime' },
            { tokenClass: 'bg-brand-yellow', label: 'brand-yellow' },
            { tokenClass: 'bg-brand-violet', label: 'brand-violet' },
            { tokenClass: 'bg-brand-violet-foreground', label: 'brand-violet-foreground' },
            { tokenClass: 'bg-accent-indigo', label: 'accent-indigo' },
          ]}
        />
      ),
      code: `<span className="bg-brand-violet/10 border-brand-violet/30 text-brand-violet" />`,
    },
    {
      id: 'social',
      title: 'social',
      render: () => (
        <SwatchRow
          items={[
            { tokenClass: 'bg-brand-apple', label: 'brand-apple' },
            { tokenClass: 'bg-brand-github', label: 'brand-github' },
            { tokenClass: 'bg-brand-facebook', label: 'brand-facebook' },
            { tokenClass: 'bg-brand-dropbox', label: 'brand-dropbox' },
            { tokenClass: 'bg-brand-linkedin', label: 'brand-linkedin' },
            { tokenClass: 'bg-brand-x', label: 'brand-x' },
          ]}
        />
      ),
      code: `<SocialButton provider="github" />`,
    },
  ],
}

const colorTokensEntry: GalleryEntry = {
  id: 'color-tokens',
  title: 'Color tokens',
  importPath: TOKENS_IMPORT,
  usage: {
    do: ['Pair every surface with its -foreground counterpart.', 'Borders come from border-border / border-input — nothing else.'],
    dont: ['Never border-gray-* or any raw palette shade.'],
  },
  figmaNodeId: FIGMA_COLORS_NODE,
  variants: [
    {
      id: 'primary',
      title: 'primary',
      render: () => (
        <SwatchRow
          items={[
            { tokenClass: 'bg-primary', label: 'primary' },
            { tokenClass: 'bg-primary-foreground', label: 'primary-foreground' },
            { tokenClass: 'bg-primary-hover', label: 'primary-hover' },
            { tokenClass: 'bg-destructive', label: 'destructive' },
          ]}
        />
      ),
      code: `<div className="bg-primary text-primary-foreground hover:bg-primary-hover" />`,
    },
    {
      id: 'background',
      title: 'background (bg)',
      render: () => (
        <SwatchRow
          items={[
            { tokenClass: 'bg-background', label: 'background' },
            { tokenClass: 'bg-card', label: 'card' },
            { tokenClass: 'bg-popover', label: 'popover' },
            { tokenClass: 'bg-muted', label: 'muted' },
            { tokenClass: 'bg-accent', label: 'accent' },
            { tokenClass: 'bg-sidebar', label: 'sidebar' },
            { tokenClass: 'bg-bg-disabled', label: 'bg-disabled' },
          ]}
        />
      ),
      code: `<div className="bg-card text-card-foreground" />`,
    },
    {
      id: 'text',
      title: 'text',
      render: () => (
        <div className="flex flex-wrap gap-2">
          <TextSwatch textClass="text-foreground" label="text-foreground" />
          <TextSwatch textClass="text-muted-foreground" label="text-muted-foreground" />
          <TextSwatch textClass="text-card-foreground" label="text-card-foreground" />
          <TextSwatch textClass="text-accent-foreground" label="text-accent-foreground" />
          <TextSwatch textClass="text-text-disabled" label="text-text-disabled" />
        </div>
      ),
      code: `<p className="text-muted-foreground">Secondary copy</p>`,
    },
    {
      id: 'stroke',
      title: 'stroke',
      render: () => (
        <div className="flex flex-wrap gap-2">
          <BorderSwatch borderClass="border-border" label="border-border" />
          <BorderSwatch borderClass="border-input" label="border-input" />
          <BorderSwatch borderClass="border-ring" label="border-ring" />
          <BorderSwatch borderClass="border-border-disabled" label="border-border-disabled" />
        </div>
      ),
      code: `<div className="border-border focus-visible:ring-ring" />`,
    },
  ],
}

// Literal class strings on purpose: the Tailwind scanner only sees complete
// literals, so `bg-status-${x}` variants would silently never be generated.
type StatusFamily = {
  figma: string
  status: string
  chipLabel: string
  bg: string
  text: string
  border: string
  icon: string
  dot: string
}

const FIGMA_STATE_TO_CODE: StatusFamily[] = [
  { figma: 'Faded', status: 'neutral', chipLabel: 'Neutral', bg: 'bg-status-neutral-bg', text: 'text-status-neutral-text', border: 'border-status-neutral-border', icon: 'text-status-neutral-icon', dot: 'bg-status-neutral-icon' },
  { figma: 'Information', status: 'info', chipLabel: 'Info', bg: 'bg-status-info-bg', text: 'text-status-info-text', border: 'border-status-info-border', icon: 'text-status-info-icon', dot: 'bg-status-info-icon' },
  { figma: 'Warning', status: 'warning', chipLabel: 'Warning', bg: 'bg-status-warning-bg', text: 'text-status-warning-text', border: 'border-status-warning-border', icon: 'text-status-warning-icon', dot: 'bg-status-warning-icon' },
  { figma: 'Error', status: 'error', chipLabel: 'Error', bg: 'bg-status-error-bg', text: 'text-status-error-text', border: 'border-status-error-border', icon: 'text-status-error-icon', dot: 'bg-status-error-icon' },
  { figma: 'Success', status: 'success', chipLabel: 'Success', bg: 'bg-status-success-bg', text: 'text-status-success-text', border: 'border-status-success-border', icon: 'text-status-success-icon', dot: 'bg-status-success-icon' },
  { figma: 'Highlighted', status: 'pink', chipLabel: 'Highlighted', bg: 'bg-status-pink-bg', text: 'text-status-pink-text', border: 'border-status-pink-border', icon: 'text-status-pink-icon', dot: 'bg-status-pink-icon' },
]

// One status family: the composed chip first (how the roles work together),
// then each token presented in its actual role.
function StatusFamilyPreview({ family }: { family: StatusFamily }) {
  return (
    <div className="space-y-3">
      <span
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-medium ${family.bg} ${family.text} ${family.border}`}
      >
        <span aria-hidden className={`size-2 rounded-full ${family.dot}`} />
        {family.chipLabel}
      </span>
      <div className="flex flex-wrap gap-2">
        <TokenSwatch tokenClass={family.bg} label={family.bg} />
        <TextSwatch textClass={family.text} label={family.text} />
        <BorderSwatch borderClass={family.border} label={family.border} />
        <IconSwatch iconClass={family.icon} label={family.icon} />
      </div>
    </div>
  )
}

const stateTokensEntry: GalleryEntry = {
  id: 'state-tokens',
  title: 'State color tokens',
  importPath: TOKENS_IMPORT,
  usage: {
    do: [
      'Pair -bg with -text of the same family — the shades are contrast-tested together.',
      '-icon for glyphs and dots, -border for outlines; both handle dark mode themselves.',
    ],
    dont: [
      'Never hardcode Tailwind status colors (text-red-*, bg-green-*, text-amber-*).',
      'No dark: overrides on status tokens — they already theme.',
    ],
  },
  figmaNodeId: FIGMA_COLORS_NODE,
  variants: [
    ...FIGMA_STATE_TO_CODE.map((family) => ({
      id: family.status,
      title: `${family.figma} → status-${family.status}`,
      render: () => <StatusFamilyPreview family={family} />,
      code: `<span className="${family.bg} ${family.text} ${family.border}" />`,
    })),
    {
      id: 'feature',
      title: 'Feature → brand-violet pattern',
      render: () => (
        <div className="flex max-w-md items-center gap-2 rounded-md border border-brand-violet/30 bg-brand-violet/10 p-3 text-sm text-brand-violet">
          Feature state uses the brand-violet 10/30/100 pattern, not a status family.
        </div>
      ),
      code: `<Alert status="feature" />`,
    },
  ],
}

const chartPaletteEntry: GalleryEntry = {
  id: 'chart-palette',
  title: 'Chart palette',
  importPath: TOKENS_IMPORT,
  usage: {
    dont: [
      'Never build token class names dynamically (`bg-chart-${n}`) — the Tailwind scanner only sees complete literals, so the class is silently never generated.',
    ],
  },
  variants: [
    {
      id: 'numbered',
      title: 'numbered',
      render: () => (
        <SwatchRow
          items={[
            { tokenClass: 'bg-chart-1', label: 'chart-1' },
            { tokenClass: 'bg-chart-2', label: 'chart-2' },
            { tokenClass: 'bg-chart-3', label: 'chart-3' },
            { tokenClass: 'bg-chart-4', label: 'chart-4' },
            { tokenClass: 'bg-chart-5', label: 'chart-5' },
          ]}
        />
      ),
      code: `<BarChart data={data} />`,
    },
    {
      id: 'named',
      title: 'named',
      render: () => (
        <SwatchRow
          items={[
            { tokenClass: 'bg-chart-blue', label: 'chart-blue' },
            { tokenClass: 'bg-chart-emerald', label: 'chart-emerald' },
            { tokenClass: 'bg-chart-amber', label: 'chart-amber' },
            { tokenClass: 'bg-chart-rose', label: 'chart-rose' },
            { tokenClass: 'bg-chart-violet', label: 'chart-violet' },
            { tokenClass: 'bg-chart-cyan', label: 'chart-cyan' },
            { tokenClass: 'bg-chart-indigo', label: 'chart-indigo' },
            { tokenClass: 'bg-chart-pink', label: 'chart-pink' },
            { tokenClass: 'bg-chart-teal', label: 'chart-teal' },
            { tokenClass: 'bg-chart-orange', label: 'chart-orange' },
          ]}
        />
      ),
      code: `<Sparkline className="text-chart-blue" data={points} />`,
    },
  ],
}

type ColorRole = {
  surface: string
  onSurface: string
  surfaceCls: string
  onSurfaceCls: string
  borderCls?: string
}

function RoleCard({ role }: { role: ColorRole }) {
  const label = `${role.surface} / ${role.onSurface}`
  const onCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(`${role.surfaceCls} ${role.onSurfaceCls}`)
      flash(`${role.surfaceCls} ${role.onSurfaceCls} copied`, 'success')
    } catch {
      flash('Could not copy the classes', 'error')
    }
  }, [role])
  return (
    <button
      type="button"
      onClick={onCopy}
      title={`Copy ${role.surfaceCls} ${role.onSurfaceCls}`}
      className={`flex h-24 w-full flex-col justify-between rounded-md border p-3 text-left transition-opacity hover:opacity-90 ${role.surfaceCls} ${role.onSurfaceCls} ${role.borderCls ?? 'border-border'}`}
    >
      <span className="text-sm font-medium leading-tight">{role.surface}</span>
      <code className="text-xs opacity-80">{role.onSurface}</code>
    </button>
  )
}

function RoleGrid({ roles }: { roles: ColorRole[] }) {
  return (
    <div className="grid w-full gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {roles.map((role) => (
        <RoleCard key={role.surface + role.onSurface} role={role} />
      ))}
    </div>
  )
}

const colorRolesEntry: GalleryEntry = {
  id: 'color-roles',
  title: 'Color roles',
  importPath: TOKENS_IMPORT,
  figmaNodeId: FIGMA_COLORS_NODE,
  keywords: ['roles', 'pairs', 'on-color', 'material'],
  usage: {
    do: [
      'A role is a surface paired with its content color — always use them together, never mix pairs.',
      'Click a card to copy both classes of the pair.',
    ],
    dont: [
      'Never put foreground on a surface from a different pair — contrast is only tested within a pair.',
      'Never use a -foreground token as a standalone accent color.',
    ],
  },
  variants: [
    {
      id: 'action',
      title: 'action',
      render: () => (
        <RoleGrid
          roles={[
            { surface: 'primary', onSurface: 'primary-foreground', surfaceCls: 'bg-primary', onSurfaceCls: 'text-primary-foreground' },
            { surface: 'destructive', onSurface: 'white', surfaceCls: 'bg-destructive', onSurfaceCls: 'text-white' },
            { surface: 'brand-violet', onSurface: 'brand-violet-foreground', surfaceCls: 'bg-brand-violet', onSurfaceCls: 'text-brand-violet-foreground' },
            { surface: 'accent-indigo', onSurface: 'accent-indigo-foreground', surfaceCls: 'bg-accent-indigo', onSurfaceCls: 'text-accent-indigo-foreground' },
          ]}
        />
      ),
      code: `<button className="bg-primary text-primary-foreground" />`,
    },
    {
      id: 'surfaces',
      title: 'surfaces',
      render: () => (
        <RoleGrid
          roles={[
            { surface: 'background', onSurface: 'foreground', surfaceCls: 'bg-background', onSurfaceCls: 'text-foreground' },
            { surface: 'card', onSurface: 'card-foreground', surfaceCls: 'bg-card', onSurfaceCls: 'text-card-foreground' },
            { surface: 'popover', onSurface: 'popover-foreground', surfaceCls: 'bg-popover', onSurfaceCls: 'text-popover-foreground' },
            { surface: 'muted', onSurface: 'muted-foreground', surfaceCls: 'bg-muted', onSurfaceCls: 'text-muted-foreground' },
            { surface: 'accent', onSurface: 'accent-foreground', surfaceCls: 'bg-accent', onSurfaceCls: 'text-accent-foreground' },
            { surface: 'sidebar', onSurface: 'sidebar-foreground', surfaceCls: 'bg-sidebar', onSurfaceCls: 'text-sidebar-foreground' },
          ]}
        />
      ),
      code: `<div className="bg-card text-card-foreground" />`,
    },
    {
      id: 'status',
      title: 'status',
      render: () => (
        <RoleGrid
          roles={['error', 'success', 'warning', 'info', 'neutral', 'pink'].map((status) => ({
            surface: `status-${status}-bg`,
            onSurface: `status-${status}-text`,
            surfaceCls: `bg-status-${status}-bg`,
            onSurfaceCls: `text-status-${status}-text`,
            borderCls: `border-status-${status}-border`,
          }))}
        />
      ),
      code: `<span className="bg-status-error-bg text-status-error-text border-status-error-border" />`,
    },
  ],
}

const RADIUS_SCALE: Array<{ cls: string; label: string; px: string }> = [
  { cls: 'rounded-none', label: 'rounded-none', px: '0px' },
  { cls: 'rounded-sm', label: 'rounded-sm', px: '6px' },
  { cls: 'rounded-md', label: 'rounded-md', px: '8px' },
  { cls: 'rounded-lg', label: 'rounded-lg', px: '10px' },
  { cls: 'rounded-xl', label: 'rounded-xl', px: '16px' },
  { cls: 'rounded-full', label: 'rounded-full', px: '999px' },
]

function RadiusCard({ cls, label, px }: { cls: string; label: string; px: string }) {
  const onCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(label)
      flash(`${label} copied`, 'success')
    } catch {
      flash('Could not copy the class', 'error')
    }
  }, [label])
  return (
    <button
      type="button"
      onClick={onCopy}
      title={`Copy ${label}`}
      className="flex w-36 flex-col items-start gap-2 rounded-md border border-border bg-background p-2 text-left transition-colors hover:bg-muted/40"
    >
      <span aria-hidden className={`h-14 w-full border-2 border-dashed border-status-pink-icon bg-status-pink-bg ${cls}`} />
      <span className="space-y-0.5">
        <code className="block text-xs text-foreground">{label}</code>
        <span className="block text-xs text-muted-foreground">{px}</span>
      </span>
    </button>
  )
}

const radiusEntry: GalleryEntry = {
  id: 'corner-radius',
  title: 'Corner radius',
  importPath: TOKENS_IMPORT,
  keywords: ['radius', 'rounded', 'border-radius', 'corners'],
  usage: {
    do: [
      'The scale derives from the --radius base token (10px): sm 6px, md 8px, lg 10px, xl 16px.',
      'Cards and panels use rounded-lg; controls, chips and filter buttons use rounded-md.',
      'rounded-full is reserved for Badge, Tag, SegmentedControl, Avatar and status dots.',
    ],
    dont: [
      'No arbitrary values (rounded-[24px]) — pick from the scale.',
      'No full-pill radii on filter chips or custom controls outside the reserved primitives.',
    ],
  },
  variants: [
    {
      id: 'scale',
      title: 'scale',
      render: () => (
        <div className="flex flex-wrap gap-2">
          {RADIUS_SCALE.map((item) => (
            <RadiusCard key={item.cls} {...item} />
          ))}
        </div>
      ),
      code: `<div className="rounded-lg border border-border" />`,
    },
  ],
}

export const entries: GalleryEntry[] = [
  brandColorsEntry,
  colorRolesEntry,
  colorTokensEntry,
  stateTokensEntry,
  chartPaletteEntry,
  radiusEntry,
]
