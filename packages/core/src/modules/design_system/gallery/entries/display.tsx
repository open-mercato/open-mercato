import * as React from 'react'
import { Building2, MoreHorizontal } from 'lucide-react'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { Avatar, AvatarStack } from '@open-mercato/ui/primitives/avatar'
import { Kbd, KbdShortcut } from '@open-mercato/ui/primitives/kbd'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@open-mercato/ui/primitives/table'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@open-mercato/ui/primitives/card'
import { Separator } from '@open-mercato/ui/primitives/separator'
import { ScrollArea } from '@open-mercato/ui/primitives/scroll-area'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { tableComposeSchema } from '../../mockups/composeContracts'
import {
  ActivityFeed,
  ActivityFeedComment,
  ActivityFeedFileChip,
  ActivityFeedItem,
  ActivityFeedStatusChip,
} from '@open-mercato/ui/primitives/activity-feed'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import type { GalleryEntry } from '../types'

// Component titles and variant names are proper nouns from the codebase and
// are deliberately not translated. `code` MUST contain the entry's importPath
// (enforced by the registry-integrity test) and is always reviewed alongside
// its sibling `render`.

const badgeEntry: GalleryEntry = {
  id: 'badge',
  title: 'Badge',
  importPath: '@open-mercato/ui/primitives/badge',
  variants: [
    {
      id: 'semantic',
      title: 'Semantic variants',
      render: () => (
        <>
          <Badge variant="success">Success</Badge>
          <Badge variant="warning">Warning</Badge>
          <Badge variant="info">Info</Badge>
          <Badge variant="neutral">Neutral</Badge>
          <Badge variant="error">Error</Badge>
          <Badge variant="brand">Brand</Badge>
        </>
      ),
      code: `import { Badge } from '@open-mercato/ui/primitives/badge'

<Badge variant="success">Success</Badge>
<Badge variant="warning">Warning</Badge>
<Badge variant="info">Info</Badge>
<Badge variant="neutral">Neutral</Badge>
<Badge variant="error">Error</Badge>
<Badge variant="brand">Brand</Badge>`,
    },
    {
      id: 'sizes',
      title: 'Sizes',
      render: () => (
        <>
          <Badge variant="info" size="lg">Large</Badge>
          <Badge variant="info" size="default">Default</Badge>
          <Badge variant="info" size="sm">Small</Badge>
        </>
      ),
      code: `import { Badge } from '@open-mercato/ui/primitives/badge'

<Badge variant="info" size="lg">Large</Badge>
<Badge variant="info" size="default">Default</Badge>
<Badge variant="info" size="sm">Small</Badge>`,
    },
    {
      id: 'dot',
      title: 'With dot',
      render: () => (
        <>
          <Badge variant="success" dot>Active</Badge>
          <Badge variant="neutral" dot>Draft</Badge>
          <Badge variant="brand" dot>Custom view</Badge>
        </>
      ),
      code: `import { Badge } from '@open-mercato/ui/primitives/badge'

<Badge variant="success" dot>Active</Badge>
<Badge variant="neutral" dot>Draft</Badge>
<Badge variant="brand" dot>Custom view</Badge>`,
    },
    {
      id: 'removable',
      title: 'Removable',
      render: () => (
        <>
          <Badge variant="neutral" removable onRemove={() => {}}>Filter: Region</Badge>
          <Badge variant="brand" removable onRemove={() => {}}>Renewal</Badge>
        </>
      ),
      code: `import { Badge } from '@open-mercato/ui/primitives/badge'

<Badge variant="neutral" removable onRemove={() => setRegion(null)}>Filter: Region</Badge>
<Badge variant="brand" removable onRemove={() => clearTag()}>Renewal</Badge>`,
    },
  ],
}

