import { Banner } from '@open-mercato/ui/primitives/banner'
import * as React from 'react'
import { NotificationFeedExample } from '../demos/feeds'
import { notificationFeedExampleCode } from '../demos/feeds-code.generated'
import { Inbox, RefreshCw, Search, Settings, UserPlus } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { EmptyStateIllustration } from '@open-mercato/ui/primitives/empty-state-illustration'
import { Skeleton } from '@open-mercato/ui/primitives/skeleton'
import { CircularProgress, Progress } from '@open-mercato/ui/primitives/progress'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { RatingCellDemo, RatingReviewDemo } from '../demos/rating-reviews'
import { Rating } from '@open-mercato/ui/primitives/rating'
import { RatingBar, type RatingBarProps } from '@open-mercato/ui/primitives/rating-bar'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { StepIndicator, StepperDots, type StepIndicatorStep } from '@open-mercato/ui/primitives/step-indicator'
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


const bannerStatuses = ['error', 'warning', 'success', 'information', 'feature'] as const
function BannerExamples({ appearance, minimal = false }: { appearance: 'filled' | 'light' | 'lighter' | 'stroke'; minimal?: boolean }) {
  const t = useT()
  const [dismissed, setDismissed] = React.useState<string[]>([])
  const [details, setDetails] = React.useState(false)
  return <div className="w-full space-y-4">
    {bannerStatuses.filter(status => !dismissed.includes(status)).map(status => <Banner key={status} status={status} style={appearance} title={t('design_system.gallery.samples.banner.title')} description={minimal ? undefined : t('design_system.gallery.samples.banner.description')} showIcon={!minimal} onDismiss={minimal ? undefined : () => setDismissed(value => [...value, status])} action={minimal ? undefined : <Button variant="link" className="h-auto p-0 text-inherit underline" onClick={() => setDetails(value => !value)}>{t('design_system.gallery.samples.banner.details')}</Button>} />)}
    {details ? <p className="text-sm text-muted-foreground">{t('design_system.gallery.samples.banner.detailsBody')}</p> : null}
    {dismissed.length ? <Button variant="outline" size="sm" onClick={() => setDismissed([])}>{t('design_system.gallery.samples.banner.restore')}</Button> : null}
  </div>
}
function bannerExampleCode(appearance: 'filled' | 'light' | 'lighter' | 'stroke', minimal = false) {
  return `import * as React from 'react'
import { Banner } from '@open-mercato/ui/primitives/banner'
import { Button } from '@open-mercato/ui/primitives/button'

function Example() {
  const [dismissed, setDismissed] = React.useState<string[]>([])
  const [details, setDetails] = React.useState(false)
  return <div className="w-full space-y-4">
    {(['error', 'warning', 'success', 'information', 'feature'] as const).filter(status => !dismissed.includes(status)).map(status => (
      <Banner key={status} status={status} style="${appearance}" title="Workspace update"${minimal ? ' showIcon={false}' : ' description="Your team can review the latest changes." onDismiss={() => setDismissed(value => [...value, status])} action={<Button variant="link" className="h-auto p-0 text-inherit underline" onClick={() => setDetails(value => !value)}>View details</Button>}'} />
    ))}
    {details ? <p className="text-sm text-muted-foreground">This example changes local preview state.</p> : null}
    {dismissed.length ? <Button variant="outline" size="sm" onClick={() => setDismissed([])}>Restore banners</Button> : null}
  </div>
}`
}
const bannerEntry: GalleryEntry = {
  id: 'banner', title: 'Banner', importPath: '@open-mercato/ui/primitives/banner', figmaNodeId: '224:2249', docsAnchor: '#banner',
  variants: [
    { id: 'filled', title: '5 statuses / Filled', render: () => <BannerExamples appearance="filled" />, code: bannerExampleCode('filled') },
    { id: 'light', title: '5 statuses / Light', render: () => <BannerExamples appearance="light" />, code: bannerExampleCode('light') },
    { id: 'lighter', title: '5 statuses / Lighter', render: () => <BannerExamples appearance="lighter" />, code: bannerExampleCode('lighter') },
    { id: 'stroke', title: '5 statuses / Stroke', render: () => <BannerExamples appearance="stroke" />, code: bannerExampleCode('stroke') },
    { id: 'minimal', title: 'Title only', render: () => <BannerExamples appearance="lighter" minimal />, code: bannerExampleCode('lighter', true) },
  ],
}

function AlertSourceExamples({ size }: { size: 'xs' | 'sm' | 'default' }) {
  const t = useT()
  const [hidden, setHidden] = React.useState<string[]>([])
  const [details, setDetails] = React.useState(false)
  return <div className="grid w-full gap-5 lg:grid-cols-2">{(['filled', 'light', 'lighter', 'stroke'] as const).map(appearance => <div key={appearance} className="space-y-3">
    <p className="text-xs text-muted-foreground">{appearance}</p>
    {bannerStatuses.filter(status => !hidden.includes(`${appearance}-${status}`)).map(status => <Alert className="max-w-[390px]" key={status} status={status} style={appearance} size={size} dismissible onDismiss={() => setHidden(value => [...value, `${appearance}-${status}`])} dismissAriaLabel={t('ui.banner.dismiss', 'Dismiss banner')} action={size === 'default' ? undefined : <Button variant="link" className={size === 'xs' ? 'h-auto p-0 text-xs leading-4 text-inherit underline' : 'h-auto p-0 text-sm leading-5 text-inherit underline'} onClick={() => setDetails(value => !value)}>{t('design_system.gallery.samples.banner.details')}</Button>}
      footer={size === 'default' ? <><Button variant="link" className="h-auto p-0 text-inherit underline" onClick={() => setDetails(value => !value)}>{t('design_system.gallery.samples.banner.details')}</Button><span aria-hidden="true" className="opacity-50">∙</span><Button variant="link" className="h-auto p-0 text-inherit" onClick={() => setHidden(value => [...value, `${appearance}-${status}`])}>{t('ui.dialog.close.ariaLabel', 'Close')}</Button></> : undefined}>
      {size === 'default' ? <><AlertTitle>{t('design_system.gallery.samples.banner.title')}</AlertTitle><AlertDescription>{t('design_system.gallery.samples.overlay.description')}</AlertDescription></> : t('design_system.gallery.samples.banner.title')}
    </Alert>)}
  </div>)}
  {details ? <p role="status" className="text-sm text-muted-foreground">{t('design_system.gallery.samples.banner.detailsBody')}</p> : null}
  {hidden.length ? <Button variant="outline" size="sm" onClick={() => setHidden([])}>{t('design_system.gallery.samples.feeds.restore')}</Button> : null}</div>
}

