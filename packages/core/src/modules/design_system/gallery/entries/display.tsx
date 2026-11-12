import {
  ContentLabelExample,
  ContentCardExample,
  KeyIconExamples,
  PaymentIconExamples,
  ChartLegendExamples,
  ChartLegendDotExamples,
} from '../demos/key-components'
import { keyComponentExampleCode } from '../demos/key-components-code.generated'
import { TableCellExamples, TableHeaderExamples, tableCellExampleCode } from '../demos/table-cells'
import { tableHeaderExampleCode } from '../demos/table-cells-code.generated'
import { ActivityFeedExample } from '../demos/feeds'
import { activityFeedExampleCode } from '../demos/feeds-code.generated'
import * as React from 'react'
import { Building2, Check, ChevronLeft, ChevronRight, MoreHorizontal, Pin, Plus, Star, User, X } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { ButtonGroup } from '@open-mercato/ui/primitives/button-group'
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
import {
  ActivityFeed,
  ActivityFeedComment,
  ActivityFeedFileChip,
  ActivityFeedItem,
  ActivityFeedStatusChip,
} from '@open-mercato/ui/primitives/activity-feed'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import githubLogo from '../assets/github-logo.png'
import avatarPhoto from '../assets/avatar-photo.png'
import avatarMemoji from '../assets/avatar-memoji.png'
import avatarIllustration from '../assets/avatar-illustration.png'
import type { GalleryEntry } from '../types'
function BadgeEntrySemanticPreview() {
  const t = useT()
  return (
    <>
      <Badge variant="success">{t('design_system.gallery.samples.content.success')}</Badge>
      <Badge variant="warning">{t('design_system.gallery.samples.content.warning')}</Badge>
      <Badge variant="info">{t('design_system.gallery.samples.content.info')}</Badge>
      <Badge variant="neutral">{t('design_system.gallery.samples.content.neutral')}</Badge>
      <Badge variant="error">{t('design_system.gallery.samples.content.error')}</Badge>
      <Badge variant="brand">{t('design_system.gallery.samples.content.brand')}</Badge>
    </>
  )
}
function BadgeEntrySizesPreview() {
  const t = useT()
  return (
    <>
      <Badge variant="info" size="lg">
        {t('design_system.gallery.samples.content.large')}
      </Badge>
      <Badge variant="info" size="default">
        {t('design_system.gallery.samples.content.default')}
      </Badge>
      <Badge variant="info" size="sm">
        {t('design_system.gallery.samples.content.small')}
      </Badge>
    </>
  )
}
function BadgeEntryDotPreview() {
  const t = useT()
  return (
    <>
      <Badge variant="success" dot>
        {t('design_system.gallery.samples.content.active')}
      </Badge>
      <Badge variant="neutral" dot>
        {t('design_system.gallery.samples.content.draft')}
      </Badge>
      <Badge variant="brand" dot>
        {t('design_system.gallery.samples.content.customView')}
      </Badge>
    </>
  )
}
function StatusBadgeEntryWithDotPreview() {
  const t = useT()
  return (
    <>
      <StatusBadge variant="success" dot>
        {t('design_system.gallery.samples.content.active')}
      </StatusBadge>
      <StatusBadge variant="warning" dot>
        {t('design_system.gallery.samples.content.pending')}
      </StatusBadge>
      <StatusBadge variant="error" dot>
        {t('design_system.gallery.samples.content.failed')}
      </StatusBadge>
      <StatusBadge variant="info" dot>
        {t('design_system.gallery.samples.content.syncing')}
      </StatusBadge>
      <StatusBadge variant="neutral" dot>
        {t('design_system.gallery.samples.content.archived')}
      </StatusBadge>
    </>
  )
}
function StatusBadgeEntryWithoutDotPreview() {
  const t = useT()
  return (
    <>
      <StatusBadge variant="success">{t('design_system.gallery.samples.content.paid')}</StatusBadge>
      <StatusBadge variant="neutral">{t('design_system.gallery.samples.content.draft')}</StatusBadge>
    </>
  )
}
function TagEntryDotPreview() {
  const t = useT()
  return (
    <>
      <Tag variant="success" dot>
        {t('design_system.gallery.samples.content.customer')}
      </Tag>
      <Tag variant="brand" dot>
        {t('design_system.gallery.samples.content.renewal')}
      </Tag>
      <Tag variant="pink" dot>
        {t('design_system.gallery.samples.content.campaign')}
      </Tag>
    </>
  )
}
function TableEntryDefaultPreview() {
  const t = useT()
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('design_system.gallery.samples.content.order')}</TableHead>
          <TableHead>{t('design_system.gallery.samples.content.customer')}</TableHead>
          <TableHead>{t('design_system.gallery.samples.content.status')}</TableHead>
          <TableHead className="text-right">{t('design_system.gallery.samples.content.total')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>#1042</TableCell>
          <TableCell>Wei Chen</TableCell>
          <TableCell>
            <StatusBadge variant="success" dot>
              {t('design_system.gallery.samples.content.paid')}
            </StatusBadge>
          </TableCell>
          <TableCell className="text-right">$1,250.00</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>#1041</TableCell>
          <TableCell>Laura Perez</TableCell>
          <TableCell>
            <StatusBadge variant="warning" dot>
              {t('design_system.gallery.samples.content.pending')}
            </StatusBadge>
          </TableCell>
          <TableCell className="text-right">$310.50</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>#1040</TableCell>
          <TableCell>Omar Haddad</TableCell>
          <TableCell>
            <StatusBadge variant="neutral" dot>
              {t('design_system.gallery.samples.content.draft')}
            </StatusBadge>
          </TableCell>
          <TableCell className="text-right">$89.00</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  )
}
function TableEntryStripedPreview() {
  const t = useT()
  return (
    <Table variant="striped">
      <TableHeader>
        <TableRow>
          <TableHead>SKU</TableHead>
          <TableHead>{t('design_system.gallery.samples.content.product')}</TableHead>
          <TableHead className="text-right">{t('design_system.gallery.samples.content.stock')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>AP-100</TableCell>
          <TableCell>{t('design_system.gallery.samples.content.apexDeskLamp')}</TableCell>
          <TableCell className="text-right">120</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>AP-101</TableCell>
          <TableCell>{t('design_system.gallery.samples.content.apexMonitorStand')}</TableCell>
          <TableCell className="text-right">64</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>AP-102</TableCell>
          <TableCell>{t('design_system.gallery.samples.content.apexCableKit')}</TableCell>
          <TableCell className="text-right">310</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>AP-103</TableCell>
          <TableCell>{t('design_system.gallery.samples.content.apexLaptopRiser')}</TableCell>
          <TableCell className="text-right">18</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  )
}
function TableEntryWithFooterPreview() {
  const t = useT()
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('design_system.gallery.samples.content.line')}</TableHead>
          <TableHead className="text-right">{t('design_system.gallery.samples.content.amount')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>{t('design_system.gallery.samples.content.subtotal')}</TableCell>
          <TableCell className="text-right">$1,560.50</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>{t('design_system.gallery.samples.content.shipping')}</TableCell>
          <TableCell className="text-right">$24.00</TableCell>
        </TableRow>
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell>{t('design_system.gallery.samples.content.total')}</TableCell>
          <TableCell className="text-right">$1,584.50</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  )
}
function CardEntryDefaultPreview() {
  const t = useT()
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>{t('design_system.gallery.samples.content.monthlyRevenue')}</CardTitle>
        <CardDescription>{t('design_system.gallery.samples.content.netRevenueAcrossAllChannels')}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold">$48,210</p>
      </CardContent>
      <CardFooter>
        <p className="text-sm text-muted-foreground">{t('design_system.gallery.samples.content.updated5MinutesAgo')}</p>
      </CardFooter>
    </Card>
  )
}
function CardEntryWithActionPreview() {
  const t = useT()
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>{t('design_system.gallery.samples.content.teamMembers')}</CardTitle>
        <CardDescription>{t('design_system.gallery.samples.content.peopleWithAccessToThisWorkspace')}</CardDescription>
        <CardAction>
          <IconButton type="button" variant="ghost" aria-label={t('design_system.gallery.samples.content.more')}>
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
  )
}
function SeparatorEntryDefaultPreview() {
  const t = useT()
  return (
    <div className="w-full max-w-sm">
      <p className="text-sm">{t('design_system.gallery.samples.content.shippingDetails')}</p>
      <Separator className="my-3" />
      <p className="text-sm text-muted-foreground">{t('design_system.gallery.samples.content.billingDetails')}</p>
    </div>
  )
}
function SeparatorEntryLabeledPreview() {
  const t = useT()
  return (
    <div className="w-full max-w-sm">
      <Separator label={t('design_system.gallery.samples.content.or')} />
    </div>
  )
}
function ScrollAreaEntryVerticalPreview() {
  const t = useT()
  return (
    <ScrollArea className="h-40 w-full max-w-xs rounded-md border">
      <div className="p-3">
        {Array.from(
          {
            length: 20,
          },
          (_, i) => (
            <p key={i} className="border-b py-1.5 text-sm last:border-b-0">
              {t('design_system.gallery.samples.content.warehouseZone')}
              {String.fromCharCode(65 + (i % 6))}-{i + 1}
            </p>
          ),
        )}
      </div>
    </ScrollArea>
  )
}
function ScrollAreaEntryHorizontalPreview() {
  const t = useT()
  return (
    <ScrollArea scrollbars="horizontal" className="w-full max-w-xs rounded-md border">
      <div className="flex w-max gap-2 p-3">
        {Array.from(
          {
            length: 12,
          },
          (_, i) => (
            <Tag key={i} variant="neutral" shape="square">
              {t('design_system.gallery.samples.content.channel')}
              {i + 1}
            </Tag>
          ),
        )}
      </div>
    </ScrollArea>
  )
}
function ActivityFeedEntryBasicPreview() {
  const t = useT()
  return (
    <ActivityFeed className="w-full max-w-md">
      <ActivityFeedItem
        avatar={<Avatar label="Wei Chen" size="sm" />}
        title={
          <>
            Wei Chen{' '}
            <span className="font-normal text-muted-foreground">
              {t('design_system.gallery.samples.content.created')}
            </span>
            {t('design_system.gallery.samples.content.order1042')}
          </>
        }
        timestamp={t('design_system.gallery.samples.content.4MinAgo')}
      />
      <ActivityFeedItem
        avatar={<Avatar label="Laura Perez" size="sm" />}
        title={
          <>
            Laura Perez{' '}
            <span className="font-normal text-muted-foreground">
              {t('design_system.gallery.samples.content.updatedTheShippingAddress')}
            </span>
          </>
        }
        timestamp={t('design_system.gallery.samples.content.1HourAgo')}
        actions={
          <IconButton variant="ghost" size="sm" aria-label={t('design_system.gallery.samples.content.more')}>
            <MoreHorizontal />
          </IconButton>
        }
      />
    </ActivityFeed>
  )
}
function ActivityFeedEntryWithAttachmentPreview() {
  const t = useT()
  return (
    <ActivityFeed className="w-full max-w-md">
      <ActivityFeedItem
        avatar={<Avatar label="Omar Haddad" size="sm" />}
        title={
          <>
            Omar Haddad{' '}
            <span className="font-normal text-muted-foreground">
              {t('design_system.gallery.samples.content.uploaded')}
            </span>
            {t('design_system.gallery.samples.content.q2FinancialReport')}
          </>
        }
        timestamp={t('design_system.gallery.samples.content.2DaysAgo')}
      >
        <ActivityFeedFileChip name="apex-report.pdf" size="4mb" onDownload={() => {}} />
      </ActivityFeedItem>
    </ActivityFeed>
  )
}
function ActivityFeedEntryWithCommentPreview() {
  const t = useT()
  return (
    <ActivityFeed className="w-full max-w-md">
      <ActivityFeedItem
        avatar={<Avatar label="Ines Kowalska" size="sm" />}
        title={
          <>
            Ines Kowalska{' '}
            <span className="font-normal text-muted-foreground">
              {t('design_system.gallery.samples.content.commented')}
            </span>
          </>
        }
        timestamp={t('design_system.gallery.samples.content.6DaysAgo')}
      >
        <ActivityFeedComment onReply={() => {}}>
          {t('design_system.gallery.samples.content.pleaseReviseTheRiskMetricsBeforeFriday')}
        </ActivityFeedComment>
      </ActivityFeedItem>
    </ActivityFeed>
  )
}
function ActivityFeedEntryStatusChipsPreview() {
  const t = useT()
  return (
    <ActivityFeed className="w-full max-w-md">
      <ActivityFeedItem
        avatar={<Avatar label="Ravi Patel" size="sm" />}
        title={
          <>
            Ravi Patel{' '}
            <span className="font-normal text-muted-foreground">
              {t('design_system.gallery.samples.content.moved3Tasks')}
            </span>
          </>
        }
        timestamp={t('design_system.gallery.samples.content.1WeekAgo')}
      >
        <ActivityFeedStatusChip status="success">
          {t('design_system.gallery.samples.content.approved')}
        </ActivityFeedStatusChip>
        <ActivityFeedStatusChip status="warning">
          {t('design_system.gallery.samples.content.needsReview')}
        </ActivityFeedStatusChip>
        <ActivityFeedStatusChip status="error">
          {t('design_system.gallery.samples.content.blocked')}
        </ActivityFeedStatusChip>
      </ActivityFeedItem>
    </ActivityFeed>
  )
}
const githubLogoSrc = typeof githubLogo === 'string' ? githubLogo : githubLogo.src
const avatarPhotoSrc = typeof avatarPhoto === 'string' ? avatarPhoto : avatarPhoto.src
const avatarMemojiSrc = typeof avatarMemoji === 'string' ? avatarMemoji : avatarMemoji.src
const avatarIllustrationSrc = typeof avatarIllustration === 'string' ? avatarIllustration : avatarIllustration.src
function AvatarBadgesDemo() {
  const t = useT()
  return (
    <div className="flex flex-wrap items-center gap-6 p-2">
      <Avatar
        label="Wei Chen"
        ariaLabel={t('design_system.gallery.examples.avatar.verified')}
        badge={<Check className="size-3" />}
        badgeClassName="bg-status-info-icon text-white"
      />
      <Avatar
        label="Laura Perez"
        ariaLabel={t('design_system.gallery.examples.avatar.pinned')}
        badge={<Pin className="size-3" />}
        badgeClassName="bg-accent-indigo text-white"
      />
      <Avatar
        label="Omar Haddad"
        ariaLabel={t('design_system.gallery.examples.avatar.favorite')}
        badge={<Star className="size-3" />}
        badgeClassName="bg-status-success-icon text-white"
      />
      <Avatar
        label="Ines Kowalska"
        ariaLabel={t('design_system.gallery.examples.avatar.add')}
        badge={<Plus className="size-3" />}
      />
      <Avatar
        label="Ravi Patel"
        ariaLabel={t('design_system.gallery.examples.avatar.remove')}
        badge={<X className="size-3" />}
        badgeClassName="bg-status-error-icon text-white"
      />
      <Avatar
        label="James Brown"
        ariaLabel={t('design_system.gallery.examples.avatar.notification')}
        status="error"
        statusPosition="top-right"
      />
    </div>
  )
}
function SeparatorActionDemo({ kind }: { kind: 'icon' | 'icon-group' | 'text' | 'text-group' }) {
  const t = useT()
  return (
    <div className="flex w-full items-center gap-2.5">
      <Separator className="min-w-0 flex-1" />
      {kind === 'icon' ? (
        <IconButton size="default" aria-label={t('design_system.gallery.examples.separator.add')}>
          <Plus className="size-5" />
        </IconButton>
      ) : kind === 'icon-group' ? (
        <ButtonGroup aria-label={t('design_system.gallery.examples.separator.actions')}>
          <IconButton size="default" aria-label={t('design_system.gallery.examples.separator.previous')}>
            <ChevronLeft className="size-5" />
          </IconButton>
          <IconButton size="default" aria-label={t('design_system.gallery.examples.separator.add')}>
            <Plus className="size-5" />
          </IconButton>
          <IconButton size="default" aria-label={t('design_system.gallery.examples.separator.next')}>
            <ChevronRight className="size-5" />
          </IconButton>
        </ButtonGroup>
      ) : kind === 'text' ? (
        <Button type="button" size="sm" variant="outline" className="px-2.5">
          {t('design_system.gallery.examples.separator.add')}
        </Button>
      ) : (
        <ButtonGroup size="sm" aria-label={t('design_system.gallery.examples.separator.actions')}>
          <Button type="button" size="sm" variant="outline" className="px-3.5">
            {t('design_system.gallery.examples.separator.previous')}
          </Button>
          <Button type="button" size="sm" variant="outline" className="px-3.5">
            {t('design_system.gallery.examples.separator.add')}
          </Button>
          <Button type="button" size="sm" variant="outline" className="px-3.5">
            {t('design_system.gallery.examples.separator.next')}
          </Button>
        </ButtonGroup>
      )}
      <Separator className="min-w-0 flex-1" />
    </div>
  )
}
function SeparatorTextDemo({ kind }: { kind: 'label-alignments' | 'text' }) {
  const t = useT()
  return kind === 'text' ? (
    <Separator section label={t('design_system.gallery.examples.separator.or')} className="bg-transparent px-2 py-1" />
  ) : (
    <div className="grid w-full gap-6">
      <Separator label={t('design_system.gallery.examples.separator.or')} labelAlign="start" />
      <Separator label={t('design_system.gallery.examples.separator.or')} labelAlign="center" />
      <Separator label={t('design_system.gallery.examples.separator.or')} labelAlign="end" />
    </div>
  )
}

