import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { GameService } from '../../services/game.service';
import { I18nService } from '../../services/i18n.service';
import { Direction } from '../../models/tile.model';
import { TimelinePoint, bestMove, findTurningPoint } from '../../logic/ai';

/** Grafikte gösterilecek en fazla nokta (mobilde tıklanabilir kalsın diye). */
const MAX_NODES = 60;
const VIEW_W = 320;
const VIEW_H = 108;
const PAD_L = 6;
const PAD_R = 6;
const PAD_T = 8;
const PAD_B = 16;

interface ChartNode {
  i: number; // tam çizelgedeki dizin
  move: number;
  x: number;
  y: number;
  health: number;
  inaccurate: boolean;
  turning: boolean;
}

/**
 * Oyun sonu hamle zaman çizelgesi: "oyunu nerede kaybettin?"
 *
 * Yatay eksende hamleler, dikeyde pozisyon sağlığı (0-100). Hatalı hamleler
 * kırmızı işaretlenir; sağlığın en sert düştüğü hamle (dönüm noktası) vurgulanır.
 * Bir hamleye tıklayınca o andaki tahta + YZ'nin önerdiği hamle gösterilir.
 * Üç parça da hazırdı (reviewMove/positionHealth/bestMove); bu bileşen onları
 * görselleştirir. Asistan kapalıyken de sağlık eğrisi + dönüm noktası çalışır
 * (yalnız hamle-kalitesi işaretleri asistana bağlıdır).
 */