function alertSourceCode(size: 'xs' | 'sm' | 'default') {
  return `import * as React from 'react'
import { Alert, AlertTitle, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'

function Example() {
  const [hidden, setHidden] = React.useState<string[]>([])
  const [details, setDetails] = React.useState(false)
  const statuses = ['error', 'warning', 'success', 'information', 'feature'] as const
  return <div className="grid w-full gap-5 lg:grid-cols-2">
    {(['filled', 'light', 'lighter', 'stroke'] as const).map(appearance => <div key={appearance} className="space-y-3">
      <p className="text-xs text-muted-foreground">{appearance}</p>
      {statuses.filter(status => !hidden.includes(appearance + '-' + status)).map(status => <Alert className="max-w-[390px]" key={status} status={status} style={appearance} size="${size}" dismissible onDismiss={() => setHidden(value => [...value, appearance + '-' + status])}
        ${size === 'default' ? 'footer' : 'action'}={<Button variant="link" className="h-auto p-0 ${size === 'xs' ? 'text-xs leading-4' : 'text-sm leading-5'} text-inherit underline" onClick={() => setDetails(value => !value)}>View details</Button>}>
        ${size === 'default' ? '<AlertTitle>Workspace update</AlertTitle><AlertDescription>Choose how these changes apply to your workspace.</AlertDescription>' : 'Workspace update'}
      </Alert>)}
    </div>)}
    {details ? <p role="status">This example changes local preview state.</p> : null}
    {hidden.length ? <Button size="sm" variant="outline" onClick={() => setHidden([])}>Restore examples</Button> : null}
  </div>
}`
}

