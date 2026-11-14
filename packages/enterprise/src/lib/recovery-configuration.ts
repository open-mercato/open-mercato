import { spawn } from 'node:child_process'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, parse, resolve, sep } from 'node:path'

export type RecoveryPaths = { base: string; backupOutput: string; backupWorkspace: string; rotationArtifacts: string; rotationTrust: string; custody: string; serviceFile: string; passwordFile: string; recipientsFile: string; identityFile: string }
export type RecoveryOverrides = Partial<RecoveryPaths> & { binariesDir?: string }
type FileInfo = { kind: 'file' | 'directory' | 'symlink' | 'other'; mode: number; uid: number }
export type RecoveryConfigurationIO = {
  info(path: string): Promise<FileInfo | undefined>
  realpath(path: string): Promise<string>
  readText(path: string): Promise<string | undefined>
  version(path: string, signal?: AbortSignal): Promise<number | undefined>
}
export type RecoveryConfiguration = {
  platform: 'darwin' | 'linux'; arch: string; container: boolean; paths: RecoveryPaths
  binaries: { directory?: string; major?: number; source: string }
  provenance: Record<keyof RecoveryPaths | 'binariesDir', string>
  missingPrerequisites: Array<{ code: string; field: string; path?: string }>
  persistentMount: boolean
  durablePaths: Record<'base' | 'backupOutput' | 'backupWorkspace' | 'rotationArtifacts' | 'rotationTrust' | 'custody', boolean>
}
export class RecoveryConfigurationError extends Error {
  constructor(readonly code: string, readonly field: string) { super(`[internal] ${code}: ${field}`); this.name = 'RecoveryConfigurationError' }
}
const absent = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT'
const nativeIO: RecoveryConfigurationIO = {
  async info(path) {
    try { const value = await lstat(path); return { kind: value.isSymbolicLink() ? 'symlink' : value.isDirectory() ? 'directory' : value.isFile() ? 'file' : 'other', mode: value.mode, uid: value.uid } }
    catch (error) { if (absent(error)) return undefined; throw error }
  },
  realpath,
  async readText(path) {
    try { const value = await readFile(path); if (value.length > 512 * 1024) throw new RecoveryConfigurationError('RECOVERY_METADATA_LIMIT', 'container'); return value.toString('utf8') }
    catch (error) { if (absent(error)) return undefined; throw error }
  },
  async version(path, signal) {
    if (signal?.aborted) throw new RecoveryConfigurationError('RECOVERY_CONFIGURATION_INTERRUPTED', 'binariesDir')
    return new Promise(resolveVersion => {
      const child = spawn(path, ['--version'], { env: { PATH: dirname(path), LC_ALL: 'C', TZ: 'UTC' }, stdio: ['ignore', 'pipe', 'pipe'] })
      let output = '', size = 0, failed = false
      const stop = () => { failed = true; child.kill('SIGKILL') }
      const timer = setTimeout(stop, 3000); timer.unref()
      signal?.addEventListener('abort', stop, { once: true })
      if (signal?.aborted) stop()
      child.stdout.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 4096) stop(); else output += chunk.toString('utf8') })
      child.stderr.on('data', () => undefined)
      child.once('error', () => { failed = true })
      child.once('close', code => { clearTimeout(timer); signal?.removeEventListener('abort', stop); resolveVersion(!failed && code === 0 ? Number(/\(PostgreSQL\)\s+(\d+)/.exec(output)?.[1]) || undefined : undefined) })
    })
  },
}
const directoryFields = ['base', 'backupOutput', 'backupWorkspace', 'rotationArtifacts', 'rotationTrust', 'custody'] as const
const contained = (root: string, path: string) => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep)
const temporary = (path: string) => ['/tmp', '/var/tmp', '/private/tmp', '/private/var/tmp', '/proc', '/sys', '/dev'].some(root => contained(root, path))
const decodeMountPath = (path: string) => path.replace(/\\([0-7]{3})/g, (_match, octal: string) => String.fromCharCode(parseInt(octal, 8)))
function durableMount(path: string, mountInfo: string, writable: boolean): boolean {
  const matches = mountInfo.split('\n').flatMap(line => {
    const [left, right] = line.split(' - ')
    if (!right) return []
    const fields = left.split(' '), filesystem = right.split(' ')[0]
    const mount = decodeMountPath(fields[4] ?? '')
    return mount && contained(mount, path) ? [{ mount, filesystem, options: fields[5] ?? '' }] : []
  }).sort((left, right) => right.mount.length - left.mount.length)
  const found = matches[0]
  return Boolean(found && found.mount !== '/' && !temporary(found.mount) && !['overlay', 'tmpfs', 'ramfs', 'devtmpfs', 'proc', 'sysfs', 'squashfs'].includes(found.filesystem) && (found.options.split(',').includes('rw') || !writable && found.options.split(',').includes('ro')))
}
async function physicalPath(path: string, io: RecoveryConfigurationIO): Promise<string> {
  let current = path
  const suffix: string[] = []
  for (;;) {
    try { return resolve(await io.realpath(current), ...suffix.reverse()) }
    catch (error) { if (!absent(error)) throw error }
    const parent = dirname(current)
    if (parent === current) throw new RecoveryConfigurationError('RECOVERY_PATH_UNRESOLVED', 'base')
    suffix.push(basename(current)); current = parent
  }
}

