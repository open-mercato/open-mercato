import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

function pathEntries(env = process.env) {
  return String(env.PATH ?? '').split(path.delimiter).filter(Boolean)
}

function resolveExecutable(command, env = process.env) {
  if (path.isAbsolute(command)) return fs.realpathSync(command)
  for (const directory of pathEntries(env)) {
    const candidate = path.join(directory, command)
    try {
      const stat = fs.statSync(candidate)
      if (stat.isFile()) return fs.realpathSync(candidate)
    } catch { /* keep looking */ }
  }
  throw new Error(`sandbox executable is unavailable: ${command}`)
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
  const executable = resolveExecutable(command, env)
  const nodeInstallRoot = path.dirname(path.dirname(fs.realpathSync(process.execPath)))
  const system = process.platform === 'darwin'
    ? ['/System', '/usr', '/bin', '/sbin', '/Library/Apple', '/private/var/db', '/etc/ssl', '/dev']
    : ['/usr', '/bin', '/sbin', '/lib', '/lib64', '/etc/ssl', '/etc/ca-certificates']
  return uniqueExistingDirectories([...system, nodeInstallRoot, path.dirname(executable)])
}

function sandboxLiteral(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

function macInvocation({ command, args, cwd, writableRoots, readOnlyRoots, networkAllowed, env }) {
  const sandbox = '/usr/bin/sandbox-exec'
  if (!fs.existsSync(sandbox)) throw new Error('macOS target isolation requires /usr/bin/sandbox-exec')
  const writable = writableRoots.map((root, index) => regularDirectory(root, `writable sandbox root ${index + 1}`))
  const readOnly = readOnlyRoots.map((root, index) => regularDirectory(root, `read-only sandbox root ${index + 1}`))
  const readable = uniqueExistingDirectories([...writable, ...readOnly, ...runtimeReadRoots(command, env)])
  const profile = [
    '(version 1)',
    '(deny default)',
    '(import "system.sb")',
    '(allow process*)',
    '(allow signal)',
    '(allow sysctl-read)',
    '(allow file-read-metadata)',
    '(allow mach-lookup)',
    '(allow ipc-posix*)',
    ...readable.map((root) => `(allow file-read* (subpath "${sandboxLiteral(root)}"))`),
    ...writable.map((root) => `(allow file-write* (subpath "${sandboxLiteral(root)}"))`),
    ...(networkAllowed ? ['(allow network*)'] : []),
  ].join(' ')
  return { command: sandbox, args: ['-p', profile, resolveExecutable(command, env), ...args], cwd: regularDirectory(cwd, 'sandbox cwd'), env }
}

function linuxInvocation({ command, args, cwd, writableRoots, readOnlyRoots, networkAllowed, env }) {
  const bubblewrap = resolveExecutable('bwrap', env)
  const writable = writableRoots.map((root, index) => regularDirectory(root, `writable sandbox root ${index + 1}`))
  const readOnly = readOnlyRoots.map((root, index) => regularDirectory(root, `read-only sandbox root ${index + 1}`))
  const readable = uniqueExistingDirectories([...readOnly, ...runtimeReadRoots(command, env)])
  const sandboxArgs = ['--die-with-parent', '--new-session', '--tmpfs', '/', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp']
  for (const root of readable) sandboxArgs.push('--ro-bind', root, root)
  for (const root of writable) sandboxArgs.push('--bind', root, root)
  if (!networkAllowed) sandboxArgs.push('--unshare-net')
  const realCwd = regularDirectory(cwd, 'sandbox cwd')
  sandboxArgs.push('--chdir', realCwd, '--', resolveExecutable(command, env), ...args)
  return { command: bubblewrap, args: sandboxArgs, cwd: realCwd, env }
}

export function sandboxedInvocation(options) {
  const invocation = {
    ...options,
    args: options.args ?? [],
    writableRoots: options.writableRoots ?? [],
    readOnlyRoots: options.readOnlyRoots ?? [],
    networkAllowed: options.networkAllowed === true,
    env: options.env ?? {},
  }
  resolveExecutable(invocation.command, invocation.env)
  if (process.platform === 'darwin') return macInvocation(invocation)
  if (process.platform === 'linux') return linuxInvocation(invocation)
  throw new Error(`target isolation is unsupported on ${process.platform}; use macOS sandbox-exec or Linux bubblewrap`)
}