const alertEntry: GalleryEntry = {
  id: 'alert',
  figmaNodeId: '169:2399',
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
    { id: 'source-xs', title: '20 status/style combinations / 32px', render: () => <AlertSourceExamples size="xs" />, code: alertSourceCode('xs') },
    { id: 'source-sm', title: '20 status/style combinations / 36px', render: () => <AlertSourceExamples size="sm" />, code: alertSourceCode('sm') },
    { id: 'source-large', title: '20 status/style combinations / large', render: () => <AlertSourceExamples size="default" />, code: alertSourceCode('default') },
    {
      id: 'statuses-light',
      title: 'Statuses (light)',
      render: () => <AlertFeedbackStatusesLightSample />,
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
      render: () => <AlertFeedbackFilledSample />,
      code: `import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'

<Alert status="error" style="filled" size="default">
  <AlertTitle>Import failed</AlertTitle>
  <AlertDescription>14 rows were rejected — download the error report to review them.</AlertDescription>
</Alert>`,
    },
    {
      id: 'stroke',
      title: 'stroke',
      render: () => <AlertFeedbackStrokeSample />,
      code: `import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'

<Alert status="success" style="stroke" size="default">
  <AlertTitle>Backup complete</AlertTitle>
  <AlertDescription>The nightly snapshot finished without warnings.</AlertDescription>
</Alert>`,
    },
    {
      id: 'sizes',
      title: 'Sizes',
      render: () => <AlertFeedbackSizesSample />,
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
      render: () => <AlertFeedbackDismissibleWithActionSample />,
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
      id: 'source-illustration', title: 'Open Mercato',
      render: () => <IllustratedEmptyStateExample />,
      code: `import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { EmptyStateIllustration } from '@open-mercato/ui/primitives/empty-state-illustration'
import { useT } from '@open-mercato/shared/lib/i18n/context'

function RecordsEmptyState() {
  const t = useT()
  return <EmptyState
    variant="subtle"
    title={t('design_system.gallery.samples.emptyArtwork.records.title')}
    description={t('design_system.gallery.samples.emptyArtwork.records.description')}
    illustration={<EmptyStateIllustration kind="mercato-records" />}
  />
}`,
    },
    {
      id: 'default',
      title: 'default',
      render: () => <EmptyStateFeedbackDefaultSample />,
      code: `import { EmptyState } from '@open-mercato/ui/primitives/empty-state'

<EmptyState
  title="No customers yet"
  description="Create your first customer to start tracking opportunities."
/>`,
    },
    {
      id: 'with-actions',
      title: 'With icon and actions',
      render: () => <EmptyStateFeedbackWithActionsSample />,
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
      render: () => <EmptyStateFeedbackSubtleSample />,
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

function IllustratedEmptyStateExample() {
  const t = useT()
  return <EmptyState
    variant="subtle"
    title={t('design_system.gallery.samples.emptyArtwork.records.title')}
    description={t('design_system.gallery.samples.emptyArtwork.records.description')}
    illustration={<EmptyStateIllustration kind="mercato-records" />}
  />
}

const emptyArtworkSubjects = ['records', 'search', 'files', 'messages'] as const

function EmptyIllustrationsExample() {
  const t = useT()
  return <div className="grid w-full grid-cols-1 gap-6 lg:grid-cols-2">
    {emptyArtworkSubjects.map(subject => <EmptyState
      key={subject}
      variant="subtle"
      className="min-w-0 border border-border bg-background"
      title={t(`design_system.gallery.samples.emptyArtwork.${subject}.title`)}
      description={t(`design_system.gallery.samples.emptyArtwork.${subject}.description`)}
      illustration={<EmptyStateIllustration kind={`mercato-${subject}`} />}
    />)}
  </div>
}

const emptyStateIllustrationEntry: GalleryEntry = {
  id: 'empty-state-illustration',
  title: 'EmptyStateIllustration',
  importPath: '@open-mercato/ui/primitives/empty-state-illustration',
  variants: [
    {
      id: 'mercato',
      title: 'Open Mercato',
      render: () => <EmptyIllustrationsExample />,
      code: `import { EmptyStateIllustration } from '@open-mercato/ui/primitives/empty-state-illustration'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const subjects = ['records', 'search', 'files', 'messages'] as const

function EmptyStateCollection() {
  const t = useT()
  return <div className="grid w-full grid-cols-1 gap-6 lg:grid-cols-2">
    {subjects.map(subject => <EmptyState
      key={subject}
      variant="subtle"
      className="min-w-0 border border-border bg-background"
      title={t(\`design_system.gallery.samples.emptyArtwork.\${subject}.title\`)}
      description={t(\`design_system.gallery.samples.emptyArtwork.\${subject}.description\`)}
      illustration={<EmptyStateIllustration kind={\`mercato-\${subject}\`} />}
    />)}
  </div>
}`,
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

function CircularSourceDemo() {
  const t = useT()
  return (
    <div className="flex w-full flex-col gap-6">
      {([48, 56, 64, 72, 80] as const).map((size) => (
        <div key={size} className="flex flex-wrap items-center gap-4">
          <span className="w-12 text-xs text-muted-foreground">{size}px</span>
          {[0, 25, 50, 75, 100].map((value) => (
            <CircularProgress key={value} value={value} size={size} showValue={size !== 48} ariaLabel={t('design_system.gallery.examples.navigation.progress')} />
          ))}
        </div>
      ))}
      <p className="text-sm text-muted-foreground">{t('design_system.gallery.examples.navigation.circularHint')}</p>
    </div>
  )
}

function ProgressLabelDemo() {
  const t = useT()
  const label = t('design_system.gallery.examples.controls.storage')
  return <div className="flex w-full max-w-md flex-col gap-6">
    <Progress value={80} size="md" label={label} aria-label={label} showValue description={t('design_system.gallery.examples.controls.storageHint')} />
    <Progress value={80} size="md" label={label} aria-label={label} showValue />
    <Progress value={80} size="md" aria-label={label} showValue valuePlacement="right" />
  </div>
}

function ProgressEndpointDemo() {
  const t = useT()
  return <div className="flex w-full max-w-md flex-col gap-4">
    {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(value => <Progress key={value} value={value} size="md" showValue valuePlacement="right" aria-label={t('design_system.gallery.examples.controls.storage')} />)}
  </div>
}

const progressEntry: GalleryEntry = {
  id: 'progress',
  title: 'Progress',
  figmaNodeId: '450:17821',
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
      render: () => <ProgressFeedbackLabelledSample />,
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
    {
      id: 'circular-source-sizes',
      title: 'Circular source sizes · 25 states',
      render: () => <CircularSourceDemo />,
      code: `import { CircularProgress } from '@open-mercato/ui/primitives/progress'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const t = useT()

{([48, 56, 64, 72, 80] as const).map((size) => (
  <div key={size} className="flex flex-wrap items-center gap-4">
    <span>{size}px</span>
    {[0, 25, 50, 75, 100].map((value) => (
      <CircularProgress key={value} value={value} size={size} showValue={size !== 48} ariaLabel={t('design_system.gallery.examples.navigation.progress')} />
    ))}
  </div>
))}`,
    },
    {
      id: 'label-positions',
      title: 'Label positions · top / description / right',
      render: () => <ProgressLabelDemo />,
      code: `import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Progress } from '@open-mercato/ui/primitives/progress'

function ProgressLabelDemo() {
  const t = useT()
  const label = t('design_system.gallery.examples.controls.storage')
  return <div className="flex w-full max-w-md flex-col gap-6">
    <Progress value={80} size="md" label={label} aria-label={label} showValue description={t('design_system.gallery.examples.controls.storageHint')} />
    <Progress value={80} size="md" label={label} aria-label={label} showValue />
    <Progress value={80} size="md" aria-label={label} showValue valuePlacement="right" />
  </div>
}


<ProgressLabelDemo />`,
    },
    {
      id: 'endpoints',
      title: 'Linear values · 0 to 100',
      render: () => <ProgressEndpointDemo />,
      code: `import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Progress } from '@open-mercato/ui/primitives/progress'

function ProgressEndpointDemo() {
  const t = useT()
  return <div className="flex w-full max-w-md flex-col gap-4">
    {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(value => <Progress key={value} value={value} size="md" showValue valuePlacement="right" aria-label={t('design_system.gallery.examples.controls.storage')} />)}
  </div>
}

<ProgressEndpointDemo />`,
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
      render: () => <SpinnerFeedbackInlineWithLabelSample />,
      code: `import { Spinner } from '@open-mercato/ui/primitives/spinner'

<span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
  <Spinner size="sm" />
  Loading orders…
</span>`,
    },
  ],
}

function InteractiveRatingDemo({ allowHalf = false }: { allowHalf?: boolean }) {
  const t = useT()
  const [value, setValue] = React.useState(3)
  return <Rating value={value} onChange={setValue} allowHalf={allowHalf} aria-label={t('design_system.gallery.samples.rating.label')} />
}

const ratingEntry: GalleryEntry = {
  id: 'rating',
  title: 'Rating',
  importPath: '@open-mercato/ui/primitives/rating',
  figmaNodeId: '532:4340',
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
import { useT } from '@open-mercato/shared/lib/i18n/context'

const t = useT()
const [value, setValue] = React.useState(3)

<Rating value={value} onChange={setValue} aria-label={t('design_system.gallery.samples.rating.label')} />`,
    },
    {
      id: 'half-heart',
      title: 'Heart / half precision',
      render: () => <Rating value={3.5} icon="heart" allowHalf />,
      code: `import { Rating } from '@open-mercato/ui/primitives/rating'

<Rating value={3.5} icon="heart" allowHalf />`,
    },
    {
      id: 'interactive-half',
      title: 'Interactive / half precision',
      render: () => <InteractiveRatingDemo allowHalf />,
      code: `import { Rating } from '@open-mercato/ui/primitives/rating'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const t = useT()
const [value, setValue] = React.useState(3)

<Rating value={value} onChange={setValue} allowHalf aria-label={t('design_system.gallery.samples.rating.label')} />`,
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
    {
      id: 'cell-star-default', title: 'Cell / star / default and live hover',
      render: () => <RatingCellDemo icon="star" initialValue={0} />,
      code: `import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Rating } from '@open-mercato/ui/primitives/rating'

function RatingCellExample() {
  const t = useT()
  const [value, setValue] = React.useState(0)
  return <Rating appearance="cell" icon="star" value={value} onChange={setValue} max={1} aria-label={t('design_system.gallery.samples.rating.label')} />
}

<RatingCellExample />`,
    },
    {
      id: 'cell-star-selected', title: 'Cell / star / selected and live hover',
      render: () => <RatingCellDemo icon="star" initialValue={1} />,
      code: `import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Rating } from '@open-mercato/ui/primitives/rating'

function RatingCellExample() {
  const t = useT()
  const [value, setValue] = React.useState(1)
  return <Rating appearance="cell" icon="star" value={value} onChange={setValue} max={1} aria-label={t('design_system.gallery.samples.rating.label')} />
}

<RatingCellExample />`,
    },
    {
      id: 'cell-heart-default', title: 'Cell / heart / default and live hover',
      render: () => <RatingCellDemo icon="heart" initialValue={0} />,
      code: `import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Rating } from '@open-mercato/ui/primitives/rating'

function RatingCellExample() {
  const t = useT()
  const [value, setValue] = React.useState(0)
  return <Rating appearance="cell" icon="heart" value={value} onChange={setValue} max={1} aria-label={t('design_system.gallery.samples.rating.label')} />
}

<RatingCellExample />`,
    },
    {
      id: 'cell-heart-selected', title: 'Cell / heart / selected and live hover',
      render: () => <RatingCellDemo icon="heart" initialValue={1} />,
      code: `import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Rating } from '@open-mercato/ui/primitives/rating'

function RatingCellExample() {
  const t = useT()
  const [value, setValue] = React.useState(1)
  return <Rating appearance="cell" icon="heart" value={value} onChange={setValue} max={1} aria-label={t('design_system.gallery.samples.rating.label')} />
}

<RatingCellExample />`,
    },
    {
      id: 'cells-interactive', title: 'Cells / keyboard selection',
      render: () => <RatingCellDemo icon="star" initialValue={3} max={5} />,
      code: `import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Rating } from '@open-mercato/ui/primitives/rating'

