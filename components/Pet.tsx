'use client';

/**
 * Питомец — растёт вместе с уровнем ребёнка. Три стадии, две породы.
 */
import { INK } from './avatarParts';

export type PetVariant = 'cat' | 'dragon';

export function petStage(level: number): 0 | 1 | 2 {
  if (level >= 6) return 2;
  if (level >= 3) return 1;
  return 0;
}

export default function Pet({
  variant = 'cat',
  level = 1,
  className = '',
}: {
  variant?: PetVariant;
  level?: number;
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
        {/* глаза */}
        <circle cx="42" cy="33" r="5.4" fill="#fff" stroke={INK} strokeWidth="2.6" />
        <circle cx="58" cy="33" r="5.4" fill="#fff" stroke={INK} strokeWidth="2.6" />
        <circle cx="43" cy="34" r="2.4" fill={INK} />
        <circle cx="59" cy="34" r="2.4" fill={INK} />
        {/* нос и рот */}
        <path d="M46 43 h8 l-4 4z" fill={INK} />
        <path d="M44 49 q6 5 12 0" stroke={INK} strokeWidth="2.6" fill="none" strokeLinecap="round" />
        {stage >= 1 && (
          <>
            <circle cx="32" cy="40" r="4" fill="#ff9db3" opacity=".7" />
            <circle cx="68" cy="40" r="4" fill="#ff9db3" opacity=".7" />
          </>
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
