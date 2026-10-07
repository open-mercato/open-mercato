import * as React from 'react'
import {
  CircleAlert,
  CircleCheck,
  Globe,
  FilePlus2,
  Info,
  LayoutDashboard,
  Settings,
  TriangleAlert,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
import { StepperDots } from '@open-mercato/ui/primitives/step-indicator'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@open-mercato/ui/primitives/dialog'
import {
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@open-mercato/ui/primitives/drawer'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@open-mercato/ui/primitives/sheet'
import {
  Popover,
  PopoverArrow,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from '@open-mercato/ui/primitives/popover'
import { SimpleTooltip, TooltipCard } from '@open-mercato/ui/primitives/tooltip'
import {
  CommandMenu,
  CommandMenuContent,
  CommandMenuEmpty,
  CommandMenuFooter,
  CommandMenuGroup,
  CommandMenuInput,
  CommandMenuItem,
  CommandMenuList,
  CommandMenuSeparator,
  CommandMenuTrigger,
} from '@open-mercato/ui/primitives/command-menu'
import { CommandSourceExample } from '../demos/menus'
import { commandSourceCode } from '../demos/menu-sources'
import type { GalleryEntry } from '../types'

// Component titles and variant names are proper nouns from the codebase and
// are deliberately not translated. `code` MUST contain the entry's importPath
// (enforced by the registry-integrity test) and is always reviewed alongside
// its sibling `render`.

type FooterKind = 'basic' | 'equal' | 'checkbox' | 'toggle' | 'stepper' | 'link' | 'information'
type HeaderKind = 'basic' | 'default' | 'error' | 'warning' | 'success' | 'info'
type OverlayExample = { id: string; title: string; header?: HeaderKind; compact?: boolean; footer?: FooterKind; alignment?: 'horizontal' | 'vertical'; status?: boolean }

const headerIcons = { default: Settings, error: CircleAlert, warning: TriangleAlert, success: CircleCheck, info: Info }

function FooterLeading({ kind }: { kind: FooterKind }) {
  const t = useT()
  if (kind === 'checkbox') return <CheckboxField label={t('design_system.gallery.samples.overlay.remember')} />
  if (kind === 'toggle') return <SwitchField label={t('design_system.gallery.samples.overlay.remember')} />
  if (kind === 'stepper') return <StepperDots count={3} activeStep={0} size="sm" aria-label={t('design_system.gallery.samples.overlay.steps')} />
  if (kind === 'link') return <Button variant="link" size="sm">{t('design_system.gallery.samples.overlay.help')}</Button>
  if (kind === 'information') return <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Info aria-hidden="true" className="size-4" />{t('design_system.gallery.samples.overlay.information')}</span>
  return null
}

function DialogExample({ header = 'basic', compact = false, footer = 'basic', alignment = 'horizontal', status = false }: Omit<OverlayExample, 'id' | 'title'>) {
  const t = useT()
  const Icon = header === 'basic' ? undefined : headerIcons[header]
  return (
    <Dialog>
      <section data-dialog-preview="" aria-label={t('design_system.gallery.samples.overlay.title')} className="relative w-full max-w-md overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm">
        {!status ? <X aria-hidden="true" className="absolute right-4 top-4 size-4 text-muted-foreground" /> : null}
        <DialogHeader className={status ? 'p-6' : 'p-4 pr-12'} compact={compact} alignment={alignment} leadingTone={header === 'basic' ? 'default' : header} leading={Icon ? <Icon className={compact || status ? 'size-6' : 'size-5'} /> : undefined}>
          <DialogTitle className={status ? 'text-base font-medium leading-6 tracking-normal' : 'text-sm font-medium leading-5 tracking-normal'}>{t('design_system.gallery.samples.overlay.title')}</DialogTitle>
          <DialogDescription className={compact ? 'sr-only' : undefined}>{t('design_system.gallery.samples.overlay.description')}</DialogDescription>
        </DialogHeader>
        {!status ? <div className="px-4 py-6 text-sm text-muted-foreground">{t('design_system.gallery.samples.overlay.body')}</div> : null}
        <DialogFooter layout={footer === 'equal' ? 'equal' : 'default'} leading={footer === 'basic' || footer === 'equal' ? undefined : <FooterLeading kind={footer} />} className="mx-0 gap-3 px-4 py-4">
          <Button asChild variant="outline" size="default"><span>{t('design_system.gallery.samples.overlay.cancel')}</span></Button>
          <Button asChild variant="primary-filled" size="default"><span>{t('design_system.gallery.samples.overlay.continue')}</span></Button>
        </DialogFooter>
      </section>
    </Dialog>
  )
}

function DrawerExample({ header = 'basic', compact = false, footer = 'basic' }: Omit<OverlayExample, 'id' | 'title'>) {
  const t = useT()
  return (
    <Drawer>
      <DrawerTrigger asChild><Button variant="outline">{t('design_system.gallery.samples.overlay.openDrawer')}</Button></DrawerTrigger>
      <DrawerContent closeAriaLabel={t('design_system.gallery.samples.overlay.close')}>
        <DrawerHeader compact={compact} leading={header === 'default' ? <Settings className={compact ? 'size-6' : 'size-5'} /> : undefined}>
          <DrawerTitle className="text-sm font-medium leading-5">{t('design_system.gallery.samples.overlay.title')}</DrawerTitle>
          <DrawerDescription className={compact ? 'sr-only' : undefined}>{t('design_system.gallery.samples.overlay.description')}</DrawerDescription>
        </DrawerHeader>
        <DrawerBody><p className="py-6 text-sm text-muted-foreground">{t('design_system.gallery.samples.overlay.body')}</p></DrawerBody>
        <DrawerFooter layout={footer === 'equal' ? 'equal' : 'default'} leading={footer === 'basic' || footer === 'equal' ? undefined : <FooterLeading kind={footer} />} className="flex-wrap [&_[data-slot=drawer-footer-trailing]]:ml-auto">
          <DrawerClose asChild><Button variant="outline">{t('design_system.gallery.samples.overlay.cancel')}</Button></DrawerClose>
          <DrawerClose asChild><Button variant="primary-filled">{t('design_system.gallery.samples.overlay.continue')}</Button></DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

function overlayExampleCode(kind: 'Dialog' | 'Drawer', example: OverlayExample) {
  const header = example.header ?? 'basic'
  const icon = header === 'basic' ? null : { default: 'Settings', error: 'CircleAlert', warning: 'TriangleAlert', success: 'CircleCheck', info: 'Info' }[header]
  const footer = example.footer ?? 'basic'
  const leading = footer === 'checkbox' ? '<CheckboxField label="Don’t show again" />' : footer === 'toggle' ? '<SwitchField label="Don’t show again" />' : footer === 'stepper' ? '<StepperDots count={3} activeStep={0} size="sm" aria-label="Step 1 of 3" />' : footer === 'link' ? '<Button variant="link" size="sm">Help</Button>' : footer === 'information' ? '<span className="text-xs text-muted-foreground">Changes apply immediately</span>' : null
  if (kind === 'Dialog') return `${icon ? `import { ${icon}, X } from 'lucide-react'\n` : "import { X } from 'lucide-react'\n"}${footer === 'checkbox' ? "import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'\n" : ''}${footer === 'toggle' ? "import { SwitchField } from '@open-mercato/ui/primitives/switch-field'\n" : ''}${footer === 'stepper' ? "import { StepperDots } from '@open-mercato/ui/primitives/step-indicator'\n" : ''}import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@open-mercato/ui/primitives/dialog'

<Dialog>
  <section aria-label="Workspace settings" className="relative w-full max-w-md overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm">
    ${example.status ? '' : '<X aria-hidden="true" className="absolute right-4 top-4 size-4 text-muted-foreground" />'}
    <DialogHeader className="${example.status ? 'p-6' : 'p-4 pr-12'}" alignment="${example.alignment ?? 'horizontal'}" leadingTone="${header === 'basic' ? 'default' : header}"${example.compact ? ' compact' : ''}${icon ? ` leading={<${icon} className="${example.compact || example.status ? 'size-6' : 'size-5'}" />}` : ''}>
      <DialogTitle className="${example.status ? 'text-base font-medium leading-6 tracking-normal' : 'text-sm font-medium leading-5 tracking-normal'}">Workspace settings</DialogTitle>
      <DialogDescription${example.compact ? ' className="sr-only"' : ''}>Choose how these changes apply to your workspace.</DialogDescription>
    </DialogHeader>
    ${example.status ? '' : '<div className="px-4 py-6 text-sm text-muted-foreground">Review your settings before continuing.</div>'}
    <DialogFooter layout="${footer === 'equal' ? 'equal' : 'default'}"${leading ? ` leading={${leading}}` : ''} className="mx-0 gap-3 px-4 py-4">
      <Button asChild variant="outline" size="default"><span>Cancel</span></Button>
      <Button asChild variant="primary-filled" size="default"><span>Continue</span></Button>
    </DialogFooter>
  </section>
</Dialog>`
  return `${icon ? `import { ${icon} } from 'lucide-react'\n` : ''}${footer === 'checkbox' ? "import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'\n" : ''}${footer === 'toggle' ? "import { SwitchField } from '@open-mercato/ui/primitives/switch-field'\n" : ''}${footer === 'stepper' ? "import { StepperDots } from '@open-mercato/ui/primitives/step-indicator'\n" : ''}import { Button } from '@open-mercato/ui/primitives/button'
import { ${kind}, ${kind}Trigger, ${kind}Content, ${kind}Header, ${kind}Title, ${kind}Description, ${kind}Footer, ${kind}Close, DrawerBody } from '@open-mercato/ui/primitives/${kind.toLowerCase()}'

<${kind}>
  <${kind}Trigger asChild><Button variant="outline">Open ${kind.toLowerCase()}</Button></${kind}Trigger>
  <${kind}Content>
    <${kind}Header${example.compact ? ' compact' : ''}${icon ? ` leading={<${icon} className="${example.compact || example.status ? 'size-6' : 'size-5'}" />}` : ''}>
      <${kind}Title className="${example.status ? 'text-base font-medium leading-6 tracking-normal' : 'text-sm font-medium leading-5 tracking-normal'}">Workspace settings</${kind}Title>
      <${kind}Description${example.compact ? ' className="sr-only"' : ''}>Choose how these changes apply to your workspace.</${kind}Description>
    </${kind}Header>
    <DrawerBody><p className="py-6 text-sm text-muted-foreground">Review your settings before continuing.</p></DrawerBody>
    <${kind}Footer layout="${footer === 'equal' ? 'equal' : 'default'}"${leading ? ` leading={${leading}}` : ''} className="flex-wrap [&_[data-slot=drawer-footer-trailing]]:ml-auto">
      <${kind}Close asChild><Button variant="outline">Cancel</Button></${kind}Close>
      <${kind}Close asChild><Button variant="primary-filled">Continue</Button></${kind}Close>
    </${kind}Footer>
  </${kind}Content>
</${kind}>`
}

// Figma names the edge containing the arrow; Radix names the content's side
// relative to the trigger, so a source "Top" arrow uses side="bottom".
const overlayPlacements: { label: string; side: 'top' | 'bottom' | 'left' | 'right'; align: 'start' | 'center' | 'end' }[] = [
  { label: 'Top left', side: 'bottom', align: 'start' },
  { label: 'Top center', side: 'bottom', align: 'center' },
  { label: 'Top right', side: 'bottom', align: 'end' },
  { label: 'Bottom left', side: 'top', align: 'start' },
  { label: 'Bottom center', side: 'top', align: 'center' },
  { label: 'Bottom right', side: 'top', align: 'end' },
  { label: 'Left', side: 'right', align: 'center' },
  { label: 'Right', side: 'left', align: 'center' },
  { label: 'Left top', side: 'right', align: 'start' },
  { label: 'Left bottom', side: 'right', align: 'end' },
  { label: 'Right top', side: 'left', align: 'start' },
  { label: 'Right bottom', side: 'left', align: 'end' },
]

function TooltipPlacements({ size, variant }: { size: 'sm' | 'default' | 'lg'; variant: 'dark' | 'light' }) {
  const t = useT()
  return <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-4">{overlayPlacements.slice(0, 8).map(({ label, side, align }) => size === 'lg' ? (
    <TooltipCard key={label} title={t('design_system.gallery.samples.overlay.tooltip')} description={t('design_system.gallery.samples.overlay.description')} leading={<Globe className="size-5" />} variant={variant} side={side} align={align}>
      <Button variant="outline" size="sm" className="justify-self-center">{label}</Button>
    </TooltipCard>
  ) : (
    <SimpleTooltip key={label} content={t('design_system.gallery.samples.overlay.tooltip')} size={size} variant={variant} side={side} align={align} delayDuration={0}>
      <Button variant="outline" size="sm" className="justify-self-center">{label}</Button>
    </SimpleTooltip>
  ))}</div>
}

function tooltipPlacementCode({ size, variant }: { size: 'sm' | 'default' | 'lg'; variant: 'dark' | 'light' }) {
  const component = size === 'lg' ? 'TooltipCard' : 'SimpleTooltip'
  return `import { ${component} } from '@open-mercato/ui/primitives/tooltip'
import { Button } from '@open-mercato/ui/primitives/button'
${size === 'lg' ? "import { Globe } from 'lucide-react'\n" : ''}
// Figma's arrow edge is opposite Radix's content side. Collision handling stays enabled.
<div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-4">
${overlayPlacements.slice(0, 8).map(({label,side,align}) => `  <${component} ${size === 'lg' ? 'title="Workspace settings" description="Choose how these changes apply to your workspace." leading={<Globe className="size-5" />}' : `content="Workspace settings" size="${size}"`} variant="${variant}" side="${side}" align="${align}"${size === 'lg' ? '' : ' delayDuration={0}'}>
    <Button variant="outline" size="sm" className="justify-self-center">${label}</Button>
  </${component}>`).join('\n')}
</div>`
}

function PopoverExample({ placements = false, footer = 'equal' }: { placements?: boolean; footer?: 'equal' | 'stepper' | 'text' }) {
  const t = useT()
  const [step, setStep] = React.useState(0)
  const options = placements ? overlayPlacements : [overlayPlacements[0]]
  return <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-4">{options.map(({ label, side, align }) => (
    <Popover key={label}>
      <PopoverTrigger asChild><Button variant="outline" size="sm" className="justify-self-center">{placements ? label : t('design_system.gallery.samples.overlay.openPopover')}</Button></PopoverTrigger>
      <PopoverContent side={side} align={align} sideOffset={6} role="dialog" aria-label={t('design_system.gallery.samples.overlay.title')} className="w-[312px] max-w-[calc(100vw-24px)] min-w-0 overflow-visible rounded-xl">
        <div className="space-y-1 p-5 pb-0"><p className="text-sm font-medium">{t('design_system.gallery.samples.overlay.title')}</p><p className="text-sm text-muted-foreground">{t('design_system.gallery.samples.overlay.description')}</p></div>
        <div className="flex flex-wrap items-center gap-3 px-5 py-4">
          {footer === 'stepper' ? <StepperDots count={3} activeStep={step} size="sm" aria-label={t('design_system.gallery.samples.overlay.steps')} /> : null}
          {footer === 'text' ? <span className="text-xs text-muted-foreground">{step + 1} / 3</span> : null}
          <div className={footer === 'equal' ? 'flex w-full gap-3 [&>*]:flex-1' : 'ml-auto flex gap-3'}>
            <Button variant="outline" size="sm" disabled={step === 0} onClick={() => setStep(previous => Math.max(0, previous - 1))}>{t('design_system.gallery.samples.overlay.back')}</Button>
            {step === 2 ? <PopoverClose asChild><Button variant="primary-filled" size="sm">{t('design_system.gallery.samples.overlay.done')}</Button></PopoverClose> : <Button variant="primary-filled" size="sm" onClick={() => setStep(previous => Math.min(2, previous + 1))}>{t('design_system.gallery.samples.overlay.next')}</Button>}
          </div>
        </div>
        <PopoverArrow />
      </PopoverContent>
    </Popover>
  ))}</div>
}

