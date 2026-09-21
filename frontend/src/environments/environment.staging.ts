/**
 * Staging — `ng build --configuration staging`, deployed to staging.umastande.co.za
 *
 * Both hostnames below moved in the Mastande rebrand and BOTH need the
 * provider changed before staging works again:
 *   · apiUrl  — Render keys services by name, so `mastande-api` is a new
 *               service that must be created (see render.yaml).
 *   · siteUrl — the Vercel project must be renamed, which is what moves the
 *               *.vercel.app alias.
 * Until then staging builds fine and 404s at runtime. Nothing here can detect
 * that; .github/workflows/verify-deployment.yml is what will catch it.
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
  siteUrl: 'https://mastande.vercel.app',
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
