// This file is mirrored verbatim between:
//   - apps/mercato/src/lib/dev-origins.ts
//   - packages/create-app/template/src/lib/dev-origins.ts
// Scaffolded standalone apps cannot import @open-mercato/*, so the
// duplication is deliberate. Keep both copies in sync when editing; CI
// runs `yarn template:sync` to enforce parity.

function readOriginHostname(raw: string | undefined): string | null {
  const value = raw?.trim()
  if (!value) return null

  try {
    return new URL(value).hostname
  } catch {
    return null
  }
}

function readCsv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

export function resolveAllowedDevOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const origins = new Set<string>()

  for (const raw of [env.APP_URL, env.NEXT_PUBLIC_APP_URL, ...readCsv(env.APP_ALLOWED_ORIGINS)]) {
    const hostname = readOriginHostname(raw)
    if (hostname) {
      origins.add(hostname)
    }
  }

  return Array.from(origins)
}
