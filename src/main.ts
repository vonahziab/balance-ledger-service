import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { ConsoleLogger, Logger } from '@nestjs/common';
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

// Указывает на корень проекта и из `src/`, и из `dist/`.
const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

async function bootstrap(): Promise<void> {
  // Логи буферизуются, пока не подключён логгер с уровнем из LOG_LEVEL.
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
  // Без `upgrade-insecure-requests`: сервис работает по обычному HTTP, а с
  // этой директивой браузер запрашивал бы ресурсы Swagger UI по HTTPS.
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

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Balance Ledger Service')
    .setDescription(
      'Сервис баланса на базе леджера. Все суммы — целые числа в центах.',
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
