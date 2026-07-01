import { useState } from "react"
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from "./alert-dialog"
import { Button } from "./button"
import { Input } from "./input"

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  description: string
  confirmText: string
  actionLabel: string
  onConfirm: () => void
}

export function ConfirmDialog({ open, onOpenChange, title, description, confirmText, actionLabel, onConfirm }: ConfirmDialogProps) {
  const [typed, setTyped] = useState("")
  const confirmed = typed === confirmText

  return (
    <AlertDialog open={open} onOpenChange={(v) => { setTyped(""); onOpenChange(v) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1">
          <label className="text-sm font-medium">Type <code className="rounded bg-muted px-1 py-0.5">{confirmText}</code> to confirm</label>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={confirmText} />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={!confirmed} onClick={() => { setTyped(""); onConfirm() }}>
            {actionLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
