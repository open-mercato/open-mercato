"use client"

import * as React from 'react'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'

type Delta = { current: number; previous: number; deltaPct: number | null }

export type PmKpis = {
  role: 'pm'
  totals: { total: number; active: number; onHold: number; completed: number }
  hoursWeek: Delta
  hoursMonth: Delta
  teamActive: { count: number }
  assignedToMe: { total: number; active: number }
}

export type CollabKpis = {
  role: 'collab'
  myProjects: { total: number; active: number }
  myHoursWeek: Delta
  myHoursMonth: Delta
}

type KpiLabels = {
  totalProjects: string
  totalProjectsSub: (args: { active: number; onHold: number }) => string
  hoursWeek: string
  hoursWeekSub: string
  assignedToMe: string
  assignedToMeSub: (active: number) => string
  hoursMonth: string
  hoursMonthSub: string
  teamActive: string
  teamActiveSub: string
  myProjects: string
  myProjectsSub: (active: number) => string
  myHoursWeek: string
  myHoursMonth: string
  deltaUp: (pct: number) => string
  deltaDown: (pct: number) => string
  deltaFlat: string
  noPrevious: string
}

function DeltaBadge({ pct, labels }: { pct: number | null; labels: KpiLabels }) {
  if (pct === null) {
    return <span className="text-[11px] text-muted-foreground/70">{labels.noPrevious}</span>
  }
  if (pct > 0) {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-[11px] font-medium text-emerald-600 tabular-nums"
        aria-label={labels.deltaUp(pct)}
      >
        <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
        {pct}%
      </span>
    )
  }
  if (pct < 0) {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-[11px] font-medium text-rose-600 tabular-nums"
        aria-label={labels.deltaDown(Math.abs(pct))}
      >
        <ArrowDownRight className="h-3 w-3" aria-hidden="true" />
        {Math.abs(pct)}%
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground/70"
      aria-label={labels.deltaFlat}
    >
      <Minus className="h-3 w-3" aria-hidden="true" />
      0%
    </span>
  )
}

function KpiCard({
  label,
  value,
  subtext,
  delta,
  labels,
}: {
  label: string
  value: React.ReactNode
  subtext?: string
  delta?: Delta
  labels: KpiLabels
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        {delta ? <DeltaBadge pct={delta.deltaPct} labels={labels} /> : null}
      </div>
      <p className="text-2xl font-semibold tabular-nums text-foreground">{value}</p>
      {subtext ? <p className="text-xs text-muted-foreground">{subtext}</p> : null}
    </div>
  )
}

export type ProjectsKpiStripProps = {
  kpis: PmKpis | CollabKpis | null
  labels: KpiLabels
  isLoading?: boolean
}

export function ProjectsKpiStrip({ kpis, labels, isLoading }: ProjectsKpiStripProps) {
  if (isLoading || !kpis) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, idx) => (
          <div key={idx} className="h-[88px] animate-pulse rounded-lg border border-border bg-muted/40" />
        ))}
      </div>
    )
  }

  if (kpis.role === 'pm') {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard
          label={labels.totalProjects}
          value={kpis.totals.total}
          subtext={labels.totalProjectsSub({ active: kpis.totals.active, onHold: kpis.totals.onHold })}
          labels={labels}
        />
        <KpiCard
          label={labels.hoursWeek}
          value={`${kpis.hoursWeek.current}h`}
          subtext={labels.hoursWeekSub}
          delta={kpis.hoursWeek}
          labels={labels}
        />
        <KpiCard
          label={labels.hoursMonth}
          value={`${kpis.hoursMonth.current}h`}
          subtext={labels.hoursMonthSub}
          delta={kpis.hoursMonth}
          labels={labels}
        />
        <KpiCard
          label={labels.assignedToMe}
          value={kpis.assignedToMe.total}
          subtext={labels.assignedToMeSub(kpis.assignedToMe.active)}
          labels={labels}
        />
        <KpiCard
          label={labels.teamActive}
          value={kpis.teamActive.count}
          subtext={labels.teamActiveSub}
          labels={labels}
        />
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <KpiCard
        label={labels.myProjects}
        value={kpis.myProjects.total}
        subtext={labels.myProjectsSub(kpis.myProjects.active)}
        labels={labels}
      />
      <KpiCard
        label={labels.myHoursWeek}
        value={`${kpis.myHoursWeek.current}h`}
        delta={kpis.myHoursWeek}
        labels={labels}
      />
      <KpiCard
        label={labels.myHoursMonth}
        value={`${kpis.myHoursMonth.current}h`}
        delta={kpis.myHoursMonth}
        labels={labels}
      />
    </div>
  )
}
