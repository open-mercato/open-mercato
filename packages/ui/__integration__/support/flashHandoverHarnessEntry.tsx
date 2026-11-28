/**
 * Test-only entry point for TC-UI-FLASH-001. Not part of any shipped app route —
 * `serveFlashHandoverHarness.ts` bundles this file with esbuild and serves it from
 * an ephemeral local HTTP server, so a real browser can mount two actual
 * `<FlashMessages/>` hosts without a Next.js app.
 *
 * Mounts two hosts exactly like `FrontendLayout` + `AppShell` do in the real app
 * (see FlashMessages.tsx's module doc comment): whichever host's effect runs
 * first becomes primary. The harness exposes a button to unmount just the first
 * host, simulating `AppShell` tearing down while the other host stays mounted.
 */
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { FlashMessages } from '../../src/backend/FlashMessages'

function Harness() {
  const [primaryMounted, setPrimaryMounted] = React.useState(true)

  return (
    <div>
      {primaryMounted ? <FlashMessages /> : null}
      <FlashMessages />
      <button
        type="button"
        data-testid="unmount-primary-host"
        onClick={() => setPrimaryMounted(false)}
      >
        Unmount primary host
      </button>
    </div>
  )
}

const container = document.getElementById('root')
if (container) {
  createRoot(container).render(<Harness />)
}
