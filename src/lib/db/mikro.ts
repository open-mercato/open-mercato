import 'dotenv/config'
import 'reflect-metadata'
import { MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver } from '@mikro-orm/postgresql'

let ormInstance: MikroORM<PostgreSqlDriver> | null = null

export async function getOrm() {
  if (ormInstance) return ormInstance
  const { entities } = await import('@/modules/entities.generated')
  const clientUrl = process.env.DATABASE_URL
  if (!clientUrl) throw new Error('DATABASE_URL is not set')
  ormInstance = await MikroORM.init<PostgreSqlDriver>({
    driver: PostgreSqlDriver,
    clientUrl,
    entities,
    debug: false,
  })
  return ormInstance
}

export async function getEm() {
  const orm = await getOrm()
  return orm.em.fork({ clear: true })
}
