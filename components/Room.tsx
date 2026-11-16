'use client';

import type { CSSProperties } from 'react';
import Pet, { type PetVariant } from './Pet';
import { PET_MOOD_COLOR, type PetMood } from '@/lib/pet-mood';
import { DEFAULT_PLACE } from '@/lib/art-paths';

export type RoomProps = {
  /** Сцена: фото места района (16:9). Раньше здесь был рисунок из фигур. */
  scene?: string;
  /** Проводник линейки — портрет, а не полноростовый герой: 34 px. */
  hero?: string;
  heroName?: string;
  pet?: PetVariant | null;
  petLevel?: number;
  petMood?: PetMood;
  bubble?: string;
};

/**
 * «Комната» ребёнка — теперь сцена, а не рисунок.
 *
 * Стиль «мягкий объём» — это свет и фактура, а не линии; плоская комната с
 * чёрными контурами в нём не жила. Поэтому фоном идёт фотография места района (они уже нарисованы в 3D),
 * а поверх лежат две живые вещи: проводник линейки
 * и питомец ребёнка.
 *
 * Предметы комнаты (ковёр, лампа, плакат, растение) больше не дорисовываются
 * в сцене: их видно плитками в «Гардеробе», рядом с ценой и кнопкой «Надеть».
 */
export default function Room({
  scene = DEFAULT_PLACE,
  hero,
  heroName,
  pet = null,
  petLevel = 1,
  petMood,
  bubble,
}: RoomProps) {
  const moodStyle = petMood ? ({ '--pet-mood': PET_MOOD_COLOR[petMood] } as CSSProperties) : undefined;

  return (
    <div className="room">
      <img className="room-scene" src={scene} alt="" decoding="async" />

      {bubble && <p className="room-bubble">{bubble}</p>}

      <div className="room-cast">
        {hero && (
          <span className="room-guide">
            <img src={hero} alt="" />
            <b>{heroName ?? 'Проводник'}</b>
          </span>
        )}
        {pet && (
          <span className={`room-pet${petMood ? ` mood-${petMood}` : ''}`} style={moodStyle}>
            <Pet variant={pet} level={petLevel} mood={petMood} />
          </span>
        )}
      </div>
    </div>
  );
}
