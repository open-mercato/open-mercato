import * as React from "react"
import { cn } from "@open-mercato/shared/lib/utils"
import { Checkbox, type CheckboxProps } from "./checkbox"

export type CheckboxFieldProps = Omit<CheckboxProps, "id"> & {
  id?: string
  label: React.ReactNode
  sublabel?: React.ReactNode
  description?: React.ReactNode
  badge?: React.ReactNode
  link?: React.ReactNode
  /** When true, renders the checkbox on the right of the label content. */
  flip?: boolean
  /** Additional className for the outer wrapper. */
  containerClassName?: string
  /** Additional className for the right-side content stack. */
  contentClassName?: string
}

let autoIdCounter = 0
function useAutoId(prefix = "checkbox-field") {
  const [id] = React.useState(() => `${prefix}-${++autoIdCounter}`)
  return id
}

export const CheckboxField = React.forwardRef<
  React.ElementRef<typeof Checkbox>,
  CheckboxFieldProps
>(({
  id: idProp,
  label,
  sublabel,
  description,
  badge,
  link,
  flip = false,
  containerClassName,
  contentClassName,
  size = "md",
  className,
  disabled,
  ...checkboxProps
}, ref) => {
  const fallbackId = useAutoId()
  const id = idProp ?? fallbackId

  const hasMultiLine = Boolean(description || sublabel || link)
  const checkbox = (
    <Checkbox
      ref={ref}
      id={id}
      size={size}
      disabled={disabled}
      className={cn(hasMultiLine && "mt-0.5", className)}
      {...checkboxProps}
    />
  )

  const content = (
    <div className={cn("flex flex-1 min-w-0 flex-col gap-2.5", contentClassName)}>
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-1">
          <label
            htmlFor={id}
            className={cn(
              "text-sm font-medium leading-5 text-foreground select-none",
              disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
            )}
          >
            {label}
          </label>
          {sublabel ? (
            <span className="text-xs leading-4 text-muted-foreground select-none">{sublabel}</span>
          ) : null}
          {badge ? <span className="inline-flex shrink-0">{badge}</span> : null}
        </div>
        {description ? (
          <p className="text-xs leading-4 text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {link ? <div className="flex">{link}</div> : null}
    </div>
  )

  return (
    <div
      className={cn(
        "flex gap-2",
        hasMultiLine ? "items-start" : "items-center",
        flip && "flex-row-reverse",
        containerClassName
      )}
    >
      {flip ? content : checkbox}
      {flip ? checkbox : content}
    </div>
  )
})
CheckboxField.displayName = "CheckboxField"