function popoverExampleCode(footer: 'equal' | 'stepper' | 'text') {
  return `import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Popover, PopoverTrigger, PopoverContent, PopoverArrow, PopoverClose } from '@open-mercato/ui/primitives/popover'
${footer === 'stepper' ? "import { StepperDots } from '@open-mercato/ui/primitives/step-indicator'\n" : ''}
function Example() {
  const [step, setStep] = React.useState(0)
  return <Popover>
    <PopoverTrigger asChild><Button variant="outline">Open popover</Button></PopoverTrigger>
    <PopoverContent side="bottom" align="start" sideOffset={6} role="dialog" aria-label="Workspace settings" className="w-[312px] max-w-[calc(100vw-24px)] min-w-0 rounded-xl">
      <div className="space-y-1 p-5 pb-0"><p className="text-sm font-medium">Workspace settings</p><p className="text-sm text-muted-foreground">Choose how these changes apply to your workspace.</p></div>
      <div className="flex flex-wrap items-center gap-3 px-5 py-4">
        ${footer === 'stepper' ? '<StepperDots count={3} activeStep={step} size="sm" aria-label="Progress" />' : footer === 'text' ? '<span className="text-xs text-muted-foreground">{step + 1} / 3</span>' : ''}
        <div className="${footer === 'equal' ? 'flex w-full gap-3 [&>*]:flex-1' : 'ml-auto flex gap-3'}">
          <Button variant="outline" size="sm" disabled={step === 0} onClick={() => setStep(value => value - 1)}>Back</Button>
          {step === 2 ? <PopoverClose asChild><Button variant="primary-filled" size="sm">Done</Button></PopoverClose> : <Button variant="primary-filled" size="sm" onClick={() => setStep(value => value + 1)}>Next</Button>}
        </div>
      </div>
      <PopoverArrow />
    </PopoverContent>
  </Popover>
}`
}

