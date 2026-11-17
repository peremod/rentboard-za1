import { describe, it, expect } from 'vitest';
import { assertOwnDocumentPath, verificationPrefix } from './verification.service';

/**
 * B-01: a verification document must belong to the account submitting it.
 *
 * The browser uploads straight to ImageKit and then hands the backend the
 * resulting path, so `documentPath` is attacker-controlled input. Before the
 * fix the service stored whatever string it was given. `assertOwnDocumentPath`
 * is the bind — a per-user prefix plus a traversal guard — and it is a pure
 * function precisely so it can be falsified here, with no app and no database.
 *
 * Each expectation below is hand-checkable against `verification/{userId}/`.
 */
describe('assertOwnDocumentPath', () => {
  const ME = 'user-aaaa';
  const OTHER = 'user-bbbb';

  const ok = (p: string) => expect(() => assertOwnDocumentPath(p, ME)).not.toThrow();
  const no = (p: string) => expect(() => assertOwnDocumentPath(p, ME)).toThrow();

  it('accepts a path under the caller\'s own namespace', () => {
    ok(`${verificationPrefix(ME)}id-123.jpg`);
    ok(`verification/${ME}/nested/folder/scan.png`);
    ok(`/verification/${ME}/leading-slash.jpg`); // a leading slash is tolerated
  });

  it('refuses a path under another account\'s namespace', () => {
    no(`verification/${OTHER}/their-id.jpg`);
  });

  it('refuses a path in an unrelated folder', () => {
    no('leases/someone-elses-lease.pdf');
    no('rooms/abc/photo.jpg');
    no('avatars/x.png');
  });

  it('refuses a traversal out of the namespace', () => {
    no(`verification/${ME}/../../leases/x.pdf`);
    no(`verification/${ME}/../${OTHER}/their-id.jpg`);
  });

  it('refuses the bare folder with no file after it', () => {
    no(verificationPrefix(ME)); // `verification/{me}/` and nothing more
    no(`verification/${ME}`);   // not even the trailing slash
  });

  it('refuses a near-miss prefix that only starts the same', () => {
    // `verification/{me}evil/...` shares a prefix string but is a different
    // folder — the trailing slash in the required prefix is what stops it.
    no(`verification/${ME}evil/x.jpg`);
  });

  it('refuses an empty path', () => {
    no('');
  });
});
