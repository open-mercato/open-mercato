import test from 'node:test'
import assert from 'node:assert/strict'

import { findChromiumPreflightFailure } from '../lib/playwright-browsers.mjs'

// The preflight this backs runs inside `yarn test:create-app:integration`, which needs
// Verdaccio, a full scaffold and a production build — it never executes in CI. These cases
// keep the resolution logic honest there, and pin the branch that matters most: the guard
// must not reject a PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH setup the Playwright config supports.

const managedPath = '/managed/ms-playwright/chromium-1228/chrome'

function resolveManagedTo(value) {
  return () => value
}

test('passes through when the managed Chromium download is present', () => {
  const failure = findChromiumPreflightFailure({
    env: {},
    resolveManagedExecutablePath: resolveManagedTo(managedPath),
    exists: (candidate) => candidate === managedPath,
  })

  assert.equal(failure, null)
})

test('passes through on an executable-path override even with no managed download', () => {
  const override = '/usr/bin/chromium'
  const failure = findChromiumPreflightFailure({
    env: { PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: override },
    resolveManagedExecutablePath: resolveManagedTo(managedPath),
    exists: (candidate) => candidate === override,
  })

  assert.equal(failure, null)
})

test('reports the override itself when it points at a missing binary', () => {
  const override = '/usr/bin/chromium-that-was-removed'
  const failure = findChromiumPreflightFailure({
    env: { PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: override },
    resolveManagedExecutablePath: resolveManagedTo(managedPath),
    exists: (candidate) => candidate === managedPath,
  })

  assert.equal(failure?.reason, 'override-missing')
  assert.match(failure.message, /PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH/)
  assert.match(failure.message, new RegExp(override))
})

// The Playwright config branches on the raw variable, so a whitespace-only setting is an
// override there too — one that reaches the browser as an executable path. The guard has to
// reject it rather than quietly fall back to a managed download the run will not use.
test('an override set to whitespace is reported, not normalized away', () => {
  const failure = findChromiumPreflightFailure({
    env: { PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: '   ' },
    resolveManagedExecutablePath: resolveManagedTo(managedPath),
    exists: (candidate) => candidate === managedPath,
  })

  assert.equal(failure?.reason, 'override-missing')
})

test('an empty override is ignored, matching the config treating it as unset', () => {
  const failure = findChromiumPreflightFailure({
    env: { PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: '' },
    resolveManagedExecutablePath: resolveManagedTo(managedPath),
    exists: (candidate) => candidate === managedPath,
  })

  assert.equal(failure, null)
})

test('reports a missing managed download with the install commands', () => {
  const failure = findChromiumPreflightFailure({
    env: {},
    resolveManagedExecutablePath: resolveManagedTo(managedPath),
    exists: () => false,
  })

  assert.equal(failure?.reason, 'managed-browser-missing')
  assert.ok(failure.remedies.some((remedy) => remedy.includes('yarn playwright install')))
})

test('treats a throwing registry lookup as a missing managed download', () => {
  const failure = findChromiumPreflightFailure({
    env: {},
    resolveManagedExecutablePath: () => {
      throw new Error('registry unavailable')
    },
    exists: () => true,
  })

  assert.equal(failure?.reason, 'managed-browser-missing')
})
