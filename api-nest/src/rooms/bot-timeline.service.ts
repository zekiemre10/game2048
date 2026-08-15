import { Injectable } from '@nestjs/common';
import { mulberry32, moveGrid, spawn, maxOf } from '../replay/replay';
import { BOT_SPEED_MS, botMaxMoves, botMoveCfg, resolveCfg } from './bot-ai';

interface Timeline {
  speed: number;
  scores: number[];
  bests: number[];
}

/**
 * Sunucu tarafı bot skor ZAMAN ÇİZELGESİ — app.py _bot_timelines birebir.
 * Yarış başında tohumdan botun oyununu (deterministik) oynatıp kümülatif skor
 * çizelgesini bellekte tutar; room_state geçen süreye göre skoru buradan üretir.
 * Bot skoru İSTEMCİDEN ASLA alınmaz (manipüle edilemez). Python thread'i yerine
 * event-loop'u bloklamayan CHUNKED async hesap (parça parça, artımlı yayın).
 */
@Injectable()
export class BotTimelineService {
  private timelines = new Map<string, Timeline>();
  private computing = new Set<string>();

  private key(code: string, botId: number): string {
    return `${code}|${botId}`;
  }

  /** Çizelge yoksa arka planda hesaplat (bloklamaz, tek sefer). */
  ensure(code: string, botId: number, seed: number, level: string | null, duration: number): void {
    const k = this.key(code, botId);
    if (this.timelines.has(k) || this.computing.has(k)) return;
    this.computing.add(k);
    // Fire-and-forget; hata olsa da odayı düşürme.
    void this.compute(code, botId, seed, level || 'medium', duration).finally(() => {
      this.computing.delete(k);
    });
  }

  /** Geçen süreye göre (skor, best, done). Çizelge henüz yoksa (0,0,false). */
  scoreAt(code: string, botId: number, elapsedMs: number): { score: number; best: number; done: boolean } {
    const tl = this.timelines.get(this.key(code, botId));
    if (!tl || tl.scores.length <= 1) return { score: 0, best: 0, done: false };
    const last = tl.scores.length - 1;
    let moves = Math.floor(elapsedMs / tl.speed);
    if (moves > last) moves = last;
    return { score: tl.scores[moves], best: tl.bests[moves], done: moves >= last };
  }

  /** Oda kapanınca/yeniden başlayınca o odanın çizelgelerini bellekten sil. */
  drop(code: string): void {
    for (const k of [...this.timelines.keys()]) if (k.startsWith(code + '|')) this.timelines.delete(k);
    for (const k of [...this.computing]) if (k.startsWith(code + '|')) this.computing.delete(k);
  }

  private async compute(
    code: string, botId: number, seed: number, level: string, duration: number,
  ): Promise<void> {
    const cfg = resolveCfg(level);
    const speed = BOT_SPEED_MS[level] ?? 360;
    const maxMoves = botMaxMoves(level, duration);
    const size = 4;
    const k = this.key(code, botId);

    const rand = mulberry32(seed >>> 0);
    let grid = Array.from({ length: size }, () => new Array(size).fill(0));
    spawn(grid, rand);
    spawn(grid, rand);

    const scores = [0];
    const bests = [maxOf(grid)];
    let score = 0;
    const publish = () => this.timelines.set(k, { speed, scores: [...scores], bests: [...bests] });
    publish();

    for (let i = 0; i < maxMoves; i++) {
      const d = botMoveCfg(grid, cfg);
      if (d === null) break;
      const res = moveGrid(grid, d);
      if (!res.moved) break;
      grid = res.grid;
      score += res.gained;
      spawn(grid, rand);
      scores.push(score);
      bests.push(maxOf(grid));
      if ((i + 1) % 32 === 0) {
        publish();
        // Event-loop'u serbest bırak (ağır Uzman hesabı istekleri bloklamasın).
        await new Promise<void>((r) => setImmediate(r));
      }
    }
    publish();
  }
}
