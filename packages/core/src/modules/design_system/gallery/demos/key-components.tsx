import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { FieldLabel } from '@open-mercato/ui/primitives/label'
import { HintText } from '@open-mercato/ui/primitives/hint-text'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Input } from '@open-mercato/ui/primitives/input'
import { Button } from '@open-mercato/ui/primitives/button'
import { CompactButton } from '@open-mercato/ui/primitives/compact-button'
import { LinkButton } from '@open-mercato/ui/primitives/link-button'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { ContentLabel } from '@open-mercato/ui/primitives/content-label'
import { ContentCard } from '@open-mercato/ui/primitives/content-card'
import { KeyIcon, KeyIconGlyph, type KeyIconColor } from '@open-mercato/ui/primitives/key-icon'
import { PaymentIcon, type PaymentIconCategory } from '@open-mercato/ui/primitives/payment-icon'
import { ChartLegend, ChartLegendDot, type ChartLegendColor } from '@open-mercato/ui/primitives/chart-legend'
import { navigationBrandArtwork } from '@open-mercato/ui/assets/navigation-brand-artwork'
import mastercard from '../assets/menu-mastercard.svg'
import spotify from '../assets/menu-spotify.svg'
import avatar from '../assets/avatar-photo.png'

const imageSource = (asset: string | { readonly src: string }) => typeof asset === 'string' ? asset : asset.src
const prefix = 'design_system.gallery.examples.keyComponents.'
type ContentKind = 'basic' | 'icon' | 'avatar' | 'provider' | 'brand' | 'company'

function ContentLeading({ kind, size = 40 }: { kind: ContentKind; size?: 40 | 48 }) {
  if (kind === 'basic') return null
  if (kind === 'icon') return <KeyIcon size={size}><KeyIconGlyph /></KeyIcon>
  if (kind === 'avatar') return <Avatar label="James Brown" size={size} src={imageSource(avatar)} />
  if (kind === 'provider') return <img alt="" src={imageSource(mastercard)} className="h-6 w-8 object-contain" />
  return <img alt="" src={kind === 'company' ? navigationBrandArtwork.synergyOriginal : imageSource(spotify)} className={size === 40 ? 'size-10 object-contain' : 'size-12 object-contain'} />
}

export function FieldLabelExample({ disabled = false, kind = 'all' }: { disabled?: boolean; kind?: 'all' | 'required' | 'optional' | 'information' | 'action' }) {
  const t = useT()
  const inputId = React.useId()
  const helpId = React.useId()
  const [help, setHelp] = React.useState(false)
  const information = <SimpleTooltip content={t(`${prefix}helpText`)}><CompactButton type="button" size={20} appearance="ghost" disabled={disabled} aria-label={t(`${prefix}information`)}><KeyIconGlyph name="labelInformation" /></CompactButton></SimpleTooltip>
  const action = <LinkButton type="button" size="sm" variant="gray" disabled={disabled} className="disabled:text-text-disabled disabled:opacity-100" aria-expanded={help} aria-controls={helpId} onClick={() => setHelp(value => !value)}>{t(`${prefix}help`)}</LinkButton>
  return <div className="grid w-80 max-w-full gap-2">
    <FieldLabel htmlFor={inputId} disabled={disabled} required={kind === 'required'} sublabel={kind === 'all' || kind === 'optional' ? t(`${prefix}optional`) : undefined} information={kind === 'all' || kind === 'information' ? information : undefined} action={kind === 'all' || kind === 'action' ? action : undefined}>{t(`${prefix}label`)}</FieldLabel>
    <Input id={inputId} disabled={disabled} aria-required={kind === 'required'} aria-describedby={help ? helpId : undefined} />
    <p id={helpId} hidden={!help} className="text-xs text-muted-foreground">{t(`${prefix}helpText`)}</p>
  </div>
}

export function FormFieldLabelExample() {
  const t = useT()
  return <div className="grid w-80 max-w-full gap-5">{[false, true].map(disabled => <FormField key={String(disabled)} sourceLabel label={t(`${prefix}label`)} labelSublabel={t(`${prefix}optional`)} disabled={disabled} description={t(`${prefix}hint`)}><Input /></FormField>)}</div>
}

export function HintTextExample({ state = 'default', icon = true }: { state?: 'default' | 'error' | 'disabled'; icon?: boolean }) {
  const t = useT()
  return <HintText state={state} leading={icon ? <KeyIconGlyph name="information" /> : undefined}>{t(`${prefix}hint`)}</HintText>
}

