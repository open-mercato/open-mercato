import * as React from 'react'
import { CheckCircle2, ChevronRight, Info, Pencil, UserRound } from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { InlineInput } from '@open-mercato/ui/primitives/inline-input'
import { InlineSelectTrigger } from '@open-mercato/ui/primitives/inline-select'
import { Label } from '@open-mercato/ui/primitives/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@open-mercato/ui/primitives/tooltip'
import { marketingProducts } from '../assets/marketing-artwork'

export type MarketingControlState = 'default' | 'hover' | 'active' | 'filled' | 'placeholder' | 'focus' | 'disabled' | 'complete' | 'selected'
export type MarketingControlKind = 'step-item' | 'select' | 'input' | 'textarea' | 'amount' | 'tab-menu' | 'inline-input' | 'inline-select' | 'chart-tooltip' | 'selected-button' | 'product-image'
type ControlProps = { kind: MarketingControlKind; state?: MarketingControlState; size?: 'medium' | 'large'; side?: 'right' | 'left' | 'bottom' | 'top'; product?: number }
const key = (name: string) => `design_system.gallery.samples.marketing.${name}`
const focusStyle = 'focus-within:border-accent-orange-border focus-within:shadow-none'

function UnderlineField({ kind, state = 'default', size = 'medium' }: ControlProps) {
  const t = useT()
  const id = React.useId()
  const large = size === 'large' || kind === 'amount'
  const label = t(key(kind === 'textarea' ? 'description' : kind === 'amount' ? 'productPricing' : kind === 'select' ? 'category' : 'productName'))
  const placeholder = t(key(kind === 'textarea' ? 'productDescriptionPlaceholder' : kind === 'select' ? 'categoryPlaceholder' : 'productNamePlaceholder'))
  const [value, setValue] = React.useState(state === 'filled' ? kind === 'select' ? 'accessories' : kind === 'amount' ? '800' : t(key(kind === 'textarea' ? 'productDescription' : 'productNameExample')) : '')
  const active = state === 'active'
  return <div data-slot="marketing-control" data-kind={kind} className={cn('relative flex w-93 max-w-full flex-col gap-1.5 pb-3.5 after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-border focus-within:after:h-0.5 focus-within:after:bg-accent-orange-border', large ? 'h-20' : 'h-16', active && 'after:h-0.5 after:bg-accent-orange-border')}>
    <Label htmlFor={id} className="flex h-5 shrink-0 items-center gap-1 text-sm font-medium text-muted-foreground">{label}<Info aria-hidden="true" className="size-3 text-text-disabled" /></Label>
    {kind === 'select' ? <Select value={value} onValueChange={setValue}><SelectTrigger id={id} aria-label={label} className={cn('h-6 rounded-none border-0 bg-transparent p-0 text-lg font-medium shadow-none hover:bg-transparent focus:border-0 focus:shadow-none', state === 'hover' && 'text-muted-foreground', active && '[&_svg]:text-accent-orange-text')}><SelectValue placeholder={placeholder} /></SelectTrigger><SelectContent>{['accessories','computers','audio'].map(option => <SelectItem key={option} value={option}>{t(key(option))}</SelectItem>)}</SelectContent></Select> : kind === 'textarea' ? <Textarea id={id} aria-label={label} rows={1} value={value} onChange={event => setValue(event.target.value)} placeholder={placeholder} autoFocus={active} className={cn('h-6 min-h-6 resize-none rounded-none border-0 bg-transparent p-0 text-lg font-medium leading-6 shadow-none hover:bg-transparent focus-visible:shadow-none', state === 'hover' && 'placeholder:text-muted-foreground')} /> : <Input id={id} aria-label={label} value={value} onChange={event => setValue(event.target.value)} type={kind === 'amount' ? 'number' : 'text'} min={kind === 'amount' ? 0 : undefined} step={kind === 'amount' ? '0.01' : undefined} autoFocus={active} placeholder={kind === 'amount' ? '0.00' : placeholder} leading={kind === 'amount' ? <span aria-hidden="true" className={cn('text-title-4 font-medium', !value && !active && 'text-text-disabled')}>$</span> : undefined} className={cn('rounded-none border-0 bg-transparent p-0 shadow-none hover:bg-transparent focus-within:shadow-none', large ? 'h-10' : 'h-6')} inputClassName={cn('font-medium placeholder:text-text-disabled', large ? 'text-title-4 leading-10' : 'text-lg leading-6', state === 'hover' && 'placeholder:text-muted-foreground')} />}
  </div>
}

