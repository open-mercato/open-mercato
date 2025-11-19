import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { I18nProvider } from '@/lib/i18n/context'
import { ThemeProvider, FrontendLayout, QueryProvider, AuthFooter } from '@open-mercato/ui'
import { GlobalNoticeBars } from '@/components/GlobalNoticeBars'
import { detectLocale, loadDictionary } from '@/lib/i18n/server'

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Open Mercato",
  description: "AI‑supportive, modular ERP foundation for product & service companies",
  icons: {
    icon: "/open-mercato.svg",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await detectLocale()
  const dict = await loadDictionary(locale)
  const demoModeEnabled = process.env.DEMO_MODE !== 'false'
  return (
    <html lang={locale}>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`} suppressHydrationWarning data-gramm="false">
        <I18nProvider locale={locale} dict={dict}>
          <ThemeProvider>
            <QueryProvider>
              <FrontendLayout footer={<AuthFooter />}>{children}</FrontendLayout>
              <GlobalNoticeBars demoModeEnabled={demoModeEnabled} />
            </QueryProvider>
          </ThemeProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
