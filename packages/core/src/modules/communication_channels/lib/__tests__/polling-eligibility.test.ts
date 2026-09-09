/** @jest-environment node */

// Regression for https://github.com/open-mercato/open-mercato/issues/4980 — the
// profile grid used to decide "polled or push?" from a hardcoded provider name
// while the poll worker decided it from `capabilities.realtimePush`. Both now
// share this predicate, so the back-compat default (`realtimePush` absent means
// push) has exactly one definition.

import { isHubPolledChannel } from '../polling-eligibility'

describe('isHubPolledChannel', () => {
  it('treats an explicit realtimePush: false as hub-polled', () => {
    expect(isHubPolledChannel({ realtimePush: false })).toBe(true)
  })

  it('treats realtimePush: true as push-driven, never polled', () => {
    expect(isHubPolledChannel({ realtimePush: true })).toBe(false)
  })

  it('defaults an omitted realtimePush to push-driven for back-compat', () => {
    expect(isHubPolledChannel({ threading: true })).toBe(false)
  })

  it('treats missing or malformed capabilities as push-driven', () => {
    expect(isHubPolledChannel(null)).toBe(false)
    expect(isHubPolledChannel(undefined)).toBe(false)
    expect(isHubPolledChannel([{ realtimePush: false }])).toBe(false)
    expect(isHubPolledChannel('realtimePush')).toBe(false)
  })

  it('does not accept a falsy-but-not-false realtimePush as polling', () => {
    expect(isHubPolledChannel({ realtimePush: 0 })).toBe(false)
    expect(isHubPolledChannel({ realtimePush: null })).toBe(false)
  })
})
