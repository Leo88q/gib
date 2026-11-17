'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/telegramClient';

type StudioPayload = {
  groupInfo?: { id: string; name: string; year: number } | null;
  next?: { lesson: number; date: string } | null;
  lessons?: { lesson: number; title: string; isShowcase: boolean }[];
};

function humanDate(iso: string): string {
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  return `${parts[2]}.${parts[1]}.${parts[0]}`;
}

/**
 * Мягкая карточка очной группы на главном экране ребёнка (`/`):
 * появляется только если взрослый сам подключил ребёнка к кружку педагога.
 * Показывает название группы и следующую встречу без счётчиков пропусков и оценок.
 */
export default function ChildStudioCard({ profileId }: { profileId?: string }) {
  const [info, setInfo] = useState<{
    groupName: string;
    nextLesson: number | null;
    nextTitle: string;
    nextDate: string | null;
    isShowcase: boolean;
  } | null>(null);

  useEffect(() => {
    if (!profileId) {
      setInfo(null);
      return;
    }
    let cancelled = false;
    apiFetch(`/api/lessons?profileId=${encodeURIComponent(profileId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: StudioPayload | null) => {
        if (cancelled || !data?.groupInfo) {
          if (!cancelled) setInfo(null);
          return;
        }
        const nextNum = data.next?.lesson ?? null;
        const lessonMeta = nextNum
          ? data.lessons?.find((l) => l.lesson === nextNum)
          : undefined;
        setInfo({
          groupName: data.groupInfo.name,
          nextLesson: nextNum,
          nextTitle: lessonMeta?.title ?? (nextNum ? `Встреча ${nextNum}` : ''),
          nextDate: data.next?.date ?? null,
          isShowcase: Boolean(lessonMeta?.isShowcase),
        });
      })
      .catch(() => {
        if (!cancelled) setInfo(null);
      });
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  if (!info) return null;

  return (
    <div className="panel child-studio-card" aria-label="Твоя очная группа">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <strong>🎭 Кружок «{info.groupName}»</strong>
        {info.nextDate && <span className="chip">Следующая встреча: {humanDate(info.nextDate)}</span>}
      </div>
      {info.nextLesson && (
        <p style={{ margin: '6px 0 4px' }}>
          Впереди встреча {info.nextLesson}: <strong>{info.nextTitle}</strong>
          {info.isShowcase ? ' · день мини-показа по желанию' : ''}.
        </p>
      )}
      <p className="muted small" style={{ margin: 0 }}>
        В кружке можно пробовать роли в своём темпе и в любой момент спокойно сказать «пропускаю».
      </p>
    </div>
  );
}
