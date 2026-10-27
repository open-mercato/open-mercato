import { launchChromium, type BrowserHandle, type BrowserType } from '../playwright'

const MISSING_BINARY = "Executable doesn't exist at /root/.cache/ms-playwright/chromium-1140/chrome-linux/chrome"

const fakeBrowser = { newContext: async () => ({}) as never, close: async () => {} } as BrowserHandle

function browserThatFails(times: number, message: string): BrowserType & { launches: number } {
  const type = {
    launches: 0,
    async launch() {
      type.launches += 1
      if (type.launches <= times) throw new Error(message)
      return fakeBrowser
    },
  }
  return type as BrowserType & { launches: number }
}

describe('launchChromium', () => {
  it('launches directly when the binary is present', async () => {
    const type = browserThatFails(0, MISSING_BINARY)
    const install = jest.fn(async () => {})

    await expect(launchChromium(type, { headless: true }, { install })).resolves.toBe(fakeBrowser)
    expect(install).not.toHaveBeenCalled()
    expect(type.launches).toBe(1)
  })

  // Installing the npm package does not fetch the ~150MB browser, so an operator
  // who enables the tier would otherwise hit a dead-end launch failure.
  it('downloads the binary once and retries the launch', async () => {
    const type = browserThatFails(1, MISSING_BINARY)
    const install = jest.fn(async () => {})
    const progress: string[] = []

    await expect(
      launchChromium(type, { headless: true }, { install, onProgress: (line) => progress.push(line) }),
    ).resolves.toBe(fakeBrowser)

    expect(install).toHaveBeenCalledTimes(1)
    expect(type.launches).toBe(2)
    expect(progress.join(' ')).toContain('one-time')
  })

  it('does not retry a launch failure that is not a missing binary', async () => {
    const type = browserThatFails(1, 'Target page crashed')
    const install = jest.fn(async () => {})

    await expect(launchChromium(type, { headless: true }, { install })).rejects.toThrow('Target page crashed')
    expect(install).not.toHaveBeenCalled()
  })

  it('reports an actionable error when the download itself fails', async () => {
    const type = browserThatFails(1, MISSING_BINARY)
    const install = jest.fn(async () => {
      throw new Error('ENOTFOUND registry.npmjs.org')
    })

    await expect(launchChromium(type, { headless: true }, { install })).rejects.toThrow(
      /auto-install failed.*ENOTFOUND.*manually/is,
    )
  })

  it('gives up after one retry rather than looping', async () => {
    const type = browserThatFails(5, MISSING_BINARY)
    const install = jest.fn(async () => {})

    await expect(launchChromium(type, { headless: true }, { install })).rejects.toThrow(/Executable doesn't exist/)
    expect(install).toHaveBeenCalledTimes(1)
    expect(type.launches).toBe(2)
  })
})
