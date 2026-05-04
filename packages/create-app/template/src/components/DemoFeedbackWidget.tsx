"use client"

import { useCallback, useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { createPortal } from 'react-dom'
import { MessageCircle, Send } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useAiDock } from '@open-mercato/ui/ai'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const SUPPRESS_COOKIE = 'om_feedback_suppress'
const SHOWN_TODAY_COOKIE = 'om_feedback_shown'

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.split(';').map((e) => e.trim()).find((e) => e.startsWith(`${name}=`))
  return match ? match.split('=').slice(1).join('=') : null
}

function setCookie(name: string, value: string, days: number) {
  if (typeof document === 'undefined') return
  document.cookie = `${name}=${value}; path=/; max-age=${days * 86400}; SameSite=Lax`
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

const CAPTIONS: Array<{ key: string; fallback: string }> = [
  { key: 'demoFeedback.button.feedback', fallback: 'Feedback' },
  { key: 'demoFeedback.button.askQuestion', fallback: 'Ask a question' },
  { key: 'demoFeedback.button.contactUs', fallback: 'Contact us' },
]

type SubmitState = 'idle' | 'sending' | 'sent' | 'error'

export function DemoFeedbackWidget({ demoModeEnabled }: { demoModeEnabled: boolean }) {
  const t = useT()
  const aiDock = useAiDock()
  const aiDockActive = Boolean(aiDock.state.assistant)
  const [open, setOpen] = useState(false)
  const [captionIndex, setCaptionIndex] = useState(0)
  const [mounted, setMounted] = useState(false)

  // form state
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [marketingConsent, setMarketingConsent] = useState(false)
  const [sendCopy, setSendCopy] = useState(true)
  const [suppressPopup, setSuppressPopup] = useState(false)
  const [submitState, setSubmitState] = useState<SubmitState>('idle')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoShownRef = useRef(false)
  const [otherModalOpen, setOtherModalOpen] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  // Track whether another Radix Dialog or native <dialog> modal is currently open.
  // The floating button + auto-popup must defer while the user is mid-task in another modal —
  // stacking the feedback dialog on top deactivates the underlying dialog (Radix DismissableLayer)
  // and leaves it with pointer-events:none, which the user perceives as a frozen page.
  useEffect(() => {
    if (!mounted || open) {
      setOtherModalOpen(false)
      return
    }
    const check = () => {
      if (typeof document === 'undefined') return false
      if (document.querySelector('[data-dialog-content][data-state="open"]')) return true
      if (document.querySelector('dialog[open]')) return true
      return false
    }
    setOtherModalOpen(check())
    const observer = new MutationObserver(() => setOtherModalOpen(check()))
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-state', 'open'], childList: true })
    return () => observer.disconnect()
  }, [mounted, open])

  // Caption rotation animation
  useEffect(() => {
    const interval = setInterval(() => {
      setCaptionIndex((prev) => (prev + 1) % CAPTIONS.length)
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  // Auto-popup after 30s inactivity (once per day, unless suppressed).
  // Skip the inactivity prompt entirely while the AI dock is open — the
  // operator is mid-conversation with an assistant and a popup would be
  // disruptive on top of (or competing with) the dock surface.
  useEffect(() => {
    if (!demoModeEnabled || !mounted) return
    if (aiDockActive) return
    if (getCookie(SUPPRESS_COOKIE) === '1') return
    if (getCookie(SHOWN_TODAY_COOKIE) === todayKey()) return

    function isAnotherModalOpen() {
      if (typeof document === 'undefined') return false
      if (document.querySelector('[data-dialog-content][data-state="open"]')) return true
      if (document.querySelector('dialog[open]')) return true
      return false
    }

    function resetTimer() {
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
      inactivityTimer.current = setTimeout(() => {
        if (autoShownRef.current) return
        if (isAnotherModalOpen()) {
          inactivityTimer.current = setTimeout(resetTimer, 5_000)
          return
        }
        autoShownRef.current = true
        setCookie(SHOWN_TODAY_COOKIE, todayKey(), 1)
        setOpen(true)
      }, 30_000)
    }

    const events = ['mousemove', 'keydown', 'scroll', 'touchstart', 'click'] as const
    events.forEach((ev) => window.addEventListener(ev, resetTimer, { passive: true }))
    resetTimer()

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, resetTimer))
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
    }
  }, [demoModeEnabled, mounted, aiDockActive])

  const handleSubmit = useCallback(async () => {
    setFieldErrors({})
    setSubmitError(null)

    const errors: Record<string, string> = {}
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errors.email = t('demoFeedback.errors.emailInvalid', 'Please enter a valid email address.')
    }
    if (!termsAccepted) {
      errors.termsAccepted = t('demoFeedback.errors.termsRequired', 'Please accept the terms to continue.')
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }

    setSubmitState('sending')
    try {
      const { ok, result } = await apiCall<{ ok?: boolean; error?: string }>(
        '/api/onboarding/demo-feedback',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            email: email.trim(),
            message: message.trim(),
            termsAccepted,
            marketingConsent,
            sendCopy,
          }),
        },
      )
      if (!ok || result?.ok === false) {
        setSubmitError(result?.error || t('demoFeedback.errors.generic', 'Something went wrong. Please try again.'))
        setSubmitState('error')
        return
      }
      setSubmitState('sent')
      if (suppressPopup) {
        setCookie(SUPPRESS_COOKIE, '1', 365)
      }
    } catch {
      setSubmitError(t('demoFeedback.errors.generic', 'Something went wrong. Please try again.'))
      setSubmitState('error')
    }
  }, [email, message, termsAccepted, marketingConsent, sendCopy, suppressPopup, t])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && submitState === 'idle') {
      e.preventDefault()
      handleSubmit()
    }
  }, [handleSubmit, submitState])

  const resetForm = useCallback(() => {
    setEmail('')
    setMessage('')
    setTermsAccepted(false)
    setMarketingConsent(false)
    setSendCopy(true)
    setSubmitState('idle')
    setSubmitError(null)
    setFieldErrors({})
  }, [])

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next)
    if (!next && submitState === 'sent') {
      resetForm()
    }
  }, [submitState, resetForm])

  if (!mounted) return null

  const caption = CAPTIONS[captionIndex]
  const currentCaption = t(caption.key, caption.fallback)

  if (otherModalOpen && !open) return null

  // Brand-gradient floating CTA. Uses brand CSS vars (no hardcoded hex) +
  // z-banner so it stays DS-compliant while keeping the bespoke 135deg /
  // 0-50-100 gradient that the marketing visual depends on. The text is
  // pinned to `text-black` because the gradient (lime → yellow → violet)
  // is a fixed light surface in BOTH themes — `text-foreground` flips to
  // near-white in dark mode and disappears against the pale gradient.
  // Mirrors the `FancyButton` primitive's `text-white` precedent on its
  // fixed dark gradient. The `om-demo-feedback-floating` class hooks into
  // globals.css (`body[data-ai-chat-open="true"] .om-demo-feedback-floating`)
  // so the FAB also hides while any AI chat surface is open; the
  // `aiDockActive` gate hides it outright when the AI dock is mounted.
  const floatingButton = aiDockActive ? null : (
    <button
      type="button"
      onClick={() => { setOpen(true); if (submitState === 'sent') resetForm() }}
      className="om-demo-feedback-floating fixed bottom-6 right-6 z-banner flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold text-black shadow-xl transition-all hover:scale-105 hover:shadow-2xl active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 animate-[subtle-bounce_2s_ease-in-out_infinite]"
      style={{
        backgroundImage: 'linear-gradient(135deg, var(--brand-lime, #B4F372) 0%, #EEFB63 50%, var(--brand-violet, #BC9AFF) 100%)',
      }}
      aria-label={t('demoFeedback.button.ariaLabel', 'Open feedback form')}
    >
      <MessageCircle className="size-4" />
      <span
        key={captionIndex}
        className="inline-block min-w-[90px] text-center animate-[caption-slide_0.3s_ease-out]"
      >
        {currentCaption}
      </span>
    </button>
  )

  return (
    <>
      {floatingButton ? createPortal(floatingButton, document.body) : null}
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md" onKeyDown={handleKeyDown}>
          <DialogHeader className="items-center gap-3">
            <Image alt="Open Mercato" src="/open-mercato.svg" width={48} height={48} />
            <DialogTitle className="text-center text-xl">
              {t('demoFeedback.dialog.title', 'Talk to Open Mercato team')}
            </DialogTitle>
            <DialogDescription className="text-center text-balance leading-relaxed">
              {t('demoFeedback.dialog.description', 'What you just saw is ~80% of a real system.\nLet\u2019s talk about how to turn this into a production-ready solution in weeks, not months.')}
            </DialogDescription>
          </DialogHeader>

          {submitState === 'sent' ? (
            <div className="rounded-lg border border-status-success-border bg-status-success-bg px-4 py-6 text-center">
              <p className="font-medium text-status-success-text">
                {t('demoFeedback.dialog.successTitle', 'Thank you!')}
              </p>
              <p className="mt-1 text-sm text-status-success-text">
                {t('demoFeedback.dialog.successBody', 'We\u2019ll get back to you shortly.')}
              </p>
            </div>
          ) : (
            <div className="grid gap-3">
              {submitError && (
                <div className="rounded-md border border-status-error-border bg-status-error-bg px-3 py-2 text-sm text-status-error-text">
                  {submitError}
                </div>
              )}

              <div className="grid gap-1">
                <Input
                  id="feedback-email"
                  type="email"
                  placeholder={t('demoFeedback.form.email', 'Your email')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={submitState === 'sending'}
                  aria-invalid={Boolean(fieldErrors.email)}
                  className={fieldErrors.email ? 'border-status-error-border aria-invalid:ring-destructive' : undefined}
                />
                {fieldErrors.email && <p className="text-xs text-status-error-text">{fieldErrors.email}</p>}
              </div>

              <Textarea
                id="feedback-message"
                rows={3}
                placeholder={t('demoFeedback.form.message', 'Your message (optional)')}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                disabled={submitState === 'sending'}
                className="resize-none"
              />

              <label className="flex items-start gap-2.5 text-xs text-muted-foreground leading-relaxed">
                <Checkbox
                  id="feedback-terms"
                  checked={termsAccepted}
                  disabled={submitState === 'sending'}
                  onCheckedChange={(v) => {
                    setTermsAccepted(v === true)
                    if (v === true) setFieldErrors((p) => { const n = { ...p }; delete n.termsAccepted; return n })
                  }}
                  aria-invalid={Boolean(fieldErrors.termsAccepted)}
                />
                <span>
                  {t('demoFeedback.form.termsLabel', 'I have read and accept the ')}
                  <a className="underline hover:text-foreground" href="/terms" target="_blank" rel="noreferrer">
                    {t('demoFeedback.form.termsLink', 'Terms of Service')}
                  </a>
                  {t('demoFeedback.form.termsAnd', ' and ')}
                  <a className="underline hover:text-foreground" href="/privacy" target="_blank" rel="noreferrer">
                    {t('demoFeedback.form.privacyLink', 'Privacy Policy')}
                  </a>
                  {fieldErrors.termsAccepted && (
                    <span className="mt-0.5 block text-status-error-text">{fieldErrors.termsAccepted}</span>
                  )}
                </span>
              </label>

              <label className="flex items-start gap-2.5 text-xs text-muted-foreground leading-relaxed">
                <Checkbox
                  id="feedback-marketing"
                  checked={marketingConsent}
                  disabled={submitState === 'sending'}
                  onCheckedChange={(v) => setMarketingConsent(v === true)}
                />
                <span>
                  {t('demoFeedback.form.marketingLabel', "I consent to receiving direct marketing from CT Tornado by email. I can withdraw my consent at any time. See our {termsLink} and {privacyLink}.")
                    .split(/{termsLink}|{privacyLink}/)
                    .map((part, i, arr) => (
                      <span key={i}>
                        {part}
                        {i < arr.length - 1 && (
                          i === 0 ? (
                            <a className="underline hover:text-foreground" href="/terms" target="_blank" rel="noreferrer">
                              {t('demoFeedback.form.termsLink', 'Terms of Service')}
                            </a>
                          ) : (
                            <a className="underline hover:text-foreground" href="/privacy" target="_blank" rel="noreferrer">
                              {t('demoFeedback.form.privacyLink', 'Privacy Policy')}
                            </a>
                          )
                        )}
                      </span>
                    ))}
                </span>
              </label>

              <label className="flex items-center gap-2.5 text-xs text-muted-foreground">
                <Checkbox
                  id="feedback-send-copy"
                  checked={sendCopy}
                  disabled={submitState === 'sending'}
                  onCheckedChange={(v) => setSendCopy(v === true)}
                />
                <span>{t('demoFeedback.form.sendCopy', 'Send me a copy of this message')}</span>
              </label>

              <label className="flex items-center gap-2.5 text-xs text-muted-foreground">
                <Checkbox
                  id="feedback-suppress"
                  checked={suppressPopup}
                  disabled={submitState === 'sending'}
                  onCheckedChange={(v) => setSuppressPopup(v === true)}
                />
                <span>{t('demoFeedback.form.suppressPopup', 'Do not show this popup automatically')}</span>
              </label>

              <Button
                type="button"
                className="mt-1 w-full gap-2 text-black"
                disabled={submitState === 'sending'}
                onClick={handleSubmit}
                style={{
                  // Same brand-gradient as the floating CTA (135deg / 0-50-100,
                  // brand vars instead of hex literals to satisfy DS rules).
                  // Pin text to `text-black` — the gradient is a fixed light
                  // surface in both themes; `text-foreground` would flip white
                  // in dark mode and vanish against the pale gradient.
                  backgroundImage: 'linear-gradient(135deg, var(--brand-lime, #B4F372) 0%, #EEFB63 50%, var(--brand-violet, #BC9AFF) 100%)',
                }}
              >
                {submitState === 'sending' ? (
                  <Spinner size="sm" />
                ) : (
                  <>
                    <Send className="size-4" />
                    {t('demoFeedback.form.submit', 'Contact me')}
                  </>
                )}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <style jsx global>{`
        @keyframes subtle-bounce {
          0%, 100% { transform: translateY(0); }
          15% { transform: translateY(-4px); }
          30% { transform: translateY(0); }
          45% { transform: translateY(-2px); }
          60% { transform: translateY(0); }
        }
        @keyframes caption-slide {
          0% { opacity: 0; transform: translateY(6px); }
          100% { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </>
  )
}
