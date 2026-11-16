'use client';

import Pet, { type PetVariant } from './Pet';
import { heroArt, HERO_NAME } from '@/lib/art-paths';
import { creatureArt, itemArt } from '@/lib/design/tokens';

export type ShopItemView = {
  id: string;
  name: string;
  slot: 'head' | 'body' | 'pet' | 'room';
  price: number;
  desc: string;
  variant: string;
};

const SLOT_LABEL: Record<ShopItemView['slot'], string> = {
  head: 'Голова',
  body: 'Одежда',
  pet: 'Питомец',
  room: 'Комната',
};

/** Гардероб v2 («мягкий объём»): 3D-проводник линейки, 3D-питомец и предметы за игровые монетки. */
export default function Shop({
  items,
  coins,
  inventory,
  equipped,
  level,
  band = '8-10',
  onBuy,
  onEquip,
}: {
  items: ShopItemView[];
  coins: number;
  inventory: string[];
  equipped: {
    head: string | null;
    body: string | null;
    pet: PetVariant | null;
    room?: string | null;
  };
  level: number;
  band?: string;
  onBuy: (id: string) => void;
  onEquip: (id: string) => void;
}) {
  const wornItems = (['head', 'body', 'room'] as const)
    .map((slot) => items.find((i) => i.id === equipped[slot]))
    .filter((item): item is ShopItemView => Boolean(item));

  const roomOwned = items.filter((i) => i.slot === 'room' && inventory.includes(i.id));

  const groups = (['head', 'body', 'pet', 'room'] as const).map((slot) => ({
    slot,
    list: items.filter((i) => i.slot === slot),
  }));

  const guideName = HERO_NAME[band] ?? 'Мира';

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Гардероб</h3>
        <span className="muted">🪙 {coins}</span>
      </div>

      <div className="shop-preview">
        <div className="shop-stage-v2">
          <img
            src={heroArt(band)}
            alt={guideName}
            className="shop-hero-v2"
            decoding="async"
          />
          {equipped.pet && (
            <div className="shop-pet">
              <img src={creatureArt('pet')} alt="" className="shop-pet-v2" decoding="async" />
              <span className="shop-pet-emblem">
                <Pet variant={equipped.pet} level={level} />
              </span>
            </div>
          )}
        </div>

        <div className="shop-worn-summary">
          {wornItems.length > 0 ? (
            <div className="shop-worn-chips" aria-label="Сейчас надето">
              {wornItems.map((w) => (
                <span key={w.id} className="shop-room-item on">
                  <img src={itemArt(w.variant)} alt="" loading="lazy" decoding="async" />
                  <b>{w.name}</b>
                </span>
              ))}
            </div>
          ) : (
            <p className="muted small" style={{ margin: '0 0 6px' }}>
              Пока ничего не надето — выбери вещь ниже за заработанные монетки.
            </p>
          )}
          <p className="muted" style={{ margin: 0 }}>
            Косметика покупается за монетки, которые начисляются за реальные задания.
          </p>
        </div>
      </div>

      {roomOwned.length > 0 && (
        <div className="shop-room">
          <h4>Моя комната</h4>
          <div className="shop-room-strip">
            {roomOwned.map((item) => (
              <span key={item.id} className={`shop-room-item${equipped.room === item.id ? ' on' : ''}`}>
                <img src={itemArt(item.variant)} alt="" loading="lazy" decoding="async" />
                <b>{item.name}</b>
              </span>
            ))}
          </div>
        </div>
      )}

      {groups.map((g) => (
        <div key={g.slot} className="shop-group">
          <h4>{SLOT_LABEL[g.slot]}</h4>
          <div className="shop-grid">
            {g.list.map((item) => {
              const owned = inventory.includes(item.id);
              const on =
                g.slot === 'pet'
                  ? equipped.pet === (item.variant as PetVariant)
                  : equipped[g.slot] === item.id;
              return (
                <div key={item.id} className={`shop-item${on ? ' on' : ''}`}>
                  <div className="shop-thumb">
                    {item.slot === 'pet' ? (
                      <div className="shop-pet-thumb">
                        <img src={creatureArt('pet')} alt="" className="shop-pet-v2-thumb" loading="lazy" decoding="async" />
                        <span className="shop-pet-emblem">
                          <Pet variant={item.variant as PetVariant} level={level} />
                        </span>
                      </div>
                    ) : (
                      <img src={itemArt(item.variant)} alt="" loading="lazy" decoding="async" />
                    )}
                  </div>
                  <b>{item.name}</b>
                  <span className="muted">{item.desc}</span>
                  {owned ? (
                    <button
                      type="button"
                      className={`btn small${on ? ' secondary' : ''}`}
                      onClick={() => onEquip(item.id)}
                    >
                      {on ? 'Снять' : 'Надеть'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn small"
                      disabled={coins < item.price}
                      onClick={() => onBuy(item.id)}
                    >
                      🪙 {item.price}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
