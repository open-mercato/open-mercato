import { createInterface } from 'node:readline/promises'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { stdin as input, stdout as output } from 'node:process'
import { satisfies } from 'semver'
import {
  computeRailwayVariables,
  formatVariablePlan,
  generateProtectedSecrets,
  parseEnvFile,
  resolveEnvFile,
  writeGeneratedSecrets,
} from './env'
import { createRailwayGraphqlClient, RailwayGraphqlError } from './graphql-client'
import { railwayOperations } from './operations'
import { parseRailwayDeployOptions, railwayDeployHelp } from './options'
import { collectSensitiveStructuredValues, redactText } from './redaction'
import { uploadLocalSource } from './railway-cli'
import {
  assertLocalUploadSafe,
  resolveRailwaySource,
} from './source'
import {
  createRailwayState,
  loadRailwayState,
  railwayStatePath,
  saveRailwayState,
} from './state'
import {
  railwayTokenConfigPath,
  resolveRailwayToken,
  writeCachedRailwayToken,
} from './token'
import type {
  RailwayDeployOptions,
  RailwayDeployment,
  RailwayEnvironmentState,
  RailwayGraphqlClient,
  RailwayService,
  RailwaySource,
  RailwayState,
} from './types'

type Connection<T> = {
  edges?: Array<{ node?: T | null } | null>
}

type Prompt = {
  ask(question: string): Promise<string>
  close(): void
}

const SUCCESS_STATUSES = new Set(['SUCCESS', 'COMPLETED'])
const FAILURE_STATUSES = new Set(['FAILED', 'CRASHED', 'REMOVED'])

function isNotFoundError(error: unknown): boolean {
  return error instanceof RailwayGraphqlError
    && (
      error.status === 404
      || error.code === 'NOT_FOUND'
      || error.code?.endsWith('_NOT_FOUND') === true
    )
}

function isAmbiguousMutationError(error: unknown): boolean {
  if (!(error instanceof RailwayGraphqlError)) return true
  return (
    error.status === undefined
    || error.status >= 500
    || error.code === 'INTERNAL_ERROR'
  )
}

function createPrompt(): Prompt {
  const readline = createInterface({ input, output })
  return {
    ask: (question) => readline.question(question),
    close: () => readline.close(),
  }
}

function nodes<T>(connection?: Connection<T> | null): T[] {
  return (connection?.edges ?? [])
    .map((edge) => edge?.node)
    .filter((node): node is T => node !== null && node !== undefined)
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds))
}

function normalizeProjectName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 48)
    .replace(/-+$/g, '')
  if (!normalized) throw new Error('Unable to derive a valid Railway project name.')
  return normalized
}

function readAppPackage(cwd: string): {
  name: string
  dependencies: Record<string, string>
  nodeEngine?: string
} {
  const packagePath = resolve(cwd, 'package.json')
  if (!existsSync(packagePath)) throw new Error('Run this command from an Open Mercato app root.')
  const parsed: unknown = JSON.parse(readFileSync(packagePath, 'utf8'))
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid package.json.')
  const record = parsed as Record<string, unknown>
  const dependencies = {
    ...(record.dependencies && typeof record.dependencies === 'object'
      ? record.dependencies as Record<string, string>
      : {}),
    ...(record.devDependencies && typeof record.devDependencies === 'object'
      ? record.devDependencies as Record<string, string>
      : {}),
  }
  if (!Object.keys(dependencies).some((key) => key.startsWith('@open-mercato/'))) {
    throw new Error('The current package does not declare Open Mercato dependencies.')
  }
  return {
    name: typeof record.name === 'string' && record.name.trim() ? record.name : basename(cwd),
    dependencies,
    nodeEngine: record.engines && typeof record.engines === 'object'
      && typeof (record.engines as Record<string, unknown>).node === 'string'
      ? (record.engines as Record<string, string>).node
      : undefined,
  }
}

function assertSupportedNodeVersion(nodeEngine?: string): void {
  if (!nodeEngine) return
  if (!satisfies(process.version, nodeEngine)) {
    throw new Error(
      `Node ${process.version} does not satisfy this app's required version "${nodeEngine}".`,
    )
  }
}

function ensureEnvironmentState(state: RailwayState, name: string): RailwayEnvironmentState {
  state.environments[name] ??= {}
  return state.environments[name] as RailwayEnvironmentState
}

function persistState(path: string, state: RailwayState): void {
  saveRailwayState(path, state)
}

async function resolveTokenInteractively(
  options: RailwayDeployOptions,
  prompt: Prompt | null,
): Promise<{ token: string; cached: boolean }> {
  const configPath = railwayTokenConfigPath()
  const resolved = resolveRailwayToken({ flagToken: options.token, configPath })
  if (resolved.token) return { token: resolved.token, cached: resolved.source === 'cache' }
  if (options.nonInteractive || !prompt) {
    const compatibilityHint = process.env.RAILWAY_TOKEN
      ? ' RAILWAY_TOKEN is project-scoped; use RAILWAY_API_TOKEN for account/workspace operations.'
      : ''
    throw new Error(`Railway Account token is required.${compatibilityHint}`)
  }
  console.log('Create a token at https://railway.com/account/tokens (Account Settings -> Tokens).')
  const token = (await prompt.ask('Railway Account token: ')).trim()
  if (!token) throw new Error('Railway Account token is required.')
  const persist = (await prompt.ask('Cache this token in ~/.config/open-mercato/railway.json? [y/N] ')).trim().toLowerCase()
  if (persist === 'y' || persist === 'yes') {
    writeCachedRailwayToken(configPath, token)
    return { token, cached: true }
  }
  return { token, cached: false }
}

