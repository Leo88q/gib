# Переиспользуемые кадры: система подписей и путей («каталог кадров»)

Принято владельцем 2026-11-21: **один и тот же кадр вставляется во все сцены
с той же постановкой**, а не генерируется отдельно под каждый урок. Этот файл —
спецификация; код уже умеет всё ниже по плану.

## Почему так

Раньше `yandex-art.ts` рисовал по одному кадру на каждый ink-файл: 121 сцена
× 3 линейки × N кандидатов = 726–1 452 генерации ≈ 1 620–3 240 ₽, причём без
`art-shotlist.json` все кадры выходили одинаковыми («комната, спокойный,
добрый»). Каталог убирает дубликаты **на уровне семантики**: допустимое
разнообразие — разные (герой, локация, эмоция), а не разные уроки.

## Ключи и файлы

| Часть | Формат | Пример |
|---|---|---|
| hero-кадр | `<hero>-<location>-<emotion>` | `tima-workshop-calm.png` |
| B-roll (локация без героя) | `loc-<location>` | `loc-room.png` |
| hero ∈ | `lis` (5–7), `mira` (8–10), `tima` (11–13) | — |
| location ∈ | `house room class yard playground park library market greenhouse workshop district-map` | — |
| emotion ∈ | `calm happy sad angry scared surprised ashamed confused tired sure anxious thoughtful proud` | — |

- **Каталог (коммитится):** `data/frame-catalog.json` — `{ version: 1, frames: { key: entry } }`.
  Entry: `kind` (`hero|location`), `hero`/`band` (у hero), `location`, `emotion`,
  `path` (`/art/frames/<key>.png`), `used_by` (массив `scene/band`, напр. `w1d1/5-7`),
  `source` (`shotlist|heuristic`), `needs_review`, `verified?`, `disabled?`, `note?`.
- **Отобранные кадры (копируются в сборку):** `public/art/frames/<key>.png` —
  попадают в deploy, если вы положили их туда.
- **Кандидаты (вне git):** `out/art/frames/<key>-c<N>.png`.
- **Кино-вход (не коммитится):** `out/cinema/_stills/<scene>-<band>.png` —
  собирается автоматически из каталога (см. ниже), дальше `render-cinema.ts`
  как обычно (diff в кадре даёт Ken Burns + закадровый голос + выборы).

## Поток

```
ink ──┬─► build:frames (0 ₽) ─► data/frame-catalog.json ──┐
      │                                                    ├─► render-cinema (0 ₽)
      └─► art-stage (≈25 ₽, желательно) ─► art-shotlist ───┘        ↓
                        │                               public/cinema/manifest.json
                        ▼                                             ↓
        yandex-art-frames (≈2,23 ₽/кадр) ─► out/art/frames/          cinema-режим
                        ↓                                    (NEXT_PUBLIC_CINEMA_STORY=1)
        вами отобранные → public/art/frames/
                        ↓
              stills:link (0 ₽) → out/cinema/_stills/
```

Команды:

```bash
npm run build:frames          # пересобрать каталог (правки человека в нём сохраняются)
npm run test:frames           # схема каталога + целостность used_by
yandex-art-frames dry-run:    npx tsx scripts/yandex-art-frames.ts
yandex-art-frames боевой:     YANDEX_API_KEY=... npx tsx scripts/yandex-art-frames.ts --yes [--band=8-10] [--candidates=2]
stills (dry-run):             npm run stills:link
stills (применить):           npx tsx scripts/link-frame-stills.ts --yes [--candidate=1] [--force]
stills (превью 0 ₽):          npx tsx scripts/link-frame-stills.ts --yes --placeholder
```

`build:frames` идемпотентен: `used_by` пересчитывается из кода, `path`,
`verified`, `disabled` и `note` — сохраняются. Если кадр кадрируется (нужен
свой вариант поверх каталожного), добавьте отдельную запись или копию с другим
ключом; подставить свой файл — просто положить его по `path` из каталога.

## Превью без единой генерации (0 ₽)

Если кино нужно посмотреть **до** того, как нарисованы кадры, — committed-арт
мест из v2 можно временно подставить вместо отсутствующих кадров:

```bash
npx tsx scripts/link-frame-stills.ts --yes --placeholder
npx tsx scripts/render-cinema.ts
```

`--placeholder` копирует `public/art/v2/places/<place>.png` в `_stills` только
для тех сцен, у которых нет ни `public/art/frames/<key>.png`, ни кандидата в
`out/art/frames/`. Это тест цепочки (голос + Ken Burns + выборы), а не
кино-контент: сцены без героев, места приближённые (дом/класс/парк →
`home.png` / `playground.png`). Боевой шаг — сгенерировать кадры каталога и
перекопировать **без** `--placeholder`.

## Честно об ограничениях

- **v1-эвристика грубая:** до запуска `art-stage` эмоция везде «спокой,
  добрый», локации из ключевых слов → в каталоге ~24 кадра, на `*-room-calm`
  приходится ~109 сцен линейки. Это **минимально жизнеспособный** каталог, не
  финальное искусство. После `--yes --only=art-stage` пересоберите каталог:
  ключей станет больше, `needs_review` уйдёт с большинства, картинка — разнообразнее.
- **Одну и ту же генерацию видят разные дети:** это осознанный выбор владельца
  (кадры «на ролик», а не «на урок»). Разнообразие несут голос, Ken Burns и выборы.
- Покрытие проверяется `used_by` (сцена/линейка) — иначе кадр кокнет; сейчас
  363/363 назначений без пропусков при полной программе.
- `needs_review: true` ≠ кадр плохой; это ровно «глаза не видели». Снимайте
  флаг через `verified: true` в каталоге (git diff — ревью) или удаляйте кадр.
- `disabled: true` исключает кадр из генерации и из `_stills` (сцена останется
  без кадра до ручной замены).
