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

function regularDirectory(root, label) {
  if (!path.isAbsolute(root)) throw new Error(`${label} must be absolute`)
  const stat = fs.lstatSync(root)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular directory`)
  return fs.realpathSync(root)
}

function uniqueExistingDirectories(values) {
  return [...new Set(values)].filter((entry) => {
    try { return fs.statSync(entry).isDirectory() } catch { return false }
  }).map((entry) => fs.realpathSync(entry))
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
  return uniqueExistingDirectories([
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

export function macSandboxProfile({ command, writableRoots, readOnlyRoots, networkMode, env }) {
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
    ...(networkMode === 'loopback' ? [
      '(allow network-inbound (local ip "localhost:*"))',
      '(allow network-outbound (remote ip "localhost:*"))',
    ] : []),
    ...readOnly.map((root) => `(deny file-write* (subpath "${sandboxLiteral(root)}"))`),
  ].join(' ')
}

function macInvocation({ command, args, cwd, writableRoots, readOnlyRoots, networkMode, env }) {
  const sandbox = '/usr/bin/sandbox-exec'
  if (!fs.existsSync(sandbox)) throw new Error('macOS target isolation requires /usr/bin/sandbox-exec')
  const profile = macSandboxProfile({ command, writableRoots, readOnlyRoots, networkMode, env })
  return { command: sandbox, args: ['-p', profile, resolveExecutable(command, env), ...args], cwd: regularDirectory(cwd, 'sandbox cwd'), env }
}

export function linuxNamespaceArgs(networkMode) {
  if (!['none', 'loopback', 'all'].includes(networkMode)) throw new Error(`invalid sandbox network mode: ${String(networkMode)}`)
  return ['--unshare-all', ...(networkMode === 'all' ? ['--share-net'] : [])]
}

function linuxInvocation({ command, args, cwd, writableRoots, readOnlyRoots, networkMode, env }) {
  const bubblewrap = resolveExecutable('bwrap', env)
  const writable = writableRoots.map((root, index) => regularDirectory(root, `writable sandbox root ${index + 1}`))
  const readOnly = readOnlyRoots.map((root, index) => regularDirectory(root, `read-only sandbox root ${index + 1}`))
  const readable = uniqueExistingDirectories([...readOnly, ...runtimeReadRoots(command, env)])
  const sandboxArgs = [
    '--die-with-parent',
    '--new-session',
    ...linuxNamespaceArgs(networkMode),
    '--tmpfs', '/',
    '--proc', '/proc',
    '--dev', '/dev',
    '--tmpfs', '/tmp',
  ]
  for (const root of writable) sandboxArgs.push('--bind', root, root)
  // Apply read-only mounts last so a nested dependency root cannot be shadowed
  // by a later writable parent bind.
  for (const root of readable) sandboxArgs.push('--ro-bind', root, root)
  const realCwd = regularDirectory(cwd, 'sandbox cwd')
  sandboxArgs.push('--chdir', realCwd, '--', resolveExecutable(command, env), ...args)
  return { command: bubblewrap, args: sandboxArgs, cwd: realCwd, env }
}

export function sandboxedInvocation(options) {
  const networkMode = options.networkMode ?? (options.networkAllowed === true ? 'all' : 'none')
  if (!['none', 'loopback', 'all'].includes(networkMode)) throw new Error(`invalid sandbox network mode: ${String(networkMode)}`)
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
