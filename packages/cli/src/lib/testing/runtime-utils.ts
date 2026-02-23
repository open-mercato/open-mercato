import { createServer } from 'node:net'

type Node24RuntimeGuardOptions = {
  context: string
  retryCommand: string
}

export function assertNode24Runtime(options: Node24RuntimeGuardOptions): void {
  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10)
  if (major >= 24) {
    return
  }

  throw new Error(
    [
      `Unsupported Node.js runtime for ${options.context}.`,
      `Cause: Detected Node ${process.versions.node}, but this repository requires Node 24.x.`,
      `What to do: switch your shell to Node 24 (for example \`nvm use 24\`), reinstall dependencies (\`yarn install\`), then retry \`${options.retryCommand}\`.`,
    ].join(' '),
  )
}

export async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Unable to allocate free port'))
        return
      }
      const port = address.port
      server.close((closeError) => {
        if (closeError) {
          reject(closeError)
          return
        }
        resolve(port)
      })
    })
  })
}

export async function isPortAvailable(port: number): Promise<boolean> {
  const canBind = (host: string): Promise<boolean | null> => new Promise((resolve) => {
    const server = createServer()
    server.once('error', (error) => {
      const errorCode = (error as NodeJS.ErrnoException).code
      if (errorCode === 'EAFNOSUPPORT') {
        resolve(null)
        return
      }
      resolve(false)
    })
    server.listen(port, host, () => {
      server.close(() => {
        resolve(true)
      })
    })
  })

  const ipv4Availability = await canBind('127.0.0.1')
  if (ipv4Availability === false) {
    return false
  }

  const ipv6Availability = await canBind('::1')
  if (ipv6Availability === false) {
    return false
  }

  return ipv4Availability === true || ipv6Availability === true
}

export async function getPreferredPort(preferredPort: number, logPrefix: string): Promise<number> {
  if (await isPortAvailable(preferredPort)) {
    return preferredPort
  }

  const fallbackPort = await getFreePort()
  console.log(`[${logPrefix}] Port ${preferredPort} is busy, using fallback port ${fallbackPort}.`)
  return fallbackPort
}

export async function isEndpointResponsive(url: string, timeoutMs = 1500): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    })
    return response.status > 0
  } catch {
    return false
  }
}

export function redactPostgresUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) {
    return trimmed
  }

  try {
    const parsed = new URL(trimmed)
    if (parsed.password) {
      parsed.password = '***'
    }
    if (!parsed.username && parsed.password) {
      parsed.username = '***'
    }
    return parsed.toString()
  } catch {
    return trimmed.replace(/(postgres(?:ql)?:\/\/[^:/?#\s]+:)[^@/\s]+@/i, '$1***@')
  }
}