function InlineEditor({ state = 'placeholder' }: { state?: MarketingControlState }) {
  const t = useT()
  const [value, setValue] = React.useState(state === 'filled' ? 'James Brown' : '')
  const [draft, setDraft] = React.useState(value)
  const [editing, setEditing] = React.useState(state === 'focus')
  const disabled = state === 'disabled'
  const save = () => { setValue(draft.trim()); setEditing(false) }
  const cancel = () => { setDraft(value); setEditing(false) }
  return <div data-slot="marketing-control" data-kind="inline-input" className="w-78 max-w-full">
    {editing ? <InlineInput autoFocus value={draft} onChange={event => setDraft(event.target.value)} aria-label={t(key('name'))} placeholder={t(key('namePlaceholder'))} className={cn('h-10 gap-2 rounded-lg border-accent-orange-border bg-background px-3', focusStyle)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); cancel() } if (event.key === 'Enter') { event.preventDefault(); save() } }} trailing={<div className="flex gap-2"><Button variant="ghost" className="h-5 p-0 text-sm font-normal" onClick={cancel}>{t(key('cancel'))}</Button><Button variant="ghost" className="h-5 p-0 text-sm font-normal text-accent-orange-text" onClick={save}>{t(key('save'))}</Button></div>} /> : <Button disabled={disabled} variant="ghost" onClick={() => setEditing(true)} className={cn('h-10 w-full justify-between rounded-lg px-3 text-sm font-normal', state === 'hover' && 'bg-muted', !value && 'text-muted-foreground')}><span className="truncate">{value || t(key('namePlaceholder'))}</span><Pencil aria-hidden="true" className="size-4 shrink-0 text-text-disabled" /></Button>}
  </div>
}

function InlineLanguage({ state = 'placeholder' }: { state?: MarketingControlState }) {
  const t = useT()
  const [value, setValue] = React.useState(state === 'filled' ? 'en' : '')
  const [open, setOpen] = React.useState(false)
  return <div data-slot="marketing-control" data-kind="inline-select" className="w-64 max-w-full"><Select value={value} onValueChange={setValue} open={open} onOpenChange={setOpen} disabled={state === 'disabled'}><InlineSelectTrigger aria-label={t(key('language'))} className={cn('h-10 rounded-lg px-3 focus:border-accent-orange-border focus:shadow-none', state === 'hover' && 'bg-muted', state === 'focus' && 'border-accent-orange-border')}><SelectValue placeholder={t(key('languagePlaceholder'))} /></InlineSelectTrigger><SelectContent>{['en','pl','de','es','ko'].map(language => <SelectItem key={language} value={language}>{t(key(`language${language}`))}</SelectItem>)}</SelectContent></Select></div>
}

function StepItem({ state = 'default' }: { state?: MarketingControlState }) {
  const t = useT()
  const [selected, setSelected] = React.useState(state === 'active')
  return <Button data-slot="marketing-control" data-kind="step-item" variant="ghost" aria-pressed={selected} onClick={() => setSelected(current => !current)} className={cn('h-11 w-45 max-w-full flex-col items-start justify-start gap-1 rounded-none border-r-2 border-transparent p-0 pr-6 text-sm font-normal hover:bg-transparent', selected && 'border-r-accent-orange')}><span className={cn('flex h-5 items-center gap-1', selected ? 'text-accent-orange-text' : 'text-muted-foreground')}>{t(key('step'), undefined, { current: 1, total: 5 })}{state === 'complete' ? <CheckCircle2 aria-hidden="true" className="size-3.5 fill-status-success-icon text-status-success-foreground" /> : null}</span><span className="h-5">{t(key('generalInformation'))}</span></Button>
}

