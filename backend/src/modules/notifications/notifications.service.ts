import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

/**
 * All transactional email — 6 templates, matching the room application
 * lifecycle. Inline HTML for maximum email-client compatibility (Gmail/
 * Outlook strip <style> tags in the <head>).
 *
 * Resend free tier: 3,000 emails/month — see Capacity Analysis doc for
 * the upgrade trigger (>2,500/month).
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly resend: Resend;
  private readonly from: string;
  private readonly frontend: string;

  constructor(private config: ConfigService) {
    this.resend = new Resend(this.config.get<string>('resend.apiKey'));
    this.from = `${this.config.get('resend.fromName')} <${this.config.get('resend.from')}>`;
    this.frontend = this.config.get<string>('frontendUrl')!;
  }

  /** 1. Landlord — new application received. */
  async sendNewApplicationEmail(to: string, d: { landlordName: string; tenantName: string; roomTitle: string; applicationId: string }) {
    await this.send(to, `${d.tenantName} applied for your room`, this.wrap(`
      <h1>New application received</h1>
      <p>Hi ${d.landlordName},</p>
      <p><strong>${d.tenantName}</strong> has applied for: <strong>${d.roomTitle}</strong></p>
      <a href="${this.frontend}/landlord/dashboard" class="btn">View application →</a>
      <p class="muted">💡 Landlords who reply within 24 hours receive 3× more applications.</p>
    `));
  }

  /** 2. Tenant — landlord viewed the application. */
  async sendApplicationViewedEmail(to: string, d: { tenantName: string; roomTitle: string; applicationId: string }) {
    await this.send(to, 'The landlord has viewed your application', this.wrap(`
      <h1>👀 Your application was viewed</h1>
      <p>Hi ${d.tenantName},</p>
      <p>The landlord has viewed your application for <strong>${d.roomTitle}</strong>.</p>
      <a href="${this.frontend}/tenant/dashboard" class="btn">View your application →</a>
    `));
  }

  /** 3. Tenant — shortlisted. */
  async sendShortlistedEmail(to: string, d: { tenantName: string; roomTitle: string; applicationId: string }) {
    await this.send(to, "🎉 You've been shortlisted for a room!", this.wrap(`
      <h1>You've been shortlisted!</h1>
      <p>Hi ${d.tenantName},</p>
      <p>The landlord has shortlisted you for <strong>${d.roomTitle}</strong>. Message them to arrange a viewing.</p>
      <a href="${this.frontend}/tenant/dashboard" class="btn btn--green">💬 Message the landlord →</a>
    `));
  }

  /** 4. Tenant — accepted, with move-in partner offers (broadband/insurance/removals). */
  async sendAcceptedEmail(to: string, d: { tenantName: string; roomTitle: string; rentCents: number; city: string }) {
    const rand = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(d.rentCents / 100);
    await this.send(to, "✅ Congratulations — you've got the room!", this.wrap(`
      <h1>You've got the room! 🏠</h1>
      <p>Hi ${d.tenantName},</p>
      <p>Congratulations! The landlord accepted your application for <strong>${d.roomTitle}</strong> at <strong>${rand}/mo</strong>.</p>
      <div class="box">
        <p style="font-weight:700;margin-bottom:10px">Moving to ${d.city} — your checklist</p>
        <p>📶 Set up broadband · 🛡️ Contents insurance · 🚛 Book a removal van</p>
        <p class="muted">Compare partner offers from your dashboard.</p>
      </div>
    `));
  }

  /** 5. Tenant — kind rejection with a link back to similar rooms. */
  async sendRejectionEmail(to: string, d: { tenantName: string; roomTitle: string; reason?: string; searchUrl: string }) {
    await this.send(to, `Update on your application for ${d.roomTitle}`, this.wrap(`
      <h1>Update on your application</h1>
      <p>Hi ${d.tenantName},</p>
      <p>Unfortunately the landlord has chosen another applicant for <strong>${d.roomTitle}</strong>. This is common and isn't a reflection on your application.</p>
      ${d.reason ? `<p class="quote">"${d.reason}"</p>` : ''}
      <a href="${d.searchUrl}" class="btn">Browse similar rooms →</a>
    `));
  }

  /** 6. Both directions — new in-platform message. */
  async sendNewMessageEmail(to: string, d: { recipientName: string; senderName: string; messagePreview: string; messagesUrl: string }) {
    await this.send(to, `💬 ${d.senderName} sent you a message`, this.wrap(`
      <h1>New message from ${d.senderName}</h1>
      <p>Hi ${d.recipientName},</p>
      <div class="quote">"${d.messagePreview}"</div>
      <a href="${d.messagesUrl}" class="btn">Reply →</a>
    `));
  }

  private wrap(content: string): string {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
      <style>
        body{font-family:sans-serif;background:#F5F0E8;margin:0;padding:0}
        .wrap{max-width:560px;margin:0 auto;background:#FDFAF5;border-radius:10px;overflow:hidden;border:1px solid #DDD5C8}
        .header{background:#1A1410;padding:20px 24px}
        .header h2{color:#F5F0E8;margin:0;font-size:22px}
        .header span{color:#C04E28}
        .body{padding:28px 24px;color:#1A1410}
        h1{font-size:22px;margin:0 0 12px}
        p{font-size:15px;line-height:1.6;margin:0 0 12px}
        .btn{display:inline-block;background:#C04E28;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:700;margin-top:8px}
        .btn--green{background:#3D7040}
        .box{background:#fff;border:1px solid #DDD5C8;border-radius:8px;padding:16px;margin:16px 0}
        .quote{font-style:italic;color:#7A6E60;border-left:3px solid #DDD5C8;padding-left:12px;margin:12px 0}
        .muted{font-size:13px;color:#7A6E60}
        .footer{background:#F5F0E8;padding:16px 24px;border-top:1px solid #DDD5C8;font-size:12px;color:#7A6E60}
      </style></head>
      <body><div style="padding:32px 16px"><div class="wrap">
        <div class="header"><h2>Rent<span>Board</span></h2></div>
        <div class="body">${content}</div>
        <div class="footer">© ${new Date().getFullYear()} RentBoard — direct from landlords, no agent fees.</div>
      </div></div></body></html>`;
  }

  private async send(to: string, subject: string, html: string) {
    try {
      await this.resend.emails.send({ from: this.from, to, subject, html });
      this.logger.log(`Email sent to ${to}: ${subject}`);
    } catch (err) {
      this.logger.error(`Failed to send email to ${to}`, err as Error);
      // Never throw — email failure must not fail the calling business operation.
    }
  }
}
