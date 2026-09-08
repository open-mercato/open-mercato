import * as React from 'react'
import { Inbox, RefreshCw, Search, Settings, UserPlus } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import { CircularProgress, Progress } from '@open-mercato/ui/primitives/progress'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Rating } from '@open-mercato/ui/primitives/rating'
import { StepIndicator, type StepIndicatorStep } from '@open-mercato/ui/primitives/step-indicator'
import { Notification } from '@open-mercato/ui/primitives/notification'
import {
  NotificationFeed,
  NotificationFeedFooter,
  NotificationFeedHeader,
  NotificationFeedIconBadge,
  NotificationFeedItem,
  NotificationFeedList,
} from '@open-mercato/ui/primitives/notification-feed'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { LinkButton } from '@open-mercato/ui/primitives/link-button'
import type { GalleryEntry } from '../types'

// Component titles and variant names are proper nouns from the codebase and
// are deliberately not translated. `code` MUST contain the entry's importPath
// (enforced by the registry-integrity test) and is always reviewed alongside
// its sibling `render`.

const alertEntry: GalleryEntry = {
  id: 'alert',
  title: 'Alert',
  importPath: '@open-mercato/ui/primitives/alert',
  usage: {
    do: [
      'Current API only: status (error/warning/success/information/feature) + style (filled/light/lighter/stroke) + size.',
      'light/lighter for inline page notices; filled for high-emphasis moments.',
    ],
    dont: ['The legacy variant prop is deprecated — lint flags it.', 'Never build ad-hoc colored notice boxes; this is the primitive for them.'],
  },
  variants: [
    {
      id: 'statuses-light',
      title: 'Statuses (light)',
      render: () => (
        <div className="flex w-full max-w-md flex-col gap-2">
          <Alert status="error" style="light">Payment failed — the card was declined.</Alert>
          <Alert status="warning" style="light">Inventory sync is running behind schedule.</Alert>
          <Alert status="success" style="light">Order #10231 was fulfilled.</Alert>
          <Alert status="information" style="light">Prices include VAT for EU customers.</Alert>
          <Alert status="feature" style="light">Bulk editing is now available in the catalog.</Alert>
        </div>
      ),
      code: `import { Alert } from '@open-mercato/ui/primitives/alert'

<Alert status="error" style="light">Payment failed — the card was declined.</Alert>
<Alert status="warning" style="light">Inventory sync is running behind schedule.</Alert>
<Alert status="success" style="light">Order #10231 was fulfilled.</Alert>
<Alert status="information" style="light">Prices include VAT for EU customers.</Alert>
<Alert status="feature" style="light">Bulk editing is now available in the catalog.</Alert>`,
    },
    {
      id: 'filled',
      title: 'filled',
      render: () => (
        <div className="w-full max-w-md">
          <Alert status="error" style="filled" size="default">
            <AlertTitle>Import failed</AlertTitle>
            <AlertDescription>14 rows were rejected — download the error report to review them.</AlertDescription>
          </Alert>
        </div>
      ),
      code: `import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'

<Alert status="error" style="filled" size="default">
  <AlertTitle>Import failed</AlertTitle>
  <AlertDescription>14 rows were rejected — download the error report to review them.</AlertDescription>
</Alert>`,
    },
    {
      id: 'stroke',
      title: 'stroke',
      render: () => (
        <div className="w-full max-w-md">
          <Alert status="success" style="stroke" size="default">
            <AlertTitle>Backup complete</AlertTitle>
            <AlertDescription>The nightly snapshot finished without warnings.</AlertDescription>
          </Alert>
        </div>
      ),
      code: `import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'

<Alert status="success" style="stroke" size="default">
  <AlertTitle>Backup complete</AlertTitle>
  <AlertDescription>The nightly snapshot finished without warnings.</AlertDescription>
</Alert>`,
    },
    {
      id: 'sizes',
      title: 'Sizes',
      render: () => (
        <div className="flex w-full max-w-md flex-col gap-2">
          <Alert status="information" size="xs">X-Small — inline form hint.</Alert>
          <Alert status="information" size="sm">Small — the default single-line alert.</Alert>
          <Alert status="information" size="default">
            <AlertTitle>Large</AlertTitle>
            <AlertDescription>Multi-line alert with a title and a description body.</AlertDescription>
          </Alert>
        </div>
      ),
      code: `import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'

<Alert status="information" size="xs">X-Small — inline form hint.</Alert>
<Alert status="information" size="sm">Small — the default single-line alert.</Alert>
<Alert status="information" size="default">
  <AlertTitle>Large</AlertTitle>
  <AlertDescription>Multi-line alert with a title and a description body.</AlertDescription>
</Alert>`,
    },
    {
      id: 'dismissible-with-action',
      title: 'Dismissible with action',
      render: () => (
        <div className="w-full max-w-md">
          <Alert
            status="warning"
            style="lighter"
            dismissible
            action={<LinkButton variant="black" underline="always">Review</LinkButton>}
          >
            3 products are missing tax categories.
          </Alert>
        </div>
      ),
      code: `import { Alert } from '@open-mercato/ui/primitives/alert'
import { LinkButton } from '@open-mercato/ui/primitives/link-button'

<Alert
  status="warning"
  style="lighter"
  dismissible
  onDismiss={() => setVisible(false)}
  action={<LinkButton variant="black" underline="always">Review</LinkButton>}
>
  3 products are missing tax categories.
</Alert>`,
    },
  ],
}

