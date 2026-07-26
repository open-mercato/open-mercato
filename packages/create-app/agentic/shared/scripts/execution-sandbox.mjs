import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

function pathEntries(env = process.env) {
  return String(env.PATH ?? '').split(path.delimiter).filter(Boolean)
}

function executableCandidate(command, env = process.env) {
  if (path.isAbsolute(command)) return command
  for (const directory of pathEntries(env)) {
    const candidate = path.join(directory, command)
    try {
      const stat = fs.statSync(candidate)
      if (stat.isFile()) return candidate
    } catch { /* keep looking */ }
  }
  throw new Error(`sandbox executable is unavailable: ${command}`)
}

function resolveExecutable(command, env = process.env) {
  return fs.realpathSync(executableCandidate(command, env))
}

function trustedBubblewrapExecutable(env = process.env) {
  const executable = resolveExecutable('bwrap', env)
  const stat = fs.lstatSync(executable)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 0o022) !== 0) {
    throw new Error('Linux target isolation requires a root-owned, non-group/world-writable Bubblewrap executable')
  }
  return executable
}

function regularDirectory(root, label) {
  if (!path.isAbsolute(root)) throw new Error(`${label} must be absolute`)
  const stat = fs.lstatSync(root)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular directory`)
  return fs.realpathSync(root)
}

// True when `parent` is `candidate` or one of its ancestors.
function containsPath(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function uniqueExistingDirectories(values) {
  return [...new Set(values)].filter((entry) => {
    try { return fs.statSync(entry).isDirectory() } catch { return false }
  }).map((entry) => fs.realpathSync(entry))
}

export function collapseReadOnlyRoots(values) {
  const roots = [...new Set(uniqueExistingDirectories(values))]
    .sort((left, right) => left.split(path.sep).length - right.split(path.sep).length || left.localeCompare(right))
  const result = []
  for (const root of roots) {
    const nested = result.some((parent) => {
      const relative = path.relative(parent, root)
      return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
    })
    if (!nested) result.push(root)
  }
  return result
}

export function linuxMergedUsrSymlinkArgs() {
  const aliases = [
    ['/bin', 'usr/bin'],
    ['/sbin', 'usr/sbin'],
    ['/lib', 'usr/lib'],
    ['/lib64', 'usr/lib64'],
  ]
  return aliases.flatMap(([alias, expected]) => {
    try {
      const stat = fs.lstatSync(alias)
      return stat.isSymbolicLink() && fs.readlinkSync(alias) === expected
        ? ['--symlink', expected, alias]
        : []
    } catch { return [] }
  })
}

function uniqueExistingRegularFiles(values) {
  return [...new Set(values)].filter((entry) => {
    try { return fs.statSync(entry).isFile() } catch { return false }
  })
}

function runtimeReadRoots(command, env) {
  const executablePath = executableCandidate(command, env)
  const executable = fs.realpathSync(executablePath)
  const nodeInstallRoot = path.dirname(path.dirname(fs.realpathSync(process.execPath)))
  const nodeLauncher = (() => {
    try {
      const candidate = executableCandidate(process.platform === 'win32' ? 'node.exe' : 'node', env)
      if (fs.realpathSync(candidate) === fs.realpathSync(process.execPath)) return path.dirname(candidate)
      if (process.platform !== 'win32') {
        const launcher = fs.lstatSync(candidate)
        const launcherRoot = path.dirname(candidate)
        const root = fs.lstatSync(launcherRoot)
        const realTemporary = fs.realpathSync(os.tmpdir())
        const realLauncherRoot = fs.realpathSync(launcherRoot)
        const relative = path.relative(realTemporary, realLauncherRoot)
        const insideTemporary = relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
        const exactWrapper = `#!/bin/sh\nexec ${JSON.stringify(fs.realpathSync(process.execPath))}  "$@"\n`
        if (insideTemporary && /^xfs-[a-f0-9]+$/.test(path.basename(realLauncherRoot))
          && root.isDirectory() && !root.isSymbolicLink()
          && launcher.isFile() && !launcher.isSymbolicLink() && launcher.size <= 256 && (launcher.mode & 0o111) !== 0
          && fs.readFileSync(candidate, 'utf8') === exactWrapper) return realLauncherRoot
      }
      return undefined
    } catch { return undefined }
  })()
  const system = process.platform === 'darwin'
    ? ['/System', '/usr', '/bin', '/sbin', '/Library/Apple', '/Library/Fonts', '/Library/ColorSync', '/Library/Keyboard Layouts', '/Library/Keychains', '/Library/Security/Trust Settings', '/private/var/db', '/private/etc/ssl', '/etc/ssl', '/dev']
    : ['/usr', '/bin', '/sbin', '/lib', '/lib64', '/etc/ssl', '/etc/ca-certificates']
  return collapseReadOnlyRoots([
    ...system,
    nodeInstallRoot,
    path.dirname(executablePath),
    path.dirname(executable),
    ...(nodeLauncher ? [nodeLauncher] : []),
  ])
}

