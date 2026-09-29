export const OPENMERCATO_CALL_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

export type OpenMercatoCallMethod = (typeof OPENMERCATO_CALL_METHODS)[number]

export type OpenMercatoEndpointOption = {
  id: string
  path: string
  method: OpenMercatoCallMethod
  label: string
  summary: string | null
  operationId: string | null
}

export type OpenMercatoApiKeyRoleOption = {
  id: string
  name: string | null
}

export type OpenMercatoApiKeyOption = {
  id: string
  name: string
  keyPrefix: string
  organizationId: string | null
  organizationName: string | null
  roles: OpenMercatoApiKeyRoleOption[]
}

export type OpenMercatoCallOptionsResponse = {
  endpoints: OpenMercatoEndpointOption[]
  apiKeys: OpenMercatoApiKeyOption[]
}
