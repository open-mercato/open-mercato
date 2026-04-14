import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveSpawnCommand } from './dev-spawn-utils.mjs'

const FALSE_TOKENS = new Set(['0', 'false', 'no', 'off', 'disabled'])
const TOOL_DEFINITIONS = [
  {
    id: 'vscode',
    label: 'Visual Studio Code',
    cliNames: ['code'],
    envVarName: 'OM_DEV_SPLASH_VSCODE_PATH',
    macAppName: 'Visual Studio Code',
    setupToolId: null,
    launchMode: 'workspace',
  },
  {
    id: 'cursor',
    label: 'Cursor',
    cliNames: ['cursor'],
    envVarName: 'OM_DEV_SPLASH_CURSOR_PATH',
    macAppName: 'Cursor',
    setupToolId: 'cursor',
    launchMode: 'workspace',
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    cliNames: ['claude'],
    envVarName: 'OM_DEV_SPLASH_CLAUDE_CODE_PATH',
    macAppName: null,
    setupToolId: 'claude-code',
    launchMode: 'terminal',
  },
  {
    id: 'codex',
    label: 'Codex',
    cliNames: ['codex'],
    envVarName: 'OM_DEV_SPLASH_CODEX_PATH',
    macAppName: null,
    setupToolId: 'codex',
    launchMode: 'terminal',
  },
]

const TOOL_BY_ID = new Map(TOOL_DEFINITIONS.map((tool) => [tool.id, tool]))

export function isCodingFlowEnabled(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return true
  return !FALSE_TOKENS.has(value.trim().toLowerCase())
}

function hasFileSystemEntry(filePath) {
  if (typeof filePath !== 'string' || filePath.trim().length === 0) return false
  try {
    fs.accessSync(filePath, fs.constants.F_OK)
    return true
  } catch {
    return false
  }
}

function getExecutableExtensions(platform, env) {
  if (platform !== 'win32') return ['']

  const pathExtValue = typeof env.PATHEXT === 'string' && env.PATHEXT.trim().length > 0
    ? env.PATHEXT
    : (typeof env.Pathext === 'string' && env.Pathext.trim().length > 0 ? env.Pathext : '')
  const configured = pathExtValue
    ? pathExtValue.split(';').map((entry) => entry.trim().toLowerCase()).filter(Boolean)
    : ['.exe', '.cmd', '.bat', '.ps1']

  return configured.includes('') ? configured : ['', ...configured]
}

function getPathValue(env, platform) {
  if (platform === 'win32') {
    if (typeof env.Path === 'string' && env.Path.trim().length > 0) return env.Path
    if (typeof env.PATH === 'string' && env.PATH.trim().length > 0) return env.PATH
    return ''
  }

  return typeof env.PATH === 'string' ? env.PATH : ''
}

function getLinuxFallbackExecutableCandidates(tool, env) {
  const homeDir = typeof env.HOME === 'string' && env.HOME.trim().length > 0
    ? env.HOME
    : os.homedir()

  switch (tool.id) {
    case 'vscode':
      return [
        '/usr/bin/code',
        '/usr/local/bin/code',
        '/snap/bin/code',
        path.join(homeDir, '.local', 'bin', 'code'),
        '/var/lib/flatpak/exports/bin/com.visualstudio.code',
      ]
    case 'cursor':
      return [
        '/usr/bin/cursor',
        '/usr/local/bin/cursor',
        '/snap/bin/cursor',
        path.join(homeDir, '.local', 'bin', 'cursor'),
        '/opt/Cursor.AppImage',
      ]
    case 'claude-code':
      return [
        '/usr/bin/claude',
        '/usr/local/bin/claude',
        '/snap/bin/claude',
        path.join(homeDir, '.local', 'bin', 'claude'),
      ]
    case 'codex':
      return [
        '/usr/bin/codex',
        '/usr/local/bin/codex',
        '/snap/bin/codex',
        path.join(homeDir, '.local', 'bin', 'codex'),
      ]
    default:
      return []
  }
}

