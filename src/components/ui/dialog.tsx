"use client"

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { XIcon } from "lucide-react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

/**
 * DialogPopup renders through a Portal, so it doesn't inherit `dir` from a
 * nearby wrapper (only from document.documentElement). DialogTrigger
 * measures the ambient direction where it's actually rendered and pushes it
 * here so DialogViewport can apply it explicitly to the portaled content —
 * otherwise Persian text and logical spacing inside the dialog would render
 * as if LTR whenever the dialog is opened from an RTL-only section of an
 * otherwise-LTR page.
 */
const DialogDirContext = React.createContext<{
  dir: "ltr" | "rtl"
  setDir: (dir: "ltr" | "rtl") => void
}>({ dir: "ltr", setDir: () => {} })

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  const [dir, setDir] = React.useState<"ltr" | "rtl">("ltr")
  const contextValue = React.useMemo(() => ({ dir, setDir }), [dir])

  return (
    <DialogDirContext.Provider value={contextValue}>
      <DialogPrimitive.Root data-slot="dialog" {...props} />
    </DialogDirContext.Provider>
  )
}

const DialogPortal = DialogPrimitive.Portal

function DialogTrigger({ className, ...props }: DialogPrimitive.Trigger.Props) {
  const ref = React.useRef<HTMLButtonElement>(null)
  const { setDir } = React.useContext(DialogDirContext)

  React.useEffect(() => {
    function update() {
      if (!ref.current) return
      setDir(getComputedStyle(ref.current).direction === "rtl" ? "rtl" : "ltr")
    }

    update()

    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["dir"],
      subtree: true,
    })

    return () => observer.disconnect()
  }, [setDir])

  return (
    <DialogPrimitive.Trigger
      ref={ref}
      data-slot="dialog-trigger"
      className={className}
      {...props}
    />
  )
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogBackdrop({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-backdrop"
      className={cn(
        "fixed inset-0 z-50 bg-black/45 backdrop-blur-md duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DialogViewport({
  className,
  ...props
}: DialogPrimitive.Viewport.Props) {
  const { dir } = React.useContext(DialogDirContext)

  return (
    <DialogPrimitive.Viewport
      dir={dir}
      data-slot="dialog-viewport"
      className={cn(
        "fixed inset-0 z-50 grid grid-rows-[1fr_auto_3fr] justify-items-center p-4 max-sm:grid-rows-[1fr_auto] max-sm:p-0 max-sm:pt-[env(safe-area-inset-top)]",
        className
      )}
      {...props}
    />
  )
}

// Phones get a bottom sheet: the grabber drags the popup down and a pull past
// the threshold closes it through a hidden Close, so Base UI owns the state.
function SheetGrabber({ closeRef }: { closeRef: React.RefObject<HTMLButtonElement | null> }) {
  const start = React.useRef<number | null>(null)
  const popup = (el: EventTarget) =>
    (el as HTMLElement).closest<HTMLElement>("[data-slot=dialog-popup]")
  const reset = (el: HTMLElement | null) => {
    if (!el) return
    el.style.transform = ""
    el.style.transition = ""
  }
  return (
    <div
      aria-hidden="true"
      data-slot="dialog-grabber"
      className="flex h-6 shrink-0 cursor-grab touch-none items-center justify-center sm:hidden"
      onPointerDown={(e) => {
        start.current = e.clientY
        e.currentTarget.setPointerCapture(e.pointerId)
        const el = popup(e.currentTarget)
        if (el) el.style.transition = "none"
      }}
      onPointerMove={(e) => {
        if (start.current === null) return
        const dy = Math.max(0, e.clientY - start.current)
        const el = popup(e.currentTarget)
        if (el) el.style.transform = `translateY(${dy}px)`
      }}
      onPointerUp={(e) => {
        if (start.current === null) return
        const dy = e.clientY - start.current
        start.current = null
        const el = popup(e.currentTarget)
        reset(el)
        if (dy > 80) closeRef.current?.click()
      }}
      onPointerCancel={(e) => {
        start.current = null
        reset(popup(e.currentTarget))
      }}
    >
      <span className="h-1.5 w-10 rounded-full bg-muted-foreground/35" />
    </div>
  )
}

function DialogPopup({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
}) {
  const closeRef = React.useRef<HTMLButtonElement>(null)
  return (
    <DialogPortal>
      <DialogBackdrop />
      <DialogViewport>
        <DialogPrimitive.Popup
          data-slot="dialog-popup"
          className={cn(
            "relative row-start-2 flex max-h-[calc(100dvh-2rem)] min-h-0 w-full max-w-lg min-w-0 flex-col rounded-2xl border border-border bg-popover text-popover-foreground shadow-lg duration-150 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 max-sm:max-h-[calc(100dvh-1rem-env(safe-area-inset-top))] max-sm:max-w-none max-sm:rounded-b-none max-sm:rounded-t-3xl max-sm:border-x-0 max-sm:border-b-0 max-sm:pb-[env(safe-area-inset-bottom)] max-sm:duration-300 max-sm:ease-[cubic-bezier(0.32,0.72,0,1)] max-sm:data-open:zoom-in-100 max-sm:data-open:slide-in-from-bottom max-sm:data-closed:zoom-out-100 max-sm:data-closed:slide-out-to-bottom",
            className
          )}
          {...props}
        >
          <SheetGrabber closeRef={closeRef} />
          <DialogPrimitive.Close ref={closeRef} hidden tabIndex={-1} aria-hidden="true" />
          {children}
          {showCloseButton && (
            <DialogPrimitive.Close
              aria-label="Close"
              className="absolute end-2 top-2"
              render={<Button size="icon-sm" variant="ghost" />}
            >
              <XIcon />
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Popup>
      </DialogViewport>
    </DialogPortal>
  )
}

function DialogHeader({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">) {
  const defaultProps = {
    className: cn(
      "flex flex-col gap-2 p-6 in-[[data-slot=dialog-popup]:has([data-slot=dialog-panel])]:pb-3",
      className
    ),
    "data-slot": "dialog-header",
  }

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  })
}

function DialogFooter({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"div"> & {
  variant?: "default" | "bare"
}) {
  const defaultProps = {
    className: cn(
      "flex flex-col-reverse gap-2 rounded-b-[inherit] px-6 sm:flex-row sm:justify-end",
      variant === "default" && "border-t border-border bg-muted/50 py-4",
      variant === "bare" &&
        "pt-4 pb-6 in-[[data-slot=dialog-popup]:has([data-slot=dialog-panel])]:pt-3",
      className
    ),
    "data-slot": "dialog-footer",
  }

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  })
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-xl leading-none font-semibold",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function DialogPanel({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">) {
  const defaultProps = {
    className: cn(
      "px-6 pb-6 in-[[data-slot=dialog-popup]:has([data-slot=dialog-header])]:pt-1",
      className
    ),
    "data-slot": "dialog-panel",
  }

  return (
    <ScrollArea className="flex-1">
      {useRender({
        defaultTagName: "div",
        props: mergeProps<"div">(defaultProps, props),
        render,
      })}
    </ScrollArea>
  )
}

export {
  Dialog,
  DialogBackdrop,
  DialogBackdrop as DialogOverlay,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogPopup as DialogContent,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  DialogViewport,
}
