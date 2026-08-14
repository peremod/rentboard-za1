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
    publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
    privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
    urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
  },

  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    prices: {
      proMonthly: process.env.STRIPE_PRICE_PRO_MONTHLY,
      proAnnual: process.env.STRIPE_PRICE_PRO_ANNUAL,
      agencyMonthly: process.env.STRIPE_PRICE_AGENCY_MONTHLY,
      agencyAnnual: process.env.STRIPE_PRICE_AGENCY_ANNUAL,
      passportMonthly: process.env.STRIPE_PRICE_PASSPORT_MONTHLY,
      passportAnnual: process.env.STRIPE_PRICE_PASSPORT_ANNUAL,
      roomBoost: process.env.STRIPE_PRICE_ROOM_BOOST,
    },
  },

  resend: {
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.RESEND_FROM ?? 'noreply@rentboard.co.za',
    fromName: process.env.RESEND_FROM_NAME ?? 'RentBoard',
  },

  whatsapp: {
    apiVersion: process.env.WHATSAPP_API_VERSION ?? 'v19.0',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
  },
});
