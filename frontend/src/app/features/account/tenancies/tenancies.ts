import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TenancyArchiveService } from '../../../core/services/tenancy-archive.service';
import { ArchiveListRow, ArchiveRecord } from '../../../core/models/tenancy-archive.model';
import { ZarCentsPipe } from '../../../shared/pipes/zar-cents.pipe';
import { ScreenHint } from '../../../shared/components/screen-hint/screen-hint';

/**
 * Lettings that are over — Phase F.
 *
 * ── Why this screen exists
 *
 * Everything it shows was already in the database and none of it was on a
 * screen. `RentPeriod`, `Review`, `TenancyFlag` and `LeaseDocument` all key on
 * `tenancyId`, so three lettings for one tenant could never bleed into each
 * other — but the only two places that read a tenancy were the tenant's rent
 * screen and the landlord's property screen, and both asked for live ones.
 *
 * So `/legal/paia` told the public this platform holds "tenancy history and
 * rent records" with nothing behind it. Phases D and E fixed the two live
 * screens. This is the record.
 *
 * ── Why /account and not /tenant or /landlord
 *
 * The same reason `/account/messages` is there: a person can be the landlord
 * of one room and the tenant of another, and their history is ONE list. A
 * sub-lessor is both by definition (Phase 6), which in this market is not a
 * corner case. Splitting the list by role would split one person's past by a
 * distinction they do not have.
 *
 * ── What it is not
 *
 * Not a resurrection. No "message your old landlord", no relist shortcut, no
 * rent toggle. Both parties were there, so both may read; neither may now
 * change what happened.
 *
 * The one write that belongs on a finished letting lives elsewhere, on the
 * rent screen: a tenant may still answer a month marked unpaid after they have
 * gone, because that is the mark that matters most and `TenancyFlag.unpaid_rent`
 * can rest on it. "Read-only" is the wrong word for this; "bounded" is right.
 *
 * ── The permission rules are not uniform, and must not be made uniform
 *
 * Each is enforced server-side in `TenancyArchiveService` with its reasoning
 * beside it. This screen renders what it is given and never widens it:
 * published reviews only, your own reports only, no landlord notes at all.
 */
