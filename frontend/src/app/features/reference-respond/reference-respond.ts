import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { VerificationService } from '../../core/services/verification.service';
import { ReferenceRequestView } from '../../core/models/verification.model';

/**
 * A previous landlord answering a reference request.
 *
 * The only page in the app built for someone with no account and no intention
 * of making one. They arrived from a single WhatsApp message, on a phone, and
 * will give this about a minute — so it is two questions on one screen, no
 * navigation, no sign-up, and no mention of anything else the platform does.
 *
 * The token in the URL is the whole authentication. It is single-use and
 * expires in fourteen days; see ReferencesService on the API for why that is
 * defensible.
 *
 * "I would rather not" is a first-class answer, given equal weight to
 * confirming. A referee who will not vouch for someone needs a way to say so
 * that is not abandoning the page, and burying it would mean reading silence
 * as a negative — which it is not.
 */
@Component({
  selector: 'app-reference-respond',
  standalone: true,
  imports: [DatePipe, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="reference">
      @if (loading()) {
        <p class="reference__muted">Loading…</p>
      } @else if (fatal()) {
        <h1>{{ fatal() }}</h1>
        <p class="reference__muted">
          You can close this page. Nothing further is needed from you.
        </p>
      } @else if (done()) {
        <h1>Thank you.</h1>
        <p class="reference__muted">
          That is all we needed. We will not message you about this again.
        </p>
      } @else if (request(); as req) {
        <h1>A quick reference request</h1>
        <p class="reference__lead">
          Hello {{ req.refereeName }}. <strong>{{ req.tenantName }}</strong> is
          looking for a room and gave you as a previous landlord
          @if (req.propertyDescription) { for {{ req.propertyDescription }} }.
          @if (req.tenancyStartedAt) {
            <br/><span class="reference__muted">
              They say they rented from you from
              {{ req.tenancyStartedAt | date: 'MMM yyyy' }}
              @if (req.tenancyEndedAt) { to {{ req.tenancyEndedAt | date: 'MMM yyyy' }} }.
            </span>
          }
        </p>

        @if (error()) { <div class="form-error">{{ error() }}</div> }

        <div class="reference__q">
          <p><strong>Did they rent from you?</strong></p>
          <div class="reference__choices">
            <button type="button" class="reference__choice"
                    [class.active]="outcome() === 'confirm'"
                    (click)="outcome.set('confirm')">Yes, they did</button>
            <button type="button" class="reference__choice"
                    [class.active]="outcome() === 'decline'"
                    (click)="outcome.set('decline')">I would rather not say</button>
          </div>
        </div>

        @if (outcome() === 'confirm') {
          <div class="reference__q">
            <p><strong>How did it go?</strong> 1 is poor, 5 is excellent.</p>
            <div class="reference__choices">
              @for (n of [1, 2, 3, 4, 5]; track n) {
                <button type="button" class="reference__star"
                        [class.active]="rating() === n" (click)="rating.set(n)">{{ n }}</button>
              }
            </div>
          </div>

          <label class="reference__comment">
            Anything you want to add? (optional)
            <textarea name="comment" rows="3" maxlength="500" [(ngModel)]="comment"
                      placeholder="e.g. Paid on time every month, kept the room tidy."></textarea>
          </label>
        }

        <button type="button" class="reference__submit"
                [disabled]="!outcome() || submitting() || (outcome() === 'confirm' && !rating())"
                (click)="send()">
          {{ submitting() ? 'Sending…' : 'Send my answer' }}
        </button>

        <p class="reference__popia">
          Mastande is a room-letting notice board. {{ req.tenantName }} gave us
          your number for this one question. We do not add you to anything, and
          we will not message you again about it.
        </p>
      }
    </main>
  `,
  styles: [`
    .reference { max-width: 520px; margin: 0 auto; padding: 2rem 1.25rem 3rem; }
    h1 { font-size: 1.35rem; margin: 0 0 .75rem; }
    .reference__lead { line-height: 1.6; margin-bottom: 1.5rem; }
    .reference__muted { color: #7A6E60; font-size: .85rem; }
    .reference__q { margin-bottom: 1.5rem; }
    .reference__q p { margin: 0 0 .6rem; }
    .reference__choices { display: flex; gap: .5rem; flex-wrap: wrap; }
    .reference__choice {
      flex: 1 1 auto; min-height: 48px; padding: .7rem 1rem; border-radius: 8px;
      border: 1.5px solid #DDD5C8; background: #fff; cursor: pointer; font-size: .9rem;
    }
    .reference__choice.active { border-color: var(--terra); background: rgba(173,66,34,.06); font-weight: 700; }
    .reference__star {
      width: 48px; height: 48px; border-radius: 8px; border: 1.5px solid #DDD5C8;
      background: #fff; cursor: pointer; font-size: 1rem;
    }
    .reference__star.active { border-color: var(--terra); background: rgba(173,66,34,.06); font-weight: 700; }
    .reference__comment { display: block; margin-bottom: 1.5rem; font-size: .9rem; }
    .reference__comment textarea {
      display: block; width: 100%; margin-top: .4rem; padding: .6rem;
      border-radius: 8px; border: 1.5px solid #DDD5C8; font: inherit;
    }
    .reference__submit {
      width: 100%; min-height: 48px; border-radius: 8px; border: none;
      background: var(--terra); color: #fff; font-weight: 700; cursor: pointer; font-size: .95rem;
    }
    .reference__submit:disabled { opacity: .5; cursor: not-allowed; }
    .reference__popia { margin-top: 1.5rem; font-size: .78rem; color: #7A6E60; line-height: 1.6; }
  `],
})
export class ReferenceRespond implements OnInit {
  private route = inject(ActivatedRoute);
  private verification = inject(VerificationService);

  protected readonly loading = signal(true);
  protected readonly submitting = signal(false);
  protected readonly done = signal(false);
  /** A dead link or an already-answered one — nothing to do but explain. */
  protected readonly fatal = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly request = signal<ReferenceRequestView | null>(null);

  protected readonly outcome = signal<'confirm' | 'decline' | null>(null);
  protected readonly rating = signal<number | null>(null);
  protected comment = '';

  private token = '';

  ngOnInit() {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';
    if (!this.token) {
      this.fatal.set('That link is not valid.');
      this.loading.set(false);
      return;
    }
    this.verification.lookupReference(this.token).subscribe({
      next: (view) => {
        this.request.set(view);
        this.loading.set(false);
      },
      error: (err) => {
        this.fatal.set(err?.error?.message ?? 'That link is not valid.');
        this.loading.set(false);
      },
    });
  }

  protected send() {
    const outcome = this.outcome();
    if (!outcome) return;
    this.submitting.set(true);
    this.error.set(null);
    this.verification
      .respondToReference(this.token, {
        outcome,
        rating: outcome === 'confirm' ? (this.rating() ?? undefined) : undefined,
        comment: this.comment.trim() || undefined,
      })
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.done.set(true);
        },
        error: (err) => {
          this.submitting.set(false);
          this.error.set(err?.error?.message ?? 'Could not send that. Please try again.');
        },
      });
  }
}
