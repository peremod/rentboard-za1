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

  async uploadImage(file: File, folder: string): Promise<{ path: string; url: string }> {
    const auth = await new Promise<ImageKitAuth>((resolve, reject) => {
      this.http.get<ImageKitAuth>(`${this.api}/uploads/imagekit-auth`).subscribe({ next: resolve, error: reject });
    });

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
      console.error('[ImageKit] upload failed', { status: res.status, detail });
      throw new Error(detail || `ImageKit upload failed (${res.status})`);
    }

    const data = await res.json();
    // Store the path relative to urlEndpoint — never the full URL — so the
    // IMAGE_LOADER can apply per-context transforms (thumb/card/detail) later.
    const path = (data.filePath as string).replace(/^\//, '');
    return { path, url: data.url };
  }

  validateImage(file: File): string | null {
    const MAX_SIZE_MB = 8;
    const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
    if (!ALLOWED_TYPES.includes(file.type)) return 'Please upload a JPEG, PNG, or WebP image.';
    if (file.size > MAX_SIZE_MB * 1024 * 1024) return `Image must be under ${MAX_SIZE_MB}MB.`;
    return null;
  }
}