export function ContentLabelExample({ kind = 'basic', size = 40, configurable = false }: { kind?: Exclude<ContentKind, 'provider'>; size?: 40 | 48; configurable?: boolean }) {
  const t = useT()
  const [sublabel, setSublabel] = React.useState(true)
  const [badge, setBadge] = React.useState(false)
  const [toggle, setToggle] = React.useState(false)
  const [enabled, setEnabled] = React.useState(false)
  return <div className="grid w-full gap-5">
    {configurable ? <div className="flex flex-wrap gap-4"><CheckboxField label={t(`${prefix}sublabelControl`)} checked={sublabel} onCheckedChange={checked => setSublabel(checked === true)} /><CheckboxField label={t(`${prefix}badgeControl`)} checked={badge} onCheckedChange={checked => setBadge(checked === true)} /><CheckboxField label={t(`${prefix}toggleControl`)} checked={toggle} onCheckedChange={checked => setToggle(checked === true)} /></div> : null}
    <ContentLabel size={size} label={t(`${prefix}label`)} description={t(`${prefix}description`)} sublabel={sublabel ? t(`${prefix}sublabel`) : undefined} leading={kind === 'basic' ? undefined : <ContentLeading kind={kind} size={size} />} badge={badge ? <Badge size={20} tone="info" appearance="light">{t(`${prefix}new`)}</Badge> : undefined} trailing={toggle ? <Switch aria-label={t(`${prefix}enabled`)} checked={enabled} onCheckedChange={setEnabled} /> : undefined} className={configurable ? 'w-full max-w-md' : 'w-75 max-w-full'} />
    {toggle ? <output className="text-xs text-muted-foreground">{t(`${prefix}${enabled ? 'enabled' : 'disabled'}`)}</output> : null}
  </div>
}

export function ContentCardExample({ kind = 'basic', disabled = false }: { kind?: ContentKind; disabled?: boolean }) {
  const t = useT()
  const [visible, setVisible] = React.useState(true)
  return <div className="grid w-90 max-w-full gap-3">
    {visible ? <ContentCard label={t(`${prefix}label`)} description={t(`${prefix}description`)} sublabel={t(`${prefix}sublabel`)} leading={kind === 'basic' ? undefined : <ContentLeading kind={kind} />} badge={<Badge size={16} tone="info" appearance="light">{t(`${prefix}new`)}</Badge>} onDismiss={() => setVisible(false)} dismissLabel={t(`${prefix}dismiss`)} disabled={disabled} /> : <><output className="text-sm text-muted-foreground">{t(`${prefix}dismissed`)}</output><Button type="button" variant="outline" size="sm" onClick={() => setVisible(true)}>{t(`${prefix}restore`)}</Button></>}
  </div>
}

const keyColors: KeyIconColor[] = ['gray', 'blue', 'orange', 'red', 'green', 'yellow', 'purple', 'pink', 'teal']
const legendColors: ChartLegendColor[] = ['gray', 'light-gray', 'blue', 'orange', 'red', 'green', 'yellow', 'purple', 'sky', 'pink', 'teal']

export function KeyIconExamples({ appearance = 'stroke' }: { appearance?: 'stroke' | 'lighter' }) {
  const t = useT()
  return <div className="grid w-full gap-4"><p className="max-w-xl text-sm text-muted-foreground">{t(`${prefix}paletteNote`)}</p>{keyColors.map(color => <div key={color} className="flex flex-wrap items-center gap-4"><span className="w-20 text-xs text-muted-foreground">{t(`${prefix}color.${color}`)}</span>{([64, 56, 48, 40, 32] as const).map(size => <KeyIcon key={size} color={color} appearance={appearance} size={size} aria-label={`${t(`${prefix}color.${color}`)} ${size}`}><KeyIconGlyph /></KeyIcon>)}</div>)}</div>
}

export function PaymentIconExamples() {
  const t = useT()
  return <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">{(['water', 'gas', 'electricity', 'donate', 'internet', 'phone', 'rent', 'tax'] as PaymentIconCategory[]).map(category => <div key={category} className="flex items-center gap-3"><PaymentIcon category={category} /><span className="text-sm text-foreground">{t(`${prefix}payment.${category}`)}</span></div>)}</div>
}

export function ChartLegendExamples({ interactive = false }: { interactive?: boolean }) {
  const t = useT()
  const [hidden, setHidden] = React.useState<ChartLegendColor[]>([])
  return <div className="grid w-full gap-5"><div className="flex flex-wrap gap-5">{legendColors.map(color => interactive ? <Button key={color} type="button" variant="ghost" size="sm" aria-pressed={!hidden.includes(color)} onClick={() => setHidden(items => items.includes(color) ? items.filter(item => item !== color) : [...items, color])}><ChartLegend color={color} disabled={hidden.includes(color)}>{t(`${prefix}color.${color}`)}</ChartLegend></Button> : <ChartLegend key={color} color={color}>{t(`${prefix}color.${color}`)}</ChartLegend>)}{!interactive ? <ChartLegend disabled>{t(`${prefix}disabled`)}</ChartLegend> : null}</div>
    {interactive ? <div className="flex flex-wrap gap-3" role="list" aria-label={t(`${prefix}visibleSeries`)}>{legendColors.filter(color => !hidden.includes(color)).map(color => <div key={color} role="listitem" className="rounded-md border border-border p-3"><ChartLegend color={color}>{t(`${prefix}color.${color}`)}</ChartLegend></div>)}</div> : null}
  </div>
}

export function ChartLegendDotExamples({ size = 16 }: { size?: 16 | 20 }) {
  const t = useT()
  return <div className="flex flex-wrap items-center gap-5">{legendColors.map(color => <div key={color} className="flex items-center gap-1"><ChartLegendDot color={color} size={size} /><span className="text-xs text-muted-foreground">{t(`${prefix}color.${color}`)}</span></div>)}</div>
}
