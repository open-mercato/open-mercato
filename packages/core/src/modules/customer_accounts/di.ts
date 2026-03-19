import { asClass } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { CustomerUserService } from '@open-mercato/core/modules/customer_accounts/services/customerUserService'
import { CustomerSessionService } from '@open-mercato/core/modules/customer_accounts/services/customerSessionService'
import { CustomerTokenService } from '@open-mercato/core/modules/customer_accounts/services/customerTokenService'
import { CustomerRbacService } from '@open-mercato/core/modules/customer_accounts/services/customerRbacService'
import { CustomerInvitationService } from '@open-mercato/core/modules/customer_accounts/services/customerInvitationService'

export function register(container: AppContainer) {
  container.register({ customerUserService: asClass(CustomerUserService).scoped() })
  container.register({ customerSessionService: asClass(CustomerSessionService).scoped() })
  container.register({ customerTokenService: asClass(CustomerTokenService).scoped() })
  container.register({ customerRbacService: asClass(CustomerRbacService).scoped() })
  container.register({ customerInvitationService: asClass(CustomerInvitationService).scoped() })
}
