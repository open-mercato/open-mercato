import { resolveRecoveryConfiguration, requireRecoveryDirectories, requireRecoveryCustodyFile, type RecoveryConfigurationIO } from '../recovery-configuration'

type Info = Awaited<ReturnType<RecoveryConfigurationIO['info']>>
function fixture() {
  const files = new Map<string, Info>([['/', { kind: 'directory', mode: 0o755, uid: 0 }]])
  const aliases = new Map<string, string>(), texts = new Map<string, string>(), versions = new Map<string, number>()
  const missing = () => Object.assign(new Error('missing'), { code: 'ENOENT' })
  const io: RecoveryConfigurationIO = {
    info: jest.fn(async path => files.get(path)),
    realpath: jest.fn(async path => aliases.get(path) ?? (files.has(path) ? path : Promise.reject(missing()))),
    readText: jest.fn(async path => texts.get(path)),
    version: jest.fn(async path => versions.get(path)),
  }
  const tools = (directory: string, major = 17) => {
    files.set(directory, { kind: 'directory', mode: 0o755, uid: 0 })
    for (const name of ['pg_dump', 'pg_restore', 'psql']) { files.set(`${directory}/${name}`, { kind: 'file', mode: 0o755, uid: 0 }); versions.set(`${directory}/${name}`, major) }
  }
  return { io, files, aliases, texts, versions, tools }
}
const base = { homeDirectory: '/home/operator', uid: 1000, env: {}, discoverBinaries: false } as const

test.each([
  ['darwin', 'arm64', '/Users/operator/Library/Application Support/Open Mercato/recovery'],
  ['darwin', 'x64', '/Users/operator/Library/Application Support/Open Mercato/recovery'],
  ['linux', 'x64', '/Users/operator/.local/state/open-mercato/recovery'],
] as const)('%s %s uses persistent separate nonsecret paths without creating files', async (platform, arch, expected) => {
  const { io } = fixture()
  const config = await resolveRecoveryConfiguration({ ...base, homeDirectory: '/Users/operator', platform, arch, io })
  expect(config.paths.base).toBe(expected)
  expect(new Set([config.paths.backupOutput, config.paths.backupWorkspace, config.paths.rotationArtifacts, config.paths.rotationTrust, config.paths.custody]).size).toBe(5)
  expect(config.paths.serviceFile).toBe('/Users/operator/.pg_service.conf')
  expect(config.paths.identityFile).toBe(`${expected}/custody/identity.txt`)
  expect(io.readText).not.toHaveBeenCalledWith(config.paths.identityFile)
  expect(io.version).not.toHaveBeenCalled()
})

test('arguments win over environment, environment wins over defaults and explicit empty values refuse', async () => {
  const { io } = fixture()
  const config = await resolveRecoveryConfiguration({ ...base, platform: 'linux', io, env: { OM_RECOVERY_ROOT: '/srv/env', PGSERVICEFILE: '/srv/private/service', PGPASSFILE: '/srv/private/password' }, overrides: { base: '/srv/argument', backupOutput: '/srv/archive' } })
  expect(config.paths.base).toBe('/srv/argument'); expect(config.paths.backupOutput).toBe('/srv/archive'); expect(config.paths.serviceFile).toBe('/srv/private/service')
  expect(config.provenance.base).toBe('argument'); expect(config.provenance.serviceFile).toBe('environment:PGSERVICEFILE')
  for (const overrides of [{ base: '' }, { serviceFile: '' }, { binariesDir: '' }, { backupWorkspace: 'relative' }]) await expect(resolveRecoveryConfiguration({ ...base, platform: 'linux', io, overrides })).rejects.toThrow('RECOVERY_PATH_INVALID')
  await expect(resolveRecoveryConfiguration({ ...base, platform: 'linux', io, env: { OM_RECOVERY_ROOT: '' } })).rejects.toThrow('RECOVERY_PATH_INVALID')
})

test.each(['/', '/tmp/recovery', '/private/tmp/recovery', '/var/tmp/recovery', '/proc/recovery'])('rejects nonpersistent recovery root %s', async root => {
  const { io } = fixture()
  await expect(resolveRecoveryConfiguration({ ...base, platform: 'linux', io, overrides: { base: root } })).rejects.toThrow('RECOVERY_PERSISTENT_ROOT_REQUIRED')
})