const emptyStateEntry: GalleryEntry = {
  id: 'empty-state',
  title: 'EmptyState',
  importPath: '@open-mercato/ui/primitives/empty-state',
  variants: [
    {
      id: 'default',
      title: 'default',
      render: () => (
        <div className="w-full max-w-md">
          <EmptyState
            title="No customers yet"
            description="Create your first customer to start tracking opportunities."
          />
        </div>
      ),
      code: `import { EmptyState } from '@open-mercato/ui/primitives/empty-state'

<EmptyState
  title="No customers yet"
  description="Create your first customer to start tracking opportunities."
/>`,
    },
    {
      id: 'with-actions',
      title: 'With icon and actions',
      render: () => (
        <div className="w-full max-w-md">
          <EmptyState
            icon={<Inbox className="size-8" />}
            title="No orders found"
            description="Orders will appear here once your storefront starts selling."
            actions={<Button size="sm">Create order</Button>}
          />
        </div>
      ),
      code: `import { Inbox } from 'lucide-react'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { Button } from '@open-mercato/ui/primitives/button'

<EmptyState
  icon={<Inbox className="size-8" />}
  title="No orders found"
  description="Orders will appear here once your storefront starts selling."
  actions={<Button size="sm">Create order</Button>}
/>`,
    },
    {
      id: 'subtle',
      title: 'subtle',
      render: () => (
        <div className="w-full max-w-md">
          <EmptyState
            variant="subtle"
            size="sm"
            icon={<Search className="size-5" />}
            title="No results"
            description="Try a different search term or clear the filters."
          />
        </div>
      ),
      code: `import { Search } from 'lucide-react'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'

<EmptyState
  variant="subtle"
  size="sm"
  icon={<Search className="size-5" />}
  title="No results"
  description="Try a different search term or clear the filters."
/>`,
    },
  ],
}

