import * as React from 'react'
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
import { Pagination } from '@open-mercato/ui/primitives/pagination'
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
import type { GalleryEntry } from '../types'

// Component titles and variant names are proper nouns from the codebase and
// are deliberately not translated. `code` MUST contain the entry's importPath
// (enforced by the registry-integrity test) and is always reviewed alongside
// its sibling `render`.

// Pagination is a controlled component — these small wrappers own the page
// state so the preview stays interactive without polluting the entry shape.

function PaginationBasicDemo() {
  const [page, setPage] = React.useState(2)
  const [pageSize, setPageSize] = React.useState(25)
  return (
    <Pagination
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

const tabsEntry: GalleryEntry = {
  id: 'tabs',
  title: 'Tabs',
  importPath: '@open-mercato/ui/primitives/tabs',
  docsAnchor: '#tabs',
  figmaNodeId: '553:734',
  variants: [
    {
      id: 'underline',
      title: 'underline',
      // Underline is the DS canon for page-level tab strips — flat rail
      // with an accent underline, per-tab `leading` icon and `count` badge.
      render: () => (
        <Tabs defaultValue="orders" variant="underline" className="w-full">
          <TabsList aria-label="Customer sections">
            <TabsTrigger value="overview" leading={<LayoutGrid className="size-4" />}>
              Overview
            </TabsTrigger>
            <TabsTrigger value="orders" leading={<ShoppingCart className="size-4" />} count={12}>
              Orders
            </TabsTrigger>
            <TabsTrigger value="settings" leading={<Settings className="size-4" />}>
              Settings
            </TabsTrigger>
          </TabsList>
          <TabsContent value="overview">
            <p className="text-sm text-muted-foreground">Customer overview panel.</p>
          </TabsContent>
          <TabsContent value="orders">
            <p className="text-sm text-muted-foreground">12 orders in the last 30 days.</p>
          </TabsContent>
          <TabsContent value="settings">
            <p className="text-sm text-muted-foreground">Notification and access settings.</p>
          </TabsContent>
        </Tabs>
      ),
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
      render: () => (
        <Tabs defaultValue="preview">
          <TabsList aria-label="Editor view">
            <TabsTrigger value="preview">Preview</TabsTrigger>
            <TabsTrigger value="code">Code</TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
          </TabsList>
          <TabsContent value="preview">
            <p className="text-sm text-muted-foreground">Rendered preview.</p>
          </TabsContent>
          <TabsContent value="code">
            <p className="text-sm text-muted-foreground">Source code panel.</p>
          </TabsContent>
          <TabsContent value="logs">
            <p className="text-sm text-muted-foreground">Runtime logs panel.</p>
          </TabsContent>
        </Tabs>
      ),
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
      render: () => (
        <Tabs defaultValue="profile" orientation="vertical" className="w-full">
          <TabsList aria-label="Account settings">
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="billing">Billing</TabsTrigger>
            <TabsTrigger value="security">Security</TabsTrigger>
          </TabsList>
          <TabsContent value="profile">
            <p className="text-sm text-muted-foreground">Profile settings panel.</p>
          </TabsContent>
          <TabsContent value="billing">
            <p className="text-sm text-muted-foreground">Billing settings panel.</p>
          </TabsContent>
          <TabsContent value="security">
            <p className="text-sm text-muted-foreground">Security settings panel.</p>
          </TabsContent>
        </Tabs>
      ),
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
  ],
}

const breadcrumbEntry: GalleryEntry = {
  id: 'breadcrumb',
  title: 'Breadcrumb',
  importPath: '@open-mercato/ui/primitives/breadcrumb',
  docsAnchor: '#breadcrumb',
  variants: [
    {
      id: 'slash',
      title: 'slash (default)',
      render: () => (
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="#gallery-entry-breadcrumb">Dashboard</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href="#gallery-entry-breadcrumb">Products</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Winter catalog</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      ),
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
      render: () => (
        <Breadcrumb divider="arrow">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="#gallery-entry-breadcrumb">Orders</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href="#gallery-entry-breadcrumb">#20418</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Shipment</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      ),
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
      render: () => (
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="#gallery-entry-breadcrumb">Dashboard</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbEllipsis />
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href="#gallery-entry-breadcrumb">Attributes</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Color</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      ),
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
  ],
}

const paginationEntry: GalleryEntry = {
  id: 'pagination',
  title: 'Pagination',
  importPath: '@open-mercato/ui/primitives/pagination',
  docsAnchor: '#pagination',
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
  ],
}

const segmentedControlEntry: GalleryEntry = {
  id: 'segmented-control',
  title: 'SegmentedControl',
  importPath: '@open-mercato/ui/primitives/segmented-control',
  docsAnchor: '#segmentedcontrol',
  variants: [
    {
      id: 'default',
      title: 'default',
      render: () => (
        <SegmentedControl defaultValue="all" aria-label="View filter">
          <SegmentedControlItem value="all">All</SegmentedControlItem>
          <SegmentedControlItem value="active">Active</SegmentedControlItem>
          <SegmentedControlItem value="archived">Archived</SegmentedControlItem>
        </SegmentedControl>
      ),
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
      render: () => (
        <SegmentedControl size="sm" defaultValue="30d" aria-label="Chart period">
          <SegmentedControlItem value="7d">7d</SegmentedControlItem>
          <SegmentedControlItem value="30d">30d</SegmentedControlItem>
          <SegmentedControlItem value="90d">90d</SegmentedControlItem>
          <SegmentedControlItem value="1y">1y</SegmentedControlItem>
        </SegmentedControl>
      ),
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
      render: () => (
        <SegmentedControl defaultValue="list" disabled aria-label="Layout">
          <SegmentedControlItem value="list">List</SegmentedControlItem>
          <SegmentedControlItem value="grid">Grid</SegmentedControlItem>
        </SegmentedControl>
      ),
      code: `import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'

<SegmentedControl defaultValue="list" disabled aria-label="Layout">
  <SegmentedControlItem value="list">List</SegmentedControlItem>
  <SegmentedControlItem value="grid">Grid</SegmentedControlItem>
</SegmentedControl>`,
    },
  ],
}

const accordionEntry: GalleryEntry = {
  id: 'accordion',
  title: 'Accordion',
  importPath: '@open-mercato/ui/primitives/accordion',
  docsAnchor: '#accordion',
  variants: [
    {
      id: 'card',
      title: 'card (default)',
      render: () => (
        <Accordion type="single" collapsible defaultValue="shipping" className="w-full space-y-2">
          <AccordionItem value="shipping">
            <AccordionTrigger>Shipping and delivery</AccordionTrigger>
            <AccordionContent>
              Orders placed before 2 PM ship the same business day from the nearest warehouse.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="returns">
            <AccordionTrigger>Returns</AccordionTrigger>
            <AccordionContent>
              Items can be returned within 30 days of delivery in their original packaging.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="payments">
            <AccordionTrigger>Payment methods</AccordionTrigger>
            <AccordionContent>
              We accept cards, bank transfer, and deferred payment for verified B2B accounts.
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      ),
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
      render: () => (
        <Accordion type="single" collapsible className="w-full space-y-2">
          <AccordionItem value="shipping">
            <AccordionTrigger leftIcon={<Truck />}>How fast is shipping?</AccordionTrigger>
            <AccordionContent>
              Same-day dispatch on weekdays; delivery typically takes 1–3 business days.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="billing">
            <AccordionTrigger leftIcon={<CreditCard />}>When am I charged?</AccordionTrigger>
            <AccordionContent>
              Your card is charged when the order ships, never at checkout.
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      ),
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
      render: () => (
        <Accordion type="multiple" className="w-full space-y-2">
          <AccordionItem value="general">
            <AccordionTrigger triggerIcon="chevron">General</AccordionTrigger>
            <AccordionContent>
              Store name, contact details, and default locale for the storefront.
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="advanced">
            <AccordionTrigger triggerIcon="chevron">Advanced</AccordionTrigger>
            <AccordionContent>
              Webhooks, API keys, and other developer-facing configuration.
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      ),
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
  ],
}

export const entries: GalleryEntry[] = [
  tabsEntry,
  breadcrumbEntry,
  paginationEntry,
  segmentedControlEntry,
  accordionEntry,
]
