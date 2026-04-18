import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { resolveSpawnCommand } from './dev-spawn-utils.mjs'

const FALSE_TOKENS = new Set(['0', 'false', 'no', 'off', 'disabled'])
const GITHUB_REMOTE_PATTERNS = [
  /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i,
  /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i,
  /^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i,
]

export function isGitRepoFlowEnabled(value) {
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

  const configured = typeof env.PATHEXT === 'string' && env.PATHEXT.trim().length > 0
    ? env.PATHEXT.split(';').map((entry) => entry.trim().toLowerCase()).filter(Boolean)
    : ['.exe', '.cmd', '.bat', '.ps1']

  return configured.includes('') ? configured : ['', ...configured]
}

function findExecutable(commandNames, options = {}) {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const pathValue = typeof env.PATH === 'string' ? env.PATH : ''
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

function spawnResult(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const stdio = options.interactive
      ? 'inherit'
      : ['ignore', 'pipe', 'pipe']
    const resolvedSpawn = resolveSpawnCommand(command, args)
    const child = spawn(resolvedSpawn.command, resolvedSpawn.args, {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      stdio,
      ...resolvedSpawn.spawnOptions,
    })

    let stdout = ''
    let stderr = ''

    if (!options.interactive) {
      child.stdout?.setEncoding('utf8')
      child.stderr?.setEncoding('utf8')
      child.stdout?.on('data', (chunk) => {
        stdout += chunk
      })
      child.stderr?.on('data', (chunk) => {
        stderr += chunk
      })
    }

    child.once('error', reject)
    child.once('close', (code, signal) => {
      resolve({ code, signal, stdout, stderr })
    })
  })
}

function defaultRunCommand(command, args, options = {}) {
  return spawnResult(command, args, options)
}

function trimOutput(value) {
  return String(value ?? '').trim()
}

function describeCommandFailure(command, args, result, fallbackMessage) {
  const detail = [trimOutput(result?.stderr), trimOutput(result?.stdout)].filter(Boolean)[0]
  if (detail) return detail
  if (typeof result?.code === 'number') {
    return `${fallbackMessage} (${command} ${args.join(' ')} exited with code ${result.code}).`
  }
  return fallbackMessage
}

function writeJson(res, statusCode, payload) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
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

function normalizeSuggestedRepoName(value) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^@[^/]+\//, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')

  return normalized || 'open-mercato-app'
}

function resolveDefaultRepoName(launchDir, readTextFile = (filePath) => fs.readFileSync(filePath, 'utf8')) {
  const fallbackName = normalizeSuggestedRepoName(path.basename(launchDir))
  const packageJsonPath = path.join(launchDir, 'package.json')
  if (!hasFileSystemEntry(packageJsonPath)) {
    return fallbackName
  }

  try {
    const parsed = JSON.parse(readTextFile(packageJsonPath))
    if (typeof parsed?.name === 'string' && parsed.name.trim().length > 0) {
      return normalizeSuggestedRepoName(parsed.name)
    }
  } catch {}

  return fallbackName
}

export function parseGitHubRemoteUrl(remoteUrl) {
  const raw = trimOutput(remoteUrl)
  if (!raw) return null

  for (const pattern of GITHUB_REMOTE_PATTERNS) {
    const match = raw.match(pattern)
    if (!match) continue

    const owner = match[1]
    const repo = match[2]
    return {
      owner,
      repo,
      url: `https://github.com/${owner}/${repo}`,
    }
  }

  return null
}

export function classifyRepoState(input = {}) {
  if (input.hasGitDir !== true) return 'missing'
  if (!trimOutput(input.originUrl)) return 'local_only'
  return parseGitHubRemoteUrl(input.originUrl) ? 'github_remote' : 'other_remote'
}

export function planLocalRepoBootstrap(input = {}) {
  const repoState = input.repoState ?? 'missing'
  const hasCommits = input.hasCommits === true

  return {
    shouldInit: repoState === 'missing',
    shouldCreateInitialCommit: !hasCommits,
  }
}

