/** Development — used by `ng serve` (default configuration). */
export const environment = {
  production: false,
  envName: 'development',
  apiUrl: 'http://localhost:3000/api',
  // Must match IMAGEKIT_URL_ENDPOINT in the backend .env — uploads store paths
  // relative to this endpoint, so a mismatch renders every image as a 404.
  // Find it in ImageKit dashboard -> URL Endpoints.
  imagekitUrl: 'https://ik.imagekit.io/l4on8rrpx',
};
