/** Development — used by `ng serve` (default configuration). */
export const environment = {
  production: false,
  envName: 'development',
  apiUrl: 'http://localhost:3000/api',
  /** Origin used to build canonical and Open Graph URLs. No trailing slash. */
  siteUrl: 'http://localhost:4200',
  /**
   * Whether search engines may index this deployment. Only production is
   * true — staging serving the same copy under its own domain is the classic
   * way to have a site compete with itself for its own keywords.
   */
  indexable: false,
  // Must match IMAGEKIT_URL_ENDPOINT in the backend .env — uploads store paths
  // relative to this endpoint, so a mismatch renders every image as a 404.
  // Find it in ImageKit dashboard -> URL Endpoints.
  imagekitUrl: 'https://ik.imagekit.io/l4on8rrpx',
};
