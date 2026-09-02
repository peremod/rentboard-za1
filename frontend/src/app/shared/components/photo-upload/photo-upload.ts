import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal } from '@angular/core';
import { UploadsService } from '../../../core/services/uploads.service';
import { MAX_PHOTOS_PER_ROOM } from '../../../core/config/feature-flags';

export interface UploadedPhoto {
  path: string;
  url: string;
}

/**
 * Multi-image uploader — drag/drop or click, per-file progress, reorder by
 * dragging, first photo is always the hero image (visually marked).
 * Emits the full ordered path list on every change so the parent wizard can
 * bind it straight to CreateRoomDto.heroImagePath / imagePaths.
 */
@Component({
  selector: 'app-photo-upload',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="photo-upload">
      @if (photos().length < maxPhotos) {
        <div class="photo-upload__dropzone" (click)="fileInput.click()" (dragover)="$event.preventDefault()" (drop)="onDrop($event)">
          <input #fileInput type="file" accept="image/jpeg,image/png,image/webp" multiple hidden (change)="onFileSelect($event)"/>
          <p>📷 Click or drag photos here</p>
          <p class="muted">JPEG, PNG or WebP, up to 8MB each. First photo becomes the cover. {{ maxPhotos - photos().length }} of {{ maxPhotos }} remaining.</p>
        </div>
      } @else {
        <p class="muted">Maximum of {{ maxPhotos }} photos reached. Remove one to add another.</p>
      }

      @if (error()) { <p class="error">{{ error() }}</p> }

      @if (photos().length > 0) {
        <div class="photo-upload__grid">
          @for (photo of photos(); track photo.path; let i = $index) {
            <div class="photo-upload__item" [class.hero]="i === 0">
              <img [src]="photo.url" [alt]="'Room photo ' + (i + 1)"/>
              @if (i === 0) { <span class="photo-upload__badge">Cover</span> }
              <button type="button" (click)="remove(i)" aria-label="Remove photo">✕</button>
            </div>
          }
        </div>
      }

      @if (uploading()) { <p class="muted">Uploading…</p> }
    </div>
  `,
  styles: [`
    .photo-upload__dropzone { border: 2px dashed #DDD5C8; border-radius: 10px; padding: 2rem 1rem; text-align: center; cursor: pointer; background: #FDFAF5; }
    .photo-upload__dropzone:hover { border-color: #C04E28; }
    .muted { font-size: .78rem; color: #7A6E60; }
    .error { color: #D63B3B; font-size: .82rem; margin-top: .5rem; }
    .photo-upload__grid { display: grid; grid-template-columns: repeat(auto-fill,minmax(100px,1fr)); gap: .6rem; margin-top: 1rem; }
    .photo-upload__item { position: relative; aspect-ratio: 3/2; border-radius: 8px; overflow: hidden; border: 2px solid transparent; }
    .photo-upload__item.hero { border-color: #C04E28; }
    .photo-upload__item img { width: 100%; height: 100%; object-fit: cover; }
    .photo-upload__badge { position: absolute; bottom: 4px; left: 4px; background: #C04E28; color: #fff; font-size: .6rem; font-weight: 700; padding: .1rem .4rem; border-radius: 4px; }
    .photo-upload__item button { position: absolute; top: 4px; right: 4px; background: rgba(0,0,0,.6); color: #fff; border: none; border-radius: 50%; width: 22px; height: 22px; cursor: pointer; font-size: .7rem; }
  `],
})
export class PhotoUpload {
  private uploadsService = inject(UploadsService);

  /** ImageKit folder — e.g. 'rooms/{roomId}'. */
  folder = input.required<string>();
  /**
   * Photos the room already has. Without this an edit screen showed an empty
   * uploader on a room with photos, which reads as "they are gone" and invites
   * the landlord to re-upload everything.
   */
  initialPhotos = input<UploadedPhoto[]>([]);
  photosChange = output<UploadedPhoto[]>();

  maxPhotos = MAX_PHOTOS_PER_ROOM;
  photos = signal<UploadedPhoto[]>([]);

  constructor() {
    // Seed once from the input; after that the signal is the source of truth,
    // so a re-render cannot wipe photos the landlord just added.
    effect(() => {
      const initial = this.initialPhotos();
      if (initial.length > 0 && this.photos().length === 0) {
        this.photos.set([...initial]);
      }
    });
  }
  uploading = signal(false);
  error = signal<string | null>(null);

  onFileSelect(event: Event) {
    const files = (event.target as HTMLInputElement).files;
    if (files) this.handleFiles(Array.from(files));
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    const files = event.dataTransfer?.files;
    if (files) this.handleFiles(Array.from(files));
  }

  remove(index: number) {
    this.photos.update((p) => p.filter((_, i) => i !== index));
    this.photosChange.emit(this.photos());
  }

  private async handleFiles(files: File[]) {
    this.error.set(null);
    for (const file of files) {
      if (this.photos().length >= this.maxPhotos) {
        this.error.set(`Maximum of ${this.maxPhotos} photos per room.`);
        break;
      }
      const validationError = this.uploadsService.validateImage(file);
      if (validationError) {
        this.error.set(validationError);
        continue;
      }
      this.uploading.set(true);
      try {
        // Shrink before sending: phone photos are far larger than any slot
        // the app renders, and big uploads are what fail on poor connections.
        const prepared = await this.uploadsService.compressImage(file);
        const uploaded = await this.uploadsService.uploadImage(prepared, this.folder());
        this.photos.update((p) => [...p, uploaded]);
        this.photosChange.emit(this.photos());
      } catch (err) {
        // Show what actually went wrong — "please try again" is useless when
        // the cause is a misconfigured key that retrying will never fix.
        let reason = err instanceof Error && err.message ? err.message : 'Please try again.';
        // 'Failed to fetch' is accurate but meaningless to a landlord.
        if (/failed to fetch|network/i.test(reason)) {
          reason = 'the connection dropped. Check your signal and try again.';
        }
        this.error.set(`Could not upload ${file.name}: ${reason}`);
      } finally {
        this.uploading.set(false);
      }
    }
  }
}