function getWindowsFallbackExecutableCandidates(tool, env) {
  const localAppData = typeof env.LOCALAPPDATA === 'string' ? env.LOCALAPPDATA : null
  const programFiles = typeof env.ProgramFiles === 'string' ? env.ProgramFiles : null
  const programFilesX86 = typeof env['ProgramFiles(x86)'] === 'string' ? env['ProgramFiles(x86)'] : null

  switch (tool.id) {
    case 'vscode':
      return [
        localAppData ? path.join(localAppData, 'Programs', 'Microsoft VS Code', 'Code.exe') : null,
        programFiles ? path.join(programFiles, 'Microsoft VS Code', 'Code.exe') : null,
        programFilesX86 ? path.join(programFilesX86, 'Microsoft VS Code', 'Code.exe') : null,
      ].filter(Boolean)
    case 'cursor':
      return [
        localAppData ? path.join(localAppData, 'Programs', 'Cursor', 'Cursor.exe') : null,
        programFiles ? path.join(programFiles, 'Cursor', 'Cursor.exe') : null,
        programFilesX86 ? path.join(programFilesX86, 'Cursor', 'Cursor.exe') : null,
      ].filter(Boolean)
    case 'claude-code':
      return [
        localAppData ? path.join(localAppData, 'Programs', 'Claude', 'claude.exe') : null,
      ].filter(Boolean)
    case 'codex':
      return [
        localAppData ? path.join(localAppData, 'Programs', 'Codex', 'codex.exe') : null,
      ].filter(Boolean)
    default:
      return []
  }
}

function getFallbackExecutableCandidates(tool, env, platform) {
  if (tool.envVarName && typeof env[tool.envVarName] === 'string' && env[tool.envVarName].trim().length > 0) {
    return [env[tool.envVarName].trim()]
  }

  if (platform === 'win32') {
    return getWindowsFallbackExecutableCandidates(tool, env)
  }

  if (platform === 'linux') {
    return getLinuxFallbackExecutableCandidates(tool, env)
  }

  return []
}

function findExecutable(commandNames, options = {}) {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const pathValue = getPathValue(env, platform)
  const pathSegments = pathValue.split(path.delimiter).map((segment) => segment.trim()).filter(Boolean)
  const extensions = getExecutableExtensions(platform, env)

  for (const commandName of commandNames) {
    if (hasFileSystemEntry(commandName)) {
      return commandName
    }

    for (const directory of pathSegments) {
      for (const extension of extensions) {
        const candidate = path.join(directory, extension ? `${commandName}${extension}` : commandName)
        if (hasFileSystemEntry(candidate)) {
          return candidate
        }
      }
    }
  }

  return null
}

function resolveToolExecutablePath(tool, options = {}) {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const executablePath = findExecutable(tool.cliNames, { env, platform })
  if (executablePath) return executablePath

  const fallbackCandidates = getFallbackExecutableCandidates(tool, env, platform)
  for (const candidate of fallbackCandidates) {
    if (hasFileSystemEntry(candidate)) {
      return candidate
    }
  }

  return null
}

function findMacAppBundle(appName) {
  if (typeof appName !== 'string' || appName.trim().length === 0) return null

  const candidateDirectories = [
    '/Applications',
    path.join(os.homedir(), 'Applications'),
  ]

  for (const directory of candidateDirectories) {
    const candidate = path.join(directory, `${appName}.app`)
    if (hasFileSystemEntry(candidate)) {
      return candidate
    }
  }

  return null
}

function getSetupFiles(toolId) {
  switch (toolId) {
    case 'claude-code':
      return ['CLAUDE.md', '.claude/settings.json', '.mcp.json.example']
    case 'codex':
      return ['.codex/mcp.json.example']
    case 'cursor':
      return ['.cursor/hooks.json']
    default:
      return []
  }
}

function isToolConfigured(toolId, targetDir) {
  if (typeof targetDir !== 'string' || targetDir.trim().length === 0) return true

  const setupFiles = getSetupFiles(toolId)
  if (setupFiles.length === 0) return true

  return setupFiles.every((relativePath) => hasFileSystemEntry(path.join(targetDir, relativePath)))
}

function describeTool(tool, configured, canConfigure) {
  if (tool.launchMode === 'terminal') {
    if (tool.setupToolId && canConfigure && !configured) {
      return 'Configures the project first, then starts an interactive coding terminal.'
    }
    return 'Starts an interactive coding terminal for this workspace.'
  }

  if (tool.setupToolId && canConfigure && !configured) {
    return 'Configures the project first, then opens the workspace.'
  }

  return 'Opens this workspace in the selected editor.'
}