const statusBadgeEntry: GalleryEntry = {
  id: 'status-badge',
  title: 'StatusBadge',
  importPath: '@open-mercato/ui/primitives/status-badge',
  variants: [
    {
      id: 'with-dot',
      title: 'Variants with dot',
      render: () => (
        <>
          <StatusBadge variant="success" dot>Active</StatusBadge>
          <StatusBadge variant="warning" dot>Pending</StatusBadge>
          <StatusBadge variant="error" dot>Failed</StatusBadge>
          <StatusBadge variant="info" dot>Syncing</StatusBadge>
          <StatusBadge variant="neutral" dot>Archived</StatusBadge>
        </>
      ),
      code: `import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'

<StatusBadge variant="success" dot>Active</StatusBadge>
<StatusBadge variant="warning" dot>Pending</StatusBadge>
<StatusBadge variant="error" dot>Failed</StatusBadge>
<StatusBadge variant="info" dot>Syncing</StatusBadge>
<StatusBadge variant="neutral" dot>Archived</StatusBadge>`,
    },
    {
      id: 'without-dot',
      title: 'Without dot',
      render: () => (
        <>
          <StatusBadge variant="success">Paid</StatusBadge>
          <StatusBadge variant="neutral">Draft</StatusBadge>
        </>
      ),
      code: `import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'

<StatusBadge variant="success">Paid</StatusBadge>
<StatusBadge variant="neutral">Draft</StatusBadge>`,
    },
  ],
}

const tagEntry: GalleryEntry = {
  id: 'tag',
  title: 'Tag',
  importPath: '@open-mercato/ui/primitives/tag',
  variants: [
    {
      id: 'variants',
      title: 'Variants',
      render: () => (
        <>
          <Tag>default</Tag>
          <Tag variant="success">success</Tag>
          <Tag variant="warning">warning</Tag>
          <Tag variant="error">error</Tag>
          <Tag variant="info">info</Tag>
          <Tag variant="neutral">neutral</Tag>
          <Tag variant="brand">brand</Tag>
          <Tag variant="pink">pink</Tag>
        </>
      ),
      code: `import { Tag } from '@open-mercato/ui/primitives/tag'

<Tag>default</Tag>
<Tag variant="success">success</Tag>
<Tag variant="warning">warning</Tag>
<Tag variant="error">error</Tag>
<Tag variant="info">info</Tag>
<Tag variant="neutral">neutral</Tag>
<Tag variant="brand">brand</Tag>
<Tag variant="pink">pink</Tag>`,
    },
    {
      id: 'dot',
      title: 'With dot',
      render: () => (
        <>
          <Tag variant="success" dot>Customer</Tag>
          <Tag variant="brand" dot>Renewal</Tag>
          <Tag variant="pink" dot>Campaign</Tag>
        </>
      ),
      code: `import { Tag } from '@open-mercato/ui/primitives/tag'

<Tag variant="success" dot>Customer</Tag>
<Tag variant="brand" dot>Renewal</Tag>
<Tag variant="pink" dot>Campaign</Tag>`,
    },
    {
      id: 'square',
      title: 'Square shape',
      render: () => (
        <>
          <Tag shape="square">default</Tag>
          <Tag variant="info" shape="square" dot>info</Tag>
        </>
      ),
      code: `import { Tag } from '@open-mercato/ui/primitives/tag'

<Tag shape="square">default</Tag>
<Tag variant="info" shape="square" dot>info</Tag>`,
    },
    {
      id: 'removable',
      title: 'Removable',
      render: () => (
        <>
          <Tag variant="neutral" onRemove={() => {}}>Wholesale</Tag>
          <Tag variant="neutral" onRemove={() => {}} disabled>Locked</Tag>
        </>
      ),
      code: `import { Tag } from '@open-mercato/ui/primitives/tag'

<Tag variant="neutral" onRemove={() => removeTag('wholesale')}>Wholesale</Tag>
<Tag variant="neutral" onRemove={() => {}} disabled>Locked</Tag>`,
    },
  ],
}

