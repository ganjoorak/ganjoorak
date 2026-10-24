import * as React from "react"

import { cn } from "@/lib/utils"

/** shadcn-style empty state: dashed card, round icon, title, description, actions. */
function Empty({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty"
      className={cn(
        "flex w-full flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card/60 px-5 py-10 text-center text-card-foreground",
        className
      )}
      {...props}
    />
  )
}

function EmptyIcon({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="empty-icon"
      aria-hidden="true"
      className={cn(
        "inline-grid size-13 place-items-center rounded-full bg-muted text-xl text-foreground/75",
        className
      )}
      {...props}
    />
  )
}

function EmptyTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      data-slot="empty-title"
      className={cn("m-0 text-lg font-extrabold", className)}
      {...props}
    />
  )
}

function EmptyDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="empty-description"
      className={cn("m-0 max-w-md text-sm leading-8 text-muted-foreground", className)}
      {...props}
    />
  )
}

function EmptyActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-actions"
      className={cn("flex flex-wrap justify-center gap-2", className)}
      {...props}
    />
  )
}

export { Empty, EmptyIcon, EmptyTitle, EmptyDescription, EmptyActions }
