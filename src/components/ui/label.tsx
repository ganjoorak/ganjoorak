import * as React from "react"

import { cn } from "@/lib/utils"

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "grid gap-1.5 text-sm leading-none font-semibold select-none has-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

function FieldHint({ className, ...props }: React.ComponentProps<"small">) {
  return (
    <small
      data-slot="field-hint"
      className={cn("text-xs leading-5 font-normal text-muted-foreground", className)}
      {...props}
    />
  )
}

export { Label, FieldHint }
