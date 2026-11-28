'use client'

import * as React from 'react'
import { cn } from '../lib/cn'
import { CircleAlertIcon, CircleCheckIcon, InfoIcon, TriangleAlertIcon, XIcon } from '../lib/icons'

export type ToastStatus = 'neutral' | 'success' | 'information' | 'warning' | 'error'

export type ToastOptions = {
  id?: string
  title: React.ReactNode
  description?: React.ReactNode
  status?: ToastStatus
  /** One action, for example "View cart" or "Undo". */
  action?: { label: React.ReactNode; onClick: () => void }
  /** Milliseconds; error toasts never auto-dismiss. */
  duration?: number
}

type ToastRecord = Required<Pick<ToastOptions, 'id'>> & ToastOptions

type ToastContextValue = {
  toast: (options: ToastOptions) => string
  dismiss: (id?: string) => void
}

const ToastContext = React.createContext<ToastContextValue | null>(null)

const statusIcon: Record<ToastStatus, React.ReactNode> = {
  neutral: null,
  success: <CircleCheckIcon className="text-status-success-icon" />,
  information: <InfoIcon className="text-status-info-icon" />,
  warning: <TriangleAlertIcon className="text-status-warning-icon" />,
  error: <CircleAlertIcon className="text-status-error-icon" />,
}

export type ToastProviderProps = {
  children: React.ReactNode
  /** Accessible name of the dismiss button, resolved by the app's i18n. */
  dismissLabel: string
  /** Most toasts visible at once; older ones are dropped. */
  limit?: number
  position?: 'bottom' | 'top'
}

function ToastProvider({ children, dismissLabel, limit = 2, position = 'bottom' }: ToastProviderProps) {
  const [toasts, setToasts] = React.useState<ToastRecord[]>([])
  const timers = React.useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const dismiss = React.useCallback((id?: string) => {
    setToasts((current) => (id ? current.filter((item) => item.id !== id) : []))
    if (id) {
      const timer = timers.current.get(id)
      if (timer) clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const toast = React.useCallback(
    (options: ToastOptions) => {
      const id = options.id ?? `toast-${Math.random().toString(36).slice(2, 10)}`
      setToasts((current) => [...current.filter((item) => item.id !== id), { ...options, id }].slice(-limit))
      const duration = options.duration ?? (options.status === 'error' ? 0 : 5000)
      if (duration > 0) {
        timers.current.set(id, setTimeout(() => dismiss(id), duration))
      }
      return id
    },
    [dismiss, limit],
  )

  React.useEffect(() => {
    const active = timers.current
    return () => { active.forEach((timer) => clearTimeout(timer)) }
  }, [])

  const value = React.useMemo(() => ({ toast, dismiss }), [toast, dismiss])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        data-slot="toast-viewport"
        className={cn(
          'pointer-events-none fixed inset-x-0 z-toast flex flex-col items-center gap-2 px-4',
          position === 'bottom' ? 'bottom-[max(1rem,env(safe-area-inset-bottom))]' : 'top-4',
        )}
      >
        {toasts.map((item) => {
          const status = item.status ?? 'neutral'
          return (
            <div
              key={item.id}
              role={status === 'error' ? 'alert' : 'status'}
              data-slot="toast"
              data-status={status}
              className={cn(
                'pointer-events-auto flex w-full max-w-100 items-start gap-3 rounded-sf-field bg-foreground px-4 py-3 text-background shadow-lg',
                'animate-in fade-in-0 slide-in-from-bottom-2 duration-(--sf-motion-base)',
                '[&_svg]:mt-0.5 [&_svg]:size-5 [&_svg]:shrink-0',
              )}
            >
              {statusIcon[status]}
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="text-sf-body-sm">{item.title}</p>
                {item.description ? <p className="text-sf-body-xs opacity-80">{item.description}</p> : null}
              </div>
              {item.action ? (
                <button
                  type="button"
                  onClick={() => { item.action?.onClick(); dismiss(item.id) }}
                  className="shrink-0 cursor-pointer rounded-sf-badge px-2 py-1 text-sf-body-sm underline-offset-4 outline-none hover:underline focus-visible:shadow-focus"
                >
                  {item.action.label}
                </button>
              ) : null}
              <button
                type="button"
                aria-label={dismissLabel}
                onClick={() => dismiss(item.id)}
                className="-mr-1 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-sf-badge opacity-70 outline-none hover:opacity-100 focus-visible:shadow-focus [&_svg]:size-4"
              >
                <XIcon />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

function useToast(): ToastContextValue {
  const context = React.useContext(ToastContext)
  if (!context) throw new Error('[internal] Toast.useToast must be used inside Toast.Provider')
  return context
}

/** Transient feedback with at most one action. Never the only channel for an error that needs fixing. */
export const Toast = { Provider: ToastProvider, useToast }
