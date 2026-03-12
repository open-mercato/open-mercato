import {
  ArrowRight,
  Calendar,
  CheckSquare,
  Mail,
  MessageSquare,
  Paperclip,
  Pencil,
  Phone,
  Plus,
  Send,
  Trash2,
} from 'lucide-react'
import type { TimelinePanelConfig } from '@open-mercato/shared/modules/timeline/types'
import type { TimelineEntryKind } from './types'
import { ALL_TIMELINE_KINDS } from './types'

export const dealTimelinePanelConfig: TimelinePanelConfig<TimelineEntryKind> = {
  allKinds: ALL_TIMELINE_KINDS,

  kindLabels: (t) => ({
    deal_created: t('customers.deals.timeline.kind.deal_created', 'Deal created'),
    deal_updated: t('customers.deals.timeline.kind.deal_updated', 'Deal updated'),
    deal_deleted: t('customers.deals.timeline.kind.deal_deleted', 'Deal deleted'),
    stage_changed: t('customers.deals.timeline.kind.stage_changed', 'Stage changed'),
    comment_added: t('customers.deals.timeline.kind.comment_added', 'Comment added'),
    activity_logged: t('customers.deals.timeline.kind.activity_logged', 'Activity logged'),
    email_sent: t('customers.deals.timeline.kind.email_sent', 'Email sent'),
    email_received: t('customers.deals.timeline.kind.email_received', 'Email received'),
    file_uploaded: t('customers.deals.timeline.kind.file_uploaded', 'File uploaded'),
  }),

  kindIcons: {
    deal_created: Plus,
    deal_updated: Pencil,
    deal_deleted: Trash2,
    stage_changed: ArrowRight,
    comment_added: MessageSquare,
    activity_logged: Phone,
    email_sent: Send,
    email_received: Mail,
    file_uploaded: Paperclip,
  },

  kindBgColors: {
    deal_created: 'bg-green-100 dark:bg-green-900/30',
    deal_updated: 'bg-blue-100 dark:bg-blue-900/30',
    deal_deleted: 'bg-red-100 dark:bg-red-900/30',
    stage_changed: 'bg-purple-100 dark:bg-purple-900/30',
    comment_added: 'bg-yellow-100 dark:bg-yellow-900/30',
    activity_logged: 'bg-orange-100 dark:bg-orange-900/30',
    email_sent: 'bg-emerald-100 dark:bg-emerald-900/30',
    email_received: 'bg-cyan-100 dark:bg-cyan-900/30',
    file_uploaded: 'bg-gray-100 dark:bg-gray-800/50',
  },

  kindIconColors: {
    deal_created: 'text-green-600 dark:text-green-400',
    deal_updated: 'text-blue-600 dark:text-blue-400',
    deal_deleted: 'text-red-600 dark:text-red-400',
    stage_changed: 'text-purple-600 dark:text-purple-400',
    comment_added: 'text-yellow-600 dark:text-yellow-400',
    activity_logged: 'text-orange-600 dark:text-orange-400',
    email_sent: 'text-emerald-600 dark:text-emerald-400',
    email_received: 'text-cyan-600 dark:text-cyan-400',
    file_uploaded: 'text-gray-600 dark:text-gray-400',
  },

  resolveActivityIcon: (detail) => {
    const activityType = typeof detail?.activityType === 'string' ? detail.activityType : ''
    if (activityType === 'meeting' || activityType === 'appointment') return Calendar
    if (activityType === 'task' || activityType === 'todo') return CheckSquare
    return Phone
  },
}
