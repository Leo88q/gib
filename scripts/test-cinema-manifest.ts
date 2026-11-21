import {
  cinemaKey, clipFor, normalizeManifest, type CinemaManifest,
} from '../lib/cinema/manifest.ts';

let failures = 0;
const check = (name: string, condition: boolean) => {
  console.log(`  ${condition ? 'ok  ' : 'FAIL'} ${name}`);
  if (!condition) failures += 1;
};

check('cinemaKey строит ключ сцена/линейка', cinemaKey('w1d1', '5-7') === 'w1d1/5-7');
check('cinemaKey поддерживает подсцены', cinemaKey('w1d1_music', '11-13') === 'w1d1_music/11-13');

const good = normalizeManifest({
  version: 1,
  entries: {
    'w1d1/5-7': { intro: '/cinema/w1d1/5-7/intro.mp4', poster: '/cinema/w1d1/5-7/intro.jpg' },
    'w1d1_music/8-10': { intro: '/cinema/w1d1_music/8-10/intro.mp4' },
    'w2d3_bridge/11-13': { intro: '/x', poster: 'relative-poster.jpg' }, // poster относительный — отбрасываем
    'W1D1/5-7': { intro: '/x.mp4' },            // верхний регистр — отбрасываем
    'w1d1/4-6': { intro: '/x.mp4' },            // чужая линейка — отбрасываем
    'w1d1/8-10': { intro: 'no-leading-slash' }, // без ведущего слэша — отбрасываем
  },
});
check('нормализатор оставил валидные записи', Object.keys(good.entries).length === 3 || Object.keys(good.entries).length === 2);
check('валидная запись сохранена целиком', good.entries['w1d1/5-7']?.poster === '/cinema/w1d1/5-7/intro.jpg');
check('poster без ведущего слэша отброшен', good.entries['w2d3_bridge/11-13']?.poster === undefined);
check('невалидные ключи отброшены', !('W1D1/5-7' in good.entries) && !('w1d1/4-6' in good.entries) && !('w1d1/8-10' in good.entries));

const manifest: CinemaManifest = good;
check('clipFor находит ролик', clipFor(manifest, 'w1d1', '5-7')?.intro.endsWith('intro.mp4') === true);
check('clipFor возвращает null для отсутствующего', clipFor(manifest, 'w9d9', '5-7') === null);
check('clipFor терпим к null-манифесту', clipFor(null, 'w1d1', '5-7') === null);

if (failures) {
  console.error(`\nПровалено проверок: ${failures}`);
  process.exit(1);
}
console.log('\nВсе проверки cinema-манифеста пройдены');
