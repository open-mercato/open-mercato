"use client"

const STATS = [
  { label: 'Orders', value: '12', trend: '+3 this month', color: 'text-emerald-600 dark:text-emerald-400' },
  { label: 'Pending', value: '2', trend: 'Awaiting shipment', color: 'text-amber-600 dark:text-amber-400' },
  { label: 'Invoices', value: '8', trend: '3 unpaid', color: 'text-blue-600 dark:text-blue-400' },
  { label: 'Quotes', value: '4', trend: '1 expiring soon', color: 'text-violet-600 dark:text-violet-400' },
]

export default function PortalStatsWidget() {
  return (
    <div className="grid grid-cols-2 gap-4">
      {STATS.map((stat) => (
        <div key={stat.label}>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
            {stat.label}
          </p>
          <p className={`mt-0.5 text-2xl font-bold tracking-tight ${stat.color}`}>
            {stat.value}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{stat.trend}</p>
        </div>
      ))}
    </div>
  )
}
