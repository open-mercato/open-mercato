import { resolve, dirname } from 'node:path'

const MCP_CONFIG_FILENAME = '.mcp.json'

// Markers that identify a project/repo root. The lookup stops at the first
// ancestor that has one of these, so the secret is only ever read from the
// project root — never from an unbounded walk up to the filesystem root.
const PROJECT_ROOT_MARKERS = ['.git', 'yarn.lock', 'pnpm-lock.yaml', 'package-lock.json'] as const

const log = (message: string, ...args: unknown[]) => {
  console.error(`[MCP Dev] ${message}`, ...args)
}

type PermissionStat = { uid: number; mode: number }

/**
 * Resolve the project root by walking up from `startDir` to the nearest
 * ancestor containing a project-root marker. Falls back to `startDir` (never
 * the filesystem root) when no marker is found, so a planted `.mcp.json` in a
 * writable ancestor such as `/tmp` can never be picked up.
 */
export function findProjectRoot(startDir: string, exists: (path: string) => boolean): string {
  let dir = resolve(startDir)
  while (true) {
    for (const marker of PROJECT_ROOT_MARKERS) {
      if (exists(resolve(dir, marker))) return dir
    }
    const parent = dirname(dir)
    if (parent === dir) return resolve(startDir)
    dir = parent
  }
}

/**
 * Validate the ownership and permissions of `.mcp.json` before its secret is
 * read. Refuses when the file is owned by another user (a planted/shadowed
 * config) and warns loudly when it is accessible to group/other (the key is a
 * live secret). POSIX-only: when `currentUid` is null (e.g. Windows) the checks
 * are skipped.
 */
export function checkMcpConfigPermissions(
  configPath: string,
  fileStat: PermissionStat,
  currentUid: number | null,
  warn: (message: string) => void,
): { ok: boolean; reason?: string } {
  if (currentUid === null) return { ok: true }
  if (fileStat.uid !== currentUid) {
    return {
      ok: false,
      reason: `refusing to read ${configPath}: it is owned by uid ${fileStat.uid}, not the current user (uid ${currentUid})`,
    }
  }
  if ((fileStat.mode & 0o077) !== 0) {
    warn(
      `${configPath} is accessible to group/other (mode ${(fileStat.mode & 0o777).toString(8)}); it contains a live API key — restrict it with: chmod 600 ${configPath}`,
    )
  }
  return { ok: true }
}

/**
 * Resolve the dev MCP server's API key.
 *
 * Priority: `OPEN_MERCATO_API_KEY` env var, then `headers.x-api-key` from a
 * single `.mcp.json` read from the detected project root. The lookup is bounded
 * to the project root (it never walks up to the filesystem root), and the file
 * is ownership/permission-checked before its secret is read.
 */
export async function getApiKeyFromMcpJson(): Promise<string | undefined> {
  const envKey = process.env.OPEN_MERCATO_API_KEY
  if (envKey && envKey.trim().length > 0) {
    return envKey.trim()
  }

  const { readFile, stat } = await import('node:fs/promises')
  const { existsSync } = await import('node:fs')

  try {
    const projectRoot = findProjectRoot(process.cwd(), existsSync)
    const mcpJsonPath = resolve(projectRoot, MCP_CONFIG_FILENAME)
    if (!existsSync(mcpJsonPath)) {
      return undefined
    }

    const fileStat = await stat(mcpJsonPath)
    const currentUid = typeof process.getuid === 'function' ? process.getuid() : null
    const permissionCheck = checkMcpConfigPermissions(
      mcpJsonPath,
      { uid: fileStat.uid, mode: fileStat.mode },
      currentUid,
      (message) => log(`Warning: ${message}`),
    )
    if (!permissionCheck.ok) {
      log(`Error: ${permissionCheck.reason}`)
      return undefined
    }

    const content = await readFile(mcpJsonPath, 'utf-8')
    const config = JSON.parse(content)
    const serverConfig = config?.mcpServers?.['open-mercato']

    return serverConfig?.headers?.['x-api-key']
  } catch {
    return undefined
  }
}