const avatarEntry: GalleryEntry = {
  id: 'avatar',
  title: 'Avatar',
  importPath: '@open-mercato/ui/primitives/avatar',
  variants: [
    {
      id: 'sizes',
      title: 'Sizes (auto-initials)',
      render: () => (
        <>
          <Avatar label="Wei Chen" size="xl" />
          <Avatar label="Wei Chen" size="lg" />
          <Avatar label="Wei Chen" size="md" />
          <Avatar label="Wei Chen" size="sm" />
          <Avatar label="Wei Chen" size="xs" />
        </>
      ),
      code: `import { Avatar } from '@open-mercato/ui/primitives/avatar'

// Initials are derived automatically from the label at every size.
<Avatar label="Wei Chen" size="xl" />
<Avatar label="Wei Chen" size="lg" />
<Avatar label="Wei Chen" size="md" />
<Avatar label="Wei Chen" size="sm" />
<Avatar label="Wei Chen" size="xs" />`,
    },
    {
      id: 'variants',
      title: 'Variants and icon',
      render: () => (
        <>
          <Avatar label="Laura Perez" />
          <Avatar label="Laura Perez" variant="monochrome" />
          <Avatar label="Acme Corp" icon={<Building2 />} variant="monochrome" />
        </>
      ),
      code: `import { Building2 } from 'lucide-react'
import { Avatar } from '@open-mercato/ui/primitives/avatar'

<Avatar label="Laura Perez" />
<Avatar label="Laura Perez" variant="monochrome" />
<Avatar label="Acme Corp" icon={<Building2 />} variant="monochrome" />`,
    },
    {
      id: 'status',
      title: 'Status dot',
      render: () => (
        <>
          <Avatar label="Wei Chen" status="online" />
          <Avatar label="Laura Perez" status="busy" />
          <Avatar label="Omar Haddad" status="away" />
          <Avatar label="Ines Kowalska" status="offline" />
        </>
      ),
      code: `import { Avatar } from '@open-mercato/ui/primitives/avatar'

<Avatar label="Wei Chen" status="online" />
<Avatar label="Laura Perez" status="busy" />
<Avatar label="Omar Haddad" status="away" />
<Avatar label="Ines Kowalska" status="offline" />`,
    },
    {
      id: 'stack',
      title: 'AvatarStack',
      render: () => (
        <AvatarStack max={3}>
          <Avatar label="Wei Chen" />
          <Avatar label="Laura Perez" />
          <Avatar label="Omar Haddad" />
          <Avatar label="Ines Kowalska" />
          <Avatar label="Ravi Patel" />
        </AvatarStack>
      ),
      code: `import { Avatar, AvatarStack } from '@open-mercato/ui/primitives/avatar'

<AvatarStack max={3}>
  <Avatar label="Wei Chen" />
  <Avatar label="Laura Perez" />
  <Avatar label="Omar Haddad" />
  <Avatar label="Ines Kowalska" />
  <Avatar label="Ravi Patel" />
</AvatarStack>`,
    },
  ],
}

const kbdEntry: GalleryEntry = {
  id: 'kbd',
  title: 'Kbd',
  importPath: '@open-mercato/ui/primitives/kbd',
  variants: [
    {
      id: 'default',
      title: 'default',
      render: () => (
        <>
          <Kbd>⌘</Kbd>
          <Kbd>Shift</Kbd>
          <Kbd>Enter</Kbd>
        </>
      ),
      code: `import { Kbd } from '@open-mercato/ui/primitives/kbd'

<Kbd>⌘</Kbd>
<Kbd>Shift</Kbd>
<Kbd>Enter</Kbd>`,
    },
    {
      id: 'shortcut',
      title: 'KbdShortcut',
      render: () => (
        <>
          <KbdShortcut keys={['⌘', 'K']} />
          <KbdShortcut keys={['Ctrl', 'Shift', 'P']} />
        </>
      ),
      code: `import { KbdShortcut } from '@open-mercato/ui/primitives/kbd'

<KbdShortcut keys={['⌘', 'K']} />
<KbdShortcut keys={['Ctrl', 'Shift', 'P']} />`,
    },
  ],
}

