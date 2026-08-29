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
