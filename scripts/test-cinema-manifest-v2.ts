import {
  fmvFor, normalizeManifestV2, pickFmvSource, FMV_LAYER_ORDER, FMV_LIGHT_ORDER, type FmvManifest,
} from '../lib/cinema/manifest-v2.ts';

let failures = 0;
const check = (name: string, condition: boolean) => {
  console.log(`  ${condition ? 'ok  ' : 'FAIL'} ${name}`);
  if (!condition) failures += 1;
};

check('порядок слоёв зафиксирован', FMV_LAYER_ORDER.join(',') === 'set,character,zlata,window');

const raw = {
  version: 2,
  entries: {
    'w1d1/8-10': {
      poster: '/cinema/w1d1/8-10/poster.jpg',
      replayFrom: 'zlata-pause-01',
      segments: [
        { id: 'set-plate', layer: 'set', src: { mp4: '/cinema/w1d1/8-10/set.mp4' }, duration: 6 },
        { id: 'mira-soften', layer: 'character', src: { hevc: '/cinema/w1d1/8-10/mira-soften.mov', vp9: '/cinema/w1d1/8-10/mira-soften.webm' } },
        { id: 'zlata-in-01', layer: 'zlata', src: { hevc: '/cinema/w1d1/8-10/zlata-in-01.mov', vp9: '/cinema/w1d1/8-10/zlata-in-01.webm' }, duration: 12 },
        { id: 'zlata-pause-01', layer: 'zlata', src: { vp9: '/cinema/w1d1/8-10/zlata-pause-01.webm' } },
        { id: 'window-slide-1', layer: 'window', src: { mp4: '/cinema/w1d1/8-10/slide-1.mp4' } },
      ],
    },
    'w1d1_music/5-7': {
      replayFrom: 'no-such-segment',
      segments: [
        { id: 'a', layer: 'zlata', src: { vp9: '/x.webm' } },
        { id: 'a', layer: 'zlata', src: { vp9: '/y.webm' } },   // дубль id — отбрасывается
        { id: 'b', layer: 'hologram', src: { vp9: '/z.webm' } }, // чужой слой — отбрасывается
        { id: 'c', layer: 'zlata', src: {} },                    // без путей — отбрасывается
        { id: 'd', layer: 'set', src: { mp4: 'no-slash.mp4' } }, // без ведущего слэша — отбрасывается
      ],
    },
    'W1D1/8-10': { segments: [{ id: 'x', layer: 'set', src: { mp4: '/x.mp4' } }] },   // регистр — мимо
    'w1d1/4-6': { segments: [{ id: 'x', layer: 'set', src: { mp4: '/x.mp4' } }] },    // чужая линейка — мимо
    'w1d1/11-13': { segments: [{ id: 'y', layer: 'set', src: {} }] },                // пустые сегменты — запись мимо
  },
};

const manifest = normalizeManifestV2(raw);
const good = manifest.entries['w1d1/8-10'];
check('валидная запись сохранилась', !!good);
check('слои упорядочены set→character→zlata→window',
  good?.segments.map((s) => s.layer).join(',') === 'set,character,zlata,zlata,window');
check('poster сохранён', good?.poster === '/cinema/w1d1/8-10/poster.jpg');
check('replayFrom сохранён, когда сегмент существует', good?.replayFrom === 'zlata-pause-01');
check('duration сохранён у валидного сегмента', good?.segments[0]?.duration === 6);

const music = manifest.entries['w1d1_music/5-7'];
check('дубликаты и битые сегменты отброшены, валидный остался', music?.segments.length === 1 && music.segments[0]?.id === 'a');
check('replayFrom на несуществующий сегмент обнулён', music?.replayFrom === undefined);

check('кривые ключи и пустые записи отброшены', !('W1D1/8-10' in manifest.entries) && !('w1d1/4-6' in manifest.entries) && !('w1d1/11-13' in manifest.entries));

check('fmvFor находит запись', fmvFor(manifest, 'w1d1', '8-10')?.poster === '/cinema/w1d1/8-10/poster.jpg');
check('fmvFor возвращает null для отсутствующего и для null', fmvFor(manifest, 'w9d9', '8-10') === null && fmvFor(null, 'w1d1', '8-10') === null);

