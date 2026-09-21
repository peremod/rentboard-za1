import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '@env/environment';

export interface PayfastSession {
  paymentId: string;
  /** PayFast's process endpoint — sandbox or live, decided server-side. */
  processUrl: string;
  /** Signed fields. Rendered as a hidden form and submitted. */
  fields: Record<string, string>;
}

export interface PaymentRecord {
  id: string;
  purpose: string;
  amountCents: number;
  status: 'pending' | 'paid' | 'failed' | 'cancelled' | 'refunded';
  paidAt?: string | null;
  refundedAt?: string | null;
  merchantReference: string;
  createdAt: string;
}

/**
 * A fee we owe back and have not yet returned.
 *
 * PayFast refunds are issued from their dashboard rather than by API, so this
 * is a worklist: move the money there, then record it here.
 */
export interface RefundDue {
  id: string;
  amountCents: number;
  merchantReference: string;
  providerReference?: string | null;
  refundDueAt: string;
  paidAt?: string | null;
  referenceId?: string | null;
  user: { id: string; fullName: string; email: string };
}

@Injectable({ providedIn: 'root' })
export class PaymentsService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  startVerificationPayment(verificationRequestId: string) {
    return this.http.post<PayfastSession>(
      `${this.api}/payments/verification/${verificationRequestId}`,
      {},
    );
  }

  listMine() {
    return this.http.get<PaymentRecord[]>(`${this.api}/payments/mine`);
  }

  /** Admin only. Every rejected check whose fee has not gone back yet. */
  refundsDue() {
    return this.http.get<RefundDue[]>(`${this.api}/payments/refunds-due`);
  }

  /** Admin only. Records money already moved in the PayFast dashboard. */
  recordRefund(paymentId: string, reason: string) {
    return this.http.patch<PaymentRecord>(`${this.api}/payments/${paymentId}/refund`, { reason });
  }

  /**
   * PayFast has no client SDK — payment is a signed form POST. Building and
   * submitting it here keeps the signed fields out of the URL, where they
   * would end up in browser history and server logs.
   */
  redirectToPayfast(session: PayfastSession) {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = session.processUrl;
    form.style.display = 'none';

    for (const [name, value] of Object.entries(session.fields)) {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = value;
      form.appendChild(input);
    }

    document.body.appendChild(form);
    form.submit();
  }
}
