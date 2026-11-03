'use client';

import { avatarParts, INK, type AvatarOptions } from './avatarParts';
import Pet, { type PetVariant } from './Pet';

export type RoomProps = {
  avatar?: AvatarOptions;
  pet?: PetVariant | null;
  petLevel?: number;
  decor?: { rug?: boolean; lamp?: boolean; poster?: boolean; plant?: boolean };
  mascot?: string;
  bubble?: string;
};

/**
 * «Комната» ребёнка — рисованная сцена, которая растёт вместе с прогрессом:
 * появляются ковёр, лампа, постер и цветок.
 */
export default function Room({
  avatar = {},
  pet = null,
  petLevel = 1,
  decor = {},
  mascot = '/art/mascot-main.png',
  bubble,
}: RoomProps) {
  return (
    <div className="room">
      <svg className="room-svg" viewBox="0 0 320 210" preserveAspectRatio="xMidYMid meet">
        {/* стена и пол */}
        <rect x="0" y="0" width="320" height="150" fill="#ffe9c7" />
        <rect x="0" y="150" width="320" height="60" fill="#e8b98a" />
        <path d="M0 150 h320" stroke={INK} strokeWidth="4" />
        <path d="M20 160 h40 M90 160 h40 M160 160 h40 M230 160 h40" stroke="#d29a67" strokeWidth="3" strokeLinecap="round" />

        {/* обои-полоски */}
        <path d="M40 20 v130 M140 20 v130 M240 20 v130" stroke="#ffd9a8" strokeWidth="8" strokeLinecap="round" />

        {/* окно */}
        <g className="room-window">
          <rect x="196" y="26" width="92" height="76" rx="12" fill="#bfe6ff" stroke={INK} strokeWidth="4" />
          <circle cx="262" cy="46" r="12" fill="#ffd23f" stroke={INK} strokeWidth="3" />
          <path d="M208 84 q12 -14 24 0 q12 -12 22 0 q10 -10 20 0" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
          <path d="M242 26 v76 M196 64 h92" stroke={INK} strokeWidth="4" />
          <rect x="186" y="100" width="112" height="10" rx="5" fill="#c98f5f" stroke={INK} strokeWidth="3" />
        </g>

        {/* полка с книгами */}
        <g>
          <rect x="24" y="52" width="86" height="8" rx="4" fill="#c98f5f" stroke={INK} strokeWidth="3" />
          <rect x="32" y="30" width="12" height="22" rx="3" fill="#ff5d8f" stroke={INK} strokeWidth="2.6" />
          <rect x="48" y="26" width="12" height="26" rx="3" fill="#3aa0ff" stroke={INK} strokeWidth="2.6" />
          <rect x="64" y="32" width="12" height="20" rx="3" fill="#3ec9a7" stroke={INK} strokeWidth="2.6" />
          <rect x="80" y="28" width="12" height="24" rx="3" fill="#ffd23f" stroke={INK} strokeWidth="2.6" />
        </g>

        {/* постер */}
        {decor.poster && (
          <g className="room-poster">
            <rect x="112" y="30" width="44" height="52" rx="5" fill="#fff" stroke={INK} strokeWidth="3" />
            <circle cx="134" cy="48" r="9" fill="#ff7a3d" />
            <path d="M120 74 l9 -14 8 9 6 -7 5 12z" fill="#3ec9a7" />
          </g>
        )}

        {/* лампа */}
        {decor.lamp && (
          <g className="room-lamp">
            <rect x="58" y="112" width="8" height="38" fill="#9aa4b8" stroke={INK} strokeWidth="3" />
            <path d="M46 112 l10 -22 h20 l10 22z" fill="#ffd23f" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
            <ellipse cx="62" cy="112" rx="20" ry="5" fill="#ffca3a" stroke={INK} strokeWidth="3" />
          </g>
        )}

        {/* цветок */}
        {decor.plant && (
          <g className="room-plant">
            <path d="M272 128 l-6 22 h20 l-6 -22z" fill="#ff8b5c" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
            <path d="M279 128 q-14 -6 -14 -22 q14 2 14 22z" fill="#3ec9a7" stroke={INK} strokeWidth="3" />
            <path d="M279 128 q14 -8 12 -26 q-13 6 -12 26z" fill="#3ec9a7" stroke={INK} strokeWidth="3" />
          </g>
        )}

        {/* ковёр */}
        {decor.rug && (
          <ellipse cx="150" cy="180" rx="92" ry="24" fill="#ff8ab0" stroke={INK} strokeWidth="4" />
        )}

        {/* герой */}
        <g transform="translate(112,42) scale(0.92)" className="room-hero">
          {avatarParts(avatar)}
        </g>

        {/* питомец */}
        {pet && (
          <g transform="translate(60,118) scale(0.62)" className="room-pet">
            <Pet variant={pet} level={petLevel} />
          </g>
        )}
      </svg>

      {mascot && (
        <div className="room-mascot">
          <img src={mascot} alt="" />
        </div>
      )}
      {bubble && <div className="room-bubble">{bubble}</div>}
    </div>
  );
}
