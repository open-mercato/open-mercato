import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Label } from '@open-mercato/ui/primitives/label'
import { CreditCard, LayoutGrid, Settings, ShoppingCart, Truck } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@open-mercato/ui/primitives/breadcrumb'
import { Pagination, type PaginationAppearance } from '@open-mercato/ui/primitives/pagination'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@open-mercato/ui/primitives/segmented-control'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@open-mercato/ui/primitives/accordion'
import { SidebarExample, SidebarFeatureExample, SidebarIdentityExample, SidebarItemsExample, TopbarExample, NavigationBrandsExample } from '../demos/shell'
import { shellExampleCode } from '../demos/shell-code.generated'
import { AiPromptExample, AiIconButtonExamples, AiNavigationExamples, AiSearchExamples, AiAuthExamples, AiSettingsExamples, AiNewChatExample, AiSidebarExample, AiMobileNavigationExample } from '../demos/ai-product'
import { aiProductExampleCode } from '../demos/ai-product-code.generated'
import type { GalleryEntry } from '../types'

// Component titles and variant names are proper nouns from the codebase and
// are deliberately not translated. `code` MUST contain the entry's importPath
// (enforced by the registry-integrity test) and is always reviewed alongside
// its sibling `render`.

// Pagination is a controlled component — these small wrappers own the page
// state so the preview stays interactive without polluting the entry shape.

function PaginationBasicDemo({ appearance, disabled = false }: { appearance?: PaginationAppearance; disabled?: boolean }) {
  const [page, setPage] = React.useState(2)
  const [pageSize, setPageSize] = React.useState(25)
  return (
    <Pagination
      appearance={appearance}
      disabled={disabled}
      page={page}
      pageSize={pageSize}
      total={400}
      onPageChange={setPage}
      onPageSizeChange={setPageSize}
    />
  )
}

function PaginationCompactDemo() {
  const [page, setPage] = React.useState(1)
  return (
    <Pagination
      page={page}
      pageSize={20}
      total={120}
      onPageChange={setPage}
      showFirstLast={false}
      showPageSize={false}
    />
  )
}

function TabsQuantityDemo({ variant, orientation }: { variant: 'underline' | 'card' | 'list'; orientation: 'horizontal' | 'vertical' }) {
  const t = useT()
  const counts = orientation === 'vertical' ? [2, 3, 4, 5, 6, 7, 8] : [2, 3, 4, 5, 6]
  return <div className={orientation === 'vertical' ? 'grid w-full gap-6 xl:grid-cols-2' : 'flex w-full flex-col gap-6'}>
    {counts.map(count => <Tabs key={count} defaultValue="1" variant={variant} orientation={orientation} className="min-w-0">
      <TabsList aria-label={t('design_system.gallery.examples.navigation2.sections', { count })} className={orientation === 'vertical' ? 'w-64 shrink-0' : 'flex w-full overflow-x-auto'}>
        {orientation === 'vertical' && <span aria-hidden="true" className="px-2 py-1 text-xs font-medium uppercase text-muted-foreground">{t('design_system.gallery.examples.navigation2.selectMenu')}</span>}
        {Array.from({ length: count }, (_, index) => <TabsTrigger key={index} value={String(index + 1)} leading={<LayoutGrid className="size-5" />} count={index === 1 ? 12 : undefined}>
          {t('design_system.gallery.examples.navigation2.section', { number: index + 1 })}
        </TabsTrigger>)}
      </TabsList>
      {Array.from({ length: count }, (_, index) => <TabsContent key={index} value={String(index + 1)} className="text-sm text-muted-foreground">
        {t('design_system.gallery.examples.navigation2.panel', { number: index + 1 })}
      </TabsContent>)}
    </Tabs>)}
  </div>
}

function TabsKeyboardDemo() {
  const t = useT()
  return <Tabs defaultValue="overview" variant="underline" className="w-full">
    <TabsList aria-label={t('design_system.gallery.examples.navigation2.keyboard')}>
      <TabsTrigger value="overview" leading={<LayoutGrid className="size-5" />}>{t('design_system.gallery.examples.navigation2.overview')}</TabsTrigger>
      <TabsTrigger value="locked" disabled count={4}>{t('design_system.gallery.examples.navigation2.locked')}</TabsTrigger>
      <TabsTrigger value="settings" leading={<Settings className="size-5" />}>{t('design_system.gallery.examples.navigation2.settings')}</TabsTrigger>
    </TabsList>
    <TabsContent value="overview">{t('design_system.gallery.examples.navigation2.keyboardHint')}</TabsContent>
    <TabsContent value="settings">{t('design_system.gallery.examples.navigation2.settingsPanel')}</TabsContent>
  </Tabs>
}

function BreadcrumbQuantityDemo() {
  const t = useT()
  const targetId = React.useId()
  return <div className="flex w-full flex-col gap-4">
    {(['arrow', 'slash', 'dot'] as const).map(divider => <div key={divider} className="flex flex-col gap-4">
      {[3, 4, 5].map(count => <Breadcrumb key={count} divider={divider} aria-label={t('design_system.gallery.examples.navigation2.path', { count })}>
        <BreadcrumbList className="flex-wrap">
          {Array.from({ length: count }, (_, index) => <React.Fragment key={index}>
            {index > 0 && <BreadcrumbSeparator className="size-5 justify-center">{divider === 'dot' ? '•' : undefined}</BreadcrumbSeparator>}
            <BreadcrumbItem>
              {index === count - 1
                ? <BreadcrumbPage>{t('design_system.gallery.examples.navigation2.section', { number: index + 1 })}</BreadcrumbPage>
                : <BreadcrumbLink href={`#${targetId}`}><LayoutGrid className="size-5" aria-hidden="true" />{t('design_system.gallery.examples.navigation2.section', { number: index + 1 })}</BreadcrumbLink>}
            </BreadcrumbItem>
          </React.Fragment>)}
        </BreadcrumbList>
      </Breadcrumb>)}
    </div>)}
    <p id={targetId} tabIndex={-1} className="text-sm text-muted-foreground">{t('design_system.gallery.examples.navigation2.localDestination')}</p>
  </div>
}

function AccordionStartDemo() {
  const t = useT()
  return <Accordion type="single" collapsible defaultValue="details" className="w-full max-w-md space-y-2">
    <AccordionItem value="overview">
      <AccordionTrigger iconPosition="start">{t('design_system.gallery.examples.navigation2.overview')}</AccordionTrigger>
      <AccordionContent>{t('design_system.gallery.examples.navigation2.accordionBody')}</AccordionContent>
    </AccordionItem>
    <AccordionItem value="details">
      <AccordionTrigger iconPosition="start">{t('design_system.gallery.examples.navigation2.settings')}</AccordionTrigger>
      <AccordionContent>{t('design_system.gallery.examples.navigation2.accordionBody')}</AccordionContent>
    </AccordionItem>
    <AccordionItem value="locked" disabled>
      <AccordionTrigger iconPosition="start">{t('design_system.gallery.examples.navigation2.locked')}</AccordionTrigger>
      <AccordionContent>{t('design_system.gallery.examples.navigation2.accordionBody')}</AccordionContent>
    </AccordionItem>
  </Accordion>
}