function RatingCellsExample() {
  const t = useT()
  const [value, setValue] = React.useState(3)
  return <Rating appearance="cell" value={value} onChange={setValue} max={5} aria-label={t('design_system.gallery.samples.rating.label')} />
}

<RatingCellsExample />`,
    },
    {
      id: 'cells-disabled', title: 'Cells / disabled',
      render: () => <RatingCellDemo icon="star" initialValue={3} max={5} disabled />,
      code: `import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Rating } from '@open-mercato/ui/primitives/rating'

function RatingCellsExample() {
  const t = useT()
  const [value, setValue] = React.useState(3)
  return <Rating appearance="cell" value={value} onChange={setValue} max={5} disabled aria-label={t('design_system.gallery.samples.rating.label')} />
}

<RatingCellsExample />`,
    },
    {
      id: 'review-star-vertical', title: 'Review / star / vertical',
      render: () => <RatingReviewDemo icon="star" alignment="vertical" />,
      code: `import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { Rating } from '@open-mercato/ui/primitives/rating'
import { LinkButton } from '@open-mercato/ui/primitives/link-button'
import { Button } from '@open-mercato/ui/primitives/button'
import { ScrollArea } from '@open-mercato/ui/primitives/scroll-area'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@open-mercato/ui/primitives/dialog'

function RatingReviewExample({ icon, alignment }: { icon: 'star' | 'heart'; alignment: 'vertical' | 'horizontal' }) {
  const t = useT()
  const locale = useLocale()
  const [open, setOpen] = React.useState(false)
  const value = new Intl.NumberFormat(locale).format(4.5)
  const count = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(5200)
  const summary = t('design_system.gallery.samples.rating.summary', '{value} ∙ {count} Ratings', { value, count })
  const reviews = t('design_system.gallery.samples.rating.reviews', '{count} reviews', { count: 18 })
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div data-slot="rating-review" data-alignment={alignment} className={cn('inline-flex max-w-full items-start gap-2', alignment === 'vertical' ? 'flex-col' : 'flex-wrap')}>
        <Rating value={4.5} allowHalf icon={icon} />
        <div className="flex flex-wrap items-start gap-1 text-sm leading-5">
          <span>{summary}</span>
          <LinkButton asChild variant="gray" underline="always"><DialogTrigger>{reviews}</DialogTrigger></LinkButton>
        </div>
      </div>
      <DialogContent onKeyDownCapture={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); setOpen(false) } }}>
        <DialogHeader><DialogTitle>{reviews}</DialogTitle><DialogDescription>{summary}</DialogDescription></DialogHeader>
        <ScrollArea className="h-72" scrollbarSize="md">
          <ol className="flex flex-col gap-3 pr-6">
            {Array.from({ length: 18 }, (_, index) => <li key={index} className="flex items-center justify-between gap-3 text-sm"><span>{t('design_system.gallery.samples.rating.reviewNumber', 'Review {number}', { number: index + 1 })}</span><Rating value={index < 9 ? 5 : 4} icon={icon} /></li>)}
          </ol>
        </ScrollArea>
        <DialogFooter><Button asChild variant="outline"><DialogClose>{t('common.close')}</DialogClose></Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

<RatingReviewExample icon="star" alignment="vertical" />`,
    },
    {
      id: 'review-star-horizontal', title: 'Review / star / horizontal',
      render: () => <RatingReviewDemo icon="star" alignment="horizontal" />,
      code: `import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { Rating } from '@open-mercato/ui/primitives/rating'
import { LinkButton } from '@open-mercato/ui/primitives/link-button'
import { Button } from '@open-mercato/ui/primitives/button'
import { ScrollArea } from '@open-mercato/ui/primitives/scroll-area'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@open-mercato/ui/primitives/dialog'

function RatingReviewExample({ icon, alignment }: { icon: 'star' | 'heart'; alignment: 'vertical' | 'horizontal' }) {
  const t = useT()
  const locale = useLocale()
  const [open, setOpen] = React.useState(false)
  const value = new Intl.NumberFormat(locale).format(4.5)
  const count = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(5200)
  const summary = t('design_system.gallery.samples.rating.summary', '{value} ∙ {count} Ratings', { value, count })
  const reviews = t('design_system.gallery.samples.rating.reviews', '{count} reviews', { count: 18 })
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div data-slot="rating-review" data-alignment={alignment} className={cn('inline-flex max-w-full items-start gap-2', alignment === 'vertical' ? 'flex-col' : 'flex-wrap')}>
        <Rating value={4.5} allowHalf icon={icon} />
        <div className="flex flex-wrap items-start gap-1 text-sm leading-5">
          <span>{summary}</span>
          <LinkButton asChild variant="gray" underline="always"><DialogTrigger>{reviews}</DialogTrigger></LinkButton>
        </div>
      </div>
      <DialogContent onKeyDownCapture={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); setOpen(false) } }}>
        <DialogHeader><DialogTitle>{reviews}</DialogTitle><DialogDescription>{summary}</DialogDescription></DialogHeader>
        <ScrollArea className="h-72" scrollbarSize="md">
          <ol className="flex flex-col gap-3 pr-6">
            {Array.from({ length: 18 }, (_, index) => <li key={index} className="flex items-center justify-between gap-3 text-sm"><span>{t('design_system.gallery.samples.rating.reviewNumber', 'Review {number}', { number: index + 1 })}</span><Rating value={index < 9 ? 5 : 4} icon={icon} /></li>)}
          </ol>
        </ScrollArea>
        <DialogFooter><Button asChild variant="outline"><DialogClose>{t('common.close')}</DialogClose></Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

<RatingReviewExample icon="star" alignment="horizontal" />`,
    },
    {
      id: 'review-heart-vertical', title: 'Review / heart / vertical',
      render: () => <RatingReviewDemo icon="heart" alignment="vertical" />,
      code: `import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { Rating } from '@open-mercato/ui/primitives/rating'
import { LinkButton } from '@open-mercato/ui/primitives/link-button'
import { Button } from '@open-mercato/ui/primitives/button'
import { ScrollArea } from '@open-mercato/ui/primitives/scroll-area'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@open-mercato/ui/primitives/dialog'

