import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { VerificationService } from '../../../core/services/verification.service';
import { UploadsService } from '../../../core/services/uploads.service';
import { RoomsService } from '../../../core/services/rooms.service';
import { Room } from '../../../core/models/room.model';
import { VerificationType } from '../../../core/models/verification.model';

/**
 * Renter's Passport — the tenant side of verification.
 *
 * Replaces a page that sold an R89/month subscription and verified nothing.
 * It is free, and that is the product decision, not an oversight: "free to
 * apply, always" is the whole position against the incumbents, and charging
 * the side of this market with the least money to prove they can afford a
 * room would be the fastest way to lose it. Revenue stays on the landlord's
 * R149 check, boosts and board advertising — see docs/DATA-AND-MONETISATION.
 *
 * The checks are deliberately not a credit check. A bureau record needs a
 * credit history, and most people looking for a room here do not have one.
 * What they do have is a SASSA letter, a WhatsApp from an employer, three
 * months of banking-app screenshots, or a previous landlord who will vouch
 * for them — so those are the checks.
 *
 * Every document uploads privately and is deleted the moment it is reviewed.
 * The page says so before asking for anything, because not saying it is what
 * makes people refuse.
 */
@Component({
  selector: 'app-passport-verify',
  standalone: true,
  imports: [DatePipe, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `

      @if (progress().complete) {
        <div class="insight-banner" style="background:rgba(61,112,64,.08);border-color:rgba(61,112,64,.2)">
          ✅
          <span>
            <strong>Your Renter's Passport is active.</strong>
            Landlords see it on every application you send, so you do not have to
            explain your situation from scratch each time.
          </span>
        </div>
      } @else {
        <div class="insight-banner">
          🛂
          <span>
            A Renter's Passport shows a landlord you are who you say you are and
            that money comes in every month — without a credit check, which most
            people renting a room do not have and should not need.
            <strong>It is free.</strong>
          </span>
        </div>
      }

      <!-- Both halves, always visible. Someone who has done one needs to see
           what the other is, not a bare "1 of 2". -->
      <div class="passport-steps">
        <div class="passport-step" [class.done]="progress().identity">
          <span class="passport-step__mark">{{ progress().identity ? '✓' : '1' }}</span>
          <div>
            <strong>Who you are</strong>
            <p>Your ID book, card or passport.</p>
          </div>
        </div>
        <div class="passport-step" [class.done]="progress().income">
          <span class="passport-step__mark">{{ progress().income ? '✓' : '2' }}</span>
          <div>
            <strong>That money comes in</strong>
            <p>Any one of the options below. One is enough.</p>
          </div>
        </div>
      </div>

      <p class="passport-popia">
        🔒 Everything you upload is stored privately and
        <strong>deleted as soon as someone has looked at it</strong> — we keep the
        outcome, never the document. That is POPIA s.26, and it is the reason we
        never ask for your ID number.
      </p>

      @if (error()) { <div class="form-error">{{ error() }}</div> }

      @for (info of verification.types(); track info.type) {
        <!-- A check about a LISTING gets one card per listing — Phase 6.
             The sublet-right check is granted by one lease over one address, so a
             single card per type would have shown the first listing's outcome
             against all of them, and there would have been no way to say which
             room an upload was for. Nothing renders when there are no sub-let
             listings, which is why the type is not even offered then. -->
        @if (info.aboutAListing) {
          @for (room of sublets(); track room.id) {
            <div class="passport-card">
              <div class="passport-card__head">
                <strong>{{ info.label }}</strong>
                @if (statusFor(info.type, room.id); as status) {
                  <span class="passport-pill" [class]="'passport-pill--' + status">{{ statusLabel(status) }}</span>
                }
              </div>
              <p class="passport-card__guidance">
                <strong>{{ room.title }}</strong> — {{ room.locationDisplay }}
              </p>
              <p class="passport-card__guidance">{{ info.guidance }}</p>

              @if (requestFor(info.type, room.id); as request) {
                @if (request.status === 'rejected' && request.reviewNote) {
                  <p class="passport-card__note">What to fix: {{ request.reviewNote }}</p>
                }
                @if (request.events?.length) {
                  <details class="passport-trail">
                    <summary>What has happened so far</summary>
                    <ul>
                      @for (event of request.events; track event.id) {
                        <li>
                          <time>{{ event.createdAt | date: 'd MMM, HH:mm' }}</time>
                          {{ event.detail || event.step }}
                        </li>
                      }
                    </ul>
                  </details>
                }
              } @else {
                <label class="passport-upload">
                  <input type="file" accept="image/*,application/pdf" hidden
                         [disabled]="uploading() !== null"
                         (change)="onFile($event, info.type, room.id)"/>
                  <span>
                    {{ uploadingRoom() === room.id ? 'Uploading…' : 'Choose a photo or scan' }}
                  </span>
                </label>
                <p class="passport-card__guidance">
                  Free. We never show this document to anyone applying — only the
                  outcome and the date.
                </p>
              }
            </div>
          }
        } @else {
        <div class="passport-card">
          <div class="passport-card__head">
            <strong>{{ info.label }}</strong>
            @if (statusFor(info.type); as status) {
              <span class="passport-pill" [class]="'passport-pill--' + status">{{ statusLabel(status) }}</span>
            }
          </div>
          <p class="passport-card__guidance">{{ info.guidance }}</p>

          @if (requestFor(info.type); as request) {
            @if (request.status === 'rejected' && request.reviewNote) {
              <p class="passport-card__note">What to fix: {{ request.reviewNote }}</p>
            }
            @if (request.reference; as reference) {
              <p class="passport-card__note">
                {{ reference.refereeName }} — {{ referenceLabel(reference.status) }}
                @if (reference.rating) { · rated {{ reference.rating }}/5 }
              </p>
            }
            @if (request.events?.length) {
              <details class="passport-trail">
                <summary>What has happened so far</summary>
                <ul>
                  @for (event of request.events; track event.id) {
                    <li>
                      <time>{{ event.createdAt | date: 'd MMM, HH:mm' }}</time>
                      {{ event.detail || event.step }}
                    </li>
                  }
                </ul>
              </details>
            }
          } @else if (info.needsDocument) {
            <label class="passport-upload">
              <input type="file" accept="image/*,application/pdf" hidden
                     [disabled]="uploading() !== null"
                     (change)="onFile($event, info.type)"/>
              <span>{{ uploading() === info.type ? 'Uploading…' : 'Choose a photo or scan' }}</span>
            </label>
          } @else {
            <!-- The reference is a phone call, not a file. -->
            <form class="passport-ref" (ngSubmit)="submitReference()">
              <label>
                Their name
                <input type="text" name="refereeName" [(ngModel)]="refereeName" required maxlength="120"/>
              </label>
              <label>
                Their mobile number
                <input type="tel" name="refereePhone" [(ngModel)]="refereePhone" required
                       placeholder="082 123 4567"/>
              </label>
              <label>
                Which place was it?
                <input type="text" name="propertyDescription" [(ngModel)]="propertyDescription"
                       maxlength="200" placeholder="Back room, Ext 7, Tembisa"/>
              </label>
              <p class="passport-card__guidance">
                We send them one WhatsApp asking two questions. They do not need an
                account, and we do not message them again.
              </p>
              <button type="submit" class="btn btn-primary" [disabled]="submitting()">
                {{ submitting() ? 'Sending…' : 'Ask them for a reference' }}
              </button>
            </form>
          }
        </div>
        }
      }
  `,
})
export class PassportVerify implements OnInit {
  protected readonly verification = inject(VerificationService);
  private uploads = inject(UploadsService);
  private rooms = inject(RoomsService);

  protected readonly uploading = signal<VerificationType | null>(null);
  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly progress = this.verification.passportProgress;

  protected refereeName = '';
  protected refereePhone = '';
  protected propertyDescription = '';

  /**
   * The sub-let listings this person holds — Phase 6.
   *
   * Loaded here because the listing-scoped check needs one card per listing,
   * and because the API only offers `sublet_right` at all when there is one.
   * Failure is silent: a tenant with no listings is the overwhelming majority
   * and must not see an error about a feature they are not using.
   */
  protected readonly sublets = signal<Room[]>([]);
  protected readonly uploadingRoom = signal<string | null>(null);

  ngOnInit() {
    this.verification.loadTypes().subscribe();
    this.verification.load().subscribe();
    this.rooms.getLandlordRooms().subscribe({
      next: (rooms) => this.sublets.set(rooms.filter((r) => r.listerType === 'sublessor')),
      error: () => {},
    });
  }

  /**
   * Matched on the listing too, for a check that is about one — Phase 6.
   *
   * Without the roomId comparison, a sub-lessor with two houses would see the
   * first house's outcome on both cards, and the second would offer no upload
   * because a request "already existed" for the type.
   */
  protected requestFor(type: VerificationType, roomId?: string) {
    return (
      this.verification
        .requests()
        .find((r) => r.type === type && (roomId ? r.roomId === roomId : true)) ?? null
    );
  }

  protected statusFor(type: VerificationType, roomId?: string) {
    return this.requestFor(type, roomId)?.status ?? null;
  }

  protected statusLabel(status: string) {
    switch (status) {
      case 'pending': return 'Being checked';
      case 'approved': return 'Confirmed';
      case 'rejected': return 'Not accepted';
      case 'pending_payment': return 'Waiting for payment';
      default: return status;
    }
  }

  /**
   * `unreachable` is worded carefully. A previous landlord who did not reply
   * has told us nothing about this tenant, and a tenant must not read it — or
   * be shown it — as a mark against them.
   */
  protected referenceLabel(status: string) {
    switch (status) {
      case 'awaiting_contact': return 'we will message them shortly';
      case 'contacted': return 'we have messaged them';
      case 'confirmed': return 'confirmed your tenancy';
      case 'disputed': return 'did not confirm';
      case 'unreachable': return 'did not reply — this does not count against you';
      default: return status;
    }
  }

  protected async onFile(event: Event, type: VerificationType, roomId?: string) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    input.value = ''; // so the same file can be picked again after a failure

    if (file.size > 10 * 1024 * 1024) {
      this.error.set('That file is over 10MB. Please use a smaller photo or scan.');
      return;
    }

    this.uploading.set(type);
    this.uploadingRoom.set(roomId ?? null);
    this.error.set(null);
    try {
      const { path } = await this.uploads.uploadPrivate(file, 'verification');
      this.verification.submit(type, path, undefined, roomId).subscribe({
        next: () => { this.uploading.set(null); this.uploadingRoom.set(null); },
        error: (err) => {
          this.uploading.set(null);
          this.uploadingRoom.set(null);
          this.error.set(err?.error?.message ?? 'Could not submit that. Please try again.');
        },
      });
    } catch (err) {
      this.uploading.set(null);
      this.uploadingRoom.set(null);
      this.error.set(
        err instanceof Error ? `Upload failed — ${err.message}` : 'Upload failed. Please try again.',
      );
    }
  }

  protected submitReference() {
    if (!this.refereeName.trim() || !this.refereePhone.trim()) {
      this.error.set('We need their name and mobile number.');
      return;
    }
    this.submitting.set(true);
    this.error.set(null);
    this.verification
      .submit('landlord_reference', undefined, {
        refereeName: this.refereeName.trim(),
        refereePhone: this.refereePhone.trim(),
        propertyDescription: this.propertyDescription.trim() || undefined,
      })
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.refereeName = '';
          this.refereePhone = '';
          this.propertyDescription = '';
        },
        error: (err) => {
          this.submitting.set(false);
          this.error.set(err?.error?.message ?? 'Could not send that. Please try again.');
        },
      });
  }
}