function SegmentedSourceDemo({ content }: { content: 'text' | 'leading' | 'icon' }) {
  const t = useT()
  const labelId = React.useId()
  const [value, setValue] = React.useState('overview')
  const options = [
    { value: 'overview', label: t('design_system.gallery.examples.navigation2.overview'), icon: <LayoutGrid className="size-5" aria-hidden="true" /> },
    { value: 'settings', label: t('design_system.gallery.examples.navigation2.settings'), icon: <Settings className="size-5" aria-hidden="true" /> },
    { value: 'orders', label: t('design_system.gallery.examples.navigation2.orders'), icon: <ShoppingCart className="size-5" aria-hidden="true" /> },
  ]
  return <div className="flex w-full max-w-sm flex-col gap-6">
    {[false, true].map(disabled => <div key={String(disabled)} className="flex flex-col gap-1.5">
      <Label id={`${labelId}-${disabled}`} className="leading-5">{disabled ? t('design_system.gallery.examples.navigation2.locked') : t('design_system.gallery.examples.navigation2.selectMenu')}</Label>
      <SegmentedControl value={value} onValueChange={setValue} disabled={disabled} aria-labelledby={`${labelId}-${disabled}`} className="h-9 w-full gap-1 rounded-lg border-0 p-1">
        {options.map(option => <SegmentedControlItem key={option.value} value={option.value} aria-label={content === 'icon' ? option.label : undefined} className="h-7 min-w-0 flex-1 gap-1.5 rounded-md p-1">
          {content !== 'text' && option.icon}
          {content !== 'icon' && option.label}
        </SegmentedControlItem>)}
      </SegmentedControl>
    </div>)}
  </div>
}

const tabsEntry: GalleryEntry = {
  id: 'tabs',
  title: 'Tabs',
  importPath: '@open-mercato/ui/primitives/tabs',
  usage: {
    do: [
      'variant="underline" is the canon for page-level tab strips; pill only for small embedded switchers.',
      'TabsList always carries an aria-label; use count and leading to add context to triggers.',
    ],
    dont: ['No hand-rolled tab strips from buttons and border classes — lint flags raw tab lists.'],
  },
  docsAnchor: '#tabs',
  figmaNodeId: '553:734',
  variants: [
    {
      id: 'underline',
      title: 'underline',
      // Underline is the DS canon for page-level tab strips — flat rail
      // with an accent underline, per-tab `leading` icon and `count` badge.
      render: () => <TabsNavigationUnderlineSample />,
      code: `import { LayoutGrid, Settings, ShoppingCart } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'

<Tabs defaultValue="orders" variant="underline">
  <TabsList aria-label="Customer sections">
    <TabsTrigger value="overview" leading={<LayoutGrid className="size-4" />}>Overview</TabsTrigger>
    <TabsTrigger value="orders" leading={<ShoppingCart className="size-4" />} count={12}>Orders</TabsTrigger>
    <TabsTrigger value="settings" leading={<Settings className="size-4" />}>Settings</TabsTrigger>
  </TabsList>
  <TabsContent value="overview">…</TabsContent>
  <TabsContent value="orders">…</TabsContent>
  <TabsContent value="settings">…</TabsContent>
</Tabs>`,
    },
    {
      id: 'pill',
      title: 'pill (default)',
      render: () => <TabsNavigationPillSample />,
      code: `import { Tabs, TabsContent, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'

<Tabs defaultValue="preview">
  <TabsList aria-label="Editor view">
    <TabsTrigger value="preview">Preview</TabsTrigger>
    <TabsTrigger value="code">Code</TabsTrigger>
    <TabsTrigger value="logs">Logs</TabsTrigger>
  </TabsList>
  <TabsContent value="preview">…</TabsContent>
  <TabsContent value="code">…</TabsContent>
  <TabsContent value="logs">…</TabsContent>
</Tabs>`,
    },
    {
      id: 'pill-vertical',
      title: 'pill, vertical',
      render: () => <TabsNavigationPillVerticalSample />,
      code: `import { Tabs, TabsContent, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'

<Tabs defaultValue="profile" orientation="vertical">
  <TabsList aria-label="Account settings">
    <TabsTrigger value="profile">Profile</TabsTrigger>
    <TabsTrigger value="billing">Billing</TabsTrigger>
    <TabsTrigger value="security">Security</TabsTrigger>
  </TabsList>
  <TabsContent value="profile">…</TabsContent>
  <TabsContent value="billing">…</TabsContent>
  <TabsContent value="security">…</TabsContent>
</Tabs>`,
    },
    {
      id: 'underline-quantities',
      title: 'underline · all source counts',
      render: () => <TabsQuantityDemo variant="underline" orientation="horizontal" />,
      code: `import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { LayoutGrid, Settings } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@open-mercato/ui/primitives/tabs'

function TabsQuantityDemo({ variant, orientation }: { variant: 'underline' | 'card' | 'list'; orientation: 'horizontal' | 'vertical' }) {
  const t = useT()
  const counts = orientation === 'vertical' ? [2, 3, 4, 5, 6, 7, 8] : [2, 3, 4, 5, 6]
  return <div className={orientation === 'vertical' ? 'grid w-full gap-6 xl:grid-cols-2' : 'flex w-full flex-col gap-6'}>
    {counts.map(count => <Tabs key={count} defaultValue="1" variant={variant} orientation={orientation} className="min-w-0">
      <TabsList aria-label={t('design_system.gallery.examples.navigation2.sections', { count })} className={orientation === 'vertical' ? 'w-64 shrink-0' : 'flex w-full overflow-x-auto'}>
        {orientation === 'vertical' && <span aria-hidden="true" className="px-2 py-1 text-xs font-medium uppercase text-muted-foreground">{t('design_system.gallery.examples.navigation2.selectMenu')}</span>}
        {Array.from({ length: count }, (_, index) => <TabsTrigger key={index} value={String(index + 1)} leading={<LayoutGrid className="size-5" />} count={index === 1 ? 12 : undefined}>
          {t('design_system.gallery.examples.navigation2.section', { number: index + 1 })}
        </TabsTrigger>)}
      </TabsList>
      {Array.from({ length: count }, (_, index) => <TabsContent key={index} value={String(index + 1)} className="text-sm text-muted-foreground">
        {t('design_system.gallery.examples.navigation2.panel', { number: index + 1 })}
      </TabsContent>)}
    </Tabs>)}
  </div>
}

<TabsQuantityDemo variant="underline" orientation="horizontal" />`,
    },
    {
      id: 'card-quantities',
      title: 'card · all source counts',
      render: () => <TabsQuantityDemo variant="card" orientation="vertical" />,
      code: `import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { LayoutGrid, Settings } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@open-mercato/ui/primitives/tabs'

function TabsQuantityDemo({ variant, orientation }: { variant: 'underline' | 'card' | 'list'; orientation: 'horizontal' | 'vertical' }) {
  const t = useT()
  const counts = orientation === 'vertical' ? [2, 3, 4, 5, 6, 7, 8] : [2, 3, 4, 5, 6]
  return <div className={orientation === 'vertical' ? 'grid w-full gap-6 xl:grid-cols-2' : 'flex w-full flex-col gap-6'}>
    {counts.map(count => <Tabs key={count} defaultValue="1" variant={variant} orientation={orientation} className="min-w-0">
      <TabsList aria-label={t('design_system.gallery.examples.navigation2.sections', { count })} className={orientation === 'vertical' ? 'w-64 shrink-0' : 'flex w-full overflow-x-auto'}>
        {orientation === 'vertical' && <span aria-hidden="true" className="px-2 py-1 text-xs font-medium uppercase text-muted-foreground">{t('design_system.gallery.examples.navigation2.selectMenu')}</span>}
        {Array.from({ length: count }, (_, index) => <TabsTrigger key={index} value={String(index + 1)} leading={<LayoutGrid className="size-5" />} count={index === 1 ? 12 : undefined}>
          {t('design_system.gallery.examples.navigation2.section', { number: index + 1 })}
        </TabsTrigger>)}
      </TabsList>
      {Array.from({ length: count }, (_, index) => <TabsContent key={index} value={String(index + 1)} className="text-sm text-muted-foreground">
        {t('design_system.gallery.examples.navigation2.panel', { number: index + 1 })}
      </TabsContent>)}
    </Tabs>)}
  </div>
}

<TabsQuantityDemo variant="card" orientation="vertical" />`,
    },
    {
      id: 'list-quantities',
      title: 'list · all source counts',
      render: () => <TabsQuantityDemo variant="list" orientation="vertical" />,
      code: `import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { LayoutGrid, Settings } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@open-mercato/ui/primitives/tabs'

function TabsQuantityDemo({ variant, orientation }: { variant: 'underline' | 'card' | 'list'; orientation: 'horizontal' | 'vertical' }) {
  const t = useT()
  const counts = orientation === 'vertical' ? [2, 3, 4, 5, 6, 7, 8] : [2, 3, 4, 5, 6]
  return <div className={orientation === 'vertical' ? 'grid w-full gap-6 xl:grid-cols-2' : 'flex w-full flex-col gap-6'}>
    {counts.map(count => <Tabs key={count} defaultValue="1" variant={variant} orientation={orientation} className="min-w-0">
      <TabsList aria-label={t('design_system.gallery.examples.navigation2.sections', { count })} className={orientation === 'vertical' ? 'w-64 shrink-0' : 'flex w-full overflow-x-auto'}>
        {orientation === 'vertical' && <span aria-hidden="true" className="px-2 py-1 text-xs font-medium uppercase text-muted-foreground">{t('design_system.gallery.examples.navigation2.selectMenu')}</span>}
        {Array.from({ length: count }, (_, index) => <TabsTrigger key={index} value={String(index + 1)} leading={<LayoutGrid className="size-5" />} count={index === 1 ? 12 : undefined}>
          {t('design_system.gallery.examples.navigation2.section', { number: index + 1 })}
        </TabsTrigger>)}
      </TabsList>
      {Array.from({ length: count }, (_, index) => <TabsContent key={index} value={String(index + 1)} className="text-sm text-muted-foreground">
        {t('design_system.gallery.examples.navigation2.panel', { number: index + 1 })}
      </TabsContent>)}
    </Tabs>)}
  </div>
}

<TabsQuantityDemo variant="list" orientation="vertical" />`,
    },
    {
      id: 'keyboard-states',
      title: 'Keyboard and disabled tabs',
      render: () => <TabsKeyboardDemo />,
      code: `import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { LayoutGrid, Settings } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@open-mercato/ui/primitives/tabs'

function TabsKeyboardDemo() {
  const t = useT()
  return <Tabs defaultValue="overview" variant="underline" className="w-full">
    <TabsList aria-label={t('design_system.gallery.examples.navigation2.keyboard')}>
      <TabsTrigger value="overview" leading={<LayoutGrid className="size-5" />}>{t('design_system.gallery.examples.navigation2.overview')}</TabsTrigger>
      <TabsTrigger value="locked" disabled count={4}>{t('design_system.gallery.examples.navigation2.locked')}</TabsTrigger>
      <TabsTrigger value="settings" leading={<Settings className="size-5" />}>{t('design_system.gallery.examples.navigation2.settings')}</TabsTrigger>
    </TabsList>
    <TabsContent value="overview">{t('design_system.gallery.examples.navigation2.keyboardHint')}</TabsContent>
    <TabsContent value="settings">{t('design_system.gallery.examples.navigation2.settingsPanel')}</TabsContent>
  </Tabs>
}

<TabsKeyboardDemo />`,
    },
  ],
}

