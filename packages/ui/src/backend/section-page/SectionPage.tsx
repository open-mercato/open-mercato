'use client'
import * as React from 'react'
import { SectionNav } from './SectionNav'
import type { SectionPageProps } from './types'

export function SectionPage({
  title,
  titleKey,
  sections,
  activePath,
  userFeatures,
  children,
}: SectionPageProps) {
  const [collapsed, setCollapsed] = React.useState(false)

  return (
    <div className="flex h-full min-h-[calc(100vh-8rem)]">
      <aside className={`${collapsed ? 'w-16' : 'w-64'} border-r bg-muted/30 overflow-y-auto shrink-0 transition-all duration-200`}>
        <SectionNav
          title={title}
          titleKey={titleKey}
          sections={sections}
          activePath={activePath}
          userFeatures={userFeatures}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed(!collapsed)}
        />
      </aside>
      <main className="flex-1 overflow-y-auto p-6">
        {children}
      </main>
    </div>
  )
}
