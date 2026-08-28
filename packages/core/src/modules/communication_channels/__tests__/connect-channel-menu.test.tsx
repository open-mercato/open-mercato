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
})

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
    expect(header).toMatch(/className="[^"]*\bgap-4\b/)
  })
})
