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
      <aside className={`${collapsed ? 'w-16' : 'w-64'} border-r bg-background shrink-0 py-4 transition-all duration-200`}>
        {/* Padding lives on the inner scroll container so the absolute active-marker
            (left: -12px from each link) renders inside the inner div's padding box —
            CSS clips at padding-box edges, so a marker placed there stays visible. */}
        <div className={`h-full overflow-y-auto scrollbar-hide ${collapsed ? 'pl-2 pr-1' : 'pl-3 pr-1'}`}>
          <SectionNav
            title={title}
            titleKey={titleKey}
            sections={sections}
            activePath={activePath}
            userFeatures={userFeatures}
            collapsed={collapsed}
            onToggleCollapse={() => setCollapsed(!collapsed)}
          />
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto p-6">
        {children}
      </main>
    </div>
  )
}
