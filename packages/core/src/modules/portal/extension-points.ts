import { defineModuleExtensionPoints, injectionExtensionHost } from '@open-mercato/shared/modules/widgets/extension-points'

const portalPageHost = (spotId: string, source: string) => injectionExtensionHost({
  family: 'portal-page',
  spotId,
  supported: ['render-widget'],
  contextContract: 'portal.page.v1',
  scopeContract: 'tenant.organization.customer-session',
  source,
})

export const extensionPoints = defineModuleExtensionPoints({
  moduleId: 'portal',
  hosts: {
    dashboardBefore: portalPageHost('portal:dashboard:before', 'frontend/[orgSlug]/portal/dashboard/page.tsx'),
    dashboardAfter: portalPageHost('portal:dashboard:after', 'frontend/[orgSlug]/portal/dashboard/page.tsx'),
    loginBefore: portalPageHost('portal:login:before', 'frontend/[orgSlug]/portal/login/page.tsx'),
    loginAfter: portalPageHost('portal:login:after', 'frontend/[orgSlug]/portal/login/page.tsx'),
    homeBefore: portalPageHost('portal:home:before', 'frontend/[orgSlug]/portal/page.tsx'),
    homeAfter: portalPageHost('portal:home:after', 'frontend/[orgSlug]/portal/page.tsx'),
    profileBefore: portalPageHost('portal:profile:before', 'frontend/[orgSlug]/portal/profile/page.tsx'),
    profileAfter: portalPageHost('portal:profile:after', 'frontend/[orgSlug]/portal/profile/page.tsx'),
    resetPasswordBefore: portalPageHost('portal:reset-password:before', 'frontend/[orgSlug]/portal/reset-password/page.tsx'),
    resetPasswordAfter: portalPageHost('portal:reset-password:after', 'frontend/[orgSlug]/portal/reset-password/page.tsx'),
    signupBefore: portalPageHost('portal:signup:before', 'frontend/[orgSlug]/portal/signup/page.tsx'),
    signupAfter: portalPageHost('portal:signup:after', 'frontend/[orgSlug]/portal/signup/page.tsx'),
  },
})

export default extensionPoints