function RatingReviewExample({ icon, alignment }: { icon: 'star' | 'heart'; alignment: 'vertical' | 'horizontal' }) {
  const t = useT()
  const locale = useLocale()
  const [open, setOpen] = React.useState(false)
  const value = new Intl.NumberFormat(locale).format(4.5)
  const count = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(5200)
  const summary = t('design_system.gallery.samples.rating.summary', '{value} ∙ {count} Ratings', { value, count })
  const reviews = t('design_system.gallery.samples.rating.reviews', '{count} reviews', { count: 18 })
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div data-slot="rating-review" data-alignment={alignment} className={cn('inline-flex max-w-full items-start gap-2', alignment === 'vertical' ? 'flex-col' : 'flex-wrap')}>
        <Rating value={4.5} allowHalf icon={icon} />
        <div className="flex flex-wrap items-start gap-1 text-sm leading-5">
          <span>{summary}</span>
          <LinkButton asChild variant="gray" underline="always"><DialogTrigger>{reviews}</DialogTrigger></LinkButton>
        </div>
      </div>
      <DialogContent onKeyDownCapture={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); setOpen(false) } }}>
        <DialogHeader><DialogTitle>{reviews}</DialogTitle><DialogDescription>{summary}</DialogDescription></DialogHeader>
        <ScrollArea className="h-72" scrollbarSize="md">
          <ol className="flex flex-col gap-3 pr-6">
            {Array.from({ length: 18 }, (_, index) => <li key={index} className="flex items-center justify-between gap-3 text-sm"><span>{t('design_system.gallery.samples.rating.reviewNumber', 'Review {number}', { number: index + 1 })}</span><Rating value={index < 9 ? 5 : 4} icon={icon} /></li>)}
          </ol>
        </ScrollArea>
        <DialogFooter><Button asChild variant="outline"><DialogClose>{t('common.close')}</DialogClose></Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

<RatingReviewExample icon="heart" alignment="vertical" />`,
    },
    {
      id: 'review-heart-horizontal', title: 'Review / heart / horizontal',
      render: () => <RatingReviewDemo icon="heart" alignment="horizontal" />,
      code: `import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { Rating } from '@open-mercato/ui/primitives/rating'
import { LinkButton } from '@open-mercato/ui/primitives/link-button'
import { Button } from '@open-mercato/ui/primitives/button'
import { ScrollArea } from '@open-mercato/ui/primitives/scroll-area'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@open-mercato/ui/primitives/dialog'

function RatingReviewExample({ icon, alignment }: { icon: 'star' | 'heart'; alignment: 'vertical' | 'horizontal' }) {
  const t = useT()
  const locale = useLocale()
  const [open, setOpen] = React.useState(false)
  const value = new Intl.NumberFormat(locale).format(4.5)
  const count = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(5200)
  const summary = t('design_system.gallery.samples.rating.summary', '{value} ∙ {count} Ratings', { value, count })
  const reviews = t('design_system.gallery.samples.rating.reviews', '{count} reviews', { count: 18 })
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div data-slot="rating-review" data-alignment={alignment} className={cn('inline-flex max-w-full items-start gap-2', alignment === 'vertical' ? 'flex-col' : 'flex-wrap')}>
        <Rating value={4.5} allowHalf icon={icon} />
        <div className="flex flex-wrap items-start gap-1 text-sm leading-5">
          <span>{summary}</span>
          <LinkButton asChild variant="gray" underline="always"><DialogTrigger>{reviews}</DialogTrigger></LinkButton>
        </div>
      </div>
      <DialogContent onKeyDownCapture={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); setOpen(false) } }}>
        <DialogHeader><DialogTitle>{reviews}</DialogTitle><DialogDescription>{summary}</DialogDescription></DialogHeader>
        <ScrollArea className="h-72" scrollbarSize="md">
          <ol className="flex flex-col gap-3 pr-6">
            {Array.from({ length: 18 }, (_, index) => <li key={index} className="flex items-center justify-between gap-3 text-sm"><span>{t('design_system.gallery.samples.rating.reviewNumber', 'Review {number}', { number: index + 1 })}</span><Rating value={index < 9 ? 5 : 4} icon={icon} /></li>)}
          </ol>
        </ScrollArea>
        <DialogFooter><Button asChild variant="outline"><DialogClose>{t('common.close')}</DialogClose></Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

<RatingReviewExample icon="heart" alignment="horizontal" />`,
    },
  ],
}

function RatingBarDemo({ variant = 'emoji', initialValue = 0, disabled = false, feedback = false }: { variant?: RatingBarProps['variant']; initialValue?: number; disabled?: boolean; feedback?: boolean }) {
  const t = useT()
  const [value, setValue] = React.useState(initialValue)
  const bar = <RatingBar variant={variant} value={value} onChange={setValue} disabled={disabled} aria-label={t('design_system.gallery.samples.rating.label')} className={feedback ? 'w-full border-0 border-b' : undefined} />
  return feedback ? (
    <div className="w-80 max-w-full overflow-hidden rounded-xl border border-border bg-background focus-within:shadow-focus">
      {bar}
      <Textarea aria-label={t('design_system.gallery.samples.rating.feedback')} placeholder={t('design_system.gallery.samples.rating.feedback')} disabled={disabled} className="min-h-24 resize-none rounded-none border-0 p-3 shadow-none focus-visible:shadow-none" />
    </div>
  ) : bar
}

const ratingBarEntry: GalleryEntry = {
  id: 'rating-bar',
  title: 'RatingBar',
  importPath: '@open-mercato/ui/primitives/rating-bar',
  figmaNodeId: '535:4658',
  usage: {
    do: ['Use the five-part feedback scale with a translated group label.', 'The feedback-area composition joins the scale to a Textarea and keeps both controls independently accessible.'],
    dont: ['Do not use this feedback scale for unrelated actions; use ButtonGroup for actions.'],
  },
  variants: [
    {
      id: 'emoji',
      title: 'emoji / unselected',
      render: () => <RatingBarDemo variant="emoji" />,
      code: `import { RatingBar } from '@open-mercato/ui/primitives/rating-bar'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const t = useT()
const [value, setValue] = React.useState(0)

<RatingBar variant="emoji" value={value} onChange={setValue} aria-label={t('design_system.gallery.samples.rating.label')} />`,
    },
    {
      id: 'emoji-selected',
      title: 'emoji / selected',
      render: () => <RatingBarDemo variant="emoji" initialValue={4} />,
      code: `import { RatingBar } from '@open-mercato/ui/primitives/rating-bar'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const t = useT()
const [value, setValue] = React.useState(4)

<RatingBar variant="emoji" value={value} onChange={setValue} aria-label={t('design_system.gallery.samples.rating.label')} />`,
    },
    {
      id: 'number',
      title: 'number / unselected',
      render: () => <RatingBarDemo variant="number" />,
      code: `import { RatingBar } from '@open-mercato/ui/primitives/rating-bar'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const t = useT()
