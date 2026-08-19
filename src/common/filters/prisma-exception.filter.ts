import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

/**
 * Maps known Prisma errors to clean HTTP responses so the FE/QA sees
 * helpful messages like "Phone number already in use" instead of a 500
 * with a stack trace. Anything not mapped falls through to the generic
 * 500 (handled by AllExceptionsFilter).
 *
 * Codes reference: https://www.prisma.io/docs/orm/reference/error-reference
 */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('PrismaExceptionFilter');

  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    const { status, message, fields } = this.mapToHttp(exception);

    // Log the original at warn so we can still trace these in dev/prod,
    // but the client only sees the clean response.
    this.logger.warn(
      `Prisma ${exception.code} -> HTTP ${status} | ${message}` +
        (fields ? ` | fields=${fields.join(',')}` : ''),
    );

    res.status(status).json({
      statusCode: status,
      error: this.errorName(status),
      message,
      ...(fields ? { fields } : {}),
      code: exception.code,
    });
  }

  private mapToHttp(e: Prisma.PrismaClientKnownRequestError): {
    status: number;
    message: string;
    fields?: string[];
  } {
    const meta = e.meta ?? {};
    const target = this.extractTarget(meta);

    switch (e.code) {
      // Unique constraint violation
      case 'P2002':
        return {
          status: HttpStatus.CONFLICT,
          message: target.length
            ? `${this.humanize(target[0])} already in use`
            : 'Duplicate value violates a unique constraint',
          fields: target,
        };

      // Foreign key constraint failed
      case 'P2003':
        return {
          status: HttpStatus.BAD_REQUEST,
          message: target.length
            ? `Invalid reference for ${this.humanize(target[0])}`
            : 'Invalid foreign-key reference',
          fields: target,
        };

      // Value too long for column
      case 'P2000':
        return {
          status: HttpStatus.BAD_REQUEST,
          message: target.length
            ? `Value too long for ${this.humanize(target[0])}`
            : 'Value too long for one of the fields',
          fields: target,
        };

      // Record not found in where clause (.update/.delete on missing row)
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          message:
            (meta as { cause?: string }).cause ??
            'The requested record was not found',
        };

      // Record needed for connect/connectOrCreate not found
      case 'P2018':
        return {
          status: HttpStatus.NOT_FOUND,
          message: 'A required related record was not found',
        };

      // Null constraint violation
      case 'P2011':
        return {
          status: HttpStatus.BAD_REQUEST,
          message: target.length
            ? `${this.humanize(target[0])} is required`
            : 'A required field is missing',
          fields: target,
        };

      // Missing required value
      case 'P2012':
        return {
          status: HttpStatus.BAD_REQUEST,
          message: 'A required field is missing',
        };

      default:
        return {
          status: HttpStatus.BAD_REQUEST,
          message: `Database operation failed (${e.code})`,
        };
    }
  }

  /**
   * Pulls the conflicting field name(s) from Prisma's meta. The shape
   * varies by error: P2002 has `target: string | string[]`, P2003 has
   * `field_name: string`, etc.
   */
  private extractTarget(meta: Record<string, unknown>): string[] {
    if (Array.isArray(meta.target)) return meta.target as string[];
    if (typeof meta.target === 'string') {
      return meta.target.split(',').map((s) => s.trim());
    }
    if (typeof meta.field_name === 'string') {
      return [meta.field_name];
    }
    if (typeof meta.column_name === 'string') {
      return [meta.column_name];
    }
    return [];
  }

  /** Convert "phoneNumber" / "phone_number" -> "Phone number". */
  private humanize(field: string): string {
    const spaced = field
      .replace(/_/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .trim();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }

  private errorName(status: number): string {
    return (
      {
        [HttpStatus.BAD_REQUEST]: 'Bad Request',
        [HttpStatus.NOT_FOUND]: 'Not Found',
        [HttpStatus.CONFLICT]: 'Conflict',
      }[status] ?? 'Error'
    );
  }
}
