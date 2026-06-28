import { bootstrap } from '@/bootstrap'
import { POST as loginPost } from '@open-mercato/core/modules/auth/api/login'

bootstrap()

export const POST = loginPost
