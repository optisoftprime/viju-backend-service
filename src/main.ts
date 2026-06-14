import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { isDevMode } from './common/utils/env';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.enableCors({
    origin: true,
    credentials: true,
  });

  app.setGlobalPrefix('api/v1');

  // Serve locally-stored uploads as publicly accessible files at /uploads/*
  // (outside the api/v1 prefix). No-op when STORAGE_PROVIDER=cloudinary, which
  // returns its own public secure_url.
  app.useStaticAssets(join(process.cwd(), process.env.UPLOAD_DIR || 'uploads'), {
    prefix: '/uploads/',
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Order matters: AllExceptionsFilter is the last-resort catch-all, so
  // register it FIRST and the more-specific Prisma filter SECOND. Nest
  // walks filters in reverse registration order, picking the most
  // specific match.
  app.useGlobalFilters(new AllExceptionsFilter(), new PrismaExceptionFilter());

  const config = new DocumentBuilder()
    .setTitle('Viju Customer Portal API')
    .setDescription(
      [
        'Backend API for the Viju Customer Portal (PRD v3.0).',
        '',
        '- Mobile app: distributor-facing endpoints (auth, home, payment, invoice, waybill, chat, support, profile).',
        '- Web portal: account-officer, regional-admin, loading/warehouse-officer, and admin endpoints.',
        '',
        'Auth: pass `Authorization: Bearer <jwt>` after logging in via /auth/customer/login (mobile) or /auth/staff/web-login (web).',
        '',
        'External data: balance, stock, invoices, orders, and payments are read from Viju ERP via an internal abstraction. The dev environment uses a mock that returns shaped sample data.',
      ].join('\n'),
    )
    .setVersion('1.0')
    // NOTE: do NOT pass a name here — it must match the default name used
    // by @ApiBearerAuth() on controllers. Naming this 'JWT' (or anything)
    // silently detaches the Authorize button from every endpoint.
    .addBearerAuth({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description:
        'JWT issued by /auth/customer/login or /auth/staff/login or /auth/staff/web-login',
    })
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: 'x-api-key',
        description: 'Shared secret (ERP_API_KEY) for ERP→app sync webhooks',
      },
      'x-api-key',
    )
    .addTag(
      'Authentication',
      'Customer OTP/password + staff ERP credential login + staff password reset',
    )
    .addTag('Push Notifications', 'Device push token registration (FCM/APNS)')
    .addTag(
      'Customer Portal',
      'Distributor self-service — home, payment, invoice, waybill, profile, statements (PRD F1-F8)',
    )
    .addTag(
      'Officer Portal',
      'Account officer dashboard + per-tab distributor detail (PRD F9-F11)',
    )
    .addTag(
      'Regional Admin Portal',
      'Regional dashboard + loading queue + officer assignment + warehouse officer queue (PRD F12-F13)',
    )
    .addTag(
      'Admin Portal',
      'Org dashboard, broadcasts, product flyers, audit, officer management (PRD F14-F19)',
    )
    .addTag(
      'Direct Messages',
      "Customer-officer chat. Customer sees only 'Viju Account Officer' label (PRD F6).",
    )
    .addTag('Support', 'Support tickets (PRD F7, F11)')
    .addTag(
      'ERP Webhooks',
      'Inbound webhooks from Viju ERP for balance/stock/purchase/payment sync',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });

  console.log('checks')

  const port = process.env.PORT || 3000;
  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`Application is running on: http://localhost:${port}/api/v1`);
  logger.log(`Swagger docs: http://localhost:${port}/api/docs`);

  if (isDevMode()) {
    logger.warn(
      '⚠️  DEV MODE: OTPs are returned in API responses. Never run with NODE_ENV !== "production" in prod.',
    );
  }
}
void bootstrap();
