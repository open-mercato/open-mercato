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
    login: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400',
    profile: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
    order: 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
    download: 'bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400',
    security: 'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400',
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
            <p className="text-[13px] font-medium">{item.action}</p>
            <p className="text-[11px] text-muted-foreground">{item.time}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