const breadcrumbEntry: GalleryEntry = {
  id: 'breadcrumb',
  figmaNodeId: '447:8832',
  title: 'Breadcrumb',
  importPath: '@open-mercato/ui/primitives/breadcrumb',
  docsAnchor: '#breadcrumb',
  variants: [
    {
      id: 'slash',
      title: 'slash (default)',
      render: () => <BreadcrumbNavigationSlashSample />,
      code: `import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@open-mercato/ui/primitives/breadcrumb'

<Breadcrumb>
  <BreadcrumbList>
    <BreadcrumbItem>
      <BreadcrumbLink href="/backend">Dashboard</BreadcrumbLink>
    </BreadcrumbItem>
    <BreadcrumbSeparator />
    <BreadcrumbItem>
      <BreadcrumbLink href="/backend/products">Products</BreadcrumbLink>
    </BreadcrumbItem>
    <BreadcrumbSeparator />
    <BreadcrumbItem>
      <BreadcrumbPage>Winter catalog</BreadcrumbPage>
    </BreadcrumbItem>
  </BreadcrumbList>
</Breadcrumb>`,
    },
    {
      id: 'arrow',
      title: 'arrow divider',
      render: () => <BreadcrumbNavigationArrowSample />,
      code: `import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@open-mercato/ui/primitives/breadcrumb'

<Breadcrumb divider="arrow">
  <BreadcrumbList>
    <BreadcrumbItem>
      <BreadcrumbLink href="/backend/orders">Orders</BreadcrumbLink>
    </BreadcrumbItem>
    <BreadcrumbSeparator />
    <BreadcrumbItem>
      <BreadcrumbLink href="/backend/orders/20418">#20418</BreadcrumbLink>
    </BreadcrumbItem>
    <BreadcrumbSeparator />
    <BreadcrumbItem>
      <BreadcrumbPage>Shipment</BreadcrumbPage>
    </BreadcrumbItem>
  </BreadcrumbList>
</Breadcrumb>`,
    },
    {
      id: 'ellipsis',
      title: 'collapsed (ellipsis)',
      render: () => <BreadcrumbNavigationEllipsisSample />,
      code: `import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@open-mercato/ui/primitives/breadcrumb'

<Breadcrumb>
  <BreadcrumbList>
    <BreadcrumbItem>
      <BreadcrumbLink href="/backend">Dashboard</BreadcrumbLink>
    </BreadcrumbItem>
    <BreadcrumbSeparator />
    <BreadcrumbItem>
      <BreadcrumbEllipsis />
    </BreadcrumbItem>
    <BreadcrumbSeparator />
    <BreadcrumbItem>
      <BreadcrumbLink href="/backend/products/attributes">Attributes</BreadcrumbLink>
    </BreadcrumbItem>
    <BreadcrumbSeparator />
    <BreadcrumbItem>
      <BreadcrumbPage>Color</BreadcrumbPage>
    </BreadcrumbItem>
  </BreadcrumbList>
</Breadcrumb>`,
    },
    {
      id: 'dividers-quantities',
      title: 'Arrow / Slash / Dot ·3,4,5items',
      render: () => <BreadcrumbQuantityDemo />,
      code: `import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { LayoutGrid } from 'lucide-react'
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbSeparator, BreadcrumbLink, BreadcrumbPage } from '@open-mercato/ui/primitives/breadcrumb'

function BreadcrumbQuantityDemo() {
  const t = useT()
  const targetId = React.useId()
  return <div className="flex w-full flex-col gap-4">
    {(['arrow', 'slash', 'dot'] as const).map(divider => <div key={divider} className="flex flex-col gap-4">
      {[3, 4, 5].map(count => <Breadcrumb key={count} divider={divider} aria-label={t('design_system.gallery.examples.navigation2.path', { count })}>
        <BreadcrumbList className="flex-wrap">
          {Array.from({ length: count }, (_, index) => <React.Fragment key={index}>
            {index > 0 && <BreadcrumbSeparator className="size-5 justify-center">{divider === 'dot' ? '•' : undefined}</BreadcrumbSeparator>}
            <BreadcrumbItem>
              {index === count - 1
                ? <BreadcrumbPage>{t('design_system.gallery.examples.navigation2.section', { number: index + 1 })}</BreadcrumbPage>
                : <BreadcrumbLink href={\`#\${targetId}\`}><LayoutGrid className="size-5" aria-hidden="true" />{t('design_system.gallery.examples.navigation2.section', { number: index + 1 })}</BreadcrumbLink>}
            </BreadcrumbItem>
          </React.Fragment>)}
        </BreadcrumbList>
      </Breadcrumb>)}
    </div>)}
    <p id={targetId} tabIndex={-1} className="text-sm text-muted-foreground">{t('design_system.gallery.examples.navigation2.localDestination')}</p>
  </div>
}

<BreadcrumbQuantityDemo />`,
    },
  ],
}

