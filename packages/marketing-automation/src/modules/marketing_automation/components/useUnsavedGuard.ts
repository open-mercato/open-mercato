"use client"

import * as React from 'react'

/**
 * Stops an authored-but-unsaved screen being abandoned by accident.
 *
 * The campaign editor holds a whole graph in local state — triggers, steps, an audience expression, canvas
 * positions — and tracked `dirty` only to grey out the Save button. Clicking the breadcrumb, a sidebar link or the
 * browser's back button threw all of it away without a word. `CrudForm` has protected against exactly this for a
 * long time, but the editor is not a `CrudForm` (there is no single record behind it) and the platform does not
 * expose that protection on its own, so this is the module's own, smaller version of the same idea.
 *
 * Two hooks into the browser, because they catch different things:
 *
 *  - `beforeunload` covers closing the tab, reloading, and typing a different URL. The browser shows its own
 *    wording and will not let us choose it — which is why the click intercept below exists as well.
 *  - a capturing click listener covers in-app navigation, which never unloads the page at all. It asks with the
 *    screen's own dialogue and then performs the navigation itself, so a "yes" does what the click meant.
 *
 * Deliberately NOT a router-level guard: Next's App Router has no supported way to cancel a client navigation,
 * and the tricks that appear to work — patching `history.pushState`, throwing in a layout — break the back button
 * in ways that are worse than the problem.
 */
export function useUnsavedGuard(
  dirty: boolean,
  confirmLeave: () => Promise<boolean>,
): void {
  /**
   * Read through refs inside the listeners.
   *
   * The listeners are installed once per dirty transition and would otherwise close over the values from that
   * render — the same stale-closure trap that defeated the segments screen's own guard through a memo's
   * dependency list.
   */
  const dirtyRef = React.useRef(dirty)
  const confirmRef = React.useRef(confirmLeave)
  const leavingRef = React.useRef(false)

  React.useEffect(() => { dirtyRef.current = dirty }, [dirty])
  React.useEffect(() => { confirmRef.current = confirmLeave }, [confirmLeave])

  React.useEffect(() => {
    if (!dirty) return

    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current || leavingRef.current) return
      event.preventDefault()
      // Required by browsers that still honour the legacy property; the message itself is theirs, not ours.
      event.returnValue = ''
    }

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || !dirtyRef.current || leavingRef.current) return
      // Anything but a plain left click is the user deliberately opening it elsewhere.
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

      const anchor = (event.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!anchor) return
      const href = anchor.getAttribute('href')
      if (!href) return
      // In-page anchors, mail and phone links and new tabs all leave this screen standing.
      if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return
      if (anchor.target && anchor.target !== '_self') return

      let destination: URL
      try {
        destination = new URL(href, window.location.href)
      } catch {
        return
      }
      if (destination.origin !== window.location.origin) return
      if (destination.pathname === window.location.pathname && destination.search === window.location.search) return

      event.preventDefault()
      void (async () => {
        const proceed = await confirmRef.current()
        if (!proceed) return
        /**
         * The guard stands down BEFORE navigating.
         *
         * Otherwise `beforeunload` fires on the way out and the person is asked twice about the same decision,
         * which reads as the first answer not having registered.
         */
        leavingRef.current = true
        window.location.assign(destination.href)
      })()
    }

    window.addEventListener('beforeunload', beforeUnload)
    // Capturing, so the intercept runs before a framework link handler navigates on its own.
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      document.removeEventListener('click', onClick, true)
    }
  }, [dirty])
}
