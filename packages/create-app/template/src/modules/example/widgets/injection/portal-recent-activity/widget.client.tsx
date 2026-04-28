"use client"

const MOCK_ACTIVITY = [
  { id: '1', action: 'Logged in', time: '2 minutes ago', icon: 'login' },
  { id: '2', action: 'Updated profile', time: '1 hour ago', icon: 'profile' },
  { id: '3', action: 'Viewed order #1042', time: '3 hours ago', icon: 'order' },
  { id: '4', action: 'Downloaded invoice', time: 'Yesterday', icon: 'download' },
  { id: '5', action: 'Changed password', time: '3 days ago', icon: 'security' },
]

function ActivityIcon({ type }: { type: string }) {
  const colors: Record<string, string> = {
    login: 'bg-status-success-bg text-status-success-icon',
    profile: 'bg-status-info-bg text-status-info-icon',
    order: 'bg-status-warning-bg text-status-warning-icon',
    download: 'bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400',
    security: 'bg-status-error-bg text-status-error-icon',
  }
  return (
    <div className={`flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${colors[type] ?? 'bg-muted text-muted-foreground'}`}>
      {type.charAt(0).toUpperCase()}
    </div>
  )
}

export default function PortalRecentActivityWidget() {
  return (
    <div className="flex flex-col gap-0">
      {MOCK_ACTIVITY.map((item, idx) => (
        <div key={item.id} className={`flex items-center gap-3 py-2.5 ${idx > 0 ? 'border-t' : ''}`}>
          <ActivityIcon type={item.icon} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{item.action}</p>
            <p className="text-overline text-muted-foreground">{item.time}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
