import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaExceptionFilter } from './prisma-exception.filter';

/**
 * A database that has dropped the connection is not a bad request.
 *
 * Production logged `Prisma P1017 -> HTTP 400 | Database operation failed`
 * while the server was closing connections. The caller could not have fixed
 * that by changing anything they sent, and a 4xx kept a real outage out of
 * every alert that watches for server errors.
 */
describe('PrismaExceptionFilter — the connection family', () => {
  const respond = (code: string) => {
    const filter = new PrismaExceptionFilter();
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({ getResponse: () => ({ status }) }),
    };
    filter.catch(
      new Prisma.PrismaClientKnownRequestError('boom', {
        code,
        clientVersion: 'test',
      }),
      host as never,
    );
    return { status: status.mock.calls[0][0], body: json.mock.calls[0][0] };
  };

  for (const code of ['P1000', 'P1001', 'P1002', 'P1008', 'P1017']) {
    it(`answers 503 for ${code}, not 400`, () => {
      const { status, body } = respond(code);

      expect(status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      expect(body.error).toBe('Service Unavailable');
      // The caller is told to retry, not that they sent something wrong.
      expect(body.message).toMatch(/temporarily unavailable/i);
      // The original code still travels, so support can match the log to the response.
      expect(body.code).toBe(code);
    });
  }

  it('still answers 409 for a unique violation', () => {
    // The rest of the mapping is untouched.
    const { status } = respond('P2002');
    expect(status).toBe(HttpStatus.CONFLICT);
  });

  it('still answers 400 for an unrecognised code', () => {
    const { status } = respond('P2099');
    expect(status).toBe(HttpStatus.BAD_REQUEST);
  });
});