const paginationEntry: GalleryEntry = {
  id: 'pagination',
  title: 'Pagination',
  importPath: '@open-mercato/ui/primitives/pagination',
  docsAnchor: '#pagination',
  figmaNodeId: '513:3892',
  variants: [
    {
      id: 'basic',
      title: 'Basic',
      render: () => <PaginationBasicDemo />,
      code: `import * as React from 'react'
import { Pagination } from '@open-mercato/ui/primitives/pagination'

const [page, setPage] = React.useState(2)
const [pageSize, setPageSize] = React.useState(25)

<Pagination
  page={page}
  pageSize={pageSize}
  total={400}
  onPageChange={setPage}
  onPageSizeChange={setPageSize}
/>`,
    },
    {
      id: 'compact',
      title: 'Compact',
      render: () => <PaginationCompactDemo />,
      code: `import * as React from 'react'
import { Pagination } from '@open-mercato/ui/primitives/pagination'

const [page, setPage] = React.useState(1)

<Pagination
  page={page}
  pageSize={20}
  total={120}
  onPageChange={setPage}
  showFirstLast={false}
  showPageSize={false}
/>`,
    },
    {
      id: 'source-basic',
      title: 'Basic cells',
      render: () => <PaginationBasicDemo appearance="basic" />,
      code: `import * as React from 'react'
import { Pagination } from '@open-mercato/ui/primitives/pagination'

const [page, setPage] = React.useState(2)
const [pageSize, setPageSize] = React.useState(25)

<Pagination
  appearance="basic"
  page={page}
  pageSize={pageSize}
  total={400}
  onPageChange={setPage}
  onPageSizeChange={setPageSize}
/>`,
    },
    {
      id: 'circle',
      title: 'Full radius',
      render: () => <PaginationBasicDemo appearance="circle" />,
      code: `import * as React from 'react'
import { Pagination } from '@open-mercato/ui/primitives/pagination'

const [page, setPage] = React.useState(2)
const [pageSize, setPageSize] = React.useState(25)

<Pagination
  appearance="circle"
  page={page}
  pageSize={pageSize}
  total={400}
  onPageChange={setPage}
  onPageSizeChange={setPageSize}
/>`,
    },
    {
      id: 'group',
      title: 'Connected group',
      render: () => <PaginationBasicDemo appearance="group" />,
      code: `import * as React from 'react'
import { Pagination } from '@open-mercato/ui/primitives/pagination'

const [page, setPage] = React.useState(2)
const [pageSize, setPageSize] = React.useState(25)

<Pagination
  appearance="group"
  page={page}
  pageSize={pageSize}
  total={400}
  onPageChange={setPage}
  onPageSizeChange={setPageSize}
/>`,
    },
    {
      id: 'disabled',
      title: 'Disabled states',
      render: () => <PaginationBasicDemo appearance="circle" disabled />,
      code: `import * as React from 'react'
import { Pagination } from '@open-mercato/ui/primitives/pagination'

const [page, setPage] = React.useState(2)
const [pageSize, setPageSize] = React.useState(25)

<Pagination
  appearance="circle"
  page={page}
  pageSize={pageSize}
  total={400}
  onPageChange={setPage}
  onPageSizeChange={setPageSize}
  disabled
/>`,
    },
  ],
}

