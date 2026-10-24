import * as React from "react"

import { cn } from "@/lib/utils"

/** Inline form/request error: shadcn "destructive alert" look, announced to screen readers. */
function FormError({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="form-error"
      role="alert"
      aria-live="assertive"
      className={cn(
        "rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm leading-6 text-destructive",
        className
      )}
      {...props}
    />
  )
}

export { FormError }
