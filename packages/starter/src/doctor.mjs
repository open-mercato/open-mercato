import { spawnSync } from 'node:child_process'
import dns from 'node:dns/promises'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

import { detectDocker, runCaptureSync } from './compose.mjs'
import { probeTlsInterception, summarizeProbeResults } from './certs.mjs'
import { CAPTURED_CA_BUNDLE, LOOPBACK_HOST, resolveStackPorts } from './constants.mjs'
import { color, icons, printBanner } from './ui.mjs'

// Read-only environment audit. Every check returns
//   { id, title, level: 'pass' | 'warn' | 'fail', detail, guide?: string[], it?: string[] }
// `guide` is what the USER can do; `it` is the line item for the aggregated
// "hand this to IT" sheet (admin/policy actions on managed devices).

const GIB = 1024 ** 3

function result(id, title, level, detail, { guide = [], it = [] } = {}) {
  return { id, title, level, detail, guide, it }
}

function commandOutput(command, args) {
  // runCaptureSync routes .cmd shims (yarn/npm/corepack) through cmd.exe —
  // Node >= 18.20 refuses to spawn those directly on Windows (EINVAL), which
  // used to make every yarn probe report "not found" on Windows machines.
  const run = runCaptureSync(command, args)
  if (run.error || run.status !== 0) return null
  return `${run.stdout ?? ''}${run.stderr ?? ''}`
}

export function checkNodeVersion() {
  const major = Number.parseInt(process.versions.node.split('.')[0], 10)
  if (major === 24) return result('node', 'Node.js 24', 'pass', `v${process.versions.node}`)
  return result('node', 'Node.js 24', major > 24 ? 'warn' : 'fail', `found v${process.versions.node}, this repo pins Node 24.x`, {
    guide: ['Re-run the platform bootstrap (packages/starter/platform/start.sh, start.cmd on Windows) — it installs a private Node 24 without admin rights.'],
  })
}

export function checkYarn(repoRoot) {
  const output = commandOutput('yarn', ['--version'])
  let pinned = ''
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
    pinned = String(pkg.packageManager ?? '').split('+')[0].replace(/^yarn@/, '')
  } catch {
    pinned = ''
  }
  if (!output) {
    return result('yarn', 'Yarn (corepack)', 'fail', 'yarn not found on PATH', {
      guide: ['Run: corepack enable && corepack prepare $(node -p "require(\'./package.json\').packageManager.split(\'+\')[0]") --activate'],
    })
  }
  const version = output.trim()
  if (pinned && version !== pinned) {
    return result('yarn', 'Yarn (corepack)', 'warn', `yarn ${version} on PATH, repo pins ${pinned} (corepack resolves the pin inside the repo)`)
  }
  return result('yarn', 'Yarn (corepack)', 'pass', `yarn ${version}`)
}

export function checkGit() {
  const output = commandOutput('git', ['--version'])
  if (output) return result('git', 'Git', 'pass', output.trim())
  return result('git', 'Git', 'fail', 'git not found on PATH', {
    guide: process.platform === 'win32'
      ? ['Install Git for Windows from https://git-scm.com/download/win (user-scope install works without admin).']
      : ['Install git via your package manager (macOS: xcode-select --install).'],
    it: ['Approve/install Git for Windows (https://git-scm.com/download/win)'],
  })
}

export function checkContainerRuntime() {
  const docker = detectDocker()
  if (docker.ok) {
    const info = commandOutput('docker', ['info', '--format', '{{.OperatingSystem}} / {{.ServerVersion}}'])
    return result('runtime', 'Container runtime', 'pass', (info ?? 'engine running').trim())
  }
  const isWindows = process.platform === 'win32'
  const isMac = process.platform === 'darwin'
  const guide = isWindows
    ? [
        'Install ONE of (both use the WSL2 backend):',
        '  • Rancher Desktop (no admin needed, per-user install): https://rancherdesktop.io — pick the dockerd (moby) engine, Kubernetes off.',
        '  • Docker Desktop (needs admin + license for large companies): https://docs.docker.com/desktop/setup/install/windows-install/',
        'Then start it and re-run this command.',
      ]
    : isMac
      ? ['Install Docker Desktop (https://docs.docker.com/desktop/setup/install/mac-install/) or `brew install colima docker docker-compose && colima start`.']
      : ['Install Docker Engine + compose plugin (https://docs.docker.com/engine/install/) and add your user to the docker group.']
  return result('runtime', 'Container runtime', 'fail', `not usable (${docker.reason})`, {
    guide,
    it: isWindows
      ? ['Install a container runtime: Rancher Desktop (per-user, free) or Docker Desktop (license required above 250 employees).']
      : ['Install Docker Engine / Docker Desktop for this user.'],
  })
}