export function detectSplashCodingTools(options = {}) {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const agenticSetupDir = options.agenticSetupDir ?? null

  return TOOL_DEFINITIONS.map((tool) => {
    const executablePath = resolveToolExecutablePath(tool, { env, platform })
    const appBundlePath = platform === 'darwin' ? findMacAppBundle(tool.macAppName) : null
    const available = tool.launchMode === 'terminal'
      ? Boolean(executablePath)
      : Boolean(executablePath || appBundlePath)
    const canConfigure = Boolean(tool.setupToolId && agenticSetupDir)
    const configured = tool.setupToolId ? isToolConfigured(tool.setupToolId, agenticSetupDir) : true

    return {
      id: tool.id,
      label: tool.label,
      available,
      configured,
      requiresSetup: canConfigure,
      launchMode: tool.launchMode,
      description: describeTool(tool, configured, canConfigure),
      executablePath,
      appBundlePath,
    }
  }).filter((tool) => tool.available)
}

function writeJson(res, statusCode, payload) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

// Reject any string that would smuggle control characters or NUL bytes through
// the shell-launching codepath. This is the canonical sanitizer for paths and
// shell argument values used by the splash coding flow; CodeQL recognizes the
// explicit reject as a safe boundary.
const SHELL_UNSAFE_CHAR_PATTERN = /[\u0000-\u001f\u007f]/

export function isShellSafePathString(value) {
  return typeof value === 'string'
    && value.length > 0
    && !SHELL_UNSAFE_CHAR_PATTERN.test(value)
}

export function assertShellSafePath(value, label) {
  if (!isShellSafePathString(value)) {
    throw new Error(`${label} contains invalid or unsafe characters.`)
  }
  return value
}

export { sanitizeLaunchDirectory }

function sanitizeLaunchDirectory(value) {
  const fallback = process.cwd()
  if (!isShellSafePathString(value) || value.trim().length === 0) {
    return fallback
  }

  const resolved = path.resolve(value)
  if (!isShellSafePathString(resolved)) {
    return fallback
  }

  try {
    const stat = fs.statSync(resolved)
    if (!stat.isDirectory()) {
      return fallback
    }
  } catch {
    return fallback
  }

  return resolved
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''

    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 8192) {
        reject(new Error('Request body too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      if (body.trim().length === 0) {
        resolve({})
        return
      }

      try {
        resolve(JSON.parse(body))
      } catch {
        reject(new Error('Invalid JSON payload'))
      }
    })
    req.on('error', reject)
  })
}

function spawnDetached(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const resolvedSpawn = resolveSpawnCommand(command, args)
    const child = spawn(resolvedSpawn.command, resolvedSpawn.args, {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: 'ignore',
      ...resolvedSpawn.spawnOptions,
    })

    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

function spawnCaptured(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const resolvedSpawn = resolveSpawnCommand(command, args)
    const child = spawn(resolvedSpawn.command, resolvedSpawn.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...resolvedSpawn.spawnOptions,
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk
    })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      resolve({ code, signal, stdout, stderr })
    })
  })
}

