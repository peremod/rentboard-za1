import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '@env/environment';

export interface ImageKitAuth {
  token: string;
  expire: number;
  signature: string;
  publicKey: string;
  urlEndpoint: string;
}

/**
 * Uploads a file directly from the browser to ImageKit, using a short-lived
 * signed token from our own backend (uploads.service.ts on the API side).
 * Image bytes never pass through our own server.
 */
@Injectable({ providedIn: 'root' })
export class UploadsService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  /**
   * Uploads with one retry. A dropped connection mid-upload surfaces as a
   * TypeError('Failed to fetch') with no status, which is worth retrying
   * once; an HTTP error from ImageKit is a real rejection and is not.
   */
  async uploadImage(file: File, folder: string): Promise<{ path: string; url: string }> {
    try {
      return await this.attemptUpload(file, folder);
    } catch (err) {
      const transient = err instanceof TypeError || /failed to fetch|network/i.test(String(err));
      if (!transient) throw err;
      console.warn('[ImageKit] upload dropped, retrying once', err);
      return this.attemptUpload(file, folder);
    }
  }

  private async attemptUpload(file: File, folder: string): Promise<{ path: string; url: string }> {
    let auth: ImageKitAuth;
    try {
      auth = await new Promise<ImageKitAuth>((resolve, reject) => {
        this.http.get<ImageKitAuth>(`${this.api}/uploads/imagekit-auth`).subscribe({ next: resolve, error: reject });
      });
    } catch {
      // Usually an expired session: the auth endpoint is landlord-guarded, so
      // a failed token refresh surfaces here first.
      throw new Error('your session expired. Log in again and retry the upload.');
    }

    // Guard against a malformed response reaching ImageKit as literal
    // "undefined" form values, which it answers with an opaque 500.
    if (!auth?.token || !auth?.signature || !auth?.expire || !auth?.publicKey) {
      console.error('[ImageKit] incomplete auth payload', auth);
      throw new Error('upload could not be authorised. Check the server IMAGEKIT_* settings.');
    }

    const form = new FormData();
    form.append('file', file);
    form.append('fileName', `${Date.now()}-${file.name}`);
    form.append('folder', folder);
    form.append('publicKey', auth.publicKey);
    form.append('token', auth.token);
    form.append('expire', String(auth.expire));
    form.append('signature', auth.signature);
    form.append('useUniqueFileName', 'true');

    const res = await fetch('https://upload.imagekit.io/api/v1/files/upload', { method: 'POST', body: form });

    if (!res.ok) {
      // ImageKit returns a JSON body naming the exact problem (invalid
      // signature, expired token, bad folder). Surface it rather than a bare
      // status code — a 400 here is otherwise indistinguishable between a
      // malformed key, a clock skew and an invalid folder path.
      const raw = await res.text();
      let detail = raw;
      try {
        detail = (JSON.parse(raw) as { message?: string }).message ?? raw;
      } catch {
        /* not JSON — use the raw body */
      }
      console.error('[ImageKit] upload failed', {
        status: res.status,
        detail,
        // Enough context to tell a credential fault from a file fault.
        // The signature is deliberately omitted.
        request: {
          fileName: `${Date.now()}-${file.name}`,
          fileType: file.type,
          fileSizeKB: Math.round(file.size / 1024),
          folder,
          publicKey: auth.publicKey,
          expiresInSec: auth.expire - Math.floor(Date.now() / 1000),
        },
      });
      if (res.status >= 500) {
        throw new Error('ImageKit had a server error. Wait a moment and try again.');
      }
      throw new Error(detail || `ImageKit upload failed (${res.status})`);
    }

    const data = await res.json();
    // Store the path relative to urlEndpoint — never the full URL — so the
    // IMAGE_LOADER can apply per-context transforms (thumb/card/detail) later.
    const path = (data.filePath as string).replace(/^\//, '');
    return { path, url: data.url };
  }

  /**
   * Downscale and re-encode before upload.
   *
   * Phone photos are routinely 4–8MB and 4000px wide, while the largest slot
   * the app renders is an 800px hero. Uploading the original wastes the
   * landlord's mobile data — a real cost in South Africa — and long uploads
   * on an unstable connection fail outright (ERR_HTTP2_PING_FAILED) rather
   * than returning an error we can report.
   *
   * Returns the original untouched if it is already small, or if anything in
   * the canvas path fails, so this can never block an upload that would
   * otherwise have worked.
   */
  async compressImage(file: File, maxDimension = 1600, quality = 0.82): Promise<File> {
    if (file.size < 600 * 1024) return file;      // already small enough
    if (file.type === 'image/webp') return file;  // usually already efficient

    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
      if (scale === 1 && file.size < 2 * 1024 * 1024) return file;

      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);

      const ctx = canvas.getContext('2d');
      if (!ctx) return file;
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close?.();

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', quality),
      );
      if (!blob || blob.size >= file.size) return file;   // no benefit

      return new File([blob], file.name.replace(/\.(png|jpe?g)$/i, '.jpg'), {
        type: 'image/jpeg',
        lastModified: Date.now(),
      });
    } catch {
      return file;   // canvas unavailable or image undecodable
    }
  }

  validateImage(file: File): string | null {
    const MAX_SIZE_MB = 8;
    const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
    if (!ALLOWED_TYPES.includes(file.type)) return 'Please upload a JPEG, PNG, or WebP image.';
    if (file.size > MAX_SIZE_MB * 1024 * 1024) return `Image must be under ${MAX_SIZE_MB}MB.`;
    return null;
  }
}
