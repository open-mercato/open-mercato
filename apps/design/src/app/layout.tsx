import type { Metadata } from 'next'
import { designDictionary } from '@/lib/design-dictionary'
import { THEME_INIT_SCRIPT } from '@/lib/theme-init'
import './globals.css'

export const metadata: Metadata = {
  title: { default: designDictionary['design.meta.siteName'], template: `%s | ${designDictionary['design.meta.siteName']}` },
  description: designDictionary['design.meta.description'],
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased" suppressHydrationWarning>
        <script id="om-design-theme-init" dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {children}
      </body>
    </html>
  )
}
