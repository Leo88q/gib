'use client';

import { useMemo } from 'react';
import { avatarParts, HAIRS, SHIRTS, SKINS, type AvatarOptions } from './avatarParts';
import { accessoryVariantOf, bodyVariantOf } from '@/lib/gamification';
import Pet, { type PetVariant } from './Pet';

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

/** Гардероб: косметика за игровые монетки (реальных денег детей не тратится). */
export default function Shop({
  items,
  coins,
  inventory,
  equipped,
  level,
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
  onBuy: (id: string) => void;
  onEquip: (id: string) => void;
}) {
  const preview = useMemo(
    () => ({
      skin: SKINS[0],
      hair: HAIRS[0],
      shirt: SHIRTS[0],
      accessory: accessoryVariantOf(equipped.head),
      body: bodyVariantOf(equipped.body),
    }),
    [equipped],
  );

  const groups = (['head', 'body', 'pet', 'room'] as const).map((slot) => ({
    slot,
    list: items.filter((i) => i.slot === slot),
  }));

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Гардероб</h3>
        <span className="muted">🪙 {coins}</span>
      </div>

      <div className="shop-preview">
        <svg viewBox="0 0 120 150" className="shop-avatar">
          {avatarParts(preview)}
        </svg>
        {equipped.pet && (
          <div className="shop-pet">
            <Pet variant={equipped.pet} level={level} />
          </div>
        )}
        <p className="muted">
          Косметика покупается за монетки, которые начисляются за реальные задания.
        </p>
      </div>

      {groups.map((g) => (
        <div key={g.slot} className="shop-group">
          <h4>{SLOT_LABEL[g.slot]}</h4>
          <div className="shop-grid">
            {g.list.map((item) => {
              const owned = inventory.includes(item.id);
              const on = equipped[item.slot] === item.id;
              return (
                <div key={item.id} className={`shop-item${on ? ' on' : ''}`}>
                  <div className="shop-thumb">
                    <span>{item.variant === 'cat' ? '🐱' : item.variant === 'dragon' ? '🐲' : '🎁'}</span>
                  </div>
                  <b>{item.name}</b>
                  <span className="muted">{item.desc}</span>
                  {owned ? (
                    <button
                      type="button"
                      className={`btn tiny${on ? '' : ' secondary'}`}
                      onClick={() => onEquip(item.id)}
                      disabled={on}
                    >
                      {on ? 'Надето' : 'Надеть'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn tiny"
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
