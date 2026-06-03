import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { isDevMode } from './common/utils/env';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: true,
    credentials: true,
  });

  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

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
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'JWT issued by /auth/customer/login or /auth/staff/web-login',
      },
      'JWT',
    )
    .addTag(
      'Authentication',
      'Customer OTP/password + staff ERP credential login',
    )
    .addTag('Push Notifications', 'Device push token registration')
    .addTag('Customer', 'Distributor self-service (mobile app)')
    .addTag('Officer', 'Account officer endpoints (web portal)')
    .addTag('Admin', 'Administrator endpoints (web portal)')
    .addTag('Chat', 'Conversation between distributor and account officer')
    .addTag('Support', 'Support tickets')
    .addTag('ERP Sync', 'Inbound webhooks from Viju ERP')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });

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
