import { createServer } from 'node:net'
import { getFreePort, isPortAvailable, redactPostgresUrl } from '../runtime-utils'

async function listen(host: string, port: number): Promise<{ close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(port, host, () => {
      resolve({
        close: () => new Promise((closeResolve, closeReject) => {
          server.close((error) => {
            if (error) {
              closeReject(error)
              return
            }
            closeResolve()
          })
        }),
      })
    })
  })
}

describe('integration port helpers', () => {
  it('treats wildcard IPv6 listeners as occupying the app port', async () => {
    const port = await getFreePort()
    let listener: { close: () => Promise<void> } | null = null

    try {
      listener = await listen('::', port)
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code
      if (errorCode === 'EAFNOSUPPORT') {
        return
      }
      throw error
    }

    try {
      await expect(isPortAvailable(port)).resolves.toBe(false)
    } finally {
      await listener.close()
    }
  })
})

describe('redactPostgresUrl', () => {
  it('redacts password in a postgres url', () => {
    const redacted = redactPostgresUrl('postgresql://postgres:supersecret@127.0.0.1:5432/demo')
    expect(redacted).toContain('postgres:***@127.0.0.1:5432/demo')
    expect(redacted).not.toContain('supersecret')
  })

  it('preserves url when no password is present', () => {
    const url = 'postgresql://127.0.0.1:5432/demo'
    expect(redactPostgresUrl(url)).toBe(url)
  })

  it('redacts invalid-url fallback format', () => {
    const redacted = redactPostgresUrl('postgres://user:topsecret@db.internal/mydb')
    expect(redacted).toContain('postgres://user:***@db.internal/mydb')
    expect(redacted).not.toContain('topsecret')
  })
})
