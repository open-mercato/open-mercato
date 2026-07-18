'use client'

import * as React from 'react'
import { createInactivityTimer, DEFAULT_INACTIVITY_TIMEOUT_MINUTES } from '../../../lib/inactivityTimer.js'

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'] as const

/**
 * Client-side auto-logout for the operator "lite" panel (task 4.3, DoD:
 * "inactivity logout fires"). Wraps the pure `createInactivityTimer` core
 * (unit-tested with fake timers in `lib/__tests__/inactivityTimer.test.ts`)
 * with `window` activity listeners and the platform logout call — this
 * wrapper itself is `[tdd:skip:ui-covered-by-integration]` (DOM-dependent,
 * not runnable under the package's `testEnvironment: 'node'` jest config).
 *
 * Logs out via the same `POST /api/auth/logout` endpoint the backend
 * shell's user menu uses (`packages/ui/src/backend/UserMenu.tsx`,
 * `ProfileDropdown.tsx`) — a hidden-form submit so the browser follows the
 * route's 302 redirect to `/login`, matching those call sites exactly
 * instead of a raw `fetch` + manual `window.location` redirect.
 */
export function useInactivityLogout(timeoutMinutes: number = DEFAULT_INACTIVITY_TIMEOUT_MINUTES): void {
  React.useEffect(() => {
    const form = document.createElement('form')
    form.method = 'POST'
    form.action = '/api/auth/logout'
    form.style.display = 'none'
    document.body.appendChild(form)

    const timer = createInactivityTimer({
      timeoutMs: timeoutMinutes * 60_000,
      onTimeout: () => {
        form.submit()
      },
    })

    const handleActivity = () => timer.registerActivity()
    for (const eventName of ACTIVITY_EVENTS) {
      window.addEventListener(eventName, handleActivity, { passive: true })
    }

    return () => {
      timer.stop()
      for (const eventName of ACTIVITY_EVENTS) {
        window.removeEventListener(eventName, handleActivity)
      }
      form.remove()
    }
  }, [timeoutMinutes])
}