const dialogExamples: OverlayExample[] = [
  {
    "id": "header-small-basic",
    "title": "Header / small / basic",
    "header": "basic",
    "compact": true
  },
  {
    "id": "header-small-default",
    "title": "Header / small / default",
    "header": "default",
    "compact": true
  },
  {
    "id": "header-small-error",
    "title": "Header / small / error",
    "header": "error",
    "compact": true
  },
  {
    "id": "header-small-warning",
    "title": "Header / small / warning",
    "header": "warning",
    "compact": true
  },
  {
    "id": "header-small-success",
    "title": "Header / small / success",
    "header": "success",
    "compact": true
  },
  {
    "id": "header-small-info",
    "title": "Header / small / info",
    "header": "info",
    "compact": true
  },
  {
    "id": "header-medium-basic",
    "title": "Header / medium / basic",
    "header": "basic",
    "compact": false
  },
  {
    "id": "header-medium-default",
    "title": "Header / medium / default",
    "header": "default",
    "compact": false
  },
  {
    "id": "header-medium-error",
    "title": "Header / medium / error",
    "header": "error",
    "compact": false
  },
  {
    "id": "header-medium-warning",
    "title": "Header / medium / warning",
    "header": "warning",
    "compact": false
  },
  {
    "id": "header-medium-success",
    "title": "Header / medium / success",
    "header": "success",
    "compact": false
  },
  {
    "id": "header-medium-info",
    "title": "Header / medium / info",
    "header": "info",
    "compact": false
  },
  {
    "id": "footer-basic",
    "title": "Footer / basic",
    "footer": "basic"
  },
  {
    "id": "footer-equal",
    "title": "Footer / equal",
    "footer": "equal"
  },
  {
    "id": "footer-checkbox",
    "title": "Footer / checkbox",
    "footer": "checkbox"
  },
  {
    "id": "footer-information",
    "title": "Footer / information",
    "footer": "information"
  },
  {
    "id": "footer-toggle",
    "title": "Footer / toggle",
    "footer": "toggle"
  },
  {
    "id": "footer-stepper",
    "title": "Footer / stepper",
    "footer": "stepper"
  },
  {
    "id": "footer-link",
    "title": "Footer / link",
    "footer": "link"
  },
  {
    "id": "status-horizontal-error",
    "title": "Status / horizontal / error",
    "header": "error",
    "alignment": "horizontal",
    "status": true,
    "footer": "checkbox"
  },
  {
    "id": "status-horizontal-warning",
    "title": "Status / horizontal / warning",
    "header": "warning",
    "alignment": "horizontal",
    "status": true,
    "footer": "checkbox"
  },
  {
    "id": "status-horizontal-success",
    "title": "Status / horizontal / success",
    "header": "success",
    "alignment": "horizontal",
    "status": true,
    "footer": "checkbox"
  },
  {
    "id": "status-horizontal-info",
    "title": "Status / horizontal / info",
    "header": "info",
    "alignment": "horizontal",
    "status": true,
    "footer": "checkbox"
  },
  {
    "id": "status-vertical-error",
    "title": "Status / vertical / error",
    "header": "error",
    "alignment": "vertical",
    "status": true,
    "footer": "checkbox"
  },
  {
    "id": "status-vertical-warning",
    "title": "Status / vertical / warning",
    "header": "warning",
    "alignment": "vertical",
    "status": true,
    "footer": "checkbox"
  },
  {
    "id": "status-vertical-success",
    "title": "Status / vertical / success",
    "header": "success",
    "alignment": "vertical",
    "status": true,
    "footer": "checkbox"
  },
  {
    "id": "status-vertical-info",
    "title": "Status / vertical / info",
    "header": "info",
    "alignment": "vertical",
    "status": true,
    "footer": "checkbox"
  }
]