// Docker Desktop < 4.42.0 rejects certificates with negative serial numbers —
// which Zscaler interception CAs use — so pulls fail with cert errors even
// though the CA is trusted. https://github.com/docker/for-win/issues/14803
export function checkDockerDesktopVersion() {
  const platformName = commandOutput('docker', ['version', '--format', '{{.Server.Platform.Name}}'])
  const match = /Docker Desktop\s+(\d+)\.(\d+)\.(\d+)/.exec(platformName ?? '')
  if (!match) return null
  const [major, minor] = [Number(match[1]), Number(match[2])]
  const version = `${match[1]}.${match[2]}.${match[3]}`
  if (major > 4 || (major === 4 && minor >= 42)) {
    return result('docker-desktop', 'Docker Desktop version', 'pass', version)
  }
  return result('docker-desktop', 'Docker Desktop version', 'warn', `${version} — versions below 4.42.0 reject Zscaler's negative-serial certificates (pull failures behind Zscaler)`, {
    guide: ['Update Docker Desktop to 4.42.0 or newer.'],
    it: ['Approve a Docker Desktop update to >= 4.42.0 (Zscaler TLS-interception compatibility fix).'],
  })
}

export function checkWsl2() {
  if (process.platform !== 'win32') return null
  // `wsl --status` succeeds only when the WSL platform actually works; the
  // wsl.exe stub exists in System32 even on machines with the feature off, so
  // presence alone proves nothing.
  const status = commandOutput('wsl.exe', ['--status'])
  if (status !== null) {
    return result('wsl2', 'WSL2', 'pass', 'wsl --status responds')
  }
  return result('wsl2', 'WSL2', 'fail', 'WSL2 is not functional (required by Docker Desktop and Rancher Desktop)', {
    guide: [
      'Ask IT to enable WSL2, or run in an elevated PowerShell if you are allowed to:',
      '  wsl --install --no-distribution',
      'A reboot is required afterwards; then re-run this command.',
    ],
    it: [
      'Enable Windows features "Virtual Machine Platform" + "Windows Subsystem for Linux" and CPU virtualization (BIOS/firmware) on this device, then reboot:',
      '  wsl --install --no-distribution',
    ],
  })
}

export function checkResources(repoRoot) {
  const totalGb = os.totalmem() / GIB
  let freeDiskGb = null
  try {
    const stat = fs.statfsSync(repoRoot)
    freeDiskGb = (stat.bavail * stat.bsize) / GIB
  } catch {
    freeDiskGb = null
  }
  const diskDetail = freeDiskGb === null ? 'free disk unknown' : `${freeDiskGb.toFixed(0)} GB free disk`
  const detail = `${totalGb.toFixed(0)} GB RAM, ${diskDetail}`
  if (totalGb < 12) {
    return result('resources', 'Hardware (16 GB RAM recommended, 12 GB minimum)', 'fail', detail, {
      it: ['This device is below the 12 GB RAM floor for the Open Mercato dev stack — a hardware upgrade or a remote dev environment is needed.'],
    })
  }
  if (totalGb < 16 || (freeDiskGb !== null && freeDiskGb < 20)) {
    return result('resources', 'Hardware (16 GB RAM recommended, 12 GB minimum)', 'warn', `${detail} — expect slow builds; ~20 GB free disk needed for the first run`)
  }
  return result('resources', 'Hardware', 'pass', detail)
}

