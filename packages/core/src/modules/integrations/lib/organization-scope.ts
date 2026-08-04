/**
 * @deprecated Moved to `@open-mercato/shared/lib/auth/organizationScope` as
 * `resolveActiveOrganizationId`, because `data_sync` needs the same resolution and
 * `integrations` is not the right owner for it. This alias stays for third-party
 * modules that already import from here.
 */
export { resolveActiveOrganizationId as resolveIntegrationsOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
