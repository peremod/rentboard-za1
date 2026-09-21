/** Production — `ng build --configuration production`, deployed to mastande.co.za */
export const environment = {
  production: true,
  envName: 'production',
  apiUrl: 'https://api.mastande.co.za/api',
  /** Origin used to build canonical and Open Graph URLs. No trailing slash. */
  siteUrl: 'https://mastande.co.za',
  /** The only deployment search engines are allowed to index. */
  indexable: true,
  // Must match IMAGEKIT_URL_ENDPOINT in the backend .env — uploads store paths
  // relative to this endpoint, so a mismatch renders every image as a 404.
  // Find it in ImageKit dashboard -> URL Endpoints.
  imagekitUrl: 'https://ik.imagekit.io/l4on8rrpx',
};