const skeletonEntry: GalleryEntry = {
  id: 'skeleton',
  title: 'Skeleton',
  importPath: '@open-mercato/ui/primitives/skeleton',
  variants: [
    {
      id: 'shapes',
      title: 'Shapes',
      render: () => (
        <div className="flex w-full max-w-md items-center gap-4">
          <Skeleton shape="circle" className="size-10" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 flex-1" />
        </div>
      ),
      code: `import { Skeleton } from '@open-mercato/ui/primitives/skeleton'

<Skeleton shape="circle" className="size-10" />
<Skeleton className="h-8 w-24" />
<Skeleton className="h-8 flex-1" />`,
    },
    {
      id: 'text-lines',
      title: 'Text lines',
      render: () => (
        <div className="w-full max-w-md">
          <Skeleton shape="text" lines={3} />
        </div>
      ),
      code: `import { Skeleton } from '@open-mercato/ui/primitives/skeleton'

<Skeleton shape="text" lines={3} />`,
    },
    {
      id: 'card-placeholder',
      title: 'Card placeholder',
      render: () => (
        <div className="flex w-full max-w-md items-start gap-3 rounded-lg border border-border p-4">
          <Skeleton shape="circle" className="size-12" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton shape="text" lines={2} />
          </div>
        </div>
      ),
      code: `import { Skeleton } from '@open-mercato/ui/primitives/skeleton'

<div className="flex items-start gap-3 rounded-lg border border-border p-4">
  <Skeleton shape="circle" className="size-12" />
  <div className="flex-1 space-y-2">
    <Skeleton className="h-4 w-1/3" />
    <Skeleton shape="text" lines={2} />
  </div>
</div>`,
    },
  ],
}

const progressEntry: GalleryEntry = {
  id: 'progress',
  title: 'Progress',
  importPath: '@open-mercato/ui/primitives/progress',
  variants: [
    {
      id: 'basic',
      title: 'Basic',
      render: () => (
        <div className="w-full max-w-md">
          <Progress value={50} />
        </div>
      ),
      code: `import { Progress } from '@open-mercato/ui/primitives/progress'

<Progress value={50} />`,
    },
    {
      id: 'labelled',
      title: 'Labelled',
      render: () => (
        <div className="w-full max-w-md">
          <Progress
            value={80}
            label="Data storage"
            showValue
            description="Upgrade to unlock unlimited storage."
          />
        </div>
      ),
      code: `import { Progress } from '@open-mercato/ui/primitives/progress'

<Progress
  value={80}
  label="Data storage"
  showValue
  description="Upgrade to unlock unlimited storage."
/>`,
    },
    {
      id: 'tones',
      title: 'Tones',
      render: () => (
        <div className="flex w-full max-w-md flex-col gap-3">
          <Progress value={42} tone="accent" />
          <Progress value={42} tone="success" />
          <Progress value={42} tone="warning" />
          <Progress value={42} tone="destructive" />
          <Progress value={42} tone="muted" />
        </div>
      ),
      code: `import { Progress } from '@open-mercato/ui/primitives/progress'

<Progress value={42} tone="accent" />
<Progress value={42} tone="success" />
<Progress value={42} tone="warning" />
<Progress value={42} tone="destructive" />
<Progress value={42} tone="muted" />`,
    },
    {
      id: 'circular',
      title: 'CircularProgress',
      render: () => (
        <>
          <CircularProgress value={75} size="lg" showValue />
          <CircularProgress value={75} size="default" showValue />
          <CircularProgress value={75} size="sm" />
          <CircularProgress value={75} size="xs" />
          <CircularProgress value={100} tone="success" showValue />
        </>
      ),
      code: `import { CircularProgress } from '@open-mercato/ui/primitives/progress'

<CircularProgress value={75} size="lg" showValue />
<CircularProgress value={75} size="default" showValue />
<CircularProgress value={75} size="sm" />
<CircularProgress value={75} size="xs" />
<CircularProgress value={100} tone="success" showValue />`,
    },
  ],
}

const spinnerEntry: GalleryEntry = {
  id: 'spinner',
  title: 'Spinner',
  importPath: '@open-mercato/ui/primitives/spinner',
  variants: [
    {
      id: 'sizes',
      title: 'Sizes',
      render: () => (
        <>
          <Spinner size="sm" />
          <Spinner size="md" />
          <Spinner size="lg" />
        </>
      ),
      code: `import { Spinner } from '@open-mercato/ui/primitives/spinner'

<Spinner size="sm" />
<Spinner size="md" />
<Spinner size="lg" />`,
    },
    {
      id: 'inline-with-label',
      title: 'Inline with label',
      render: () => (
        <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner size="sm" />
          Loading orders…
        </span>
      ),
      code: `import { Spinner } from '@open-mercato/ui/primitives/spinner'

<span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
  <Spinner size="sm" />
  Loading orders…
</span>`,
    },
  ],
}

