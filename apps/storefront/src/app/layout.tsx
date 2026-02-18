import type { Metadata } from 'next'
import { fetchStoreContext, fetchCategories } from '@/lib/api'
import { StoreContextProvider } from '@/lib/storeContext'
import { StorefrontLayout } from '@/components/StorefrontLayout'
import './globals.css'

export async function generateMetadata(): Promise<Metadata> {
  const ctx = await fetchStoreContext()
  return {
    title: {
      default: ctx?.store.name ?? 'Store',
      template: `%s | ${ctx?.store.name ?? 'Store'}`,
    },
    description: `Shop at ${ctx?.store.name ?? 'our store'}`,
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [storeContext, categories] = await Promise.all([
    fetchStoreContext(),
    fetchCategories().catch(() => []),
  ])

  return (
    <html lang={storeContext?.effectiveLocale ?? 'en'}>
      <body>
        <StoreContextProvider initialContext={storeContext}>
          <StorefrontLayout categories={categories}>
            {children}
          </StorefrontLayout>
        </StoreContextProvider>
      </body>
    </html>
  )
}