const tableEntry: GalleryEntry = {
  id: 'table',
  title: 'Table',
  importPath: '@open-mercato/ui/primitives/table',
  figmaNodeId: '167144:147544',
  variants: [
    {
      id: 'default',
      title: 'default',
      render: () => (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>#1042</TableCell>
              <TableCell>Wei Chen</TableCell>
              <TableCell>
                <StatusBadge variant="success" dot>Paid</StatusBadge>
              </TableCell>
              <TableCell className="text-right">$1,250.00</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>#1041</TableCell>
              <TableCell>Laura Perez</TableCell>
              <TableCell>
                <StatusBadge variant="warning" dot>Pending</StatusBadge>
              </TableCell>
              <TableCell className="text-right">$310.50</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>#1040</TableCell>
              <TableCell>Omar Haddad</TableCell>
              <TableCell>
                <StatusBadge variant="neutral" dot>Draft</StatusBadge>
              </TableCell>
              <TableCell className="text-right">$89.00</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      ),
      code: `import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@open-mercato/ui/primitives/table'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'

<Table>
  <TableHeader>
    <TableRow>
      <TableHead>Order</TableHead>
      <TableHead>Customer</TableHead>
      <TableHead>Status</TableHead>
      <TableHead className="text-right">Total</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    <TableRow>
      <TableCell>#1042</TableCell>
      <TableCell>Wei Chen</TableCell>
      <TableCell><StatusBadge variant="success" dot>Paid</StatusBadge></TableCell>
      <TableCell className="text-right">$1,250.00</TableCell>
    </TableRow>
  </TableBody>
</Table>`,
    },
    {
      id: 'striped',
      title: 'striped',
      render: () => (
        <Table variant="striped">
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Stock</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>AP-100</TableCell>
              <TableCell>Apex Desk Lamp</TableCell>
              <TableCell className="text-right">120</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>AP-101</TableCell>
              <TableCell>Apex Monitor Stand</TableCell>
              <TableCell className="text-right">64</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>AP-102</TableCell>
              <TableCell>Apex Cable Kit</TableCell>
              <TableCell className="text-right">310</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>AP-103</TableCell>
              <TableCell>Apex Laptop Riser</TableCell>
              <TableCell className="text-right">18</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      ),
      code: `import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@open-mercato/ui/primitives/table'

<Table variant="striped">
  <TableHeader>
    <TableRow>
      <TableHead>SKU</TableHead>
      <TableHead>Product</TableHead>
      <TableHead className="text-right">Stock</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>{/* rows */}</TableBody>
</Table>`,
    },
    {
      id: 'with-footer',
      title: 'With footer',
      render: () => (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Line</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Subtotal</TableCell>
              <TableCell className="text-right">$1,560.50</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Shipping</TableCell>
              <TableCell className="text-right">$24.00</TableCell>
            </TableRow>
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>Total</TableCell>
              <TableCell className="text-right">$1,584.50</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      ),
      code: `import { Table, TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell } from '@open-mercato/ui/primitives/table'

<Table>
  <TableHeader>{/* header row */}</TableHeader>
  <TableBody>{/* body rows */}</TableBody>
  <TableFooter>
    <TableRow>
      <TableCell>Total</TableCell>
      <TableCell className="text-right">$1,584.50</TableCell>
    </TableRow>
  </TableFooter>
</Table>`,
    },
  ],
  // Mockup-composer prop injection (spec Phase 3) — columns/rows/emptyState
  // from the shared contract so the draft generator and the promote bridge
  // speak the same shape. Mock scalar sample data only, never tenant data.
  compose: (props) => {
    const parsed = tableComposeSchema.parse(props)
    const rows = parsed.rows ?? []
    return (
      <div className="w-full space-y-2">
        <Table>
          <TableHeader>
            <TableRow>
              {parsed.columns.map((column) => (
                <TableHead key={column.id}>{column.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => (
              <TableRow key={index}>
                {parsed.columns.map((column) => (
                  <TableCell key={column.id}>{formatComposedCell(row[column.id])}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {rows.length === 0 && parsed.emptyState ? (
          <EmptyState
            size="sm"
            title={parsed.emptyState.title}
            actionLabel={parsed.emptyState.actionLabel}
          />
        ) : null}
      </div>
    )
  },
  composePropsSchema: tableComposeSchema,
}

function formatComposedCell(value: string | number | boolean | undefined): string {
  if (value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

const cardEntry: GalleryEntry = {
  id: 'card',
  title: 'Card',
  importPath: '@open-mercato/ui/primitives/card',
  variants: [
    {
      id: 'default',
      title: 'default',
      render: () => (
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Monthly revenue</CardTitle>
            <CardDescription>Net revenue across all channels.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">$48,210</p>
          </CardContent>
          <CardFooter>
            <p className="text-sm text-muted-foreground">Updated 5 minutes ago</p>
          </CardFooter>
        </Card>
      ),
      code: `import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@open-mercato/ui/primitives/card'

<Card>
  <CardHeader>
    <CardTitle>Monthly revenue</CardTitle>
    <CardDescription>Net revenue across all channels.</CardDescription>
  </CardHeader>
  <CardContent>
    <p className="text-2xl font-semibold">$48,210</p>
  </CardContent>
  <CardFooter>
    <p className="text-sm text-muted-foreground">Updated 5 minutes ago</p>
  </CardFooter>
</Card>`,
    },
    {
      id: 'with-action',
      title: 'With action slot',
      render: () => (
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Team members</CardTitle>
            <CardDescription>People with access to this workspace.</CardDescription>
            <CardAction>
              <IconButton variant="ghost" aria-label="More">
                <MoreHorizontal />
              </IconButton>
            </CardAction>
          </CardHeader>
          <CardContent>
            <AvatarStack max={3} size="sm">
              <Avatar label="Wei Chen" size="sm" />
              <Avatar label="Laura Perez" size="sm" />
              <Avatar label="Omar Haddad" size="sm" />
              <Avatar label="Ines Kowalska" size="sm" />
            </AvatarStack>
          </CardContent>
        </Card>
      ),
      code: `import { MoreHorizontal } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent } from '@open-mercato/ui/primitives/card'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'

<Card>
  <CardHeader>
    <CardTitle>Team members</CardTitle>
    <CardDescription>People with access to this workspace.</CardDescription>
    <CardAction>
      <IconButton variant="ghost" aria-label="More"><MoreHorizontal /></IconButton>
    </CardAction>
  </CardHeader>
  <CardContent>{/* content */}</CardContent>
</Card>`,
    },
  ],
}

const separatorEntry: GalleryEntry = {
  id: 'separator',
  title: 'Separator',
  importPath: '@open-mercato/ui/primitives/separator',
  variants: [
    {
      id: 'default',
      title: 'default',
      render: () => (
        <div className="w-full max-w-sm">
          <p className="text-sm">Shipping details</p>
          <Separator className="my-3" />
          <p className="text-sm text-muted-foreground">Billing details</p>
        </div>
      ),
      code: `import { Separator } from '@open-mercato/ui/primitives/separator'

<Separator className="my-3" />`,
    },
    {
      id: 'labeled',
      title: 'Labeled',
      render: () => (
        <div className="w-full max-w-sm">
          <Separator label="OR" />
        </div>
      ),
      code: `import { Separator } from '@open-mercato/ui/primitives/separator'

<Separator label="OR" />`,
    },
    {
      id: 'section',
      title: 'Section header',
      render: () => (
        <div className="w-full max-w-sm">
          <Separator section label={'Amount & account'} />
        </div>
      ),
      code: `import { Separator } from '@open-mercato/ui/primitives/separator'

<Separator section label="Amount & account" />`,
    },
    {
      id: 'dashed',
      title: 'Dashed',
      render: () => (
        <div className="w-full max-w-sm">
          <Separator variant="dashed" />
        </div>
      ),
      code: `import { Separator } from '@open-mercato/ui/primitives/separator'

<Separator variant="dashed" />`,
    },
  ],
}

const scrollAreaEntry: GalleryEntry = {
  id: 'scroll-area',
  title: 'ScrollArea',
  importPath: '@open-mercato/ui/primitives/scroll-area',
  variants: [
    {
      id: 'vertical',
      title: 'Vertical',
      render: () => (
        <ScrollArea className="h-40 w-full max-w-xs rounded-md border">
          <div className="p-3">
            {Array.from({ length: 20 }, (_, i) => (
              <p key={i} className="border-b py-1.5 text-sm last:border-b-0">
                Warehouse zone {String.fromCharCode(65 + (i % 6))}-{i + 1}
              </p>
            ))}
          </div>
        </ScrollArea>
      ),
      code: `import { ScrollArea } from '@open-mercato/ui/primitives/scroll-area'

<ScrollArea className="h-40 rounded-md border">
  <div className="p-3">
    {zones.map((zone) => (
      <p key={zone.id} className="border-b py-1.5 text-sm last:border-b-0">{zone.name}</p>
    ))}
  </div>
</ScrollArea>`,
    },
    {
      id: 'horizontal',
      title: 'Horizontal',
      render: () => (
        <ScrollArea scrollbars="horizontal" className="w-full max-w-xs rounded-md border">
          <div className="flex w-max gap-2 p-3">
            {Array.from({ length: 12 }, (_, i) => (
              <Tag key={i} variant="neutral" shape="square">
                Channel {i + 1}
              </Tag>
            ))}
          </div>
        </ScrollArea>
      ),
      code: `import { ScrollArea } from '@open-mercato/ui/primitives/scroll-area'
import { Tag } from '@open-mercato/ui/primitives/tag'

<ScrollArea scrollbars="horizontal" className="max-w-xs rounded-md border">
  <div className="flex w-max gap-2 p-3">
    {channels.map((channel) => (
      <Tag key={channel.id} variant="neutral" shape="square">{channel.name}</Tag>
    ))}
  </div>
</ScrollArea>`,
    },
  ],
}

const activityFeedEntry: GalleryEntry = {
  id: 'activity-feed',
  title: 'ActivityFeed',
  importPath: '@open-mercato/ui/primitives/activity-feed',
  variants: [
    {
      id: 'basic',
      title: 'Basic entries',
      render: () => (
        <ActivityFeed className="w-full max-w-md">
          <ActivityFeedItem
            avatar={<Avatar label="Wei Chen" size="sm" />}
            title={
              <>
                Wei Chen <span className="font-normal text-muted-foreground">created</span> Order #1042
              </>
            }
            timestamp="4 min ago"
          />
          <ActivityFeedItem
            avatar={<Avatar label="Laura Perez" size="sm" />}
            title={
              <>
                Laura Perez <span className="font-normal text-muted-foreground">updated the shipping address</span>
              </>
            }
            timestamp="1 hour ago"
            actions={
              <IconButton variant="ghost" size="sm" aria-label="More">
                <MoreHorizontal />
              </IconButton>
            }
          />
        </ActivityFeed>
      ),
      code: `import { ActivityFeed, ActivityFeedItem } from '@open-mercato/ui/primitives/activity-feed'
import { Avatar } from '@open-mercato/ui/primitives/avatar'

<ActivityFeed>
  <ActivityFeedItem
    avatar={<Avatar label="Wei Chen" size="sm" />}
    title={<>Wei Chen <span className="font-normal text-muted-foreground">created</span> Order #1042</>}
    timestamp="4 min ago"
  />
</ActivityFeed>`,
    },
    {
      id: 'with-attachment',
      title: 'File attachment',
      render: () => (
        <ActivityFeed className="w-full max-w-md">
          <ActivityFeedItem
            avatar={<Avatar label="Omar Haddad" size="sm" />}
            title={
              <>
                Omar Haddad <span className="font-normal text-muted-foreground">uploaded</span> Q2 financial report
              </>
            }
            timestamp="2 days ago"
          >
            <ActivityFeedFileChip name="apex-report.pdf" size="4mb" onDownload={() => {}} />
          </ActivityFeedItem>
        </ActivityFeed>
      ),
      code: `import { ActivityFeed, ActivityFeedItem, ActivityFeedFileChip } from '@open-mercato/ui/primitives/activity-feed'
import { Avatar } from '@open-mercato/ui/primitives/avatar'

<ActivityFeedItem
  avatar={<Avatar label="Omar Haddad" size="sm" />}
  title={<>Omar Haddad <span className="font-normal text-muted-foreground">uploaded</span> Q2 financial report</>}
  timestamp="2 days ago"
>
  <ActivityFeedFileChip name="apex-report.pdf" size="4mb" onDownload={() => download()} />
</ActivityFeedItem>`,
    },
    {
      id: 'with-comment',
      title: 'Comment',
      render: () => (
        <ActivityFeed className="w-full max-w-md">
          <ActivityFeedItem
            avatar={<Avatar label="Ines Kowalska" size="sm" />}
            title={
              <>
                Ines Kowalska <span className="font-normal text-muted-foreground">commented</span>
              </>
            }
            timestamp="6 days ago"
          >
            <ActivityFeedComment onReply={() => {}}>
              Please revise the risk metrics before Friday.
            </ActivityFeedComment>
          </ActivityFeedItem>
        </ActivityFeed>
      ),
      code: `import { ActivityFeed, ActivityFeedItem, ActivityFeedComment } from '@open-mercato/ui/primitives/activity-feed'
import { Avatar } from '@open-mercato/ui/primitives/avatar'

<ActivityFeedItem
  avatar={<Avatar label="Ines Kowalska" size="sm" />}
  title={<>Ines Kowalska <span className="font-normal text-muted-foreground">commented</span></>}
  timestamp="6 days ago"
>
  <ActivityFeedComment onReply={() => reply()}>
    Please revise the risk metrics before Friday.
  </ActivityFeedComment>
</ActivityFeedItem>`,
    },
    {
      id: 'status-chips',
      title: 'Status chips',
      render: () => (
        <ActivityFeed className="w-full max-w-md">
          <ActivityFeedItem
            avatar={<Avatar label="Ravi Patel" size="sm" />}
            title={
              <>
                Ravi Patel <span className="font-normal text-muted-foreground">moved 3 tasks</span>
              </>
            }
            timestamp="1 week ago"
          >
            <ActivityFeedStatusChip status="success">Approved</ActivityFeedStatusChip>
            <ActivityFeedStatusChip status="warning">Needs review</ActivityFeedStatusChip>
            <ActivityFeedStatusChip status="error">Blocked</ActivityFeedStatusChip>
          </ActivityFeedItem>
        </ActivityFeed>
      ),
      code: `import { ActivityFeed, ActivityFeedItem, ActivityFeedStatusChip } from '@open-mercato/ui/primitives/activity-feed'
import { Avatar } from '@open-mercato/ui/primitives/avatar'

<ActivityFeedItem
  avatar={<Avatar label="Ravi Patel" size="sm" />}
  title={<>Ravi Patel <span className="font-normal text-muted-foreground">moved 3 tasks</span></>}
  timestamp="1 week ago"
>
  <ActivityFeedStatusChip status="success">Approved</ActivityFeedStatusChip>
  <ActivityFeedStatusChip status="warning">Needs review</ActivityFeedStatusChip>
  <ActivityFeedStatusChip status="error">Blocked</ActivityFeedStatusChip>
</ActivityFeedItem>`,
    },
  ],
}

export const entries: GalleryEntry[] = [
  badgeEntry,
  statusBadgeEntry,
  tagEntry,
  avatarEntry,
  kbdEntry,
  tableEntry,
  cardEntry,
  separatorEntry,
  scrollAreaEntry,
  activityFeedEntry,
]
