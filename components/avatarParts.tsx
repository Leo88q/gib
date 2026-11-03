'use client';

/**
 * Персонаж в векторе: собственный рисованный герой (не стоковые картинки).
 * Используется и в «комнате», и в превью гардероба.
 */

export const INK = '#1b1b2f';

export const SKINS = ['#ffd9b3', '#f4c093', '#dda273', '#b97f52'];
export const HAIRS = ['#3a2a20', '#7b4a2b', '#e8b04b', '#2f3b52', '#c85a4a', '#8b5cf6'];
export const SHIRTS = ['#ff7a3d', '#3aa0ff', '#3ec9a7', '#ff5d8f', '#8b5cf6', '#ffd23f'];

export type AvatarOptions = {
  skin?: string;
  hair?: string;
  hairStyle?: 'short' | 'spiky' | 'bun';
  shirt?: string;
  accessory?: string | null; // cap | bandana | glasses | headphones | crown
  body?: string | null; // scarf | backpack | super | vest
  mood?: 'happy' | 'wow' | 'think';
};

export function avatarParts(opts: AvatarOptions = {}) {
  const skin = opts.skin ?? SKINS[0];
  const hair = opts.hair ?? HAIRS[0];
  const shirt = opts.shirt ?? SHIRTS[0];
  const hairStyle = opts.hairStyle ?? 'short';
  const acc = opts.accessory ?? null;
  const body = opts.body ?? null;
  const mood = opts.mood ?? 'happy';

  return (
    <g>
      {/* ноги */}
      <path d="M46 118 h9 v18 h-9z M65 118 h9 v18 h-9z" fill="#3a4a6b" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
      <path d="M42 136 h15 v6 h-15z M61 136 h15 v6 h-15z" fill={INK} />

      {/* руки */}
      <path d="M30 84 q-10 12 -6 26" fill="none" stroke={INK} strokeWidth="8" strokeLinecap="round" />
      <path d="M90 84 q10 12 6 26" fill="none" stroke={INK} strokeWidth="8" strokeLinecap="round" />
      <circle cx="24" cy="112" r="6" fill={skin} stroke={INK} strokeWidth="3" />
      <circle cx="96" cy="112" r="6" fill={skin} stroke={INK} strokeWidth="3" />

      {/* корпус */}
      <path
        d="M36 72 q24 -8 48 0 l4 50 q-28 8 -56 0z"
        fill={shirt}
        stroke={INK}
        strokeWidth="3"
        strokeLinejoin="round"
      />
      {body === 'super' && (
        <>
          <path d="M36 72 q24 -8 48 0 l-4 12 q-20 -6 -40 0z" fill="#ff2e63" stroke={INK} strokeWidth="2.5" />
          <circle cx="60" cy="92" r="8" fill="#ffd23f" stroke={INK} strokeWidth="2.5" />
          <path d="M60 88 l2.6 4.2 4.6 .9 -3.2 3.4 .6 4.7 -4.6 -2.1 -4.6 2.1 .6 -4.7 -3.2 -3.4 4.6 -.9z" fill="#1b1b2f" />
        </>
      )}
      {body === 'vest' && (
        <path d="M48 76 l-6 44 M72 76 l6 44" stroke={INK} strokeWidth="3" fill="none" />
      )}
      {body === 'backpack' && (
        <>
          <rect x="76" y="80" width="18" height="24" rx="7" fill="#3ec9a7" stroke={INK} strokeWidth="3" />
          <path d="M78 88 h14" stroke={INK} strokeWidth="2.5" />
        </>
      )}
      {body === 'scarf' && (
        <>
          <path d="M38 74 q22 12 44 0 l2 9 q-24 12 -48 0z" fill="#ff5d8f" stroke={INK} strokeWidth="3" />
          <path d="M74 82 l8 16 -10 3z" fill="#ff5d8f" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
        </>
      )}

      {/* голова */}
      <ellipse cx="60" cy="48" rx="30" ry="28" fill={skin} stroke={INK} strokeWidth="3" />
      {/* уши */}
      <circle cx="30" cy="50" r="6" fill={skin} stroke={INK} strokeWidth="3" />
      <circle cx="90" cy="50" r="6" fill={skin} stroke={INK} strokeWidth="3" />

      {/* волосы */}
      {hairStyle === 'short' && (
        <path d="M31 42 q4 -26 29 -26 q25 0 29 26 q-10 -12 -29 -12 q-19 0 -29 12z" fill={hair} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
      )}
      {hairStyle === 'spiky' && (
        <path
          d="M32 40 l4 -18 9 12 7 -16 8 15 8 -14 6 15 10 -10 4 16 q-14 -10 -28 -10 q-14 0 -28 10z"
          fill={hair}
          stroke={INK}
          strokeWidth="3"
          strokeLinejoin="round"
        />
      )}
      {hairStyle === 'bun' && (
        <>
          <circle cx="60" cy="16" r="9" fill={hair} stroke={INK} strokeWidth="3" />
          <path d="M31 42 q4 -26 29 -26 q25 0 29 26 q-10 -12 -29 -12 q-19 0 -29 12z" fill={hair} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
        </>
      )}

      {/* глаза */}
      {mood === 'wow' ? (
        <>
          <circle cx="49" cy="47" r="8" fill="#fff" stroke={INK} strokeWidth="3" />
          <circle cx="71" cy="47" r="8" fill="#fff" stroke={INK} strokeWidth="3" />
          <circle cx="49" cy="47" r="3.4" fill={INK} />
          <circle cx="71" cy="47" r="3.4" fill={INK} />
        </>
      ) : (
        <>
          <ellipse cx="49" cy="47" rx="7" ry="8" fill="#fff" stroke={INK} strokeWidth="3" />
          <ellipse cx="71" cy="47" rx="7" ry="8" fill="#fff" stroke={INK} strokeWidth="3" />
          <circle cx="50" cy="49" r="3.2" fill={INK} />
          <circle cx="72" cy="49" r="3.2" fill={INK} />
          <circle cx="51.5" cy="46" r="1.2" fill="#fff" />
          <circle cx="73.5" cy="46" r="1.2" fill="#fff" />
        </>
      )}

      {/* брови */}
      <path d="M42 35 q7 -5 14 -1" stroke={INK} strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M64 34 q7 -4 14 1" stroke={INK} strokeWidth="3" fill="none" strokeLinecap="round" />

      {/* щёки и рот */}
      <circle cx="38" cy="58" r="5" fill="#ff9db3" opacity=".75" />
      <circle cx="82" cy="58" r="5" fill="#ff9db3" opacity=".75" />
      {mood === 'think' ? (
        <path d="M52 62 q8 -6 16 0" stroke={INK} strokeWidth="3" fill="none" strokeLinecap="round" />
      ) : (
        <path d="M50 60 q10 10 20 0" stroke={INK} strokeWidth="3" fill="none" strokeLinecap="round" />
      )}

      {/* аксессуары */}
      {acc === 'cap' && (
        <>
          <path d="M30 34 q6 -26 30 -26 q24 0 30 26 z" fill="#ff5d8f" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
          <path d="M28 34 q16 -6 32 0 l-2 6 q-14 -5 -28 0z" fill="#ff8ab0" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
        </>
      )}
      {acc === 'bandana' && (
        <path d="M30 36 q10 -24 30 -24 q20 0 30 24 q-14 -8 -30 -8 q-16 0 -30 8z" fill="#3ec9a7" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
      )}
      {acc === 'glasses' && (
        <>
          <circle cx="49" cy="47" r="11" fill="none" stroke={INK} strokeWidth="3" />
          <circle cx="71" cy="47" r="11" fill="none" stroke={INK} strokeWidth="3" />
          <path d="M60 47 h0" stroke={INK} strokeWidth="3" />
          <path d="M38 44 l-8 -3 M82 44 l8 -3" stroke={INK} strokeWidth="3" />
        </>
      )}
      {acc === 'headphones' && (
        <>
          <path d="M28 46 q0 -30 32 -30 q32 0 32 30" fill="none" stroke={INK} strokeWidth="5" />
          <rect x="22" y="40" width="12" height="18" rx="5" fill="#ffd23f" stroke={INK} strokeWidth="3" />
          <rect x="86" y="40" width="12" height="18" rx="5" fill="#ffd23f" stroke={INK} strokeWidth="3" />
        </>
      )}
      {acc === 'crown' && (
        <path d="M36 30 l4 -18 10 12 10 -16 10 16 10 -12 4 18z" fill="#ffd23f" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
      )}
    </g>
  );
}

export default avatarParts;
