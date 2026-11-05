/**
 * @jest-environment jsdom
 */
import fs from 'node:fs'
import path from 'node:path'
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'

const loadInjectionWidgetsForSpot = jest.fn(async () => [] as unknown[])

jest.mock('@open-mercato/shared/modules/widgets/injection-loader', () => ({
  getInjectionRegistryVersion: () => 0,
  subscribeToInjectionRegistryChanges: () => () => {},
  loadInjectionWidgetsForSpot: (spotId: string) => loadInjectionWidgetsForSpot(spotId as never),
}))

import { ConnectChannelMenu } from '../backend/profile/communication-channels/ConnectChannelMenu'

const mountCounts: Record<string, number> = {}

function makeWidget(id: string, label: string) {
  function Widget() {
    React.useEffect(() => {
      mountCounts[id] = (mountCounts[id] ?? 0) + 1
    }, [])
    return (
      <button type="button" data-testid={`widget-${id}`}>
        {label}
      </button>
    )
  }
  return {
    metadata: { id, title: label, enabled: true },
    Widget,
    moduleId: id.split('.')[0],
    key: id,
  }
}

async function renderMenu(widgets: unknown[]) {
  loadInjectionWidgetsForSpot.mockResolvedValue(widgets)
  const view = render(
    <I18nProvider locale="en" dict={{}}>
      <ConnectChannelMenu onConnected={() => {}} />
    </I18nProvider>,
  )
  await act(async () => {})
  return view
}

function panel(): HTMLElement {
  return screen.getByTestId('connect-channel-menu-panel')
}

beforeEach(() => {
  for (const key of Object.keys(mountCounts)) delete mountCounts[key]
  loadInjectionWidgetsForSpot.mockReset()
})