const src = { hevc: '/a.mov', vp9: '/a.webm', mp4: '/a.mp4' };
check('pickFmvSource: сначала HEVC', pickFmvSource(src, (k) => k === 'hevc' || k === 'mp4')?.kind === 'hevc');
check('pickFmvSource: без HEVC — VP9', pickFmvSource(src, (k) => k === 'vp9' || k === 'mp4')?.kind === 'vp9');
check('pickFmvSource: без альфы — mp4', pickFmvSource(src, (k) => k === 'mp4')?.kind === 'mp4');
check('pickFmvSource: ничего не играет — null', pickFmvSource(src, () => false) === null);
check('pickFmvSource: только mp4, но и он не играет — null', pickFmvSource({ mp4: '/x.mp4' }, () => false) === null);

// --- Пресет режиссуры (scene): fail-soft, сегмент не страдает ---
const sceneRaw = {
  version: 2,
  entries: {
    'w1d1/8-10': {
      segments: [
        { id: 'plate', layer: 'set', src: { mp4: '/s.mp4' },
          scene: { camera: 'stage', light: 'show', curtain: 'open', cassettes: 'dom', screen: 'repertoire',
                   lightsOn: ['ramp', 'spotL', 'spotL', 'bogusLight'],
                   heroes: { mira: 'relief', tima: 'thinking', lis: 'nervous', stranger: 'calm' } } },
        { id: 'half-cue', layer: 'character', src: { vp9: '/c.webm' },
          scene: { camera: 'orbit', light: 'noon', curtain: 'ajar', cassettes: 'garage', screen: 'popup',
                   lightsOn: 'not-array', heroes: 'nope' } },
        { id: 'not-object', layer: 'character', src: { vp9: '/d.webm' }, scene: 'lights' },
        { id: 'null-scene', layer: 'zlata', src: { vp9: '/e.webm' }, scene: null },
      ],
    },
  },
};
const sceneManifest = normalizeManifestV2(sceneRaw);
const segs = sceneManifest.entries['w1d1/8-10']?.segments ?? [];
const plate = segs.find((x) => x.id === 'plate');
check('scene: пресет сохранён у сегмента', !!plate?.scene);
check('scene: камера/свет/занавес/кассеты/экран валидны',
  plate?.scene?.camera === 'stage' && plate?.scene?.light === 'show' && plate?.scene?.curtain === 'open'
  && plate?.scene?.cassettes === 'dom' && plate?.scene?.screen === 'repertoire');
check('scene: lightsOn — дедуп, порядок из FMV_LIGHT_ORDER, мусор убран',
  JSON.stringify(plate?.scene?.lightsOn) === JSON.stringify(['spotL', 'ramp']));
check('scene: heroes — неизвестные герои и настроения отброшены',
  JSON.stringify(Object.keys(plate?.scene?.heroes ?? {})) === JSON.stringify(['tima', 'mira'])
  && plate?.scene?.heroes?.tima === 'thinking' && plate?.scene?.heroes?.mira === 'relief');
const half = segs.find((x) => x.id === 'half-cue');
check('scene: все значения битые — пресет опущен, сегмент жив', !!half && half.scene === undefined);
const notObj = segs.find((x) => x.id === 'not-object');
check('scene: не объект — опущен, сегмент жив', !!notObj && notObj.scene === undefined);
const nullScene = segs.find((x) => x.id === 'null-scene');
check('scene: null — опущен, сегмент жив', !!nullScene && nullScene.scene === undefined);
check('FMV_LIGHT_ORDER стабилен', FMV_LIGHT_ORDER.join(',') === 'spotL,spotC,spotR,ramp,floorLamp,window,screen');

const v2: FmvManifest = manifest;
check('итог: version=2', v2.version === 2);

if (failures) {
  console.error(`\nПровалено проверок: ${failures}`);
  process.exit(1);
}
console.log('\nВсе проверки cinema-манифеста v2 пройдены');