export function buildGhInstallMessage(platform = process.platform) {
  if (platform === 'darwin') {
    return 'GitHub CLI (`gh`) is required for automatic GitHub repository creation. Install it with `brew install gh`, then restart `yarn dev`.'
  }

  return 'GitHub CLI (`gh`) is required for automatic GitHub repository creation. Install GitHub CLI, then restart `yarn dev`.'
}

async function detectGitRepositoryState(options) {
  const launchDir = options.launchDir
  const runCommand = options.runCommand ?? defaultRunCommand
  const env = options.env ?? process.env
  const hasGitDir = hasFileSystemEntry(path.join(launchDir, '.git'))

  if (!hasGitDir) {
    return {
      hasGitDir: false,
      hasCommits: false,
      originUrl: null,
      repoState: 'missing',
      repoUrl: null,
    }
  }

  const originResult = await runCommand('git', ['remote', 'get-url', 'origin'], {
    cwd: launchDir,
    env,
  })
  const originUrl = originResult.code === 0 ? trimOutput(originResult.stdout) : null
  const headResult = await runCommand('git', ['rev-parse', '--verify', 'HEAD'], {
    cwd: launchDir,
    env,
  })
  const parsedRemote = parseGitHubRemoteUrl(originUrl)

  return {
    hasGitDir: true,
    hasCommits: headResult.code === 0,
    originUrl,
    repoState: classifyRepoState({ hasGitDir: true, originUrl }),
    repoUrl: parsedRemote?.url ?? null,
  }
}

async function detectGitHubCliState(options) {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const runCommand = options.runCommand ?? defaultRunCommand
  const ghPath = findExecutable(['gh'], { env, platform })

  if (!ghPath) {
    return {
      ghPath: null,
      ghStatus: 'missing',
      authStatus: 'unknown',
      ownerOptions: [],
      defaultOwner: null,
    }
  }

  const authResult = await runCommand(ghPath, ['auth', 'status', '--active', '--hostname', 'github.com'], {
    cwd: options.launchDir,
    env,
  })

  if (authResult.code !== 0) {
    return {
      ghPath,
      ghStatus: 'available',
      authStatus: 'unauthenticated',
      ownerOptions: [],
      defaultOwner: null,
    }
  }

  const userResult = await runCommand(ghPath, ['api', '/user'], {
    cwd: options.launchDir,
    env,
  })
  const orgResult = await runCommand(ghPath, ['api', '/user/orgs'], {
    cwd: options.launchDir,
    env,
  })

  const ownerOptions = []
  let defaultOwner = null

  try {
    const parsedUser = JSON.parse(userResult.stdout)
    if (typeof parsedUser?.login === 'string' && parsedUser.login.trim().length > 0) {
      defaultOwner = parsedUser.login.trim()
      ownerOptions.push(defaultOwner)
    }
  } catch {}

  try {
    const parsedOrgs = JSON.parse(orgResult.stdout)
    if (Array.isArray(parsedOrgs)) {
      for (const org of parsedOrgs) {
        if (typeof org?.login !== 'string' || org.login.trim().length === 0) continue
        ownerOptions.push(org.login.trim())
      }
    }
  } catch {}

  return {
    ghPath,
    ghStatus: 'available',
    authStatus: 'authenticated',
    ownerOptions: Array.from(new Set(ownerOptions)),
    defaultOwner,
  }
}

function buildFlowMessage(input = {}) {
  if (input.actionMessage) return input.actionMessage
  if (input.ghStatus === 'missing' && input.repoState !== 'github_remote' && input.repoState !== 'other_remote') {
    return buildGhInstallMessage(input.platform)
  }
  if (input.remoteRepoExists === true && input.repoUrl) {
    return 'This GitHub repository already exists. Open it below.'
  }
  if (input.repoState === 'github_remote' && input.repoUrl) {
    return 'This project is already connected to GitHub.'
  }
  if (input.repoState === 'other_remote') {
    return 'This project already has an origin remote that does not point to GitHub.'
  }
  if (input.authStatus === 'unauthenticated') {
    return 'Sign in with GitHub to create and push a repository for this project.'
  }
  if (input.repoState === 'local_only') {
    return 'Publish this local repository to GitHub.'
  }
  return 'Create a new GitHub repository for this project.'
}

