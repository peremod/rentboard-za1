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
});