export async function checkLocalhostResolution() {
  try {
    const records = await dns.lookup('localhost', { all: true, verbatim: true })
    const hasV4 = records.some((entry) => entry.family === 4)
    const v6First = records.length > 0 && records[0].family === 6
    if (!hasV4) {
      return result('localhost', 'localhost resolution', 'fail', '`localhost` does not resolve to 127.0.0.1 on this machine', {
        guide: ['The starter always probes 127.0.0.1 directly, but other tools may break. Check the hosts file for a missing `127.0.0.1 localhost` line.'],
      })
    }
    if (v6First) {
      return result('localhost', 'localhost resolution', 'warn', '`localhost` prefers ::1 (IPv6) — the starter uses 127.0.0.1 explicitly, but hand-typed localhost URLs can behave differently')
    }
    return result('localhost', 'localhost resolution', 'pass', records.map((entry) => entry.address).join(', '))
  } catch (error) {
    return result('localhost', 'localhost resolution', 'fail', `lookup failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function probePort(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: LOOPBACK_HOST, port, timeout: 750 })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    const closed = () => {
      socket.destroy()
      resolve(false)
    }
    socket.once('timeout', closed)
    socket.once('error', closed)
  })
}

// Ports our own stack owns are only a conflict while the stack is down; the
// caller passes `stackRunning` accordingly.
export async function checkPorts(repoRoot, { stackRunning = false } = {}) {
  if (stackRunning) return result('ports', 'Port availability', 'pass', 'stack is running — listeners are expected')
  const ports = resolveStackPorts(repoRoot)
  const inUse = []
  for (const [service, port] of Object.entries(ports)) {
    if (await probePort(port)) inUse.push(`${port} (${service})`)
  }
  if (inUse.length === 0) return result('ports', 'Port availability', 'pass', 'all stack ports are free')
  return result('ports', 'Port availability', 'warn', `already listening: ${inUse.join(', ')}`, {
    guide: [
      'If these are leftovers of a previous run, stop them:  yarn om stop  (or: npx @open-mercato/starter stop).',
      'If another app owns the port (local Postgres on 5432 is common), override the port in .env (e.g. POSTGRES_PORT=5433) and re-run.',
    ],
  })
}

export async function checkTlsInterception(repoRoot) {
  const results = await probeTlsInterception()
  const { intercepted, unreachable, clean } = summarizeProbeResults(results)
  const bundleExists = fs.existsSync(path.join(repoRoot, CAPTURED_CA_BUNDLE))
  if (intercepted.length > 0) {
    return result(
      'tls',
      'Corporate TLS interception',
      bundleExists ? 'warn' : 'fail',
      `intercepted: ${intercepted.map((entry) => entry.host).join(', ')}${bundleExists ? ' (CA bundle already captured)' : ''}`,
      {
        guide: bundleExists
          ? ['The starter already provisions the captured CA into host tooling and image builds. If pulls still fail, your container engine needs the CA too — see the IT sheet.']
          : ['Run the starter (yarn om / npx @open-mercato/starter) — it captures the interception CA automatically and provisions it into yarn, node, and image builds.'],
        it: ['Provide the corporate root CA bundle (PEM) for developer tooling, or approve automatic capture. Docker Desktop reads the Windows certificate store; Rancher Desktop needs the CA provisioned into its WSL distro.'],
      },
    )
  }
  if (unreachable.length > 0 && clean.length === 0) {
    return result('tls', 'Network egress', 'fail', `unreachable: ${unreachable.map((entry) => `${entry.host} (${entry.reason})`).join(', ')}`, {
      guide: ['Check proxy settings: set HTTPS_PROXY/HTTP_PROXY if your network requires a proxy, then re-run.'],
      it: ['Allow developer egress to registry.yarnpkg.com, github.com, registry-1.docker.io (or provide internal mirrors — see starters/company/).'],
    })
  }
  if (unreachable.length > 0) {
    return result('tls', 'Network egress', 'warn', `partially blocked: ${unreachable.map((entry) => entry.host).join(', ')}`)
  }
  return result('tls', 'Network egress + TLS', 'pass', 'all probe hosts reachable with a trusted chain')
}

export function checkProxyConsistency() {
  const envProxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || ''
  if (process.platform !== 'win32') {
    return envProxy
      ? result('proxy', 'Proxy configuration', 'pass', `using ${envProxy}`)
      : null
  }
  const reg = commandOutput('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', '/v', 'ProxyEnable'])
  const systemProxyOn = /ProxyEnable\s+REG_DWORD\s+0x1/i.test(reg ?? '')
  if (systemProxyOn && !envProxy) {
    return result('proxy', 'Proxy configuration', 'warn', 'Windows uses a system proxy but HTTPS_PROXY is not set for command-line tools', {
      guide: ['Set the proxy for CLI tools too, e.g. in PowerShell:  $env:HTTPS_PROXY = "http://proxy.example.com:8080"  (ask IT for the proxy address; add it to your user environment variables to persist).'],
    })
  }
  if (envProxy) return result('proxy', 'Proxy configuration', 'pass', `using ${envProxy}`)
  return null
}

export function checkClonePath(repoRoot) {
  if (process.platform !== 'win32') return null
  const findings = []
  const oneDrive = process.env.OneDrive
  if (oneDrive && repoRoot.toLowerCase().startsWith(oneDrive.toLowerCase())) {
    findings.push('repo lives inside OneDrive — file watching and node_modules sync fight the sync client')
  }
  if (repoRoot.startsWith('\\\\')) {
    findings.push('repo lives on a UNC/network path')
  }
  const longPaths = commandOutput('reg', ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem', '/v', 'LongPathsEnabled'])
  const longPathsOn = /LongPathsEnabled\s+REG_DWORD\s+0x1/i.test(longPaths ?? '')
  if (!longPathsOn) {
    findings.push('NTFS long paths are disabled (MAX_PATH=260 can break deep node_modules)')
  }
  if (findings.length === 0) return result('clone-path', 'Clone location', 'pass', repoRoot)
  return result('clone-path', 'Clone location', 'warn', findings.join('; '), {
    guide: ['Prefer a short local path like C:\\dev\\open-mercato.', 'Enable long paths (admin): git config --system core.longpaths true — plus the registry switch below.'],
    it: ['Enable NTFS long paths:  reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem" /v LongPathsEnabled /t REG_DWORD /d 1'],
  })
}

// Verifies a container can reach a host port through host.docker.internal —
// the linchpin of the hybrid topology (OpenCode container -> host MCP). Two
// probes: (1) with the same extra_hosts pin compose.infra.yml uses (unless
// OM_HOST_GATEWAY overrides it), (2) with the engine's NATIVE resolution.
// On Rancher Desktop/WSL2 the pin can point at the WSL distro instead of the
// Windows host while native resolution is correct — the fix is OM_HOST_GATEWAY.
function probeContainerToHost(mcpPort, addHost) {
  const args = ['run', '--rm']
  if (addHost) args.push('--add-host', addHost)
  args.push('busybox:1.37', 'sh', '-c', `wget -q -O- -T 5 http://host.docker.internal:${mcpPort}/health 2>/dev/null || nslookup host.docker.internal 2>&1`)
  const run = spawnSync('docker', args, { encoding: 'utf8', timeout: 60000, windowsHide: true })
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim()
  return {
    ran: !run.error,
    mcpAnswered: run.status === 0 && output.includes('"status"'),
    resolvedIp: output.match(/Address:\s+(\d+\.\d+\.\d+\.\d+)/)?.[1] ?? null,
    output,
  }
}

export function checkContainerToHost(repoRoot, { mcpPort }) {
  const docker = detectDocker()
  if (!docker.ok) return null
  const pin = `host.docker.internal:${process.env.OM_HOST_GATEWAY?.trim() || 'host-gateway'}`
  const pinned = probeContainerToHost(mcpPort, pin)
  if (!pinned.ran) return result('container-host', 'Container → host connectivity', 'warn', 'probe container could not run')
  if (pinned.mcpAnswered) {
    return result('container-host', 'Container → host connectivity', 'pass', `host.docker.internal:${mcpPort}/health responded (mapping: ${pin})`)
  }
  const native = probeContainerToHost(mcpPort, null)
  if (native.mcpAnswered) {
    return result('container-host', 'Container → host connectivity', 'fail', `the compose extra_hosts pin (${pin}) does NOT reach the host, but the engine's native host.docker.internal DOES${native.resolvedIp ? ` (${native.resolvedIp})` : ''} — common on Rancher Desktop/WSL2`, {
      guide: [`Set OM_HOST_GATEWAY=${native.resolvedIp ?? '<the engine-native IP>'} in the root .env, then restart the opencode container.`],
    })
  }
  if (pinned.resolvedIp || native.resolvedIp) {
    const isWindows = process.platform === 'win32'
    const firewallRule = `New-NetFirewallRule -DisplayName "Open Mercato MCP dev" -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${mcpPort} -Profile Any`
    return result('container-host', 'Container → host connectivity', 'warn', `host.docker.internal resolves${pinned.resolvedIp ? ` (${pinned.resolvedIp})` : ''} but the MCP port did not answer — MCP is not running yet, or a host firewall blocks the container→host hop`, {
      guide: [
        'If the stack is not running yet, start it (yarn om) and re-run the doctor.',
        isWindows
          ? `Windows Firewall drops the container→host hop over the WSL/vEthernet adapter. Allow it (elevated PowerShell): ${firewallRule}`
          : 'Windows: allow node.exe inbound on the MCP port for Private networks (the first-run firewall prompt).',
        `Linux (ufw): sudo ufw allow from 172.16.0.0/12 to any port ${mcpPort} proto tcp`,
      ],
      it: isWindows
        ? [`Approve an inbound firewall rule for the local dev MCP server: ${firewallRule}`]
        : [],
    })
  }
  return result('container-host', 'Container → host connectivity', 'fail', 'host.docker.internal does not resolve inside containers', {
    guide: ['Set OPENCODE_MCP_URL in .env to a host IP the containers can reach, e.g. http://<your-lan-ip>:' + mcpPort + '/mcp.'],
  })
}

export async function runDoctor(repoRoot, { company = null, stackRunning = false, includeContainerProbe = false } = {}) {
  const ports = resolveStackPorts(repoRoot)
  const checks = [
    checkNodeVersion(),
    checkYarn(repoRoot),
    checkGit(),
    checkWsl2(),
    checkContainerRuntime(),
    checkDockerDesktopVersion(),
    checkResources(repoRoot),
    await checkLocalhostResolution(),
    checkProxyConsistency(),
    await checkTlsInterception(repoRoot),
    await checkPorts(repoRoot, { stackRunning }),
    checkClonePath(repoRoot),
  ]
  if (includeContainerProbe) checks.push(checkContainerToHost(repoRoot, { mcpPort: ports.mcp }))
  for (const custom of company?.checks ?? []) {
    try {
      const res = await custom.run({ repoRoot, ports })
      checks.push(result(custom.id, custom.title, res.level ?? 'warn', res.detail ?? '', { guide: res.guide ?? [], it: res.it ?? [] }))
    } catch (error) {
      checks.push(result(custom.id, custom.title, 'warn', `company check crashed: ${error instanceof Error ? error.message : String(error)}`))
    }
  }
  return checks.filter(Boolean)
}

const LEVEL_ICONS = { pass: icons.ok, warn: icons.warn, fail: icons.fail }

export function printDoctorReport(checks, { company = null, log = console.log } = {}) {
  printBanner('environment doctor — read-only audit, nothing is changed', { log })
  for (const check of checks) {
    log(`${LEVEL_ICONS[check.level] ?? icons.info} ${color.bold(check.title)} ${color.dim('—')} ${check.detail}`)
    for (const line of check.guide) log(color.dim(`     ${line}`))
  }
  const itLines = checks.flatMap((check) => check.it)
  if (itLines.length > 0) {
    log('')
    log(color.bold(color.yellow('── Hand this to IT ' + '─'.repeat(40))))
    log('The items below need admin rights or policy changes on this managed device:')
    for (const line of itLines) log(`  * ${line}`)
    if (company?.itContact) log(`  Contact: ${company.itContact}`)
  }
  const fails = checks.filter((check) => check.level === 'fail').length
  const warns = checks.filter((check) => check.level === 'warn').length
  log('')
  if (fails > 0) log(color.bold(color.red(`Verdict: ${fails} blocking issue(s), ${warns} warning(s). Fix the blocking items, then re-run.`)))
  else if (warns > 0) log(color.bold(color.yellow(`Verdict: ready, with ${warns} warning(s).`)))
  else log(color.bold(color.green('Verdict: ready.')))
  return fails === 0
}