export async function detectGitRepoFlowState(options = {}) {
  const repoState = await detectGitRepositoryState(options)
  const cliState = await detectGitHubCliState(options)
  const platform = options.platform ?? process.platform

  return {
    repoState: repoState.repoState,
    repoUrl: repoState.repoUrl,
    ghStatus: cliState.ghStatus,
    authStatus: cliState.authStatus,
    ownerOptions: cliState.ownerOptions,
    defaultOwner: cliState.defaultOwner,
    defaultRepoName: resolveDefaultRepoName(options.launchDir ?? process.cwd(), options.readTextFile),
    hasCommits: repoState.hasCommits,
    ghPath: cliState.ghPath,
    originUrl: repoState.originUrl,
    message: buildFlowMessage({
      platform,
      repoState: repoState.repoState,
      repoUrl: repoState.repoUrl,
      ghStatus: cliState.ghStatus,
      authStatus: cliState.authStatus,
    }),
  }
}

async function runChecked(command, args, options = {}) {
  const runCommand = options.runCommand ?? defaultRunCommand
  const result = await runCommand(command, args, options)
  if (result.code === 0) return result

  throw new Error(describeCommandFailure(command, args, result, options.failureMessage || 'Command failed.'))
}

async function findExistingGitHubRepository(options = {}) {
  const ghPath = options.ghPath
  const owner = trimOutput(options.owner)
  const repoName = trimOutput(options.repoName)

  if (!ghPath || !owner || !repoName) {
    return null
  }

  const runCommand = options.runCommand ?? defaultRunCommand
  const result = await runCommand(ghPath, ['repo', 'view', `${owner}/${repoName}`, '--json', 'url'], {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
  })

  if (result.code !== 0) {
    return null
  }

  try {
    const parsed = JSON.parse(result.stdout)
    if (typeof parsed?.url === 'string' && parsed.url.trim().length > 0) {
      return parsed.url.trim()
    }
  } catch {}

  return null
}

function isGitHubRepositoryAlreadyExistsError(error) {
  const message = trimOutput(error instanceof Error ? error.message : error)
  if (!message) return false

  return /name already exists on this account/i.test(message)
    || /already exists/i.test(message)
}

