/** Staging — `ng build --configuration staging`, deployed to staging.rentboard.co.za */
export const environment = {
  production: false,
  envName: 'staging',
  apiUrl: 'https://rentboard-api.onrender.com',
  /** Origin used to build canonical and Open Graph URLs. No trailing slash. */
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
