import type { RailwayGraphqlOperation } from './types'

export const railwayOperations = {
  me: {
    name: 'RailwayMe',
    query: `query RailwayMe {
  me { id name email workspaces { id name } }
}`,
  },
  project: {
    name: 'RailwayProject',
    query: `query RailwayProject($id: String!) {
  project(id: $id) { id name workspaceId }
}`,
  },
  projects: {
    name: 'RailwayProjects',
    query: `query RailwayProjects($workspaceId: String!) {
  projects(workspaceId: $workspaceId, first: 100, includeDeleted: false) {
    edges { node { id name } }
  }
}`,
  },
  projectCreate: {
    name: 'RailwayProjectCreate',
    mutation: true,
    query: `mutation RailwayProjectCreate($input: ProjectCreateInput!) {
  projectCreate(input: $input) { id name }
}`,
  },
  projectUpdate: {
    name: 'RailwayProjectUpdate',
    mutation: true,
    query: `mutation RailwayProjectUpdate($id: String!, $input: ProjectUpdateInput!) {
  projectUpdate(id: $id, input: $input) { id name }
}`,
  },
  projectDelete: {
    name: 'RailwayProjectDelete',
    mutation: true,
    query: `mutation RailwayProjectDelete($id: String!) {
  projectDelete(id: $id)
}`,
  },
  environments: {
    name: 'RailwayEnvironments',
    query: `query RailwayEnvironments($projectId: String!) {
  environments(projectId: $projectId, first: 100) {
    edges { node { id name } }
  }
}`,
  },
  environment: {
    name: 'RailwayEnvironment',
    query: `query RailwayEnvironment($id: String!, $projectId: String!) {
  environment(id: $id, projectId: $projectId) { id name }
}`,
  },
  environmentCreate: {
    name: 'RailwayEnvironmentCreate',
    mutation: true,
    query: `mutation RailwayEnvironmentCreate($input: EnvironmentCreateInput!) {
  environmentCreate(input: $input) { id name }
}`,
  },
  regions: {
    name: 'RailwayRegions',
    query: `query RailwayRegions($projectId: String!) {
  regions(projectId: $projectId) { id name region location }
}`,
  },
  template: {
    name: 'RailwayTemplate',
    query: `query RailwayTemplate($code: String!) {
  template(code: $code) { id code serializedConfig }
}`,
  },
  templateDeploy: {
    name: 'RailwayTemplateDeploy',
    mutation: true,
    query: `mutation RailwayTemplateDeploy($input: TemplateDeployV2Input!) {
  templateDeployV2(input: $input) { workflowId }
}`,
  },
  services: {
    name: 'RailwayServices',
    query: `query RailwayServices($projectId: String!) {
  project(id: $projectId) { services { edges { node { id name } } } }
}`,
  },
  volumes: {
    name: 'RailwayVolumes',
    query: `query RailwayVolumes($projectId: String!) {
  project(id: $projectId) {
    volumes {
      edges {
        node {
          id
          volumeInstances {
            edges { node { environmentId serviceId mountPath } }
          }
        }
      }
    }
  }
}`,
  },
  service: {
    name: 'RailwayService',
    query: `query RailwayService($id: String!) {
  service(id: $id) { id name projectId }
}`,
  },
  serviceCreate: {
    name: 'RailwayServiceCreate',
    mutation: true,
    query: `mutation RailwayServiceCreate($input: ServiceCreateInput!) {
  serviceCreate(input: $input) { id name }
}`,
  },
  serviceDelete: {
    name: 'RailwayServiceDelete',
    mutation: true,
    query: `mutation RailwayServiceDelete($id: String!, $environmentId: String!) {
  serviceDelete(id: $id, environmentId: $environmentId)
}`,
  },
  serviceConnect: {
    name: 'RailwayServiceConnect',
    mutation: true,
    query: `mutation RailwayServiceConnect($id: String!, $input: ServiceConnectInput!) {
  serviceConnect(id: $id, input: $input) { id }
}`,
  },
  serviceDisconnect: {
    name: 'RailwayServiceDisconnect',
    mutation: true,
    query: `mutation RailwayServiceDisconnect($id: String!) {
  serviceDisconnect(id: $id) { id }
}`,
  },
  serviceInstanceUpdate: {
    name: 'RailwayServiceInstanceUpdate',
    mutation: true,
    query: `mutation RailwayServiceInstanceUpdate(
      $environmentId: String!,
      $serviceId: String!,
      $input: ServiceInstanceUpdateInput!
    ) {
      serviceInstanceUpdate(environmentId: $environmentId, serviceId: $serviceId, input: $input)
    }`,
  },
  variables: {
    name: 'RailwayVariables',
    query: `query RailwayVariables($projectId: String!, $environmentId: String!, $serviceId: String!) {
  variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
}`,
  },
  variableUpsert: {
    name: 'RailwayVariableCollectionUpsert',
    mutation: true,
    query: `mutation RailwayVariableCollectionUpsert($input: VariableCollectionUpsertInput!) {
  variableCollectionUpsert(input: $input)
}`,
  },
  deploy: {
    name: 'RailwayServiceDeploy',
    mutation: true,
    query: `mutation RailwayServiceDeploy($environmentId: String!, $serviceId: String!, $commitSha: String) {
  serviceInstanceDeployV2(environmentId: $environmentId, serviceId: $serviceId, commitSha: $commitSha)
}`,
  },
  deployments: {
    name: 'RailwayDeployments',
    query: `query RailwayDeployments($projectId: String!, $environmentId: String!, $serviceId: String!) {
  deployments(
    input: { projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId },
    first: 10
  ) {
    edges { node { id status staticUrl url serviceId environmentId createdAt } }
  }
}`,
  },
  deployment: {
    name: 'RailwayDeployment',
    query: `query RailwayDeployment($id: String!) {
  deployment(id: $id) { id status staticUrl url serviceId environmentId }
}`,
  },
  buildLogs: {
    name: 'RailwayBuildLogs',
    query: `query RailwayBuildLogs($deploymentId: String!, $limit: Int!) {
  buildLogs(deploymentId: $deploymentId, limit: $limit) { timestamp message severity }
}`,
  },
  deploymentLogs: {
    name: 'RailwayDeploymentLogs',
    query: `query RailwayDeploymentLogs($deploymentId: String!, $limit: Int!) {
  deploymentLogs(deploymentId: $deploymentId, limit: $limit) { timestamp message severity }
}`,
  },
  domains: {
    name: 'RailwayDomains',
    query: `query RailwayDomains($projectId: String!, $environmentId: String!, $serviceId: String!) {
  domains(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) {
    customDomains { id domain status { verified dnsRecords { hostlabel requiredValue recordType } } }
    serviceDomains { id domain }
  }
}`,
  },
  customDomain: {
    name: 'RailwayCustomDomain',
    query: `query RailwayCustomDomain($id: String!, $projectId: String!) {
  customDomain(id: $id, projectId: $projectId) {
    id
    domain
    status { verified dnsRecords { hostlabel requiredValue recordType } }
  }
}`,
  },
  serviceDomainCreate: {
    name: 'RailwayServiceDomainCreate',
    mutation: true,
    query: `mutation RailwayServiceDomainCreate($input: ServiceDomainCreateInput!) {
  serviceDomainCreate(input: $input) { id domain }
}`,
  },
  customDomainCreate: {
    name: 'RailwayCustomDomainCreate',
    mutation: true,
    query: `mutation RailwayCustomDomainCreate($input: CustomDomainCreateInput!) {
  customDomainCreate(input: $input) { id domain status { dnsRecords { hostlabel requiredValue recordType } } }
}`,
  },
  volumeCreate: {
    name: 'RailwayVolumeCreate',
    mutation: true,
    query: `mutation RailwayVolumeCreate($input: VolumeCreateInput!) {
  volumeCreate(input: $input) { id name }
}`,
  },
} satisfies Record<string, RailwayGraphqlOperation>

export function railwaySchemaFingerprintSource(): string {
  return Object.values(railwayOperations)
    .map((operation) => `${operation.name}\n${operation.query.trim()}`)
    .join('\n\n')
}
