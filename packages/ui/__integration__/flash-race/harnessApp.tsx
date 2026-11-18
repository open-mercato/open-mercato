/**
 * Browser-only entry bundled by `startFlashRaceHarnessServer.ts` for
 * TC-UI-FLASH-001. Mounts the real `<FlashMessages />` component (not a
 * stand-in) twice, under test-only imperative controls, so a Playwright test
 * can reproduce the #8471 late-secondary host race in an actual browser
 * instead of jsdom. This file is never imported by application or package
 * build output — it lives outside `src/` and is read directly off disk by
 * esbuild at test time.
 */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { FlashMessages } from '../../src/backend/FlashMessages'

export type FlashRaceHarness = {
  mountSecondary: () => void
  unmountSecondary: () => void
  navigate: (href: string) => void
}

declare global {
  interface Window {
    __flashRaceHarness?: FlashRaceHarness
  }
}

function Harness() {
  const [secondaryMounted, setSecondaryMounted] = React.useState(false)

  React.useEffect(() => {
    window.__flashRaceHarness = {
      mountSecondary: () => setSecondaryMounted(true),
      unmountSecondary: () => setSecondaryMounted(false),
      navigate: (href: string) => {
        window.history.pushState({}, '', href)
      },
    }
    return () => {
      delete window.__flashRaceHarness
    }
  }, [])

  return (
    <div data-testid="flash-race-harness">
      <FlashMessages />
      {secondaryMounted ? <FlashMessages /> : null}
    </div>
  )
}

const container = document.getElementById('app')
if (container) {
  createRoot(container).render(<Harness />)
}
