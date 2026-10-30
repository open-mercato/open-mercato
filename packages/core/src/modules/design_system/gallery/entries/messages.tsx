import { useT } from '@open-mercato/shared/lib/i18n/context'
import * as React from 'react'
import { EmailThreadsPanel, MessageObjectPreview, type EmailThread } from '@open-mercato/ui/backend/messages'
import { MessagePrioritySelector } from '@open-mercato/ui/backend/messages/MessagePrioritySelector'
import type { MessagePriority } from '@open-mercato/ui/backend/messages/message-priority'
import type { GalleryEntry } from '../types'

// Component titles and variant names are proper nouns from the codebase and
// are deliberately not translated. `code` MUST contain the entry's importPath
// (enforced by the registry-integrity test) and is always reviewed alongside
// its sibling `render`.

// Fixed sample timestamps (June 2026) — previews must not depend on "today".
function EmailThreadsPanelEntryReadOnlyPreview() {
  const t = useT()
  return (
    <EmailThreadsPanel
      threads={sampleThreads(t)}
      canCompose={false}
      composeDisabledHint={
        <span className="text-sm text-muted-foreground">
          {t('design_system.gallery.samples.content.connectAnEmailProviderToReplyFromHere')}
        </span>
      }
      onRefresh={() => {}}
      className="w-full"
    />
  )
}
function MessageObjectPreviewEntryPreviewDataPreview() {
  const t = useT()
  return (
    <MessageObjectPreview
      entityId="order-10241"
      entityModule="sales"
      entityType="order"
      previewData={{
        title: t('design_system.gallery.samples.content.order10241'),
        subtitle: t('design_system.gallery.samples.content.annaNowak3Items'),
        status: 'processing',
      }}
    />
  )
}
function MessageObjectPreviewEntryActionRequiredPreview() {
  const t = useT()
  return (
    <MessageObjectPreview
      entityId="return-1182"
      entityModule="sales"
      entityType="return"
      actionRequired
      actionLabel={t('design_system.gallery.samples.content.approveReturn')}
      previewData={{
        title: t('design_system.gallery.samples.content.returnRequest1182'),
        subtitle: t('design_system.gallery.samples.content.order10241AnnaNowak'),
        metadata: {
          total: 'EUR 412.00',
          due: 'Jun 15, 2026',
        },
      }}
    />
  )
}
function EmailThreadsPanelEntryConversationsPreview() {
  const t = useT()
  return (
    <EmailThreadsPanel
      threads={sampleThreads(t)}
      canCompose
      onComposeNew={() => {}}
      onReply={() => {}}
      onRefresh={() => {}}
      className="w-full"
    />
  )
}
function EmailThreadsPanelEntryOptimisticStatusPreview() {
  const t = useT()
  return (
    <EmailThreadsPanel
      threads={optimisticThread(t)}
      canCompose
      onComposeNew={() => {}}
      onReply={() => {}}
      onRetry={() => {}}
      className="w-full"
    />
  )
}
const sampleThreads = (t: ReturnType<typeof useT>): EmailThread[] => [
  {
    threadKey: 'thread-fitting',
    subject: t('design_system.gallery.samples.content.fittingAppointmentJune12'),
    preview: t('design_system.gallery.samples.content.greatSeeYouFridayAt1000'),
    participants: ['anna.nowak@example.com'],
    lastMessageAt: '2026-06-10T14:05:00.000Z',
    messageCount: 2,
    providerKey: 'gmail',
    lastDirection: 'inbound',
    messages: [
      {
        id: 'msg-fitting-1',
        messageId: null,
        rfcMessageId: '<fitting-1@example.com>',
        references: [],
        direction: 'outbound',
        fromName: t('design_system.gallery.samples.content.studioTeam'),
        fromEmail: 'studio@example.com',
        to: ['anna.nowak@example.com'],
        cc: [],
        subject: t('design_system.gallery.samples.content.fittingAppointmentJune12'),
        bodyText: t('design_system.gallery.samples.content.hiAnnaWeCanOfferFridayJune12At1000DoesThatWorkForYou'),
        sentAt: '2026-06-10T09:24:00.000Z',
        providerKey: 'gmail',
      },
      {
        id: 'msg-fitting-2',
        messageId: null,
        rfcMessageId: '<fitting-2@example.com>',
        references: ['<fitting-1@example.com>'],
        direction: 'inbound',
        fromName: 'Anna Nowak',
        fromEmail: 'anna.nowak@example.com',
        to: ['studio@example.com'],
        cc: [],
        subject: t('design_system.gallery.samples.content.reFittingAppointmentJune12'),
        bodyText: t('design_system.gallery.samples.content.greatSeeYouFridayAt1000'),
        sentAt: '2026-06-10T14:05:00.000Z',
        providerKey: 'gmail',
      },
    ],
  },
  {
    threadKey: 'thread-invoice',
    subject: t('design_system.gallery.samples.content.invoice2026118'),
    preview: t('design_system.gallery.samples.content.attachedIsTheCorrectedInvoiceForMay'),
    participants: ['billing@acme.example.com'],
    lastMessageAt: '2026-06-08T08:12:00.000Z',
    messageCount: 1,
    providerKey: 'gmail',
    lastDirection: 'inbound',
    messages: [
      {
        id: 'msg-invoice-1',
        messageId: null,
        rfcMessageId: '<invoice-1@example.com>',
        references: [],
        direction: 'inbound',
        fromName: t('design_system.gallery.samples.content.acmeBilling'),
        fromEmail: 'billing@acme.example.com',
        to: ['studio@example.com'],
        cc: ['accounting@example.com'],
        subject: t('design_system.gallery.samples.content.invoice2026118'),
        bodyText: t('design_system.gallery.samples.content.attachedIsTheCorrectedInvoiceForMay'),
        sentAt: '2026-06-08T08:12:00.000Z',
        providerKey: 'gmail',
      },
    ],
  },
]
const optimisticThread = (t: ReturnType<typeof useT>): EmailThread[] => [
  {
    threadKey: 'thread-optimistic',
    subject: t('design_system.gallery.samples.content.order10241DeliveryUpdate'),
    preview: t('design_system.gallery.samples.content.yourOrderShipsTomorrow'),
    participants: ['jan.kowalski@example.com'],
    lastMessageAt: '2026-06-11T16:40:00.000Z',
    messageCount: 3,
    providerKey: 'gmail',
    lastDirection: 'outbound',
    messages: [
      {
        id: 'msg-opt-1',
        messageId: null,
        rfcMessageId: null,
        references: [],
        direction: 'outbound',
        fromName: t('design_system.gallery.samples.content.studioTeam'),
        fromEmail: 'studio@example.com',
        to: ['jan.kowalski@example.com'],
        cc: [],
        subject: t('design_system.gallery.samples.content.order10241DeliveryUpdate'),
        bodyText: t('design_system.gallery.samples.content.yourOrderShipsTomorrow'),
        sentAt: '2026-06-11T16:38:00.000Z',
        providerKey: 'gmail',
        status: 'sent',
      },
      {
        id: 'msg-opt-2',
        messageId: null,
        rfcMessageId: null,
        references: [],
        direction: 'outbound',
        fromName: t('design_system.gallery.samples.content.studioTeam'),
        fromEmail: 'studio@example.com',
        to: ['jan.kowalski@example.com'],
        cc: [],
        subject: t('design_system.gallery.samples.content.reOrder10241DeliveryUpdate'),
        bodyText: t('design_system.gallery.samples.content.trackingNumberFollowsInASeparateEmail'),
        sentAt: '2026-06-11T16:39:00.000Z',
        providerKey: 'gmail',
        status: 'sending',
      },
      {
        id: 'msg-opt-3',
        messageId: null,
        rfcMessageId: null,
        references: [],
        direction: 'outbound',
        fromName: t('design_system.gallery.samples.content.studioTeam'),
        fromEmail: 'studio@example.com',
        to: ['jan.kowalski@example.com'],
        cc: [],
        subject: t('design_system.gallery.samples.content.reOrder10241DeliveryUpdate'),
        bodyText: t('design_system.gallery.samples.content.hereIsTheTrackingLink'),
        sentAt: '2026-06-11T16:40:00.000Z',
        providerKey: 'gmail',
        status: 'failed',
        statusError: t('design_system.gallery.samples.content.mailboxTemporarilyUnavailable'),
      },
    ],
  },
]
const emailThreadsPanelEntry: GalleryEntry = {
  id: 'email-threads-panel',
  title: 'EmailThreadsPanel',
  importPath: '@open-mercato/ui/backend/messages',
  variants: [
    {
      id: 'conversations',
      title: 'Conversations',
      render: () => <EmailThreadsPanelEntryConversationsPreview />,
      code: `import { EmailThreadsPanel, type EmailThread } from '@open-mercato/ui/backend/messages'

<EmailThreadsPanel
  threads={threads /* EmailThread[] fetched by the host page */}
  canCompose
  onComposeNew={() => openComposer()}
  onReply={(thread) => openReply(thread)}
  onRefresh={() => refetch()}
/>`,
    },
    {
      id: 'optimistic-status',
      title: 'Optimistic send status',
      render: () => <EmailThreadsPanelEntryOptimisticStatusPreview />,
      code: `import { EmailThreadsPanel } from '@open-mercato/ui/backend/messages'

// Messages carry status: 'sending' | 'sent' | 'failed' via mergeOptimisticEmailThreads
<EmailThreadsPanel
  threads={threads}
  canCompose
  onComposeNew={() => openComposer()}
  onReply={(thread) => openReply(thread)}
  onRetry={(message) => resend(message)}
/>`,
    },
    {
      id: 'empty',
      title: 'Empty state',
      render: () => <EmailThreadsPanel threads={[]} canCompose onComposeNew={() => {}} className="w-full" />,
      code: `import { EmailThreadsPanel } from '@open-mercato/ui/backend/messages'

<EmailThreadsPanel threads={[]} canCompose onComposeNew={() => openComposer()} />`,
    },
    {
      id: 'read-only',
      title: 'Read-only (compose disabled)',
      render: () => <EmailThreadsPanelEntryReadOnlyPreview />,
      code: `import { EmailThreadsPanel } from '@open-mercato/ui/backend/messages'

<EmailThreadsPanel
  threads={threads}
  canCompose={false}
  composeDisabledHint={<span className="text-sm text-muted-foreground">Connect an email provider to reply from here.</span>}
  onRefresh={() => refetch()}
/>`,
    },
  ],
}
const galleryT = (key: string, fallback?: string) => fallback ?? key
function DemoMessagePrioritySelector() {
  const t = useT()
  const [value, setValue] = React.useState<MessagePriority>('high')
  return <MessagePrioritySelector value={value} onChange={setValue} t={t} />
}
const messagePrioritySelectorEntry: GalleryEntry = {
  id: 'message-priority-selector',
  title: 'MessagePrioritySelector',
  importPath: '@open-mercato/ui/backend/messages/MessagePrioritySelector',
  variants: [
    {
      id: 'interactive',
      title: 'Interactive (presentational core of the API-wired MessageComposer)',
      render: () => <DemoMessagePrioritySelector />,
      code: `import { MessagePrioritySelector } from '@open-mercato/ui/backend/messages/MessagePrioritySelector'
import type { MessagePriority } from '@open-mercato/ui/backend/messages/message-priority'

const [value, setValue] = React.useState<MessagePriority>('high')

// Inside MessageComposer priorities come through defaultValues.priority;
// standalone usage is fully controlled.
<MessagePrioritySelector value={value} onChange={setValue} t={t} />`,
    },
  ],
}
const messageObjectPreviewEntry: GalleryEntry = {
  id: 'message-object-preview',
  title: 'MessageObjectPreview',
  importPath: '@open-mercato/ui/backend/messages',
  variants: [
    {
      id: 'preview-data',
      title: 'Preview data',
      render: () => <MessageObjectPreviewEntryPreviewDataPreview />,
      code: `import { MessageObjectPreview } from '@open-mercato/ui/backend/messages'

<MessageObjectPreview
  entityId="order-10241"
  entityModule="sales"
  entityType="order"
  previewData={{ title: 'Order #10241', subtitle: 'Anna Nowak — 3 items', status: 'processing' }}
/>`,
    },
    {
      id: 'action-required',
      title: 'Action required with metadata',
      render: () => <MessageObjectPreviewEntryActionRequiredPreview />,
      code: `import { MessageObjectPreview } from '@open-mercato/ui/backend/messages'

<MessageObjectPreview
  entityId="return-1182"
  entityModule="sales"
  entityType="return"
  actionRequired
  actionLabel="Approve return"
  previewData={{
    title: 'Return request #1182',
    subtitle: 'Order #10241 — Anna Nowak',
    metadata: { total: 'EUR 412.00', due: 'Jun 15, 2026' },
  }}
/>`,
    },
  ],
}
export const entries: GalleryEntry[] = [emailThreadsPanelEntry, messagePrioritySelectorEntry, messageObjectPreviewEntry]
