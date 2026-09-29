import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '@env/environment';
import {
  LeaseDocument, LeaseDocumentKind, LeaseDocumentLocation,
} from '../models/lease-document.model';

/**
 * Lease documents: storing them, and nothing else.
 *
 * There is no `sign()` here and there is not going to be one without ECT Act
 * advice behind it. Signing is execution of a legal document; this keeps the
 * photograph of what two people already signed on paper.
 */
@Injectable({ providedIn: 'root' })
export class LeaseDocumentsService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  list(tenancyId: string) {
    return this.http.get<LeaseDocument[]>(`${this.api}/tenancies/${tenancyId}/documents`);
  }

  add(tenancyId: string, body: {
    path: string; label: string; kind?: LeaseDocumentKind;
    sizeBytes?: number; contentType?: string; note?: string;
  }) {
    return this.http.post<LeaseDocument>(`${this.api}/tenancies/${tenancyId}/documents`, body);
  }

  /** Label, kind and note only. The file itself is never patched — see remove. */
  update(docId: string, body: { label?: string; kind?: LeaseDocumentKind; note?: string }) {
    return this.http.patch<LeaseDocument>(`${this.api}/tenancies/documents/${docId}`, body);
  }

  /** Removes the row AND deletes the file from storage. Uploader only. */
  remove(docId: string) {
    return this.http.delete<{ deleted: true }>(`${this.api}/tenancies/documents/${docId}`);
  }

  /**
   * Where to read one document.
   *
   * Asked for at the moment someone opens it rather than carried in the list, so
   * a storage path is not sitting in every response the browser has cached.
   */
  location(docId: string) {
    return this.http.get<LeaseDocumentLocation>(`${this.api}/tenancies/documents/${docId}/open`);
  }
}
