import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * PayFast integration.
 *
 * PayFast is a redirect-and-notify gateway, not an API: we build a signed form,
 * the browser POSTs it to PayFast, the user pays, and PayFast calls our ITN
 * endpoint server-to-server. The ITN is the source of truth — the browser
 * return URL proves nothing, since a user can close the tab or forge a visit.
 *
 * The signature rules are fiddly and version-specific. Two things trip people
 * up and are handled explicitly here:
 *   - parameters are hashed in the order they appear in the form, NOT sorted
 *   - urlencoding must use uppercase hex and encode spaces as '+'
 */
@Injectable()
export class PayfastService {
  private readonly logger = new Logger(PayfastService.name);

  constructor(private config: ConfigService) {}

  private get merchantId() { return this.config.get<string>('payfast.merchantId') ?? ''; }
  private get merchantKey() { return this.config.get<string>('payfast.merchantKey') ?? ''; }
  private get passphrase() { return this.config.get<string>('payfast.passphrase') ?? ''; }
  private get sandbox() { return this.config.get<boolean>('payfast.sandbox') ?? true; }

  get isConfigured(): boolean {
    return Boolean(this.merchantId && this.merchantKey);
  }

  get processUrl(): string {
    return this.sandbox
      ? 'https://sandbox.payfast.co.za/eng/process'
      : 'https://www.payfast.co.za/eng/process';
  }

  private get validateUrl(): string {
    return this.sandbox
      ? 'https://sandbox.payfast.co.za/eng/query/validate'
      : 'https://www.payfast.co.za/eng/query/validate';
  }

  /**
   * PayFast's encoding: uppercase percent-encoding, spaces as '+'.
   * encodeURIComponent alone produces lowercase hex and %20, both of which
   * produce a signature mismatch.
   */
  private encode(value: string): string {
    return encodeURIComponent(value.trim())
      .replace(/%20/g, '+')
      .replace(/%[0-9a-f]{2}/g, (m) => m.toUpperCase());
  }

  /** Hashed in insertion order — sorting the keys will not validate. */
  private signature(fields: Record<string, string>): string {
    const query = Object.entries(fields)
      .filter(([, v]) => v !== '' && v !== undefined && v !== null)
      .map(([k, v]) => `${k}=${this.encode(v)}`)
      .join('&');

    const withPass = this.passphrase
      ? `${query}&passphrase=${this.encode(this.passphrase)}`
      : query;

    return crypto.createHash('md5').update(withPass).digest('hex');
  }

  /**
   * The fields to POST. Field order here is the signature order, so do not
   * reorder without regenerating the hash.
   */
  buildPaymentFields(params: {
    merchantReference: string;
    amountCents: number;
    itemName: string;
    itemDescription?: string;
    buyerEmail: string;
    buyerFirstName?: string;
    returnUrl: string;
    cancelUrl: string;
    notifyUrl: string;
  }): Record<string, string> {
    const fields: Record<string, string> = {
      merchant_id: this.merchantId,
      merchant_key: this.merchantKey,
      return_url: params.returnUrl,
      cancel_url: params.cancelUrl,
      notify_url: params.notifyUrl,
      name_first: params.buyerFirstName ?? '',
      email_address: params.buyerEmail,
      m_payment_id: params.merchantReference,
      // PayFast expects Rand with exactly two decimals, not cents.
      amount: (params.amountCents / 100).toFixed(2),
      item_name: params.itemName,
      item_description: params.itemDescription ?? '',
    };

    // Strip empties before signing; PayFast excludes them from the hash.
    const populated = Object.fromEntries(
      Object.entries(fields).filter(([, v]) => v !== ''),
    ) as Record<string, string>;

    return { ...populated, signature: this.signature(populated) };
  }

  /**
   * Validate an ITN. All four checks are required — PayFast's own guidance is
   * explicit that signature alone is not sufficient.
   */
  async validateItn(
    payload: Record<string, string>,
    sourceIp: string | undefined,
    expectedAmountCents: number,
  ): Promise<{ valid: boolean; reason?: string }> {
    // 1. Signature over everything except the signature itself, in received order.
    const { signature, ...rest } = payload;
    if (!signature) return { valid: false, reason: 'missing signature' };
    if (this.signature(rest) !== signature) {
      return { valid: false, reason: 'signature mismatch' };
    }

    // 2. Amount. Guards against a tampered form offering to pay R1.
    const paid = Math.round(parseFloat(payload.amount_gross ?? '0') * 100);
    if (paid !== expectedAmountCents) {
      return { valid: false, reason: `amount mismatch: expected ${expectedAmountCents}, got ${paid}` };
    }

    // 3. Source. A soft check — PayFast's ranges change, so a failure is
    //    logged rather than fatal, with the server confirmation below as the
    //    real defence.
    if (sourceIp && !(await this.isPayfastIp(sourceIp))) {
      this.logger.warn(`ITN from unrecognised IP ${sourceIp} — relying on server confirmation`);
    }

    // 4. Server confirmation: post it all back and let PayFast confirm it sent
    //    it. This is what makes a forged ITN useless.
    const confirmed = await this.confirmWithPayfast(payload);
    if (!confirmed) return { valid: false, reason: 'PayFast did not confirm this notification' };

    return { valid: true };
  }

  private async confirmWithPayfast(payload: Record<string, string>): Promise<boolean> {
    try {
      const body = new URLSearchParams(payload).toString();
      const res = await fetch(this.validateUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      const text = (await res.text()).trim();
      return text === 'VALID';
    } catch (err) {
      this.logger.error('Could not reach PayFast for ITN confirmation', err as Error);
      return false;
    }
  }

  private async isPayfastIp(ip: string): Promise<boolean> {
    // Resolved rather than hardcoded: PayFast's published ranges have changed.
    const hosts = ['www.payfast.co.za', 'sandbox.payfast.co.za', 'w1w.payfast.co.za', 'w2w.payfast.co.za'];
    try {
      const dns = await import('node:dns/promises');
      const results = await Promise.all(
        hosts.map((h) => dns.resolve4(h).catch(() => [] as string[])),
      );
      return results.flat().includes(ip.replace('::ffff:', ''));
    } catch {
      return false;
    }
  }
}
