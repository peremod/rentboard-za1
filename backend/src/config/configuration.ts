/**
 * Typed configuration factory — loaded by ConfigModule.forRoot({ load: [configuration] }).
 * Single source of truth for env var access; never call process.env directly elsewhere.
 */
export default () => ({
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:4200',

  jwt: {
    secret: process.env.JWT_SECRET!,
    expiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
    refreshTokenTtlDays: parseInt(process.env.REFRESH_TOKEN_TTL_DAYS ?? '30', 10),
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackUrl: process.env.GOOGLE_CALLBACK_URL,
  },

  imagekit: {
    // Trimmed because a stray trailing space or newline in .env silently
    // produces a wrong HMAC, and ImageKit then rejects every upload with a
    // 400 that says nothing about the key.
    publicKey: process.env.IMAGEKIT_PUBLIC_KEY?.trim(),
    privateKey: process.env.IMAGEKIT_PRIVATE_KEY?.trim(),
    urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT?.trim(),
    // Overridable so file deletion can be driven against a stub on a machine
    // with no ImageKit credentials. Without that seam the only way to check
    // that deletion happens is to read the code and believe it, which is the
    // standard that let the deletion gap ship in the first place.
    apiBase: process.env.IMAGEKIT_API_BASE?.trim(),
  },

  payfast: {
    merchantId: process.env.PAYFAST_MERCHANT_ID?.trim(),
    merchantKey: process.env.PAYFAST_MERCHANT_KEY?.trim(),
    // Optional in PayFast, but if set on the account it MUST be included in
    // the signature or every payment is rejected.
    passphrase: process.env.PAYFAST_PASSPHRASE?.trim(),
    sandbox: process.env.PAYFAST_SANDBOX !== 'false',
  },

  /// Public base URL of this API, used to build the ITN notify_url.
  apiUrl: process.env.API_URL?.trim(),


  /// Where operational alerts go — advertising enquiries, urgent reports.
  /// Falls back to the from address if unset.
  adminAlertEmail: process.env.ADMIN_ALERT_EMAIL?.trim(),

  resend: {
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.RESEND_FROM ?? 'noreply@umastande.co.za',
    fromName: process.env.RESEND_FROM_NAME ?? 'Mastande',
    // Svix signing secret from the Resend dashboard. Without it the webhook
    // accepts unsigned calls, which would let anyone suppress any address.
    webhookSecret: process.env.RESEND_WEBHOOK_SECRET?.trim(),
  },

  whatsapp: {
    /**
     * The master switch for everything Meta charges for — Phase 8j.
     *
     * ⚠️ Default FALSE, and the default is the decision. Meta bills per
     * message: an authentication message to a South African number is about
     * USD $0.0095 plus VAT, from the first one, with no free allowance. On a
     * product that is free to list and free to apply, that is a per-head cost
     * with no revenue behind it, so the channel is off until somebody decides
     * to pay for it.
     *
     * When false, every outbound Cloud API call is skipped and the phone
     * sign-in endpoints refuse with a 503 that says so. Nothing is deleted:
     * the listing bot, the webhook, the templates and the landlord opt-in all
     * still exist, and setting this to true with credentials in place brings
     * the whole channel back.
     *
     * It does NOT gate wa.me links — sharing a room or calling a plumber opens
     * the person's own WhatsApp and Meta never bills for that.
     */
    enabled: process.env.WHATSAPP_ENABLED === 'true',
    apiVersion: process.env.WHATSAPP_API_VERSION ?? 'v19.0',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
    /**
     * Meta App Secret — signs every inbound webhook delivery.
     *
     * Not the same thing as WHATSAPP_VERIFY_TOKEN, which is a string you
     * choose and which Meta echoes back once, during the GET handshake, and
     * never again. The verify token proves nothing about any subsequent POST.
     */
    appSecret: process.env.WHATSAPP_APP_SECRET?.trim(),
    /**
     * The approved AUTHENTICATION template that carries a sign-in code.
     *
     * Unset until somebody has submitted one in the Meta console and Meta has
     * approved it. While it is unset, sendOtp falls back to free-form text —
     * which is correct in development, where nothing is sent at all, and does
     * NOT deliver in production: a sign-in code is business-initiated by
     * definition, so it is always outside Meta's 24-hour customer service
     * window and always rejected with 131047.
     */
    otpTemplate: process.env.WHATSAPP_TEMPLATE_OTP?.trim() || undefined,
    /**
     * The language a template was APPROVED under, not the reader's language.
     *
     * Meta treats name+language as the identity of a template: sending
     * `en_US` to a template approved as `en` fails with 132001 ("template name
     * does not exist"), which reads like a typo in the name and is not one.
     */
    templateLang: process.env.WHATSAPP_TEMPLATE_LANG?.trim() || 'en',
    /**
     * Where the Cloud API lives. An operator never sets this.
     *
     * It exists so scripts/whatsapp-template-drive.mjs can point the send at a
     * stub and read what we actually put on the wire. Every WhatsApp send in
     * this codebase was written from documentation and none of it had ever
     * been observed, which is how three paths shipped using a message type
     * Meta rejects.
     */
    graphBaseUrl: process.env.WHATSAPP_GRAPH_BASE_URL?.trim() || undefined,
  },

  /**
   * Performance instrumentation. Both are thresholds in milliseconds, and
   * both default to OFF (0), which is deliberate in two different ways.
   *
   * The API measured nothing at all before these existed — no request timing,
   * no slow-query log, no latency budget — while the frontend had Lighthouse
   * CI on every pull request and again weekly against production. That gap is
   * why a slow endpoint could only ever be discovered by somebody noticing on
   * their phone.
   *
   * Why they default to off rather than to a sensible number:
   *
   *   · Render's free plan gives no log retention worth the name and the
   *     instance has 512 MB. A log line per slow request is cheap; the point
   *     at which it stops being cheap depends on traffic nobody has measured
   *     yet, so the number is an operator's decision per environment rather
   *     than a constant compiled in.
   *   · A threshold of 0 would log EVERY request and EVERY statement, so
   *     treating "unset" as "log everything" is the one default that could
   *     turn instrumentation into an outage. Unset means silent.
   *
   * Suggested starting points, from the local measurements in
   * docs/PERFORMANCE-BASELINE.md: SLOW_REQUEST_MS=500 (everything except
   * login answered in 1-13 ms locally, and login is ~286 ms because of bcrypt
   * at 12 rounds, so 500 catches a real regression without logging the login
   * path on every sign-in), SLOW_QUERY_MS=100.
   */
  perf: {
    slowRequestMs: parseInt(process.env.SLOW_REQUEST_MS ?? '0', 10),
    slowQueryMs: parseInt(process.env.SLOW_QUERY_MS ?? '0', 10),
  },
});
