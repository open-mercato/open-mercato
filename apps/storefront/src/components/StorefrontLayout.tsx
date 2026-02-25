import * as React from 'react'
import { StorefrontHeader } from './StorefrontHeader'
import type { CategoryNode } from '@/lib/types'

type StorefrontLayoutProps = {
  children: React.ReactNode
  categories?: CategoryNode[]
}

export function StorefrontLayout({ children, categories }: StorefrontLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <StorefrontHeader categories={categories} />
      <main className="flex-1">{children}</main>
      <footer className="border-t border-gray-100 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <p className="text-center text-xs text-gray-400">
            Powered by Open Mercato
          </p>
        </div>
      </footer>
    </div>
  )
}