async function resolveWorkspace(
  client: RailwayGraphqlClient,
  preferredWorkspaceId?: string,
): Promise<{ userId: string; workspaceId: string }> {
  let data: {
    me: { id: string; workspaces?: Array<{ id: string; name: string }> }
  }
  try {
    data = await client.request(railwayOperations.me)
  } catch (error) {
    if (
      error instanceof RailwayGraphqlError
      && (error.status === 401 || error.status === 403 || error.code === 'UNAUTHORIZED')
    ) {
      throw new Error(
        'Token rejected. Generate a Railway Account token at https://railway.com/account/tokens.',
      )
    }
    throw error
  }
  const workspaces = data.me.workspaces ?? []
  const workspace = preferredWorkspaceId
    ? workspaces.find((candidate) => candidate.id === preferredWorkspaceId)
    : workspaces[0]
  if (preferredWorkspaceId && !workspace) {
    throw new Error('The recorded Railway workspace is no longer accessible to this Account token.')
  }
  if (!workspace) throw new Error('The Railway account has no accessible workspace.')
  return { userId: data.me.id, workspaceId: workspace.id }
}

async function findProjectByName(
  client: RailwayGraphqlClient,
  workspaceId: string,
  projectName: string,
): Promise<{ id: string; name: string } | null> {
  const data = await client.request<{
    projects: Connection<{ id: string; name: string }>
  }>(railwayOperations.projects, { workspaceId })
  return nodes(data.projects).find((project) => project.name === projectName) ?? null
}

async function ensureProject(input: {
  client: RailwayGraphqlClient
  state: RailwayState
  statePath: string
  workspaceId: string
  options: RailwayDeployOptions
}): Promise<string> {
  if (input.state.projectId) {
    try {
      const data = await input.client.request<{
        project: { id: string; name: string; workspaceId?: string | null }
      }>(
        railwayOperations.project,
        { id: input.state.projectId },
      )
      if (data.project.workspaceId && data.project.workspaceId !== input.workspaceId) {
        throw new Error('Recorded Railway project belongs to a different workspace.')
      }
      if (data.project.name !== input.state.projectName) {
        if (!input.options.forceRename) {
          throw new Error(
            `Recorded Railway project is named "${data.project.name}". Use --force-rename to rename it.`,
          )
        }
        await input.client.request(railwayOperations.projectUpdate, {
          id: data.project.id,
          input: { name: input.state.projectName },
        })
      }
      return data.project.id
    } catch (error) {
      if (!isNotFoundError(error)) throw error
      input.state.projectId = undefined
    }
  }

  const existing = await findProjectByName(
    input.client,
    input.workspaceId,
    input.state.projectName,
  )
  if (existing) {
    input.state.projectId = existing.id
    persistState(input.statePath, input.state)
    return existing.id
  }

  try {
    const data = await input.client.request<{
      projectCreate: { id: string }
    }>(railwayOperations.projectCreate, {
      input: {
        name: input.state.projectName,
        description: 'Open Mercato deployment managed by mercato deploy railway',
        workspaceId: input.workspaceId,
      },
    })
    input.state.projectId = data.projectCreate.id
  } catch (error) {
    const discovered = await findProjectByName(
      input.client,
      input.workspaceId,
      input.state.projectName,
    )
    if (!discovered) throw error
    input.state.projectId = discovered.id
  }
  persistState(input.statePath, input.state)
  return input.state.projectId as string
}

async function ensureEnvironment(input: {
  client: RailwayGraphqlClient
  projectId: string
  name: string
  environmentState: RailwayEnvironmentState
  persist: () => void
}): Promise<string> {
  if (input.environmentState.environmentId) {
    try {
      const data = await input.client.request<{ environment: { id: string } }>(
        railwayOperations.environment,
        { id: input.environmentState.environmentId, projectId: input.projectId },
      )
      return data.environment.id
    } catch (error) {
      if (!isNotFoundError(error)) throw error
      input.environmentState.environmentId = undefined
    }
  }
  const data = await input.client.request<{
    environments: Connection<{ id: string; name: string }>
  }>(railwayOperations.environments, { projectId: input.projectId })
  const existing = nodes(data.environments).find((environment) => environment.name === input.name)
  if (existing) {
    input.environmentState.environmentId = existing.id
    input.persist()
    return existing.id
  }
  try {
    const created = await input.client.request<{ environmentCreate: { id: string } }>(
      railwayOperations.environmentCreate,
      { input: { projectId: input.projectId, name: input.name } },
    )
    input.environmentState.environmentId = created.environmentCreate.id
  } catch (error) {
    const retryLookup = await input.client.request<{
      environments: Connection<{ id: string; name: string }>
    }>(railwayOperations.environments, { projectId: input.projectId })
    const discovered = nodes(retryLookup.environments).find((environment) => environment.name === input.name)
    if (!discovered) throw error
    input.environmentState.environmentId = discovered.id
  }
  input.persist()
  return input.environmentState.environmentId as string
}

async function listServices(client: RailwayGraphqlClient, projectId: string): Promise<RailwayService[]> {
  const data = await client.request<{
    project: { services: Connection<RailwayService> }
  }>(railwayOperations.services, { projectId })
  return nodes(data.project.services)
}

async function waitForService(
  client: RailwayGraphqlClient,
  projectId: string,
  name: string,
  timeoutMs = 180_000,
): Promise<RailwayService> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const service = (await listServices(client, projectId)).find((candidate) => candidate.name === name)
    if (service) return service
    await wait(5_000)
  }
  throw new Error(`Timed out waiting for Railway service "${name}". Re-run the command to resume.`)
}

