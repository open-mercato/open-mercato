'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Search, Menu, X } from 'lucide-react'
import { useStoreName } from '@/lib/storeContext'
import type { CategoryNode } from '@/lib/types'
import { CartIcon } from './CartIcon'
import { CartSidebar } from './CartSidebar'

type StorefrontHeaderProps = {
  categories?: CategoryNode[]
}

export function StorefrontHeader({ categories = [] }: StorefrontHeaderProps) {
  const storeName = useStoreName()
  const router = useRouter()
  const [searchQuery, setSearchQuery] = React.useState('')
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false)
  const topCategories = categories.filter((c) => !c.parentId).slice(0, 6)

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (searchQuery.trim()) {
      router.push(`/search?search=${encodeURIComponent(searchQuery.trim())}`)
    }
  }

  return (
    <header className="sticky top-0 z-50 border-b border-gray-100 bg-white/80 backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-4">
          <Link href="/" className="text-lg font-semibold tracking-tight text-gray-900 shrink-0">
            {storeName}
          </Link>

          {topCategories.length > 0 && (
            <nav className="hidden items-center gap-6 md:flex">
              {topCategories.map((cat) => (
                <Link
                  key={cat.id}
                  href={cat.slug ? `/categories/${cat.slug}` : `/?categoryId=${cat.id}`}
                  className="text-sm text-gray-600 transition-colors hover:text-gray-900"
                >
                  {cat.name}
                </Link>
              ))}
            </nav>
          )}

          <div className="flex flex-1 items-center justify-end gap-3 max-w-xs">
            <form onSubmit={handleSearch} className="relative w-full">
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search products…"
                className="w-full rounded-full border border-gray-200 bg-gray-50 py-1.5 pl-4 pr-10 text-sm text-gray-700 placeholder-gray-400 transition-colors focus:border-gray-300 focus:bg-white focus:outline-none"
              />
              <button
                type="submit"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                aria-label="Search"
              >
                <Search className="h-4 w-4" />
              </button>
            </form>

            <CartIcon />

            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="flex md:hidden items-center justify-center rounded-lg p-2 text-gray-600 hover:bg-gray-50"
              aria-label="Menu"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </div>

      {mobileMenuOpen && topCategories.length > 0 && (
        <div className="border-t border-gray-100 bg-white md:hidden">
          <div className="mx-auto max-w-7xl space-y-1 px-4 py-3 sm:px-6">
            {topCategories.map((cat) => (
              <Link
                key={cat.id}
                href={cat.slug ? `/categories/${cat.slug}` : `/?categoryId=${cat.id}`}
                onClick={() => setMobileMenuOpen(false)}
                className="block rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                {cat.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      <CartSidebar />
    </header>
  )
}