const drawerExamples: OverlayExample[] = [
  {
    "id": "header-small-basic",
    "title": "Header / small / basic",
    "header": "basic",
    "compact": true
  },
  {
    "id": "header-small-default",
    "title": "Header / small / default",
    "header": "default",
    "compact": true
  },
  {
    "id": "header-large-basic",
    "title": "Header / large / basic",
    "header": "basic",
    "compact": false
  },
  {
    "id": "header-large-default",
    "title": "Header / large / default",
    "header": "default",
    "compact": false
  },
  {
    "id": "footer-equal",
    "title": "Footer / equal",
    "footer": "equal"
  },
  {
    "id": "footer-basic",
    "title": "Footer / basic",
    "footer": "basic"
  },
  {
    "id": "footer-checkbox",
    "title": "Footer / checkbox",
    "footer": "checkbox"
  },
  {
    "id": "footer-toggle",
    "title": "Footer / toggle",
    "footer": "toggle"
  },
  {
    "id": "footer-stepper",
    "title": "Footer / stepper",
    "footer": "stepper"
  },
  {
    "id": "footer-link",
    "title": "Footer / link",
    "footer": "link"
  }
]

const dialogEntry: GalleryEntry = {
  id: 'dialog',
  figmaNodeId: '466:4778',
  title: 'Dialog',
  importPath: '@open-mercato/ui/primitives/dialog',
  docsAnchor: '#dialog',
  variants: [
    ...dialogExamples.map(example => ({
      id: example.id,
      title: example.title,
      render: () => <DialogExample {...example} />,
      code: overlayExampleCode('Dialog', example),
    })),
    {
      id: 'default',
      title: 'default',
      render: () => <DialogOverlaysDefaultSample />,
      code: `import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@open-mercato/ui/primitives/dialog'

<Dialog>
  <DialogTrigger asChild>
    <Button variant="outline">Open dialog</Button>
  </DialogTrigger>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Rename view</DialogTitle>
      <DialogDescription>
        The new name is visible to everyone in this workspace.
      </DialogDescription>
    </DialogHeader>
    <DialogFooter>
      <DialogClose asChild>
        <Button variant="outline">Cancel</Button>
      </DialogClose>
      <Button>Save changes</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>`,
    },
    {
      id: 'status-leading',
      title: 'Status leading badge',
      render: () => <DialogOverlaysStatusLeadingSample />,
      code: `import { TriangleAlert } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@open-mercato/ui/primitives/dialog'

<Dialog>
  <DialogTrigger asChild>
    <Button variant="destructive-outline">Delete record</Button>
  </DialogTrigger>
  <DialogContent size="sm">
    <DialogHeader leading={<TriangleAlert className="size-4" />} leadingTone="error">
      <DialogTitle>Delete this record?</DialogTitle>
      <DialogDescription>
        This removes the record from every linked view.
      </DialogDescription>
    </DialogHeader>
    <DialogFooter layout="equal">
      <DialogClose asChild>
        <Button variant="outline">Cancel</Button>
      </DialogClose>
      <Button variant="destructive-solid">Delete</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>`,
    },
  ],
}

