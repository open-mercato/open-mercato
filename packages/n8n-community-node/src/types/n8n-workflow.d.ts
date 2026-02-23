declare module 'n8n-workflow' {
  export enum NodeConnectionType {
    Main = 'main'
  }

  export interface INodePropertyOptions {
    name: string
    value: string
  }

  export interface INodeProperties {
    displayName: string
    name: string
    type: string
    default: unknown
    required?: boolean
    description?: string
    placeholder?: string
    options?: INodePropertyOptions[]
    typeOptions?: Record<string, unknown>
    displayOptions?: {
      show?: Record<string, Array<string | boolean>>
      hide?: Record<string, Array<string | boolean>>
    }
    routing?: {
      request?: Record<string, unknown>
      output?: Record<string, unknown>
    }
  }

  export interface IAuthenticateGeneric {
    type: 'generic'
    properties: Record<string, unknown>
  }

  export interface ICredentialTestRequest {
    request: {
      baseURL?: string
      method: string
      url: string
      [key: string]: unknown
    }
  }

  export interface ICredentialType {
    name: string
    displayName: string
    documentationUrl?: string
    properties: INodeProperties[]
    authenticate?: IAuthenticateGeneric
    test?: ICredentialTestRequest
  }

  export interface INodeTypeDescription {
    displayName: string
    name: string
    icon: string
    group: string[]
    version: number
    subtitle?: string
    description: string
    defaults: {
      name: string
    }
    inputs: NodeConnectionType[]
    outputs: NodeConnectionType[]
    credentials?: Array<{
      name: string
      required?: boolean
    }>
    requestDefaults?: {
      baseURL?: string
      headers?: Record<string, string>
    }
    properties: INodeProperties[]
  }

  export interface INodeType {
    description: INodeTypeDescription
  }
}
