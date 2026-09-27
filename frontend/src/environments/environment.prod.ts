/** Production — `ng build --configuration production`, deployed to www.umastande.co.za */
export const environment = {
  production: true,
  envName: 'production',
  apiUrl: 'https://api.umastande.co.za/api',
  /**
   * Origin used to build canonical, hreflang, Open Graph and sitemap URLs.
   * No trailing slash.
   *
   * **www, not the apex.** `www.umastande.co.za` is a CNAME to Vercel and has
   * been serving this app since the domain went live; the apex still points at
   * the old cPanel host, which answers `301 → https://www.umastande.co.za/`.
   * So www is the address that actually serves the site, and a canonical has
   * to name the URL that answers, not the one that redirects to it — a
   * canonical pointing at a 301 is a hop Google has to follow on every page
   * and an origin that is not ours to control.
   *
   * Both hostnames keep working either way: `allowedHosts()` in server.ts adds
   * the apex/www counterpart of whatever is here, and `isCanonicalHost()`
   * accepts both, so the day the apex A record points at Vercel nothing here
   * needs to change — set the redirect in the Vercel project and this stays
   * correct.
   */
  siteUrl: 'https://www.umastande.co.za',
  /** The only deployment search engines are allowed to index. */
  indexable: true,
  // Must match IMAGEKIT_URL_ENDPOINT in the backend .env — uploads store paths
  // relative to this endpoint, so a mismatch renders every image as a 404.
  // Find it in ImageKit dashboard -> URL Endpoints.
  imagekitUrl: 'https://ik.imagekit.io/l4on8rrpx',
};
