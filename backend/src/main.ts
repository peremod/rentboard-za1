import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true, // required for Stripe webhook signature verification
  });

  const isProduction = process.env.NODE_ENV === 'production';

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

  app.enableCors({
    origin: isProduction
      ? ['https://rentboard.co.za', 'https://www.rentboard.co.za']
      : ['http://localhost:4200'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'stripe-signature'],
  });

  app.setGlobalPrefix('api', { exclude: ['health'] });

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
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
    logger.log('Swagger docs: http://localhost:3000/api/docs');
  }

  const port = parseInt(process.env.PORT ?? '3000', 10);
  await app.listen(port);
  logger.log(`RentBoard API running on port ${port} [${process.env.NODE_ENV}]`);
}

bootstrap();
