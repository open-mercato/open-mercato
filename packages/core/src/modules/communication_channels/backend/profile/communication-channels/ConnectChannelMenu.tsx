'use client'

import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { extensionPoints } from '@open-mercato/core/modules/communication_channels/extension-points'
import { Button } from '@open-mercato/ui/primitives/button'
import { InjectionSpot, useInjectionWidgets } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'

const CONNECT_MENU_TRIGGER_ID = 'communication-channels-connect-trigger'
const CONNECT_MENU_PANEL_ID = 'communication-channels-connect-menu'

type ConnectChannelMenuProps = {
  onConnected: () => void
}

/**
 * Single "Connect channel" entry point for the profile page.
 *
 * Every `channel-*` package injects its own connect control into the
 * `profile:communication-channels:connect` spot. Rendering that spot inline put
 * each provider button side by side in the page header, unspaced and growing
 * wider with every installed provider (#5595). The widgets now stack inside a
 * dropdown, so a new provider lengthens a list instead of widening a row.
 *
 * The panel stays mounted and is hidden with CSS rather than being conditionally
 * rendered: `channel-imap` and `channel-discord` own their connect `Dialog`
 * inside the injected widget, so unmounting the panel on close would tear down
 * an open dialog.
 */
export function ConnectChannelMenu({ onConnected }: ConnectChannelMenuProps): React.JSX.Element | null {
  const t = useT()
  const spotId = extensionPoints.hosts.profileConnect.spotId
  const [open, setOpen] = React.useState(false)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const triggerRef = React.useRef<HTMLButtonElement>(null)

  const context = React.useMemo(() => ({ reload: onConnected }), [onConnected])
  const { widgets } = useInjectionWidgets(spotId, { context, triggerOnLoad: true })

  React.useEffect(() => {
    if (!open) return
    function onDocumentMouseDown(event: MouseEvent) {
      const target = event.target as Node
      if (containerRef.current && !containerRef.current.contains(target)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('mousedown', onDocumentMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onDocumentMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (widgets.length === 0) return null

  return (
    <div ref={containerRef} className="relative inline-block text-left">
      <Button
        ref={triggerRef}
        id={CONNECT_MENU_TRIGGER_ID}
        type="button"
        variant="outline"
        aria-expanded={open}
        aria-controls={CONNECT_MENU_PANEL_ID}
        onClick={() => setOpen((current) => !current)}
      >
        {t('communication_channels.profile.connect.menu', 'Connect channel')}
        <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
      </Button>
      {/* A disclosure group, not `role="menu"`: the rows are provider-owned
          widgets rendering plain buttons, and ARIA only allows `menuitem`-shaped
          children under a menu — declaring one would hide them from assistive
          technology instead of describing them. */}
      <div
        id={CONNECT_MENU_PANEL_ID}
        role="group"
        aria-labelledby={CONNECT_MENU_TRIGGER_ID}
        data-testid="connect-channel-menu-panel"
        className={cn(
          // Anchoring flips with the header: the header wraps on a phone, which
          // moves the trigger to the left edge, and right-anchoring a panel
          // wider than the trigger then pushes it off-screen. Left-anchor below
          // `sm`, right-anchor from `sm` up where the trigger sits right. The
          // `max-w-` clamp (mirroring RowActions) keeps a long provider label
          // from widening the panel past the viewport either way.
          'absolute left-0 top-full z-dropdown mt-2 w-max min-w-56 max-w-[calc(100vw-1rem)] flex-col items-stretch gap-2 rounded-md border bg-background p-2 shadow-md sm:left-auto sm:right-0',
          open ? 'flex' : 'hidden',
        )}
      >
        <InjectionSpot spotId={spotId} context={context} data={{}} widgetsOverride={widgets} />
      </div>
    </div>
  )
}

export default ConnectChannelMenu