// Component titles and variant names are proper nouns from the codebase and
// are deliberately not translated. `code` MUST contain the entry's importPath
// (enforced by the registry-integrity test) and is always reviewed alongside
// its sibling `render`.

function BadgeAppearanceDemo({ appearance }: { appearance: 'filled' | 'light' | 'lighter' | 'stroke' }) {
  const t = useT()
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        {(['neutral', 'info', 'warning', 'error', 'success', 'pink', 'yellow', 'purple', 'sky', 'teal'] as const).map(
          (tone) => (
            <Badge key={tone} appearance={appearance} tone={tone} dot>
              {tone}
            </Badge>
          ),
        )}
      </div>
      <p className="max-w-2xl text-xs leading-5 text-muted-foreground">
        {t('design_system.gallery.examples.badgeTag.paletteHint')}
      </p>
    </div>
  )
}
function BadgeSourceSizeDemo() {
  const t = useT()
  const label = t('design_system.gallery.examples.badgeTag.label')
  return (
    <div className="flex flex-col gap-6">
      {([16, 20] as const).map((size) => (
        <div key={size} className="flex flex-wrap items-center gap-3">
          <span className="w-12 text-xs text-muted-foreground">{size}px</span>
          <Badge size={size} appearance="filled" tone="purple">
            {label}
          </Badge>
          <Badge size={size} appearance="light" tone="yellow" dot>
            {label}
          </Badge>
          <Badge size={size} appearance="lighter" tone="sky" leadingIcon={<User />}>
            {label}
          </Badge>
          <Badge size={size} appearance="stroke" tone="teal" trailingIcon={<ChevronRight />}>
            {label}
          </Badge>
          <Badge size={size} appearance="filled" tone="info" numeric>
            {2}
          </Badge>
          <Badge size={size} appearance="filled" tone="info" numeric>
            {125}
          </Badge>
          <Badge size={size} appearance="stroke" tone="purple" disabled>
            {label}
          </Badge>
        </div>
      ))}
    </div>
  )
}
function BadgeContentDemo() {
  const t = useT()
  const label = t('design_system.gallery.examples.badgeTag.label')
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Badge appearance="lighter" tone="info">
        {label}
      </Badge>
      <Badge appearance="lighter" tone="info" dot>
        {label}
      </Badge>
      <Badge appearance="lighter" tone="info" leadingIcon={<User />}>
        {label}
      </Badge>
      <Badge appearance="lighter" tone="info" trailingIcon={<ChevronRight />}>
        {label}
      </Badge>
      <Badge appearance="filled" tone="info">
        {4}
      </Badge>
      <Badge appearance="stroke" tone="info">
        {24}
      </Badge>
    </div>
  )
}
function BadgeDisabledDemo() {
  const t = useT()
  return (
    <div className="flex flex-wrap gap-3">
      {(['filled', 'light', 'lighter', 'stroke'] as const).map((appearance) => (
        <Badge key={appearance} appearance={appearance} tone="info" disabled leadingIcon={<User />}>
          {t('design_system.gallery.examples.badgeTag.locked')}
        </Badge>
      ))}
    </div>
  )
}
function RemovableBadgeDemo() {
  const t = useT()
  const [visible, setVisible] = React.useState(true)
  const region = t('design_system.gallery.examples.badgeTag.region')
  const locked = t('design_system.gallery.examples.badgeTag.locked')
  return (
    <div className="flex flex-wrap items-center gap-3">
      {visible && (
        <Badge
          appearance="lighter"
          tone="neutral"
          removable
          onRemove={() => setVisible(false)}
          removeAriaLabel={t('design_system.gallery.examples.badgeTag.remove', {
            label: region,
          })}
        >
          {region}
        </Badge>
      )}
      <Badge
        appearance="lighter"
        tone="neutral"
        disabled
        removable
        onRemove={() => setVisible(false)}
        removeAriaLabel={t('design_system.gallery.examples.badgeTag.remove', {
          label: locked,
        })}
      >
        {locked}
      </Badge>
      <Button type="button" variant="outline" size="sm" disabled={visible} onClick={() => setVisible(true)}>
        {t('design_system.gallery.examples.badgeTag.restore')}
      </Button>
    </div>
  )
}
function StatusAppearanceDemo({ appearance }: { appearance: 'light' | 'stroke' }) {
  return (
    <div className="grid gap-4">
      {[true, false].map((dot) => (
        <div key={String(dot)} className="flex flex-wrap gap-3">
          {(['success', 'warning', 'error', 'info', 'neutral'] as const).map((variant) => (
            <StatusBadge key={variant} variant={variant} appearance={appearance} dot={dot}>
              {variant}
            </StatusBadge>
          ))}
        </div>
      ))}
    </div>
  )
}
function TagAppearanceDemo({ appearance }: { appearance: 'stroke' | 'gray' }) {
  const t = useT()
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Tag appearance={appearance}>{t('design_system.gallery.examples.badgeTag.label')}</Tag>
        <Tag appearance={appearance} leading={<User />}>
          {t('design_system.gallery.examples.badgeTag.customer')}
        </Tag>
        <Tag
          appearance={appearance}
          leading={<img src={avatarPhotoSrc} alt="" className="size-4 rounded-full object-cover" />}
        >
          James Brown
        </Tag>
        <Tag appearance={appearance} leading={<span>🇵🇱</span>}>
          {t('design_system.gallery.examples.badgeTag.country')}
        </Tag>
        <Tag
          appearance={appearance}
          leading={<img src={githubLogoSrc} alt="" className="size-4 rounded-sm bg-white" />}
        >
          GitHub
        </Tag>
        <Tag appearance={appearance} leading={<Building2 />} sublabel="(4)">
          Open Mercato
        </Tag>
      </div>
      <p className="max-w-2xl text-xs leading-5 text-muted-foreground">
        {t('design_system.gallery.examples.badgeTag.tagHint')}
      </p>
    </div>
  )
}
function RemovableTagDemo() {
  const t = useT()
  const [removed, setRemoved] = React.useState<string[]>([])
  const region = t('design_system.gallery.examples.badgeTag.region')
  const locked = t('design_system.gallery.examples.badgeTag.locked')
  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-xs leading-5 text-muted-foreground">
        {t('design_system.gallery.examples.badgeTag.statesHint')}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {(['stroke', 'gray'] as const).map((appearance) => (
          <React.Fragment key={appearance}>
            {!removed.includes(appearance) && (
              <Tag
                appearance={appearance}
                leading={<User />}
                sublabel="(4)"
                onRemove={() => setRemoved((current) => [...current, appearance])}
                removeAriaLabel={t('design_system.gallery.examples.badgeTag.remove', {
                  label: region,
                })}
              >
                {region}
              </Tag>
            )}
            <Tag
              appearance={appearance}
              disabled
              leading={<User />}
              sublabel="(4)"
              onRemove={() => setRemoved((current) => [...current, appearance])}
              removeAriaLabel={t('design_system.gallery.examples.badgeTag.remove', {
                label: locked,
              })}
            >
              {locked}
            </Tag>
          </React.Fragment>
        ))}
        <Button type="button" variant="outline" size="sm" disabled={!removed.length} onClick={() => setRemoved([])}>
          {t('design_system.gallery.examples.badgeTag.restore')}
        </Button>
      </div>
    </div>
  )
}
const badgeEntry: GalleryEntry = {
  id: 'badge',
  title: 'Badge',
  importPath: '@open-mercato/ui/primitives/badge',
  figmaNodeId: '118:2324',
  usage: {
    do: [
      'Counts and short semantic labels; the brand variant for custom-view and renewal pills.',
      'Semantic variants (success/warning/info/neutral/error) come from status tokens — no custom colors.',
      'Four appearances and ten color families; numeric sizes16/20 follow measured source dimensions. Named sizes and semantic status palettes retain application defaults; new category fills use measured Figma colors with accessible text.',
    ],
    dont: ['Not for system statuses (use StatusBadge) or user-applied labels (use Tag).'],
  },
  variants: [
    {
      id: 'semantic',
      title: 'Semantic variants',
      render: () => <BadgeEntrySemanticPreview />,
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
      render: () => <BadgeEntrySizesPreview />,
      code: `import { Badge } from '@open-mercato/ui/primitives/badge'

<Badge variant="info" size="lg">Large</Badge>
<Badge variant="info" size="default">Default</Badge>
<Badge variant="info" size="sm">Small</Badge>`,
    },
    {
      id: 'dot',
      title: 'With dot',
      render: () => <BadgeEntryDotPreview />,
      code: `import { Badge } from '@open-mercato/ui/primitives/badge'

<Badge variant="success" dot>Active</Badge>
<Badge variant="neutral" dot>Draft</Badge>
<Badge variant="brand" dot>Custom view</Badge>`,
    },
    {
      id: 'removable',
      title: 'Removable',
      render: () => <RemovableBadgeDemo />,
      code: `import * as React from 'react'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'

const [visible, setVisible] = React.useState(true)
{visible && <Badge appearance="lighter" tone="neutral" removable onRemove={() => setVisible(false)} removeAriaLabel={removeLabel}>{label}</Badge>}
<Badge appearance="lighter" tone="neutral" disabled removable onRemove={() => setVisible(false)} removeAriaLabel={removeLockedLabel}>{lockedLabel}</Badge>
<Button type="button" variant="outline" size="sm" disabled={visible} onClick={() => setVisible(true)}>{restoreLabel}</Button>`,
    },
    {
      id: 'appearance-filled',
      title: 'Filled appearance',
      render: () => <BadgeAppearanceDemo appearance="filled" />,
      code: `import { Badge } from '@open-mercato/ui/primitives/badge'

{(['neutral', 'info', 'warning', 'error', 'success', 'pink', 'yellow', 'purple', 'sky', 'teal'] as const).map(tone => (
  <Badge key={tone} appearance="filled" tone={tone} dot>{tone}</Badge>
))}`,
    },
    {
      id: 'appearance-light',
      title: 'Light appearance',
      render: () => <BadgeAppearanceDemo appearance="light" />,
      code: `import { Badge } from '@open-mercato/ui/primitives/badge'

{(['neutral', 'info', 'warning', 'error', 'success', 'pink', 'yellow', 'purple', 'sky', 'teal'] as const).map(tone => (
  <Badge key={tone} appearance="light" tone={tone} dot>{tone}</Badge>
))}`,
    },
    {
      id: 'appearance-lighter',
      title: 'Lighter appearance',
      render: () => <BadgeAppearanceDemo appearance="lighter" />,
      code: `import { Badge } from '@open-mercato/ui/primitives/badge'

{(['neutral', 'info', 'warning', 'error', 'success', 'pink', 'yellow', 'purple', 'sky', 'teal'] as const).map(tone => (
  <Badge key={tone} appearance="lighter" tone={tone} dot>{tone}</Badge>
))}`,
    },
    {
      id: 'appearance-stroke',
      title: 'Stroke appearance',
      render: () => <BadgeAppearanceDemo appearance="stroke" />,
      code: `import { Badge } from '@open-mercato/ui/primitives/badge'

{(['neutral', 'info', 'warning', 'error', 'success', 'pink', 'yellow', 'purple', 'sky', 'teal'] as const).map(tone => (
  <Badge key={tone} appearance="stroke" tone={tone} dot>{tone}</Badge>
))}`,
    },
    {
      id: 'content',
      title: 'Basic, dot, icons and numeric content',
      render: () => <BadgeContentDemo />,
      code: `import { Badge } from '@open-mercato/ui/primitives/badge'
import { User, ChevronRight } from 'lucide-react'

<Badge appearance="lighter" tone="info">{label}</Badge>
<Badge appearance="lighter" tone="info" dot>{label}</Badge>
<Badge appearance="lighter" tone="info" leadingIcon={<User />}>{label}</Badge>
<Badge appearance="lighter" tone="info" trailingIcon={<ChevronRight />}>{label}</Badge>
<Badge appearance="filled" tone="info">{4}</Badge>
<Badge appearance="stroke" tone="info">{24}</Badge>`,
    },
    {
      id: 'disabled',
      title: 'Disabled appearances',
      render: () => <BadgeDisabledDemo />,
      code: `import { Badge } from '@open-mercato/ui/primitives/badge'
import { User } from 'lucide-react'

{(['filled', 'light', 'lighter', 'stroke'] as const).map(appearance => (
  <Badge key={appearance} appearance={appearance} tone="info" disabled leadingIcon={<User />}>{label}</Badge>
))}`,
    },
    {
      id: 'source-sizes',
      title: 'Source16px /20px and numeric content',
      render: () => <BadgeSourceSizeDemo />,
      code: `import { Badge } from '@open-mercato/ui/primitives/badge'
import { User, ChevronRight } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'

function BadgeSourceSizeDemo() {
  const t = useT()
  const label = t('design_system.gallery.examples.badgeTag.label')
  return <div className="flex flex-col gap-6">
    {([16, 20] as const).map(size => <div key={size} className="flex flex-wrap items-center gap-3">
      <span className="w-12 text-xs text-muted-foreground">{size}px</span>
      <Badge size={size} appearance="filled" tone="purple">{label}</Badge>
      <Badge size={size} appearance="light" tone="yellow" dot>{label}</Badge>
      <Badge size={size} appearance="lighter" tone="sky" leadingIcon={<User />}>{label}</Badge>
      <Badge size={size} appearance="stroke" tone="teal" trailingIcon={<ChevronRight />}>{label}</Badge>
      <Badge size={size} appearance="filled" tone="info" numeric>{2}</Badge>
      <Badge size={size} appearance="filled" tone="info" numeric>{125}</Badge>
      <Badge size={size} appearance="stroke" tone="purple" disabled>{label}</Badge>
    </div>)}
  </div>
}

<BadgeSourceSizeDemo />`,
    },
  ],
}
const statusBadgeEntry: GalleryEntry = {
  id: 'status-badge',
  title: 'StatusBadge',
  importPath: '@open-mercato/ui/primitives/status-badge',
  figmaNodeId: '171:5100',
  usage: {
    do: [
      'System-computed statuses (active, pending, failed) — drive variants through a shared StatusMap.',
      'The dot makes state scannable in dense tables.',
    ],
    dont: ['Not for user-applied labels or categories — that is Tag.'],
  },
  variants: [
    {
      id: 'with-dot',
      title: 'Variants with dot',
      render: () => <StatusBadgeEntryWithDotPreview />,
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
      render: () => <StatusBadgeEntryWithoutDotPreview />,
      code: `import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'

<StatusBadge variant="success">Paid</StatusBadge>
<StatusBadge variant="neutral">Draft</StatusBadge>`,
    },
    {
      id: 'appearance-light',
      title: 'Light appearance, with and without dot',
      render: () => <StatusAppearanceDemo appearance="light" />,
      code: `import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'

{[true, false].map(dot => (['success', 'warning', 'error', 'info', 'neutral'] as const).map(variant => (
  <StatusBadge key={variant + String(dot)} variant={variant} appearance="light" dot={dot}>{variant}</StatusBadge>
)))}`,
    },
    {
      id: 'appearance-stroke',
      title: 'Stroke appearance, with and without dot',
      render: () => <StatusAppearanceDemo appearance="stroke" />,
      code: `import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'

{[true, false].map(dot => (['success', 'warning', 'error', 'info', 'neutral'] as const).map(variant => (
  <StatusBadge key={variant + String(dot)} variant={variant} appearance="stroke" dot={dot}>{variant}</StatusBadge>
)))}`,
    },
  ],
}
const tagEntry: GalleryEntry = {
  id: 'tag',
  title: 'Tag',
  importPath: '@open-mercato/ui/primitives/tag',
  figmaNodeId: '431:16147',
  usage: {
    do: ['User-applied labels and categories; map domain types via TagMap for consistency.'],
    dont: ['Not for system status — that is StatusBadge.'],
  },
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
      render: () => <TagEntryDotPreview />,
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
          <Tag variant="info" shape="square" dot>
            info
          </Tag>
        </>
      ),
      code: `import { Tag } from '@open-mercato/ui/primitives/tag'

<Tag shape="square">default</Tag>
<Tag variant="info" shape="square" dot>info</Tag>`,
    },
    {
      id: 'removable',
      title: 'Removable',
      render: () => <RemovableTagDemo />,
      code: `import * as React from 'react'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { Button } from '@open-mercato/ui/primitives/button'
import { User } from 'lucide-react'

const [removed, setRemoved] = React.useState<string[]>([])
{(['stroke', 'gray'] as const).map(appearance => <React.Fragment key={appearance}>
  {!removed.includes(appearance) && <Tag appearance={appearance} leading={<User />} sublabel="(4)" onRemove={() => setRemoved(current => [...current, appearance])} removeAriaLabel={removeLabel}>{label}</Tag>}
  <Tag appearance={appearance} disabled leading={<User />} sublabel="(4)" onRemove={() => setRemoved(current => [...current, appearance])} removeAriaLabel={removeLockedLabel}>{lockedLabel}</Tag>
</React.Fragment>)}
<Button type="button" variant="outline" size="sm" disabled={!removed.length} onClick={() => setRemoved([])}>{restoreLabel}</Button>`,
    },
    {
      id: 'appearance-stroke',
      title: 'Stroke appearance and leading content',
      render: () => <TagAppearanceDemo appearance="stroke" />,
      code: `import { Tag } from '@open-mercato/ui/primitives/tag'
import { User, Building2 } from 'lucide-react'

<Tag appearance="stroke">{label}</Tag>
<Tag appearance="stroke" leading={<User />}>{customerLabel}</Tag>
<Tag appearance="stroke" leading={<img src={avatarPhotoSrc} alt="" className="size-4 rounded-full object-cover" />}>James Brown</Tag>
<Tag appearance="stroke" leading={<span>🇵🇱</span>}>{countryLabel}</Tag>
<Tag appearance="stroke" leading={<img src={githubLogoSrc} alt="" className="size-4 rounded-sm bg-white" />}>GitHub</Tag>
<Tag appearance="stroke" leading={<Building2 />} sublabel="(4)">Open Mercato</Tag>`,
    },
    {
      id: 'appearance-gray',
      title: 'Gray appearance and leading content',
      render: () => <TagAppearanceDemo appearance="gray" />,
      code: `import { Tag } from '@open-mercato/ui/primitives/tag'
import { User, Building2 } from 'lucide-react'

<Tag appearance="gray">{label}</Tag>
<Tag appearance="gray" leading={<User />}>{customerLabel}</Tag>
<Tag appearance="gray" leading={<img src={avatarPhotoSrc} alt="" className="size-4 rounded-full object-cover" />}>James Brown</Tag>
<Tag appearance="gray" leading={<span>🇵🇱</span>}>{countryLabel}</Tag>
<Tag appearance="gray" leading={<img src={githubLogoSrc} alt="" className="size-4 rounded-sm bg-white" />}>GitHub</Tag>
<Tag appearance="gray" leading={<Building2 />} sublabel="(4)">Open Mercato</Tag>`,
    },
  ],
}
const avatarEntry: GalleryEntry = {
  id: 'avatar',
  title: 'Avatar',
  importPath: '@open-mercato/ui/primitives/avatar',
  figmaNodeId: '245:18786',
  usage: {
    do: [
      'Use src for photos, Memoji, and illustrations; use label for initials or icon for an entity symbol.',
      'Numeric sizes reproduce all nine Figma diameters: 20, 24, 32, 40, 48, 56, 64, 72, and 80 px. Legacy xs/sm/md/lg/xl sizes remain 20/28/36/48/64 px.',
      'Numeric 20–32 px initials use one letter; 40–80 px use two. Font size, line height, and medium weight follow the source. The application font and tracking remain governed by existing tokens.',
      'Photo stacks use the audited size-specific overlaps. Initial stacks reduce overlap where two letters need more room, and full overflow counts can widen beyond the avatar diameter.',
      'The six top-status examples use the existing circular badge slot and semantic colors. They show supported compositions, not an exact replica of the Figma verified silhouette.',
      'Local James Brown assets come from Figma nodes 246:11135, 246:11139, and 246:11141. The production image crop can differ from Figma.',
    ],
    dont: [
      'Do not assume square avatars or simultaneous top and bottom decorations are supported by the current API.',
      'Do not render interactive actions inside the decorative badge slot; put actions in a separate button.',
    ],
  },
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
      id: 'figma-sizes',
      title: 'Figma sizes (20–80 px)',
      render: () => (
        <div className="flex flex-wrap items-end gap-6">
          {([20, 24, 32, 40, 48, 56, 64, 72, 80] as const).map((size) => (
            <div key={size} className="flex flex-col items-center gap-3">
              <Avatar label="Wei Chen" size={size} />
              <code className="text-xs text-muted-foreground">{size}px</code>
            </div>
          ))}
        </div>
      ),
      code: `import { Avatar } from '@open-mercato/ui/primitives/avatar'

<Avatar label="Wei Chen" size={20} />
<Avatar label="Wei Chen" size={24} />
<Avatar label="Wei Chen" size={32} />
<Avatar label="Wei Chen" size={40} />
<Avatar label="Wei Chen" size={48} />
<Avatar label="Wei Chen" size={56} />
<Avatar label="Wei Chen" size={64} />
<Avatar label="Wei Chen" size={72} />
<Avatar label="Wei Chen" size={80} />`,
    },
    {
      id: 'figma-stack-sizes',
      title: 'Figma stack sizes and readable initials',
      render: () => (
        <div className="grid w-full gap-6">
          {([20, 24, 32, 40, 48, 56, 64, 72, 80] as const).map((size) => (
            <div key={size} className="flex flex-wrap items-center gap-6">
              <code className="text-xs text-muted-foreground">{size}px</code>
              <AvatarStack size={size} max={3} overflowCount={12}>
                <Avatar label="Wei Chen" size={size} />
                <Avatar label="Laura Perez" size={size} />
                <Avatar label="Omar Haddad" size={size} />
              </AvatarStack>
            </div>
          ))}
        </div>
      ),
      code: `import { Avatar, AvatarStack } from '@open-mercato/ui/primitives/avatar'

{([20, 24, 32, 40, 48, 56, 64, 72, 80] as const).map((size) => (
  <AvatarStack key={size} size={size} max={3} overflowCount={12}>
    <Avatar label="Wei Chen" size={size} />
    <Avatar label="Laura Perez" size={size} />
    <Avatar label="Omar Haddad" size={size} />
  </AvatarStack>
))}`,
    },
    {
      id: 'photo',
      title: 'Photo source',
      render: () => <Avatar label="James Brown" src={avatarPhotoSrc} size="lg" />,
      code: `import { Avatar } from '@open-mercato/ui/primitives/avatar'
import photo from './avatar-photo.png'

<Avatar label="James Brown" src={typeof photo === 'string' ? photo : photo.src} size="lg" />`,
    },
    {
      id: 'memoji',
      title: 'Memoji source',
      render: () => <Avatar label="James Brown" src={avatarMemojiSrc} size="lg" variant="monochrome" />,
      code: `import { Avatar } from '@open-mercato/ui/primitives/avatar'
import memoji from './avatar-memoji.png'

<Avatar label="James Brown" src={typeof memoji === 'string' ? memoji : memoji.src} size="lg" variant="monochrome" />`,
    },
    {
      id: 'illustration',
      title: 'Illustration source',
      render: () => <Avatar label="James Brown" src={avatarIllustrationSrc} size="lg" variant="monochrome" />,
      code: `import { Avatar } from '@open-mercato/ui/primitives/avatar'
import illustration from './avatar-illustration.png'

<Avatar label="James Brown" src={typeof illustration === 'string' ? illustration : illustration.src} size="lg" variant="monochrome" />`,
    },
    {
      id: 'solid-background',
      title: 'Solid background',
      render: () => <Avatar label="James Brown" icon={<span />} size="lg" variant="monochrome" />,
      code: `import { Avatar } from '@open-mercato/ui/primitives/avatar'

<Avatar label="James Brown" icon={<span />} size="lg" variant="monochrome" />`,
    },
    {
      id: 'person-icon',
      title: 'Person icon',
      render: () => <Avatar label="James Brown" icon={<User />} size="lg" variant="monochrome" />,
      code: `import { User } from 'lucide-react'
import { Avatar } from '@open-mercato/ui/primitives/avatar'

<Avatar label="James Brown" icon={<User />} size="lg" variant="monochrome" />`,
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
      id: 'top-badges',
      title: 'Top Status compositions',
      render: () => <AvatarBadgesDemo />,
      code: `import { Check, Pin, Star, Plus, X } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Avatar } from '@open-mercato/ui/primitives/avatar'

function AvatarBadges() {
  const t = useT()
  return (
    <div className="flex flex-wrap items-center gap-6 p-2">
      <Avatar label="Wei Chen" ariaLabel={t('design_system.gallery.examples.avatar.verified')} badge={<Check className="size-3" />} badgeClassName="bg-status-info-icon text-white" />
      <Avatar label="Laura Perez" ariaLabel={t('design_system.gallery.examples.avatar.pinned')} badge={<Pin className="size-3" />} badgeClassName="bg-accent-indigo text-white" />
      <Avatar label="Omar Haddad" ariaLabel={t('design_system.gallery.examples.avatar.favorite')} badge={<Star className="size-3" />} badgeClassName="bg-status-success-icon text-white" />
      <Avatar label="Ines Kowalska" ariaLabel={t('design_system.gallery.examples.avatar.add')} badge={<Plus className="size-3" />} />
      <Avatar label="Ravi Patel" ariaLabel={t('design_system.gallery.examples.avatar.remove')} badge={<X className="size-3" />} badgeClassName="bg-status-error-icon text-white" />
      <Avatar label="James Brown" ariaLabel={t('design_system.gallery.examples.avatar.notification')} status="error" statusPosition="top-right" />
    </div>
  )
}`,
    },
    {
      id: 'company-badge',
      title: 'Company badge composition',
      render: () => (
        <Avatar
          label="Acme Corp"
          src={avatarPhotoSrc}
          size="lg"
          badge={<Building2 className="size-3" />}
          badgeClassName="top-auto bottom-0 translate-y-1/4"
        />
      ),
      code: `import { Building2 } from 'lucide-react'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import photo from './avatar-photo.png'

<Avatar label="Acme Corp" src={typeof photo === 'string' ? photo : photo.src} size="lg" badge={<Building2 className="size-3" />} badgeClassName="top-auto bottom-0 translate-y-1/4" />`,
    },
    {
      id: 'rings',
      title: 'Ring tones (code extension)',
      render: () => (
        <div className="flex flex-wrap gap-6 p-2">
          <Avatar label="Wei Chen" ring />
          <Avatar label="Laura Perez" ring="success" />
          <Avatar label="Omar Haddad" ring="warning" />
          <Avatar label="Ines Kowalska" ring="error" />
          <Avatar label="Ravi Patel" ring="muted" />
        </div>
      ),
      code: `import { Avatar } from '@open-mercato/ui/primitives/avatar'

<div className="flex flex-wrap gap-6 p-2">
  <Avatar label="Wei Chen" ring />
  <Avatar label="Laura Perez" ring="success" />
  <Avatar label="Omar Haddad" ring="warning" />
  <Avatar label="Ines Kowalska" ring="error" />
  <Avatar label="Ravi Patel" ring="muted" />
</div>`,
    },
    {
      id: 'stack-sizes',
      title: 'AvatarStack sizes and full overflow counts',
      render: () => (
        <div className="grid gap-6">
          {(['xs', 'sm', 'md', 'lg', 'xl'] as const).map((size) => (
            <AvatarStack key={size} size={size} max={3} overflowCount={12}>
              <Avatar label="Wei Chen" size={size} />
              <Avatar label="Laura Perez" size={size} />
              <Avatar label="Omar Haddad" size={size} />
            </AvatarStack>
          ))}
        </div>
      ),
      code: `import { Avatar, AvatarStack } from '@open-mercato/ui/primitives/avatar'

<div className="grid gap-6">
  {(['xs', 'sm', 'md', 'lg', 'xl'] as const).map((size) => (
    <AvatarStack key={size} size={size} max={3} overflowCount={12}>
      <Avatar label="Wei Chen" size={size} />
      <Avatar label="Laura Perez" size={size} />
      <Avatar label="Omar Haddad" size={size} />
    </AvatarStack>
  ))}
</div>`,
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
      id: 'header-states',
      title: 'Header / default, disabled, empty and sorting',
      render: () => <TableHeaderExamples />,
      code: tableHeaderExampleCode,
    },
    {
      id: 'cells-48',
      title: 'Cell catalogue / 48px rows',
      render: () => <TableCellExamples rowHeight={48} />,
      code: tableCellExampleCode(48),
    },
    {
      id: 'cells-64',
      title: 'Cell catalogue / 64px rows',
      render: () => <TableCellExamples rowHeight={64} />,
      code: tableCellExampleCode(64),
    },
    {
      id: 'default',
      title: 'default',
      render: () => <TableEntryDefaultPreview />,
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
      render: () => <TableEntryStripedPreview />,
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
      render: () => <TableEntryWithFooterPreview />,
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
}
const cardEntry: GalleryEntry = {
  id: 'card',
  title: 'Card',
  importPath: '@open-mercato/ui/primitives/card',
  variants: [
    {
      id: 'default',
      title: 'default',
      render: () => <CardEntryDefaultPreview />,
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
      render: () => <CardEntryWithActionPreview />,
      code: `import { MoreHorizontal } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent } from '@open-mercato/ui/primitives/card'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Avatar, AvatarStack } from '@open-mercato/ui/primitives/avatar'

<Card className="w-full max-w-sm">
  <CardHeader>
    <CardTitle>Team members</CardTitle>
    <CardDescription>People with access to this workspace.</CardDescription>
    <CardAction>
      <IconButton type="button" variant="ghost" aria-label="More"><MoreHorizontal /></IconButton>
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
</Card>`,
    },
  ],
}
const separatorEntry: GalleryEntry = {
  id: 'separator',
  title: 'Separator',
  importPath: '@open-mercato/ui/primitives/separator',
  figmaNodeId: '414:4401',
  usage: {
    do: [
      'The nine Figma Content Divider layouts are represented: line, line spacing, text and line, text only, solid text, icon button, icon button group, text button, and text button group.',
      'Place action buttons between two flexible Separator rules with gap-2.5. ButtonGroup supplies joined borders; do not place interactive controls inside a separator role.',
      'Vertical, dashed, and label-alignment examples expose the existing code API beyond the nine Figma layouts.',
      'Compositions use production tokens and responsive width. The labeled primitive remains 12/16 px; the audited Figma text-and-line label is 11/12 px.',
    ],
  },
  variants: [
    {
      id: 'default',
      title: 'default',
      render: () => <SeparatorEntryDefaultPreview />,
      code: `import { Separator } from '@open-mercato/ui/primitives/separator'

<Separator className="my-3" />`,
    },
    {
      id: 'line-spacing',
      title: 'Line Spacing',
      render: () => (
        <div className="flex h-1 w-full items-center">
          <Separator />
        </div>
      ),
      code: `import { Separator } from '@open-mercato/ui/primitives/separator'

<div className="flex h-1 w-full items-center"><Separator /></div>`,
    },
    {
      id: 'labeled',
      title: 'Labeled',
      render: () => <SeparatorEntryLabeledPreview />,
      code: `import { Separator } from '@open-mercato/ui/primitives/separator'

<Separator label="OR" />`,
    },
    {
      id: 'text-divider',
      title: 'Text Divider',
      render: () => <SeparatorTextDemo kind="text" />,
      code: `import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Separator } from '@open-mercato/ui/primitives/separator'

function TextDivider() {
  const t = useT()
  return <Separator section label={t('design_system.gallery.examples.separator.or')} className="bg-transparent px-2 py-1" />
}`,
    },
    {
      id: 'label-alignments',
      title: 'Label alignments (code extension)',
      render: () => <SeparatorTextDemo kind="label-alignments" />,
      code: `import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Separator } from '@open-mercato/ui/primitives/separator'

function LabelAlignments() {
  const t = useT()
  return (
    <div className="grid w-full gap-6">
      <Separator label={t('design_system.gallery.examples.separator.or')} labelAlign="start" />
      <Separator label={t('design_system.gallery.examples.separator.or')} labelAlign="center" />
      <Separator label={t('design_system.gallery.examples.separator.or')} labelAlign="end" />
    </div>
  )
}`,
    },
    {
      id: 'section',
      title: 'Section header',
      render: () => (
        <div className="w-full max-w-sm">
          <Separator section label={'Amount & account'} className="px-5" />
        </div>
      ),
      code: `import { Separator } from '@open-mercato/ui/primitives/separator'

<Separator section label="Amount & account" className="px-5" />`,
    },
    {
      id: 'icon-button',
      title: 'Icon Button',
      render: () => <SeparatorActionDemo kind="icon" />,
      code: `import { Plus } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Separator } from '@open-mercato/ui/primitives/separator'

function IconDivider() {
  const t = useT()
  return (
    <div className="flex w-full items-center gap-2.5">
      <Separator className="min-w-0 flex-1" />
      <IconButton size="default" aria-label={t('design_system.gallery.examples.separator.add')}><Plus className="size-5" /></IconButton>
      <Separator className="min-w-0 flex-1" />
    </div>
  )
}`,
    },
    {
      id: 'icon-button-group',
      title: 'Icon Button Group',
      render: () => <SeparatorActionDemo kind="icon-group" />,
      code: `import { ChevronLeft, Plus, ChevronRight } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { ButtonGroup } from '@open-mercato/ui/primitives/button-group'
import { Separator } from '@open-mercato/ui/primitives/separator'

function IconGroupDivider() {
  const t = useT()
  return (
    <div className="flex w-full items-center gap-2.5">
      <Separator className="min-w-0 flex-1" />
      <ButtonGroup aria-label={t('design_system.gallery.examples.separator.actions')}>
        <IconButton size="default" aria-label={t('design_system.gallery.examples.separator.previous')}><ChevronLeft className="size-5" /></IconButton>
        <IconButton size="default" aria-label={t('design_system.gallery.examples.separator.add')}><Plus className="size-5" /></IconButton>
        <IconButton size="default" aria-label={t('design_system.gallery.examples.separator.next')}><ChevronRight className="size-5" /></IconButton>
      </ButtonGroup>
      <Separator className="min-w-0 flex-1" />
    </div>
  )
}`,
    },
    {
      id: 'text-button',
      title: 'Text Button',
      render: () => <SeparatorActionDemo kind="text" />,
      code: `import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Separator } from '@open-mercato/ui/primitives/separator'

function TextButtonDivider() {
  const t = useT()
  return (
    <div className="flex w-full items-center gap-2.5">
      <Separator className="min-w-0 flex-1" />
      <Button type="button" size="sm" variant="outline" className="px-2.5">{t('design_system.gallery.examples.separator.add')}</Button>
      <Separator className="min-w-0 flex-1" />
    </div>
  )
}`,
    },
    {
      id: 'text-button-group',
      title: 'Text Button Group',
      render: () => <SeparatorActionDemo kind="text-group" />,
      code: `import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { ButtonGroup } from '@open-mercato/ui/primitives/button-group'
import { Separator } from '@open-mercato/ui/primitives/separator'

function TextGroupDivider() {
  const t = useT()
  return (
    <div className="flex w-full items-center gap-2.5">
      <Separator className="min-w-0 flex-1" />
      <ButtonGroup size="sm" aria-label={t('design_system.gallery.examples.separator.actions')}>
        <Button type="button" size="sm" variant="outline" className="px-3.5">{t('design_system.gallery.examples.separator.previous')}</Button>
        <Button type="button" size="sm" variant="outline" className="px-3.5">{t('design_system.gallery.examples.separator.add')}</Button>
        <Button type="button" size="sm" variant="outline" className="px-3.5">{t('design_system.gallery.examples.separator.next')}</Button>
      </ButtonGroup>
      <Separator className="min-w-0 flex-1" />
    </div>
  )
}`,
    },
    {
      id: 'vertical',
      title: 'Vertical (code extension)',
      render: () => (
        <div className="flex h-16 items-center gap-6">
          <Avatar label="Wei Chen" />
          <Separator orientation="vertical" />
          <Avatar label="Laura Perez" />
          <Separator orientation="vertical" variant="dashed" />
          <Avatar label="Omar Haddad" />
        </div>
      ),
      code: `import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Separator } from '@open-mercato/ui/primitives/separator'

<div className="flex h-16 items-center gap-6">
  <Avatar label="Wei Chen" />
  <Separator orientation="vertical" />
  <Avatar label="Laura Perez" />
  <Separator orientation="vertical" variant="dashed" />
  <Avatar label="Omar Haddad" />
</div>`,
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
function FigmaScrollDemo({
  size,
  variant,
  horizontal = false,
}: {
  size: 'md' | 'sm' | 'xs'
  variant: 'default' | 'lighter'
  horizontal?: boolean
}) {
  const t = useT()
  return (
    <ScrollArea
      type="always"
      scrollbarSize={size}
      scrollbarVariant={variant}
      scrollbars={horizontal ? 'horizontal' : 'vertical'}
      className="h-60 w-full max-w-xs rounded-md border border-border"
    >
      <div className={horizontal ? 'flex w-max gap-4 p-6' : 'flex flex-col gap-2 p-4 pr-8'}>
        {Array.from(
          {
            length: 20,
          },
          (_, index) => (
            <p key={index} className="whitespace-nowrap text-sm">
              {t('design_system.gallery.samples.scroll.row', {
                number: index + 1,
              })}
            </p>
          ),
        )}
      </div>
    </ScrollArea>
  )
}
const scrollAreaEntry: GalleryEntry = {
  id: 'scroll-area',
  title: 'ScrollArea',
  importPath: '@open-mercato/ui/primitives/scroll-area',
  figmaNodeId: '166941:61889',
  variants: [
    {
      id: 'default-md',
      title: 'default / Medium',
      render: () => <FigmaScrollDemo size="md" variant="default" />,
      code: `import { ScrollArea } from '@open-mercato/ui/primitives/scroll-area'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const t = useT()

<ScrollArea type="always" scrollbarSize="md" scrollbarVariant="default" className="h-60 w-full max-w-xs rounded-md border border-border">
  <div className="flex flex-col gap-2 p-4 pr-8">
    {Array.from({ length: 20 }, (_, index) => <p key={index} className="whitespace-nowrap text-sm">{t('design_system.gallery.samples.scroll.row', { number: index + 1 })}</p>)}
  </div>
</ScrollArea>`,
    },
    {
      id: 'default-sm',
      title: 'default / Small',
      render: () => <FigmaScrollDemo size="sm" variant="default" />,
      code: `import { ScrollArea } from '@open-mercato/ui/primitives/scroll-area'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const t = useT()

<ScrollArea type="always" scrollbarSize="sm" scrollbarVariant="default" className="h-60 w-full max-w-xs rounded-md border border-border">
  <div className="flex flex-col gap-2 p-4 pr-8">
    {Array.from({ length: 20 }, (_, index) => <p key={index} className="whitespace-nowrap text-sm">{t('design_system.gallery.samples.scroll.row', { number: index + 1 })}</p>)}
  </div>
</ScrollArea>`,
    },
    {
      id: 'default-xs',
      title: 'default / X-Small',
      render: () => <FigmaScrollDemo size="xs" variant="default" />,
      code: `import { ScrollArea } from '@open-mercato/ui/primitives/scroll-area'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const t = useT()

<ScrollArea type="always" scrollbarSize="xs" scrollbarVariant="default" className="h-60 w-full max-w-xs rounded-md border border-border">
  <div className="flex flex-col gap-2 p-4 pr-8">
    {Array.from({ length: 20 }, (_, index) => <p key={index} className="whitespace-nowrap text-sm">{t('design_system.gallery.samples.scroll.row', { number: index + 1 })}</p>)}
  </div>
</ScrollArea>`,
    },
    {
      id: 'lighter-md',
      title: 'lighter / Medium',
      render: () => <FigmaScrollDemo size="md" variant="lighter" />,
      code: `import { ScrollArea } from '@open-mercato/ui/primitives/scroll-area'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const t = useT()

<ScrollArea type="always" scrollbarSize="md" scrollbarVariant="lighter" className="h-60 w-full max-w-xs rounded-md border border-border">
  <div className="flex flex-col gap-2 p-4 pr-8">
    {Array.from({ length: 20 }, (_, index) => <p key={index} className="whitespace-nowrap text-sm">{t('design_system.gallery.samples.scroll.row', { number: index + 1 })}</p>)}
  </div>
</ScrollArea>`,
    },
    {
      id: 'lighter-sm',
      title: 'lighter / Small',
      render: () => <FigmaScrollDemo size="sm" variant="lighter" />,
      code: `import { ScrollArea } from '@open-mercato/ui/primitives/scroll-area'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const t = useT()

<ScrollArea type="always" scrollbarSize="sm" scrollbarVariant="lighter" className="h-60 w-full max-w-xs rounded-md border border-border">
  <div className="flex flex-col gap-2 p-4 pr-8">
    {Array.from({ length: 20 }, (_, index) => <p key={index} className="whitespace-nowrap text-sm">{t('design_system.gallery.samples.scroll.row', { number: index + 1 })}</p>)}
  </div>
</ScrollArea>`,
    },
    {
      id: 'lighter-xs',
      title: 'lighter / X-Small',
      render: () => <FigmaScrollDemo size="xs" variant="lighter" />,
      code: `import { ScrollArea } from '@open-mercato/ui/primitives/scroll-area'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const t = useT()

<ScrollArea type="always" scrollbarSize="xs" scrollbarVariant="lighter" className="h-60 w-full max-w-xs rounded-md border border-border">
  <div className="flex flex-col gap-2 p-4 pr-8">
    {Array.from({ length: 20 }, (_, index) => <p key={index} className="whitespace-nowrap text-sm">{t('design_system.gallery.samples.scroll.row', { number: index + 1 })}</p>)}
  </div>
</ScrollArea>`,
    },
    {
      id: 'horizontal-figma',
      title: 'Horizontal / Lighter / Medium',
      render: () => <FigmaScrollDemo size="md" variant="lighter" horizontal />,
      code: `import { ScrollArea } from '@open-mercato/ui/primitives/scroll-area'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const t = useT()

<ScrollArea type="always" scrollbarSize="md" scrollbarVariant="lighter" scrollbars="horizontal" className="h-60 w-full max-w-xs rounded-md border border-border">
  <div className="flex w-max gap-4 p-6">
    {Array.from({ length: 20 }, (_, index) => <p key={index} className="whitespace-nowrap text-sm">{t('design_system.gallery.samples.scroll.row', { number: index + 1 })}</p>)}
  </div>
</ScrollArea>`,
    },
    {
      id: 'vertical',
      title: 'Vertical',
      render: () => <ScrollAreaEntryVerticalPreview />,
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
      render: () => <ScrollAreaEntryHorizontalPreview />,
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
  figmaNodeId: '166035:46833',
  title: 'ActivityFeed',
  importPath: '@open-mercato/ui/primitives/activity-feed',
  variants: [
    {
      id: 'source-composition',
      title: '5 entry types / filter / actions',
      render: () => <ActivityFeedExample />,
      code: activityFeedExampleCode,
    },
    {
      id: 'basic',
      title: 'Basic entries',
      render: () => <ActivityFeedEntryBasicPreview />,
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
      render: () => <ActivityFeedEntryWithAttachmentPreview />,
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
      render: () => <ActivityFeedEntryWithCommentPreview />,
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
      render: () => <ActivityFeedEntryStatusChipsPreview />,
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
const content_labelEntry: GalleryEntry = {
  id: 'content-label',
  title: 'ContentLabel',
  importPath: '@open-mercato/ui/primitives/content-label',
  figmaNodeId: '2945:5539',
  descriptionKey: 'design_system.entries.content-label.description',
  variants: [
    {
      id: 'basic-40',
      title: 'basic-40',
      render: () => <ContentLabelExample kind="basic" size={40} />,
      code: keyComponentExampleCode('<ContentLabelExample kind="basic" size={40} />'),
    },
    {
      id: 'icon-40',
      title: 'icon-40',
      render: () => <ContentLabelExample kind="icon" size={40} />,
      code: keyComponentExampleCode('<ContentLabelExample kind="icon" size={40} />'),
    },
    {
      id: 'avatar-40',
      title: 'avatar-40',
      render: () => <ContentLabelExample kind="avatar" size={40} />,
      code: keyComponentExampleCode('<ContentLabelExample kind="avatar" size={40} />'),
    },
    {
      id: 'brand-40',
      title: 'brand-40',
      render: () => <ContentLabelExample kind="brand" size={40} />,
      code: keyComponentExampleCode('<ContentLabelExample kind="brand" size={40} />'),
    },
    {
      id: 'company-40',
      title: 'company-40',
      render: () => <ContentLabelExample kind="company" size={40} />,
      code: keyComponentExampleCode('<ContentLabelExample kind="company" size={40} />'),
    },
    {
      id: 'basic-48',
      title: 'basic-48',
      render: () => <ContentLabelExample kind="basic" size={48} />,
      code: keyComponentExampleCode('<ContentLabelExample kind="basic" size={48} />'),
    },
    {
      id: 'icon-48',
      title: 'icon-48',
      render: () => <ContentLabelExample kind="icon" size={48} />,
      code: keyComponentExampleCode('<ContentLabelExample kind="icon" size={48} />'),
    },
    {
      id: 'avatar-48',
      title: 'avatar-48',
      render: () => <ContentLabelExample kind="avatar" size={48} />,
      code: keyComponentExampleCode('<ContentLabelExample kind="avatar" size={48} />'),
    },
    {
      id: 'brand-48',
      title: 'brand-48',
      render: () => <ContentLabelExample kind="brand" size={48} />,
      code: keyComponentExampleCode('<ContentLabelExample kind="brand" size={48} />'),
    },
    {
      id: 'company-48',
      title: 'company-48',
      render: () => <ContentLabelExample kind="company" size={48} />,
      code: keyComponentExampleCode('<ContentLabelExample kind="company" size={48} />'),
    },
    {
      id: 'options',
      title: 'options',
      render: () => <ContentLabelExample kind="icon" size={48} configurable />,
      code: keyComponentExampleCode('<ContentLabelExample kind="icon" size={48} configurable />'),
    },
  ],
}
const content_cardEntry: GalleryEntry = {
  id: 'content-card',
  title: 'ContentCard',
  importPath: '@open-mercato/ui/primitives/content-card',
  figmaNodeId: '2942:9503',
  descriptionKey: 'design_system.entries.content-card.description',
  variants: [
    {
      id: 'basic',
      title: 'basic',
      render: () => <ContentCardExample kind="basic" />,
      code: keyComponentExampleCode('<ContentCardExample kind="basic" />'),
    },
    {
      id: 'icon',
      title: 'icon',
      render: () => <ContentCardExample kind="icon" />,
      code: keyComponentExampleCode('<ContentCardExample kind="icon" />'),
    },
    {
      id: 'avatar',
      title: 'avatar',
      render: () => <ContentCardExample kind="avatar" />,
      code: keyComponentExampleCode('<ContentCardExample kind="avatar" />'),
    },
    {
      id: 'provider',
      title: 'provider',
      render: () => <ContentCardExample kind="provider" />,
      code: keyComponentExampleCode('<ContentCardExample kind="provider" />'),
    },
    {
      id: 'brand',
      title: 'brand',
      render: () => <ContentCardExample kind="brand" />,
      code: keyComponentExampleCode('<ContentCardExample kind="brand" />'),
    },
    {
      id: 'company',
      title: 'company',
      render: () => <ContentCardExample kind="company" />,
      code: keyComponentExampleCode('<ContentCardExample kind="company" />'),
    },
    {
      id: 'disabled',
      title: 'disabled',
      render: () => <ContentCardExample kind="icon" disabled />,
      code: keyComponentExampleCode('<ContentCardExample kind="icon" disabled />'),
    },
  ],
}
const key_iconEntry: GalleryEntry = {
  id: 'key-icon',
  title: 'KeyIcon',
  importPath: '@open-mercato/ui/primitives/key-icon',
  figmaNodeId: '263:1850',
  descriptionKey: 'design_system.entries.key-icon.description',
  variants: [
    {
      id: 'stroke',
      title: 'stroke',
      render: () => <KeyIconExamples />,
      code: keyComponentExampleCode('<KeyIconExamples />'),
    },
    {
      id: 'lighter',
      title: 'lighter',
      render: () => <KeyIconExamples appearance="lighter" />,
      code: keyComponentExampleCode('<KeyIconExamples appearance="lighter" />'),
    },
  ],
}
const payment_iconEntry: GalleryEntry = {
  id: 'payment-icon',
  title: 'PaymentIcon',
  importPath: '@open-mercato/ui/primitives/payment-icon',
  figmaNodeId: '2942:9995',
  descriptionKey: 'design_system.entries.payment-icon.description',
  variants: [
    {
      id: 'categories',
      title: 'categories',
      render: () => <PaymentIconExamples />,
      code: keyComponentExampleCode('<PaymentIconExamples />'),
    },
  ],
}
const chart_legendEntry: GalleryEntry = {
  id: 'chart-legend',
  title: 'ChartLegend',
  importPath: '@open-mercato/ui/primitives/chart-legend',
  figmaNodeId: '2942:9934',
  descriptionKey: 'design_system.entries.chart-legend.description',
  variants: [
    {
      id: 'colors',
      title: 'colors',
      render: () => <ChartLegendExamples />,
      code: keyComponentExampleCode('<ChartLegendExamples />'),
    },
    {
      id: 'interactive',
      title: 'interactive',
      render: () => <ChartLegendExamples interactive />,
      code: keyComponentExampleCode('<ChartLegendExamples interactive />'),
    },
  ],
}
const chart_legend_dotEntry: GalleryEntry = {
  id: 'chart-legend-dot',
  title: 'ChartLegendDot',
  importPath: '@open-mercato/ui/primitives/chart-legend',
  figmaNodeId: '2942:9880',
  descriptionKey: 'design_system.entries.chart-legend-dot.description',
  variants: [
    {
      id: 'size-16',
      title: 'size-16',
      render: () => <ChartLegendDotExamples />,
      code: keyComponentExampleCode('<ChartLegendDotExamples />'),
    },
    {
      id: 'size-20',
      title: 'size-20',
      render: () => <ChartLegendDotExamples size={20} />,
      code: keyComponentExampleCode('<ChartLegendDotExamples size={20} />'),
    },
  ],
}
export const entries: GalleryEntry[] = [
  content_labelEntry,
  content_cardEntry,
  key_iconEntry,
  payment_iconEntry,
  chart_legendEntry,
  chart_legend_dotEntry,
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
