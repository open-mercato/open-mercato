import { bootstrap } from '@/bootstrap-api'
import { POST as loginPost } from '@open-mercato/core/modules/auth/api/login'
export { metadata, openApi } from '@open-mercato/core/modules/auth/api/login'

bootstrap()

export const POST = loginPost