const drawerEntry: GalleryEntry = {
  id: 'drawer',
  title: 'Drawer',
  importPath: '@open-mercato/ui/primitives/drawer',
  docsAnchor: '#drawer',
  figmaNodeId: '486:7366',
  variants: [
    ...drawerExamples.map(example => ({
      id: example.id,
      title: example.title,
      render: () => <DrawerExample {...example} />,
      code: overlayExampleCode('Drawer', example),
    })),
    {
      id: 'default',
      title: 'default',
      render: () => <DrawerOverlaysDefaultSample />,
      code: `import { Button } from '@open-mercato/ui/primitives/button'
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerBody,
  DrawerFooter,
  DrawerClose,
} from '@open-mercato/ui/primitives/drawer'

<Drawer>
  <DrawerTrigger asChild>
    <Button variant="outline">Open drawer</Button>
  </DrawerTrigger>
  <DrawerContent>
    <DrawerHeader>
      <DrawerTitle>Edit person</DrawerTitle>
      <DrawerDescription>Update the contact details below.</DrawerDescription>
    </DrawerHeader>
    <DrawerBody>{/* content */}</DrawerBody>
    <DrawerFooter layout="equal">
      <DrawerClose asChild>
        <Button variant="outline">Cancel</Button>
      </DrawerClose>
      <Button>Save changes</Button>
    </DrawerFooter>
  </DrawerContent>
</Drawer>`,
    },
    {
      id: 'leading-icon',
      title: 'Header leading icon',
      render: () => <DrawerOverlaysLeadingIconSample />,
      code: `import { UserRound } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerBody,
  DrawerFooter,
  DrawerClose,
} from '@open-mercato/ui/primitives/drawer'

<Drawer>
  <DrawerTrigger asChild>
    <Button variant="outline">Open profile drawer</Button>
  </DrawerTrigger>
  <DrawerContent>
    <DrawerHeader leading={<UserRound className="size-4" />}>
      <DrawerTitle>Profile details</DrawerTitle>
      <DrawerDescription>Read-only summary of this account.</DrawerDescription>
    </DrawerHeader>
    <DrawerBody>{/* content */}</DrawerBody>
    <DrawerFooter layout="equal">
      <DrawerClose asChild>
        <Button variant="outline">Cancel</Button>
      </DrawerClose>
      <Button>Continue</Button>
    </DrawerFooter>
  </DrawerContent>
</Drawer>`,
    },
  ],
}

