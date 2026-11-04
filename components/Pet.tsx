'use client';

/**
 * Питомец — растёт вместе с уровнем ребёнка. Три стадии, две породы.
 */
import { INK } from './avatarParts';

import { petStage, type PetMood } from '@/lib/pet-mood';

export type PetVariant = 'cat' | 'dragon';

export { petStage };

export default function Pet({
  variant = 'cat',
  level = 1,
  mood,
  className = '',
}: {
  variant?: PetVariant;
  level?: number;
  /** Настроение — только художественная реакция, лицо меняется мягко. */
  mood?: PetMood;
  className?: string;
}) {
  const stage = petStage(level);
  const scale = 0.75 + stage * 0.18;
  const body = variant === 'dragon' ? '#5fd28a' : '#ffb35c';
  const belly = variant === 'dragon' ? '#d9f7e4' : '#ffe3bd';

  return (
    <svg viewBox="0 0 100 90" className={className} style={{ overflow: 'visible' }}>
      <g style={{ transform: `scale(${scale})`, transformOrigin: '50px 80px' }}>
        {/* хвост */}
        <path
          d={variant === 'dragon' ? 'M78 60 q22 -6 14 -26' : 'M78 62 q20 -2 14 -22'}
          fill="none"
          stroke={INK}
          strokeWidth="6"
          strokeLinecap="round"
        />
        {/* тело */}
        <ellipse cx="50" cy="60" rx="26" ry="20" fill={body} stroke={INK} strokeWidth="3" />
        <ellipse cx="50" cy="66" rx="15" ry="11" fill={belly} />
        {/* лапы */}
        <ellipse cx="38" cy="78" rx="8" ry="5" fill={body} stroke={INK} strokeWidth="3" />
        <ellipse cx="62" cy="78" rx="8" ry="5" fill={body} stroke={INK} strokeWidth="3" />
        {/* голова */}
        <circle cx="50" cy="34" r="21" fill={body} stroke={INK} strokeWidth="3" />
        {variant === 'cat' ? (
          <>
            <path d="M31 22 l-2 -16 15 8z" fill={body} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
            <path d="M69 22 l2 -16 -15 8z" fill={body} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
          </>
        ) : (
          <>
            <path d="M32 20 l-4 -14 14 6z" fill="#ffd23f" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
            <path d="M68 20 l4 -14 -14 6z" fill="#ffd23f" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
          </>
        )}
        {/* глаза: закрытые — сон, широкие — любопытство */}
        {mood === 'sleepy' ? (
          <>
            <path d="M37 34 q5 4 10 0" stroke={INK} strokeWidth="2.8" fill="none" strokeLinecap="round" />
            <path d="M53 34 q5 4 10 0" stroke={INK} strokeWidth="2.8" fill="none" strokeLinecap="round" />
          </>
        ) : (
          <>
            <circle cx="42" cy="33" r={mood === 'curious' ? 6.4 : 5.4} fill="#fff" stroke={INK} strokeWidth="2.6" />
            <circle cx="58" cy="33" r={mood === 'curious' ? 6.4 : 5.4} fill="#fff" stroke={INK} strokeWidth="2.6" />
            <circle cx="43" cy="34" r={mood === 'curious' ? 2.9 : 2.4} fill={INK} />
            <circle cx="59" cy="34" r={mood === 'curious' ? 2.9 : 2.4} fill={INK} />
          </>
        )}
        {/* нос и рот */}
        <path d="M46 43 h8 l-4 4z" fill={INK} />
        {mood === 'happy' && <path d="M43 48 q7 7 14 0" stroke={INK} strokeWidth="2.8" fill="none" strokeLinecap="round" />}
        {mood === 'sleepy' && <path d="M46 50 q4 3 8 0" stroke={INK} strokeWidth="2.6" fill="none" strokeLinecap="round" />}
        {(mood === 'curious' || mood === 'missing' || !mood) && <path d="M44 49 q6 5 12 0" stroke={INK} strokeWidth="2.6" fill="none" strokeLinecap="round" />}
        {stage >= 1 && (
          <>
            <circle cx="32" cy="40" r="4" fill="#ff9db3" opacity=".7" />
            <circle cx="68" cy="40" r="4" fill="#ff9db3" opacity=".7" />
          </>
        )}
        {mood === 'missing' && (
          <path d="M74 20 c0 -4 7 -4 7 0 c0 4 -7 8 -7 8 c0 0 -7 -4 -7 -8 c0 -4 7 -4 7 0z" fill="#ff5d8f" stroke={INK} strokeWidth="2.2" strokeLinejoin="round" />
        )}
        {stage >= 2 && (
          <>
            <path d="M38 14 l4 -12 8 8 8 -8 4 12z" fill="#ffd23f" stroke={INK} strokeWidth="2.6" strokeLinejoin="round" />
            <path d="M40 8 l-6 -6 M60 8 l6 -6" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
          </>
        )}
      </g>
    </svg>
  );
}