function sandboxLiteral(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

export function assertSandboxNetworkModeSupported(networkMode, platform = process.platform) {
  if (!['none', 'loopback', 'all'].includes(networkMode)) {
    throw new Error(`invalid sandbox network mode: ${String(networkMode)}`)
  }
  if (platform === 'darwin' && networkMode === 'loopback') {
    throw new Error('isolated loopback is unavailable with macOS sandbox-exec; run this lane in a Linux VM/container with Bubblewrap')
  }
}

export function assertSandboxRuntimeAvailable(networkMode, platform = process.platform, env = process.env) {
  assertSandboxNetworkModeSupported(networkMode, platform)
  if (platform === 'darwin') {
    if (!fs.existsSync('/usr/bin/sandbox-exec')) throw new Error('macOS target isolation requires /usr/bin/sandbox-exec')
    return '/usr/bin/sandbox-exec'
  }
  if (platform === 'linux') {
    return trustedBubblewrapExecutable(env)
  }
  throw new Error(`target isolation is unsupported on ${platform}; use a Linux VM/container with Bubblewrap`)
}

export function verifyLinuxSandboxIsolation(env = process.env) {
  const bubblewrap = trustedBubblewrapExecutable(env)
  const probeRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-bwrap-probe-')))
  const nonce = crypto.randomBytes(18).toString('hex')
  const marker = `OM_BWRAP_ISOLATED_${nonce}`
  const node = fs.realpathSync(process.execPath)
  const baseArgs = [
    '--die-with-parent',
    '--new-session',
    ...linuxIsolationArgs('loopback'),
    ...linuxMergedUsrSymlinkArgs(),
    '--proc', '/proc',
    '--dev', '/dev',
    '--tmpfs', '/tmp',
    '--bind', probeRoot, probeRoot,
  ]
  for (const root of runtimeReadRoots(node, env)) baseArgs.push('--ro-bind', root, root)
  baseArgs.push('--chdir', probeRoot, '--', node, '-e')
  const outerProbe = `
const { spawnSync } = require('node:child_process')
const net = require('node:net')
const bubblewrap = process.argv[1]
const args = JSON.parse(process.argv[2])
const marker = process.argv[3]
const host = net.createServer()
host.once('error', () => process.exit(71))
host.listen(0, '127.0.0.1', () => {
  const address = host.address()
  if (!address || typeof address === 'string') process.exit(72)
  const inner = \`
const net = require('node:net')
const fs = require('node:fs')
const marker = \${JSON.stringify(marker)}
const hostPort = \${address.port}
const local = net.createServer((socket) => socket.end())
const fail = () => process.exit(81)
const capabilities = fs.readFileSync('/proc/self/status', 'utf8')
  .split('\\\\n')
  .filter((line) => /^Cap(?:Inh|Prm|Eff|Bnd|Amb):/.test(line))
  .map((line) => line.split(/:\\\\s+/)[1])
if (capabilities.length !== 5 || capabilities.some((value) => !/^0+$/.test(value))) fail()
local.once('error', fail)
local.listen(0, '127.0.0.1', () => {
  const address = local.address()
  if (!address || typeof address === 'string') fail()
  const self = net.connect(address.port, '127.0.0.1')
  self.once('error', fail)
  self.once('connect', () => {
    self.destroy()
    local.close()
    const outside = net.connect(hostPort, '127.0.0.1')
    outside.once('connect', () => process.exit(82))
    outside.once('error', () => { console.log(marker); process.exit(0) })
    outside.setTimeout(1500, () => { outside.destroy(); console.log(marker); process.exit(0) })
  })
})
setTimeout(fail, 4000).unref()
\`
  const result = spawnSync(bubblewrap, [...args, inner], { encoding: 'utf8', timeout: 7000 })
  const passed = result.status === 0 && result.stdout.trim() === marker
  host.close(() => process.exit(passed ? 0 : 73))
})
setTimeout(() => process.exit(74), 9000).unref()
`
  try {
    const result = spawnSync(node, ['-e', outerProbe, bubblewrap, JSON.stringify(baseArgs), marker], {
      cwd: probeRoot,
      env: { PATH: String(env.PATH ?? ''), TZ: 'UTC' },
      encoding: 'utf8',
      timeout: 10_000,
    })
    if (result.status !== 0 || result.error) {
      throw new Error('Bubblewrap isolation probe failed: private user/network namespaces, capability-free payloads, and isolated loopback are required')
    }
  } finally {
    fs.rmSync(probeRoot, { recursive: true, force: true })
  }
}

export function macSandboxProfile({ command, writableRoots, readOnlyRoots, networkMode, env }) {
  assertSandboxNetworkModeSupported(networkMode, 'darwin')
  const writable = writableRoots.map((root, index) => regularDirectory(root, `writable sandbox root ${index + 1}`))
  const readOnly = readOnlyRoots.map((root, index) => regularDirectory(root, `read-only sandbox root ${index + 1}`))
  const readable = uniqueExistingDirectories([...writable, ...readOnly, ...runtimeReadRoots(command, env)])
  return [
    '(version 1)',
    '(deny default)',
    '(import "system.sb")',
    '(allow process*)',
    '(allow signal)',
    '(allow sysctl-read)',
    '(allow file-read-metadata)',
    '(allow mach-lookup (global-name-regex #"^org\\.chromium\\.Chromium\\.MachPortRendezvousServer\\.[0-9]+$"))',
    '(allow mach-register (global-name-regex #"^org\\.chromium\\.Chromium\\.MachPortRendezvousServer\\.[0-9]+$"))',
    '(allow iokit-open-user-client (iokit-user-client-class "RootDomainUserClient"))',
    ...readable.map((root) => `(allow file-read* (subpath "${sandboxLiteral(root)}"))`),
    ...writable.map((root) => `(allow file-write* (subpath "${sandboxLiteral(root)}"))`),
    ...(networkMode === 'all' ? ['(allow network*)'] : []),
    ...readOnly.map((root) => `(deny file-write* (subpath "${sandboxLiteral(root)}"))`),
  ].join(' ')
}

function macInvocation({ command, args, cwd, writableRoots, readOnlyRoots, networkMode, env }) {
  const sandbox = '/usr/bin/sandbox-exec'
  assertSandboxRuntimeAvailable(networkMode, 'darwin', env)
  const profile = macSandboxProfile({ command, writableRoots, readOnlyRoots, networkMode, env })
  return { command: sandbox, args: ['-p', profile, resolveExecutable(command, env), ...args], cwd: regularDirectory(cwd, 'sandbox cwd'), env }
}

export function linuxNamespaceArgs(networkMode) {
  if (!['none', 'loopback', 'all'].includes(networkMode)) throw new Error(`invalid sandbox network mode: ${String(networkMode)}`)
  return ['--unshare-all', ...(networkMode === 'all' ? ['--share-net'] : [])]
}

export function linuxIsolationArgs(networkMode) {
  return [...linuxNamespaceArgs(networkMode), '--cap-drop', 'ALL']
}

export function linuxNetworkReadFiles(networkMode) {
  linuxNamespaceArgs(networkMode)
  return networkMode === 'all'
    ? ['/etc/resolv.conf', '/etc/hosts', '/etc/nsswitch.conf']
    : []
}

function linuxInvocation({ command, args, cwd, writableRoots, readOnlyRoots, networkMode, env }) {
  const bubblewrap = assertSandboxRuntimeAvailable(networkMode, 'linux', env)
  const writable = writableRoots.map((root, index) => regularDirectory(root, `writable sandbox root ${index + 1}`))
  const readOnly = readOnlyRoots.map((root, index) => regularDirectory(root, `read-only sandbox root ${index + 1}`))
  const readable = uniqueExistingDirectories([...readOnly, ...runtimeReadRoots(command, env)])
  const networkReadable = uniqueExistingRegularFiles(linuxNetworkReadFiles(networkMode))
  const sandboxArgs = [
    '--die-with-parent',
    '--new-session',
    ...linuxIsolationArgs(networkMode),
    ...linuxMergedUsrSymlinkArgs(),
    '--proc', '/proc',
    '--dev', '/dev',
    '--tmpfs', '/tmp',
  ]
  for (const root of writable) sandboxArgs.push('--bind', root, root)
  // Apply read-only mounts last so a nested dependency root cannot be shadowed
  // by a later writable parent bind. Runtime roots are derived incidentally — the
  // interpreter, the system tree, and the command's own directory — so one of them can
  // be a writable root or its ANCESTOR, and mounting that last would re-mount the whole
  // writable root read-only. Those are dropped: anything inside a writable bind is
  // already reachable through it. Explicitly declared readOnlyRoots are never dropped,
  // because a nested read-only dependency tree overriding its writable parent is exactly
  // what this ordering exists to guarantee.
  for (const root of readable) {
    if (!readOnly.includes(root) && writable.some((writableRoot) => containsPath(root, writableRoot))) continue
    sandboxArgs.push('--ro-bind', root, root)
  }
  for (const file of networkReadable) sandboxArgs.push('--ro-bind', file, file)
  const realCwd = regularDirectory(cwd, 'sandbox cwd')
  sandboxArgs.push('--chdir', realCwd, '--', resolveExecutable(command, env), ...args)
  return { command: bubblewrap, args: sandboxArgs, cwd: realCwd, env }
}

export function sandboxedInvocation(options) {
  const networkMode = options.networkMode ?? (options.networkAllowed === true ? 'all' : 'none')
  assertSandboxNetworkModeSupported(networkMode)
  const invocation = {
    ...options,
    args: options.args ?? [],
    writableRoots: options.writableRoots ?? [],
    readOnlyRoots: options.readOnlyRoots ?? [],
    networkMode,
    env: options.env ?? {},
  }
  resolveExecutable(invocation.command, invocation.env)
  if (process.platform === 'darwin') return macInvocation(invocation)
  if (process.platform === 'linux') return linuxInvocation(invocation)
  throw new Error(`target isolation is unsupported on ${process.platform}; use macOS sandbox-exec or Linux bubblewrap`)
}