const [value, setValue] = React.useState(0)

<RatingBar variant="number" value={value} onChange={setValue} aria-label={t('design_system.gallery.samples.rating.label')} />`,
    },
    {
      id: 'number-selected',
      title: 'number / selected',
      render: () => <RatingBarDemo variant="number" initialValue={4} />,
      code: `import { RatingBar } from '@open-mercato/ui/primitives/rating-bar'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const t = useT()
const [value, setValue] = React.useState(4)

<RatingBar variant="number" value={value} onChange={setValue} aria-label={t('design_system.gallery.samples.rating.label')} />`,
    },
    {
      id: 'star',
      title: 'star / unselected',
      render: () => <RatingBarDemo variant="star" />,
      code: `import { RatingBar } from '@open-mercato/ui/primitives/rating-bar'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const t = useT()
const [value, setValue] = React.useState(0)

<RatingBar variant="star" value={value} onChange={setValue} aria-label={t('design_system.gallery.samples.rating.label')} />`,
    },
    {
      id: 'star-selected',
      title: 'star / selected',
      render: () => <RatingBarDemo variant="star" initialValue={4} />,
      code: `import { RatingBar } from '@open-mercato/ui/primitives/rating-bar'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const t = useT()
const [value, setValue] = React.useState(4)

<RatingBar variant="star" value={value} onChange={setValue} aria-label={t('design_system.gallery.samples.rating.label')} />`,
    },
    {
      id: 'heart',
      title: 'heart / unselected',
      render: () => <RatingBarDemo variant="heart" />,
      code: `import { RatingBar } from '@open-mercato/ui/primitives/rating-bar'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const t = useT()
const [value, setValue] = React.useState(0)

<RatingBar variant="heart" value={value} onChange={setValue} aria-label={t('design_system.gallery.samples.rating.label')} />`,
    },
    {
      id: 'heart-selected',
      title: 'heart / selected',
      render: () => <RatingBarDemo variant="heart" initialValue={4} />,
      code: `import { RatingBar } from '@open-mercato/ui/primitives/rating-bar'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const t = useT()
const [value, setValue] = React.useState(4)

<RatingBar variant="heart" value={value} onChange={setValue} aria-label={t('design_system.gallery.samples.rating.label')} />`,
    },
    {
      id: 'feedback-area',
      title: 'Feedback area / all types',
      render: () => (
        <div className="flex w-full flex-wrap gap-6">
          <RatingBarDemo variant="emoji" feedback />
          <RatingBarDemo variant="number" feedback />
          <RatingBarDemo variant="star" feedback />
          <RatingBarDemo variant="heart" feedback />
        </div>
      ),
      code: `import { RatingBar, type RatingBarProps } from '@open-mercato/ui/primitives/rating-bar'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { useT } from '@open-mercato/shared/lib/i18n/context'

function RatingFeedback({ variant }: { variant: RatingBarProps['variant'] }) {
  const t = useT()
  const [value, setValue] = React.useState(0)
  return (
    <div className="w-80 max-w-full overflow-hidden rounded-xl border border-border bg-background focus-within:shadow-focus">
      <RatingBar variant={variant} value={value} onChange={setValue} aria-label={t('design_system.gallery.samples.rating.label')} className="w-full border-0 border-b" />
      <Textarea aria-label={t('design_system.gallery.samples.rating.feedback')} placeholder={t('design_system.gallery.samples.rating.feedback')} className="min-h-24 resize-none rounded-none border-0 p-3 shadow-none focus-visible:shadow-none" />
    </div>
  )
}

<div className="flex w-full flex-wrap gap-6">
  <RatingFeedback variant="emoji" />
  <RatingFeedback variant="number" />
  <RatingFeedback variant="star" />
  <RatingFeedback variant="heart" />
</div>`,
    },
    {
      id: 'disabled',
      title: 'Disabled / all types',
      render: () => (
        <div className="flex w-full flex-wrap gap-6">
          <RatingBarDemo variant="emoji" initialValue={4} disabled />
          <RatingBarDemo variant="number" initialValue={4} disabled />
          <RatingBarDemo variant="star" initialValue={4} disabled />
          <RatingBarDemo variant="heart" initialValue={4} disabled />
        </div>
      ),
      code: `import { RatingBar } from '@open-mercato/ui/primitives/rating-bar'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const t = useT()
const [value, setValue] = React.useState(4)

<div className="flex w-full flex-wrap gap-6">
  <RatingBar variant="emoji" value={value} onChange={setValue} disabled aria-label={t('design_system.gallery.samples.rating.label')} />
  <RatingBar variant="number" value={value} onChange={setValue} disabled aria-label={t('design_system.gallery.samples.rating.label')} />
  <RatingBar variant="star" value={value} onChange={setValue} disabled aria-label={t('design_system.gallery.samples.rating.label')} />
  <RatingBar variant="heart" value={value} onChange={setValue} disabled aria-label={t('design_system.gallery.samples.rating.label')} />
</div>`,
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

function StepQuantityDemo({ orientation }: { orientation: 'horizontal' | 'vertical' }) {
  const t = useT()
  return (
    <div className={orientation === 'vertical' ? 'grid w-full gap-6 md:grid-cols-3' : 'flex w-full flex-col gap-6 overflow-x-auto'}>
      {[3, 4, 5].map((count) => (
        <StepIndicator key={count} showNumbers orientation={orientation} steps={Array.from({ length: count }, (_, index) => ({
          id: String(index),
          label: t('design_system.gallery.examples.navigation.step', { step: index + 1 }),
          status: index === 0 ? 'complete' : index === 1 ? 'current' : 'pending',
        }))} />
      ))}
    </div>
  )
}

function StepInteractiveDemo() {
  const t = useT()
  const [activeStep, setActiveStep] = React.useState(1)
  const steps: StepIndicatorStep[] = Array.from({ length: 5 }, (_, index) => ({
    id: String(index),
    label: t('design_system.gallery.examples.navigation.step', { step: index + 1 }),
    status: index < activeStep ? 'complete' : index === activeStep ? 'current' : 'pending',
  }))
  return (
    <div className="flex w-full flex-col gap-4">
      <div className="overflow-x-auto p-1"><StepIndicator steps={steps} showNumbers onStepClick={(id) => setActiveStep(Number(id))} /></div>
      <StepperDots count={5} activeStep={activeStep} aria-label={t('design_system.gallery.examples.navigation.progress')} />
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={activeStep === 0} onClick={() => setActiveStep((value) => value - 1)}>{t('design_system.gallery.examples.navigation.previous')}</Button>
        <Button variant="outline" size="sm" disabled={activeStep === 4} onClick={() => setActiveStep((value) => value + 1)}>{t('design_system.gallery.examples.navigation.next')}</Button>
      </div>
    </div>
  )
}

function StepperDotsDemo() {
  const t = useT()
  return (
    <div className="flex flex-wrap gap-8">
      {(['sm', 'xs'] as const).map((size) => (
        <div key={size} className="flex flex-col gap-4">
          <span className="text-xs text-muted-foreground">{size}</span>
          {[0, 1, 2].map((activeStep) => <StepperDots key={activeStep} count={3} activeStep={activeStep} size={size} aria-label={t('design_system.gallery.examples.navigation.progress')} />)}
        </div>
      ))}
    </div>
  )
}

const stepIndicatorEntry: GalleryEntry = {
  id: 'step-indicator',
  title: 'StepIndicator',
  figmaNodeId: '3507:28',
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
    {
      id: 'horizontal-quantities',
      title: 'horizontal · 3, 4, 5 steps',
      render: () => <StepQuantityDemo orientation="horizontal" />,
      code: `import { StepIndicator } from '@open-mercato/ui/primitives/step-indicator'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const t = useT()

