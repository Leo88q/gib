'use client';

import type { CSSProperties } from 'react';
import Pet, { type PetVariant } from './Pet';
import { PET_MOOD_COLOR, type PetMood } from '@/lib/pet-mood';
import { DEFAULT_PLACE, petStageArt } from '@/lib/art-paths';
import { itemArt } from '@/lib/design/tokens';

export type RoomEquippedItem = {
  id: string;
  name: string;
  variant: string;
  slot: 'head' | 'body' | 'room';
};

export type RoomProps = {
  /** Сцена: фото места района (16:9). */
  scene?: string;
  /** Проводник линейки — портрет 34 px. */
  hero?: string;
  heroName?: string;
  pet?: PetVariant | null;
  petLevel?: number;
  petMood?: PetMood;
  bubble?: string;
  /** Надетые вещи и предмет комнаты (3D-иконки v2). */
  equippedItems?: RoomEquippedItem[];
};

/**
 * «Комната» ребёнка в стиле «мягкий объём» (v2):
 * фотография места района (16:9), портрет проводника линейки,
 * 3D-питомец (`/art/v2/creatures/pet.png`) со значком вида и настроения,
 * а также надетые предметы гардероба и комнаты.
 */
export default function Room({
  scene = DEFAULT_PLACE,
  hero,
  heroName,
  pet = null,
  petLevel = 1,
  petMood,
  bubble,
  equippedItems = [],
}: RoomProps) {
  const moodStyle = petMood ? ({ '--pet-mood': PET_MOOD_COLOR[petMood] } as CSSProperties) : undefined;

  return (
    <div className="room">
      <img className="room-scene" src={scene} alt="" decoding="async" />

      {bubble && <p className="room-bubble">{bubble}</p>}

      {equippedItems.length > 0 && (
        <div className="room-equipped" aria-label="Выбранные предметы">
          {equippedItems.map((eq) => (
            <span key={eq.id} className="room-item" title={eq.name}>
              <img src={itemArt(eq.variant)} alt="" loading="lazy" decoding="async" />
              <b>{eq.name}</b>
            </span>
          ))}
        </div>
      )}

      <div className="room-cast">
        {hero && (
          <span className="room-guide">
            <img src={hero} alt="" />
            <b>{heroName ?? 'Проводник'}</b>
          </span>
        )}
        {pet && (
          <span className={`room-pet${petMood ? ` mood-${petMood}` : ''}`} style={moodStyle}>
            <img className="room-pet-v2" src={petStageArt(petLevel)} alt="" decoding="async" />
            <span className="room-pet-badge">
              <Pet variant={pet} level={petLevel} mood={petMood} />
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