@Component({
  selector: 'app-move-timeline',
  standalone: true,
  templateUrl: './move-timeline.html',
  styleUrl: './move-timeline.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MoveTimeline {
  private readonly game = inject(GameService);
  private readonly i18n = inject(I18nService);

  protected readonly t = (key: string, params?: Record<string, string | number>) =>
    this.i18n.t(key, params);

  protected readonly VIEW_W = VIEW_W;
  protected readonly VIEW_H = VIEW_H;
  protected readonly X_START = PAD_L;
  protected readonly X_END = VIEW_W - PAD_R;

  protected readonly timeline = this.game.moveTimeline;
  protected readonly assistantOn = this.game.assistantOn;

  /** Seçili hamlenin (tam çizelgedeki) dizini; başlangıçta dönüm noktası. */
  private readonly selectedIndex = signal<number | null>(null);

  /** Sağlığın en sert düştüğü hamlenin dizini (dönüm noktası). */
  protected readonly turningIdx = computed(() => findTurningPoint(this.timeline()));

  /** Grafik geometrisi: seyreltilmiş noktalar + sağlık eğrisi (path). */
  protected readonly chart = computed(() => {
    const pts = this.timeline();
    const n = pts.length;
    const turning = this.turningIdx();
    if (n === 0) return { nodes: [] as ChartNode[], path: '', area: '' };

    // Seyreltme: en fazla MAX_NODES nokta; ilk/son/dönüm + hatalı hamleler daima.
    const keep = new Set<number>();
    const stride = Math.max(1, Math.ceil(n / MAX_NODES));
    for (let i = 0; i < n; i += stride) keep.add(i);
    keep.add(0);
    keep.add(n - 1);
    if (turning >= 0) keep.add(turning);
    for (let i = 0; i < n; i++) if (pts[i].rating === 'inaccurate') keep.add(i);
    const idxs = [...keep].sort((a, b) => a - b).slice(0, MAX_NODES * 2);

    const innerW = VIEW_W - PAD_L - PAD_R;
    const innerH = VIEW_H - PAD_T - PAD_B;
    const xOf = (i: number) => (n === 1 ? PAD_L + innerW / 2 : PAD_L + (i / (n - 1)) * innerW);
    const yOf = (h: number) => PAD_T + (1 - Math.max(0, Math.min(100, h)) / 100) * innerH;

    const nodes: ChartNode[] = idxs.map((i) => ({
      i,
      move: pts[i].move,
      x: Math.round(xOf(i) * 10) / 10,
      y: Math.round(yOf(pts[i].health) * 10) / 10,
      health: pts[i].health,
      inaccurate: pts[i].rating === 'inaccurate',
      turning: i === turning,
    }));

    const path = nodes.map((p, k) => `${k === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    const baseY = PAD_T + innerH;
    const area =
      nodes.length > 0
        ? `M ${nodes[0].x} ${baseY} ${nodes.map((p) => `L ${p.x} ${p.y}`).join(' ')} L ${nodes[nodes.length - 1].x} ${baseY} Z`
        : '';
    return { nodes, path, area };
  });

  /** Dönüm noktası özeti (metin): "X. hamlede sağlık %A → %B düştü". */
  protected readonly turningSummary = computed(() => {
    const pts = this.timeline();
    const ti = this.turningIdx();
    if (ti < 1) return null;
    return { move: pts[ti].move, from: pts[ti - 1].health, to: pts[ti].health };
  });

  /** Seçili hamlenin ayrıntısı: karar-anı tahtası + oynanan + YZ önerisi. */
  protected readonly detail = computed(() => {
    const pts = this.timeline();
    const sel = this.selectedIndex() ?? this.turningIdx();
    if (sel < 0 || sel >= pts.length) return null;
    const p = pts[sel];
    // YZ önerisi kayıtlıysa onu kullan; asistan kapalıydıysa şimdi hesapla.
    const best = p.best ?? bestMove(p.grid, 'expert');
    return {
      move: p.move,
      played: p.direction,
      best,
      rating: p.rating,
      health: p.health,
      rows: p.grid, // number[][] — karar anı tahtası
    };
  });

  /** Ekran okuyucu için hatalı hamlelerin numaraları (grafik metin karşılığı). */
  protected readonly inaccurateMoves = computed(() =>
    this.timeline()
      .filter((p) => p.rating === 'inaccurate')
      .map((p) => p.move),
  );

  /**
   * Grafiğin metin karşılığı (ekran okuyucu + aria-label): hamle sayısı, dönüm
   * noktası ve (asistan açıksa) hatalı hamlelerin numaraları.
   */
  protected readonly a11ySummary = computed(() => {
    const pts = this.timeline();
    const ts = this.turningSummary();
    const inacc = this.inaccurateMoves();
    const parts = [this.t('tl.a11yMoves', { n: pts.length })];
    if (ts) parts.push(this.t('tl.a11yTurning', { n: ts.move, a: ts.from, b: ts.to }));
    if (this.assistantOn() && inacc.length > 0) {
      parts.push(this.t('tl.a11yErrors', { list: inacc.join(', ') }));
    }
    return parts.join(' ');
  });

  /** Sağlık değerinin grafikteki y koordinatı (eşik çizgileri için). */
  protected yFor(h: number): number {
    const innerH = VIEW_H - PAD_T - PAD_B;
    return Math.round((PAD_T + (1 - h / 100) * innerH) * 10) / 10;
  }

  /** Bir grafik noktasını (hamleyi) seç. */
  select(i: number): void {
    this.selectedIndex.set(i);
  }

  /** Yön → ok işareti. */
  protected arrow(d: Direction | null): string {
    if (d === null) return '–';
    return d === Direction.Left
      ? '←'
      : d === Direction.Right
        ? '→'
        : d === Direction.Up
          ? '↑'
          : '↓';
  }

  /** Kare değerine göre arka plan (0 = boş hücre; büyüdükçe belirginleşir). */
  protected cellColor(v: number): string {
    if (v <= 0) return 'var(--color-cell-empty)';
    const e = Math.log2(v);
    const hue = (25 + e * 26) % 360;
    const light = Math.max(42, 82 - e * 4);
    return `hsl(${hue}, 68%, ${light}%)`;
  }

  /** Sağlık puanına göre eğri rengi sınıfı (İyi/Riskli/Tehlikeli). */
  protected healthClass(h: number): string {
    return h >= 60 ? 'h-good' : h >= 32 ? 'h-risky' : 'h-danger';
  }
}