async function ensureDatabaseReady(input: {
  client: RailwayGraphqlClient
  projectId: string
  environmentId: string
  serviceId: string
  name: string
}): Promise<void> {
  const previous = await latestDeployment(
    input.client,
    input.projectId,
    input.environmentId,
    input.serviceId,
  )
  if (previous && SUCCESS_STATUSES.has(previous.status)) return
  if (previous && !FAILURE_STATUSES.has(previous.status)) {
    await waitForDeployment({
      client: input.client,
      deploymentId: previous.id,
      timeoutSeconds: 180,
      prefix: input.name,
      secrets: [],
    })
    return
  }

  let triggerError: unknown
  try {
    await input.client.request(railwayOperations.deploy, {
      environmentId: input.environmentId,
      serviceId: input.serviceId,
      commitSha: null,
    })
  } catch (error) {
    if (!isAmbiguousMutationError(error)) throw error
    triggerError = error
  }

  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const current = await latestDeployment(
      input.client,
      input.projectId,
      input.environmentId,
      input.serviceId,
    )
    if (current && current.id !== previous?.id) {
      await waitForDeployment({
        client: input.client,
        deploymentId: current.id,
        timeoutSeconds: 180,
        prefix: input.name,
        secrets: [],
      })
      return
    }
    await wait(2_000)
  }
  if (triggerError) throw triggerError
  throw new Error(`Railway did not expose a ${input.name} deployment in this environment.`)
}

async function ensureDatabase(input: {
  client: RailwayGraphqlClient
  projectId: string
  environmentId: string
  workspaceId: string
  name: 'Postgres' | 'Redis'
  code: 'postgres' | 'redis'
  currentId?: string
  previousSource?: RailwaySource
  onResolved: (id: string) => void
}): Promise<string> {
  if (input.currentId) {
    try {
      const data = await input.client.request<{
        service: { id: string; projectId: string }
      }>(
        railwayOperations.service,
        { id: input.currentId },
      )
      if (data.service.projectId !== input.projectId) {
        throw new Error(`Recorded ${input.name} service belongs to a different Railway project.`)
      }
      await ensureDatabaseReady({
        client: input.client,
        projectId: input.projectId,
        environmentId: input.environmentId,
        serviceId: data.service.id,
        name: input.name,
      })
      return data.service.id
    } catch (error) {
      if (!isNotFoundError(error)) throw error
    }
  }
  const existing = (await listServices(input.client, input.projectId))
    .find((service) => service.name === input.name)
  if (existing) {
    await ensureDatabaseReady({
      client: input.client,
      projectId: input.projectId,
      environmentId: input.environmentId,
      serviceId: existing.id,
      name: input.name,
    })
    input.onResolved(existing.id)
    return existing.id
  }
  const templateData = await input.client.request<{
    template: { id: string; serializedConfig?: string | null }
  }>(railwayOperations.template, { code: input.code })
  if (!templateData.template.serializedConfig) {
    throw new Error(`Railway template "${input.code}" does not expose a deployable configuration.`)
  }
  try {
    await input.client.request(railwayOperations.templateDeploy, {
      input: {
        projectId: input.projectId,
        environmentId: input.environmentId,
        workspaceId: input.workspaceId,
        templateId: templateData.template.id,
        serializedConfig: templateData.template.serializedConfig,
      },
    })
  } catch (error) {
    const discovered = (await listServices(input.client, input.projectId))
      .find((service) => service.name === input.name)
    if (!discovered) throw error
  }
  const created = await waitForService(input.client, input.projectId, input.name)
  const readinessDeadline = Date.now() + 180_000
  let ready = false
  while (Date.now() < readinessDeadline) {
    const deployment = await latestDeployment(
      input.client,
      input.projectId,
      input.environmentId,
      created.id,
    )
    if (deployment && SUCCESS_STATUSES.has(deployment.status)) {
      ready = true
      break
    }
    if (deployment && FAILURE_STATUSES.has(deployment.status)) {
      throw new Error(`${input.name} provisioning failed with status ${deployment.status}.`)
    }
    await wait(5_000)
  }
  if (!ready) {
    throw new Error(`Timed out waiting for ${input.name} to become ready. Re-run the command to resume.`)
  }
  input.onResolved(created.id)
  return created.id
}

async function ensureService(input: {
  client: RailwayGraphqlClient
  projectId: string
  environmentId: string
  name: string
  source: RailwaySource
  currentId?: string
  previousSource?: RailwaySource
  startCommand?: string
  region?: string
  railwayConfigFile?: string
  onResolved: (id: string) => void
}): Promise<string> {
  let serviceId: string | undefined
  let createdService = false
  if (input.currentId) {
    try {
      const data = await input.client.request<{
        service: { id: string; projectId: string }
      }>(
        railwayOperations.service,
        { id: input.currentId },
      )
      if (data.service.projectId !== input.projectId) {
        throw new Error(`Recorded ${input.name} service belongs to a different Railway project.`)
      }
      serviceId = data.service.id
    } catch (error) {
      if (!isNotFoundError(error)) throw error
    }
  }
  if (!serviceId) {
    const existing = (await listServices(input.client, input.projectId))
      .find((service) => service.name === input.name)
    serviceId = existing?.id
  }
  if (!serviceId) {
    const serviceInput: Record<string, unknown> = {
      projectId: input.projectId,
      name: input.name,
    }
    if (input.source.mode === 'git') {
      serviceInput.source = { repo: input.source.repo }
      serviceInput.branch = input.source.branch
    }
    try {
      const created = await input.client.request<{ serviceCreate: { id: string } }>(
        railwayOperations.serviceCreate,
        { input: serviceInput },
      )
      serviceId = created.serviceCreate.id
      createdService = true
    } catch (error) {
      const discovered = (await listServices(input.client, input.projectId))
        .find((service) => service.name === input.name)
      if (!discovered) throw error
      serviceId = discovered.id
    }
  }
  if (input.source.mode === 'git' && !createdService) {
    await input.client.request(railwayOperations.serviceConnect, {
      id: serviceId,
      input: {
        repo: input.source.repo,
        branch: input.source.branch,
      },
    })
  } else if (input.source.mode === 'local' && input.previousSource?.mode === 'git') {
    await input.client.request(railwayOperations.serviceDisconnect, { id: serviceId })
  }
  if (input.startCommand || input.region || input.railwayConfigFile) {
    await input.client.request(railwayOperations.serviceInstanceUpdate, {
      environmentId: input.environmentId,
      serviceId,
      input: {
        ...(input.startCommand ? { startCommand: input.startCommand } : {}),
        ...(input.region ? { region: input.region } : {}),
        ...(input.railwayConfigFile ? { railwayConfigFile: input.railwayConfigFile } : {}),
      },
    })
  }
  input.onResolved(serviceId)
  return serviceId
}