const sheetEntry: GalleryEntry = {
  id: 'sheet',
  title: 'Sheet',
  importPath: '@open-mercato/ui/primitives/sheet',
  variants: [
    {
      id: 'right',
      title: 'right (default)',
      render: () => <SheetOverlaysRightSample />,
      code: `import { Button } from '@open-mercato/ui/primitives/button'
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@open-mercato/ui/primitives/sheet'

<Sheet>
  <SheetTrigger asChild>
    <Button variant="outline">Open sheet</Button>
  </SheetTrigger>
  <SheetContent>
    <SheetHeader>
      <SheetTitle>Filters</SheetTitle>
      <SheetDescription>Narrow down the current list.</SheetDescription>
    </SheetHeader>
    {/* body */}
    <SheetFooter>
      <Button variant="outline">Reset</Button>
      <Button>Apply</Button>
    </SheetFooter>
  </SheetContent>
</Sheet>`,
    },
    {
      id: 'left',
      title: 'side="left"',
      render: () => <SheetOverlaysLeftSample />,
      code: `import { Button } from '@open-mercato/ui/primitives/button'
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@open-mercato/ui/primitives/sheet'

<Sheet>
  <SheetTrigger asChild>
    <Button variant="outline">Open left sheet</Button>
  </SheetTrigger>
  <SheetContent side="left">
    <SheetHeader>
      <SheetTitle>Navigation</SheetTitle>
      <SheetDescription>Slides in from the left edge.</SheetDescription>
    </SheetHeader>
    {/* body */}
  </SheetContent>
</Sheet>`,
    },
  ],
}

const popoverEntry: GalleryEntry = {
  id: 'popover',
  figmaNodeId: '4431:81573',
  title: 'Popover',
  importPath: '@open-mercato/ui/primitives/popover',
  variants: [
    { id: 'positions', title: '12 arrow positions', render: () => <PopoverExample placements />, code: popoverExampleCode('equal') + '\n\n// Source arrow edge → content side / alignment\n' + overlayPlacements.map(item => `// ${item.label} → side="${item.side}" align="${item.align}"`).join('\n') },
    { id: 'footer-equal', title: 'Footer / equal', render: () => <PopoverExample footer="equal" />, code: popoverExampleCode('equal') },
    { id: 'footer-text', title: 'Footer / text', render: () => <PopoverExample footer="text" />, code: popoverExampleCode('text') },
    { id: 'footer-stepper', title: 'Footer / stepper', render: () => <PopoverExample footer="stepper" />, code: popoverExampleCode('stepper') },
    {
      id: 'default',
      title: 'default',
      render: () => <PopoverOverlaysDefaultSample />,
      code: `import { Button } from '@open-mercato/ui/primitives/button'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@open-mercato/ui/primitives/popover'

<Popover>
  <PopoverTrigger asChild>
    <Button variant="outline">Open popover</Button>
  </PopoverTrigger>
  <PopoverContent className="p-4">
    {/* content */}
  </PopoverContent>
</Popover>`,
    },
    {
      id: 'align-end',
      title: 'align="end" + side="top"',
      render: () => <PopoverOverlaysAlignEndSample />,
      code: `import { Button } from '@open-mercato/ui/primitives/button'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@open-mercato/ui/primitives/popover'

<Popover>
  <PopoverTrigger asChild>
    <Button variant="outline">Open above</Button>
  </PopoverTrigger>
  <PopoverContent side="top" align="end" className="p-4">
    {/* content */}
  </PopoverContent>
</Popover>`,
    },
  ],
}

const tooltipEntry: GalleryEntry = {
  id: 'tooltip',
  figmaNodeId: '2604:269',
  title: 'Tooltip',
  importPath: '@open-mercato/ui/primitives/tooltip',
  docsAnchor: '#tooltip--simpletooltip',
  variants: [
    { id: 'positions-sm-light', title: '8 positions / sm / light', render: () => <TooltipPlacements size="sm" variant="light" />, code: tooltipPlacementCode({ size: 'sm', variant: 'light' }) },
    { id: 'positions-sm-dark', title: '8 positions / sm / dark', render: () => <TooltipPlacements size="sm" variant="dark" />, code: tooltipPlacementCode({ size: 'sm', variant: 'dark' }) },
    { id: 'positions-default-light', title: '8 positions / default / light', render: () => <TooltipPlacements size="default" variant="light" />, code: tooltipPlacementCode({ size: 'default', variant: 'light' }) },
    { id: 'positions-default-dark', title: '8 positions / default / dark', render: () => <TooltipPlacements size="default" variant="dark" />, code: tooltipPlacementCode({ size: 'default', variant: 'dark' }) },
    { id: 'positions-lg-light', title: '8 positions / lg / light', render: () => <TooltipPlacements size="lg" variant="light" />, code: tooltipPlacementCode({ size: 'lg', variant: 'light' }) },
    { id: 'positions-lg-dark', title: '8 positions / lg / dark', render: () => <TooltipPlacements size="lg" variant="dark" />, code: tooltipPlacementCode({ size: 'lg', variant: 'dark' }) },
    {
      id: 'default',
      title: 'default (dark)',
      render: () => <TooltipOverlaysDefaultSample />,
      code: `import { SimpleTooltip, TooltipCard } from '@open-mercato/ui/primitives/tooltip'
import { Button } from '@open-mercato/ui/primitives/button'

<SimpleTooltip content="Duplicates this view with all filters">
  <Button variant="outline">Hover me</Button>
</SimpleTooltip>`,
    },
    {
      id: 'light',
      title: 'light',
      render: () => <TooltipOverlaysLightSample />,
      code: `import { Info } from 'lucide-react'
import { SimpleTooltip, TooltipCard } from '@open-mercato/ui/primitives/tooltip'
import { Button } from '@open-mercato/ui/primitives/button'

<SimpleTooltip content="Help text on a light surface" variant="light">
  <Button variant="outline"><Info />Light variant</Button>
</SimpleTooltip>`,
    },
    {
      id: 'sizes',
      title: 'Sizes',
      render: () => <TooltipOverlaysSizesSample />,
      code: `import { SimpleTooltip, TooltipCard } from '@open-mercato/ui/primitives/tooltip'
import { Button } from '@open-mercato/ui/primitives/button'

<SimpleTooltip content="Small" size="sm">
  <Button variant="outline" size="sm">sm</Button>
</SimpleTooltip>
<SimpleTooltip content="Default">
  <Button variant="outline" size="sm">default</Button>
</SimpleTooltip>
<SimpleTooltip content="Large tooltip for longer helper copy" size="lg">
  <Button variant="outline" size="sm">lg</Button>
</SimpleTooltip>`,
    },
  ],
}