function quoteAppleScript(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function quotePosix(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function quoteWindowsArgument(value) {
  return `"${String(value).replace(/"/g, '""')}"`
}

function resolveTerminalLauncher(env, platform) {
  if (platform === 'darwin') {
    return { type: 'osascript' }
  }

  if (platform === 'win32') {
    return { type: 'cmd' }
  }

  const candidates = [
    { command: 'wezterm', argsFor: (shellCommand) => ['start', '--cwd', '.', 'bash', '-lc', shellCommand] },
    { command: 'kitty', argsFor: (shellCommand) => ['bash', '-lc', shellCommand] },
    { command: 'alacritty', argsFor: (shellCommand) => ['-e', 'bash', '-lc', shellCommand] },
    { command: 'tilix', argsFor: (shellCommand) => ['--working-directory', '.', '-e', 'bash', '-lc', shellCommand] },
    { command: 'x-terminal-emulator', argsFor: (shellCommand) => ['-e', 'bash', '-lc', shellCommand] },
    { command: 'gnome-terminal', argsFor: (shellCommand) => ['--', 'bash', '-lc', shellCommand] },
    { command: 'konsole', argsFor: (shellCommand) => ['-e', 'bash', '-lc', shellCommand] },
    { command: 'xfce4-terminal', argsFor: (shellCommand) => ['--command', `bash -lc ${quotePosix(shellCommand)}`] },
    { command: 'xterm', argsFor: (shellCommand) => ['-e', 'bash', '-lc', shellCommand] },
  ]

  for (const candidate of candidates) {
    const executablePath = findExecutable([candidate.command], { env, platform })
    if (executablePath) {
      return {
        type: 'linux-terminal',
        command: executablePath,
        argsFor: candidate.argsFor,
      }
    }
  }

  return null
}

async function launchInteractiveTerminal(commandPath, options = {}) {
  const safeCommandPath = assertShellSafePath(commandPath, 'Coding tool executable path')
  const rawLaunchDir = options.launchDir ?? process.cwd()
  const safeLaunchDir = assertShellSafePath(rawLaunchDir, 'Launch directory')
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const launcher = resolveTerminalLauncher(env, platform)

  if (!launcher) {
    throw new Error('No supported terminal launcher was detected on this system.')
  }

  if (launcher.type === 'osascript') {
    const shellCommand = `cd ${quotePosix(safeLaunchDir)} && ${quotePosix(safeCommandPath)}`
    await spawnDetached('osascript', [
      '-e',
      'tell application "Terminal" to activate',
      '-e',
      `tell application "Terminal" to do script ${quoteAppleScript(shellCommand)}`,
    ], { env })
    return
  }

  if (launcher.type === 'cmd') {
    const shellCommand = `cd /d ${quoteWindowsArgument(safeLaunchDir)} && ${quoteWindowsArgument(safeCommandPath)}`
    await spawnDetached('cmd', ['/c', `start "" cmd /k ${quoteWindowsArgument(shellCommand)}`], {
      cwd: safeLaunchDir,
      env,
    })
    return
  }

  const shellCommand = `cd ${quotePosix(safeLaunchDir)} && ${quotePosix(safeCommandPath)}; exec "\${SHELL:-bash}"`
  await spawnDetached(launcher.command, launcher.argsFor(shellCommand), {
    cwd: safeLaunchDir,
    env,
  })
}

async function launchWorkspaceTool(toolState, options = {}) {
  const launchDir = assertShellSafePath(
    sanitizeLaunchDirectory(options.launchDir),
    'Launch directory',
  )
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform

  if (toolState.executablePath) {
    const safeExecutable = assertShellSafePath(toolState.executablePath, 'Coding tool executable path')
    await spawnDetached(safeExecutable, ['--reuse-window', launchDir], {
      cwd: launchDir,
      env,
    })
    return
  }

  if (platform === 'darwin' && toolState.appBundlePath) {
    const safeBundlePath = assertShellSafePath(toolState.appBundlePath, 'Coding tool bundle path')
    await spawnDetached('open', ['-a', safeBundlePath, launchDir], {
      cwd: launchDir,
      env,
    })
    return
  }

  throw new Error(`${toolState.label} is installed but could not be launched from the splash screen.`)
}

async function runAgenticInit(toolId, options = {}) {
  const agenticSetupDir = options.agenticSetupDir ?? null
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform

  if (!agenticSetupDir) {
    return { ran: false, stdout: '', stderr: '' }
  }

  const safeAgenticSetupDir = assertShellSafePath(agenticSetupDir, 'Agentic setup directory')
  const safeToolId = assertShellSafePath(toolId, 'Coding tool id')

  const yarnCommand = platform === 'win32' ? 'yarn.cmd' : 'yarn'
  const result = await spawnCaptured(yarnCommand, ['mercato', 'agentic:init', `--tool=${safeToolId}`], {
    cwd: safeAgenticSetupDir,
    env: {
      ...env,
      FORCE_COLOR: '0',
    },
  })

  if (result.code !== 0) {
    const message = [result.stderr, result.stdout].join('\n').trim()
    throw new Error(message || `Agentic setup failed for ${toolId}.`)
  }

  return {
    ran: true,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}

function buildSuccessMessage(toolState, setupApplied) {
  if (toolState.launchMode === 'terminal') {
    if (setupApplied) {
      return `Configured ${toolState.label} for this project and opened a new terminal.`
    }
    return `Opened a new terminal and started ${toolState.label}.`
  }

  if (setupApplied) {
    return `Configured ${toolState.label} for this project and opened the workspace.`
  }

  return `Opened ${toolState.label} for this workspace.`
}

export function createDevSplashCodingFlow(options = {}) {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const launchDir = sanitizeLaunchDirectory(options.launchDir)
  const agenticSetupDir = options.agenticSetupDir ?? null
  const enabled = isCodingFlowEnabled(env.OM_ENABLE_CODING_FLOW_FROM_SPLASH)
  const actionToken = enabled ? randomUUID() : null
  const actionState = {
    busy: false,
    activeToolId: null,
    lastResult: null,
  }

  function getSnapshot(extraState = {}) {
    if (!enabled) {
      return { enabled: false }
    }

    const tools = detectSplashCodingTools({
      env,
      platform,
      agenticSetupDir,
    }).map((tool) => ({
      id: tool.id,
      label: tool.label,
      configured: tool.configured,
      requiresSetup: tool.requiresSetup,
      launchMode: tool.launchMode,
      description: tool.description,
    }))

    return {
      enabled: true,
      ready: extraState.ready === true,
      failed: extraState.failed === true,
      available: tools.length > 0,
      busy: actionState.busy,
      activeToolId: actionState.activeToolId,
      lastResult: actionState.lastResult,
      tools,
    }
  }

  async function startCoding(toolId) {
    const toolState = detectSplashCodingTools({
      env,
      platform,
      agenticSetupDir,
    }).find((tool) => tool.id === toolId)

    if (!toolState) {
      throw new Error('The selected coding tool is not available on this system.')
    }

    let setupApplied = false
    if (toolState.requiresSetup && !toolState.configured) {
      await runAgenticInit(toolId, {
        agenticSetupDir,
        env,
        platform,
      })
      setupApplied = true
    }

    if (toolState.launchMode === 'terminal') {
      await launchInteractiveTerminal(toolState.executablePath, {
        launchDir,
        env,
        platform,
      })
    } else {
      await launchWorkspaceTool(toolState, {
        launchDir,
        env,
        platform,
      })
    }

    return buildSuccessMessage(toolState, setupApplied)
  }

  async function handleRequest(req, res, extraState = {}) {
    if (!enabled) return false
    if (!req.url) return false

    const requestUrl = new URL(req.url, 'http://localhost')
    if (requestUrl.pathname !== '/actions/start-coding') {
      return false
    }

    if (req.method !== 'POST') {
      writeJson(res, 405, { ok: false, error: 'Method not allowed.' })
      return true
    }

    if (req.headers['x-om-dev-splash-token'] !== actionToken) {
      writeJson(res, 403, { ok: false, error: 'Invalid splash action token.' })
      return true
    }

    if (actionState.busy) {
      writeJson(res, 409, {
        ok: false,
        error: 'Another coding flow action is already in progress.',
        codingFlow: getSnapshot(extraState),
      })
      return true
    }

    let payload = null

    try {
      payload = await readJsonBody(req)
    } catch (error) {
      writeJson(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : 'Invalid coding flow request.',
      })
      return true
    }

    const toolId = typeof payload?.toolId === 'string' ? payload.toolId.trim() : ''
    if (!TOOL_BY_ID.has(toolId)) {
      writeJson(res, 400, { ok: false, error: 'Unknown coding tool selection.' })
      return true
    }

    actionState.busy = true
    actionState.activeToolId = toolId
    actionState.lastResult = {
      kind: 'info',
      message: `Starting ${TOOL_BY_ID.get(toolId).label}...`,
    }

    let responsePayload = null

    try {
      const message = await startCoding(toolId)
      actionState.lastResult = { kind: 'success', message }
      responsePayload = {
        ok: true,
        codingFlow: getSnapshot(extraState),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to start the selected coding tool.'
      actionState.lastResult = { kind: 'error', message }
      responsePayload = {
        ok: false,
        error: message,
        codingFlow: getSnapshot(extraState),
      }
    } finally {
      actionState.busy = false
      actionState.activeToolId = null
    }

    responsePayload.codingFlow = getSnapshot(extraState)
    writeJson(res, responsePayload.ok ? 200 : 500, responsePayload)
    return true
  }

  return {
    enabled,
    getBootstrapPayload() {
      return enabled
        ? {
            enabled: true,
            actionToken,
          }
        : {
            enabled: false,
          }
    },
    getSnapshot,
    handleRequest,
  }
}
