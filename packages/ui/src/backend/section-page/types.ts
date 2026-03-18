import type { ReactNode } from 'react'

export type SectionNavItem = {
  id: string
  label: string
  labelKey?: string
  href: string
  icon?: ReactNode
  requireFeatures?: string[]
  order?: number
  children?: SectionNavItem[]
}

export type SectionNavGroup = {
  id: string
  label: string
  labelKey?: string
  items: SectionNavItem[]
  order?: number
}

export type SectionPageProps = {
  title: string
  titleKey?: string
  sections: SectionNavGroup[]
  activePath: string
  userFeatures?: Set<string>
  children: ReactNode
}
