import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { bootstrap } from '@/bootstrap'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'

// Bootstrap all package registrations at module load time
bootstrap()
import { ThemeProvider, FrontendLayout, QueryProvider, AuthFooter } from '@open-mercato/ui'
import { ClientBootstrapProvider } from '@/components/ClientBootstrap'
import { GlobalNoticeBars } from '@/components/GlobalNoticeBars'
import { detectLocale, loadDictionary, resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await resolveTranslations()
  return {
    title: t('app.metadata.title', 'Open Mercato'),
    description: t('app.metadata.description', 'AI‑supportive, modular ERP foundation for product & service companies'),
    icons: {
      icon: "/open-mercato.svg",
    },
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await detectLocale()
  const dict = await loadDictionary(locale)
  const demoModeEnabled = process.env.DEMO_MODE !== 'false'
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var stored = localStorage.getItem('om-theme');
                  var theme = stored === 'dark' ? 'dark'
                    : stored === 'light' ? 'light'
                    : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
                  if (theme === 'dark') document.documentElement.classList.add('dark');
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`} suppressHydrationWarning data-gramm="false">
        <I18nProvider locale={locale} dict={dict}>
          <ClientBootstrapProvider>
            <ThemeProvider>
              <QueryProvider>
                <FrontendLayout footer={<AuthFooter />}>{children}</FrontendLayout>
                <GlobalNoticeBars demoModeEnabled={demoModeEnabled} />
              </QueryProvider>
            </ThemeProvider>
          </ClientBootstrapProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