{[3, 4, 5].map((count) => (
  <StepIndicator key={count} showNumbers orientation="horizontal" steps={Array.from({ length: count }, (_, index) => ({
    id: String(index),
    label: t('design_system.gallery.examples.navigation.step', { step: index + 1 }),
    status: index === 0 ? 'complete' : index === 1 ? 'current' : 'pending',
  }))} />
))}`,
    },
    {
      id: 'vertical-quantities',
      title: 'vertical · 3, 4, 5 steps',
      render: () => <StepQuantityDemo orientation="vertical" />,
      code: `import { StepIndicator } from '@open-mercato/ui/primitives/step-indicator'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const t = useT()

{[3, 4, 5].map((count) => (
  <StepIndicator key={count} showNumbers orientation="vertical" steps={Array.from({ length: count }, (_, index) => ({
    id: String(index),
    label: t('design_system.gallery.examples.navigation.step', { step: index + 1 }),
    status: index === 0 ? 'complete' : index === 1 ? 'current' : 'pending',
  }))} />
))}`,
    },
    {
      id: 'interactive',
      title: 'Interactive steps and dots',
      render: () => <StepInteractiveDemo />,
      code: `import * as React from 'react'
import { StepIndicator, StepperDots, type StepIndicatorStep } from '@open-mercato/ui/primitives/step-indicator'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'

function StepInteractiveDemo() {
  const t = useT()
  const [activeStep, setActiveStep] = React.useState(1)
  const steps: StepIndicatorStep[] = Array.from({ length: 5 }, (_, index) => ({
    id: String(index),
    label: t('design_system.gallery.examples.navigation.step', { step: index + 1 }),
    status: index < activeStep ? 'complete' : index === activeStep ? 'current' : 'pending',
  }))
  return (
    <div className="flex w-full flex-col gap-4">
      <div className="overflow-x-auto p-1"><StepIndicator steps={steps} showNumbers onStepClick={(id) => setActiveStep(Number(id))} /></div>
      <StepperDots count={5} activeStep={activeStep} aria-label={t('design_system.gallery.examples.navigation.progress')} />
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={activeStep === 0} onClick={() => setActiveStep((value) => value - 1)}>{t('design_system.gallery.examples.navigation.previous')}</Button>
        <Button variant="outline" size="sm" disabled={activeStep === 4} onClick={() => setActiveStep((value) => value + 1)}>{t('design_system.gallery.examples.navigation.next')}</Button>
      </div>
    </div>
  )
}

<StepInteractiveDemo />`,
    },
    {
      id: 'dots',
      title: 'StepperDots · 6 states',
      render: () => <StepperDotsDemo />,
      code: `import * as React from 'react'
import { StepIndicator, StepperDots, type StepIndicatorStep } from '@open-mercato/ui/primitives/step-indicator'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'

function StepperDotsDemo() {
  const t = useT()
  return (
    <div className="flex flex-wrap gap-8">
      {(['sm', 'xs'] as const).map((size) => (
        <div key={size} className="flex flex-col gap-4">
          <span className="text-xs text-muted-foreground">{size}</span>
          {[0, 1, 2].map((activeStep) => <StepperDots key={activeStep} count={3} activeStep={activeStep} size={size} aria-label={t('design_system.gallery.examples.navigation.progress')} />)}
        </div>
      ))}
    </div>
  )
}

