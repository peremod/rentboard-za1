/**
 * Staging — `ng build --configuration staging`, served at
 * https://rentboard-za1.vercel.app (the `develop` deployment of the Vercel
 * project `rentboard-za1`).
 *
 * ⚠️ The name is pre-rebrand and that is a fact about the deployment, not a
 * mistake here. Renaming the Vercel project moves the *.vercel.app alias, so
 * this value changes the day that happens and not before. Three files have to
 * agree on it — this one, `SITE_URL` in render.yaml, and `FRONTEND_URL` on the
 * staging service — and scripts/env-parity.mjs now asserts the first two
 * match rather than leaving it to whoever remembers.
 *
 * It said `mastande.vercel.app` until 13 October, a host that has never
 * existed: the rebrand renamed the API service and not the Vercel project, and
 * nothing compared the two. render.yaml meanwhile said
 * `staging.umastande.co.za`. Three files, three different answers, none of
 * them what staging actually serves.
 */
export const environment = {
  production: false,
  envName: 'staging',
  apiUrl: 'https://mastande-api.onrender.com',
  /**
   * Origin used to build canonical and Open Graph URLs. No trailing slash.
   * A project alias, never a per-deployment URL: those are immutable per
   * deploy, so every new deploy would strand the canonical baked into the
   * previous build.
   */
  siteUrl: 'https://rentboard-za1.vercel.app',
  /**
   * Deliberately false. Staging is a byte-identical copy of production copy;
   * if it were indexable it would fight production for every keyword and
   * leak unreleased pages. Enforced twice — here, and by the
   * X-Robots-Tag header in vercel.json.
   */
  indexable: false,
  // Must match IMAGEKIT_URL_ENDPOINT in the backend .env — uploads store paths
  // relative to this endpoint, so a mismatch renders every image as a 404.
  // Find it in ImageKit dashboard -> URL Endpoints.
  imagekitUrl: 'https://ik.imagekit.io/l4on8rrpx',
};
