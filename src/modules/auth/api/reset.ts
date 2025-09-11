import { z } from 'zod'
import { NextResponse } from 'next/server'
import { getDb } from '@/db'
import { users, passwordResets } from '@/db/schema'
import { eq } from 'drizzle-orm'
import crypto from 'node:crypto'
import { sendEmail } from '@/lib/email/send'
import ResetPasswordEmail from '@/emails/ResetPasswordEmail'

const schema = z.object({ email: z.string().email() })

export async function POST(req: Request) {
  const form = await req.formData()
  const email = String(form.get('email') ?? '')
  const parsed = schema.safeParse({ email })
  if (!parsed.success) return NextResponse.json({ ok: true }) // do not reveal
  const db = getDb()
  const [user] = await db.select().from(users).where(eq(users.email, parsed.data.email)).limit(1)
  // Always respond ok even if user not found
  if (!user) return NextResponse.json({ ok: true })
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000)
  await db.insert(passwordResets).values({ userId: user.id, token, expiresAt })
  const url = new URL(req.url)
  const base = process.env.APP_URL || `${url.protocol}//${url.host}`
  const resetUrl = `${base}/reset/${token}`
  await sendEmail({ to: user.email, subject: 'Reset your password', react: ResetPasswordEmail({ resetUrl }) })
  return NextResponse.json({ ok: true })
}

