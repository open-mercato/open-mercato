import { z } from 'zod'
import { NextResponse } from 'next/server'
import { getDb } from '@/db'
import { users, passwordResets } from '@/db/schema'
import { eq, and, isNull, gt } from 'drizzle-orm'
import { hash } from 'bcryptjs'

const schema = z.object({ token: z.string().min(10), password: z.string().min(6) })

export async function POST(req: Request) {
  const form = await req.formData()
  const token = String(form.get('token') ?? '')
  const password = String(form.get('password') ?? '')
  const parsed = schema.safeParse({ token, password })
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid request' }, { status: 400 })
  const db = getDb()
  const now = new Date()
  const [row] = await db.select().from(passwordResets).where(and(eq(passwordResets.token, parsed.data.token), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, now))).limit(1)
  if (!row) return NextResponse.json({ ok: false, error: 'Invalid or expired token' }, { status: 400 })
  const passwordHash = await hash(parsed.data.password, 10)
  await db.update(users).set({ passwordHash }).where(eq(users.id, row.userId))
  await db.update(passwordResets).set({ usedAt: new Date() }).where(eq(passwordResets.id, row.id))
  return NextResponse.json({ ok: true, redirect: '/login' })
}