const commandMenuEntry: GalleryEntry = {
  id: 'command-menu',
  figmaNodeId: '4171:15653',
  title: 'CommandMenu',
  importPath: '@open-mercato/ui/primitives/command-menu',
  docsAnchor: '#commandmenu',
  usage: { do: [
    'The source Small (48) label is inaccurate: all six small rows measure 40 px. The larger rows measure 64 px. Numeric sizes opt into these measurements; unsized rows keep the legacy layout.',
    'Basic, Avatar, Left Icon, Brand, Company and Country use real source assets or production primitives. Keyboard selection updates the result and closes the palette.',
    'Search and clear stay synchronized. Group captions and actions flow together without overlapping long headings; the footer includes real keyboard hints and a local help action.',
  ] },
  variants: [
    { id: 'default', title: 'All six types / 40 px', render: () => <CommandSourceExample />, code: commandSourceCode + '\n<CommandSourceExample size={40} />' },
    { id: 'medium', title: 'All six types / 64 px', render: () => <CommandSourceExample size={64} />, code: commandSourceCode + '\n<CommandSourceExample size={64} />' },
    { id: 'groups', title: 'Captions / action / separator / footer', render: () => <CommandSourceExample withGroups />, code: commandSourceCode + '\n<CommandSourceExample withGroups />' },
    { id: 'empty', title: 'No results / clear to recover', render: () => <CommandSourceExample empty />, code: commandSourceCode + '\n<CommandSourceExample empty />' },
  ],
}

export const entries: GalleryEntry[] = [
  dialogEntry,
  drawerEntry,
  sheetEntry,
  popoverEntry,
  tooltipEntry,
  commandMenuEntry,
]

function DialogOverlaysDefaultSample() {
  const t = useT()
  return (<Dialog>
          <DialogTrigger asChild>
            <Button variant="outline">{t('design_system.gallery.samples.overlay.openDialog')}</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('design_system.gallery.sampleCopy.renameView')}</DialogTitle>
              <DialogDescription>
                {t('design_system.gallery.sampleCopy.theNewNameIsVisibleToEveryoneInThisWorkspace')}
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              {t('design_system.gallery.sampleCopy.pressEscapeOrClickOutsideToDismiss')}
            </p>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">{t('design_system.gallery.samples.overlay.cancel')}</Button>
              </DialogClose>
              <Button>{t('design_system.gallery.samples.primaryAction')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>)
}