<StepperDotsDemo />`,
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
      render: () => <NotificationFeedbackInformationSample />,
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
      render: () => <NotificationFeedbackSuccessWithActionsSample />,
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
      render: () => <NotificationFeedbackErrorSample />,
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
  figmaNodeId: '4308:731',
  title: 'NotificationFeed',
  importPath: '@open-mercato/ui/primitives/notification-feed',
  variants: [
    { id: 'source-tabs-2', title: '4 row types / 2 tabs', render: () => <NotificationFeedExample tabs={2} />, code: notificationFeedExampleCode(2) },
    { id: 'source-tabs-3', title: '4 row types / 3 tabs', render: () => <NotificationFeedExample tabs={3} />, code: notificationFeedExampleCode(3) },
    { id: 'source-tabs-4', title: '4 row types / 4 tabs', render: () => <NotificationFeedExample tabs={4} />, code: notificationFeedExampleCode(4) },
    {
      id: 'default',
      title: 'default',
      render: () => <NotificationFeedFeedbackDefaultSample />,
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
  bannerEntry,
  alertEntry,
  emptyStateEntry,
  emptyStateIllustrationEntry,
  skeletonEntry,
  progressEntry,
  spinnerEntry,
  ratingEntry,
  ratingBarEntry,
  stepIndicatorEntry,
  notificationEntry,
  notificationFeedEntry,
]

function AlertFeedbackStatusesLightSample() {
  const t = useT()
  return (<div className="flex w-full max-w-md flex-col gap-2">
          <Alert status="error" style="light">{t('design_system.gallery.sampleCopy.paymentFailedTheCardWasDeclined')}</Alert>
          <Alert status="warning" style="light">{t('design_system.gallery.sampleCopy.inventorySyncIsRunningBehindSchedule')}</Alert>
          <Alert status="success" style="light">{t('design_system.gallery.sampleCopy.order10231WasFulfilled')}</Alert>
          <Alert status="information" style="light">{t('design_system.gallery.sampleCopy.pricesIncludeVATForEUCustomers')}</Alert>
          <Alert status="feature" style="light">{t('design_system.gallery.sampleCopy.bulkEditingIsNowAvailableInTheCatalog')}</Alert>
        </div>)
}

function AlertFeedbackFilledSample() {
  const t = useT()
  return (<div className="w-full max-w-md">
          <Alert status="error" style="filled" size="default">
            <AlertTitle>{t('design_system.gallery.sampleCopy.importFailed')}</AlertTitle>
            <AlertDescription>{t('design_system.gallery.sampleCopy.14RowsWereRejectedDownloadTheErrorReportToReview')}</AlertDescription>
          </Alert>
        </div>)
}

function AlertFeedbackStrokeSample() {
  const t = useT()
  return (<div className="w-full max-w-md">
          <Alert status="success" style="stroke" size="default">
            <AlertTitle>{t('design_system.gallery.sampleCopy.backupComplete')}</AlertTitle>
            <AlertDescription>{t('design_system.gallery.sampleCopy.theNightlySnapshotFinishedWithoutWarnings')}</AlertDescription>
          </Alert>
        </div>)
}

function AlertFeedbackSizesSample() {
  const t = useT()
  return (<div className="flex w-full max-w-md flex-col gap-2">
          <Alert status="information" size="xs">{t('design_system.gallery.sampleCopy.xsmallInlineFormHint')}</Alert>
          <Alert status="information" size="sm">{t('design_system.gallery.sampleCopy.smallTheDefaultSinglelineAlert')}</Alert>
          <Alert status="information" size="default">
            <AlertTitle>{t('design_system.gallery.sampleCopy.large')}</AlertTitle>
            <AlertDescription>{t('design_system.gallery.sampleCopy.multilineAlertWithATitleAndADescriptionBody')}</AlertDescription>
          </Alert>
        </div>)
}

function AlertFeedbackDismissibleWithActionSample() {
  const t = useT()
  return (<div className="w-full max-w-md">
          <Alert
            status="warning"
            style="lighter"
            dismissible
            action={<LinkButton variant="black" underline="always">{t('design_system.gallery.sampleCopy.review')}</LinkButton>}
          >
            {t('design_system.gallery.sampleCopy.3ProductsAreMissingTaxCategories')}
          </Alert>
        </div>)
}

function EmptyStateFeedbackDefaultSample() {
  const t = useT()
  return (<div className="w-full max-w-md">
          <EmptyState
            title={t('design_system.gallery.sampleCopy.noCustomersYet')}
            description={t('design_system.gallery.sampleCopy.createYourFirstCustomerToStartTrackingOpportunities')}
          />
        </div>)
}

function EmptyStateFeedbackWithActionsSample() {
  const t = useT()
  return (<div className="w-full max-w-md">
          <EmptyState
            icon={<Inbox className="size-8" />}
            title={t('design_system.gallery.sampleCopy.noOrdersFound')}
            description={t('design_system.gallery.sampleCopy.ordersWillAppearHereOnceYourStorefrontStartsSelling')}
            actions={<Button size="sm">{t('design_system.gallery.sampleCopy.createOrder')}</Button>}
          />
        </div>)
}

function EmptyStateFeedbackSubtleSample() {
  const t = useT()
  return (<div className="w-full max-w-md">
          <EmptyState
            variant="subtle"
            size="sm"
            icon={<Search className="size-5" />}
            title={t('design_system.gallery.sampleCopy.noResults')}
            description={t('design_system.gallery.sampleCopy.tryADifferentSearchTermOrClearTheFilters')}
          />
        </div>)
}

function ProgressFeedbackLabelledSample() {
  const t = useT()
  return (<div className="w-full max-w-md">
          <Progress
            value={80}
            label={t('design_system.gallery.examples.controls.storage')}
            showValue
            description={t('design_system.gallery.examples.controls.storageHint')}
          />
        </div>)
}

function SpinnerFeedbackInlineWithLabelSample() {
  const t = useT()
  return (<span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner size="sm" />
          {t('design_system.gallery.sampleCopy.loadingOrders')}
        </span>)
}

function NotificationFeedbackInformationSample() {
  const t = useT()
  return (<div className="w-full max-w-md">
          <Notification
            title={t('design_system.gallery.samples.crypto.notificationMaintenance')}
            description={t('design_system.gallery.sampleCopy.theAdminPanelWillBeReadonlyOnSundayBetween0200')}
            timestamp={t('design_system.gallery.sampleCopy.2MinAgo')}
          />
        </div>)
}

function NotificationFeedbackSuccessWithActionsSample() {
  const t = useT()
  return (<div className="w-full max-w-md">
          <Notification
            status="success"
            title={t('design_system.gallery.sampleCopy.exportReady')}
            description={t('design_system.gallery.sampleCopy.yourProductExport1204RowsFinishedSuccessfully')}
            timestamp={t('design_system.gallery.sampleCopy.justNow')}
            actions={
              <>
                <LinkButton variant="black" underline="always">{t('design_system.gallery.sampleCopy.download')}</LinkButton>
                <LinkButton variant="gray" underline="always">{t('design_system.gallery.sampleCopy.viewLog')}</LinkButton>
              </>
            }
          />
        </div>)
}

function NotificationFeedbackErrorSample() {
  const t = useT()
  return (<div className="w-full max-w-md">
          <Notification
            status="error"
            title={t('design_system.gallery.sampleCopy.webhookDeliveryFailed')}
            description={t('design_system.gallery.sampleCopy.theEndpointRespondedWith503After3Retries')}
            timestamp={t('design_system.gallery.sampleCopy.5MinAgo')}
            actions={<LinkButton variant="error" underline="always">{t('design_system.gallery.sampleCopy.retryNow')}</LinkButton>}
          />
        </div>)
}

function NotificationFeedFeedbackDefaultSample() {
  const t = useT()
  return (<div className="w-full max-w-sm">
          <NotificationFeed>
            <NotificationFeedHeader title={t('design_system.families.notifications')}>
              <IconButton size="sm" variant="ghost" aria-label={t('design_system.gallery.sampleCopy.notificationSettings')}>
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
                title={t('design_system.gallery.sampleCopy.newLeadGenerated')}
                body={t('design_system.gallery.sampleCopy.johnSmithSubmittedTheContactForm')}
                timestamp={t('design_system.gallery.sampleCopy.10MinutesAgo')}
                unread
              />
              <NotificationFeedItem
                icon={
                  <NotificationFeedIconBadge tone="success">
                    <RefreshCw className="size-5" />
                  </NotificationFeedIconBadge>
                }
                title={t('design_system.gallery.sampleCopy.catalogSyncCompleted')}
                body={t('design_system.gallery.sampleCopy.312ProductsUpdatedFromThePIM')}
                timestamp={t('design_system.gallery.sampleCopy.1HourAgo')}
              />
            </NotificationFeedList>
            <NotificationFeedFooter>
              <Button variant="outline" size="sm" className="w-full">{t('design_system.gallery.samples.feeds.archive')}</Button>
            </NotificationFeedFooter>
          </NotificationFeed>
        </div>)
}