const segmentedControlEntry: GalleryEntry = {
  id: 'segmented-control',
  figmaNodeId: '2604:114',
  title: 'SegmentedControl',
  importPath: '@open-mercato/ui/primitives/segmented-control',
  docsAnchor: '#segmentedcontrol',
  variants: [
    {
      id: 'default',
      title: 'default',
      render: () => <SegmentedControlNavigationDefaultSample />,
      code: `import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'

<SegmentedControl defaultValue="all" aria-label="View filter">
  <SegmentedControlItem value="all">All</SegmentedControlItem>
  <SegmentedControlItem value="active">Active</SegmentedControlItem>
  <SegmentedControlItem value="archived">Archived</SegmentedControlItem>
</SegmentedControl>`,
    },
    {
      id: 'small',
      title: 'Small',
      render: () => <SegmentedControlNavigationSmallSample />,
      code: `import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'

<SegmentedControl size="sm" defaultValue="30d" aria-label="Chart period">
  <SegmentedControlItem value="7d">7d</SegmentedControlItem>
  <SegmentedControlItem value="30d">30d</SegmentedControlItem>
  <SegmentedControlItem value="90d">90d</SegmentedControlItem>
  <SegmentedControlItem value="1y">1y</SegmentedControlItem>
</SegmentedControl>`,
    },
    {
      id: 'disabled',
      title: 'Disabled',
      render: () => <SegmentedControlNavigationDisabledSample />,
      code: `import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'

<SegmentedControl defaultValue="list" disabled aria-label="Layout">
  <SegmentedControlItem value="list">List</SegmentedControlItem>
  <SegmentedControlItem value="grid">Grid</SegmentedControlItem>
</SegmentedControl>`,
    },
    {
      id: 'source-text',
      title: 'Label shell · text',
      render: () => <SegmentedSourceDemo content="text" />,
      code: `import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { LayoutGrid, Settings, ShoppingCart } from 'lucide-react'
import { Label } from '@open-mercato/ui/primitives/label'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'

function SegmentedSourceDemo({ content }: { content: 'text' | 'leading' | 'icon' }) {
  const t = useT()
  const labelId = React.useId()
  const [value, setValue] = React.useState('overview')
  const options = [
    { value: 'overview', label: t('design_system.gallery.examples.navigation2.overview'), icon: <LayoutGrid className="size-5" aria-hidden="true" /> },
    { value: 'settings', label: t('design_system.gallery.examples.navigation2.settings'), icon: <Settings className="size-5" aria-hidden="true" /> },
    { value: 'orders', label: t('design_system.gallery.examples.navigation2.orders'), icon: <ShoppingCart className="size-5" aria-hidden="true" /> },
  ]
  return <div className="flex w-full max-w-sm flex-col gap-6">
    {[false, true].map(disabled => <div key={String(disabled)} className="flex flex-col gap-1.5">
      <Label id={\`\${labelId}-\${disabled}\`} className="leading-5">{disabled ? t('design_system.gallery.examples.navigation2.locked') : t('design_system.gallery.examples.navigation2.selectMenu')}</Label>
      <SegmentedControl value={value} onValueChange={setValue} disabled={disabled} aria-labelledby={\`\${labelId}-\${disabled}\`} className="h-9 w-full gap-1 rounded-lg border-0 p-1">
        {options.map(option => <SegmentedControlItem key={option.value} value={option.value} aria-label={content === 'icon' ? option.label : undefined} className="h-7 min-w-0 flex-1 gap-1.5 rounded-md p-1">
          {content !== 'text' && option.icon}
          {content !== 'icon' && option.label}
        </SegmentedControlItem>)}
      </SegmentedControl>
    </div>)}
  </div>
}

<SegmentedSourceDemo content="text" />`,
    },
    {
      id: 'source-leading',
      title: 'Label shell · leading',
      render: () => <SegmentedSourceDemo content="leading" />,
      code: `import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { LayoutGrid, Settings, ShoppingCart } from 'lucide-react'
import { Label } from '@open-mercato/ui/primitives/label'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'

function SegmentedSourceDemo({ content }: { content: 'text' | 'leading' | 'icon' }) {
  const t = useT()
  const labelId = React.useId()
  const [value, setValue] = React.useState('overview')
  const options = [
    { value: 'overview', label: t('design_system.gallery.examples.navigation2.overview'), icon: <LayoutGrid className="size-5" aria-hidden="true" /> },
    { value: 'settings', label: t('design_system.gallery.examples.navigation2.settings'), icon: <Settings className="size-5" aria-hidden="true" /> },
    { value: 'orders', label: t('design_system.gallery.examples.navigation2.orders'), icon: <ShoppingCart className="size-5" aria-hidden="true" /> },
  ]
  return <div className="flex w-full max-w-sm flex-col gap-6">
    {[false, true].map(disabled => <div key={String(disabled)} className="flex flex-col gap-1.5">
      <Label id={\`\${labelId}-\${disabled}\`} className="leading-5">{disabled ? t('design_system.gallery.examples.navigation2.locked') : t('design_system.gallery.examples.navigation2.selectMenu')}</Label>
      <SegmentedControl value={value} onValueChange={setValue} disabled={disabled} aria-labelledby={\`\${labelId}-\${disabled}\`} className="h-9 w-full gap-1 rounded-lg border-0 p-1">
        {options.map(option => <SegmentedControlItem key={option.value} value={option.value} aria-label={content === 'icon' ? option.label : undefined} className="h-7 min-w-0 flex-1 gap-1.5 rounded-md p-1">
          {content !== 'text' && option.icon}
          {content !== 'icon' && option.label}
        </SegmentedControlItem>)}
      </SegmentedControl>
    </div>)}
  </div>
}

<SegmentedSourceDemo content="leading" />`,
    },
    {
      id: 'source-icon',
      title: 'Label shell · icon',
      render: () => <SegmentedSourceDemo content="icon" />,
      code: `import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { LayoutGrid, Settings, ShoppingCart } from 'lucide-react'
import { Label } from '@open-mercato/ui/primitives/label'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'

function SegmentedSourceDemo({ content }: { content: 'text' | 'leading' | 'icon' }) {
  const t = useT()
  const labelId = React.useId()
  const [value, setValue] = React.useState('overview')
  const options = [
    { value: 'overview', label: t('design_system.gallery.examples.navigation2.overview'), icon: <LayoutGrid className="size-5" aria-hidden="true" /> },
    { value: 'settings', label: t('design_system.gallery.examples.navigation2.settings'), icon: <Settings className="size-5" aria-hidden="true" /> },
    { value: 'orders', label: t('design_system.gallery.examples.navigation2.orders'), icon: <ShoppingCart className="size-5" aria-hidden="true" /> },
  ]
  return <div className="flex w-full max-w-sm flex-col gap-6">
    {[false, true].map(disabled => <div key={String(disabled)} className="flex flex-col gap-1.5">
      <Label id={\`\${labelId}-\${disabled}\`} className="leading-5">{disabled ? t('design_system.gallery.examples.navigation2.locked') : t('design_system.gallery.examples.navigation2.selectMenu')}</Label>
      <SegmentedControl value={value} onValueChange={setValue} disabled={disabled} aria-labelledby={\`\${labelId}-\${disabled}\`} className="h-9 w-full gap-1 rounded-lg border-0 p-1">
        {options.map(option => <SegmentedControlItem key={option.value} value={option.value} aria-label={content === 'icon' ? option.label : undefined} className="h-7 min-w-0 flex-1 gap-1.5 rounded-md p-1">
          {content !== 'text' && option.icon}
          {content !== 'icon' && option.label}
        </SegmentedControlItem>)}
      </SegmentedControl>
    </div>)}
  </div>
}

<SegmentedSourceDemo content="icon" />`,
    },
  ],
}

