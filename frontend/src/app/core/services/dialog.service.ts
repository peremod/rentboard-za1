import { Injectable, signal } from '@angular/core';

export type DialogTone = 'info' | 'success' | 'error' | 'warning';

export interface DialogRequest {
  id: string;
  tone: DialogTone;
  title: string;
  message: string;
  /** Label for the single dismiss button. */
  confirmLabel: string;
  /** Present only for a confirm dialog; absent means alert-only. */
  cancelLabel?: string;
  resolve: (confirmed: boolean) => void;
}

/**
 * Modal dialogs, replacing toasts.
 *
 * A toast that fades can be missed entirely, and the previous implementation
 * was worse than that: it pushed messages into a signal that no component ever
 * rendered, so every error the interceptor reported was invisible.
 *
 * Dialogs queue rather than stack. Two failed requests should not put two
 * overlapping panels on screen — the second waits for the first to be
 * dismissed.
 */
@Injectable({ providedIn: 'root' })
export class DialogService {
  private readonly queue = signal<DialogRequest[]>([]);

  /** The dialog currently on screen, or null. */
  readonly current = signal<DialogRequest | null>(null);

  /** Acknowledge-only. Resolves when dismissed. */
  alert(title: string, message: string, tone: DialogTone = 'info', confirmLabel = 'OK') {
    return this.push({ tone, title, message, confirmLabel });
  }

  success(title: string, message: string) {
    return this.alert(title, message, 'success');
  }

  error(message: string, title = 'Something went wrong') {
    return this.alert(title, message, 'error');
  }

  /** Resolves true if confirmed, false if cancelled or dismissed. */
  confirm(title: string, message: string, confirmLabel = 'Confirm', cancelLabel = 'Cancel') {
    return this.push({ tone: 'warning', title, message, confirmLabel, cancelLabel });
  }

  respond(confirmed: boolean) {
    const active = this.current();
    if (!active) return;
    active.resolve(confirmed);
    this.current.set(null);
    this.advance();
  }

  private push(config: Omit<DialogRequest, 'id' | 'resolve'>): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const request: DialogRequest = { ...config, id: crypto.randomUUID(), resolve };

      // Identical messages queued back to back are almost always one failure
      // reported twice; showing it twice helps nobody.
      const isDuplicate =
        this.current()?.message === request.message ||
        this.queue().some((q) => q.message === request.message);
      if (isDuplicate) {
        resolve(false);
        return;
      }

      this.queue.update((q) => [...q, request]);
      if (!this.current()) this.advance();
    });
  }

  private advance() {
    const [next, ...rest] = this.queue();
    if (!next) return;
    this.queue.set(rest);
    this.current.set(next);
  }
}
