'use client';
// Chart.js 4 per DS v1.0: orange bars, the latest bar full strength and the rest tinted, comparison as a dashed line; line mode keeps
// the smooth area. Ink tooltip, draw-in 600ms easeOutQuart.
import { useEffect, useRef } from 'react';
import { Chart, LineController, LineElement, PointElement, BarController, BarElement, CategoryScale, LinearScale, Filler, Tooltip } from 'chart.js';
Chart.register(LineController, LineElement, PointElement, BarController, BarElement, CategoryScale, LinearScale, Filler, Tooltip);

/** compare: dashed grey line · forecast: dashed accent line · band: a low/high pair (low first) filled between, line mode */
export interface Series { label: string; data: number[]; compare?: boolean; forecast?: boolean; band?: 'low' | 'high' }
export function LineChart({ labels, series, height = 240, kind = 'bar', format = (v: number) => String(v) }: { labels: string[]; series: Series[]; height?: number; kind?: 'line' | 'bar'; format?: (v: number) => string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  // rebuild only when the numbers change: callers pass fresh arrays on every render (clock ticks), which restarted the draw-in from zero
  const key = JSON.stringify([labels, series, kind]), fmt = useRef(format); fmt.current = format;
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const css = getComputedStyle(el), accent = css.getPropertyValue('--role').trim() || '#FF6A00', muted = css.getPropertyValue('--ink-300').trim(), grid = css.getPropertyValue('--border').trim(), fg2 = css.getPropertyValue('--fg-2').trim();
    const c = new Chart(el, {
      type: kind,
      data: { labels, datasets: series.map(s => {
        const now = s.data.reduce((a, v, i) => (v ? i : a), -1);
        if (s.band) return { label: s.label, data: s.data, tension: .4, borderWidth: 0, pointRadius: 0, pointHoverRadius: 0, borderColor: 'transparent', backgroundColor: accent + '24', fill: s.band === 'high' ? '-1' : false, order: 2 };
        if (s.forecast) return { label: s.label, data: s.data, tension: .4, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, borderColor: accent, borderDash: [6, 4], backgroundColor: 'transparent', fill: false, order: 1 };
        return kind === 'bar' && s.compare ? { type: 'line' as const, label: s.label, data: s.data, tension: .4, borderWidth: 1.5, pointRadius: 0, borderColor: muted, borderDash: [5, 5], backgroundColor: 'transparent', fill: false, order: 0 } : {
        label: s.label, data: s.data, tension: .4, borderWidth: kind === 'bar' ? 0 : s.compare ? 1.5 : 2.5, pointRadius: 0, pointHoverRadius: 4,
        borderColor: s.compare ? muted : accent, borderDash: s.compare ? [5, 5] : [], order: 1,
        backgroundColor: kind === 'bar' ? s.data.map((_, i) => (i === now ? accent : accent + '59')) : (ctx: { chart: Chart }) => {
          if (s.compare) return 'transparent'; const { ctx: g, chartArea: a } = ctx.chart; if (!a) return 'transparent';
          const gr = g.createLinearGradient(0, a.top, 0, a.bottom); gr.addColorStop(0, accent + '38'); gr.addColorStop(1, accent + '00'); return gr;
        }, fill: kind === 'line' && !s.compare, borderRadius: kind === 'bar' ? 6 : 0, borderSkipped: false, maxBarThickness: 22,
      }; }) },
      options: { responsive: true, maintainAspectRatio: false, animation: { duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 600, easing: 'easeOutQuart' },
        interaction: { mode: 'index', intersect: false },
        plugins: { tooltip: { backgroundColor: '#0F172A', padding: 10, cornerRadius: 10, callbacks: { label: (i: { dataset: { label?: string }; parsed: { y: number | null } }) => ` ${i.dataset.label}: ${fmt.current(i.parsed.y ?? 0)}` } }, legend: { display: false } },
        scales: { x: { grid: { display: false }, ticks: { color: fg2, maxRotation: 0, autoSkipPadding: 12, font: { family: "'Satoshi', system-ui, sans-serif" } } },
          y: { grid: { color: grid }, border: { display: false }, ticks: { color: fg2, callback: (v: string | number) => fmt.current(Number(v)), font: { family: "'Satoshi', system-ui, sans-serif" } } } } },
    });
    return () => c.destroy();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return <div style={{ height, position: 'relative' }}><canvas ref={ref} /></div>;
}
