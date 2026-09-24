import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { ConsoleLogger, Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { requestLogger } from './common/middleware/request-logger.middleware.js';
import {
  type EnvironmentVariables,
  LOG_LEVELS,
} from './config/env.validation.js';

// Resolves to the project root from both `src/` and `dist/`.
const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

async function bootstrap(): Promise<void> {
  // Logs are buffered until the logger configured from LOG_LEVEL is attached.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  const config = app.get(ConfigService<EnvironmentVariables, true>);

  const logLevel = config.get('LOG_LEVEL', { infer: true });
  app.useLogger(
    new ConsoleLogger({
      logLevels: LOG_LEVELS.slice(0, LOG_LEVELS.indexOf(logLevel) + 1),
    }),
  );

  app.use(requestLogger);
  // No `upgrade-insecure-requests`: the service is served over plain HTTP, and
  // the directive would make browsers fetch Swagger UI assets over HTTPS.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: { upgradeInsecureRequests: null },
      },
    }),
  );

  const corsOrigins = (config.get('CORS_ORIGIN', { infer: true }) ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (corsOrigins.length > 0) {
    app.enableCors({ origin: corsOrigins });
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Balance Ledger Service')
    .setDescription(
      'Ledger-based balance service. All amounts are integer cents.',
    )
    .setVersion(version)
    .build();
  SwaggerModule.setup(
    'docs',
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
  );

  app.enableShutdownHooks();

  const port = config.get('PORT', { infer: true });
  await app.listen(port);
  new Logger('Bootstrap').log(
    `Listening on http://localhost:${port}, Swagger at /docs`,
  );
}

await bootstrap();