@Component({
  selector: 'app-account-tenancies',
  standalone: true,
  imports: [DatePipe, RouterLink, ZarCentsPipe, ScreenHint],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-screen-hint key="account-tenancies" heading="Everywhere you have let or rented">
      Kept as a record. Rent months, paperwork, reviews and anything you reported stay here after a letting ends — nothing on this screen is waiting on you, and nothing here can be changed.
    </app-screen-hint>

    @if (loading()) {
      <p class="muted">Loading…</p>
    } @else if (error()) {
      <div class="field-error" role="alert">{{ error() }}</div>
    } @else if (!rows().length) {
      <div class="empty-state">
        <h2>Nothing here yet</h2>
        <p class="muted">
          When a letting ends — whether you were the landlord or the tenant —
          its record appears here: the months of rent, the paperwork, and the
          reviews once both sides have written one.
        </p>
      </div>
    } @else {
      <section class="dash-section">
        <h2 class="dash-section-title">
          Past lettings
          <span class="dash-count">{{ rows().length }}</span>
        </h2>
        <p class="muted">Newest first. Open one for the whole record.</p>

        <ul class="arc-list">
          @for (r of rows(); track r.id) {
            <li class="arc-row" [class.arc-row--open]="openId() === r.id">
              <button type="button" class="arc-row__head"
                      [attr.aria-expanded]="openId() === r.id"
                      (click)="toggle(r)">
                <span class="arc-row__title">{{ r.room?.title || 'A room' }}</span>
                <span class="arc-row__meta">
                  <span class="arc-row__badge"
                        [class.arc-row__badge--fell]="r.status === 'cancelled'">
                    {{ r.status === 'cancelled' ? 'Never started' : 'Past letting' }}
                  </span>
                  <!-- Which side they were, and who the other person was. On a
                       screen that mixes both roles this is the first thing a
                       reader needs. -->
                  <span>
                    {{ r.role === 'landlord' ? 'You let it to' : 'You rented from' }}
                    {{ r.otherParty?.fullName || 'a former user' }}
                  </span>
                  @if (r.startDate && r.endDate) {
                    <span>{{ r.startDate | date: 'MMM yyyy' }} – {{ r.endDate | date: 'MMM yyyy' }}</span>
                  } @else if (r.endDate) {
                    <span>ended {{ r.endDate | date: 'MMM yyyy' }}</span>
                  }
                  @if (r.status !== 'cancelled') {
                    <span>{{ r.rentCents | zarCents }} a month</span>
                  }
                  @if (r.reviewsOpen) {
                    <span class="arc-row__review">Reviews still open</span>
                  }
                </span>
              </button>

              @if (openId() === r.id) {
                @if (record(); as rec) {
                  <div class="arc-detail">
                    <!-- ── How it began and how it ended ───────────────── -->
                    <h3 class="arc-detail__h">The letting</h3>
                    <dl class="arc-facts">
                      @if (rec.tenancy.room?.locationDisplay) {
                        <dt>Where</dt><dd>{{ rec.tenancy.room?.locationDisplay }}</dd>
                      }
                      @if (rec.tenancy.startDate) {
                        <dt>Moved in</dt><dd>{{ rec.tenancy.startDate | date: 'd MMMM yyyy' }}</dd>
                      }
                      @if (rec.tenancy.endDate) {
                        <dt>{{ rec.tenancy.status === 'cancelled' ? 'Called off' : 'Moved out' }}</dt>
                        <dd>
                          {{ rec.tenancy.endDate | date: 'd MMMM yyyy' }}
                          @if (rec.tenancy.endedBy) {
                            — {{ rec.tenancy.endedBy === 'you' ? 'you recorded it' : 'they recorded it' }}
                          }
                        </dd>
                      }
                      @if (rec.tenancy.endReason) {
                        <dt>Reason given</dt><dd>{{ rec.tenancy.endReason }}</dd>
                      }
                      @if (rec.tenancy.noticeGivenAt) {
                        <dt>Notice</dt>
                        <dd>
                          given {{ rec.tenancy.noticeGivenAt | date: 'd MMM yyyy' }}
                          by {{ rec.tenancy.noticeGivenBy === 'you' ? 'you' : 'them' }},
                          {{ rec.tenancy.noticePeriodDays }} days
                        </dd>
                      }
                      @if (rec.tenancy.status !== 'cancelled') {
                        <dt>Rent</dt><dd>{{ rec.tenancy.rentCents | zarCents }} a month</dd>
                      }
                    </dl>

                    <!-- ── Rent ─────────────────────────────────────────── -->
                    @if (rec.rent.periods.length) {
                      <h3 class="arc-detail__h">
                        Rent
                        <span class="dash-count">{{ rentSummary(rec) }}</span>
                      </h3>
                      <!-- Chronological, oldest first: this is a record being
                           read rather than a queue being worked, and a person
                           checking what they paid reads down the months. -->
                      <ul class="arc-months">
                        @for (p of rec.rent.periods; track p.id) {
                          <li class="arc-month">
                            <span class="arc-month__when">{{ p.periodStart | date: 'MMM yyyy' }}</span>
                            <span class="arc-month__amount">{{ p.amountCents | zarCents }}</span>
                            <span class="app-status" [class]="'app-status status-' + p.status">
                              {{ rentLabel(p.status) }}
                            </span>
                            @if (p.tenantDisputedAt) {
                              <span class="arc-month__answer">
                                The tenant said this was wrong on
                                {{ p.tenantDisputedAt | date: 'd MMM yyyy' }}@if (p.tenantNote) {: “{{ p.tenantNote }}”}
                              </span>
                            }
                          </li>
                        }
                      </ul>
                      <p class="muted arc-note">
                        This was the landlord's own record. Mastande never held
                        the rent and never checked any of it.
                      </p>
                    }

                    <!-- ── Reviews ──────────────────────────────────────── -->
                    <h3 class="arc-detail__h">Reviews</h3>
                    @if (rec.reviews.length) {
                      <ul class="arc-reviews">
                        @for (v of rec.reviews; track v.id) {
                          <li class="arc-review">
                            <span class="arc-review__type">{{ reviewLabel(v.type) }}</span>
                            <span class="arc-review__stars" [attr.aria-label]="v.rating + ' out of 5'">
                              {{ stars(v.rating) }}
                            </span>
                            <span class="arc-review__by">
                              {{ v.author?.fullName || 'A former user' }},
                              {{ v.publishedAt | date: 'MMM yyyy' }}
                            </span>
                            <span class="arc-review__body">{{ v.comment }}</span>
                            @if (v.response) {
                              <span class="arc-review__reply">
                                Reply: {{ v.response }}
                              </span>
                            }
                          </li>
                        }
                      </ul>
                    } @else {
                      <!-- ⚠️ Says WHY there is nothing, which matters here: a
                           review is withheld until both sides have written one
                           or the window closes, so "none" and "not yet shown"
                           are different facts and the reader cannot tell them
                           apart from an empty list. -->
                      <p class="muted">
                        @if (rec.tenancy.reviewsOpen) {
                          Nothing is shown yet. Neither review appears until you
                          have both written one, or the 30 days run out.
                        } @else {
                          No reviews were published for this letting.
                        }
                      </p>
                    }

                    <!-- ── Paperwork ────────────────────────────────────── -->
                    @if (rec.documents.length) {
                      <h3 class="arc-detail__h">Paperwork</h3>
                      <ul class="arc-docs">
                        @for (d of rec.documents; track d.id) {
                          <li class="arc-doc">
                            <span class="arc-doc__label">{{ d.label }}</span>
                            <span class="muted">
                              {{ d.kind }}@if (d.sizeBytes) { · {{ kb(d.sizeBytes) }} }
                              · {{ d.createdAt | date: 'd MMM yyyy' }}
                            </span>
                          </li>
                        }
                      </ul>
                      <p class="muted arc-note">
                        Mastande stored these files and nothing more. It did not
                        sign anything or check what either of you agreed.
                      </p>
                    }

                    <!-- ── How it began ─────────────────────────────────── -->
                    @if (rec.application || rec.viewings.length) {
                      <h3 class="arc-detail__h">Before you moved in</h3>
                      <ul class="arc-timeline">
                        @if (rec.application) {
                          <li>Applied {{ rec.application.createdAt | date: 'd MMM yyyy' }}</li>
                          @if (rec.application.decidedAt) {
                            <li>Accepted {{ rec.application.decidedAt | date: 'd MMM yyyy' }}</li>
                          }
                        }
                        @for (v of rec.viewings; track v.id) {
                          <li>
                            Viewing {{ v.startsAt | date: 'd MMM yyyy, HH:mm' }} —
                            {{ viewingLabel(v.status) }}
                          </li>
                        }
                      </ul>
                    }

                    <!-- ── What you reported ────────────────────────────── -->
                    <!-- ⚠️ Only ever the ones THIS person raised. A tenancy
                         flag and a report are private, unreviewed accusations,
                         and the schema records why showing one to its subject
                         is this platform's largest defamation exposure in
                         South Africa. Enforced server-side; this section just
                         renders what it is given. -->
                    @if (rec.flags.length || rec.reports.length) {
                      <h3 class="arc-detail__h">What you reported</h3>
                      <p class="muted">
                        Only what you raised. What the other party may have
                        reported is not shown to you, and yours is not shown to
                        them.
                      </p>
                      <ul class="arc-reports">
                        @for (f of rec.flags; track f.id) {
                          <li class="arc-report">
                            <span class="arc-report__reason">{{ flagLabel(f.reason) }}</span>
                            <span class="muted">{{ f.createdAt | date: 'd MMM yyyy' }} · {{ f.status }}</span>
                            <span class="arc-report__detail">{{ f.detail }}</span>
                            @if (f.reviewNote) {
                              <span class="arc-report__outcome">Mastande said: {{ f.reviewNote }}</span>
                            }
                          </li>
                        }
                        @for (r2 of rec.reports; track r2.id) {
                          <li class="arc-report">
                            <span class="arc-report__reason">{{ r2.reason }}</span>
                            <span class="muted">{{ r2.createdAt | date: 'd MMM yyyy' }} · {{ r2.status }}</span>
                            <span class="arc-report__detail">{{ r2.details }}</span>
                            @if (r2.resolutionNote) {
                              <span class="arc-report__outcome">Mastande said: {{ r2.resolutionNote }}</span>
                            }
                          </li>
                        }
                      </ul>
                    }

                    <!-- ── What is deliberately not here ───────────────── -->
                    <!-- Said out loud rather than left as an absence. A reader
                         who knows a thing exists and cannot find it assumes it
                         was lost. -->
                    <div class="arc-note arc-note--excluded">
                      <p class="muted">
                        Private notes a landlord wrote are not part of a shared
                        record and are not shown to anybody but their author.
                        The conversation for this letting is where it has always
                        been.
                      </p>
                      <!-- ⚠️ A block link with real padding, not an inline one
                           mid-sentence. The drive measured the inline version
                           at 14px against the 44px target this codebase holds
                           everything to — WCAG 2.5.8 does exempt a link inside
                           a sentence, but the useful thing here is the
                           destination and it deserves to be tappable on a
                           cheap touch screen rather than technically exempt.

                           routerLink, not href: an href reloads the whole
                           application in an SPA, which on this market's
                           connections is seconds and a white screen. -->
                      <a class="arc-note__link" routerLink="/account/messages">
                        Open your messages
                      </a>
                    </div>
                  </div>
                } @else if (detailError()) {
                  <div class="arc-detail">
                    <div class="field-error" role="alert">{{ detailError() }}</div>
                  </div>
                } @else {
                  <div class="arc-detail"><p class="muted">Loading the record…</p></div>
                }
              }
            </li>
          }
        </ul>
      </section>
    }
  `,
  /* No emoji in these comments: an emoji inside a CSS comment in an inline
     styles block fails esbuild's CSS parser, and ng serve then keeps serving
     the previous bundle while the production build fails. */
  styles: [`
    /* Tokens by name, never retyped. This file is exactly where a near-miss
       like #DDD5C8 against --border gets introduced — TOKENS-CURRENT.md
       measured 19 uses of that one impostor. */
    .arc-list { list-style: none; margin: .75rem 0 0; padding: 0; }
    .arc-row {
      border: 1.5px solid var(--border);
      border-radius: var(--r4);
      background: var(--card);
      margin-bottom: .6rem;
      overflow: hidden;
    }
    .arc-row--open { border-color: var(--slate); }
    /* The whole head is the control, so the tap target is the row rather than
       a chevron somebody has to hit on a cheap touch screen. */
    .arc-row__head {
      display: grid; gap: .3rem;
      width: 100%; min-height: 44px;
      padding: .75rem .85rem;
      text-align: left;
      font: inherit; color: var(--ink);
      background: none; border: none; cursor: pointer;
    }
    .arc-row__head:hover { background: var(--cream2); color: var(--ink); }
    .arc-row__title { font-weight: 700; font-size: .95rem; }
    .arc-row__meta {
      display: flex; flex-wrap: wrap; align-items: center; gap: .45rem;
      font-size: .78rem; color: var(--slate); line-height: 1.5;
    }
    .arc-row__badge {
      flex: 0 0 auto;
      font-size: .68rem; font-weight: 700;
      text-transform: uppercase; letter-spacing: .06em;
      color: var(--terra-deep);
      background: var(--cream2);
      border: 1px solid var(--border);
      border-radius: var(--r-full);
      padding: .12rem .5rem;
    }
    /* A letting that never started is a different kind of record, not a
       lesser one. Slate rather than terracotta: nothing happened. */
    .arc-row__badge--fell { color: var(--slate); }
    .arc-row__review { color: var(--terra-deep); font-weight: 700; }

    .arc-detail {
      padding: .25rem .85rem 1rem;
      border-top: 1.5px solid var(--border);
    }
    .arc-detail__h {
      font-size: .85rem; margin: 1rem 0 .4rem;
      display: flex; align-items: baseline; gap: .4rem;
    }

    .arc-facts { display: grid; grid-template-columns: auto 1fr; gap: .25rem .75rem; margin: 0; font-size: .82rem; }
    .arc-facts dt { color: var(--slate); }
    .arc-facts dd { margin: 0; }

    .arc-months, .arc-reviews, .arc-docs, .arc-timeline, .arc-reports {
      list-style: none; margin: 0; padding: 0; font-size: .82rem;
    }
    .arc-month, .arc-review, .arc-doc, .arc-report {
      display: flex; flex-wrap: wrap; align-items: center; gap: .5rem;
      padding: .4rem 0;
      border-bottom: 1px solid var(--border);
      line-height: 1.55;
    }
    .arc-month__when { min-width: 5.5rem; font-weight: 700; }
    .arc-month__amount { min-width: 5rem; }
    .arc-month__answer, .arc-review__body, .arc-review__reply,
    .arc-report__detail, .arc-report__outcome { flex-basis: 100%; color: var(--ink2); }
    .arc-review__type { font-weight: 700; }
    .arc-review__stars { color: var(--gold); letter-spacing: .05em; }
    .arc-review__reply, .arc-report__outcome { color: var(--slate); font-style: italic; }
    .arc-timeline li { padding: .25rem 0; color: var(--ink2); }
    .arc-report__reason { font-weight: 700; }
    .arc-doc__label { font-weight: 700; }

    .arc-note { font-size: .76rem; margin: .5rem 0 0; }
    .arc-note--excluded {
      margin-top: 1.1rem; padding-top: .7rem;
      border-top: 1px solid var(--border);
    }
    .arc-note--excluded p { margin: 0 0 .25rem; }
    /* 44px, because the destination is the useful part of this block. */
    .arc-note__link {
      display: inline-flex; align-items: center;
      min-height: 44px;
      font-size: .8rem; font-weight: 600;
    }

    /* Breakpoints here are 900 / 768 / 480. At the narrowest the facts list
       stops being two columns — a label and a date side by side at 360px
       leaves neither enough room. */
    @media (max-width: 480px) {
      .arc-facts { grid-template-columns: 1fr; gap: 0; }
      .arc-facts dt { margin-top: .4rem; font-size: .76rem; }
      .arc-month__when, .arc-month__amount { min-width: 0; }
    }
  `],
})
export class AccountTenancies implements OnInit {
  private archive = inject(TenancyArchiveService);

  protected readonly rows = signal<ArchiveListRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  /**
   * One record open at a time, fetched when it is opened.
   *
   * ⚠️ Not all of them up front. A landlord with nine past lettings would
   * otherwise pull nine full records — every rent month, every review, every
   * document — to render nine collapsed rows. The list carries counts for
   * exactly this reason.
   */
  protected readonly openId = signal<string | null>(null);
  protected readonly record = signal<ArchiveRecord | null>(null);
  protected readonly detailError = signal<string | null>(null);

  protected readonly anyOpen = computed(() => this.openId() !== null);

  ngOnInit() {
    this.archive.list().subscribe({
      next: (list) => { this.rows.set(list); this.loading.set(false); },
      error: (err: { error?: { message?: string } }) => {
        this.loading.set(false);
        this.error.set(err?.error?.message ?? 'Could not load your past lettings.');
      },
    });
  }

  protected toggle(row: ArchiveListRow) {
    if (this.openId() === row.id) {
      this.openId.set(null);
      this.record.set(null);
      return;
    }
    this.openId.set(row.id);
    this.record.set(null);
    this.detailError.set(null);
    this.archive.record(row.id).subscribe({
      next: (rec) => this.record.set(rec),
      error: (err: { error?: { message?: string } }) =>
        this.detailError.set(err?.error?.message ?? 'Could not load that record.'),
    });
  }

  /** The months, summarised once here so no two places can disagree about it. */
  protected rentSummary(rec: ArchiveRecord): string {
    const r = rec.rent;
    const bits = [`${r.monthsRecorded} month${r.monthsRecorded === 1 ? '' : 's'} recorded`];
    if (r.monthsPaid) bits.push(`${r.monthsPaid} paid`);
    if (r.monthsUnpaid) bits.push(`${r.monthsUnpaid} unpaid`);
    if (r.monthsDisputed) bits.push(`${r.monthsDisputed} answered`);
    return bits.join(' · ');
  }

  protected rentLabel(status: string): string {
    return {
      unpaid: 'Marked unpaid',
      paid: 'Marked paid',
      partial: 'Marked part-paid',
      waived: 'Not chased',
    }[status] ?? status;
  }

  protected reviewLabel(type: string): string {
    return {
      room: 'The room',
      landlord: 'The landlord',
      tenant: 'The tenant',
    }[type] ?? type;
  }

  protected viewingLabel(status: string): string {
    return {
      proposed: 'invited, never answered',
      accepted: 'accepted',
      declined: 'declined',
      cancelled: 'called off',
    }[status] ?? status;
  }

  /** The schema's own words for each reason, so the screen matches the form. */
  protected flagLabel(reason: string): string {
    return {
      unpaid_rent: 'Rent was not paid',
      property_damage: 'The room or property was damaged',
      left_without_notice: 'They left without notice',
      deposit_withheld: 'My deposit was withheld',
      room_not_as_described: 'The room was not as described',
      unlawful_entry_or_eviction: 'Unlawful entry or eviction',
      harassment: 'Harassment or threats',
      other: 'Something else',
    }[reason] ?? reason;
  }

  protected stars(rating: number): string {
    return '★'.repeat(Math.max(0, Math.min(5, rating))) + '☆'.repeat(Math.max(0, 5 - rating));
  }

  /** So a reader knows what a download costs them on mobile data. */
  protected kb(bytes: number): string {
    return bytes >= 1024 * 1024
      ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
      : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
}
