import {
  LAUNCH_ARGS,
  SANDBOX_OPT_OUT_ENV,
  isSandboxDisabled,
  isSandboxFailure,
  launchChromium,
  resolveLaunchArgs,
  type BrowserType,
} from '../playwright'
import { SidecarError } from '../protocol'

describe('Chromium sandbox posture', () => {
  it('keeps the sandbox on by default', () => {
    // This adapter renders pages chosen by a search engine or a model, so the
    // renderer parses hostile input by definition. `--no-sandbox` turns a
    // renderer compromise into code running as the app's own user.
    expect(LAUNCH_ARGS).not.toContain('--no-sandbox')
    expect(resolveLaunchArgs({})).not.toContain('--no-sandbox')
    expect(isSandboxDisabled({})).toBe(false)
  })

  it('disables it only on an explicit opt-out', () => {
    const env = { [SANDBOX_OPT_OUT_ENV]: '1' } as NodeJS.ProcessEnv
    expect(resolveLaunchArgs(env)).toContain('--no-sandbox')
    expect(isSandboxDisabled(env)).toBe(true)
    // Anything other than the exact opt-out keeps the sandbox.
    expect(resolveLaunchArgs({ [SANDBOX_OPT_OUT_ENV]: 'true' } as NodeJS.ProcessEnv)).not.toContain(
      '--no-sandbox',
    )
  })

  it('recognises Chromium refusing to run unsandboxed', () => {
    expect(isSandboxFailure(new Error('Running as root without --no-sandbox is not supported.'))).toBe(true)
    expect(isSandboxFailure(new Error('No usable sandbox! Update your kernel'))).toBe(true)
    expect(isSandboxFailure(new Error('Executable doesn\'t exist at /root/.cache/ms-playwright'))).toBe(false)
  })

  it('refuses to fall back to an unsandboxed browser on its own', async () => {
    const browserType = {
      launch: async () => {
        throw new Error('Running as root without --no-sandbox is not supported.')
      },
    } as unknown as BrowserType

    const error = await launchChromium(browserType, { headless: true }).catch((caught: unknown) => caught)

    // A silent retry without the sandbox would make the security posture depend
    // on container configuration with nobody told which one they got.
    expect(error).toBeInstanceOf(SidecarError)
    expect(String((error as Error).message)).toContain(SANDBOX_OPT_OUT_ENV)
  })

  it('still auto-installs a missing browser binary', async () => {
    let launches = 0
    const browserType = {
      launch: async () => {
        launches += 1
        if (launches === 1) throw new Error("Executable doesn't exist at /ms-playwright/chromium/chrome")
        return { newContext: async () => ({}), close: async () => {} }
      },
    } as unknown as BrowserType

    await launchChromium(browserType, { headless: true }, { install: async () => {} })

    expect(launches).toBe(2)
  })
})
