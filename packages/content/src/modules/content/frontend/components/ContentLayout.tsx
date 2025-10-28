import type { ReactNode } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { cn } from '@open-mercato/shared/lib/utils'

type BreadcrumbItem = {
  label: string
  href?: string
}

type ContentLayoutProps = {
  title: string
  intro?: string
  breadcrumb?: BreadcrumbItem[]
  children: ReactNode
}

export function ContentLayout({ title, intro, breadcrumb, children }: ContentLayoutProps) {
  return (
    <div className="flex min-h-svh flex-col bg-muted/30">
      <header className="border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex w-full max-w-screen-lg items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-3 text-foreground transition hover:text-primary" aria-label="Go to the Open Mercato home page">
            <Image
              src="/open-mercato.svg"
              alt="Open Mercato logo"
              width={32}
              height={32}
              className="dark:invert"
              priority
            />
            <span className="text-base font-semibold tracking-tight">Open Mercato</span>
          </Link>
          <nav aria-label="Primary" className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/">Home</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/login">Login</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto flex w-full max-w-screen-lg flex-col gap-6 px-6 py-10 sm:py-16">
          {breadcrumb && breadcrumb.length > 0 ? (
            <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
              <ol className="flex flex-wrap items-center gap-2">
                {breadcrumb.map((item, index) => (
                  <li key={`${item.label}-${index}`} className="flex items-center gap-2">
                    {index > 0 ? <ChevronRight className="size-3.5 text-border" aria-hidden="true" /> : null}
                    {item.href ? (
                      <Link className="transition hover:text-foreground" href={item.href}>
                        {item.label}
                      </Link>
                    ) : (
                      <span className="font-medium text-foreground">{item.label}</span>
                    )}
                  </li>
                ))}
              </ol>
            </nav>
          ) : null}

          <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <header className="border-b bg-background/70 px-6 py-8 sm:px-10">
              <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{title}</h1>
                {intro ? (
                  typeof intro === 'string' ? (
                    <p className="text-sm text-muted-foreground">{intro}</p>
                  ) : (
                    <div className="text-sm text-muted-foreground">{intro}</div>
                  )
                ) : null}
              </div>
            </header>
            <div className="px-6 py-8 sm:px-10">
              <article
                className={cn(
                  'prose prose-slate max-w-none dark:prose-invert',
                  'prose-headings:font-semibold prose-headings:text-foreground',
                  'prose-p:leading-relaxed prose-li:marker:text-muted-foreground',
                  'prose-a:font-medium prose-a:text-primary prose-a:underline'
                )}
              >
                {children}
              </article>
            </div>
          </section>
        </div>
      </main>

      <footer className="border-t bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex w-full max-w-screen-lg flex-col gap-4 px-6 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 text-muted-foreground transition hover:text-foreground"
            aria-label="Open Mercato"
          >
            <Image src="/open-mercato.svg" alt="Open Mercato logo" width={28} height={28} className="dark:invert" />
            <span className="font-medium text-foreground">Open Mercato</span>
          </Link>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Link className="transition hover:text-foreground" href="/">
              Home
            </Link>
            <Link className="transition hover:text-foreground" href="/login">
              Login
            </Link>
            <Link className="transition hover:text-foreground" href="/terms">
              Terms
            </Link>
            <Link className="transition hover:text-foreground" href="/privacy">
              Privacy
            </Link>
          </div>
          <p className="text-xs text-muted-foreground/80 sm:text-right">
            © {new Date().getFullYear()} Open Mercato. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  )
}