const accordionEntry: GalleryEntry = {
  id: 'accordion',
  figmaNodeId: '210:4022',
  title: 'Accordion',
  importPath: '@open-mercato/ui/primitives/accordion',
  docsAnchor: '#accordion',
  variants: [
    {
      id: 'card',
      title: 'card (default)',
      render: () => <AccordionNavigationCardSample />,
      code: `import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@open-mercato/ui/primitives/accordion'

<Accordion type="single" collapsible defaultValue="shipping" className="w-full space-y-2">
  <AccordionItem value="shipping">
    <AccordionTrigger>Shipping and delivery</AccordionTrigger>
    <AccordionContent>Orders placed before 2 PM ship the same business day.</AccordionContent>
  </AccordionItem>
  <AccordionItem value="returns">
    <AccordionTrigger>Returns</AccordionTrigger>
    <AccordionContent>Items can be returned within 30 days of delivery.</AccordionContent>
  </AccordionItem>
  <AccordionItem value="payments">
    <AccordionTrigger>Payment methods</AccordionTrigger>
    <AccordionContent>We accept cards, bank transfer, and deferred payment.</AccordionContent>
  </AccordionItem>
</Accordion>`,
    },
    {
      id: 'left-icon',
      title: 'With leftIcon',
      render: () => <AccordionNavigationLeftIconSample />,
      code: `import { CreditCard, Truck } from 'lucide-react'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@open-mercato/ui/primitives/accordion'

<Accordion type="single" collapsible className="w-full space-y-2">
  <AccordionItem value="shipping">
    <AccordionTrigger leftIcon={<Truck />}>How fast is shipping?</AccordionTrigger>
    <AccordionContent>Same-day dispatch on weekdays.</AccordionContent>
  </AccordionItem>
  <AccordionItem value="billing">
    <AccordionTrigger leftIcon={<CreditCard />}>When am I charged?</AccordionTrigger>
    <AccordionContent>Your card is charged when the order ships.</AccordionContent>
  </AccordionItem>
</Accordion>`,
    },
    {
      id: 'chevron',
      title: 'Chevron indicator',
      render: () => <AccordionNavigationChevronSample />,
      code: `import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@open-mercato/ui/primitives/accordion'

<Accordion type="multiple" className="w-full space-y-2">
  <AccordionItem value="general">
    <AccordionTrigger triggerIcon="chevron">General</AccordionTrigger>
    <AccordionContent>Store name, contact details, and default locale.</AccordionContent>
  </AccordionItem>
  <AccordionItem value="advanced">
    <AccordionTrigger triggerIcon="chevron">Advanced</AccordionTrigger>
    <AccordionContent>Webhooks, API keys, and developer configuration.</AccordionContent>
  </AccordionItem>
</Accordion>`,
    },
    {
      id: 'indicator-start',
      title: 'Indicator at start · closed/open/disabled',
      render: () => <AccordionStartDemo />,
      code: `import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@open-mercato/ui/primitives/accordion'

function AccordionStartDemo() {
  const t = useT()
  return <Accordion type="single" collapsible defaultValue="details" className="w-full max-w-md space-y-2">
    <AccordionItem value="overview">
      <AccordionTrigger iconPosition="start">{t('design_system.gallery.examples.navigation2.overview')}</AccordionTrigger>
      <AccordionContent>{t('design_system.gallery.examples.navigation2.accordionBody')}</AccordionContent>
    </AccordionItem>
    <AccordionItem value="details">
      <AccordionTrigger iconPosition="start">{t('design_system.gallery.examples.navigation2.settings')}</AccordionTrigger>
      <AccordionContent>{t('design_system.gallery.examples.navigation2.accordionBody')}</AccordionContent>
    </AccordionItem>
    <AccordionItem value="locked" disabled>
      <AccordionTrigger iconPosition="start">{t('design_system.gallery.examples.navigation2.locked')}</AccordionTrigger>
      <AccordionContent>{t('design_system.gallery.examples.navigation2.accordionBody')}</AccordionContent>
    </AccordionItem>
  </Accordion>
}

<AccordionStartDemo />`,
    },
  ],
}

const sidebarEntry: GalleryEntry = {
  id: 'sidebar',
  title: 'Sidebar and Topbar',
  figmaNodeId: '3802:11759',
  importPath: '@open-mercato/ui/primitives/sidebar',
  usage: { do: ['Presentational composition with local state; the application AppShell still owns tenant APIs and injection points.', 'Hover, current navigation, workspace switching, filtering and feature-card actions use real controls.', 'Feature-card primary and neutral surfaces use the existing accessible application palettes; they do not claim exact Figma color parity.'] },
  variants: [
    { id: 'items', title: 'Sidebar items / expanded and collapsed', render: () => <SidebarItemsExample />, code: shellExampleCode('<SidebarItemsExample />') },
    { id: 'identity-cards', title: 'Header and profile cards / expanded and collapsed', render: () => <SidebarIdentityExample />, code: shellExampleCode('<SidebarIdentityExample />') },
    { id: 'feature-meeting', title: 'Feature card / meeting / 4 styles', render: () => <SidebarFeatureExample type="meeting" />, code: shellExampleCode('<SidebarFeatureExample type="meeting" />') },
    { id: 'feature-progress', title: 'Feature card / progress / 4 styles', render: () => <SidebarFeatureExample type="progress" />, code: shellExampleCode('<SidebarFeatureExample type="progress" />') },
    { id: 'feature-link', title: 'Feature card / link / 4 styles', render: () => <SidebarFeatureExample type="link" />, code: shellExampleCode('<SidebarFeatureExample type="link" />') },
    { id: 'feature-gift', title: 'Feature card / gift / 4 styles', render: () => <SidebarFeatureExample type="gift" />, code: shellExampleCode('<SidebarFeatureExample type="gift" />') },
    { id: 'feature-storage', title: 'Feature card / storage / 4 styles', render: () => <SidebarFeatureExample type="storage" />, code: shellExampleCode('<SidebarFeatureExample type="storage" />') },
    { id: 'feature-support', title: 'Feature card / support / 4 styles', render: () => <SidebarFeatureExample type="support" />, code: shellExampleCode('<SidebarFeatureExample type="support" />') },
    { id: 'topbar-hr-default', title: 'HR topbar / default', render: () => <TopbarExample product="hr" />, code: shellExampleCode('<TopbarExample product="hr" />') },
    { id: 'topbar-hr-icons', title: 'HR topbar / icons', render: () => <TopbarExample product="hr" icons />, code: shellExampleCode('<TopbarExample product="hr" icons />') },
    { id: 'topbar-finance-default', title: 'FINANCE topbar / default', render: () => <TopbarExample product="finance" />, code: shellExampleCode('<TopbarExample product="finance" />') },
    { id: 'topbar-finance-icons', title: 'FINANCE topbar / icons', render: () => <TopbarExample product="finance" icons />, code: shellExampleCode('<TopbarExample product="finance" icons />') },
    { id: 'brand-artwork', title: 'Synergy and Apex / 6 original assets', render: () => <NavigationBrandsExample />, code: shellExampleCode('<NavigationBrandsExample />') },
  ],
}

const promptAreaEntry: GalleryEntry = {
  id: 'prompt-area',
  title: 'PromptArea',
  figmaNodeId: '191226:4236',
  importPath: '@open-mercato/ui/primitives/prompt-area',
  usage: { do: ['Desktop and mobile compositions expose all 18 source variants through real hover and focus states.', 'Enter saves a local draft; Shift+Enter inserts a line break. Attachments stay in this browser and can be removed.', 'Model names reproduce source labels. These examples do not call a model or represent a subscription.'] },
  variants: [
    { id: 'desktop', title: 'Desktop / empty / Default, Hover, Active', render: () => <AiPromptExample />, code: aiProductExampleCode('<AiPromptExample />') },
    { id: 'desktop-file', title: 'Desktop / file', render: () => <AiPromptExample attachment="file" />, code: aiProductExampleCode('<AiPromptExample attachment="file" />') },
    { id: 'desktop-image', title: 'Desktop / original image', render: () => <AiPromptExample attachment="image" />, code: aiProductExampleCode('<AiPromptExample attachment="image" />') },
    { id: 'mobile', title: 'Mobile / empty / Default, Hover, Active', render: () => <AiPromptExample compact />, code: aiProductExampleCode('<AiPromptExample compact />') },
    { id: 'mobile-file', title: 'Mobile / file', render: () => <AiPromptExample compact attachment="file" />, code: aiProductExampleCode('<AiPromptExample compact attachment="file" />') },
    { id: 'mobile-image', title: 'Mobile / original image', render: () => <AiPromptExample compact attachment="image" />, code: aiProductExampleCode('<AiPromptExample compact attachment="image" />') },
  ],
}

// Composed AI-product patterns: point at the demo module rather than claiming a primitive's import path.
const aiProductPatternCode = (expression: string) => `import { ${expression.match(/<(\w+)/)?.[1] ?? 'AiPromptExample'} } from '@open-mercato/core/modules/design_system/gallery/demos/ai-product'

${expression}
`

