import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * Last-resort filter: catches anything that wasn't already handled by
 * Nest's built-in HttpException filter or our PrismaExceptionFilter.
 *
 * - HttpException → forward its status/body unchanged
 * - everything else → 500 with a generic message + full stack to the log
 *
 * This stops naked Error / TypeError / etc from leaking stack traces to
 * the client while still preserving full server-side observability.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('AllExceptionsFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      res
        .status(status)
        .json(
          typeof body === 'string'
            ? { statusCode: status, message: body }
            : body,
        );
      return;
    }

    const err = exception as Error;
    this.logger.error(
      `Unhandled error on ${req.method} ${req.url}: ${err?.message ?? exception}`,
      err?.stack,
    );

    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message:
        'Something went wrong on our end. The error has been logged; please try again.',
    });
  }
}