function InteractiveRatingDemo() {
  const [value, setValue] = React.useState(3)
  return <Rating value={value} onChange={setValue} aria-label="Your rating" />
}

const ratingEntry: GalleryEntry = {
  id: 'rating',
  title: 'Rating',
  importPath: '@open-mercato/ui/primitives/rating',
  variants: [
    {
      id: 'read-only',
      title: 'Read-only',
      render: () => <Rating value={4} max={5} />,
      code: `import { Rating } from '@open-mercato/ui/primitives/rating'

<Rating value={4} max={5} />`,
    },
    {
      id: 'half-precision',
      title: 'Half precision',
      render: () => <Rating value={3.5} max={5} allowHalf />,
      code: `import { Rating } from '@open-mercato/ui/primitives/rating'

<Rating value={3.5} max={5} allowHalf />`,
    },
    {
      id: 'interactive',
      title: 'Interactive',
      render: () => <InteractiveRatingDemo />,
      code: `import { Rating } from '@open-mercato/ui/primitives/rating'

const [value, setValue] = React.useState(3)

<Rating value={value} onChange={setValue} aria-label="Your rating" />`,
    },
    {
      id: 'icons-and-sizes',
      title: 'Icons and sizes',
      render: () => (
        <>
          <Rating value={3} max={5} icon="heart" />
          <Rating value={3} max={5} icon="circle" size="sm" />
          <Rating value={3} max={5} size="lg" />
        </>
      ),
      code: `import { Rating } from '@open-mercato/ui/primitives/rating'

<Rating value={3} max={5} icon="heart" />
<Rating value={3} max={5} icon="circle" size="sm" />
<Rating value={3} max={5} size="lg" />`,
    },
  ],
}

const wizardSteps: StepIndicatorStep[] = [
  { id: 'account', label: 'Account', status: 'complete' },
  { id: 'profile', label: 'Profile', status: 'current' },
  { id: 'review', label: 'Review', status: 'pending' },
]

const verticalSteps: StepIndicatorStep[] = [
  { id: 'details', label: 'Store details', description: 'Name, currency, region', status: 'complete' },
  { id: 'payments', label: 'Payments', description: 'Connect a payment provider', status: 'current' },
  { id: 'shipping', label: 'Shipping', description: 'Zones and carriers', status: 'pending' },
]

const errorSteps: StepIndicatorStep[] = [
  { id: 'upload', label: 'Upload file', status: 'complete' },
  { id: 'validate', label: 'Validation', status: 'error' },
  { id: 'import', label: 'Import', status: 'pending' },
]