const aiControlsEntry: GalleryEntry = {
  id: 'ai-controls',
  title: 'AI Product / Controls',
  figmaNodeId: '191042:2378',
  importPath: '@open-mercato/core/modules/design_system/gallery/demos/ai-product',
  usage: { do: ['Source-specific compositions reuse existing primitives with additive semantic radius and typography tokens.', 'Hover, keyboard focus and selected states are real interactions. Authentication buttons only display local explanatory feedback.', 'Original authentication glyphs are preserved as source assets. Application fonts, focus and semantic colors remain explicit adaptations.'] },
  variants: [
    { id: 'chat-buttons', title: 'Chat custom buttons / 2 styles × 3 states', render: () => <AiIconButtonExamples chat />, code: aiProductPatternCode('<AiIconButtonExamples chat />') },
    { id: 'icon-buttons', title: 'Custom icon buttons / 4 sizes × 2 tones × 3 states', render: () => <AiIconButtonExamples />, code: aiProductPatternCode('<AiIconButtonExamples />') },
    { id: 'search', title: 'Search / 2 sizes × 3 states', render: () => <AiSearchExamples />, code: aiProductPatternCode('<AiSearchExamples />') },
    { id: 'new-chat', title: 'New chat / Default, Hover', render: () => <AiNewChatExample />, code: aiProductPatternCode('<AiNewChatExample />') },
    { id: 'navigation-items', title: 'Navigation items / 12 variants', render: () => <AiNavigationExamples />, code: aiProductPatternCode('<AiNavigationExamples />') },
    { id: 'auth-icons', title: 'Authentication / 8 original icons', render: () => <AiAuthExamples />, code: aiProductPatternCode('<AiAuthExamples />') },
    { id: 'social-google', title: 'Google button / local feedback', render: () => <AiAuthExamples kind="social" />, code: aiProductPatternCode('<AiAuthExamples kind="social" />') },
    { id: 'text-input', title: 'Text input / 5 source states', render: () => <AiAuthExamples kind="text" />, code: aiProductPatternCode('<AiAuthExamples kind="text" />') },
    { id: 'digit-input', title: 'Digit input / 5 source states', render: () => <AiAuthExamples kind="digits" />, code: aiProductPatternCode('<AiAuthExamples kind="digits" />') },
    { id: 'settings', title: 'Settings navigation, select, counter and model / 15 variants', render: () => <AiSettingsExamples />, code: aiProductPatternCode('<AiSettingsExamples />') },
  ],
}

const aiSidebarEntry: GalleryEntry = {
  id: 'ai-sidebar',
  title: 'AI Product / Sidebar',
  figmaNodeId: '191050:3105',
  importPath: '@open-mercato/ui/primitives/sidebar',
  usage: { do: ['All four source sidebar variants render using the presentational Sidebar without application API calls.', 'Search filters the local history, navigation updates the selected item, and new chat creates a local draft counter.', 'The collapsed logo expands the sidebar; this adds a keyboard-accessible restoration control to the source composition.'] },
  variants: [
    { id: 'search-01', title: 'Search 01 / expanded / 272 × 900', render: () => <AiSidebarExample />, code: aiProductExampleCode('<AiSidebarExample />') },
    { id: 'search-02', title: 'Search 02 / expanded', render: () => <AiSidebarExample search="02" />, code: aiProductExampleCode('<AiSidebarExample search="02" />') },
    { id: 'search-03', title: 'Search 03 / expanded', render: () => <AiSidebarExample search="03" />, code: aiProductExampleCode('<AiSidebarExample search="03" />') },
    { id: 'collapsed', title: 'Search 01 / collapsed / 72 × 900', render: () => <AiSidebarExample initialCollapsed />, code: aiProductExampleCode('<AiSidebarExample initialCollapsed />') },
  ],
}

const aiMobileNavigationEntry: GalleryEntry = {
  id: 'ai-mobile-navigation',
  title: 'AI Product / Mobile Navigation',
  figmaNodeId: '192681:59134',
  importPath: '@open-mercato/core/modules/design_system/gallery/demos/ai-product',
  usage: { do: ['All four 390 × 64 source compositions have working local controls and keyboard-accessible popovers.', 'Add project stores the entered name only in component state. Escape closes the popover, Enter or Ctrl/Cmd+Enter confirms.'] },
  variants: [
    { id: 'default', title: 'Default', render: () => <AiMobileNavigationExample />, code: aiProductPatternCode('<AiMobileNavigationExample />') },
    { id: 'in-projects', title: 'In Projects', render: () => <AiMobileNavigationExample kind="in-projects" />, code: aiProductPatternCode('<AiMobileNavigationExample kind="in-projects" />') },
    { id: 'projects', title: 'Projects', render: () => <AiMobileNavigationExample kind="projects" />, code: aiProductPatternCode('<AiMobileNavigationExample kind="projects" />') },
    { id: 'project-details', title: 'Project Details', render: () => <AiMobileNavigationExample kind="project-details" />, code: aiProductPatternCode('<AiMobileNavigationExample kind="project-details" />') },
  ],
}

export const entries: GalleryEntry[] = [
  promptAreaEntry,
  aiControlsEntry,
  aiSidebarEntry,
  aiMobileNavigationEntry,
  sidebarEntry,
  tabsEntry,
  breadcrumbEntry,
  paginationEntry,
  segmentedControlEntry,
  accordionEntry,
]

function TabsNavigationUnderlineSample() {
  const t = useT()
  return (<Tabs defaultValue="orders" variant="underline" className="w-full">
          <TabsList aria-label={t('design_system.gallery.sampleCopy.customerSections')}>
            <TabsTrigger value="overview" leading={<LayoutGrid className="size-4" />}>
              {t('design_system.gallery.examples.navigation2.overview')}
            </TabsTrigger>
            <TabsTrigger value="orders" leading={<ShoppingCart className="size-4" />} count={12}>
              {t('design_system.gallery.examples.navigation2.orders')}
            </TabsTrigger>
            <TabsTrigger value="settings" leading={<Settings className="size-4" />}>
              {t('design_system.gallery.examples.navigation2.settings')}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="overview">
            <p className="text-sm text-muted-foreground">{t('design_system.gallery.sampleCopy.customerOverviewPanel')}</p>
          </TabsContent>
          <TabsContent value="orders">
            <p className="text-sm text-muted-foreground">{t('design_system.gallery.sampleCopy.12OrdersInTheLast30Days')}</p>
          </TabsContent>
          <TabsContent value="settings">
            <p className="text-sm text-muted-foreground">{t('design_system.gallery.sampleCopy.notificationAndAccessSettings')}</p>
          </TabsContent>
        </Tabs>)
}

function TabsNavigationPillSample() {
  const t = useT()
  return (<Tabs defaultValue="preview">
          <TabsList aria-label={t('design_system.gallery.sampleCopy.editorView')}>
            <TabsTrigger value="preview">{t('design_system.gallery.samples.table.preview')}</TabsTrigger>
            <TabsTrigger value="code">{t('design_system.gallery.samples.richEditor.labels.code')}</TabsTrigger>
            <TabsTrigger value="logs">{t('design_system.gallery.sampleCopy.logs')}</TabsTrigger>
          </TabsList>
          <TabsContent value="preview">
            <p className="text-sm text-muted-foreground">{t('design_system.gallery.sampleCopy.renderedPreview')}</p>
          </TabsContent>
          <TabsContent value="code">
            <p className="text-sm text-muted-foreground">{t('design_system.gallery.sampleCopy.sourceCodePanel')}</p>
          </TabsContent>
          <TabsContent value="logs">
            <p className="text-sm text-muted-foreground">{t('design_system.gallery.sampleCopy.runtimeLogsPanel')}</p>
          </TabsContent>
        </Tabs>)
}

