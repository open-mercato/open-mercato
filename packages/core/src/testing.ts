/**
 * Shared Playwright integration test helpers for example apps.
 *
 * Usage:
 *   import { login, DEFAULT_CREDENTIALS } from '@open-mercato/core/testing/auth'
 *   import { getAuthToken, apiRequest, postForm } from '@open-mercato/core/testing/api'
 */

export {
  login,
  DEFAULT_CREDENTIALS,
  acknowledgeGlobalNotices,
  dismissGlobalNoticesIfPresent,
  recoverClientSideErrorPageIfPresent,
  recoverGenericErrorPageIfPresent,
  type Role,
} from './modules/core/__integration__/helpers/auth'

export {
  getAuthToken,
  apiRequest,
  postForm,
} from './modules/core/__integration__/helpers/api'