export async function resolveRecoveryConfiguration(options: {
  overrides?: RecoveryOverrides; env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; arch?: string; homeDirectory?: string
  discoverBinaries?: boolean; io?: RecoveryConfigurationIO; uid?: number; signal?: AbortSignal
} = {}): Promise<RecoveryConfiguration> {
  const env = options.env ?? process.env, overrides = options.overrides ?? {}, io = options.io ?? nativeIO
  const platform = options.platform ?? process.platform, arch = options.arch ?? process.arch, home = options.homeDirectory ?? homedir(), uid = options.uid ?? process.getuid?.() ?? -1
  if (platform !== 'darwin' && platform !== 'linux') throw new RecoveryConfigurationError('RECOVERY_OS_UNSUPPORTED', 'platform')
  if (!isAbsolute(home)) throw new RecoveryConfigurationError('RECOVERY_PATH_INVALID', 'home')
  const container = platform === 'linux' && Boolean(await io.info('/.dockerenv') || /docker|containerd|kubepods|podman/i.test(await io.readText('/proc/1/cgroup') ?? ''))
  const mountInfo = container ? await io.readText('/proc/self/mountinfo') ?? '' : ''
  const provenance = {} as RecoveryConfiguration['provenance']
  const select = (field: keyof RecoveryOverrides, environment: string | undefined, fallback: string): string => {
    const explicit = Object.prototype.hasOwnProperty.call(overrides, field) && overrides[field] !== undefined
    const configured = environment !== undefined && Object.prototype.hasOwnProperty.call(env, environment)
    const value = explicit ? overrides[field] : configured ? env[environment!] : fallback
    if (typeof value !== 'string' || !value.trim() || !isAbsolute(value) || value.includes('\0')) throw new RecoveryConfigurationError('RECOVERY_PATH_INVALID', field)
    provenance[field] = explicit ? 'argument' : configured ? `environment:${environment}` : 'platform-default'
    return resolve(value)
  }
  const nativeBase = platform === 'darwin' ? join(home, 'Library', 'Application Support', 'Open Mercato', 'recovery') : join(env.XDG_STATE_HOME && isAbsolute(env.XDG_STATE_HOME) ? env.XDG_STATE_HOME : join(home, '.local', 'state'), 'open-mercato', 'recovery')
  const base = select('base', 'OM_RECOVERY_ROOT', container ? '/var/lib/open-mercato/recovery' : nativeBase)
  const physicalBase = await physicalPath(base, io)
  if (physicalBase === parse(physicalBase).root || temporary(physicalBase)) throw new RecoveryConfigurationError('RECOVERY_PERSISTENT_ROOT_REQUIRED', 'base')
  const custody = select('custody', undefined, join(base, 'custody'))
  const paths: RecoveryPaths = {
    base, custody,
    backupOutput: select('backupOutput', undefined, join(base, 'backups')),
    backupWorkspace: select('backupWorkspace', undefined, join(base, 'workspace')),
    rotationArtifacts: select('rotationArtifacts', undefined, join(base, 'rotation-artifacts')),
    rotationTrust: select('rotationTrust', undefined, join(base, 'rotation-trust')),
    serviceFile: select('serviceFile', 'PGSERVICEFILE', container ? join(custody, 'pg_service.conf') : join(home, '.pg_service.conf')),
    passwordFile: select('passwordFile', 'PGPASSFILE', container ? join(custody, 'pgpass') : join(home, '.pgpass')),
    recipientsFile: select('recipientsFile', 'OM_BACKUP_RECIPIENTS_FILE', join(custody, 'recipients.txt')),
    identityFile: select('identityFile', 'OM_BACKUP_IDENTITY_FILE', join(custody, 'identity.txt')),
  }
  const missingPrerequisites: RecoveryConfiguration['missingPrerequisites'] = []
  for (const field of directoryFields) {
    const info = await io.info(paths[field])
    if (info && (info.kind !== 'directory' || info.mode & 0o077 || info.uid !== uid)) missingPrerequisites.push({ code: 'RECOVERY_PRIVATE_DIRECTORY_REQUIRED', field, path: paths[field] })
  }
  for (const field of ['serviceFile', 'passwordFile', 'recipientsFile', 'identityFile'] as const) {
    const info = await io.info(paths[field])
    if (!info) missingPrerequisites.push({ code: 'RECOVERY_PRIVATE_FILE_MISSING', field, path: paths[field] })
    else if (info.kind !== 'file' || info.mode & 0o077 || info.uid !== uid) missingPrerequisites.push({ code: 'RECOVERY_PRIVATE_FILE_REQUIRED', field, path: paths[field] })
  }
  const durablePaths = {} as RecoveryConfiguration['durablePaths']
  for (const field of directoryFields) durablePaths[field] = !container || durableMount(await physicalPath(paths[field], io), mountInfo, field !== 'custody')
  if (container) for (const field of directoryFields) if (!durablePaths[field]) missingPrerequisites.push({ code: 'RECOVERY_PERSISTENT_MOUNT_REQUIRED', field, path: paths[field] })
  const binaries: RecoveryConfiguration['binaries'] = { source: options.discoverBinaries === false ? 'not-requested' : 'unavailable' }
  const explicitBinaries = Object.prototype.hasOwnProperty.call(overrides, 'binariesDir') && overrides.binariesDir !== undefined || Object.prototype.hasOwnProperty.call(env, 'OM_BACKUP_BINARIES_DIR')
  const configuredBinaries = explicitBinaries ? select('binariesDir', 'OM_BACKUP_BINARIES_DIR', '') : undefined
  if (configuredBinaries || options.discoverBinaries !== false) {
    const prefixes = platform === 'darwin' ? arch === 'arm64' ? ['/opt/homebrew', '/usr/local'] : ['/usr/local', '/opt/homebrew'] : []
    const pathCandidates = (env.PATH ?? '').split(':').filter(path => path && isAbsolute(path))
    const platformCandidates = platform === 'darwin' ? prefixes.flatMap(prefix => ['postgresql@18', 'postgresql@17', 'postgresql@16', 'libpq', 'postgresql'].map(packageName => join(prefix, 'opt', packageName, 'bin'))) : [18, 17, 16].flatMap(major => [`/usr/lib/postgresql/${major}/bin`, `/usr/pgsql-${major}/bin`, `/usr/libexec/postgresql${major}`]).concat(['/usr/local/pgsql/bin'])
    const candidates = configuredBinaries ? [configuredBinaries] : [...new Set([...pathCandidates, ...platformCandidates])]
    for (const candidate of candidates) {
      try {
        const executables = await Promise.all(['pg_dump', 'pg_restore', 'psql'].map(async name => {
          const path = await io.realpath(join(candidate, name))
          const info = await io.info(path)
          if (!info || info.kind !== 'file' || info.mode & 0o022 || !(info.mode & 0o111) || ![0, uid].includes(info.uid) || basename(path) !== name) return undefined
          return path
        }))
        if (executables.some(path => !path) || new Set(executables.map(path => dirname(path!))).size !== 1) continue
        const directory = dirname(executables[0]!)
        const info = await io.info(directory)
        if (!info || info.kind !== 'directory' || info.mode & 0o022 || ![0, uid].includes(info.uid)) continue
        const versions = await Promise.all(executables.map(path => io.version(path!, options.signal)))
        if (versions.some(major => !major || ![16, 17, 18].includes(major)) || new Set(versions).size !== 1) continue
        binaries.directory = directory; binaries.major = versions[0]; binaries.source = configuredBinaries ? provenance.binariesDir : pathCandidates.includes(candidate) ? 'PATH' : 'platform-search'
        break
      } catch (error) { if (error instanceof RecoveryConfigurationError) throw error; if (!absent(error)) throw new RecoveryConfigurationError('RECOVERY_BINARY_DISCOVERY_FAILED', 'binariesDir') }
    }
    if (!binaries.directory) missingPrerequisites.push({ code: 'RECOVERY_POSTGRES_CLIENTS_REQUIRED', field: 'binariesDir', ...(configuredBinaries ? { path: configuredBinaries } : {}) })
  }
  if (!provenance.binariesDir) provenance.binariesDir = binaries.source
  return { platform, arch, container, paths, binaries, provenance, missingPrerequisites, persistentMount: durablePaths.base, durablePaths }
}

