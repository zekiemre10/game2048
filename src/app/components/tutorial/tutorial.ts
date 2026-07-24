import { Component, computed, inject, output, signal } from '@angular/core';
import { I18nService } from '../../services/i18n.service';

// ============================================================
//  2048 — İlk oyun rehberi (onboarding)
//  Yeni oyuncuya oyunun temelini ve keşfedilmesi zor özellikleri
//  (modlar, güçler, YZ asistanı, çevrimiçi) kısaca tanıtır.
//  Yalnızca bir kez gösterilir; Ayarlar'dan tekrar açılabilir.
// ============================================================

/** Rehber adımı: simge + başlık + açıklama (çeviri anahtarları). */
interface Step {
  icon: string;
  titleKey: string;
  bodyKey: string;
}

const STEPS: Step[] = [
  { icon: '🎯', titleKey: 'tut.s1.title', bodyKey: 'tut.s1.body' },
  { icon: '⌨️', titleKey: 'tut.s2.title', bodyKey: 'tut.s2.body' },
  { icon: '🎮', titleKey: 'tut.s3.title', bodyKey: 'tut.s3.body' },
  { icon: '⚡', titleKey: 'tut.s4.title', bodyKey: 'tut.s4.body' },
  { icon: '🤖', titleKey: 'tut.s5.title', bodyKey: 'tut.s5.body' },
  { icon: '🏁', titleKey: 'tut.s6.title', bodyKey: 'tut.s6.body' },
];

@Component({
  selector: 'app-tutorial',
  standalone: true,
  imports: [],
  templateUrl: './tutorial.html',
  styleUrl: './tutorial.scss',
})
export class Tutorial {
  private readonly i18n = inject(I18nService);
  protected readonly t = (key: string) => this.i18n.t(key);

  /** Rehber kapatıldı (tamamlandı veya atlandı). */
  readonly closed = output<void>();

  protected readonly STEPS = STEPS;
  protected readonly index = signal(0);

  protected readonly step = computed(() => STEPS[this.index()]);
  protected readonly isLast = computed(() => this.index() === STEPS.length - 1);
  protected readonly total = STEPS.length;

  next(): void {
    if (this.isLast()) this.closed.emit();
    else this.index.update((i) => i + 1);
  }

  back(): void {
    if (this.index() > 0) this.index.update((i) => i - 1);
  }

  skip(): void {
    this.closed.emit();
  }

  /** Noktalara tıklayarak adım atlama. */
  goTo(i: number): void {
    this.index.set(i);
  }
}