async function removeDisabledWorker(input: {
  client: RailwayGraphqlClient
  projectId: string
  environmentId: string
  workerServiceId?: string
}): Promise<void> {
  if (!input.workerServiceId) return
  try {
    const data = await input.client.request<{
      service: { id: string; name: string; projectId: string }
    }>(railwayOperations.service, { id: input.workerServiceId })
    if (data.service.projectId !== input.projectId || data.service.name !== 'mercato-worker') {
      throw new Error('Recorded worker service does not match the managed Railway project.')
    }
  } catch (error) {
    if (isNotFoundError(error)) return
    throw error
  }
  try {
    await input.client.request(railwayOperations.serviceDelete, {
      id: input.workerServiceId,
      environmentId: input.environmentId,
    })
  } catch (error) {
    try {
      await input.client.request(railwayOperations.service, { id: input.workerServiceId })
    } catch (lookupError) {
      if (isNotFoundError(lookupError)) return
      throw lookupError
    }
    throw error
  }
}

async function upsertVariables(input: {
  client: RailwayGraphqlClient
  projectId: string
  environmentId: string
  serviceId: string
  variables: Record<string, string>
}): Promise<void> {
  await input.client.request(railwayOperations.variableUpsert, {
    input: {
      projectId: input.projectId,
      environmentId: input.environmentId,
      serviceId: input.serviceId,
      variables: input.variables,
      replace: false,
      skipDeploys: true,
    },
  })
}

