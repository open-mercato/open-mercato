import type { IAuthenticateGeneric, ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow'

export class OpenMercatoApi implements ICredentialType {
  name = 'openMercatoApi'

  displayName = 'Open Mercato API'

  documentationUrl = 'https://docs.openmercato.com/docs/api'

  properties: INodeProperties[] = [
    {
      displayName: 'Base URL',
      name: 'baseUrl',
      type: 'string',
      default: 'http://localhost:3000',
      required: true,
      description: 'Base URL of your Open Mercato instance'
    },
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'string',
      typeOptions: {
        password: true
      },
      default: '',
      required: true,
      description: 'API key generated in Open Mercato'
    }
  ]

  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: {
      headers: {
        Authorization: '=ApiKey {{$credentials.apiKey}}',
        Accept: 'application/json'
      }
    }
  }

  test: ICredentialTestRequest = {
    request: {
      baseURL: '={{$credentials.baseUrl}}',
      method: 'GET',
      url: '/api/docs/openapi'
    }
  }
}
