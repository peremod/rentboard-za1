import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
  visible: boolean;
}

/**
 * Minimal toast store for the error interceptor to report into.
 * A visual <app-toast> component (with undo support) lands with the
 * notice-board UI pass — this is the state layer only, for now.
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);

  success(message: string) { this.show('success', message); }
  error(message: string) { this.show('error', message); }
  info(message: string) { this.show('info', message); }
  warning(message: string) { this.show('warning', message); }

  dismiss(id: string) {
    this.toasts.update((t) => t.filter((x) => x.id !== id));
  }

  private show(type: Toast['type'], message: string) {
    const toast: Toast = { id: crypto.randomUUID(), type, message, visible: true };
    this.toasts.update((t) => [...t, toast]);
    setTimeout(() => this.dismiss(toast.id), 5000);
  }
}
