import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { BadgeCheck, Bell, CalendarDays, ChevronDown, ChevronRight, ChevronsUpDown, Cloud, CreditCard, Download, FileText, Folder, Gift, Headphones, Home, Layers, PanelLeftClose, PanelLeftOpen, Pause, Play, Plus, Search, Settings, UserRound, Users, X } from 'lucide-react'
import { PageHeader } from '@open-mercato/ui/backend/Page'
import { Avatar, AvatarStack } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import { CompactButton } from '@open-mercato/ui/primitives/compact-button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { LinkButton } from '@open-mercato/ui/primitives/link-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { Progress } from '@open-mercato/ui/primitives/progress'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Sidebar, SidebarContent, SidebarFeatureCard, SidebarFooter, SidebarHeader, SidebarIdentity, SidebarItem, Topbar } from '@open-mercato/ui/primitives/sidebar'
import { navigationBrandArtwork } from '@open-mercato/ui/assets/navigation-brand-artwork'
import avatarIllustration from '../assets/avatar-illustration.png'
import avatarMemoji from '../assets/avatar-memoji.png'
import avatarPhoto from '../assets/avatar-photo.png'

const avatarImages = [avatarIllustration, avatarMemoji, avatarPhoto].map(image => typeof image === 'string' ? image : image.src)
type Product = 'hr' | 'finance'
type HeaderType = 'basic' | 'avatar' | 'icon' | 'brand' | 'company'
type FeatureType = 'meeting' | 'progress' | 'link' | 'gift' | 'storage' | 'support'
type FeatureAppearance = 'stroke' | 'gray' | 'primary' | 'neutral'
const navItems = {
  hr: ['dashboard', 'calendar', 'timeOff', 'projects', 'teams', 'integrations', 'benefits', 'documents'],
  finance: ['dashboard', 'cards', 'transfer', 'transactions', 'payments', 'exchange'],
} as const
const navIcons = [Home, CalendarDays, CreditCard, Folder, Users, Layers, Gift, FileText]

function ShellAvatar({ size = 40, product = 'hr' }: { size?: 24 | 32 | 40 | 48; product?: Product }) {
  return <Avatar src={product === 'hr' ? navigationBrandArtwork.sophiaAvatar : navigationBrandArtwork.arthurAvatar} label={product === 'hr' ? 'Sophia Williams' : 'Arthur Taylor'} size={size} />
}

function WorkspaceIdentity({ product, onProductChange, collapsed = false, profile = false }: { product: Product; onProductChange?: (product: Product) => void; collapsed?: boolean; profile?: boolean }) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const name = product === 'hr' ? 'Synergy' : 'Apex'
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <SidebarIdentity collapsed={collapsed} label={profile ? product === 'hr' ? 'Sophia Williams' : 'Arthur Taylor' : name}
        description={profile ? product === 'hr' ? 'sophia@example.com' : 'arthur@example.com' : t(`design_system.gallery.examples.shell.${product}`)}
        leading={profile ? <ShellAvatar product={product} /> : <img src={navigationBrandArtwork[product === 'hr' ? 'synergyOriginal' : 'apexOriginal']} alt="" className="size-10" />}
        badge={profile ? <BadgeCheck className="size-3.5 fill-status-info-icon stroke-status-info-solid-foreground" aria-hidden="true" /> : undefined}
        trailing={profile ? <ChevronRight className="size-5" /> : <span className="flex size-6 items-center justify-center rounded-sm border border-border bg-background shadow-xs"><ChevronsUpDown className="size-5" /></span>} />
    </PopoverTrigger>
    <PopoverContent className="w-64 p-3">
      {profile ? <p className="text-sm">{t('design_system.gallery.examples.shell.localProfile')}</p> : <div className="flex flex-col gap-1">
        {(['hr', 'finance'] as const).map(value => <Button key={value} type="button" variant="ghost" aria-pressed={product === value} onClick={() => { onProductChange?.(value); setOpen(false) }}>{value === 'hr' ? 'Synergy' : 'Apex'}</Button>)}
      </div>}
    </PopoverContent>
  </Popover>
}

