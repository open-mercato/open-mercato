import type { INodeType, INodeTypeDescription } from 'n8n-workflow'

export class OpenMercato implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Open Mercato',
    name: 'openMercato',
    icon: 'fa:plug',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["method"] + " " + $parameter["path"]}}',
    description: 'Call Open Mercato REST API endpoints',
    defaults: {
      name: 'Open Mercato'
    },
    inputs: ['main' as any],
    outputs: ['main' as any],
    credentials: [
      {
        name: 'openMercatoApi',
        required: true
      }
    ],
    requestDefaults: {
      baseURL: '={{$credentials.baseUrl}}',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      }
    },
    properties: [
      {
        displayName: 'Method',
        name: 'method',
        type: 'options',
        options: [
          {
            name: 'DELETE',
            value: 'DELETE'
          },
          {
            name: 'GET',
            value: 'GET'
          },
          {
            name: 'PATCH',
            value: 'PATCH'
          },
          {
            name: 'POST',
            value: 'POST'
          },
          {
            name: 'PUT',
            value: 'PUT'
          }
        ],
        default: 'GET',
        routing: {
          request: {
            method: '={{$value}}'
          }
        }
      },
      {
        displayName: 'Path',
        name: 'path',
        type: 'string',
        default: '/api/customers/people',
        required: true,
        placeholder: '/api/customers/people',
        description: 'REST path including /api prefix',
        routing: {
          request: {
            url: '={{$value}}'
          }
        }
      },
      {
        displayName: 'Send Query Parameters',
        name: 'sendQuery',
        type: 'boolean',
        default: false
      },
      {
        displayName: 'Query Parameters (JSON)',
        name: 'queryJson',
        type: 'json',
        default: '{}',
        displayOptions: {
          show: {
            sendQuery: [true]
          }
        },
        description: 'JSON object for query string values',
        routing: {
          request: {
            qs: '={{$parameter["sendQuery"] ? $value : undefined}}'
          }
        }
      },
      {
        displayName: 'Send Body',
        name: 'sendBody',
        type: 'boolean',
        default: false
      },
      {
        displayName: 'Body (JSON)',
        name: 'bodyJson',
        type: 'json',
        default: '{}',
        displayOptions: {
          show: {
            sendBody: [true],
            method: ['POST', 'PUT', 'PATCH']
          }
        },
        description: 'JSON body payload for write requests',
        routing: {
          request: {
            body: '={{$parameter["sendBody"] ? $value : undefined}}'
          }
        }
      }
    ]
  }
}
