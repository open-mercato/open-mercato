export const SCIM_CONTENT_TYPE = 'application/scim+json'

const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error'
const SCIM_LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse'

export function scimJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': SCIM_CONTENT_TYPE },
  })
}

export function buildScimError(
  status: number,
  detail: string,
  scimType?: string,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    schemas: [SCIM_ERROR_SCHEMA],
    status: String(status),
    detail,
  }
  if (scimType) body.scimType = scimType
  return body
}

export function buildListResponse(
  resources: unknown[],
  totalResults: number,
  startIndex: number,
  itemsPerPage: number,
): Record<string, unknown> {
  return {
    schemas: [SCIM_LIST_SCHEMA],
    totalResults,
    startIndex,
    itemsPerPage,
    Resources: resources,
  }
}
