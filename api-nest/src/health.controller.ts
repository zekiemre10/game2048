import { Controller, Get } from '@nestjs/common';

/** GET /health → {ok:true} (app.py:1084). Public liveness. */
@Controller()
export class HealthController {
  @Get('health')
  health() {
    return { ok: true };
  }
}
