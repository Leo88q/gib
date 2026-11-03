'use client';

import { cardName } from '@/lib/content/visual-labels';

export type ShapeCard = { shape: string; color: string };

export function Shape({ shape, color, size = 56 }: { shape: string; color: string; size?: number }) {
  return (
    <div
      className={`shape ${shape} ${color}`}
      style={{ width: `min(100%, ${size}px)`, aspectRatio: '1 / 1' }}
      aria-hidden
    />
  );
}

export function ShapeCardView({ card, selected, onClick }: { card: ShapeCard; selected?: boolean; onClick?: () => void }) {
  return (
    <button type="button" className={`card-shape${selected ? ' selected' : ''}`} aria-label={cardName(card.shape, card.color)} aria-pressed={Boolean(selected)} onClick={onClick}>
      <Shape shape={card.shape} color={card.color} size={52} />
    </button>
  );
}
