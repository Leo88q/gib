'use client';

import { useMemo } from 'react';

const COLORS = ['#ff7a3d', '#ffd23f', '#3ec9a7', '#3aa0ff', '#ff5d8f', '#8b5cf6'];

export default function Confetti({ count = 40 }: { count?: number }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        left: Math.round(Math.random() * 100),
        delay: Math.round(Math.random() * 700),
        dur: 1600 + Math.round(Math.random() * 1400),
        color: COLORS[i % COLORS.length],
        size: 6 + Math.round(Math.random() * 8),
        rot: Math.round(Math.random() * 360),
      })),
    [count],
  );
  return (
    <div className="confetti" aria-hidden>
      {pieces.map((p, i) => (
        <span
          key={i}
          style={{
            left: `${p.left}%`,
            background: p.color,
            width: p.size,
            height: p.size * 1.6,
            animationDelay: `${p.delay}ms`,
            animationDuration: `${p.dur}ms`,
            transform: `rotate(${p.rot}deg)`,
          }}
        />
      ))}
    </div>
  );
}
