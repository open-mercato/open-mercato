import fs from 'node:fs'

export const PLAYWRIGHT_BROWSERS_DOCS_URL = 'https://playwright.dev/docs/browsers'

// The preflight has to model the same browser resolution `.ai/qa/tests/playwright.config.ts`
// performs, or it rejects setups the suite it guards runs fine on: the config honors
// PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH so containers can supply a system Chromium instead of
// Playwright's managed download, and `chromium.executablePath()` knows nothing about it.
export function findChromiumPreflightFailure({
  env = process.env,
  resolveManagedExecutablePath,
  exists = fs.existsSync,
} = {}) {
  const override = env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim()

  if (override) {
    if (exists(override)) return null
    return {
      reason: 'override-missing',
      message: `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH points at a binary that does not exist: ${override}`,
      remedies: [
        'Point PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH at an existing Chromium binary,',
        'or unset it to fall back to Playwright\'s managed browsers.',
      ],
    }
  }

  let managedExecutablePath = null
  try {
    managedExecutablePath = resolveManagedExecutablePath()
  } catch {
    managedExecutablePath = null
  }

  if (managedExecutablePath && exists(managedExecutablePath)) return null

  return {
    reason: 'managed-browser-missing',
    message: 'Playwright browsers are not installed. Run the following before retrying:',
    remedies: [
      'yarn playwright install',
      'yarn playwright install-deps   (Linux only, may require sudo)',
    ],
  }
}