export function requireRecoveryDirectories(configuration: RecoveryConfiguration, fields: Array<keyof RecoveryConfiguration['durablePaths']>): void {
  const relevant = new Set(fields)
  for (const field of fields) if (field !== 'base' && configuration.provenance[field] === 'platform-default' && contained(configuration.paths.base, configuration.paths[field])) relevant.add('base')
  for (const field of relevant) {
    const unsafe = configuration.missingPrerequisites.find(item => item.field === field && ['RECOVERY_PRIVATE_DIRECTORY_REQUIRED', 'RECOVERY_PERSISTENT_MOUNT_REQUIRED'].includes(item.code))
    if (unsafe) throw new RecoveryConfigurationError(unsafe.code, field)
  }
}

/** Enforce private ancestors before automatically consuming a dedicated custody file. */
export function requireRecoveryCustodyFile(configuration: RecoveryConfiguration, field: 'recipientsFile' | 'identityFile' | 'serviceFile' | 'passwordFile'): void {
  const unsafe = configuration.missingPrerequisites.find(item => item.field === field)
  if (unsafe) throw new RecoveryConfigurationError(unsafe.code, field)
  if (configuration.provenance[field] === 'platform-default' && contained(configuration.paths.custody, configuration.paths[field])) requireRecoveryDirectories(configuration, ['custody'])
}
