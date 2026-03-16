import { reactive } from 'vue'

export type ToastType = 'success' | 'error' | 'info'

export interface ToastAction {
  label: string
  callback: () => void
}

export interface ToastSelectOption {
  label: string
  value: string
}

export interface ToastSelect {
  placeholder: string
  options: ToastSelectOption[]
  onSelect: (value: string) => void
}

export interface Toast {
  id: number
  message: string
  type: ToastType
  action?: ToastAction
  select?: ToastSelect
}

let nextId = 0
const toasts = reactive<Toast[]>([])

export interface ShowOptions {
  action?: ToastAction
  select?: ToastSelect
}

export function useToast() {
  /**
   * Show a toast notification.
   * @param duration - auto-dismiss time in ms. Use 0 for persistent (manual dismiss only).
   */
  function show(message: string, type: ToastType = 'success', duration = 3000, options?: ShowOptions) {
    const id = nextId++
    toasts.push({ id, message, type, action: options?.action, select: options?.select })
    if (duration > 0) {
      setTimeout(() => dismiss(id), duration)
    }
  }

  function dismiss(id: number) {
    const idx = toasts.findIndex(t => t.id === id)
    if (idx >= 0) toasts.splice(idx, 1)
  }

  return { toasts, show, dismiss }
}
