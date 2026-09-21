import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

let scrollLockCount = 0
let previousBodyOverflow = ''

const focusableSelector = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

/**
 * Shared accessible shell for the material analytics dialogs.  It intentionally
 * owns only modal mechanics; each consumer keeps its visual header and content.
 */
export default function MaterialAnalyticsDialog({
  open,
  onClose,
  labelledBy,
  describedBy,
  dialogClassName = 'kpi-material-detail-modal',
  overlayClassName = 'kpi-material-detail-overlay',
  dialogRef: externalDialogRef,
  initialFocusRef,
  returnFocusRef,
  children,
}) {
  const internalDialogRef = useRef(null)
  const dialogRef = externalDialogRef || internalDialogRef

  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined

    if (scrollLockCount === 0) {
      previousBodyOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    scrollLockCount += 1

    const returnFocusElement = returnFocusRef?.current || null
    const focusTimer = window.setTimeout(() => initialFocusRef?.current?.focus(), 0)
    const onKeyDown = event => {
      if (event.key === 'Escape') {
        if (event.defaultPrevented) return
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = Array.from(dialogRef.current?.querySelectorAll(focusableSelector) || [])
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', onKeyDown)
      scrollLockCount = Math.max(0, scrollLockCount - 1)
      if (scrollLockCount === 0) document.body.style.overflow = previousBodyOverflow
      if (returnFocusElement?.isConnected) returnFocusElement.focus()
    }
  }, [dialogRef, initialFocusRef, onClose, open, returnFocusRef])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div className={overlayClassName} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <section className={dialogClassName} ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={labelledBy} aria-describedby={describedBy}>
        {children}
      </section>
    </div>,
    document.body,
  )
}