function TabsNavigationPillVerticalSample() {
  const t = useT()
  return (<Tabs defaultValue="profile" orientation="vertical" className="w-full">
          <TabsList aria-label={t('design_system.gallery.samples.crypto.accountSettings')}>
            <TabsTrigger value="profile">{t('design_system.gallery.samples.crypto.profile')}</TabsTrigger>
            <TabsTrigger value="billing">{t('design_system.gallery.samples.marketing.billing')}</TabsTrigger>
            <TabsTrigger value="security">{t('design_system.gallery.sampleCopy.security')}</TabsTrigger>
          </TabsList>
          <TabsContent value="profile">
            <p className="text-sm text-muted-foreground">{t('design_system.gallery.sampleCopy.profileSettingsPanel')}</p>
          </TabsContent>
          <TabsContent value="billing">
            <p className="text-sm text-muted-foreground">{t('design_system.gallery.sampleCopy.billingSettingsPanel')}</p>
          </TabsContent>
          <TabsContent value="security">
            <p className="text-sm text-muted-foreground">{t('design_system.gallery.sampleCopy.securitySettingsPanel')}</p>
          </TabsContent>
        </Tabs>)
}

function BreadcrumbNavigationSlashSample() {
  const t = useT()
  return (<Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="#gallery-entry-breadcrumb">{t('design_system.gallery.examples.shell.dashboard')}</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href="#gallery-entry-breadcrumb">{t('design_system.gallery.sampleCopy.products')}</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{t('design_system.gallery.sampleCopy.winterCatalog')}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>)
}

function BreadcrumbNavigationArrowSample() {
  const t = useT()
  return (<Breadcrumb divider="arrow">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="#gallery-entry-breadcrumb">{t('design_system.gallery.examples.navigation2.orders')}</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href="#gallery-entry-breadcrumb">#20418</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{t('design_system.gallery.sampleCopy.shipment')}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>)
}

function BreadcrumbNavigationEllipsisSample() {
  const t = useT()
  return (<Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="#gallery-entry-breadcrumb">{t('design_system.gallery.examples.shell.dashboard')}</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbEllipsis />
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href="#gallery-entry-breadcrumb">{t('design_system.gallery.sampleCopy.attributes')}</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{t('design_system.gallery.samples.richEditor.labels.textColor')}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>)
}

function SegmentedControlNavigationDefaultSample() {
  const t = useT()
  return (<SegmentedControl defaultValue="all" aria-label={t('design_system.gallery.sampleCopy.viewFilter')}>
          <SegmentedControlItem value="all">{t('design_system.gallery.samples.feeds.all')}</SegmentedControlItem>
          <SegmentedControlItem value="active">{t('design_system.gallery.samples.finance.active')}</SegmentedControlItem>
          <SegmentedControlItem value="archived">{t('design_system.gallery.sampleCopy.archived')}</SegmentedControlItem>
        </SegmentedControl>)
}

function SegmentedControlNavigationSmallSample() {
  const t = useT()
  return (<SegmentedControl size="sm" defaultValue={t('design_system.gallery.sampleCopy.30d')} aria-label={t('design_system.gallery.samples.crypto.chartRange')}>
          <SegmentedControlItem value="7d">{t('design_system.gallery.sampleCopy.7d')}</SegmentedControlItem>
          <SegmentedControlItem value="30d">{t('design_system.gallery.sampleCopy.30d')}</SegmentedControlItem>
          <SegmentedControlItem value="90d">{t('design_system.gallery.sampleCopy.90d')}</SegmentedControlItem>
          <SegmentedControlItem value="1y">{t('design_system.gallery.sampleCopy.1y')}</SegmentedControlItem>
        </SegmentedControl>)
}

function SegmentedControlNavigationDisabledSample() {
  const t = useT()
  return (<SegmentedControl defaultValue="list" disabled aria-label={t('design_system.gallery.sampleCopy.layout')}>
          <SegmentedControlItem value="list">{t('design_system.gallery.sampleCopy.list')}</SegmentedControlItem>
          <SegmentedControlItem value="grid">{t('design_system.gallery.sampleCopy.grid')}</SegmentedControlItem>
        </SegmentedControl>)
}

function AccordionNavigationCardSample() {
  const t = useT()
  return (<Accordion type="single" collapsible defaultValue="shipping" className="w-full space-y-2">
          <AccordionItem value="shipping">
            <AccordionTrigger>{t('design_system.gallery.sampleCopy.shippingAndDelivery')}</AccordionTrigger>
            <AccordionContent>
              {t('design_system.gallery.sampleCopy.ordersPlacedBefore2PMShipTheSameBusinessDay')}
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="returns">
            <AccordionTrigger>{t('design_system.gallery.sampleCopy.returns')}</AccordionTrigger>
            <AccordionContent>
              {t('design_system.gallery.sampleCopy.itemsCanBeReturnedWithin30DaysOfDeliveryIn')}
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="payments">
            <AccordionTrigger>{t('design_system.gallery.sampleCopy.paymentMethods')}</AccordionTrigger>
            <AccordionContent>
              {t('design_system.gallery.sampleCopy.weAcceptCardsBankTransferAndDeferredPaymentForVerified')}
            </AccordionContent>
          </AccordionItem>
        </Accordion>)
}

function AccordionNavigationLeftIconSample() {
  const t = useT()
  return (<Accordion type="single" collapsible className="w-full space-y-2">
          <AccordionItem value="shipping">
            <AccordionTrigger leftIcon={<Truck />}>{t('design_system.gallery.sampleCopy.howFastIsShipping')}</AccordionTrigger>
            <AccordionContent>
              {t('design_system.gallery.sampleCopy.samedayDispatchOnWeekdaysDeliveryTypicallyTakes13BusinessDays')}
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="billing">
            <AccordionTrigger leftIcon={<CreditCard />}>{t('design_system.gallery.sampleCopy.whenAmICharged')}</AccordionTrigger>
            <AccordionContent>
              {t('design_system.gallery.sampleCopy.yourCardIsChargedWhenTheOrderShipsNeverAt')}
            </AccordionContent>
          </AccordionItem>
        </Accordion>)
}

function AccordionNavigationChevronSample() {
  const t = useT()
  return (<Accordion type="multiple" className="w-full space-y-2">
          <AccordionItem value="general">
            <AccordionTrigger triggerIcon="chevron">{t('design_system.gallery.sampleCopy.general')}</AccordionTrigger>
            <AccordionContent>
              {t('design_system.gallery.sampleCopy.storeNameContactDetailsAndDefaultLocaleForTheStorefront')}
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="advanced">
            <AccordionTrigger triggerIcon="chevron">{t('design_system.gallery.samples.finance.advanced')}</AccordionTrigger>
            <AccordionContent>
              {t('design_system.gallery.sampleCopy.webhooksAPIKeysAndOtherDeveloperfacingConfiguration')}
            </AccordionContent>
          </AccordionItem>
        </Accordion>)
}
