import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Response } from 'express';

/**
 * app.py başarı yanıtları HER ZAMAN 200'dür (POST dahil). Nest POST'ta
 * varsayılan 201 döner; istemciler 200 bekleyebilir → tüm başarılı yanıtı
 * 200'e sabitle (hata durumları filtreden geçer, etkilenmez).
 */
@Injectable()
export class Http200Interceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const res = ctx.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      tap(() => {
        if (res.statusCode === 201) res.statusCode = 200;
      }),
    );
  }
}
