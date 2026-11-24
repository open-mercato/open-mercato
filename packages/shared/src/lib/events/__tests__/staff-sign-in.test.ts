import { readStaffSignInAttemptId } from '../staff-sign-in'

const attemptId = 'bf68d952-8db3-4930-8e7f-b8c7f71dc4a9'

test.each(['auth.login.success', 'auth.login.failed'])('reads a stable attempt ID for %s', (eventName) => {
  expect(readStaffSignInAttemptId(eventName, { attemptId })).toBe(attemptId)
})

test.each([
  ['auth.logout', { attemptId }],
  ['auth.login.success', null],
  ['auth.login.success', 'legacy'],
  ['auth.login.success', {}],
  ['auth.login.success', { attemptId: 1 }],
  ['auth.login.failed', { attemptId: 'not-a-uuid' }],
  ['auth.login.failed', { attemptId: `prefix-${attemptId}` }],
  ['auth.login.failed', { attemptId: `${attemptId}-suffix` }],
] as const)('skips unrelated or legacy payload for %s', (eventName, payload) => {
  expect(readStaffSignInAttemptId(eventName, payload)).toBeNull()
})