function DialogOverlaysStatusLeadingSample() {
  const t = useT()
  return (<Dialog>
          <DialogTrigger asChild>
            <Button variant="destructive-outline">{t('design_system.gallery.sampleCopy.deleteRecord')}</Button>
          </DialogTrigger>
          <DialogContent size="sm">
            <DialogHeader leading={<TriangleAlert className="size-4" />} leadingTone="error">
              <DialogTitle>{t('design_system.gallery.sampleCopy.deleteThisRecord')}</DialogTitle>
              <DialogDescription>
                {t('design_system.gallery.sampleCopy.thisRemovesTheRecordFromEveryLinkedView')}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter layout="equal">
              <DialogClose asChild>
                <Button variant="outline">{t('design_system.gallery.samples.overlay.cancel')}</Button>
              </DialogClose>
              <Button variant="destructive-solid">{t('design_system.gallery.sampleCopy.delete')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>)
}

function DrawerOverlaysDefaultSample() {
  const t = useT()
  return (<Drawer>
          <DrawerTrigger asChild>
            <Button variant="outline">{t('design_system.gallery.samples.overlay.openDrawer')}</Button>
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>{t('design_system.gallery.sampleCopy.editPerson')}</DrawerTitle>
              <DrawerDescription>{t('design_system.gallery.sampleCopy.updateTheContactDetailsBelow')}</DrawerDescription>
            </DrawerHeader>
            <DrawerBody>
              <div className="divide-y divide-input text-sm">
                <div className="flex items-center justify-between py-3">
                  <span className="text-muted-foreground">{t('design_system.gallery.samples.textInput.basic')}</span>
                  <span className="text-foreground">Anna Kowalska</span>
                </div>
                <div className="flex items-center justify-between py-3">
                  <span className="text-muted-foreground">{t('design_system.gallery.sampleCopy.role')}</span>
                  <span className="text-foreground">{t('design_system.gallery.samples.table.description')}</span>
                </div>
                <div className="flex items-center justify-between py-3">
                  <span className="text-muted-foreground">{t('design_system.gallery.samples.hr.team')}</span>
                  <span className="text-foreground">{t('design_system.gallery.sampleCopy.salesEU')}</span>
                </div>
              </div>
            </DrawerBody>
            <DrawerFooter layout="equal">
              <DrawerClose asChild>
                <Button variant="outline">{t('design_system.gallery.samples.overlay.cancel')}</Button>
              </DrawerClose>
              <Button>{t('design_system.gallery.samples.primaryAction')}</Button>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>)
}

function DrawerOverlaysLeadingIconSample() {
  const t = useT()
  return (<Drawer>
          <DrawerTrigger asChild>
            <Button variant="outline">{t('design_system.gallery.sampleCopy.openProfileDrawer')}</Button>
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader leading={<UserRound className="size-4" />}>
              <DrawerTitle>{t('design_system.gallery.sampleCopy.profileDetails')}</DrawerTitle>
              <DrawerDescription>{t('design_system.gallery.sampleCopy.readonlySummaryOfThisAccount')}</DrawerDescription>
            </DrawerHeader>
            <DrawerBody>
              <p className="text-sm text-muted-foreground">
                {t('design_system.gallery.sampleCopy.theHeaderBadgeTakesAnyLucideIconViaThe')} <code>leading</code> {t('design_system.gallery.sampleCopy.prop')}
              </p>
            </DrawerBody>
            <DrawerFooter layout="equal">
              <DrawerClose asChild>
                <Button variant="outline">{t('design_system.gallery.samples.overlay.cancel')}</Button>
              </DrawerClose>
              <Button>{t('design_system.gallery.samples.overlay.continue')}</Button>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>)
}

function SheetOverlaysRightSample() {
  const t = useT()
  return (<Sheet>
          <SheetTrigger asChild>
            <Button variant="outline">{t('design_system.gallery.sampleCopy.openSheet')}</Button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>{t('design_system.families.filters')}</SheetTitle>
              <SheetDescription>{t('design_system.gallery.sampleCopy.narrowDownTheCurrentList')}</SheetDescription>
            </SheetHeader>
            <div className="flex-1 px-4 text-sm text-muted-foreground">
              {t('design_system.gallery.sampleCopy.sheetBodyContentScrollsIndependentlyOfTheHeaderAndFooter')}
            </div>
            <SheetFooter>
              <Button variant="outline">{t('design_system.gallery.sampleCopy.reset')}</Button>
              <Button>{t('design_system.gallery.examples.sourceFilters.apply')}</Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>)
}

function SheetOverlaysLeftSample() {
  const t = useT()
  return (<Sheet>
          <SheetTrigger asChild>
            <Button variant="outline">{t('design_system.gallery.sampleCopy.openLeftSheet')}</Button>
          </SheetTrigger>
          <SheetContent side="left">
            <SheetHeader>
              <SheetTitle>{t('design_system.families.navigation')}</SheetTitle>
              <SheetDescription>{t('design_system.gallery.sampleCopy.slidesInFromTheLeftEdge')}</SheetDescription>
            </SheetHeader>
            <div className="flex-1 px-4 text-sm text-muted-foreground">
              {t('design_system.gallery.sampleCopy.useTheLeftSideForMobileMenusAndSecondaryNavigation')}
            </div>
          </SheetContent>
        </Sheet>)
}

function PopoverOverlaysDefaultSample() {
  const t = useT()
  return (<Popover>
          <PopoverTrigger asChild>
            <Button variant="outline">{t('design_system.gallery.samples.overlay.openPopover')}</Button>
          </PopoverTrigger>
          <PopoverContent className="p-4">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-foreground">{t('design_system.gallery.sampleCopy.displayDensity')}</span>
              <span className="text-sm text-muted-foreground">
                {t('design_system.gallery.sampleCopy.anchoredToItsTriggerEscapeAndOutsideclickDismissIt')}
              </span>
            </div>
          </PopoverContent>
        </Popover>)
}

function PopoverOverlaysAlignEndSample() {
  const t = useT()
  return (<Popover>
          <PopoverTrigger asChild>
            <Button variant="outline">{t('design_system.gallery.sampleCopy.openAbove')}</Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="end" className="p-4">
            <span className="text-sm text-muted-foreground">
              {t('design_system.gallery.sampleCopy.placementFollowsRadixSidealignPropsAndFlipsWhenSpaceRuns')}
            </span>
          </PopoverContent>
        </Popover>)
}

function TooltipOverlaysDefaultSample() {
  const t = useT()
  return (<SimpleTooltip content={t('design_system.gallery.sampleCopy.duplicatesThisViewWithAllFilters')}>
          <Button variant="outline">{t('design_system.gallery.sampleCopy.hoverMe')}</Button>
        </SimpleTooltip>)
}

function TooltipOverlaysLightSample() {
  const t = useT()
  return (<SimpleTooltip content={t('design_system.gallery.sampleCopy.helpTextOnALightSurface')} variant="light">
          <Button variant="outline">
            <Info />
            {t('design_system.gallery.sampleCopy.lightVariant')}
          </Button>
        </SimpleTooltip>)
}

function TooltipOverlaysSizesSample() {
  const t = useT()
  return (<>
          <SimpleTooltip content={t('design_system.gallery.sampleCopy.small')} size="sm">
            <Button variant="outline" size="sm">sm</Button>
          </SimpleTooltip>
          <SimpleTooltip content={t('design_system.gallery.examples.aiProduct.default')}>
            <Button variant="outline" size="sm">default</Button>
          </SimpleTooltip>
          <SimpleTooltip content={t('design_system.gallery.sampleCopy.largeTooltipForLongerHelperCopy')} size="lg">
            <Button variant="outline" size="sm">lg</Button>
          </SimpleTooltip>
        </>)
}
