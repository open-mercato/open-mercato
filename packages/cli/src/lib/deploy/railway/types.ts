export type RailwaySourceMode = 'auto' | 'git' | 'local'
export type ResolvedRailwaySourceMode = Exclude<RailwaySourceMode, 'auto'>

export type RailwayDeployOptions = {
  project?: string
  environment: string
  service: string
  worker: boolean
  source: RailwaySourceMode
  region?: string
  envFile?: string
  domain?: string
  waitDomain: boolean
  volume?: string
  token?: string
  nonInteractive: boolean
  dryRun: boolean
  cleanup: boolean
  yes: boolean
  writeEnv: boolean
  track: boolean
  forceRename: boolean
  timeoutSeconds: number
  allowedSecretKeys: string[]
  verbose: boolean
  help: boolean
}

export type RailwaySource = {
  mode: ResolvedRailwaySourceMode
  reason: string
  repo?: string
  branch?: string
  commitSha?: string
}

export type RailwayEnvironmentState = {
  environmentId?: string
  appServiceId?: string
  workerServiceId?: string
  postgresServiceId?: string
  redisServiceId?: string
  domainId?: string
  volumeId?: string
  appUrl?: string
  source?: RailwaySource
  lastDeployIds?: {
    app?: string
    worker?: string
  }
}

export type RailwayState = {
  schemaVersion: 1
  provider: 'railway'
  projectId?: string
  workspaceId?: string
  projectName: string
  environments: Record<string, RailwayEnvironmentState>
  writtenBy: {
    cliVersion: string
  }
}

export type RailwayGraphqlOperation = {
  name: string
  query: string
  mutation?: boolean
}

export type RailwayGraphqlClient = {
  request<T>(operation: RailwayGraphqlOperation, variables?: Record<string, unknown>): Promise<T>
}

export type RailwayService = {
  id: string
  name: string
}

export type RailwayDeployment = {
  id: string
  status: string
  staticUrl?: string | null
  url?: string | null
  serviceId?: string | null
  environmentId?: string | null
}