const stepIndicatorEntry: GalleryEntry = {
  id: 'step-indicator',
  title: 'StepIndicator',
  importPath: '@open-mercato/ui/primitives/step-indicator',
  variants: [
    {
      id: 'horizontal',
      title: 'Horizontal',
      render: () => <StepIndicator steps={wizardSteps} />,
      code: `import { StepIndicator, type StepIndicatorStep } from '@open-mercato/ui/primitives/step-indicator'

const steps: StepIndicatorStep[] = [
  { id: 'account', label: 'Account', status: 'complete' },
  { id: 'profile', label: 'Profile', status: 'current' },
  { id: 'review', label: 'Review', status: 'pending' },
]

<StepIndicator steps={steps} />`,
    },
    {
      id: 'vertical',
      title: 'Vertical with descriptions',
      render: () => (
        <div className="w-full max-w-xs">
          <StepIndicator steps={verticalSteps} orientation="vertical" />
        </div>
      ),
      code: `import { StepIndicator, type StepIndicatorStep } from '@open-mercato/ui/primitives/step-indicator'

const steps: StepIndicatorStep[] = [
  { id: 'details', label: 'Store details', description: 'Name, currency, region', status: 'complete' },
  { id: 'payments', label: 'Payments', description: 'Connect a payment provider', status: 'current' },
  { id: 'shipping', label: 'Shipping', description: 'Zones and carriers', status: 'pending' },
]

<StepIndicator steps={steps} orientation="vertical" />`,
    },
    {
      id: 'error-state',
      title: 'Error state',
      render: () => <StepIndicator steps={errorSteps} />,
      code: `import { StepIndicator, type StepIndicatorStep } from '@open-mercato/ui/primitives/step-indicator'

const steps: StepIndicatorStep[] = [
  { id: 'upload', label: 'Upload file', status: 'complete' },
  { id: 'validate', label: 'Validation', status: 'error' },
  { id: 'import', label: 'Import', status: 'pending' },
]

<StepIndicator steps={steps} />`,
    },
  ],
}

const notificationEntry: GalleryEntry = {
  id: 'notification',
  title: 'Notification',
  importPath: '@open-mercato/ui/primitives/notification',
  variants: [
    {
      id: 'information',
      title: 'Information',
      render: () => (
        <div className="w-full max-w-md">
          <Notification
            title="Scheduled maintenance"
            description="The admin panel will be read-only on Sunday between 02:00 and 04:00 UTC."
            timestamp="2 min ago"
          />
        </div>
      ),
      code: `import { Notification } from '@open-mercato/ui/primitives/notification'

<Notification
  title="Scheduled maintenance"
  description="The admin panel will be read-only on Sunday between 02:00 and 04:00 UTC."
  timestamp="2 min ago"
  onDismiss={() => dismiss(id)}
/>`,
    },
    {
      id: 'success-with-actions',
      title: 'Success with actions',
      render: () => (
        <div className="w-full max-w-md">
          <Notification
            status="success"
            title="Export ready"
            description="Your product export (1,204 rows) finished successfully."
            timestamp="just now"
            actions={
              <>
                <LinkButton variant="black" underline="always">Download</LinkButton>
                <LinkButton variant="gray" underline="always">View log</LinkButton>
              </>
            }
          />
        </div>
      ),
      code: `import { Notification } from '@open-mercato/ui/primitives/notification'
import { LinkButton } from '@open-mercato/ui/primitives/link-button'

<Notification
  status="success"
  title="Export ready"
  description="Your product export (1,204 rows) finished successfully."
  timestamp="just now"
  actions={
    <>
      <LinkButton variant="black" underline="always">Download</LinkButton>
      <LinkButton variant="gray" underline="always">View log</LinkButton>
    </>
  }
/>`,
    },
    {
      id: 'error',
      title: 'Error',
      render: () => (
        <div className="w-full max-w-md">
          <Notification
            status="error"
            title="Webhook delivery failed"
            description="The endpoint responded with 503 after 3 retries."
            timestamp="5 min ago"
            actions={<LinkButton variant="error" underline="always">Retry now</LinkButton>}
          />
        </div>
      ),
      code: `import { Notification } from '@open-mercato/ui/primitives/notification'
import { LinkButton } from '@open-mercato/ui/primitives/link-button'

<Notification
  status="error"
  title="Webhook delivery failed"
  description="The endpoint responded with 503 after 3 retries."
  timestamp="5 min ago"
  actions={<LinkButton variant="error" underline="always">Retry now</LinkButton>}
/>`,
    },
  ],
}