export function PageHeaderExample({ appearance = 'page', type = 'basic', configurable = false }: { appearance?: 'page' | 'section'; type?: HeaderType; configurable?: boolean }) {
  const t = useT()
  const [options, setOptions] = React.useState({ divider: true, search: true, notification: true, actions: true, second: true, dropdown: false })
  const [query, setQuery] = React.useState('')
  const [dialog, setDialog] = React.useState(false)
  const [draft, setDraft] = React.useState('')
  const [saved, setSaved] = React.useState('')
  const [period, setPeriod] = React.useState('month')
  const [workspace, setWorkspace] = React.useState<Product>('hr')
  const submit = () => { if (draft.trim()) { setSaved(draft.trim()); setDialog(false) } }
  const copy = (key: string) => t(`design_system.gallery.examples.shell.${key}`)
  const leading = type === 'avatar' ? <ShellAvatar size={48} />
    : type === 'icon' ? <span className="flex size-12 items-center justify-center rounded-full border border-border"><UserRound className="size-6" aria-hidden="true" /></span>
      : type === 'brand' ? <img src={navigationBrandArtwork.loom} alt="Loom" className="size-12" />
        : type === 'company' ? <img src={navigationBrandArtwork.apexOriginal} alt="Apex" className="size-12" /> : undefined
  const periodMenu = <Popover><PopoverTrigger asChild><Button type="button" variant="outline" size="lg"><CalendarDays className="size-5" />{copy(period)}<ChevronDown className="size-5" /></Button></PopoverTrigger><PopoverContent className="p-2">{['month', 'year'].map(value => <Button key={value} type="button" variant="ghost" aria-pressed={period === value} onClick={() => setPeriod(value)}>{copy(value)}</Button>)}</PopoverContent></Popover>
  const titleAction = options.dropdown && appearance === 'section' ? <Popover><PopoverTrigger asChild><CompactButton fullRadius aria-label={copy('switchWorkspace')}><ChevronDown /></CompactButton></PopoverTrigger><PopoverContent className="p-3">{(['hr', 'finance'] as const).map(value => <Button key={value} type="button" variant="ghost" onClick={() => setWorkspace(value)}>{copy(value)}</Button>)}</PopoverContent></Popover> : undefined
  return <div className="w-full">
    {configurable ? <div className="mb-4 flex flex-wrap gap-4">{(Object.keys(options) as Array<keyof typeof options>).map(key => <label key={key} className="flex items-center gap-2 text-sm"><Checkbox checked={options[key]} onCheckedChange={checked => setOptions(current => ({ ...current, [key]: checked === true }))} />{copy(key)}</label>)}</div> : null}
    <PageHeader appearance={appearance} leading={leading} divider={options.divider} title={configurable ? copy(workspace) : copy('title')} description={copy('description')} titleAction={titleAction}
      actions={<>
        {options.search ? <Popover><PopoverTrigger asChild><IconButton variant="ghost" className="size-10 rounded-lg data-[state=open]:bg-muted" aria-label={copy('search')}><Search className="size-5" /></IconButton></PopoverTrigger><PopoverContent className="p-3"><SearchInput value={query} onChange={setQuery} aria-label={copy('search')} /><p className="mt-2 text-sm" role="status">{query ? t('design_system.gallery.examples.shell.localQuery', { query }) : copy('searchHint')}</p></PopoverContent></Popover> : null}
        {options.notification && appearance === 'page' ? <Popover><PopoverTrigger asChild><IconButton variant="ghost" className="size-10 rounded-lg data-[state=open]:bg-muted" aria-label={copy('notifications')}><Bell className="size-5" /></IconButton></PopoverTrigger><PopoverContent className="p-4 text-sm">{copy('noNotifications')}</PopoverContent></Popover> : null}
        {options.dropdown && appearance === 'page' ? periodMenu : null}
        {options.actions ? <>
          {options.second ? appearance === 'page' ? <Button type="button" variant="outline" size="lg" onClick={() => { setDraft(''); setDialog(true) }}><CalendarDays className="size-5" />{copy('schedule')}</Button> : <Button asChild variant="outline" size="lg"><a download="page-header-example.json" href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify({ title: copy('title'), description: copy('description') }, null, 2))}`}><Download className="size-5" />{copy('export')}</a></Button> : null}
          <Button type="button" variant="primary-filled" size="lg" onClick={() => { setDraft(''); setDialog(true) }}><Plus className="size-5" />{copy(appearance === 'page' ? 'create' : 'invite')}</Button>
        </> : null}
      </>} />
    {saved ? <output className="block px-8 pt-3 text-sm">{t('design_system.gallery.examples.shell.savedDraft', { title: saved })}</output> : null}
    <Dialog open={dialog} onOpenChange={setDialog}><DialogContent onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); submit() } }}>
      <DialogHeader><DialogTitle>{copy('localDraft')}</DialogTitle><DialogDescription>{copy('localDraftHint')}</DialogDescription></DialogHeader>
      <Input value={draft} onChange={event => setDraft(event.target.value)} aria-label={copy('draftTitle')} autoFocus />
      <DialogFooter><Button type="button" variant="outline" onClick={() => setDialog(false)}>{copy('cancel')}</Button><Button type="button" disabled={!draft.trim()} onClick={submit}>{copy('saveDraft')}</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>
}

function FeatureCard({ type, appearance }: { type: FeatureType; appearance: FeatureAppearance }) {
  const t = useT()
  const [dismissed, setDismissed] = React.useState(false)
  const [paused, setPaused] = React.useState(true)
  const [details, setDetails] = React.useState(false)
  const id = React.useId()
  const copy = (key: string) => t(`design_system.gallery.examples.shell.${key}`)
  const inverse = appearance === 'primary' || appearance === 'neutral'
  const descriptionClass = inverse ? 'text-current' : 'text-muted-foreground'
  const link = (key: string) => <LinkButton asChild variant="modifiable" underline="always" className={type === 'link' ? undefined : 'self-start'}><a href={`#${id}`} onClick={() => setDetails(true)}>{copy(key)}{type === 'meeting' ? <ChevronRight className="size-5" /> : null}</a></LinkButton>
  if (dismissed) return <div className="flex min-h-27 w-58 items-center justify-center rounded-lg border border-dashed border-border"><Button type="button" variant="outline" onClick={() => setDismissed(false)}>{copy('restoreCard')}</Button></div>
  return <div className="w-58 max-w-full">
    <SidebarFeatureCard appearance={appearance} className={cn('flex flex-col', type === 'gift' ? 'flex-row items-center gap-3 p-3' : type === 'link' || type === 'support' ? 'gap-3' : 'gap-4', type === 'link' && 'items-center text-center', type === 'storage' && 'px-2 pt-4 pb-2')}>
      {(type === 'meeting' || type === 'support') ? <CompactButton appearance="modifiable" className="absolute top-3 right-3 text-current" aria-label={copy('dismissCard')} onClick={() => setDismissed(true)}><X /></CompactButton> : null}
      {type === 'meeting' ? <>
        <div data-slot="sidebar-meeting-avatars" className="flex w-fit items-center gap-1.5 rounded-full bg-background p-0.5 pr-2 text-foreground ring-1 ring-inset ring-border"><AvatarStack size={24} max={3} className="[&_[data-slot=avatar-stack-item]+[data-slot=avatar-stack-item]]:-ml-0.5">{avatarImages.map((src, index) => <Avatar key={`meeting-avatar-${index}`} label={String(index + 1)} src={src} size={24} />)}</AvatarStack><span className="w-4 text-xs leading-4 text-muted-foreground">+4</span></div>
        <div className="flex flex-col gap-1"><p className="text-sm font-medium">{copy('meeting')}</p><p className={cn('text-xs', descriptionClass)}>{copy('meetingTime')}</p></div>{link('join')}
      </> : null}
      {type === 'progress' ? <><div className="flex flex-col gap-1"><p className="text-sm font-medium">{copy('capacity')}</p><p className={cn('text-xs', descriptionClass)}>{copy('capacityHint')}</p></div><Progress value={90} size="md" aria-label={copy('capacity')} className={inverse ? 'bg-current/20' : undefined} fillClassName={inverse ? 'bg-current' : undefined} />{link('upgrade')}</> : null}
      {(type === 'link' || type === 'gift') ? <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-full', inverse ? 'bg-background text-status-info-icon' : 'bg-status-info-bg text-status-info-icon')}>{type === 'link' ? <Cloud className="size-5" /> : <Gift className="size-5" />}</span> : null}
      {type === 'link' ? <><p className={cn('text-sm', descriptionClass)}>{copy('plansHint')}</p>{link('plans')}</> : null}
      {type === 'gift' ? <div className="flex min-w-0 flex-col gap-1"><p className="text-sm font-medium">{copy('gift')}</p><p className={cn('text-xs', descriptionClass)}>{copy('giftHint')}</p></div> : null}
      {type === 'storage' ? <><div className="px-2"><div className="mb-1.5 flex items-center justify-between text-sm"><span>{copy('storage')}</span><span className="text-xs">80%</span></div><Progress value={80} size="md" aria-label={copy('storage')} className={inverse ? 'bg-current/20' : undefined} fillClassName={inverse ? 'bg-current' : undefined} /><p className={cn('mt-1.5 text-xs', descriptionClass)}>{copy('storageHint')}</p></div><Button type="button" variant="ghost" className="h-8 w-full justify-start gap-1 rounded-md bg-background px-2.5 py-1.5 text-xs text-foreground hover:bg-muted" aria-pressed={!paused} onClick={() => setPaused(value => !value)}>{copy('sync')}<span className="flex-1 text-left text-muted-foreground">{copy(paused ? 'paused' : 'running')}</span>{paused ? <Play className="size-5" /> : <Pause className="size-5" />}</Button></> : null}
      {type === 'support' ? <><div className="flex items-center gap-2.5 pr-4"><Headphones className="size-6" /><p className="text-base">{copy('supportTitle')}</p></div><p className={cn('text-sm', descriptionClass)}>{copy('supportHint')}</p></> : null}
    </SidebarFeatureCard>
    {(type === 'meeting' || type === 'progress' || type === 'link') ? <div id={id} tabIndex={-1}>{details ? <div data-slot="sidebar-feature-details" className="mt-3 rounded-md border border-border p-3 text-sm"><p className="font-medium">{copy('localDestination')}</p><p className="mt-1 text-muted-foreground">{copy(type === 'meeting' ? 'meetingTime' : 'plansHint')}</p></div> : null}</div> : null}
  </div>
}

export function SidebarFeatureExample({ type = 'meeting' }: { type?: FeatureType }) {
  return <div className="flex w-full flex-wrap items-start gap-6">{(['stroke', 'gray', 'primary', 'neutral'] as const).map(appearance => <FeatureCard key={appearance} type={type} appearance={appearance} />)}</div>
}

export function SidebarItemsExample() {
  const t = useT()
  const [selected, setSelected] = React.useState([0, 0])
  return <div className="flex flex-wrap items-start gap-6">{[false, true].map((collapsed, group) => <div key={String(collapsed)} className={collapsed ? 'w-9' : 'w-58'}>
    {['dashboard', 'calendar', 'projects'].map((key, index) => <SidebarItem key={key} collapsed={collapsed} icon={React.createElement(navIcons[index], { className: 'size-5' })} active={selected[group] === index} trailing={<ChevronRight className="size-5" />} onClick={() => setSelected(current => current.map((value, currentGroup) => currentGroup === group ? index : value))}>{t(`design_system.gallery.examples.shell.${key}`)}</SidebarItem>)}
    <output className="sr-only">{t(`design_system.gallery.examples.shell.${['dashboard', 'calendar', 'projects'][selected[group]]}`)}</output>
  </div>)}</div>
}

export function SidebarIdentityExample() {
  const [product, setProduct] = React.useState<Product>('hr')
  return <div className="flex flex-wrap items-start gap-6">{[false, true].map(collapsed => <div key={String(collapsed)} className={collapsed ? 'w-16' : 'w-62'}><WorkspaceIdentity collapsed={collapsed} product={product} onProductChange={setProduct} /><WorkspaceIdentity collapsed={collapsed} product={product} profile /></div>)}</div>
}

export function SidebarExample({ product = 'hr', collapsed = false, feature = false }: { product?: Product; collapsed?: boolean; feature?: boolean }) {
  const t = useT()
  const [compact, setCompact] = React.useState(collapsed)
  const [workspace, setWorkspace] = React.useState(product)
  const [active, setActive] = React.useState('dashboard')
  const copy = (key: string) => t(`design_system.gallery.examples.shell.${key}`)
  return <div className="flex w-full flex-wrap items-start gap-6">
    <Sidebar collapsed={compact} className="max-w-full" aria-label={copy('sidebar')}>
      <SidebarHeader className="relative after:absolute after:inset-x-5 after:bottom-0 after:border-b after:border-border after:content-['']"><WorkspaceIdentity collapsed={compact} product={workspace} onProductChange={value => { setWorkspace(value); setActive('dashboard') }} /></SidebarHeader>
      <SidebarContent>
        <nav aria-label={copy('main')} className="w-full"><p className={cn('mb-3 px-1 text-xs uppercase text-muted-foreground', compact && 'sr-only')}>{copy('main')}</p><div className="flex flex-col gap-1">
          {navItems[workspace].map((key, index) => <SidebarItem key={key} icon={React.createElement(navIcons[index], { className: 'size-5' })} active={active === key} trailing={active === key ? <ChevronRight className="size-5" /> : undefined} className={active === key ? cn("before:absolute before:top-2 before:h-5 before:w-1 before:rounded-r before:bg-foreground before:content-['']", compact ? 'before:-left-5.5' : 'before:-left-5') : undefined} onClick={() => setActive(key)}>{copy(key)}</SidebarItem>)}
        </div></nav>
        {!compact && workspace === 'hr' && !feature ? <nav aria-label={copy('favorites')}><p className="mb-3 px-1 text-xs uppercase text-muted-foreground">{copy('favorites')}</p>{['Loom Mobile App', 'Monday Redesign', 'Udemy Courses'].map((name, index) => <SidebarItem key={name} icon={<Folder className="size-5" />} active={active === name} trailing={<span className="text-xs">⌘{index + 1}</span>} onClick={() => setActive(name)}>{name}</SidebarItem>)}</nav> : null}
        <nav aria-label={copy('support')} className="mt-auto w-full">{['settings', 'support'].map(key => <SidebarItem key={key} icon={key === 'settings' ? <Settings /> : <Headphones />} active={active === key} onClick={() => setActive(key)}>{copy(key)}</SidebarItem>)}</nav>
        {feature && !compact ? <FeatureCard type={workspace === 'hr' ? 'meeting' : 'progress'} appearance="stroke" /> : null}
      </SidebarContent>
      <SidebarFooter><WorkspaceIdentity collapsed={compact} product={workspace} profile /></SidebarFooter>
    </Sidebar>
    <div className="min-w-0 flex-1 basis-64 space-y-4 py-5"><IconButton variant="outline" aria-label={copy(compact ? 'expand' : 'collapse')} aria-expanded={!compact} onClick={() => setCompact(value => !value)}>{compact ? <PanelLeftOpen /> : <PanelLeftClose />}</IconButton><h3 className="text-lg font-medium">{navItems[workspace].some(key => key === active) || ['settings', 'support'].includes(active) ? copy(active) : active}</h3><p className="text-sm text-muted-foreground">{copy('previewHint')}</p></div>
  </div>
}

export function TopbarExample({ product = 'hr', icons = false }: { product?: Product; icons?: boolean }) {
  const t = useT()
  const [active, setActive] = React.useState('dashboard')
  const [query, setQuery] = React.useState('')
  const copy = (key: string) => t(`design_system.gallery.examples.shell.${key}`)
  const items = product === 'hr' ? ['dashboard', 'calendar', 'timeOff', 'projects', 'teams', 'settings'] : navItems.finance
  return <div className="w-full overflow-x-auto"><Topbar className="w-360 flex-nowrap">
    <img src={navigationBrandArtwork[product === 'hr' ? 'synergyOriginal' : 'apexOriginal']} alt={product === 'hr' ? 'Synergy' : 'Apex'} className="size-10" />
    <nav aria-label={copy('topbar')} className="flex min-w-0 flex-1 items-center gap-1">{items.filter(key => copy(key).toLocaleLowerCase().includes(query.toLocaleLowerCase())).map((key, index) => <SidebarItem key={key} icon={icons ? React.createElement(navIcons[index], { className: 'size-5' }) : null} active={active === key} className={cn('w-auto flex-1 px-2', !icons && '[&>span:first-child]:hidden')} onClick={() => setActive(key)}>{copy(key)}</SidebarItem>)}<Popover><PopoverTrigger asChild><Button type="button" variant="ghost" className="h-9 gap-2 px-3">{copy('others')}<ChevronDown className="size-5" /></Button></PopoverTrigger><PopoverContent className="p-2">{['settings', 'support'].map(key => <Button key={key} type="button" variant="ghost" onClick={() => setActive(key)}>{copy(key)}</Button>)}</PopoverContent></Popover></nav>
    <SearchInput value={query} onChange={setQuery} className="w-58" aria-label={copy('filterNavigation')} />
    <Popover><PopoverTrigger asChild><IconButton variant="ghost" className="size-10 rounded-lg data-[state=open]:bg-muted" aria-label={copy('notifications')}><Bell className="size-5" /></IconButton></PopoverTrigger><PopoverContent className="p-4 text-sm">{copy('noNotifications')}</PopoverContent></Popover>
    <Popover><PopoverTrigger asChild><Button type="button" variant="ghost" className="h-10 gap-1.5 rounded-lg py-1 pr-2 pl-1 data-[state=open]:bg-muted"><ShellAvatar size={32} product={product} /><span>{product === 'hr' ? 'Sophia' : 'Arthur'}</span><ChevronDown className="size-5" /></Button></PopoverTrigger><PopoverContent className="p-4 text-sm">{copy('localProfile')}</PopoverContent></Popover>
  </Topbar><output className="sr-only">{copy(active)}</output></div>
}

export function NavigationBrandsExample() {
  return <div className="flex flex-wrap gap-6">{Object.entries(navigationBrandArtwork).filter(([key]) => key !== 'loom' && !key.endsWith('Avatar')).map(([key, src]) => <figure key={key} className="space-y-2"><div className={cn('flex size-20 items-center justify-center rounded-lg', key.endsWith('White') ? 'bg-status-info-solid' : key.endsWith('Black') ? 'bg-accent-indigo-foreground' : 'bg-background')}><img src={src} alt={key.startsWith('synergy') ? 'Synergy' : 'Apex'} className="size-10" /></div><figcaption className="text-xs text-muted-foreground">{key}</figcaption></figure>)}</div>
}
