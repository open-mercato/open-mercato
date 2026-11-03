import * as React from 'react'
import { ArrowRight, Circle } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import type { GalleryEntry } from '../types'
import { SourceColors, SourceGrids, SourceRadius, SourceShadows, SourceTypography } from '../demos/foundation-references'

// Token names are proper nouns from the codebase and are deliberately not
// translated. Structure mirrors the DS Figma color-system sheet (node
// 553:14956): Brand Colors → Color Tokens by role → State Color Tokens.
// Figma state names map to code tokens per the contract documented in
// globals.css: state/{x}/base→icon, /light→border, /lighter→bg.

const TOKENS_IMPORT = 'apps/mercato/src/app/globals.css'
const FIGMA_COLORS_NODE = '553:14956'

function useCopyToken(copyText: string) {
  const t = useT()
  const onCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(copyText)
      flash(t('design_system.gallery.tokenCopied', { token: copyText }), 'success')
    } catch {
      flash(t('design_system.gallery.tokenCopyFailed'), 'error')
    }
  }, [copyText, t])
  return { onCopy, copyLabel: t('design_system.gallery.copyToken', { token: copyText }) }
}

function SwatchCard({ copyText, label, children }: { copyText: string; label: string; children: React.ReactNode }) {
  const { onCopy, copyLabel } = useCopyToken(copyText)
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onCopy}
      className="h-auto w-44 max-w-full flex-col items-start gap-3 whitespace-normal border border-border bg-background p-3 text-left hover:bg-muted/50"
      title={copyLabel}
      aria-label={copyLabel}
    >
      {children}
      <code className="break-all text-xs text-muted-foreground">{label}</code>
    </Button>
  )
}

function TokenSwatch({ tokenClass, label }: { tokenClass: string; label: string }) {
  return (
    <SwatchCard copyText={label} label={label}>
      <span aria-hidden className={`h-20 w-full rounded-sm border border-border ${tokenClass}`} />
    </SwatchCard>
  )
}

// A text-color token shown in its actual role — as type, not as a fill.
function TextSwatch({ textClass, label }: { textClass: string; label: string }) {
  return (
    <SwatchCard copyText={textClass} label={label}>
      <span aria-hidden className="flex h-20 w-full items-center justify-center rounded-sm border border-border bg-background">
        <span className={`text-3xl font-medium leading-none ${textClass}`}>Aa</span>
      </span>
    </SwatchCard>
  )
}

// A border-color token shown as a 2px outline on the neutral surface.
function BorderSwatch({ borderClass, label }: { borderClass: string; label: string }) {
  return (
    <SwatchCard copyText={borderClass} label={label}>
      <span aria-hidden className={`h-20 w-full rounded-sm border-2 bg-background ${borderClass}`} />
    </SwatchCard>
  )
}

// An icon-color token shown on a real glyph.
function IconSwatch({ iconClass, label }: { iconClass: string; label: string }) {
  return (
    <SwatchCard copyText={iconClass} label={label}>
      <span aria-hidden className="flex h-20 w-full items-center justify-center rounded-sm border border-border bg-background">
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
    do: ['Use the brand-violet 10/30/100 pattern (bg/border/text) for AI features and user-saved views.'],
    dont: ['Do not substitute brand colors for semantic status tokens.', 'Do not repurpose accent-indigo — it is the selection-control contract.'],
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
            className="h-32 w-full rounded-lg border border-border bg-linear-135 from-brand-lime from-0% via-brand-yellow via-35% to-brand-violet to-70%"
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
      id: 'source-palette',
      title: 'Complete source palette',
      render: () => <SourceColors />,
      code: `import { SourceColors } from '@open-mercato/core/modules/design_system/gallery/demos/foundation-references'

<SourceColors />`,
    },
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
      code: `<p className="text-muted-foreground">{t('design_system.gallery.samples.typeBody')}</p>`,
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

function FeatureStatePreview() {
  const t = useT()
  return (
    <Alert status="feature" className="max-w-md">
      <AlertDescription>{t('design_system.gallery.samples.featureState')}</AlertDescription>
    </Alert>
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
      'Alert status="feature" uses the neutral token family; brand-violet is reserved for AI and saved-view accents.',
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
      title: 'Feature → status-neutral',
      render: () => <FeatureStatePreview />,
      code: `import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'

<Alert status="feature" className="max-w-md">
  <AlertDescription>{t('design_system.gallery.samples.featureState')}</AlertDescription>
</Alert>`,
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
  const { onCopy, copyLabel } = useCopyToken(`${role.surfaceCls} ${role.onSurfaceCls}`)
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onCopy}
      title={copyLabel}
      aria-label={copyLabel}
      className="h-auto w-full whitespace-normal p-0 text-left transition-opacity hover:bg-transparent hover:opacity-90"
    >
      <span className={`flex h-36 w-full flex-col items-start justify-between rounded-lg border p-4 ${role.surfaceCls} ${role.onSurfaceCls} ${role.borderCls ?? 'border-border'}`}>
        <span className="text-base font-medium leading-tight">{role.surface}</span>
        <code className="text-xs opacity-80">{role.onSurface}</code>
      </span>
    </Button>
  )
}

