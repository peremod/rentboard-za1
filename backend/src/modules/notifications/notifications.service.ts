import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailCategory } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { Resend } from 'resend';
import { escapeHtml } from '../../common/utils/escape-html.util';

/**
 * All transactional email — 6 templates, matching the room application
 * lifecycle. Inline HTML for maximum email-client compatibility (Gmail/
 * Outlook strip <style> tags in the <head>).
 *
 * SECURITY: every dynamic value below is passed through escapeHtml() at the
 * point of interpolation, no exceptions. These templates are raw HTML
 * strings sent to a recipient's mail client, which renders HTML by default —
 * an unescaped value (a tenant's name, a message preview, a rejection
 * reason) is a direct stored/reflected XSS vector into someone's inbox.
 * This was an open finding until this pass — see PRE-LAUNCH-CHECKLIST.md.
 *
 * Resend free tier: 3,000 emails/month — see Capacity Analysis doc for
 * the upgrade trigger (>2,500/month).
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  /**
   * Null when RESEND_API_KEY is unset. The Resend constructor throws on a
   * missing key, which previously killed application bootstrap entirely —
   * the whole API refused to start just because email was unconfigured.
   * Email is non-essential infrastructure: local development and self-hosted
   * deployments must run without it, degrading to logged no-ops.
   */
  private readonly resend: Resend | null;
  private readonly from: string;
  private readonly frontend: string;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {
    const apiKey = this.config.get<string>('resend.apiKey');
    if (apiKey) {
      this.resend = new Resend(apiKey);
    } else {
      this.resend = null;
      this.logger.warn(
        'RESEND_API_KEY not set — transactional emails will be logged and skipped, not sent. Set it in .env to enable email.',
      );
    }
    this.from = `${this.config.get('resend.fromName')} <${this.config.get('resend.from')}>`;
    this.frontend = this.config.get<string>('frontendUrl')!;
  }

  /** 1. Landlord — new application received. */
  async sendNewApplicationEmail(to: string, d: { landlordName: string; tenantName: string; roomTitle: string; applicationId: string }) {
    const landlordName = escapeHtml(d.landlordName);
    const tenantName = escapeHtml(d.tenantName);
    const roomTitle = escapeHtml(d.roomTitle);
    await this.send(to, `${d.tenantName} applied for your room`, this.wrap(`
      <h1>New application received</h1>
      <p>Hi ${landlordName},</p>
      <p><strong>${tenantName}</strong> has applied for: <strong>${roomTitle}</strong></p>
      <a href="${this.frontend}/landlord/dashboard" class="btn">View application →</a>
      <p class="muted">💡 Landlords who reply within 24 hours receive 3× more applications.</p>
    `),
      { template: 'new_application' },
    );
  }

  /** 2. Tenant — landlord viewed the application. */
  async sendApplicationViewedEmail(to: string, d: { tenantName: string; roomTitle: string; applicationId: string }) {
    const tenantName = escapeHtml(d.tenantName);
    const roomTitle = escapeHtml(d.roomTitle);
    await this.send(to, 'The landlord has viewed your application', this.wrap(`
      <h1>👀 Your application was viewed</h1>
      <p>Hi ${tenantName},</p>
      <p>The landlord has viewed your application for <strong>${roomTitle}</strong>.</p>
      <a href="${this.frontend}/tenant/dashboard" class="btn">View your application →</a>
    `),
      { template: 'application_viewed' },
    );
  }

  /** 3. Tenant — shortlisted. */
  async sendShortlistedEmail(to: string, d: { tenantName: string; roomTitle: string; applicationId: string }) {
    const tenantName = escapeHtml(d.tenantName);
    const roomTitle = escapeHtml(d.roomTitle);
    await this.send(to, "🎉 You've been shortlisted for a room!", this.wrap(`
      <h1>You've been shortlisted!</h1>
      <p>Hi ${tenantName},</p>
      <p>The landlord has shortlisted you for <strong>${roomTitle}</strong>. Message them to arrange a viewing.</p>
      <a href="${this.frontend}/tenant/dashboard" class="btn btn--green">💬 Message the landlord →</a>
    `),
      { template: 'shortlisted' },
    );
  }

  /** 4. Tenant — accepted, with move-in partner offers (broadband/insurance/removals). */
  /**
   * Sent when a room is let to someone else, or otherwise taken off the board,
   * while this tenant's application was still open. Deliberately warm: a
   * rejection with no explanation is the main complaint tenants have about
   * every other letting platform.
   */
  /**
   * "A room matching your saved search just went live." Sent within moments of
   * publication — rooms are often let within days, so timing is the whole
   * value of this alert.
   */
  async sendNewMatchEmail(
    to: string,
    d: { tenantName: string; searchName: string; roomTitle: string; roomId: string; rentCents: number; locationDisplay: string },
  ) {
    const rand = new Intl.NumberFormat('en-ZA', {
      style: 'currency', currency: 'ZAR', maximumFractionDigits: 0,
    }).format(d.rentCents / 100);

    await this.send(
      to,
      `New room in ${d.locationDisplay} — ${rand}/mo`,
      `<p>Hi ${d.tenantName},</p>
       <p>A room matching your saved search <strong>${d.searchName}</strong> has just been listed:</p>
       <p style="font-size:1.1rem"><strong>${d.roomTitle}</strong><br/>
          ${d.locationDisplay} · ${rand}/mo</p>
       <p>Rooms on RentBoard are often taken within days, so it is worth applying early. Applying is free.</p>
       <p><a href="${this.frontend}/rooms/${d.roomId}">View this room</a></p>
       <p style="font-size:.8rem;color:#7A6E60">
         You are receiving this because you saved a search on RentBoard.
         <a href="${this.frontend}/tenant/dashboard">Manage or turn off your alerts</a>.
       </p>`,
      { template: 'new_match', category: 'marketing' },
    );
  }

  /** Daily digest of new rooms matching a saved search. Sent only when there are matches. */
  /**
   * Internal alert for reports that suggest someone is about to lose money.
   * Goes to the safety address published in the disclaimer, so the promise
   * made there is actually wired to something.
   */
  async sendUrgentReportAlert(d: { reportId: string; reason: string; roomId?: string }) {
    await this.send(
      'safety@rentboard.co.za',
      `URGENT report: ${d.reason.replace(/_/g, ' ')}`,
      `<p>A report was filed that matches a money-loss pattern.</p>
       <p><strong>Reason:</strong> ${d.reason.replace(/_/g, ' ')}<br/>
          <strong>Report:</strong> ${d.reportId}<br/>
          ${d.roomId ? `<strong>Listing:</strong> <a href="${this.frontend}/rooms/${d.roomId}">${d.roomId}</a>` : ''}</p>
       <p><a href="${this.frontend}/admin/reports">Open the report queue</a></p>`,
      { template: 'urgent_report_alert' },
    );
  }

  /** Tells an admin an advertiser is asking to buy placement. */
  /**
   * Monthly performance for an advertiser.
   *
   * Sent unprompted. An advertiser who has to ask how their campaign is doing
   * assumes it is doing badly, and a flat monthly rate with no reporting is
   * the thing that makes people cancel.
   *
   * Carries aggregate numbers only — impressions, clicks, click-through rate.
   * Nothing about who saw it, because we do not collect that.
   */
  async sendAdvertiserReport(
    to: string,
    d: {
      companyName: string;
      periodLabel: string;
      campaigns: { name: string; placement: string; impressions: number; clicks: number; ctr: string }[];
    },
  ) {
    const rows = d.campaigns
      .map(
        (c) => `<tr>
            <td style="padding:.4rem .6rem;border-bottom:1px solid #E0D5C4">${c.name}</td>
            <td style="padding:.4rem .6rem;border-bottom:1px solid #E0D5C4">${c.placement}</td>
            <td style="padding:.4rem .6rem;border-bottom:1px solid #E0D5C4;text-align:right">${c.impressions.toLocaleString('en-ZA')}</td>
            <td style="padding:.4rem .6rem;border-bottom:1px solid #E0D5C4;text-align:right">${c.clicks.toLocaleString('en-ZA')}</td>
            <td style="padding:.4rem .6rem;border-bottom:1px solid #E0D5C4;text-align:right">${c.ctr}%</td>
          </tr>`,
      )
      .join('');

    await this.send(
      to,
      `Your RentBoard advertising — ${d.periodLabel}`,
      `<p>Hi ${d.companyName},</p>
       <p>Here's how your advertising performed in ${d.periodLabel}.</p>
       <table style="border-collapse:collapse;width:100%;font-size:.85rem">
         <thead>
           <tr style="text-align:left">
             <th style="padding:.4rem .6rem">Campaign</th>
             <th style="padding:.4rem .6rem">Placement</th>
             <th style="padding:.4rem .6rem;text-align:right">Impressions</th>
             <th style="padding:.4rem .6rem;text-align:right">Clicks</th>
             <th style="padding:.4rem .6rem;text-align:right">CTR</th>
           </tr>
         </thead>
         <tbody>${rows}</tbody>
       </table>
       <p style="font-size:.8rem;color:#7A6E60;margin-top:1.25rem">
         These are aggregate counts. RentBoard does not track individual visitors,
         so we cannot tell you who saw your ad — and neither can anyone else.
       </p>
       <p>Reply to this email if you want to change targeting, pause, or extend.</p>`,
      { template: 'advertiser_report' },
    );
  }

  async sendAdEnquiryAlert(d: {
    companyName: string; contactName: string; contactEmail: string;
    industry?: string; province?: string; message: string;
  }) {
    const to = this.config.get<string>('adminAlertEmail') ?? this.config.get<string>('resend.from')!;
    await this.send(
      to,
      `Advertising enquiry — ${d.companyName}`,
      `<p><strong>${d.companyName}</strong> wants to advertise on RentBoard.</p>
       <p>
         Contact: ${d.contactName} &lt;${d.contactEmail}&gt;<br/>
         ${d.industry ? `Industry: ${d.industry}<br/>` : ''}
         ${d.province ? `Interested in: ${d.province}<br/>` : ''}
       </p>
       <p><em>${d.message}</em></p>
       <p><a href="${this.frontend}/admin/enquiries">Open the enquiry queue</a></p>`,
      { template: 'ad_enquiry_alert' },
    );
  }

  /**
   * Sign-in link. Deliberately plain: a short email with one obvious action,
   * because these are opened on a phone by someone who just wants back in.
   */
  async sendMagicLinkEmail(to: string, d: { fullName: string; token: string; ttlMinutes: number }) {
    const link = `${this.frontend}/auth/magic?token=${encodeURIComponent(d.token)}`;
    await this.send(
      to,
      'Your RentBoard sign-in link',
      `<p>Hi ${d.fullName},</p>
       <p>Tap below to sign in. No password needed.</p>
       <p style="margin:1.5rem 0">
         <a href="${link}" style="background:#C04E28;color:#fff;padding:.75rem 1.5rem;
            border-radius:6px;text-decoration:none;font-weight:700">Sign in to RentBoard</a>
       </p>
       <p style="font-size:.8rem;color:#7A6E60">
         This link works once and expires in ${d.ttlMinutes} minutes. If you did not
         ask for it, you can ignore this email — nobody can get into your account
         without it.
       </p>`,
      { template: 'magic_link' },
    );
  }

  /** Sent when a sign-in link is requested for an address with no account. */
  async sendNoAccountEmail(to: string, d: { role: 'TENANT' | 'LANDLORD' }) {
    const url = `${this.frontend}/auth/register?role=${d.role.toLowerCase()}`;
    await this.send(
      to,
      'No RentBoard account for this address',
      `<p>Someone asked for a sign-in link for this address, but there is no
          RentBoard account attached to it.</p>
       <p>If that was you, you can create one — it takes a minute and is free.</p>
       <p><a href="${url}">Create an account</a></p>
       <p style="font-size:.8rem;color:#7A6E60">If it was not you, ignore this email.</p>`,
      { template: 'no_account' },
    );
  }

  async sendPasswordResetEmail(to: string, d: { fullName: string; token: string; ttlMinutes: number }) {
    const link = `${this.frontend}/auth/reset-password?token=${encodeURIComponent(d.token)}`;
    await this.send(
      to,
      'Reset your RentBoard password',
      `<p>Hi ${d.fullName},</p>
       <p>Use the link below to set a new password. It works once and expires in ${d.ttlMinutes} minutes.</p>
       <p><a href="${link}">Set a new password</a></p>
       <p>If you did not ask for this, you can ignore this email — your password has not changed.</p>`,
      { template: 'password_reset' },
    );
  }

  /** Sent when a Google-only account asks for a password reset. */
  async sendGoogleOnlyAccountEmail(to: string, d: { fullName: string }) {
    await this.send(
      to,
      'About your RentBoard sign-in',
      `<p>Hi ${d.fullName},</p>
       <p>Someone asked to reset the password for this address, but your account signs in with Google,
       so there is no password to reset.</p>
       <p><a href="${this.frontend}/auth/login">Continue with Google</a></p>`,
      { template: 'google_only_account' },
    );
  }

  /** Security notice — the point is that an unexpected one is a warning. */
  async sendPasswordChangedEmail(to: string, d: { fullName: string }) {
    await this.send(
      to,
      'Your RentBoard password was changed',
      `<p>Hi ${d.fullName},</p>
       <p>Your password was changed just now.</p>
       <p><strong>If this was not you</strong>, reset your password immediately and contact
       support&#64;rentboard.co.za.</p>`,
      { template: 'password_changed' },
    );
  }

  async sendEmailChangeConfirmation(to: string, d: { fullName: string; token: string }) {
    const link = `${this.frontend}/auth/confirm-email?token=${encodeURIComponent(d.token)}`;
    await this.send(
      to,
      'Confirm your new RentBoard email address',
      `<p>Hi ${d.fullName},</p>
       <p>Confirm this address to finish moving your RentBoard account to it. The link expires in an hour.</p>
       <p><a href="${link}">Confirm this address</a></p>`,
      { template: 'change_confirmation' },
    );
  }

  /** Sent to the OLD address, so a takeover cannot move an account silently. */
  async sendEmailChangeAlert(to: string, d: { fullName: string; newEmail: string }) {
    await this.send(
      to,
      'Someone asked to change your RentBoard email',
      `<p>Hi ${d.fullName},</p>
       <p>A request was made to move this account to <strong>${d.newEmail}</strong>. It only takes effect
       once that address is confirmed.</p>
       <p><strong>If this was not you</strong>, change your password now and contact
       support&#64;rentboard.co.za — someone may have access to your account.</p>`,
      { template: 'change_alert' },
    );
  }

  async sendDailyDigestEmail(
    to: string,
    d: { tenantName: string; searchName: string; rooms: { id: string; title: string; rentCents: number; locationDisplay: string }[] },
  ) {
    const zar = (cents: number) =>
      new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(cents / 100);

    const rows = d.rooms
      .map(
        (r) => `<li style="margin-bottom:.6rem">
            <a href="${this.frontend}/rooms/${r.id}"><strong>${r.title}</strong></a><br/>
            ${r.locationDisplay} · ${zar(r.rentCents)}/mo
          </li>`,
      )
      .join('');

    await this.send(
      to,
      `${d.rooms.length} new room${d.rooms.length === 1 ? '' : 's'} matching "${d.searchName}"`,
      `<p>Hi ${d.tenantName},</p>
       <p>New rooms matching your saved search <strong>${d.searchName}</strong>:</p>
       <ul style="padding-left:1.1rem">${rows}</ul>
       <p>Applying is free, and rooms are often taken within days.</p>
       <p style="font-size:.8rem;color:#7A6E60">
         <a href="${this.frontend}/tenant/dashboard">Manage or turn off these alerts</a>.
       </p>`,
      { template: 'daily_digest', category: 'marketing' },
    );
  }

  /**
   * Tells someone a room they saved is gone.
   *
   * They never applied, so nothing else would tell them — the room simply
   * stops being there. Sent once per room, and framed as useful rather than
   * apologetic: the point is to get them looking again while they are still
   * looking.
   */
  async sendSavedRoomGoneEmail(
    to: string,
    d: { tenantName: string; roomTitle: string; locationDisplay: string; reason: 'let' | 'removed' },
  ) {
    const what = d.reason === 'let'
      ? 'has been let to someone else'
      : 'has been taken down by the landlord';

    await this.send(
      to,
      `${d.roomTitle} is no longer available`,
      `<p>Hi ${d.tenantName},</p>
       <p>A room you saved — <strong>${d.roomTitle}</strong> in ${d.locationDisplay} —
       ${what}.</p>
       <p>Rooms move quickly here. If you have not already, saving a search means
       we can tell you the moment something similar is posted, rather than you
       checking back.</p>
       <p><a href="${this.frontend}/">Browse rooms</a> ·
          <a href="${this.frontend}/tenant/dashboard">Set up an alert</a></p>`,
      { template: 'saved_room_gone' },
    );
  }

  /**
   * Tells open applicants the rent changed.
   *
   * Someone waiting on a decision has effectively made an offer at the old
   * price. Changing it silently means they could be accepted into a tenancy
   * they never agreed to, which is the kind of thing that ends in a Rental
   * Housing Tribunal complaint.
   */
  async sendRentChangedEmail(
    to: string,
    d: { tenantName: string; roomTitle: string; roomId: string; oldRentCents: number; newRentCents: number },
  ) {
    const zar = (cents: number) =>
      new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 })
        .format(cents / 100);

    const direction = d.newRentCents > d.oldRentCents ? 'increased' : 'decreased';

    await this.send(
      to,
      `Rent changed on ${d.roomTitle}`,
      `<p>Hi ${d.tenantName},</p>
       <p>The landlord has ${direction} the rent on <strong>${d.roomTitle}</strong>,
       which you have applied for.</p>
       <p style="font-size:1.05rem">
         <s style="color:#7A6E60">${zar(d.oldRentCents)}</s> →
         <strong>${zar(d.newRentCents)}</strong> per month
       </p>
       <p>Your application is still open. If the new rent does not work for you,
       you can withdraw it from your dashboard — no explanation needed.</p>
       <p><a href="${this.frontend}/rooms/${d.roomId}">View the room</a> ·
          <a href="${this.frontend}/tenant/dashboard">Your applications</a></p>`,
      { template: 'rent_changed' },
    );
  }

  async sendRoomUnavailableEmail(to: string, d: { tenantName: string; roomTitle: string }) {
    await this.send(
      to,
      `Update on your application — ${d.roomTitle}`,
      `<p>Hi ${d.tenantName},</p>
       <p>The landlord has let <strong>${d.roomTitle}</strong>, so your application has been closed.
       It wasn't a reflection on you — the room simply went to someone who applied around the same time.</p>
       <p>There are other rooms on the board, and applying is always free.</p>
       <p><a href="${this.frontend}">Browse rooms on RentBoard</a></p>
       <p>— The RentBoard team</p>`,
      { template: 'room_unavailable' },
    );
  }

  async sendAcceptedEmail(to: string, d: { tenantName: string; roomTitle: string; rentCents: number; city: string }) {
    const tenantName = escapeHtml(d.tenantName);
    const roomTitle = escapeHtml(d.roomTitle);
    const city = escapeHtml(d.city);
    const rand = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(d.rentCents / 100);
    await this.send(to, "✅ Congratulations — you've got the room!", this.wrap(`
      <h1>You've got the room! 🏠</h1>
      <p>Hi ${tenantName},</p>
      <p>Congratulations! The landlord accepted your application for <strong>${roomTitle}</strong> at <strong>${rand}/mo</strong>.</p>
      <div class="box">
        <p style="font-weight:700;margin-bottom:10px">Moving to ${city} — your checklist</p>
        <p>📶 Set up broadband · 🛡️ Contents insurance · 🚛 Book a removal van</p>
        <p class="muted">Compare partner offers from your dashboard.</p>
      </div>
    `),
      { template: 'accepted' },
    );
  }

  /** 5. Tenant — kind rejection with a link back to similar rooms. */
  async sendRejectionEmail(to: string, d: { tenantName: string; roomTitle: string; reason?: string; searchUrl: string }) {
    const tenantName = escapeHtml(d.tenantName);
    const roomTitle = escapeHtml(d.roomTitle);
    const reason = d.reason ? escapeHtml(d.reason) : undefined;
    await this.send(to, `Update on your application for ${d.roomTitle}`, this.wrap(`
      <h1>Update on your application</h1>
      <p>Hi ${tenantName},</p>
      <p>Unfortunately the landlord has chosen another applicant for <strong>${roomTitle}</strong>. This is common and isn't a reflection on your application.</p>
      ${reason ? `<p class="quote">"${reason}"</p>` : ''}
      <a href="${d.searchUrl}" class="btn">Browse similar rooms →</a>
    `),
      { template: 'rejection' },
    );
  }

  /** 6. Both directions — new in-platform message. */
  async sendNewMessageEmail(to: string, d: { recipientName: string; senderName: string; messagePreview: string; messagesUrl: string }) {
    const recipientName = escapeHtml(d.recipientName);
    const senderName = escapeHtml(d.senderName);
    const messagePreview = escapeHtml(d.messagePreview);
    await this.send(to, `💬 ${d.senderName} sent you a message`, this.wrap(`
      <h1>New message from ${senderName}</h1>
      <p>Hi ${recipientName},</p>
      <div class="quote">"${messagePreview}"</div>
      <a href="${d.messagesUrl}" class="btn">Reply →</a>
    `),
      { template: 'new_message' },
    );
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

  /**
   * The single path every email goes through.
   *
   * Order matters: suppression is checked before consent, and consent before
   * sending, because a suppressed address must not be mailed even if the
   * person is opted in — a hard bounce means the address does not work, and
   * continuing to send is what gets a domain blacklisted.
   *
   * Never throws. An email failure must not fail the business operation that
   * triggered it: a landlord's room still gets let if the notification bounces.
   */
  private async send(
    to: string,
    subject: string,
    html: string,
    opts: { template: string; category?: EmailCategory } = { template: 'unknown' },
  ) {
    const category = opts.category ?? 'transactional';
    const recipient = to.trim().toLowerCase();

    const log = await this.prisma.emailLog
      .create({
        data: { toEmail: recipient, subject, template: opts.template, category, status: 'queued' },
      })
      .catch(() => null);

    const finish = (data: Record<string, unknown>) =>
      log ? this.prisma.emailLog.update({ where: { id: log.id }, data }).catch(() => {}) : Promise.resolve();

    // 1. Suppressed addresses are never contacted again, for any reason.
    const suppressed = await this.prisma.emailSuppression
      .findUnique({ where: { email: recipient } })
      .catch(() => null);
    if (suppressed) {
      this.logger.warn(`Suppressed (${suppressed.reason}): ${recipient} — ${subject}`);
      await finish({ status: 'suppressed', error: `suppressed: ${suppressed.reason}` });
      return;
    }

    // 2. Marketing needs consent. Transactional mail is part of the service.
    if (category === 'marketing') {
      const user = await this.prisma.user
        .findUnique({ where: { email: recipient }, select: { id: true, marketingEmails: true } })
        .catch(() => null);
      if (user && !user.marketingEmails) {
        await finish({ status: 'suppressed', userId: user.id, error: 'marketing opted out' });
        return;
      }
      if (user) await finish({ userId: user.id });
    }

    if (!this.resend) {
      this.logger.log(`[email skipped — no API key] ${recipient}: ${subject}`);
      await finish({ status: 'failed', error: 'RESEND_API_KEY not configured' });
      return;
    }

    try {
      const result = await this.resend.emails.send({
        from: this.from,
        to: recipient,
        subject,
        html: category === 'marketing' ? this.withUnsubscribeFooter(html, recipient) : html,
      });
      await finish({ status: 'sent', sentAt: new Date(), providerId: result?.data?.id ?? null });
      this.logger.log(`Sent ${opts.template} to ${recipient}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to send ${opts.template} to ${recipient}: ${message}`);
      await finish({ status: 'failed', error: message.slice(0, 500) });
    }
  }

  /**
   * POPIA s.69 requires every marketing message to identify the sender and
   * offer a way out. Appended centrally so a new template cannot forget it.
   */
  private withUnsubscribeFooter(html: string, recipient: string): string {
    const link = `${this.frontend}/account/settings`;
    return `${html}
      <hr style="border:none;border-top:1px solid #E0D5C4;margin:1.5rem 0"/>
      <p style="font-size:.75rem;color:#7A6E60;line-height:1.6">
        Sent to ${recipient} because you asked RentBoard to alert you about rooms.
        <a href="${link}">Manage or stop these emails</a>.<br/>
        RentBoard, South Africa.
      </p>`;
  }
}
