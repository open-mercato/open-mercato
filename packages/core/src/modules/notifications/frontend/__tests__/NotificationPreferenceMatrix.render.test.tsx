/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  NotificationPreferenceMatrix,
  PREFERENCE_CHANNELS,
  preferenceKey,
  type NotificationTypeItem,
} from '../NotificationPreferenceMatrix'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}))

const types: NotificationTypeItem[] = [
  { id: 'a.one', labelKey: 'a.one.title' },
  { id: 'security.alert', labelKey: 'security.alert.title', nonOptOut: true },
]

function renderMatrix(onToggle = jest.fn()) {
  render(
    <NotificationPreferenceMatrix
      types={types}
      prefs={{}}
      onToggle={onToggle}
    />,
  )
  return { onToggle, switches: screen.getAllByRole('switch') }
}

describe('NotificationPreferenceMatrix (render)', () => {
  it('renders one switch per type x channel cell', () => {
    const { switches } = renderMatrix()
    expect(switches).toHaveLength(types.length * PREFERENCE_CHANNELS.length)
  })

  it('locks nonOptOut cells ON and disabled, and ignores toggle attempts', () => {
    const { onToggle, switches } = renderMatrix()
    // The last PREFERENCE_CHANNELS.length switches belong to the nonOptOut (security.alert) row.
    const lockedSwitches = switches.slice(-PREFERENCE_CHANNELS.length)
    for (const node of lockedSwitches) {
      expect(node).toBeDisabled()
      expect(node).toHaveAttribute('aria-checked', 'true')
      fireEvent.click(node)
    }
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('keeps opt-in cells toggleable', () => {
    const onToggle = jest.fn()
    const { switches } = renderMatrix(onToggle)
    const firstOptInSwitch = switches[0]
    expect(firstOptInSwitch).not.toBeDisabled()
    fireEvent.click(firstOptInSwitch)
    expect(onToggle).toHaveBeenCalledWith('a.one', PREFERENCE_CHANNELS[0].key, false)
  })

  it('respects stored opt-in preference values for non-locked cells', () => {
    const onToggle = jest.fn()
    render(
      <NotificationPreferenceMatrix
        types={types}
        prefs={{ [preferenceKey('a.one', PREFERENCE_CHANNELS[0].key)]: false }}
        onToggle={onToggle}
      />,
    )
    const first = screen.getAllByRole('switch')[0]
    expect(first).toHaveAttribute('aria-checked', 'false')
  })

  it('locks ineligible channels OFF and disabled, with the admin hint (not the required hint)', () => {
    const onToggle = jest.fn()
    const eligibleChannels = PREFERENCE_CHANNELS.map((channel) => channel.key).filter(
      (key) => key !== PREFERENCE_CHANNELS[0].key,
    )
    render(
      <NotificationPreferenceMatrix
        types={[{ id: 'a.one', labelKey: 'a.one.title', channels: eligibleChannels }]}
        prefs={{ [preferenceKey('a.one', PREFERENCE_CHANNELS[0].key)]: true }}
        onToggle={onToggle}
      />,
    )
    const switches = screen.getAllByRole('switch')
    const lockedOff = switches[0]
    // Locked OFF even though the user has a stored opt-in for the cell.
    expect(lockedOff).toBeDisabled()
    expect(lockedOff).toHaveAttribute('aria-checked', 'false')
    expect(lockedOff).toHaveAccessibleName(expect.stringContaining('administrator'))
    fireEvent.click(lockedOff)
    expect(onToggle).not.toHaveBeenCalled()
    // Channels inside the eligible set stay toggleable.
    expect(switches[1]).not.toBeDisabled()
  })

  it('the ineligible-channel lock (OFF) beats the nonOptOut lock (ON) in the same row', () => {
    const eligibleChannels = PREFERENCE_CHANNELS.map((channel) => channel.key).slice(1)
    render(
      <NotificationPreferenceMatrix
        types={[{ id: 'security.alert', labelKey: 'security.alert.title', nonOptOut: true, channels: eligibleChannels }]}
        prefs={{}}
        onToggle={jest.fn()}
      />,
    )
    const switches = screen.getAllByRole('switch')
    expect(switches[0]).toHaveAttribute('aria-checked', 'false')
    expect(switches[0]).toBeDisabled()
    expect(switches[1]).toHaveAttribute('aria-checked', 'true')
    expect(switches[1]).toBeDisabled()
  })
})
