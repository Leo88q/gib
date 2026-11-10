import { NextResponse } from 'next/server';
import { requireParent, ownedProfile } from '@/lib/auth';
import { clientKey, rateLimit } from '@/lib/ratelimit';
import { store } from '@/lib/store';
import { CHECKIN_RETENTION_DAYS, MAX_CHECKINS, emptyFeelingsPreferences, pruneCheckIns } from '@/lib/feelings/state';

export const dynamic = 'force-dynamic';

/**
 * Сводка: что именно хранится о ребёнке, по категориям и количеству.
 *
 * Маршрут отвечает только на вопрос «сколько чего» и никогда — «что именно».
 * Содержимое отметок чувств, тексты ответов и сценарии остаются за пределами
 * ответа: доступ к ним — отдельное юридическое решение, а не следствие входа
 * в кабинет. Поэтому в ответе нет ни одного поля с содержимым, и это
 * проверяется тестом, а не обещанием в тексте.
 *
 * Путь `/api/profile/data` читается как «данные профиля», а профиль здесь один
 * и выбран явно: без `profileId` — 400, чужой или удалённый — 404.
 *
 * Внимание по репозиторию: этот каталог называется `data`, и раньше правило
 * `.gitignore` (`data/` без якоря) молча исключало его из git. Файл лежал на
 * диске, но не попадал в коммит, поэтому после пересборки окружения маршрута
 * не стало. Правило исправлено на `/data/`; при переименованиях папок с таким
 * именем проверяйте `git check-ignore`.
 */
export async function GET(req: Request) {
  const auth = requireParent(req);
  if (auth.error) return auth.error;
  if (!rateLimit(clientKey(req, 'profile-data', auth.parentId), 120)) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }

  const profileId = new URL(req.url).searchParams.get('profileId');
  if (!profileId) return NextResponse.json({ error: 'profileId_required' }, { status: 400 });

  return store.transaction(() => {
    // Чужой и несуществующий профиль неразличимы: 404 в обоих случаях.
    const profile = ownedProfile(auth.parentId, profileId);
    if (!profile) return NextResponse.json({ error: 'profile_not_found' }, { status: 404 });

    const sessions = store.sessions(profile.id);
    const player = store.playerState(profile.id);

    const feelings = player.feelings ?? { prefs: emptyFeelingsPreferences(profile.band), items: [] };
    // Считаем то, что реально хранится: просроченные отметки не должны попадать
    // в число только потому, что ещё лежат в файле.
    const liveCheckIns = feelings.prefs.saveEnabled ? pruneCheckIns(feelings.items, Date.now()) : [];

    const stories = sessions.filter(session => typeof session.scenario?.scenarioId === 'string').length;
    // Задания — это элементы прогона с типом `task`; истории считаются отдельно
    // по сценарию сессии, поэтому двойного счёта нет.
    const tasks = sessions.reduce(
      (sum, session) => sum + (session.runtime?.items?.filter(item => item.type === 'task').length ?? 0),
      0,
    );

    return NextResponse.json({
      profile: { name: profile.name, age: profile.age, createdAt: profile.createdAt },
      counts: {
        sessions: sessions.length,
        tasks,
        stories,
        familyMarks: player.family?.completed ?? 0,
        feelings: liveCheckIns.length,
        events: store.eventsForOwner(auth.parentId, profile.id).length,
      },
      // Согласие и его границы видны взрослому прямо здесь: по умолчанию
      // сохранения нет, срок и лимит — из модели, а не из текста интерфейса.
      feelings: {
        enabled: feelings.prefs.saveEnabled,
        retentionDays: CHECKIN_RETENTION_DAYS,
        limit: MAX_CHECKINS,
      },
      updatedAt: Date.now(),
    });
  });
}