export async function runGitRepoPublishAction(options = {}) {
  const launchDir = options.launchDir ?? process.cwd()
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const onUpdate = typeof options.onUpdate === 'function' ? options.onUpdate : () => {}

  let detected = await detectGitRepoFlowState({
    launchDir,
    env,
    platform,
    runCommand: options.runCommand,
    readTextFile: options.readTextFile,
  })

  if (detected.ghStatus !== 'available' || !detected.ghPath) {
    throw new Error(buildGhInstallMessage(platform))
  }

  const repoName = normalizeSuggestedRepoName(options.repoName || detected.defaultRepoName)
  const visibility = options.visibility === 'public' ? 'public' : 'private'

  if (detected.authStatus !== 'authenticated') {
    onUpdate({
      actionState: 'authenticating',
      message: 'Authenticating with GitHub in your browser...',
    })
    await runChecked(detected.ghPath, ['auth', 'login', '--web', '--git-protocol', 'https'], {
      cwd: launchDir,
      env,
      interactive: process.stdin.isTTY && process.stdout.isTTY,
      runCommand: options.runCommand,
      failureMessage: 'GitHub authentication did not complete successfully.',
    })
    detected = await detectGitRepoFlowState({
      launchDir,
      env,
      platform,
      runCommand: options.runCommand,
      readTextFile: options.readTextFile,
    })
  }

  const owner = String(options.owner || detected.defaultOwner || '').trim()
  if (!owner) {
    throw new Error('No GitHub owner is available. Authenticate with GitHub and try again.')
  }

  const existingRepoUrl = await findExistingGitHubRepository({
    ghPath: detected.ghPath,
    owner,
    repoName,
    cwd: launchDir,
    env,
    runCommand: options.runCommand,
  })

  if (existingRepoUrl) {
    return {
      repoUrl: existingRepoUrl,
      repoState: detected.repoState,
      owner,
      repoName,
      visibility,
      remoteRepoExists: true,
      message: 'This GitHub repository already exists. Open it below.',
    }
  }

  const bootstrapPlan = planLocalRepoBootstrap({
    repoState: detected.repoState,
    hasCommits: detected.hasCommits,
  })

  if (bootstrapPlan.shouldInit) {
    onUpdate({
      actionState: 'creating_local_repo',
      message: 'Creating a local Git repository...',
    })
    await runChecked('git', ['init', '-b', 'main'], {
      cwd: launchDir,
      env,
      runCommand: options.runCommand,
      failureMessage: 'Unable to initialize a local Git repository.',
    })
  }

  if (bootstrapPlan.shouldCreateInitialCommit) {
    onUpdate({
      actionState: 'creating_local_repo',
      message: 'Creating the initial commit...',
    })
    await runChecked('git', ['add', '-A'], {
      cwd: launchDir,
      env,
      runCommand: options.runCommand,
      failureMessage: 'Unable to stage files for the initial commit.',
    })
    await runChecked('git', ['commit', '-m', 'Initial commit'], {
      cwd: launchDir,
      env,
      runCommand: options.runCommand,
      failureMessage: 'Unable to create the initial commit. Configure your Git identity and try again.',
    })
  }

  onUpdate({
    actionState: 'creating_remote_repo',
    message: 'Creating the GitHub repository and pushing the current branch...',
  })
  try {
    await runChecked(detected.ghPath, [
      'repo',
      'create',
      `${owner}/${repoName}`,
      visibility === 'public' ? '--public' : '--private',
      '--source',
      '.',
      '--remote',
      'origin',
      '--push',
    ], {
      cwd: launchDir,
      env,
      runCommand: options.runCommand,
      failureMessage: 'Unable to create the GitHub repository.',
    })
  } catch (error) {
    if (!isGitHubRepositoryAlreadyExistsError(error)) {
      throw error
    }

    const duplicateRepoUrl = await findExistingGitHubRepository({
      ghPath: detected.ghPath,
      owner,
      repoName,
      cwd: launchDir,
      env,
      runCommand: options.runCommand,
    })

    if (!duplicateRepoUrl) {
      throw error
    }

    return {
      repoUrl: duplicateRepoUrl,
      repoState: detected.repoState,
      owner,
      repoName,
      visibility,
      remoteRepoExists: true,
      message: 'This GitHub repository already exists. Open it below.',
    }
  }

  const repoUrl = `https://github.com/${owner}/${repoName}`
  return {
    repoUrl,
    repoState: 'github_remote',
    owner,
    repoName,
    visibility,
    remoteRepoExists: false,
    message: 'GitHub repository created and current branch pushed successfully.',
  }
}

