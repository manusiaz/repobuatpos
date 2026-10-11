'use client';
// Chart.js 4 per DS: smooth tension .4, Ember area 22% → 0%, dashed comparison, ink tooltip, draw-in 600ms easeOutQuart.
import { useEffect, useRef } from 'react';
import { Chart, LineController, LineElement, PointElement, BarController, BarElement, CategoryScale, LinearScale, Filler, Tooltip } from 'chart.js';
Chart.register(LineController, LineElement, PointElement, BarController, BarElement, CategoryScale, LinearScale, Filler, Tooltip);

export interface Series { label: string; data: number[]; compare?: boolean }
export function LineChart({ labels, series, height = 240, kind = 'line', format = (v: number) => String(v) }: { labels: string[]; series: Series[]; height?: number; kind?: 'line' | 'bar'; format?: (v: number) => string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const css = getComputedStyle(el), accent = css.getPropertyValue('--role').trim() || '#F26B1D', muted = css.getPropertyValue('--ink-300').trim(), grid = css.getPropertyValue('--border').trim(), fg2 = css.getPropertyValue('--fg-2').trim();
    const c = new Chart(el, {
      type: kind,
      data: { labels, datasets: series.map(s => ({
        label: s.label, data: s.data, tension: .4, borderWidth: s.compare ? 1.5 : 2.5, pointRadius: 0, pointHoverRadius: 4,
        borderColor: s.compare ? muted : accent, borderDash: s.compare ? [5, 5] : [], backgroundColor: kind === 'bar' ? (s.compare ? muted : accent) : (ctx: { chart: Chart }) => {
          if (s.compare) return 'transparent'; const { ctx: g, chartArea: a } = ctx.chart; if (!a) return 'transparent';
          const gr = g.createLinearGradient(0, a.top, 0, a.bottom); gr.addColorStop(0, accent + '38'); gr.addColorStop(1, accent + '00'); return gr;
        }, fill: kind === 'line' && !s.compare, borderRadius: kind === 'bar' ? 6 : 0,
      })) },
      options: { responsive: true, maintainAspectRatio: false, animation: { duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 600, easing: 'easeOutQuart' },
        interaction: { mode: 'index', intersect: false },
        plugins: { tooltip: { backgroundColor: '#141210', padding: 10, cornerRadius: 10, callbacks: { label: (i: { dataset: { label?: string }; parsed: { y: number | null } }) => ` ${i.dataset.label}: ${format(i.parsed.y ?? 0)}` } }, legend: { display: false } },
        scales: { x: { grid: { display: false }, ticks: { color: fg2, maxRotation: 0, autoSkipPadding: 12, font: { family: 'Instrument Sans' } } },
          y: { grid: { color: grid }, border: { display: false }, ticks: { color: fg2, callback: (v: string | number) => format(Number(v)), font: { family: 'Instrument Sans' } } } } },
    });
    return () => c.destroy();
  }, [labels, series, kind, format]);
  return <div style={{ height, position: 'relative' }}><canvas ref={ref} /></div>;
}