function SelectedAmount({ state = 'default' }: { state?: MarketingControlState }) {
  const locale = useLocale()
  const [selected,setSelected] = React.useState(state === 'selected')
  return <Button data-slot="marketing-control" data-kind="selected-button" aria-pressed={selected} disabled={state === 'disabled'} variant={selected ? 'default' : 'outline'} onClick={() => setSelected(current => !current)} className={cn('h-7 gap-1.5 rounded-md border border-border px-2.5 py-1 font-normal', state === 'hover' && 'bg-muted', selected && 'border-transparent bg-accent-orange/10 text-accent-orange-text hover:bg-accent-orange/20')}>
    {selected ? <CheckCircle2 aria-hidden="true" className="size-3.5" /> : null}{new Intl.NumberFormat(locale).format(800)}
  </Button>
}

function MenuItem({ state = 'default' }: { state?: MarketingControlState }) {
  const t = useT()
  const [selected,setSelected] = React.useState(state === 'active')
  return <Button data-slot="marketing-control" data-kind="tab-menu" variant="ghost" aria-pressed={selected} onClick={() => setSelected(current => !current)} className={cn('h-9 w-56 max-w-full justify-start gap-2 rounded-lg p-2 text-sm font-medium', (state === 'hover' || selected) && 'bg-muted')}><UserRound aria-hidden="true" className={cn('size-5', selected ? 'text-accent-orange-text' : 'text-muted-foreground')} /><span className="flex-1 text-left">{t(key('accountSettings'))}</span><ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" /></Button>
}

function ChartTooltipExample({ side = 'right' }: { side?: 'right' | 'left' | 'bottom' | 'top' }) {
  const t = useT()
  const locale = useLocale()
  const [open,setOpen] = React.useState(true)
  return <div data-slot="marketing-control" data-kind="chart-tooltip" className="flex h-40 w-80 max-w-full items-center justify-center"><TooltipProvider delayDuration={0}><Tooltip open={open} onOpenChange={setOpen}><Button asChild variant="ghost" size="sm"><TooltipTrigger>{t(key('chartPoint'))}</TooltipTrigger></Button><TooltipContent side={side === 'right' ? 'left' : side === 'left' ? 'right' : side === 'bottom' ? 'top' : 'bottom'} variant="light" className="h-16 w-39.5 rounded-lg p-3 shadow-lg"><p className="text-xs leading-4 text-muted-foreground">{new Intl.DateTimeFormat(locale,{weekday:'short',month:'short',day:'numeric',timeZone:'UTC'}).format(new Date('2026-01-08T00:00:00Z'))}</p><div className="mt-1 flex items-center gap-1.5"><span className="text-lg font-medium leading-6">{new Intl.NumberFormat(locale).format(3484)}</span><span className="text-xs text-status-success-icon">+7.1%</span><span className="text-xs text-muted-foreground">{t(key('versusPrevious'))}</span></div></TooltipContent></Tooltip></TooltipProvider></div>
}

export function MarketingControlDemo(props: ControlProps) {
  if (['input','select','textarea','amount'].includes(props.kind)) return <UnderlineField {...props} />
  if (props.kind === 'inline-input') return <InlineEditor state={props.state} />
  if (props.kind === 'inline-select') return <InlineLanguage state={props.state} />
  if (props.kind === 'step-item') return <StepItem state={props.state} />
  if (props.kind === 'selected-button') return <SelectedAmount state={props.state} />
  if (props.kind === 'tab-menu') return <MenuItem state={props.state} />
  if (props.kind === 'chart-tooltip') return <ChartTooltipExample side={props.side} />
  const product = marketingProducts[props.product ?? 0]
  return <img data-slot="marketing-control" data-kind="product-image" src={product.src} alt={product.name} className="size-50 max-w-full object-contain" />
}
