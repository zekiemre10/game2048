import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  input,
} from '@angular/core';

// ============================================================
//  2048 — Konfeti (kutlama animasyonu)
//  Bağımlılıksız, tek canvas üzerinde parçacık simülasyonu.
//  `burst` sinyali her arttığında yeni bir patlama başlar.
//  prefers-reduced-motion açıksa hiç animasyon yapmaz.
// ============================================================

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  size: number;
  color: string;
  life: number;
}

const COLORS = ['#f6c945', '#e8503a', '#3fa96b', '#4d7cfe', '#c651e0', '#ff8a3d'];

@Component({
  selector: 'app-confetti',
  standalone: true,
  imports: [],
  template: `<canvas #cv class="confetti-canvas" aria-hidden="true"></canvas>`,
  styles: [
    `
      .confetti-canvas {
        position: fixed;
        inset: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 60;
      }
    `,
  ],
})
export class Confetti implements AfterViewInit, OnDestroy {
  /** Her artışta yeni patlama tetikler (0 → hiç patlama yok). */
  readonly burst = input<number>(0);

  @ViewChild('cv') private canvasRef!: ElementRef<HTMLCanvasElement>;

  private ctx: CanvasRenderingContext2D | null = null;
  private particles: Particle[] = [];
  private raf: number | null = null;
  private lastBurst = 0;
  private reduced = false;

  ngAfterViewInit(): void {
    if (typeof window === 'undefined') return;
    this.reduced =
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const cv = this.canvasRef.nativeElement;
    this.ctx = cv.getContext('2d');
    this.resize();
    window.addEventListener('resize', this.resize);

    // burst sinyalini gözlemek için basit bir kontrol döngüsü:
    // input signal'i effect ile izlemek yerine animasyon karesinde bakıyoruz.
    this.loop();
  }

  ngOnDestroy(): void {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.resize);
    }
  }

  private resize = (): void => {
    const cv = this.canvasRef?.nativeElement;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = window.innerWidth * dpr;
    cv.height = window.innerHeight * dpr;
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  /** Yeni parçacık dalgası oluşturur (ekranın üstünden aşağı yağar). */
  private spawn(): void {
    if (this.reduced) return;
    const w = window.innerWidth;
    const count = 90;
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: w * (0.15 + Math.random() * 0.7),
        y: -20 - Math.random() * 40,
        vx: (Math.random() - 0.5) * 4,
        vy: 2 + Math.random() * 4,
        rot: Math.random() * Math.PI,
        vrot: (Math.random() - 0.5) * 0.3,
        size: 5 + Math.random() * 6,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        life: 1,
      });
    }
  }

  private loop = (): void => {
    // input burst değişimini yakala
    const b = this.burst();
    if (b > this.lastBurst) {
      this.lastBurst = b;
      this.spawn();
    }

    const ctx = this.ctx;
    if (ctx) {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      const h = window.innerHeight;
      for (const p of this.particles) {
        p.vy += 0.08; // yerçekimi
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vrot;
        if (p.y > h * 0.75) p.life -= 0.02; // zeminde solar

        ctx.save();
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      }
      // Ölmüş/ekran dışı parçacıkları at
      this.particles = this.particles.filter(
        (p) => p.life > 0 && p.y < h + 40,
      );
    }

    this.raf = requestAnimationFrame(this.loop);
  };
}
