"use client"

import * as React from 'react'

export type AvatarMember = {
  id: string
  name: string
  initials: string
  avatarUrl?: string | null
}

export type ProjectMembersAvatarStackProps = {
  members: AvatarMember[]
  total: number
  peopleCountLabel: string
  className?: string
}

const AVATAR_PALETTE = [
  'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
  'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
  'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200',
  'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-200',
]

function pickPalette(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length]
}

export function ProjectMembersAvatarStack({
  members,
  total,
  peopleCountLabel,
  className,
}: ProjectMembersAvatarStackProps) {
  const visible = members.slice(0, 4)
  const overflow = Math.max(0, total - visible.length)

  if (total === 0) {
    return <span className={`text-xs text-muted-foreground ${className ?? ''}`}>—</span>
  }

  return (
    <div className={`flex items-center gap-2 ${className ?? ''}`}>
      <div className="flex -space-x-1.5">
        {visible.map((member) => (
          <span
            key={member.id}
            title={member.name}
            className={`inline-flex h-6 w-6 items-center justify-center rounded-full border border-background text-[10px] font-semibold ${pickPalette(member.id)}`}
          >
            {member.initials}
          </span>
        ))}
        {overflow > 0 ? (
          <span
            className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-background bg-muted text-[10px] font-semibold text-foreground"
            title={`+${overflow}`}
          >
            +{overflow}
          </span>
        ) : null}
      </div>
      <span className="text-xs text-muted-foreground">{peopleCountLabel}</span>
    </div>
  )
}
