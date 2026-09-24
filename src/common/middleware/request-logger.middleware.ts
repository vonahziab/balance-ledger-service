import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

const logger = new Logger('HTTP');

/**
 * Пишет строку на каждый запрос: метод, путь, статус и время ответа.
 *
 * Подключается через `app.use()` в `main.ts` до Swagger, поэтому покрывает
 * и `/docs`, и несуществующие маршруты, которые `MiddlewareConsumer` Nest
 * пропускает.
 */
export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    logger.log(
      `${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms`,
    );
  });

  next();
}