function RoleGrid({ roles }: { roles: ColorRole[] }) {
  return (
    <div className="grid w-full gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
      code: `import { Button } from '@open-mercato/ui/primitives/button'

<Button type="button">{t('design_system.gallery.samples.primaryAction')}</Button>`,
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
          roles={FIGMA_STATE_TO_CODE.map((family) => ({
            surface: `status-${family.status}-bg`,
            onSurface: `status-${family.status}-text`,
            surfaceCls: family.bg,
            onSurfaceCls: family.text,
            borderCls: family.border,
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
  const { onCopy, copyLabel } = useCopyToken(label)
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onCopy}
      title={copyLabel}
      aria-label={copyLabel}
      className="h-auto w-36 flex-col items-start gap-2 border border-border bg-background p-2 text-left hover:bg-muted/50"
    >
      <span aria-hidden className={`h-14 w-full border-2 border-dashed border-status-pink-icon bg-status-pink-bg ${cls}`} />
      <span className="space-y-0.5">
        <code className="block text-xs text-foreground">{label}</code>
        <span className="block text-xs text-muted-foreground">{px}</span>
      </span>
    </Button>
  )
}

const radiusEntry: GalleryEntry = {
  id: 'corner-radius',
  title: 'Corner radius',
  importPath: TOKENS_IMPORT,
  figmaNodeId: '553:14961',
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
      id: 'source-radius',
      title: 'Complete radius scale',
      render: () => <SourceRadius />,
      code: `import { SourceRadius } from '@open-mercato/core/modules/design_system/gallery/demos/foundation-references'

<SourceRadius />`,
    },
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

const TYPOGRAPHY_ROLES = [
  { id: 'page', className: 'text-2xl font-bold tracking-tight', metrics: '24 / 32 px' },
  { id: 'section', className: 'text-xl font-semibold', metrics: '20 / 28 px' },
  { id: 'body', className: 'text-sm', metrics: '14 / 20 px' },
  { id: 'label', className: 'text-sm font-medium', metrics: '14 / 20 px' },
  { id: 'helper', className: 'text-xs text-muted-foreground', metrics: '12 / 16 px' },
] as const

function TypographyRolesPreview() {
  const t = useT()
  return <div className="space-y-6">
    <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{t('design_system.foundations.typography.guide.intro')}</p>
    <div className="divide-y divide-border border-y border-border">
      {TYPOGRAPHY_ROLES.map(role => <article key={role.id} className="grid min-w-0 gap-4 py-6 md:grid-cols-3 md:gap-8" data-typography-role={role.id}>
        <div className="space-y-2">
          <h4 className="text-sm font-medium">{t(`design_system.foundations.typography.guide.${role.id}.title`)}</h4>
          <p className="text-xs text-muted-foreground">{role.metrics}</p>
        </div>
        <div className="min-w-0 space-y-3 md:col-span-2">
          <p className={`${role.className} break-words`}>{t(`design_system.foundations.typography.guide.${role.id}.example`)}</p>
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">{t(`design_system.foundations.typography.guide.${role.id}.usage`)}</p>
        </div>
      </article>)}
    </div>
    <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{t('design_system.foundations.typography.guide.fonts')}</p>
  </div>
}

function TypographyReferencePreview() {
  const t = useT()
  return <section className="rounded-lg border border-border">
    <h3 className="p-4 text-sm font-medium">{t('design_system.foundations.typography.guide.reference')}</h3>
    <div className="space-y-8 border-t border-border p-4 sm:p-6">
      <div className="space-y-3">
        <h4 className="text-sm font-medium">{t('design_system.foundations.typography.guide.classes')}</h4>
        <dl className="divide-y divide-border">
          {TYPOGRAPHY_ROLES.map(role => <div key={role.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm">
            <dt>{t(`design_system.foundations.typography.guide.${role.id}.title`)}</dt>
            <dd><code className="break-words text-xs text-muted-foreground">{role.className}</code></dd>
          </div>)}
        </dl>
      </div>
      <SourceTypography />
    </div>
  </section>
}

const typographyEntry: GalleryEntry = {
  id: 'typography',
  title: 'Typography',
  importPath: TOKENS_IMPORT,
  figmaNodeId: '553:14957',
  keywords: ['font', 'type', 'heading', 'body', 'line-height', 'Geist', 'Inter'],
  usage: {
    do: [
      'Use font-sans for the interface and font-mono for code and identifiers. Both resolve through the host application font tokens, with system fallbacks in globals.css.',
      'Use text-2xl for backend page titles and text-sm for body text. Scale measurements assume a 16px root font size.',
      'The Figma reference uses Inter / Inter Display; these specimens show the shipped font tokens rather than claiming font parity.',
    ],
    dont: ['Do not copy marketing display sizes into dense backend pages.', 'Do not set inline font families or arbitrary text sizes.'],
  },
  variants: [
    {
      id: 'roles',
      title: 'Text hierarchy',
      render: () => <TypographyRolesPreview />,
      code: `import { Label } from '@open-mercato/ui/primitives/label'
import { Input } from '@open-mercato/ui/primitives/input'

<h1 className="text-2xl font-bold tracking-tight">{t('design_system.foundations.typography.guide.page.example')}</h1>
<h2 className="text-xl font-semibold">{t('design_system.foundations.typography.guide.section.example')}</h2>
<p className="text-sm">{t('design_system.foundations.typography.guide.body.example')}</p>
<Label htmlFor="name">{t('design_system.foundations.typography.guide.label.example')}</Label>
<Input id="name" aria-describedby="name-hint" />
<p id="name-hint" className="text-xs text-muted-foreground">{t('design_system.foundations.typography.guide.helper.example')}</p>`,
    },
    {
      id: 'source-typography',
      title: 'Complete typography scale',
      render: () => <TypographyReferencePreview />,
      code: `import { SourceTypography } from '@open-mercato/core/modules/design_system/gallery/demos/foundation-references'

<SourceTypography />`,
    },
  ],
}

const SPACING_SCALE = [
  { token: '1', className: 'w-1', pixels: 4 },
  { token: '2', className: 'w-2', pixels: 8 },
  { token: '3', className: 'w-3', pixels: 12 },
  { token: '4', className: 'w-4', pixels: 16 },
  { token: '6', className: 'w-6', pixels: 24 },
  { token: '8', className: 'w-8', pixels: 32 },
  { token: '12', className: 'w-12', pixels: 48 },
]

function SpacingScalePreview() {
  const t = useT()
  return (
    <div className="w-full space-y-6">
      <p className="text-sm text-muted-foreground">{t('design_system.foundations.spacing.scaleHint')}</p>
      {SPACING_SCALE.map((item) => (
        <div key={item.token} className="flex items-center gap-4 py-2">
          <code className="w-12 shrink-0 text-sm text-muted-foreground">p-{item.token}</code>
          <div className="min-w-0 flex-1"><span aria-hidden className="block h-8 rounded-sm border-l-4 border-primary bg-muted" style={{ width: `${item.pixels / 48 * 100}%` }} /></div>
          <span className="w-28 shrink-0 font-mono text-xs"><span>{item.pixels / 16} rem</span><span className="ml-3 text-muted-foreground">{item.pixels} px</span></span>
        </div>
      ))}
    </div>
  )
}

function SpacingRhythmPreview() {
  return (
    <div className="grid w-full gap-6 md:grid-cols-2">
      {[
        { padding: 'p-4', gap: 'gap-2' },
        { padding: 'p-6', gap: 'gap-4' },
      ].map((item) => (
        <div key={item.padding} className={`space-y-4 rounded-lg border border-border bg-muted/30 ${item.padding}`}>
          <code className="text-xs text-muted-foreground">{item.padding} / {item.gap}</code>
          <div aria-hidden className={`flex ${item.gap}`}>
            <span className="h-12 flex-1 rounded-md border border-border bg-background" />
            <span className="h-12 flex-1 rounded-md border border-border bg-background" />
            <span className="h-12 flex-1 rounded-md border border-border bg-background" />
          </div>
        </div>
      ))}
    </div>
  )
}

const spacingEntry: GalleryEntry = {
  id: 'spacing',
  title: 'Spacing',
  importPath: TOKENS_IMPORT,
  figmaNodeId: '553:14958',
  keywords: ['padding', 'gap', 'margin', 'grid', 'rhythm'],
  usage: {
    do: ['Use the 4px spacing grid. Start with gap-2 between controls, p-4 within containers and p-6 for larger panels.'],
    dont: ['Do not invent arbitrary spacing values or compensate for layout problems with negative margins.'],
  },
  variants: [
    {
      id: 'source-grids',
      title: 'Layout grids',
      render: () => <SourceGrids />,
      code: `import { SourceGrids } from '@open-mercato/core/modules/design_system/gallery/demos/foundation-references'

<SourceGrids />`,
    },
    {
      id: 'scale',
      title: 'Spacing scale',
      render: () => <SpacingScalePreview />,
      code: `<div className="flex gap-2 p-4">{children}</div>
<section className="space-y-6 p-6">{children}</section>`,
    },
    {
      id: 'rhythm',
      title: 'Container rhythm',
      render: () => <SpacingRhythmPreview />,
      code: `<div className="p-4">
  <div className="flex gap-2">{children}</div>
</div>
<div className="p-6">
  <div className="flex gap-4">{children}</div>
</div>`,
    },
  ],
}

const SHADOW_SCALE = ['shadow-none', 'shadow-xs', 'shadow-sm', 'shadow-md', 'shadow-lg', 'shadow-xl', 'shadow-2xl']

function ShadowScalePreview() {
  return (
    <div className="grid w-full grid-cols-2 gap-6 p-4 md:grid-cols-3 lg:grid-cols-4">
      {SHADOW_SCALE.map((className) => (
        <div key={className} className={`flex h-24 items-center justify-center rounded-lg border border-border bg-card p-4 ${className}`}>
          <code className="text-xs text-card-foreground">{className}</code>
        </div>
      ))}
    </div>
  )
}

function FocusPreview() {
  const t = useT()
  return (
    <div className="space-y-4 p-2">
      <p className="text-sm text-muted-foreground">{t('design_system.gallery.samples.focusHint')}</p>
      <div className="flex flex-wrap items-center gap-6">
        <Button type="button" variant="outline">{t('design_system.gallery.samples.focusAction')}</Button>
        <span aria-hidden className="rounded-md border border-border bg-background px-4 py-2 text-sm shadow-focus">shadow-focus</span>
      </div>
    </div>
  )
}

const shadowsEntry: GalleryEntry = {
  id: 'shadows',
  title: 'Shadows & focus',
  importPath: TOKENS_IMPORT,
  figmaNodeId: '553:14959',
  keywords: ['elevation', 'depth', 'focus', 'keyboard'],
  usage: {
    do: ['Use shadow-xs for controls, shadow-sm for cards and higher elevations for overlays.', 'Keep the visible keyboard focus supplied by DS primitives. Shadow tokens adapt to the active theme.'],
    dont: ['Do not draw custom colored glows or arbitrary box shadows.', 'Do not remove focus feedback without an equivalent visible indicator.'],
  },
  variants: [
    {
      id: 'source-shadows',
      title: 'Complete shadow collection',
      render: () => <SourceShadows />,
      code: `import { SourceShadows } from '@open-mercato/core/modules/design_system/gallery/demos/foundation-references'

<SourceShadows />`,
    },
    {
      id: 'elevation',
      title: 'Elevation scale',
      render: () => <ShadowScalePreview />,
      code: `<div className="rounded-lg border border-border bg-card p-4 shadow-sm">{children}</div>
<div className="rounded-lg border border-border bg-popover p-4 shadow-lg">{children}</div>`,
    },
    {
      id: 'focus',
      title: 'Keyboard focus',
      render: () => <FocusPreview />,
      code: `import { Button } from '@open-mercato/ui/primitives/button'

<Button type="button" variant="outline">{t('design_system.gallery.samples.focusAction')}</Button>`,
    },
  ],
}

function MotionPreview() {
  const t = useT()
  const [active, setActive] = React.useState(false)
  return (
    <div className="w-full space-y-4">
      <Button type="button" variant="outline" aria-pressed={active} onClick={() => setActive((value) => !value)}>
        {t('design_system.gallery.samples.toggleMotion')}
      </Button>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-3 rounded-lg border border-border p-4">
          <code className="text-xs text-muted-foreground">transition-colors / 150 ms</code>
          <div aria-hidden className={`h-12 rounded-md transition-colors duration-150 motion-reduce:transition-none ${active ? 'bg-primary' : 'bg-muted'}`} />
        </div>
        <div className="space-y-3 rounded-lg border border-border p-4">
          <code className="text-xs text-muted-foreground">transition-opacity / 200 ms</code>
          <div aria-hidden className={`h-12 rounded-md bg-primary transition-opacity duration-200 ease-out motion-reduce:transition-none ${active ? 'opacity-100' : 'opacity-30'}`} />
        </div>
        <div className="space-y-3 rounded-lg border border-border p-4">
          <code className="text-xs text-muted-foreground">transition-transform / 300 ms</code>
          <div aria-hidden className="flex h-12 items-center">
            <ArrowRight className={`size-6 text-foreground transition-transform duration-300 ease-out motion-reduce:transition-none ${active ? 'translate-x-8' : 'translate-x-0'}`} />
          </div>
        </div>
        <div className="space-y-3 rounded-lg border border-border p-4">
          <code className="text-xs text-muted-foreground">transition-opacity / 400 ms</code>
          <div aria-hidden className={`h-12 rounded-md bg-primary transition-opacity duration-400 ease-out motion-reduce:transition-none ${active ? 'opacity-100' : 'opacity-30'}`} />
        </div>
        <div className="space-y-3 rounded-lg border border-border p-4">
          <code className="text-xs text-muted-foreground">transition-opacity / 500 ms</code>
          <div aria-hidden className={`h-12 rounded-md bg-primary transition-opacity duration-500 ease-out motion-reduce:transition-none ${active ? 'opacity-100' : 'opacity-30'}`} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t('design_system.gallery.samples.reducedMotion')}</p>
    </div>
  )
}

const motionEntry: GalleryEntry = {
  id: 'motion',
  title: 'Motion',
  importPath: TOKENS_IMPORT,
  figmaNodeId: '553:14960',
  keywords: ['animation', 'transition', 'duration', 'reduced-motion'],
  usage: {
    do: ['The Figma duration scale is 150, 200, 300, 400 and 500ms; choose timing according to content size and travel distance.', 'Name the changing property and respect reduced-motion preferences.'],
    dont: ['Do not use animation as the only feedback for a state change.', 'Do not use transition-all when only one property changes.'],
  },
  variants: [
    {
      id: 'durations',
      title: 'Interactive duration scale',
      render: () => <MotionPreview />,
      code: `import * as React from 'react'
import { ArrowRight } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'

const [active, setActive] = React.useState(false)

<Button type="button" variant="outline" aria-pressed={active} onClick={() => setActive((value) => !value)}>
  {t('design_system.gallery.samples.toggleMotion')}
</Button>
<div aria-hidden className={['h-12 rounded-md transition-colors duration-150 motion-reduce:transition-none', active ? 'bg-primary' : 'bg-muted'].join(' ')} />
<div aria-hidden className={['h-12 rounded-md bg-primary transition-opacity duration-200 ease-out motion-reduce:transition-none', active ? 'opacity-100' : 'opacity-30'].join(' ')} />
<ArrowRight aria-hidden className={['size-6 transition-transform duration-300 ease-out motion-reduce:transition-none', active ? 'translate-x-8' : 'translate-x-0'].join(' ')} />
<div aria-hidden className={['h-12 rounded-md bg-primary transition-opacity duration-400 ease-out motion-reduce:transition-none', active ? 'opacity-100' : 'opacity-30'].join(' ')} />
<div aria-hidden className={['h-12 rounded-md bg-primary transition-opacity duration-500 ease-out motion-reduce:transition-none', active ? 'opacity-100' : 'opacity-30'].join(' ')} />`,
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
  typographyEntry,
  spacingEntry,
  shadowsEntry,
  motionEntry,
]