describe('ConnectChannelMenu (#5595)', () => {
  it('renders nothing when no channel provider injects a connect control', async () => {
    const { container } = await renderMenu([])
    expect(container).toBeEmptyDOMElement()
  })

  it('collapses every injected provider control behind one trigger instead of a widening button row', async () => {
    await renderMenu([
      makeWidget('channel_gmail.injection.connect', 'Connect Gmail'),
      makeWidget('channel_discord.injection.connect', 'Connect Discord'),
      makeWidget('channel_imap.injection.connect', 'Connect IMAP'),
    ])

    const trigger = await screen.findByRole('button', { name: /connect channel/i })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    // The defect: three provider buttons sat directly in the page header, so the
    // row grew wider with every installed provider. Only the trigger is visible now.
    expect(panel()).toHaveClass('hidden')

    fireEvent.click(trigger)
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'true'))
    expect(panel()).not.toHaveClass('hidden')
  })

  it('stacks the injected controls in a spaced column so a new provider lengthens the list', async () => {
    await renderMenu([
      makeWidget('channel_gmail.injection.connect', 'Connect Gmail'),
      makeWidget('channel_imap.injection.connect', 'Connect IMAP'),
    ])

    fireEvent.click(await screen.findByRole('button', { name: /connect channel/i }))

    const menuPanel = panel()
    expect(menuPanel).toHaveClass('flex-col')
    expect(menuPanel).toHaveClass('gap-2')
    expect(menuPanel).toHaveClass('items-stretch')
    // The header wraps on a phone and moves the trigger to the left edge, so a
    // right-anchored panel wider than the trigger runs off-screen and its rows
    // become unreachable — caught in browser QA on #5735 (panel x was -47px at
    // 390px wide). Left-anchor below `sm`, right-anchor from `sm` up.
    expect(menuPanel).toHaveClass('left-0')
    expect(menuPanel).toHaveClass('sm:left-auto')
    expect(menuPanel).toHaveClass('sm:right-0')
    expect(menuPanel).toHaveClass('max-w-[calc(100vw-1rem)]')
    expect(screen.getByTestId('widget-channel_gmail.injection.connect')).toBeInTheDocument()
    expect(screen.getByTestId('widget-channel_imap.injection.connect')).toBeInTheDocument()
  })

  it('keeps the injected widgets mounted while the menu is closed', async () => {
    // channel-imap and channel-discord own their connect Dialog inside the
    // widget, so unmounting the panel on close would tear down an open dialog.
    await renderMenu([makeWidget('channel_imap.injection.connect', 'Connect IMAP')])

    const trigger = await screen.findByRole('button', { name: /connect channel/i })
    await waitFor(() => expect(mountCounts['channel_imap.injection.connect']).toBe(1))

    fireEvent.click(trigger)
    fireEvent.click(trigger)
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'))

    expect(screen.getByTestId('widget-channel_imap.injection.connect')).toBeInTheDocument()
    expect(mountCounts['channel_imap.injection.connect']).toBe(1)
  })

  it('describes the panel as a labelled group, not a menu it cannot populate', async () => {
    // ARIA only allows `menuitem`-shaped children under `role="menu"`, and the
    // rows here are provider-owned widgets rendering plain buttons — declaring a
    // menu would hide them from assistive technology rather than describe them.
    await renderMenu([makeWidget('channel_gmail.injection.connect', 'Connect Gmail')])

    const trigger = await screen.findByRole('button', { name: /connect channel/i })
    const menuPanel = panel()
    expect(menuPanel).toHaveAttribute('role', 'group')
    expect(menuPanel).toHaveAttribute('aria-labelledby', trigger.id)
    expect(trigger).toHaveAttribute('aria-controls', menuPanel.id)
    expect(trigger).not.toHaveAttribute('aria-haspopup')
  })

  it('closes on Escape and on an outside click', async () => {
    await renderMenu([makeWidget('channel_gmail.injection.connect', 'Connect Gmail')])
    const trigger = await screen.findByRole('button', { name: /connect channel/i })

    fireEvent.click(trigger)
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'true'))
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'))

    fireEvent.click(trigger)
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'true'))
    fireEvent.mouseDown(document.body)
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'))
  })

  it('stays open while a provider dialog rendered outside the panel is clicked', async () => {
    // channel-imap and channel-discord render their credential Dialog through a
    // portal at document.body, so it is outside the menu container and a click in
    // it looks like an outside click. Closing on those would collapse the panel
    // behind the open dialog — the tear-down the keep-mounted panel prevents.
    await renderMenu([makeWidget('channel_imap.injection.connect', 'Connect IMAP')])
    const trigger = await screen.findByRole('button', { name: /connect channel/i })

    fireEvent.click(trigger)
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'true'))

    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const field = document.createElement('input')
    dialog.appendChild(field)
    document.body.appendChild(dialog)

    try {
      fireEvent.mouseDown(field)
      expect(trigger).toHaveAttribute('aria-expanded', 'true')

      // Escape is the deliberate exception: the provider dialogs are controlled
      // and register no Radix trigger, so nothing hands focus back when they
      // close — Chromium leaves it on <body>. Dismissing both layers and focusing
      // the trigger is the only path that keeps a keyboard user oriented, so the
      // menu handles Escape even while a dialog is open.
      fireEvent.keyDown(field, { key: 'Escape' })
      await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'))
      expect(trigger).toHaveFocus()
    } finally {
      document.body.removeChild(dialog)
    }
  })
})

// Layout-provenance guards, not behaviour tests: they read page.tsx as text to
// pin the wiring and the header classes that browser QA drove out on #5735,
// which jsdom cannot measure. They are expected to need updating alongside any
// behaviour-preserving refactor of the header — reusing the shared PageHeader,
// for instance — rather than signalling a regression when they fail.
describe('profile page connect header (#5595)', () => {
  const pageSource = fs.readFileSync(
    path.join(__dirname, '..', 'backend', 'profile', 'communication-channels', 'page.tsx'),
    'utf8',
  )

  it('routes the connect spot through the menu instead of dropping it into the header', () => {
    expect(pageSource).toContain('<ConnectChannelMenu')
    expect(pageSource).not.toContain('<InjectionSpot')
  })

  it('spaces the header so the title and the connect trigger never collide', () => {
    const header = pageSource.slice(pageSource.indexOf('<header'), pageSource.indexOf('</header>'))
    // Mirrors the shared PageHeader layout: stacked with a gap on a phone, a
    // spaced row from `sm` up so the trigger stays top-right instead of wrapping
    // below the subtitle — the placement browser QA caught on #5735.
    expect(header).toMatch(/className="[^"]*\bgap-3\b/)
    expect(header).toMatch(/className="[^"]*\bsm:flex-row\b/)
    expect(header).toMatch(/className="[^"]*\bsm:justify-between\b/)
    expect(header).toMatch(/className="[^"]*\bsm:gap-4\b/)
    expect(header).toMatch(/className="min-w-0"/)
  })
})