export function createDevSplashGitRepoFlow(options = {}) {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const launchDir = options.launchDir ?? process.cwd()
  const runCommand = options.runCommand ?? defaultRunCommand
  const readTextFile = options.readTextFile
  const enabled = options.enabled === false
    ? false
    : isGitRepoFlowEnabled(env.OM_DEV_CREATE_GIT_REPO_FLOW)
  const actionToken = enabled ? randomUUID() : null
  const flowState = {
    busy: false,
    actionState: 'idle',
    message: null,
    repoUrl: null,
    remoteRepoExists: false,
    lastDetected: null,
  }

  function getIdleMessage(extraState = {}) {
    if (flowState.actionState === 'done' || flowState.actionState === 'error') {
      return flowState.message
    }
    return buildFlowMessage({
      platform,
      repoState: flowState.lastDetected?.repoState,
      repoUrl: flowState.repoUrl ?? flowState.lastDetected?.repoUrl,
      remoteRepoExists: flowState.remoteRepoExists,
      ghStatus: flowState.lastDetected?.ghStatus,
      authStatus: flowState.lastDetected?.authStatus,
    })
  }

  async function getSnapshot(extraState = {}) {
    if (!enabled) {
      return { enabled: false }
    }

    const ready = extraState.ready === true
    const failed = extraState.failed === true

    if (!ready && !flowState.busy && !flowState.lastDetected) {
      return {
        enabled: true,
        ready,
        failed,
        repoState: null,
        ghStatus: 'unknown',
        authStatus: 'unknown',
        ownerOptions: [],
        defaultOwner: null,
        defaultRepoName: resolveDefaultRepoName(launchDir, readTextFile),
        actionState: flowState.actionState,
        message: 'GitHub publishing will be available once the app is ready.',
        repoUrl: null,
        remoteRepoExists: false,
      }
    }

    if (!flowState.busy) {
      flowState.lastDetected = await detectGitRepoFlowState({
        launchDir,
        env,
        platform,
        runCommand,
        readTextFile,
      })
      if (!flowState.repoUrl && flowState.lastDetected.repoUrl) {
        flowState.repoUrl = flowState.lastDetected.repoUrl
      }
      if (flowState.lastDetected.repoState === 'github_remote') {
        flowState.remoteRepoExists = false
      }
    }

    const detected = flowState.lastDetected ?? await detectGitRepoFlowState({
      launchDir,
      env,
      platform,
      runCommand,
      readTextFile,
    })

    return {
      enabled: true,
      ready,
      failed,
      repoState: detected.repoState,
      ghStatus: detected.ghStatus,
      authStatus: detected.authStatus,
      ownerOptions: detected.ownerOptions,
      defaultOwner: detected.defaultOwner,
      defaultRepoName: detected.defaultRepoName,
      actionState: flowState.actionState,
      message: flowState.busy ? flowState.message : getIdleMessage(extraState),
      repoUrl: flowState.repoUrl ?? detected.repoUrl ?? null,
      remoteRepoExists: flowState.remoteRepoExists,
    }
  }

  async function enrichState(state, extraState = {}) {
    return {
      ...state,
      gitRepoFlow: await getSnapshot(extraState),
    }
  }

  async function handleRequest(req, res, extraState = {}) {
    if (!enabled) return false
    if (!req.url) return false

    const requestUrl = new URL(req.url, 'http://localhost')
    if (requestUrl.pathname !== '/actions/git-repo-flow/start') {
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

    if (extraState.ready !== true) {
      writeJson(res, 409, {
        ok: false,
        error: 'GitHub publishing is only available after the app is ready.',
        gitRepoFlow: await getSnapshot(extraState),
      })
      return true
    }

    if (flowState.busy) {
      writeJson(res, 409, {
        ok: false,
        error: 'A GitHub publish action is already in progress.',
        gitRepoFlow: await getSnapshot(extraState),
      })
      return true
    }

    let payload = null
    try {
      payload = await readJsonBody(req)
    } catch (error) {
      writeJson(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : 'Invalid GitHub publish request.',
      })
      return true
    }

    flowState.busy = true
    flowState.actionState = 'idle'
    flowState.message = 'Preparing the GitHub publish flow...'

    let responsePayload = null

    try {
      const result = await runGitRepoPublishAction({
        launchDir,
        env,
        platform,
        runCommand,
        readTextFile,
        owner: typeof payload?.owner === 'string' ? payload.owner : '',
        repoName: typeof payload?.repoName === 'string' ? payload.repoName : '',
        visibility: payload?.visibility === 'public' ? 'public' : 'private',
        onUpdate(update) {
          flowState.actionState = update.actionState ?? flowState.actionState
          flowState.message = update.message ?? flowState.message
        },
      })

      flowState.repoUrl = result.repoUrl
      flowState.remoteRepoExists = result.remoteRepoExists === true
      flowState.actionState = 'done'
      flowState.message = result.message
      flowState.lastDetected = await detectGitRepoFlowState({
        launchDir,
        env,
        platform,
        runCommand,
        readTextFile,
      })
      responsePayload = {
        ok: true,
        gitRepoFlow: await getSnapshot(extraState),
      }
    } catch (error) {
      flowState.actionState = 'error'
      flowState.message = error instanceof Error ? error.message : 'Unable to publish this project to GitHub.'
      flowState.lastDetected = await detectGitRepoFlowState({
        launchDir,
        env,
        platform,
        runCommand,
        readTextFile,
      })
      responsePayload = {
        ok: false,
        error: flowState.message,
        gitRepoFlow: await getSnapshot(extraState),
      }
    } finally {
      flowState.busy = false
    }

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
    enrichState,
    handleRequest,
  }
}
