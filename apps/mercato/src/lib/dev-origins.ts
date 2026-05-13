// This file is mirrored verbatim between:
//   - apps/mercato/src/lib/dev-origins.ts
//   - packages/create-app/template/src/lib/dev-origins.ts
// Scaffolded standalone apps cannot import @open-mercato/*, so the
// duplication is deliberate. Keep both copies in sync when editing; CI
// runs `yarn template:sync` to enforce parity.

const localDevHostAliases = ['localhost', '127.0.0.1', '[::1]', '0.0.0.0', 'host.docker.internal'] as const
const localDevHosts = new Set<string>([...localDevHostAliases, '::1'])

function normalizeHostname(hostname: string): string {
  const normalized = hostname.trim().toLowerCase()
  return normalized === '::1' ? '[::1]' : normalized
}

function isLocalDevHost(hostname: string): boolean {
  return localDevHosts.has(hostname)
}

function isAllowedBareHostname(hostname: string): boolean {
  return isLocalDevHost(hostname) || hostname.includes('.') || hostname.startsWith('*.') || hostname.startsWith('**.')
}

function readUrlOriginHostname(raw: string | undefined): string | null {
  const value = raw?.trim()
  if (!value) return null

  try {
    return normalizeHostname(new URL(value).hostname)
  } catch {
    return null
  }
}

function readAllowedOriginHostname(raw: string | undefined): string | null {
  const value = raw?.trim()
  if (!value || /\s/.test(value)) return null

  const urlHostname = readUrlOriginHostname(value)
  if (urlHostname) return urlHostname

  try {
    const hostname = normalizeHostname(new URL(`http://${value}`).hostname)
    return isAllowedBareHostname(hostname) ? hostname : null
  } catch {
    const hostname = normalizeHostname(value)
    return isAllowedBareHostname(hostname) ? hostname : null
  }
}

function readCsv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function addOriginHostname(origins: Set<string>, hostname: string): void {
  const normalized = normalizeHostname(hostname)
  origins.add(normalized)

  if (isLocalDevHost(normalized)) {
    for (const alias of localDevHostAliases) {
      origins.add(alias)
    }
  }
}

export function resolveAllowedDevOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const origins = new Set<string>()

  for (const raw of [env.APP_URL, env.NEXT_PUBLIC_APP_URL]) {
    const hostname = readUrlOriginHostname(raw)
    if (hostname) {
      addOriginHostname(origins, hostname)
    }
  }

  for (const raw of readCsv(env.APP_ALLOWED_ORIGINS)) {
    const hostname = readAllowedOriginHostname(raw)
    if (hostname) {
      addOriginHostname(origins, hostname)
    }
  }

  return Array.from(origins)
}
