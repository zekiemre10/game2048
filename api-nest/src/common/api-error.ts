import { HttpException } from '@nestjs/common';

/**
 * app.py hata zarfı ile birebir: gövde HER ZAMAN {"error": "<code>"}.
 * İstemciler bu string kodlara göre dallanır (already_started, not_host,
 * invalid_score, unauthorized...). Kod + HTTP durumunu birlikte taşır.
 */
export function apiError(status: number, code: string): HttpException {
  return new HttpException({ error: code }, status);
}
