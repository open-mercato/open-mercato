import type * as React from 'react'

export type Copy = { key: string; fallback: string }

export type UsageSide = { caption: Copy; specimen: React.ReactNode }

export type UsagePair = {
  id: string
  title: Copy
  do: UsageSide
  avoid: UsageSide
  covers?: string[]
}

export type UsagePairGroup = Record<string, UsagePair[]>

export type UsageRules = { do: string[]; dont: string[] }

export function copy(key: string, fallback: string): Copy {
  return { key, fallback }
}
