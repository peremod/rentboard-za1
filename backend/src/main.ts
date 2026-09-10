import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { validateEnvironment, corsOrigins, isProductionDeployment, appEnv } from './config/environment';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Before anything else. A misconfigured environment should fail here, loudly,
  // rather than serve traffic that is subtly wrong for a week.
  validateEnvironment();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true, // required for Stripe webhook signature verification
  });

  /**
   * Deployment environment, not build environment. NODE_ENV is `production` on
   * staging too — see config/environment.ts for why that distinction matters
   * and what it broke.
   */
  const isProduction = isProductionDeployment();

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'js.stripe.com'],
        connectSrc: ["'self'", 'api.stripe.com', 'graph.facebook.com'],
        imgSrc: ["'self'", 'data:', 'ik.imagekit.io'],
        frameSrc: ['js.stripe.com', 'hooks.stripe.com'],
      },
    },
  }));
  app.use(compression({ threshold: 1024 }));
  app.use(cookieParser());

  app.enableCors({
    // Derived from APP_ENV and FRONTEND_URL. The previous hard-coded pair keyed
    // off NODE_ENV, so Render staging allowed only rentboard.co.za and rejected
    // every request from the staging frontend.
    origin: corsOrigins(),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'stripe-signature'],
  });

  app.setGlobalPrefix('api', { exclude: ['health', 'robots.txt', 'sitemap.xml'] });

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
    transformOptions: { enableImplicitConversion: true },
  }));

  if (!isProduction) {
    const config = new DocumentBuilder()
      .setTitle('RentBoard ZA API')
      .setDescription('Room-letting platform API for South Africa')
      .setVersion('1.1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
    logger.log('Swagger docs: http://localhost:3000/api/docs');
  }

  /**
   * Graceful shutdown — important in production. When Railway (or Docker)
   * sends SIGTERM to stop the container during a deploy or scale-down,
   * this makes Nest run every registered OnModuleDestroy hook — including
   * PrismaService's (see prisma/prisma.service.ts, built in pass 0.1.0) —
   * before the process actually exits. Without it, in-flight requests and
   * open DB connections get killed mid-operation on every deploy.
   */
  app.enableShutdownHooks();

  const port = parseInt(process.env.PORT ?? '3000', 10);
  await app.listen(port);
  // Both values, always. Seeing `APP_ENV=staging NODE_ENV=production` in the
  // logs is the fastest way to confirm the distinction is working rather than
  // wondering which one a given behaviour keyed off.
  logger.log(
    `RentBoard API on port ${port} — APP_ENV=${appEnv()} NODE_ENV=${process.env.NODE_ENV ?? 'unset'}`,
  );
}

bootstrap();