const notificationFeedEntry: GalleryEntry = {
  id: 'notification-feed',
  title: 'NotificationFeed',
  importPath: '@open-mercato/ui/primitives/notification-feed',
  variants: [
    {
      id: 'default',
      title: 'default',
      render: () => (
        <div className="w-full max-w-sm">
          <NotificationFeed>
            <NotificationFeedHeader title="Notifications">
              <IconButton size="sm" variant="ghost" aria-label="Notification settings">
                <Settings />
              </IconButton>
            </NotificationFeedHeader>
            <NotificationFeedList>
              <NotificationFeedItem
                icon={
                  <NotificationFeedIconBadge tone="indigo">
                    <UserPlus className="size-5" />
                  </NotificationFeedIconBadge>
                }
                title="New lead generated"
                body="John Smith submitted the contact form."
                timestamp="10 minutes ago"
                unread
              />
              <NotificationFeedItem
                icon={
                  <NotificationFeedIconBadge tone="success">
                    <RefreshCw className="size-5" />
                  </NotificationFeedIconBadge>
                }
                title="Catalog sync completed"
                body="312 products updated from the PIM."
                timestamp="1 hour ago"
              />
            </NotificationFeedList>
            <NotificationFeedFooter>
              <Button variant="outline" size="sm" className="w-full">Archive all</Button>
            </NotificationFeedFooter>
          </NotificationFeed>
        </div>
      ),
      code: `import { Settings, UserPlus } from 'lucide-react'
import {
  NotificationFeed,
  NotificationFeedFooter,
  NotificationFeedHeader,
  NotificationFeedIconBadge,
  NotificationFeedItem,
  NotificationFeedList,
} from '@open-mercato/ui/primitives/notification-feed'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'

<NotificationFeed>
  <NotificationFeedHeader title="Notifications">
    <IconButton size="sm" variant="ghost" aria-label="Notification settings">
      <Settings />
    </IconButton>
  </NotificationFeedHeader>
  <NotificationFeedList>
    <NotificationFeedItem
      icon={
        <NotificationFeedIconBadge tone="indigo">
          <UserPlus className="size-5" />
        </NotificationFeedIconBadge>
      }
      title="New lead generated"
      body="John Smith submitted the contact form."
      timestamp="10 minutes ago"
      unread
    />
  </NotificationFeedList>
  <NotificationFeedFooter>
    <Button variant="outline" size="sm" className="w-full">Archive all</Button>
  </NotificationFeedFooter>
</NotificationFeed>`,
    },
    {
      id: 'icon-badge-tones',
      title: 'NotificationFeedIconBadge tones',
      render: () => (
        <>
          <NotificationFeedIconBadge tone="indigo">
            <UserPlus className="size-5" />
          </NotificationFeedIconBadge>
          <NotificationFeedIconBadge tone="success">
            <RefreshCw className="size-5" />
          </NotificationFeedIconBadge>
          <NotificationFeedIconBadge tone="error">
            <Inbox className="size-5" />
          </NotificationFeedIconBadge>
          <NotificationFeedIconBadge tone="info">
            <Search className="size-5" />
          </NotificationFeedIconBadge>
          <NotificationFeedIconBadge tone="neutral">
            <Settings className="size-5" />
          </NotificationFeedIconBadge>
        </>
      ),
      code: `import { UserPlus } from 'lucide-react'
import { NotificationFeedIconBadge } from '@open-mercato/ui/primitives/notification-feed'

<NotificationFeedIconBadge tone="indigo"><UserPlus className="size-5" /></NotificationFeedIconBadge>
<NotificationFeedIconBadge tone="success"><RefreshCw className="size-5" /></NotificationFeedIconBadge>
<NotificationFeedIconBadge tone="error"><Inbox className="size-5" /></NotificationFeedIconBadge>
<NotificationFeedIconBadge tone="info"><Search className="size-5" /></NotificationFeedIconBadge>
<NotificationFeedIconBadge tone="neutral"><Settings className="size-5" /></NotificationFeedIconBadge>`,
    },
  ],
}

export const entries: GalleryEntry[] = [
  alertEntry,
  emptyStateEntry,
  skeletonEntry,
  progressEntry,
  spinnerEntry,
  ratingEntry,
  stepIndicatorEntry,
  notificationEntry,
  notificationFeedEntry,
]
