import { EntityManager } from '@mikro-orm/postgresql'
import { compare, hash } from 'bcryptjs'
import { User, Role, UserRole, Session, PasswordReset } from '@/modules/auth/db/entities'
import crypto from 'node:crypto'

export async function findUserByEmail(em: EntityManager, email: string) {
  return em.findOne(User, { email })
}

export async function verifyPassword(user: User, password: string) {
  if (!user.passwordHash) return false
  return compare(password, user.passwordHash)
}

export async function updateLastLoginAt(em: EntityManager, user: User) {
  user.lastLoginAt = new Date()
  await em.flush()
}

export async function getUserRoles(em: EntityManager, user: User): Promise<string[]> {
  const links = await em.find(UserRole, { user }, { populate: ['role'] })
  return links.map(l => l.role.name)
}

export async function createSession(em: EntityManager, user: User, expiresAt: Date) {
  const token = crypto.randomBytes(32).toString('hex')
  const sess = em.create(Session, { user, token, expiresAt })
  await em.persistAndFlush(sess)
  return sess
}

export async function deleteSessionByToken(em: EntityManager, token: string) {
  await em.nativeDelete(Session, { token })
}

export async function refreshFromSessionToken(em: EntityManager, token: string) {
  const now = new Date()
  const sess = await em.findOne(Session, { token })
  if (!sess || sess.expiresAt <= now) return null
  const user = await em.findOne(User, { id: sess.user.id }, { populate: ['organization', 'tenant'] })
  if (!user) return null
  const roles = await getUserRoles(em, user)
  return { user, roles }
}

export async function requestPasswordReset(em: EntityManager, email: string) {
  const user = await findUserByEmail(em, email)
  if (!user) return null
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000)
  const row = em.create(PasswordReset, { user, token, expiresAt })
  await em.persistAndFlush(row)
  return { user, token }
}

export async function confirmPasswordReset(em: EntityManager, token: string, newPassword: string) {
  const now = new Date()
  const row = await em.findOne(PasswordReset, { token })
  if (!row || (row.usedAt && row.usedAt <= now) || row.expiresAt <= now) return false
  const user = await em.findOne(User, { id: row.user.id })
  if (!user) return false
  user.passwordHash = await hash(newPassword, 10)
  row.usedAt = new Date()
  await em.flush()
  return true
}

