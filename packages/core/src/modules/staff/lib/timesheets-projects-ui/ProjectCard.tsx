"use client"

import * as React from 'react'
import Link from 'next/link'
import { ProjectColorDot } from '../timesheets-ui/ProjectColorDot'
import { resolveProjectColorHex } from '../timesheets-ui/colors'
import { HoursSparkline } from './HoursSparkline'
import { ProjectMembersAvatarStack, type AvatarMember } from './ProjectMembersAvatarStack'

export type ProjectCardData = {
  id: string
  name: string
  code: string | null
  customerName: string | null
  color: string | null
  status: string
  hoursWeek: number
  hoursTrend: number[]
  members: AvatarMember[]
  memberCount: number
  myRole: string | null
  updatedAt: string | null
}

export type ProjectCardLabels = {
  hoursPanelPm: string
  hoursPanelCollab: string
  sparklineAria: string
  peopleCount: (count: number) => string
  role: string
  noCustomer: string
  statuses: Record<string, string>
}

export type ProjectCardProps = {
  data: ProjectCardData
  labels: ProjectCardLabels
  showTeam: boolean
  href: string
}

const STATUS_BADGE_CLASSES: Record<string, string> = {
  active: 'bg-lime-100 text-lime-800 dark:bg-lime-900/30 dark:text-lime-300',
  on_hold: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  completed: 'bg-muted text-muted-foreground',
}

export function ProjectCard({ data, labels, showTeam, href }: ProjectCardProps) {
  const badgeClass = STATUS_BADGE_CLASSES[data.status] ?? 'bg-muted text-muted-foreground'
  const statusLabel = labels.statuses[data.status] ?? data.status
  const stripeColor = resolveProjectColorHex(data.color, data.name)
  const hoursPanelLabel = showTeam ? labels.hoursPanelPm : labels.hoursPanelCollab

  return (
    <Link
      href={href}
      className="group relative flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-foreground/30"
    >
      <div className="h-[3px] w-full" style={{ backgroundColor: stripeColor }} aria-hidden="true" />
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${badgeClass}`}
          >
            {statusLabel}
          </span>
          <ProjectColorDot colorKey={data.color} projectName={data.name} size="sm" />
        </div>
        <div className="flex flex-col gap-0.5">
          <h3 className="truncate text-sm font-semibold text-foreground" title={data.name}>
            {data.name}
          </h3>
          <p className="truncate font-mono text-[11px] text-muted-foreground">
            {data.code ?? '—'}
            {data.customerName ? ` · ${data.customerName}` : ''}
          </p>
        </div>
        <div className="rounded-md border border-border/50 bg-muted/40 p-3">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{hoursPanelLabel}</p>
          <div className="mt-1 flex items-end justify-between gap-3">
            <p className="text-xl font-semibold tabular-nums text-foreground">
              {data.hoursWeek > 0 ? `${data.hoursWeek}h` : '—'}
            </p>
            <HoursSparkline
              values={data.hoursTrend}
              color={stripeColor}
              width={80}
              height={26}
              ariaLabel={labels.sparklineAria}
            />
          </div>
        </div>
        <div className="mt-auto flex items-center justify-between pt-1">
          {showTeam ? (
            <ProjectMembersAvatarStack
              members={data.members}
              total={data.memberCount}
              peopleCountLabel={labels.peopleCount(data.memberCount)}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              <span className="text-muted-foreground/70">{labels.role}: </span>
              {data.myRole ?? '—'}
            </p>
          )}
        </div>
      </div>
    </Link>
  )
}
