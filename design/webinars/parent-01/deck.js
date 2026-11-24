/* Гиб · Вебинар — движок код-презентации: навигация, прогрессивное раскрытие,
   анимированные счётчики и донат-диаграмма, заметки ведущего. Без зависимостей. */
'use strict';

const slides = [...document.querySelectorAll('.slide')];
const bar = document.getElementById('progressBar');
const notesPanel = document.getElementById('notes');
const notesText = document.getElementById('notesText');
let current = 0;

function clamp(i) { return Math.max(0, Math.min(slides.length - 1, i)); }

function show(index, dir) {
  const next = clamp(index);
  if (next === current && slides[current].classList.contains('active')) { applyProgress(); return; }
  slides[current]?.classList.remove('active');
  current = next;
  const slide = slides[current];
  slide.classList.add('active');
  // сброс и показ фрагментов по клику
  const frags = [...slide.querySelectorAll('.frag')];
  if (dir !== 'back') frags.forEach(f => f.classList.remove('on'));
  applyProgress();
  animateSlide(slide);
  if (notesText) notesText.textContent = slide.dataset.notes ?? '';
}

function applyProgress() {
  if (bar) bar.style.width = `${((current + 1) / slides.length) * 100}%`;
  const c = slides[current].querySelector('.counter');
  slides.forEach((s, i) => { const el = s.querySelector('.counter'); if (el) el.textContent = `${String(i + 1).padStart(2, '0')} / ${String(slides.length).padStart(2, '0')}`; });
}

function next() {
  const frags = [...slides[current].querySelectorAll('.frag:not(.on)')];
  if (frags.length) { frags[0].classList.add('on'); return; }
  show(current + 1, 'fwd');
}

function prev() {
  const frags = [...slides[current].querySelectorAll('.frag.on')];
  if (frags.length) { frags[frags.length - 1].classList.remove('on'); return; }
  // при возврате назад — показываем все фрагменты предыдущего слайда сразу
  const target = clamp(current - 1);
  if (target !== current) { show(target, 'back'); slides[target].querySelectorAll('.frag').forEach(f => f.classList.add('on')); }
}

/* ---------- анимированные счётчики ---------- */
function animateCounters(slide) {
  slide.querySelectorAll('[data-count]').forEach(el => {
    const target = Number(el.dataset.count);
    const dur = 1100, t0 = performance.now();
    function frame(t) {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(2, -6 * p);
      el.textContent = String(Math.round(target * (p >= 1 ? 1 : eased)));
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
}

/* ---------- донат-диаграмма «48 навыков» ---------- */
const COMPETENCIES = [
  { name: 'Саморегуляция', n: 8, color: '#3E4A6E' },
  { name: 'Отношения', n: 8, color: '#2E6E63' },
  { name: 'Ответственные решения', n: 8, color: '#BE3D1E' },
  { name: 'Самопознание', n: 7, color: '#A67C2E' },
  { name: 'Эмпатия', n: 7, color: '#7A8B4F' },
  { name: 'Творческое мышление', n: 5, color: '#6E4A5E' },
  { name: 'Мышление роста', n: 5, color: '#B98A44' },
];
const TOTAL = COMPETENCIES.reduce((s, c) => s + c.n, 0); // 48

function buildDonut() {
  const svg = document.getElementById('donut');
  const legend = document.getElementById('legend');
  if (!svg || !legend) return;
  const R = 42, C = 2 * Math.PI * R;
  let offset = 0;
  svg.innerHTML = `<circle cx="60" cy="60" r="${R}" stroke="#EAE0CE" stroke-width="26"/>`
    + '<text x="60" y="58" text-anchor="middle" font-size="23" font-weight="700">48</text>'
    + '<text x="60" y="72" text-anchor="middle" font-size="7.2" letter-spacing="1.6" fill="#6E6774">НАВЫКОВ</text>';
  const segments = COMPETENCIES.map(c => {
    const len = (c.n / TOTAL) * C;
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    el.setAttribute('cx', '60');
    el.setAttribute('cy', '60');
    el.setAttribute('r', String(R));
    el.setAttribute('stroke', c.color);
    el.style.strokeDasharray = `0 ${C}`;
    el.style.strokeDashoffset = String(-offset);
    el.dataset.final = `${Math.max(0, len - 2)} ${C}`;
    svg.appendChild(el);
    offset += len;
    return el;
  });
  legend.innerHTML = COMPETENCIES.map(c =>
    `<li><i style="background:${c.color}"></i><b>${c.n}</b> ${c.name}</li>`).join('');
  // старт анимации после первого показа слайда
  requestAnimationFrame(() => requestAnimationFrame(() =>
    segments.forEach(el => { el.style.strokeDasharray = el.dataset.final; })));
}

function animateSlide(slide) {
  animateCounters(slide);
  if (slide.querySelector('#donut')) buildDonut();
}

/* ---------- клавиатура ---------- */
window.addEventListener('keydown', (event) => {
  switch (event.key) {
    case 'ArrowRight': case 'PageDown': case ' ': next(); event.preventDefault(); break;
    case 'ArrowLeft': case 'PageUp': prev(); event.preventDefault(); break;
    case 'Home': show(0, 'fwd'); break;
    case 'End': show(slides.length - 1, 'fwd'); break;
    case 's': case 'S': case 'ы': case 'Ы': notesPanel?.classList.toggle('show'); break;
    case 'f': case 'F': case 'а': case 'А': if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); break;
    default: break;
  }
});

/* ---------- свайпы ---------- */
let sx = null;
window.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
window.addEventListener('touchend', e => {
  if (sx == null) return;
  const dx = e.changedTouches[0].clientX - sx;
  if (Math.abs(dx) > 48) (dx < 0 ? next() : prev());
  sx = null;
}, { passive: true });

/* ---------- печать: все фрагменты в кадре ---------- */
window.addEventListener('beforeprint', () => {
  document.querySelectorAll('.frag').forEach(f => f.classList.add('on'));
  document.querySelectorAll('[data-count]').forEach(el => { el.textContent = el.dataset.count; });
  buildDonut();
});

show(0, 'fwd');
