import * as React from 'react'
import { Settings } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'
import { RadioGroup } from '@open-mercato/ui/primitives/radio'
import { RadioField } from '@open-mercato/ui/primitives/radio-field'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@open-mercato/ui/primitives/dialog'
import avatar from '../assets/avatar-photo.png'
import mastercard from '../assets/menu-mastercard.svg'
import spotify from '../assets/menu-spotify.svg'
import company from '../assets/menu-apex.svg'
import { selectionArtwork } from '../assets/selection-artwork'

export type SelectionCardKind = 'icon' | 'avatar' | 'provider' | 'brand' | 'company'
type SelectionControl = 'checkbox' | 'radio' | 'switch'
const imageSource = (asset: string | { readonly src: string }) => typeof asset === 'string' ? asset : asset.src

export const selectionSourceCardClassName = 'relative flex w-90 max-w-full items-start gap-3.5 rounded-selection-card bg-background p-4 ring-1 ring-inset ring-border shadow-xs transition-colors hover:bg-muted hover:shadow-none has-[[data-state=checked]]:ring-accent-indigo has-[[data-state=checked]]:shadow-none has-[:focus-visible]:shadow-focus [&_label]:after:absolute [&_label]:after:inset-0 [&_label]:after:rounded-selection-card [&_button]:relative [&_button]:z-10'

function SelectionLeading({ kind }: { kind: SelectionCardKind }) {
  if (kind === 'avatar') return <Avatar label="James Brown" size={40} src={imageSource(avatar)} aria-hidden="true" />
  const source = kind === 'icon' ? selectionArtwork.keyIcon : imageSource(kind === 'provider' ? mastercard : kind === 'brand' ? spotify : company)
  return <img src={source} alt="" aria-hidden="true" className={kind === 'provider' ? 'h-6 w-8 shrink-0 object-contain' : 'size-10 shrink-0 object-contain'} />
}

function SourceSelectionCard({ control, kind, state }: { control: SelectionControl; kind: SelectionCardKind; state: 'default' | 'active' | 'disabled' }) {
  const t = useT()
  const disabled = state === 'disabled'
  const fields = {
    label: t('design_system.gallery.samples.selection.label'),
    sublabel: t('design_system.gallery.samples.selection.sublabel'),
    description: t('design_system.gallery.samples.selection.description'),
    badge: <Badge size={16} appearance={disabled ? 'stroke' : 'light'} tone={disabled ? 'neutral' : 'info'} className={disabled ? 'border-border text-text-disabled' : undefined}>{t('design_system.gallery.samples.selection.new')}</Badge>,
    disabled,
    containerClassName: 'min-w-0 flex-1 gap-3.5',
    contentClassName: disabled ? '[&_label]:text-text-disabled [&_label]:opacity-100 [&_p]:text-text-disabled [&_span]:text-text-disabled' : undefined,
    className: cn('mt-0', disabled && control !== 'switch' && 'disabled:opacity-100 disabled:data-[state=checked]:bg-bg-disabled disabled:data-[state=checked]:border-border-disabled disabled:data-[state=checked]:text-background'),
  }
  return (
    <div data-slot="selection-source-card" data-kind={kind} data-disabled={disabled} className={cn(selectionSourceCardClassName, disabled && 'shadow-none hover:bg-background has-[[data-state=checked]]:ring-border')}>
      <SelectionLeading kind={kind} />
      {control === 'radio' ? <RadioField value={state} flip {...fields} /> : control === 'switch' ? <SwitchField defaultChecked={state === 'active'} {...fields} /> : <CheckboxField defaultChecked={state !== 'default'} flip {...fields} />}
    </div>
  )
}

export function SelectionSourceCardsDemo({ control, kind }: { control: SelectionControl; kind: SelectionCardKind }) {
  const t = useT()
  if (control === 'radio') return (
    <div className="grid gap-3">
      <RadioGroup defaultValue="active" aria-label={t('design_system.gallery.samples.selection.preferences')} className="gap-3">
        <SourceSelectionCard control={control} kind={kind} state="default" />
        <SourceSelectionCard control={control} kind={kind} state="active" />
      </RadioGroup>
      <RadioGroup value="disabled" disabled aria-label={t('design_system.gallery.samples.selection.preferences')}>
        <SourceSelectionCard control={control} kind={kind} state="disabled" />
      </RadioGroup>
    </div>
  )
  return <div className="grid gap-3">{(['default', 'active', 'disabled'] as const).map(state => <SourceSelectionCard key={state} control={control} kind={kind} state={state} />)}</div>
}

export function IntegrationSwitchDemo({ alignment, appearance }: { alignment: 'horizontal' | 'vertical'; appearance: 'card' | 'list' }) {
  const t = useT()
  const id = React.useId()
  const [checked, setChecked] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const horizontal = alignment === 'horizontal'
  const card = appearance === 'card'
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div data-slot="integration-switch" data-alignment={alignment} data-appearance={appearance} className={cn('relative flex max-w-full gap-3.5', horizontal ? 'w-154 flex-wrap items-center sm:flex-nowrap' : 'w-95 flex-col items-start', card && 'rounded-selection-card bg-background p-4 ring-1 ring-inset ring-border shadow-xs')}>
        <img src={card ? selectionArtwork.officeCard : selectionArtwork.officeList} alt="" className={cn('shrink-0', card ? 'size-10' : 'size-12')} />
        <div className={cn('flex min-w-0 flex-col gap-1', horizontal && 'min-w-40 flex-1')}>
          <div className="flex flex-wrap items-center gap-1.5">
            <span id={id} className={cn('font-medium text-foreground', card ? 'text-sm leading-5' : 'text-base leading-6')}>Microsoft Office 365</span>
            <Badge size={16} appearance="light" tone="info">{t('design_system.gallery.samples.selection.new')}</Badge>
          </div>
          <p className={cn('text-muted-foreground', card ? 'text-xs leading-4' : 'text-sm leading-5')}>{t('design_system.gallery.samples.selection.integrationDescription')}</p>
        </div>
        <Button asChild variant="outline" size="default" className={horizontal ? undefined : 'w-full'}><DialogTrigger><Settings aria-hidden="true" />{t('design_system.gallery.samples.selection.integrationManage')}</DialogTrigger></Button>
        <Switch aria-labelledby={id} checked={checked} onCheckedChange={setChecked} className={horizontal ? undefined : card ? 'absolute top-5 right-5' : 'absolute top-3 right-3'} />
      </div>
        <DialogContent onKeyDownCapture={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); setOpen(false) } }}>
          <DialogHeader><DialogTitle>{t('design_system.gallery.samples.selection.integrationDialog')}</DialogTitle><DialogDescription>{t('design_system.gallery.samples.selection.integrationDescription')}</DialogDescription></DialogHeader>
          <SwitchField label={t('design_system.gallery.samples.selection.integrationEnabled')} checked={checked} onCheckedChange={setChecked} />
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>{t('common.close')}</Button></DialogFooter>
        </DialogContent>
    </Dialog>
  )
}
