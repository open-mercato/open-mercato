"use client"

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/i18n/context'

const DEMO_NOTICE_COOKIE = 'om_demo_notice_ack'
const COOKIE_NOTICE_COOKIE = 'om_cookie_notice_ack'

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.split(';').map((entry) => entry.trim()).find((entry) => entry.startsWith(`${name}=`))
  return match ? match.split('=').slice(1).join('=') : null
}

function setCookie(name: string, value: string, days = 365) {
  if (typeof document === 'undefined') return
  const maxAge = days * 24 * 60 * 60
  document.cookie = `${name}=${value}; path=/; max-age=${maxAge}; SameSite=Lax`
}

export function GlobalNoticeBars({ demoModeEnabled }: { demoModeEnabled: boolean }) {
  const t = useT()
  const [showDemoNotice, setShowDemoNotice] = useState(false)
  const [showCookieNotice, setShowCookieNotice] = useState(false)

  useEffect(() => {
    if (demoModeEnabled && !getCookie(DEMO_NOTICE_COOKIE)) {
      setShowDemoNotice(true)
    }
    if (!getCookie(COOKIE_NOTICE_COOKIE)) {
      setShowCookieNotice(true)
    }
  }, [demoModeEnabled])

  const activeBars = [showDemoNotice, showCookieNotice].filter(Boolean).length
  if (activeBars === 0) return null

  const handleDismissDemo = () => {
    setCookie(DEMO_NOTICE_COOKIE, 'ack')
    setShowDemoNotice(false)
  }

  const handleDismissCookies = () => {
    setCookie(COOKIE_NOTICE_COOKIE, 'dismissed')
    setShowCookieNotice(false)
  }

  const handleAcceptCookies = () => {
    setCookie(COOKIE_NOTICE_COOKIE, 'ack')
    setShowCookieNotice(false)
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[70] flex flex-col items-center gap-3 px-4">
      {showDemoNotice ? (
        <div className="pointer-events-auto w-full max-w-4xl rounded-lg border border-amber-200 bg-amber-50/90 p-4 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-amber-50/70 dark:border-amber-900/70 dark:bg-amber-950/40">
          <div className="flex items-start gap-3">
            <div className="flex-1 text-sm text-amber-900 dark:text-amber-50 space-y-1">
              <p className="font-medium">{t('notices.demo.title', 'Demo Environment')}</p>
              <p>
                {t('notices.demo.description', 'This instance is provided for demo purposes only. Data may be reset at any time and is not retained for any guaranteed period.')}
              </p>
              <p>
                {t('notices.demo.superadminQuestion', 'Need persistent superadmin access?')}{' '}
                <a
                  href="https://github.com/open-mercato"
                  target="_blank"
                  rel="noreferrer"
                  className="underline font-medium hover:text-amber-800 dark:hover:text-amber-200"
                >
                  {t('notices.demo.installLink', 'Install Open Mercato locally')}
                </a>
                . {t('notices.demo.reviewLinks', 'Review our')}{' '}
                <Link className="underline font-medium hover:text-amber-800 dark:hover:text-amber-200" href="/terms">
                  {t('common.terms')}
                </Link>{' '}
                {t('notices.demo.and', 'and')}{' '}
                <Link className="underline font-medium hover:text-amber-800 dark:hover:text-amber-200" href="/privacy">
                  {t('common.privacy')}
                </Link>
                .
              </p>
            </div>
            <Button variant="ghost" size="icon" onClick={handleDismissDemo} className="shrink-0 text-amber-900 dark:text-amber-100">
              <X className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}

      {showCookieNotice ? (
        <div className="pointer-events-auto w-full max-w-4xl rounded-lg border border-slate-300 bg-background/95 p-4 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80 dark:border-slate-700">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-muted-foreground">
              {t('notices.cookies.description', 'We use essential cookies to remember your preferences. Learn how we handle data in our')}{' '}
              <Link className="underline font-medium hover:text-foreground" href="/privacy">
                {t('common.privacy')}
              </Link>.
            </div>
            <div className="flex items-center gap-2 self-end sm:self-auto">
              <Button variant="ghost" size="sm" onClick={handleDismissCookies}>
                {t('notices.cookies.dismiss', 'Dismiss')}
              </Button>
              <Button size="sm" onClick={handleAcceptCookies}>
                {t('notices.cookies.accept', 'Accept cookies')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