test('Linux XDG default is honored without using relative or temporary state', async () => {
  const { io } = fixture()
  expect((await resolveRecoveryConfiguration({ ...base, platform: 'linux', io, env: { XDG_STATE_HOME: '/srv/state' } })).paths.base).toBe('/srv/state/open-mercato/recovery')
  expect((await resolveRecoveryConfiguration({ ...base, platform: 'linux', io, env: { XDG_STATE_HOME: 'relative' } })).paths.base).toBe('/home/operator/.local/state/open-mercato/recovery')
  await expect(resolveRecoveryConfiguration({ ...base, platform: 'linux', io, env: { XDG_STATE_HOME: '/tmp/state' } })).rejects.toThrow('RECOVERY_PERSISTENT_ROOT_REQUIRED')
})

test.each([
  ['darwin', 'arm64', '/opt/homebrew/opt/postgresql@17/bin'],
  ['darwin', 'x64', '/usr/local/opt/postgresql@17/bin'],
  ['linux', 'x64', '/usr/lib/postgresql/17/bin'],
  ['linux', 'x64', '/usr/pgsql-17/bin'],
  ['linux', 'x64', '/usr/libexec/postgresql17'],
] as const)('discovers matching safe %s %s clients in %s', async (platform, arch, directory) => {
  const { io, tools } = fixture(); tools(directory)
  const config = await resolveRecoveryConfiguration({ ...base, platform, arch, io, discoverBinaries: true })
  expect(config.binaries).toMatchObject({ directory, major: 17, source: 'platform-search' })
  expect(io.version).toHaveBeenCalledTimes(3)
})

test('PATH resolves a Homebrew trio to its common real directory and rejects mixed or writable tools', async () => {
  const { io, tools, aliases, files, versions } = fixture()
  const directory = '/opt/homebrew/Cellar/libpq/17.5/bin'; tools(directory)
  for (const name of ['pg_dump', 'pg_restore', 'psql']) aliases.set(`/usr/local/bin/${name}`, `${directory}/${name}`)
  const options = { ...base, platform: 'darwin' as const, io, env: { PATH: '/usr/local/bin' }, discoverBinaries: true }
  expect((await resolveRecoveryConfiguration(options)).binaries).toMatchObject({ directory, major: 17, source: 'PATH' })
  versions.set(`${directory}/psql`, 16)
  expect((await resolveRecoveryConfiguration(options)).binaries.directory).toBeUndefined()
  versions.set(`${directory}/psql`, 17); files.set(directory, { kind: 'directory', mode: 0o777, uid: 0 }); jest.mocked(io.version).mockClear()
  expect((await resolveRecoveryConfiguration(options)).missingPrerequisites).toContainEqual({ code: 'RECOVERY_POSTGRES_CLIENTS_REQUIRED', field: 'binariesDir' })
  expect(io.version).not.toHaveBeenCalled()
})

test('an explicit missing tool directory never silently selects another installed version', async () => {
  const { io, tools } = fixture(); tools('/usr/lib/postgresql/17/bin')
  const config = await resolveRecoveryConfiguration({ ...base, platform: 'linux', io, discoverBinaries: true, overrides: { binariesDir: '/selected/missing' } })
  expect(config.binaries.directory).toBeUndefined()
  expect(config.missingPrerequisites).toContainEqual({ code: 'RECOVERY_POSTGRES_CLIENTS_REQUIRED', field: 'binariesDir', path: '/selected/missing' })
  expect(io.version).not.toHaveBeenCalled()
})

test.each(['overlay', 'tmpfs'])('Docker %s root is not a durable default even when it exists', async filesystem => {
  const { io, files, texts } = fixture(); files.set('/.dockerenv', { kind: 'file', mode: 0o600, uid: 0 })
  texts.set('/proc/self/mountinfo', `1 0 0:1 / / rw - ${filesystem} ${filesystem} rw\n`)
  const config = await resolveRecoveryConfiguration({ ...base, platform: 'linux', io })
  expect(config.container).toBe(true); expect(config.paths.base).toBe('/var/lib/open-mercato/recovery'); expect(config.persistentMount).toBe(false)
  expect(() => requireRecoveryDirectories(config, ['backupOutput', 'backupWorkspace'])).toThrow('RECOVERY_PERSISTENT_MOUNT_REQUIRED')
})

test('Docker named/bind volume is durable, custody may be read-only and host macOS paths are never selected', async () => {
  const { io, files, texts } = fixture(); files.set('/.dockerenv', { kind: 'file', mode: 0o600, uid: 0 })
  texts.set('/proc/self/mountinfo', '1 0 0:1 / / rw - overlay overlay rw\n2 1 0:2 /volume /var/lib/open-mercato/recovery rw - ext4 /dev/disk rw\n3 2 0:3 /secret /var/lib/open-mercato/recovery/custody ro - ext4 /dev/disk ro\n')
  const config = await resolveRecoveryConfiguration({ ...base, platform: 'linux', io, homeDirectory: '/root' })
  expect(config.persistentMount).toBe(true); expect(Object.values(config.durablePaths).every(Boolean)).toBe(true)
  expect(() => requireRecoveryDirectories(config, ['backupOutput', 'backupWorkspace', 'rotationArtifacts', 'rotationTrust'])).not.toThrow()
  expect(Object.values(config.paths).join(' ')).not.toContain('/Users/')
})

