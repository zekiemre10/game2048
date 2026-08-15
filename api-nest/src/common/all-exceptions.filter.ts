import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { Response } from 'express';
import { MongoServerError } from 'mongodb';

/**
 * Global hata dönüştürücü — app.py _dispatch huni mantığıyla birebir:
 *   HttpException({error}) → aynen ({error: code} + durum)
 *   Mongo duplicate key (11000) → 409 {"error":"conflict"}
 *   diğer beklenmeyen → 500 {"error":"server_error"}
 * Gövde daima {"error": "<code>"}.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      // apiError zaten {error} verir; Nest'in ham {statusCode,message} zarfını normalize et
      if (body && typeof body === 'object' && 'error' in (body as any)) {
        res.status(status).json({ error: (body as any).error });
      } else {
        const msg =
          typeof body === 'string'
            ? body
            : ((body as any)?.message ?? 'bad_request');
        res.status(status).json({ error: Array.isArray(msg) ? msg[0] : msg });
      }
      return;
    }

    if (exception instanceof MongoServerError && exception.code === 11000) {
      res.status(409).json({ error: 'conflict' });
      return;
    }

    // Beklenmeyen — sızıntı yapma, jenerik 500.
    res.status(500).json({ error: 'server_error' });
  }
}
