import * as React from 'react'
import { FileText, ListFilter, MoreHorizontal, RotateCcw } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ActivityFeed, ActivityFeedComment, ActivityFeedFileChip, ActivityFeedItem, ActivityFeedStatusChip } from '@open-mercato/ui/primitives/activity-feed'
import { Avatar, AvatarStack } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { NotificationFeed, NotificationFeedFooter, NotificationFeedHeader, NotificationFeedItem, NotificationFeedList } from '@open-mercato/ui/primitives/notification-feed'
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import { Textarea } from '@open-mercato/ui/primitives/textarea'

const feedKinds = ['basic', 'file', 'comment', 'avatars', 'tasks'] as const
type FeedKind = typeof feedKinds[number]
const people: Record<FeedKind, string> = { basic: 'Wei Chen', file: 'Omar Haddad', comment: 'Laura Perez', avatars: 'Ines Kowalska', tasks: 'Ravi Patel' }

function LocalFilePreview({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT()
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent>
    <DialogHeader><DialogTitle>apex-report.pdf</DialogTitle><DialogDescription>{t('design_system.gallery.samples.feeds.filePreview')}</DialogDescription></DialogHeader>
    <p className="text-sm text-muted-foreground">{t('design_system.gallery.samples.feeds.fileBody')}</p>
  </DialogContent></Dialog>
}

export function ActivityFeedExample() {
  const t = useT()
  const [filter, setFilter] = React.useState<'all' | 'file' | 'comment'>('all')
  const [hidden, setHidden] = React.useState<FeedKind[]>([])
  const [fileOpen, setFileOpen] = React.useState(false)
  const [replyOpen, setReplyOpen] = React.useState(false)
  const [draft, setDraft] = React.useState('')
  const [reply, setReply] = React.useState('')
  const visible = feedKinds.filter(kind => !hidden.includes(kind) && (filter === 'all' || filter === kind))
  const title = (kind: FeedKind) => <>{people[kind]} <span className="font-normal text-muted-foreground">{t(`design_system.gallery.samples.feeds.${kind}Action`)}</span></>
  return <div className="w-full max-w-2xl space-y-5">
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t('design_system.gallery.samples.feeds.filter')}>
      {(['all', 'file', 'comment'] as const).map(value => <Button key={value} size="2xs" variant="ghost" aria-pressed={filter === value} onClick={() => setFilter(value)} className="gap-1.5 px-2.5 aria-pressed:bg-status-info-bg aria-pressed:text-status-info-text">
        {value === 'all' ? <ListFilter className="size-[18px]" /> : value === 'file' ? <FileText className="size-[18px]" /> : null}{t(`design_system.gallery.samples.feeds.${value}`)}
      </Button>)}
      {hidden.length ? <Button variant="ghost" size="2xs" onClick={() => setHidden([])}><RotateCcw />{t('design_system.gallery.samples.feeds.restore')}</Button> : null}
    </div>
    <ActivityFeed className="gap-5">
      {visible.map(kind => <ActivityFeedItem key={kind} className="gap-4 [&_[data-slot=activity-feed-item-title]]:leading-5 [&_[data-slot=activity-feed-item-title]>span:first-child]:font-medium" avatar={<Avatar size={32} label={people[kind]} />} title={title(kind)} timestamp={t('design_system.gallery.samples.feeds.time')}
        actions={<Popover><PopoverTrigger asChild><Button variant="ghost" size="icon" className="size-6" aria-label={t('design_system.gallery.samples.feeds.actions', { name: people[kind] })}><MoreHorizontal /></Button></PopoverTrigger><PopoverContent align="end" className="w-auto p-1"><PopoverClose asChild><Button variant="ghost" size="sm" onClick={() => setHidden(items => [...items, kind])}>{t('design_system.gallery.samples.feeds.hide')}</Button></PopoverClose></PopoverContent></Popover>}>
        {kind === 'file' ? <ActivityFeedFileChip name="apex-report.pdf" size="4 MB" onDownload={() => setFileOpen(true)} downloadAriaLabel={t('design_system.gallery.samples.feeds.openFile')} /> : null}
        {kind === 'comment' ? <div className="w-full space-y-2"><ActivityFeedComment className="[&_[data-slot=activity-feed-comment-body]]:whitespace-normal [&_[data-slot=activity-feed-comment-body]]:break-words" onReply={() => setReplyOpen(value => !value)} replyLabel={t('design_system.gallery.samples.feeds.reply')}>{t('design_system.gallery.samples.feeds.commentBody')}</ActivityFeedComment>
          {replyOpen ? <form className="space-y-2" onSubmit={event => { event.preventDefault(); if (draft.trim()) { setReply(draft.trim()); setDraft(''); setReplyOpen(false) } }}><Textarea aria-label={t('design_system.gallery.samples.feeds.reply')} value={draft} onChange={event => setDraft(event.target.value)} /><Button size="sm" type="submit" disabled={!draft.trim()}>{t('design_system.gallery.samples.feeds.saveReply')}</Button></form> : null}
          {reply ? <p className="rounded-md bg-muted p-3 text-sm" role="status">{reply}</p> : null}
        </div> : null}
        {kind === 'avatars' ? <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background py-0.5 pl-0.5 pr-2 shadow-xs"><AvatarStack size={24} max={3}><Avatar size={24} label="Wei Chen" /><Avatar size={24} label="Laura Perez" /><Avatar size={24} label="Omar Haddad" /></AvatarStack><span className="text-xs text-muted-foreground">+4</span></div> : null}
        {kind === 'tasks' ? <><ActivityFeedStatusChip status="success">{t('design_system.gallery.samples.feeds.approved')}</ActivityFeedStatusChip><ActivityFeedStatusChip status="warning">{t('design_system.gallery.samples.feeds.review')}</ActivityFeedStatusChip><ActivityFeedStatusChip status="pending">{t('design_system.gallery.samples.feeds.pending')}</ActivityFeedStatusChip><ActivityFeedStatusChip status="error">{t('design_system.gallery.samples.feeds.blocked')}</ActivityFeedStatusChip></> : null}
      </ActivityFeedItem>)}
    </ActivityFeed>
    {!visible.length ? <p className="text-sm text-muted-foreground" role="status">{t('design_system.gallery.samples.feeds.empty')}</p> : null}
    <LocalFilePreview open={fileOpen} onOpenChange={setFileOpen} />
  </div>
}

const notificationKinds = ['basic', 'button', 'file', 'message'] as const
export function NotificationFeedExample({ tabs = 4 }: { tabs?: 2 | 3 | 4 }) {
  const t = useT()
  const [filter, setFilter] = React.useState('all')
  const [archived, setArchived] = React.useState(false)
  const [read, setRead] = React.useState(false)
  const [decision, setDecision] = React.useState<'approved' | 'denied' | null>(null)
  const [fileOpen, setFileOpen] = React.useState(false)
  const filters = ['all', 'unread', 'file', 'message'].slice(0, tabs)
  const visible = archived || (filter === 'unread' && read) ? [] : notificationKinds.filter(kind => !['file', 'message'].includes(filter) || kind === filter)
  return <div className="w-full max-w-xl space-y-3"><NotificationFeed>
    <NotificationFeedHeader className="flex-wrap" title={t('design_system.gallery.samples.feeds.notifications')}><Button size="2xs" variant="ghost" onClick={() => setRead(true)} disabled={read || archived}>{t('design_system.gallery.samples.feeds.markRead')}</Button></NotificationFeedHeader>
    <Tabs value={filter} onValueChange={setFilter} variant="underline"><TabsList aria-label={t('design_system.gallery.samples.feeds.filter')} className="w-full px-3">{filters.map(value => <TabsTrigger key={value} value={value}>{t(`design_system.gallery.samples.feeds.${value}`)}</TabsTrigger>)}</TabsList><TabsContent value={filter} className="mt-0">
    <NotificationFeedList className="gap-1 divide-y-0 p-2">
      {visible.map(kind => <NotificationFeedItem key={kind} className="rounded-lg p-3 hover:bg-muted/40 [&_[data-slot=notification-feed-item-title]]:font-medium" icon={<Avatar size={40} label="Wei Chen" />} title={t(`design_system.gallery.samples.feeds.notification${kind}`)} timestamp={<>{t('design_system.gallery.samples.feeds.time')} · Apex</>} unread={!read}>
        {kind === 'button' ? decision ? <p className="text-sm" role="status">{t(`design_system.gallery.samples.feeds.${decision}`)}</p> : <><Button variant="outline" size="sm" onClick={() => setDecision('denied')}>{t('design_system.gallery.samples.feeds.deny')}</Button><Button variant="primary-filled" size="sm" onClick={() => setDecision('approved')}>{t('design_system.gallery.samples.feeds.approve')}</Button></> : null}
        {kind === 'file' ? <ActivityFeedFileChip name="apex-report.pdf" size="4 MB" onDownload={() => setFileOpen(true)} downloadAriaLabel={t('design_system.gallery.samples.feeds.openFile')} /> : null}
        {kind === 'message' ? <p className="rounded-md rounded-tl-sm border border-border bg-background px-3 py-2 text-sm text-muted-foreground shadow-xs">{t('design_system.gallery.samples.feeds.messageBody')}</p> : null}
      </NotificationFeedItem>)}
    </NotificationFeedList>
    {!visible.length ? <p className="p-5 text-center text-sm text-muted-foreground" role="status">{t('design_system.gallery.samples.feeds.empty')}</p> : null}
    <NotificationFeedFooter><Button variant="outline" size="sm" className="w-full" onClick={() => setArchived(true)} disabled={archived}>{t('design_system.gallery.samples.feeds.archive')}</Button></NotificationFeedFooter></TabsContent></Tabs>
  </NotificationFeed><Button variant="ghost" size="sm" onClick={() => { setArchived(false); setRead(false); setDecision(null); setFilter('all') }}><RotateCcw />{t('design_system.gallery.samples.feeds.restore')}</Button><LocalFilePreview open={fileOpen} onOpenChange={setFileOpen} /></div>
}