async function loadVariables(input: {
  client: RailwayGraphqlClient
  projectId: string
  environmentId: string
  serviceId: string
}): Promise<Record<string, string>> {
  const data = await input.client.request<{ variables: unknown }>(
    railwayOperations.variables,
    {
      projectId: input.projectId,
      environmentId: input.environmentId,
      serviceId: input.serviceId,
    },
  )
  if (!data.variables || typeof data.variables !== 'object' || Array.isArray(data.variables)) return {}
  return Object.fromEntries(
    Object.entries(data.variables as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

async function latestDeployment(
  client: RailwayGraphqlClient,
  projectId: string,
  environmentId: string,
  serviceId: string,
): Promise<RailwayDeployment | null> {
  const data = await client.request<{
    deployments: Connection<RailwayDeployment>
  }>(railwayOperations.deployments, { projectId, environmentId, serviceId })
  return nodes(data.deployments)[0] ?? null
}

async function printDeploymentLogs(
  client: RailwayGraphqlClient,
  deploymentId: string,
  prefix: string,
  secrets: string[],
): Promise<void> {
  for (const operation of [railwayOperations.buildLogs, railwayOperations.deploymentLogs]) {
    try {
      const data = await client.request<Record<string, Array<{ message?: string }>>>(
        operation,
        { deploymentId, limit: 100 },
      )
      const logKey = operation === railwayOperations.buildLogs ? 'buildLogs' : 'deploymentLogs'
      for (const entry of data[logKey] ?? []) {
        if (entry.message) console.log(`[${prefix}] ${redactText(entry.message, secrets)}`)
      }
    } catch {
      // Log retrieval is best-effort; deployment status remains authoritative.
    }
  }
}

async function waitForDeployment(input: {
  client: RailwayGraphqlClient
  deploymentId: string
  timeoutSeconds: number
  prefix: string
  secrets: string[]
}): Promise<RailwayDeployment> {
  const deadline = Date.now() + input.timeoutSeconds * 1_000
  let lastStatus = 'UNKNOWN'
  while (Date.now() < deadline) {
    const data = await input.client.request<{ deployment: RailwayDeployment }>(
      railwayOperations.deployment,
      { id: input.deploymentId },
    )
    lastStatus = data.deployment.status
    if (SUCCESS_STATUSES.has(lastStatus)) return data.deployment
    if (FAILURE_STATUSES.has(lastStatus)) {
      await printDeploymentLogs(
        input.client,
        input.deploymentId,
        input.prefix,
        input.secrets,
      )
      throw new Error(`${input.prefix} deployment failed with status ${lastStatus}.`)
    }
    await wait(5_000)
  }
  throw new Error(
    `Timed out waiting for ${input.prefix} deployment. Last status: ${lastStatus}. Re-run the command to resume.`,
  )
}

async function deployService(input: {
  client: RailwayGraphqlClient
  cwd: string
  source: RailwaySource
  projectId: string
  environmentId: string
  serviceId: string
  serviceName: string
  timeoutSeconds: number
  token: string
  secrets: string[]
}): Promise<RailwayDeployment> {
  const previous = await latestDeployment(
    input.client,
    input.projectId,
    input.environmentId,
    input.serviceId,
  )
  let deploymentId: string | null = null
  let triggerError: unknown
  try {
    if (input.source.mode === 'git') {
      await input.client.request(railwayOperations.deploy, {
        environmentId: input.environmentId,
        serviceId: input.serviceId,
        commitSha: input.source.commitSha,
      })
    } else {
      deploymentId = uploadLocalSource({
        cwd: input.cwd,
        projectId: input.projectId,
        environmentId: input.environmentId,
        serviceId: input.serviceId,
        serviceName: input.serviceName,
        token: input.token,
      })
    }
  } catch (error) {
    if (!isAmbiguousMutationError(error)) throw error
    triggerError = error
  }
  if (!deploymentId) {
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      const current = await latestDeployment(
        input.client,
        input.projectId,
        input.environmentId,
        input.serviceId,
      )
      if (current && current.id !== previous?.id) {
        deploymentId = current.id
        break
      }
      await wait(2_000)
    }
  }
  if (!deploymentId) {
    if (triggerError) throw triggerError
    throw new Error(`Railway did not expose a new deployment for ${input.serviceName}.`)
  }
  return waitForDeployment({
    client: input.client,
    deploymentId,
    timeoutSeconds: input.timeoutSeconds,
    prefix: input.serviceName,
    secrets: [input.token, ...input.secrets],
  })
}

function collectSensitiveValues(variables: Record<string, string>): string[] {
  return collectSensitiveStructuredValues(variables)
}

async function ensureDomain(input: {
  client: RailwayGraphqlClient
  projectId: string
  environmentId: string
  serviceId: string
  customDomain?: string
  waitForVerification: boolean
  currentDomainId?: string
}): Promise<{ id: string; url: string }> {
  type DnsRecord = {
    hostlabel?: string
    requiredValue?: string
    recordType?: string
  }
  type CustomDomain = {
    id: string
    domain: string
    status?: {
      verified?: boolean
      dnsRecords?: DnsRecord[]
    }
  }
  type ServiceDomain = {
    id: string
    domain: string
  }

  const existingData = await input.client.request<{
    domains: {
      customDomains?: CustomDomain[]
      serviceDomains?: ServiceDomain[]
    }
  }>(railwayOperations.domains, {
    projectId: input.projectId,
    environmentId: input.environmentId,
    serviceId: input.serviceId,
  })

  if (!input.customDomain && input.currentDomainId) {
    const existingCustomDomain = existingData.domains.customDomains?.find(
      (candidate) => candidate.id === input.currentDomainId,
    )
    if (existingCustomDomain) {
      return {
        id: existingCustomDomain.id,
        url: `https://${existingCustomDomain.domain}`,
      }
    }
    const existingRecordedServiceDomain = existingData.domains.serviceDomains?.find(
      (candidate) => candidate.id === input.currentDomainId,
    )
    if (existingRecordedServiceDomain) {
      return {
        id: existingRecordedServiceDomain.id,
        url: `https://${existingRecordedServiceDomain.domain}`,
      }
    }
  }

  if (input.customDomain) {
    const existingDomain = existingData.domains.customDomains?.find(
      (candidate) => candidate.domain === input.customDomain,
    )
    let domain: CustomDomain
    if (existingDomain) {
      domain = existingDomain
    } else {
      try {
        const data = await input.client.request<{ customDomainCreate: CustomDomain }>(
          railwayOperations.customDomainCreate,
          {
            input: {
              projectId: input.projectId,
              environmentId: input.environmentId,
              serviceId: input.serviceId,
              domain: input.customDomain,
              targetPort: 3000,
            },
          },
        )
        domain = data.customDomainCreate
      } catch (error) {
        const discovered = await input.client.request<{
          domains: { customDomains?: CustomDomain[] }
        }>(railwayOperations.domains, {
          projectId: input.projectId,
          environmentId: input.environmentId,
          serviceId: input.serviceId,
        })
        const created = discovered.domains.customDomains?.find(
          (candidate) => candidate.domain === input.customDomain,
        )
        if (!created) throw error
        domain = created
      }
    }
    const records = domain.status?.dnsRecords ?? []
    if (records.length > 0) {
      console.log('Configure these DNS records:')
      for (const record of records) {
        console.log(`  ${record.recordType ?? 'DNS'} ${record.hostlabel ?? '@'} -> ${record.requiredValue ?? ''}`)
      }
    }
    if (input.waitForVerification && !domain.status?.verified) {
      const deadline = Date.now() + 300_000
      while (Date.now() < deadline) {
        await wait(10_000)
        const refreshed: { customDomain: CustomDomain } = await input.client.request(
          railwayOperations.customDomain,
          { id: domain.id, projectId: input.projectId },
        )
        domain = refreshed.customDomain
        if (domain.status?.verified) break
      }
      if (!domain.status?.verified) {
        console.warn('DNS not yet propagated. The deployment succeeded; re-run later to verify the domain.')
      }
    }
    return {
      id: domain.id,
      url: `https://${domain.domain}`,
    }
  }
  const existingServiceDomain = existingData.domains.serviceDomains?.[0]
  if (existingServiceDomain) {
    return {
      id: existingServiceDomain.id,
      url: `https://${existingServiceDomain.domain}`,
    }
  }
  let createdDomain: ServiceDomain
  try {
    const data = await input.client.request<{
      serviceDomainCreate: ServiceDomain
    }>(railwayOperations.serviceDomainCreate, {
      input: {
        environmentId: input.environmentId,
        serviceId: input.serviceId,
        targetPort: 3000,
      },
    })
    createdDomain = data.serviceDomainCreate
  } catch (error) {
    const discovered = await input.client.request<{
      domains: { serviceDomains?: ServiceDomain[] }
    }>(railwayOperations.domains, {
      projectId: input.projectId,
      environmentId: input.environmentId,
      serviceId: input.serviceId,
    })
    const created = discovered.domains.serviceDomains?.[0]
    if (!created) throw error
    createdDomain = created
  }
  return {
    id: createdDomain.id,
    url: `https://${createdDomain.domain}`,
  }
}

async function cleanupProject(input: {
  client: RailwayGraphqlClient
  state: RailwayState
  statePath: string
  options: RailwayDeployOptions
  prompt: Prompt | null
  workspaceId: string
}): Promise<void> {
  if (!input.state.projectId) throw new Error('The Railway state file does not contain a project ID.')
  if (input.state.workspaceId && input.state.workspaceId !== input.workspaceId) {
    throw new Error('Recorded Railway project belongs to a different workspace.')
  }
  const projectData = await input.client.request<{
    project: { id: string; name: string; workspaceId?: string | null }
  }>(railwayOperations.project, { id: input.state.projectId })
  if (
    projectData.project.name !== input.state.projectName
    || (projectData.project.workspaceId && projectData.project.workspaceId !== input.workspaceId)
  ) {
    throw new Error('Recorded Railway project identity does not match the cleanup target.')
  }
  if (!input.options.yes) {
    if (input.options.nonInteractive || !input.prompt) {
      throw new Error('--cleanup requires --yes in non-interactive mode.')
    }
    console.log(`Project: ${input.state.projectName} (${input.state.projectId})`)
    for (const [name, environment] of Object.entries(input.state.environments)) {
      console.log(`  ${name}: ${environment.appUrl ?? 'no recorded URL'}`)
    }
    const confirmation = await input.prompt.ask(`Type "${input.state.projectName}" to delete this project: `)
    if (confirmation.trim() !== input.state.projectName) throw new Error('Cleanup cancelled.')
  }
  await input.client.request(railwayOperations.projectDelete, { id: input.state.projectId })
  if (existsSync(input.statePath)) unlinkSync(input.statePath)
  console.log(`Deleted Railway project ${input.state.projectName}.`)
}

function printDryRun(input: {
  state: RailwayState
  options: RailwayDeployOptions
  source: RailwaySource
  envFile: string
  appVariables: Record<string, string>
  workerVariables?: Record<string, string>
}): void {
  console.log('Railway deployment plan (dry run)')
  console.log(`  Project: ${input.state.projectName}`)
  console.log(`  Environment: ${input.options.environment}`)
  console.log(`  Source: ${input.source.mode} (${input.source.reason})`)
  console.log(`  Env file: ${input.envFile}`)
  console.log('  Operations:')
  console.log('    - validate Railway account and workspace')
  console.log('    - create or reuse project and environment')
  console.log('    - provision Postgres and Redis from Railway templates')
  console.log(`    - create or reuse ${input.options.service}`)
  if (input.options.worker) console.log('    - create or reuse mercato-worker')
  if (
    !input.options.worker
    && input.state.environments[input.options.environment]?.workerServiceId
  ) {
    console.log('    - delete the recorded managed mercato-worker service')
  }
  console.log('    - upsert service variables')
  console.log(`    - deploy via ${input.source.mode === 'git' ? 'Railway Git source' : 'railway up'}`)
  console.log('    - create a Railway or custom domain and redeploy the app')
  if (input.options.volume) console.log(`    - create volume mounted at ${input.options.volume}`)
  console.log('  App variables:')
  for (const line of formatVariablePlan(input.appVariables, input.options.token)) console.log(`    ${line}`)
  if (input.workerVariables) {
    console.log('  Worker variables:')
    for (const line of formatVariablePlan(input.workerVariables, input.options.token)) console.log(`    ${line}`)
  }
}

export async function runRailwayDeploy(
  args: string[],
  dependencies: {
    cwd?: string
    prompt?: Prompt | null
    resolveSource?: typeof resolveRailwaySource
  } = {},
): Promise<void> {
  const options = parseRailwayDeployOptions(args)
  if (options.help) {
    console.log(railwayDeployHelp())
    return
  }
  const cwd = dependencies.cwd ?? process.cwd()
  const appPackage = readAppPackage(cwd)
  assertSupportedNodeVersion(appPackage.nodeEngine)
  const statePath = railwayStatePath(cwd, options.track)
  const loadedState = loadRailwayState(statePath)
  const requestedName = normalizeProjectName(options.project || appPackage.name)
  const state = loadedState ?? createRailwayState(requestedName, process.env.npm_package_version || 'unknown')
  if (options.cleanup && !state.projectId) {
    throw new Error('The Railway state file does not contain a project ID.')
  }
  if (loadedState && options.project && requestedName !== loadedState.projectName) {
    if (!options.forceRename) {
      throw new Error(
        `State records project "${loadedState.projectName}". Pass --force-rename to use "${requestedName}".`,
      )
    }
    state.projectName = requestedName
  }
  const environmentState = ensureEnvironmentState(state, options.environment)
  const source = options.cleanup
    ? { mode: 'local' as const, reason: 'cleanup does not deploy source' }
    : (dependencies.resolveSource ?? resolveRailwaySource)(options.source, cwd)
  if (options.cleanup && options.dryRun) {
    console.log('Railway cleanup plan (dry run)')
    console.log(`  Project: ${state.projectName} (${state.projectId})`)
    console.log(`  State: ${statePath}`)
    console.log('  Operation: projectDelete')
    return
  }
  if (!options.cleanup && !options.dryRun) {
    console.log(`Source: ${source.mode} (${source.reason})`)
  }
  if (!options.cleanup && source.mode === 'local') assertLocalUploadSafe(cwd)
  const envFile = options.cleanup ? '' : resolveEnvFile(cwd, options.envFile)
  const localEnv = options.cleanup ? {} : parseEnvFile(readFileSync(envFile, 'utf8'))
  let protectedSecrets = options.dryRun
    ? {
        AUTH_SECRET: 'generated-at-deploy',
        JWT_SECRET: 'generated-at-deploy',
        TENANT_DATA_ENCRYPTION_FALLBACK_KEY: 'generated-at-deploy',
      }
    : generateProtectedSecrets(localEnv)
  let appVariables = computeRailwayVariables({
    env: localEnv,
    role: 'app',
    workerEnabled: options.worker,
    protectedSecrets,
    railwayToken: options.token || process.env.RAILWAY_API_TOKEN,
    allowedSecretKeys: options.allowedSecretKeys,
  })
  let workerVariables = options.worker
    ? computeRailwayVariables({
        env: localEnv,
        role: 'worker',
        workerEnabled: true,
        protectedSecrets,
        railwayToken: options.token || process.env.RAILWAY_API_TOKEN,
        allowedSecretKeys: options.allowedSecretKeys,
      })
    : undefined

  if (options.dryRun) {
    printDryRun({ state, options, source, envFile, appVariables, workerVariables })
    return
  }

  const ownsPrompt = dependencies.prompt === undefined
  const prompt = dependencies.prompt === undefined
    ? (!options.nonInteractive && process.stdin.isTTY ? createPrompt() : null)
    : dependencies.prompt
  try {
    const tokenResult = await resolveTokenInteractively(options, prompt)
    const client = createRailwayGraphqlClient({
      token: tokenResult.token,
      verbose: options.verbose,
    })
    console.log('Step 1: Authenticate with Railway')
    const { workspaceId } = await resolveWorkspace(client, state.workspaceId)

    if (options.cleanup) {
      await cleanupProject({ client, state, statePath, options, prompt, workspaceId })
      return
    }
    state.workspaceId = workspaceId
    persistState(statePath, state)

    console.log('Step 2: Resolve workspace')
    console.log(`Step 3: Create or look up project "${state.projectName}"`)
    const projectId = await ensureProject({ client, state, statePath, workspaceId, options })
    console.log(`Step 4: Create or look up environment "${options.environment}"`)
    const environmentId = await ensureEnvironment({
      client,
      projectId,
      name: options.environment,
      environmentState,
      persist: () => persistState(statePath, state),
    })

    if (options.region) {
      const regionData = await client.request<{
        regions: Array<{ id?: string | null; name: string; region?: string | null }>
      }>(
        railwayOperations.regions,
        { projectId },
      )
      if (!regionData.regions.some(
        (region) => region.id === options.region || region.region === options.region,
      )) {
        throw new Error(`Unknown Railway region "${options.region}".`)
      }
    }

    console.log('Step 5: Provision managed Postgres and Redis')
    await ensureDatabase({
      client,
      projectId,
      environmentId,
      workspaceId,
      name: 'Postgres',
      code: 'postgres',
      currentId: environmentState.postgresServiceId,
      onResolved: (id) => {
        environmentState.postgresServiceId = id
        persistState(statePath, state)
      },
    })
    await ensureDatabase({
      client,
      projectId,
      environmentId,
      workspaceId,
      name: 'Redis',
      code: 'redis',
      currentId: environmentState.redisServiceId,
      onResolved: (id) => {
        environmentState.redisServiceId = id
        persistState(statePath, state)
      },
    })

    console.log('Step 6: Create app and worker services')
    const previousSource = environmentState.source
    const appServiceId = await ensureService({
      client,
      projectId,
      environmentId,
      name: options.service,
      source,
      currentId: environmentState.appServiceId,
      previousSource,
      startCommand: 'sh ./scripts/railway-start.sh',
      region: options.region,
      railwayConfigFile: 'railway.toml',
      onResolved: (id) => {
        environmentState.appServiceId = id
        environmentState.source = source
        persistState(statePath, state)
      },
    })
    const workerServiceId = options.worker
      ? await ensureService({
          client,
          projectId,
          environmentId,
          name: 'mercato-worker',
          source,
          currentId: environmentState.workerServiceId,
          previousSource,
          startCommand: 'sh ./scripts/railway-worker.sh',
          region: options.region,
          railwayConfigFile: 'railway.worker.toml',
          onResolved: (id) => {
            environmentState.workerServiceId = id
            persistState(statePath, state)
          },
        })
      : undefined
    if (!options.worker && environmentState.workerServiceId) {
      await removeDisabledWorker({
        client,
        projectId,
        environmentId,
        workerServiceId: environmentState.workerServiceId,
      })
      environmentState.workerServiceId = undefined
      if (environmentState.lastDeployIds) {
        delete environmentState.lastDeployIds.worker
      }
      persistState(statePath, state)
    }

    if (options.volume) {
      if (environmentState.volumeId) {
        const volumeData = await client.request<{
          project: {
            volumes: Connection<{
              id: string
              volumeInstances: Connection<{
                environmentId: string
                serviceId?: string | null
                mountPath: string
              }>
            }>
          }
        }>(railwayOperations.volumes, { projectId })
        const recordedVolume = nodes(volumeData.project.volumes).find(
          (volume) => volume.id === environmentState.volumeId
            && nodes(volume.volumeInstances).some((instance) =>
              instance.environmentId === environmentId
              && instance.serviceId === appServiceId
              && instance.mountPath === options.volume,
            ),
        )
        if (!recordedVolume) environmentState.volumeId = undefined
      }
    }
    if (options.volume && !environmentState.volumeId) {
      try {
        const volumeData = await client.request<{ volumeCreate: { id: string } }>(
          railwayOperations.volumeCreate,
          {
            input: {
              projectId,
              environmentId,
              serviceId: appServiceId,
              mountPath: options.volume,
            },
          },
        )
        environmentState.volumeId = volumeData.volumeCreate.id
      } catch (error) {
        const volumeData = await client.request<{
          project: {
            volumes: Connection<{
              id: string
              volumeInstances: Connection<{
                environmentId: string
                serviceId?: string | null
                mountPath: string
              }>
            }>
          }
        }>(railwayOperations.volumes, { projectId })
        const discovered = nodes(volumeData.project.volumes).find((volume) =>
          nodes(volume.volumeInstances).some((instance) =>
            instance.environmentId === environmentId
            && instance.serviceId === appServiceId
            && instance.mountPath === options.volume,
          ),
        )
        if (!discovered) throw error
        environmentState.volumeId = discovered.id
      }
      persistState(statePath, state)
    }
    if (!options.volume) {
      console.warn(
        'Attachments uploaded to this deployment will be lost on redeploy. Re-run with --volume /app/storage to enable persistent storage.',
      )
    }

    console.log('Step 7: Compute and upload environment variables')
    const existingVariables = await loadVariables({
      client,
      projectId,
      environmentId,
      serviceId: appServiceId,
    })
    protectedSecrets = generateProtectedSecrets({ ...localEnv, ...existingVariables })
    appVariables = computeRailwayVariables({
      env: localEnv,
      role: 'app',
      workerEnabled: options.worker,
      protectedSecrets,
      railwayToken: tokenResult.token,
      allowedSecretKeys: options.allowedSecretKeys,
    })
    workerVariables = options.worker
      ? computeRailwayVariables({
          env: localEnv,
          role: 'worker',
          workerEnabled: true,
          protectedSecrets,
          railwayToken: tokenResult.token,
          allowedSecretKeys: options.allowedSecretKeys,
        })
      : undefined
    await upsertVariables({ client, projectId, environmentId, serviceId: appServiceId, variables: appVariables })
    if (workerServiceId && workerVariables) {
      await upsertVariables({
        client,
        projectId,
        environmentId,
        serviceId: workerServiceId,
        variables: workerVariables,
      })
    }
    if (options.writeEnv) writeGeneratedSecrets(envFile, protectedSecrets)

    console.log('Step 8: Trigger deployment and monitor status')
    const appDeployment = await deployService({
      client,
      cwd,
      source,
      projectId,
      environmentId,
      serviceId: appServiceId,
      serviceName: options.service,
      timeoutSeconds: options.timeoutSeconds,
      token: tokenResult.token,
      secrets: collectSensitiveValues(appVariables),
    })
    environmentState.lastDeployIds ??= {}
    environmentState.lastDeployIds.app = appDeployment.id
    persistState(statePath, state)
    if (workerServiceId) {
      const workerDeployment = await deployService({
        client,
        cwd,
        source,
        projectId,
        environmentId,
        serviceId: workerServiceId,
        serviceName: 'mercato-worker',
        timeoutSeconds: options.timeoutSeconds,
        token: tokenResult.token,
        secrets: collectSensitiveValues(workerVariables ?? {}),
      })
      environmentState.lastDeployIds.worker = workerDeployment.id
      persistState(statePath, state)
    }

    console.log('Step 9: Provision public domain')
    const domain = await ensureDomain({
      client,
      projectId,
      environmentId,
      serviceId: appServiceId,
      customDomain: options.domain,
      waitForVerification: options.waitDomain,
      currentDomainId: environmentState.domainId,
    })
    environmentState.domainId = domain.id
    environmentState.appUrl = domain.url
    persistState(statePath, state)
    const finalAppVariables = { ...appVariables, APP_URL: domain.url, NEXT_PUBLIC_APP_URL: domain.url }
    await upsertVariables({
      client,
      projectId,
      environmentId,
      serviceId: appServiceId,
      variables: finalAppVariables,
    })
    const finalDeployment = await deployService({
      client,
      cwd,
      source,
      projectId,
      environmentId,
      serviceId: appServiceId,
      serviceName: options.service,
      timeoutSeconds: options.timeoutSeconds,
      token: tokenResult.token,
      secrets: collectSensitiveValues(finalAppVariables),
    })
    environmentState.lastDeployIds.app = finalDeployment.id
    persistState(statePath, state)

    console.log('Step 10: Deployment complete')
    console.log('')
    console.log('Open Mercato deployed to Railway')
    console.log(`  Project:     https://railway.com/project/${projectId}`)
    console.log(`  Environment: ${options.environment}`)
    console.log(`  Source:      ${source.mode}`)
    console.log(`  App URL:     ${domain.url}`)
    console.log(`  Health:      ${domain.url}/api/healthz`)
    if (workerServiceId) console.log('  Worker:      mercato-worker (running)')
    console.log(`  State:       ${statePath}`)
    if (tokenResult.cached) console.log(`  Token cache: ${railwayTokenConfigPath()}`)
    console.log('')
    console.log(`DEPLOY_URL=${domain.url}`)
  } finally {
    if (ownsPrompt) prompt?.close()
  }
}

export {
  parseRailwayDeployOptions,
  railwayDeployHelp,
  computeRailwayVariables,
  formatVariablePlan,
  generateProtectedSecrets,
  parseEnvFile,
  resolveEnvFile,
}