test('private configuration symlinks, owner mismatch and public modes are reported without reading contents', async () => {
  const { io, files } = fixture()
  files.set('/home/operator/.pg_service.conf', { kind: 'symlink', mode: 0o777, uid: 1000 })
  files.set('/home/operator/.pgpass', { kind: 'file', mode: 0o644, uid: 1000 })
  const config = await resolveRecoveryConfiguration({ ...base, platform: 'linux', io })
  expect(config.missingPrerequisites).toEqual(expect.arrayContaining([
    { code: 'RECOVERY_PRIVATE_FILE_REQUIRED', field: 'serviceFile', path: '/home/operator/.pg_service.conf' },
    { code: 'RECOVERY_PRIVATE_FILE_REQUIRED', field: 'passwordFile', path: '/home/operator/.pgpass' },
  ]))
  expect(jest.mocked(io.readText).mock.calls.every(([path]) => path === '/proc/1/cgroup')).toBe(true)
})


test.each(['custody', 'base'] as const)('0600 dedicated custody files cannot bypass unsafe default %s', async field => {
  const { io, files, aliases } = fixture()
  const root = '/home/operator/.local/state/open-mercato/recovery'
  const custody = `${root}/custody`
  files.set(root, { kind: 'directory', mode: 0o700, uid: 1000 })
  files.set(custody, { kind: 'directory', mode: 0o700, uid: 1000 })
  files.set(`${custody}/recipients.txt`, { kind: 'file', mode: 0o600, uid: 1000 })
  files.set(`${custody}/identity.txt`, { kind: 'file', mode: 0o600, uid: 1000 })
  if (field === 'custody') files.set(custody, { kind: 'directory', mode: 0o777, uid: 1000 })
  else { files.set(root, { kind: 'symlink', mode: 0o777, uid: 1000 }); aliases.set(root, '/srv/redirected') }
  const config = await resolveRecoveryConfiguration({ ...base, platform: 'linux', io })
  expect(config.missingPrerequisites.some(item => item.field === 'recipientsFile')).toBe(false)
  expect(() => requireRecoveryCustodyFile(config, 'recipientsFile')).toThrow('RECOVERY_PRIVATE_DIRECTORY_REQUIRED')
  expect(() => requireRecoveryCustodyFile(config, 'identityFile')).toThrow('RECOVERY_PRIVATE_DIRECTORY_REQUIRED')
  expect(io.readText).not.toHaveBeenCalledWith(`${custody}/identity.txt`)
})

test('fully explicit external paths do not require an unused default base or custody mount', async () => {
  const { io, files, texts } = fixture()
  files.set('/.dockerenv', { kind: 'file', mode: 0o600, uid: 0 })
  files.set('/dedicated/keys/public.txt', { kind: 'file', mode: 0o600, uid: 1000 })
  texts.set('/proc/self/mountinfo', '1 0 0:1 / / rw - overlay overlay rw\n2 1 0:2 /volume /dedicated rw - ext4 /dev/disk rw\n')
  const config = await resolveRecoveryConfiguration({ ...base, platform: 'linux', io, overrides: { backupOutput: '/dedicated/archive', backupWorkspace: '/dedicated/work', recipientsFile: '/dedicated/keys/public.txt' } })
  expect(config.persistentMount).toBe(false)
  expect(() => requireRecoveryDirectories(config, ['backupOutput', 'backupWorkspace'])).not.toThrow()
  expect(() => requireRecoveryCustodyFile(config, 'recipientsFile')).not.toThrow()
})


test('container libpq defaults use persistent custody even when HOME is root', async () => {
  const { io, files } = fixture()
  files.set('/.dockerenv', { kind: 'file', mode: 0o600, uid: 0 })
  const config = await resolveRecoveryConfiguration({ ...base, platform: 'linux', homeDirectory: '/', io })
  expect(config.paths.serviceFile).toBe('/var/lib/open-mercato/recovery/custody/pg_service.conf')
  expect(config.paths.passwordFile).toBe('/var/lib/open-mercato/recovery/custody/pgpass')
  const explicit = await resolveRecoveryConfiguration({ ...base, platform: 'linux', homeDirectory: '/', io, env: { PGSERVICEFILE: '/operator/service', PGPASSFILE: '/operator/password' } })
  expect(explicit.paths.serviceFile).toBe('/operator/service')
  expect(explicit.paths.passwordFile).toBe('/operator/password')
})
