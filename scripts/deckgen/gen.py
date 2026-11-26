#!/usr/bin/env python3
"""Генератор дек вебинаров родительской линейки №02–12 (скелет №01 + данные weeks_data)."""
import sys, html
from string import Template
from weeks_data import WEEKS

import os
ROOT = os.path.join(os.path.dirname(__file__), '..', '..', 'design', 'webinars')
ROOT = os.path.abspath(ROOT)
YEAR_THEMES = ["Кто я и что я чувствую","Пауза и выбор","Я и другие","Договорённости",
               "Решения и последствия","Ошибка — это данные","Внимание","Память",
               "Гибкость","План и порядок","Творчество","Всё вместе"]
F = '<div class="footer"><span>{left}</span><span class="pagenum">{n} / 23</span></div>'

def year_map(cur):
    cells = []
    for i, t in enumerate(YEAR_THEMES, start=1):
        if i == cur:
            cells.append(f'      <div class="year-cell current"><span class="mark">ВЫ ЗДЕСЬ</span><div class="n">{i:02d}</div><div class="t">{t}</div></div>')
        else:
            cells.append(f'      <div class="year-cell"><div class="n">{i:02d}</div><div class="t">{t}</div></div>')
    return '\n'.join(cells)

def render(w):
    N = w['num']; WN = w['week']
    skill1, skill2 = w['skills']
    chips = '\n      '.join(f'<span class="chip">{c}</span>' for c in w['hands'])
    day_cards = '\n      '.join(
        f'<div class="panel{" lis" if i == 0 else ""} frag" style="padding:13px"><div class="idx">День {i + 1}</div><h3 style="font-size:15px">{html.escape(t)}</h3><p style="font-size:12px">{html.escape(s)}</p></div>'
        for i, (t, s) in enumerate(w['five']))
    sci_cards = '\n      '.join(
        f'<div class="panel {cls}"><div class="idx">{idx}</div><h3>{h3}</h3><p>{p}</p></div>'
        for (idx, h3, p), cls in zip(w['sci'], ['plum', 'lis', 'brass']))
    err_panels = '\n      '.join(
        f'<div class="panel frag" style="padding:13px 18px"><div class="idx">{i + 1:02d} · {html.escape(t)}</div><p style="font-size:14px; margin-top:4px">{html.escape(p)}</p></div>'
        for i, (t, p) in enumerate(w['errors']))
    home_cards = '\n      '.join(
        f'<div class="panel lis frag"><div class="idx">{i + 1:02d}</div><h3>{html.escape(t)}</h3><p>{html.escape(p)}</p></div>'
        for i, (t, p) in enumerate(w['home3']))
    faq_panels = '\n      '.join(
        f'<div class="panel" style="padding:13px 18px"><div class="idx">«{html.escape(q)}»</div><p style="font-size:13.5px; margin-top:4px">{html.escape(a)}</p></div>'
        for q, a in w['faq'])
    skill_cards = '\n      '.join(
        f'<div class="panel lis frag"><div class="idx">{i}</div><h3>{h3}</h3><p>{p}</p></div>'
        for i, h3, p in w['skills'])
    src_cards = '\n      '.join(
        f'<div class="panel" style="padding:11px 16px"><p style="font-size:13px; line-height:1.45; color:var(--ink-soft)">{s}</p></div>'
        for s in w['sources'])
    return Template(TPL).substitute(
        N=N, WN=WN, THEME=w['theme'], COMP=w['comp'], COMP_CODE=w['comp_code'],
        SKILLS_CODE=w['skills_code'], DISPLAY=w['display'], SUBTITLE=w['subtitle'],
        FRAME_H2=w['frame_h2'], FRAME_QUOTE=w['frame_quote'],
        SKILL_CARDS=skill_cards, FIVE_CARDS=day_cards, FOCUS_NOTE=w['focus_note'],
        SCI_CARDS=sci_cards, SCI_FOOT=w['sci_foot'],
        ERRORS_TITLE=w['errors_title'], ERR_PANELS=err_panels, ERRORS_MECH=w['errors_mech'],
        HOME_CARDS=home_cards, HOME_NOTE=w['home_note'],
        CHIPS=chips, SYMBOL_H=w['symbol_h'], SYMBOL_W=w['symbol_w'],
        DINNER_Q=w['dinner_q'], CASE_TITLE=w['case_title'], CASE_TEXT=w['case_text'],
        FAQ_PANELS=faq_panels, NEXT_LINE=w['next_line'], SRC_CARDS=src_cards,
        YEAR_MAP=year_map(WN),
        F01=F.format(left=f'Открытая мастерская · №{N} · Титул', n='01'),
        F02=F.format(left=f'Открытая мастерская · №{N} · Родительская линейка', n='02'),
        F03=F.format(left=f'Открытая мастерская · №{N} · Досье', n='03'),
        F04=F.format(left=f'Открытая мастерская · №{N} · Карта года', n='04'),
        F05=F.format(left=f'Открытая мастерская · №{N} · Механика', n='05'),
        F06=F.format(left=f'Открытая мастерская · №{N} · Неделя {WN}', n='06'),
        F07=F.format(left=f'Открытая мастерская · №{N} · Компетенция', n='07'),
        F08=F.format(left=f'Открытая мастерская · №{N} · Доказательства', n='08'),
        F09=F.format(left=f'Открытая мастерская · №{N} · Символ недели', n='09'),
        F10=F.format(left=f'Открытая мастерская · №{N} · Границы', n='10'),
        F11=F.format(left=f'Открытая мастерская · №{N} · Паспорт', n='11'),
        F12=F.format(left=f'Открытая мастерская · №{N} · Карта навыков', n='12'),
        F13=F.format(left=f'Открытая мастерская · №{N} · Линейки', n='13'),
        F14=F.format(left=f'Открытая мастерская · №{N} · Ошибки', n='14'),
        F15=F.format(left=f'Открытая мастерская · №{N} · Дома', n='15'),
        F16=F.format(left=f'Открытая мастерская · №{N} · Что в руки', n='16'),
        F17=F.format(left=f'Открытая мастерская · №{N} · Вопрос', n='17'),
        F18=F.format(left=f'Открытая мастерская · №{N} · Мини-кейс', n='18'),
        F19=F.format(left=f'Открытая мастерская · №{N} · Вопросы', n='19'),
        F20=F.format(left=f'Открытая мастерская · №{N} · Действие', n='20'),
        F21=F.format(left=f'Открытая мастерская · №{N} · Заметки методиста', n='21'),
        F22=F.format(left=f'Открытая мастерская · №{N} · Источники', n='22'),
        F23=F.format(left=f'Открытая мастерская · №{N} · Спасибо за вопросы', n='23'),
    )

TPL = r'''<!doctype html>
<!-- Гиб · Открытая мастерская · Вебинар №$N «$THEME» — редакторская версия.
     PT Serif + Inter, бумага/чернила/латунь, две гарнитуры, ноль курсива.
     Арт: «Занавес» №NN — assets/bg-hero.jpg (фон, без людей), символ и «что в руки».
     Управление: ← → (раскрытие) · S заметки · F экран · ⌘P печать в PDF. -->
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Гиб · Открытая мастерская · №$N $THEME</title>
<link rel="stylesheet" href="../shared/deck.css">
<link rel="stylesheet" href="art.css">
</head>
<body>
<div class="progress"><i id="progressBar"></i></div>
<div class="stage">

  <!-- 01 · Титульный лист -->
  <section class="slide slide--velvet active" data-title="Титул" data-notes="Открыть тихо: «это встреча на 13 минут, вопросы — в конце». Не перегружать приветствием.">
    <div class="floaters" aria-hidden="true">
      <svg class="floater f-ring-big" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="none" stroke="#F2B544" stroke-width="6.5"/></svg>
      <svg class="floater f-ring-sm" viewBox="0 0 100 100"><circle cx="50" cy="50" r="41" fill="none" stroke="#FFE9A8" stroke-width="9"/></svg>
      <svg class="floater f-tri" viewBox="0 0 100 100"><path d="M50 10 L92 86 L8 86 Z" fill="none" stroke="#FFD97A" stroke-width="6" stroke-linejoin="round"/></svg>
      <svg class="floater f-hex" viewBox="0 0 100 100"><polygon points="50,4 93,27 93,73 50,96 7,73 7,27" fill="rgba(242,181,68,.16)" stroke="#F2B544" stroke-width="5" stroke-linejoin="round"/></svg>
      <svg class="floater f-dot-1" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="#FFE9A8"/></svg>
      <svg class="floater f-dot-2" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="#F2B544"/></svg>
    </div>
    <p class="kicker"><span class="num">ВЫПУСК №$N</span> Журнал программы «Гиб» · Неделя $WN</p>
    <h1 class="display">$DISPLAY</h1>
    <div class="ornament">◆ ◆ ◆</div>
    <p class="lede">$SUBTITLE<br>
    Вебинар для родителей детей 5–13 лет · компетенция недели — <strong>$COMP</strong> · <strong>≈ 13 минут</strong><br>
    Методика «Гиб»: Злата Бабенко · разработка симулятора: Леонид Холматов</p>
    $F01
  </section>

  <!-- 02 · Повестка -->
  <section class="slide" data-title="Повестка" data-notes="Проговорить порядок и время. Сказать: «всё, что здесь, привязано к программе, которую проходит ваш ребёнок».">
    <p class="kicker"><span class="num">ПОВЕСТКА</span> Что будет на этих 13 минутах</p>
    <h2 class="title" style="font-size:38px; margin-bottom:10px">Ход встречи</h2>
    <ul class="agenda">
      <li><span class="t">0:00</span> Зачем этот выпуск — $SUBTITLE<span class="d">открытие</span></li>
      <li><span class="t">1:30</span> Год одной строкой: цифры программы и 12 тем<span class="d">досье</span></li>
      <li><span class="t">3:00</span> Что ребёнок делает в приложении на этой неделе<span class="d">пять дней</span></li>
      <li><span class="t">5:00</span> Компетенция недели и что говорит наука<span class="d">доказательства</span></li>
      <li><span class="t">7:30</span> Три ошибки любящих родителей — и три дела по десять минут<span class="d">практика</span></li>
      <li><span class="t">9:00</span> Что в руки и символ недели<span class="d">практика</span></li>
      <li><span class="t">11:00</span> Вопрос за ужином и одно действие всей недели<span class="d">договор</span></li>
      <li><span class="t">12:30</span> Что дальше: $NEXT_LINE<span class="d">финал</span></li>
    </ul>
    $F02
  </section>

  <!-- 03 · Досье программы -->
  <section class="slide" data-title="Досье" data-notes="«Всё, что вы услышите дальше, — это не обещание, а устройство продукта». Пройтись по каждой цифре коротко.">
    <p class="kicker"><span class="num">ДОСЬЕ</span> Программа одной строкой</p>
    <h2 class="title">Год в пяти числах</h2>
    <div class="fact-grid">
      <div class="fact"><div class="num"><span data-count="36">0</span></div><div class="cap">встреч в году — три занятия на каждую из 12 тем</div></div>
      <div class="fact"><div class="num"><span data-count="48">0</span></div><div class="cap">гибких навыков в 7 компетенциях — полное покрытие проверено тестами</div></div>
      <div class="fact"><div class="num"><span data-count="180">0</span></div><div class="cap">возрастных вариантов сценариев — 60 историй × 3 линейки</div></div>
      <div class="fact"><div class="num"><span data-count="7">0</span></div><div class="cap">типов событий фиксирует движок — без оценочных суждений о личности</div></div>
      <div class="fact"><div class="num"><span data-count="3">0</span></div><div class="cap">точки замера за год: сентябрь · январь · май</div></div>
    </div>
    <p class="footnote"><b>Проверяется по коду:</b> каталог навыков и карт истории — <i>lib/content/skills-catalog.ts</i> (тест: 48 навыков, полное покрытие; 127 историй), события — <i>lib/events/journal.ts</i>, распределение 7 компетенций: саморегуляция 8 · отношения 8 · решения 8 · самопознание 7 · эмпатия 7 · творчество 5 · мышление роста 5.</p>
    $F03
  </section>

  <!-- 04 · Карта года -->
  <section class="slide" data-title="Карта года" data-notes="Показать последовательность тем, подсветить текущую неделю. Не читать все 12.">
    <p class="kicker"><span class="num">КАРТА ГОДА</span> Двенадцать тем родительской линейки</p>
    <h2 class="title" style="font-size:36px">Год — это маршрут, а не список</h2>
    <div class="year-map">
$YEAR_MAP
    </div>
    <p class="footnote"><b>Структура:</b> 12 тем по 3 занятия = 36 встреч в год; порядок нарастает от телесного («чувствую») к когнитивному («внимание», «память», «гибкость») и замыкается интеграцией («всё вместе»). Родитель видит свой выпуск в той же последовательности, что и ребёнок в продукте.</p>
    $F04
  </section>

  <!-- 05 · Механика занятия -->
  <section class="slide" data-title="Как устроено занятие" data-notes="Медленно по шагам: ситуация → тело → пауза → выбор. Главное — сказать: «правильных ответов нет, выбор есть всегда».">
    <p class="kicker"><span class="num">МЕХАНИКА</span> Как устроено одно занятие</p>
    <h2 class="title" style="font-size:38px">Сцена, а не тест</h2>
    <div class="flow">
      <div class="step"><div class="k">01 · Сцена</div><div class="v">Лис, Мира или Тима</div><div class="s">Короткая история в приложении: привычная ситуация из жизни ребёнка.</div></div>
      <div class="step"><div class="k">02 · Тело</div><div class="v">Реакция до слов</div><div class="s">«Мне тяжело» начинается не в голове, а в плечах, животе и челюсти — ребёнок учится замечать это раньше голоса.</div></div>
      <div class="step"><div class="k">03 · Пауза</div><div class="v">Окно выбора</div><div class="s">Между стимулом и действием — пауза. Её длительность растёт с практикой.</div></div>
      <div class="step"><div class="k">04 · Ход</div><div class="v">Выбор ребёнка</div><div class="s">Вариантов «верных» нет: есть выбор и его последствия. Награда одинакова за любой ход.</div></div>
      <div class="step"><div class="k">05 · След</div><div class="v">Что остаётся взрослому</div><div class="s">Поведение: что выбрано, сколько пауз, сколько времени занял ответ — без оценок личности.</div></div>
    </div>
    $F05
  </section>
'''

TPL += r'''
  <!-- 06 · Пять дней недели -->
  <section class="slide" data-title="Пять дней недели" data-notes="Каждый день — одна ситуация и один ход. Ситуации дословно из программы.">
    <p class="kicker"><span class="num">НЕДЕЛЯ $WN</span> Что ребёнок делает в приложении</p>
    <h2 class="title" style="font-size:36px">Пять дней «$THEME»</h2>
    <div class="cards" style="grid-template-columns:repeat(5,1fr); gap:10px; margin-top:6px">
$FIVE_CARDS
    </div>
    <p class="footnote"><b>Фокус недели:</b> $FOCUS_NOTE. Тексты дней сверены с программой (неделя $WN, компетенция <i>$COMP_CODE</i>).</p>
    $F06
  </section>

  <!-- 07 · Компетенция недели -->
  <section class="slide" data-title="Компетенция $COMP" data-notes="Повторить формулу недели трижды, медленно. Это рамка всей недели.">
    <p class="kicker"><span class="num">КОМПЕТЕНЦИЯ</span> $COMP · $SKILLS_CODE</p>
    <h2 class="title">$FRAME_H2</h2>
    <p class="anchor-quote"><span class="qmark">«</span>$FRAME_QUOTE<span class="qmark">»</span></p>
    <div class="cards c2" style="margin-top:22px">
$SKILL_CARDS
    </div>
    $F07
  </section>

  <!-- 08 · Наука -->
  <section class="slide" data-title="Что говорит наука" data-notes="Три факта — и сразу честная граница. Не читать DOIs вслух, названия и цифры.">
    <p class="kicker"><span class="num">ДОКАЗАТЕЛЬСТВА</span> Что известно — и откуда цифры</p>
    <h2 class="title" style="font-size:40px">Что мы берём из исследований</h2>
    <div class="cards c3" style="margin-top:4px">
$SCI_CARDS
    </div>
    <p class="footnote">$SCI_FOOT</p>
    $F08
  </section>

  <!-- 09 · Символ недели -->
  <section class="slide" data-title="Символ недели" data-notes="«Это якорь недели — вы увидите его в коробке с практикой». Один образ, одна фраза.">
    <p class="kicker"><span class="num">СИМВОЛ НЕДЕЛИ</span> $THEME</p>
    <h2 class="title" style="font-size:36px">$SYMBOL_H</h2>
    <div class="art-symbol"><img src="assets/symbol.jpg" alt="Символ недели: $THEME"></div>
    <p class="lede" style="margin-top:12px; text-align:center; color:var(--ink-soft)">$SYMBOL_W</p>
    $F09
  </section>

  <!-- 10 · Чего мы НЕ утверждаем -->
  <section class="slide" data-title="Чего мы не утверждаем" data-notes="Это самый важный слайд доверия. Читать ровно, без оправданий. «Мы продаём практику, а не диагнозы».">
    <p class="kicker"><span class="num">ЧЕСТНЫЕ ГРАНИЦЫ</span> Что «Гиб» не делает</p>
    <h2 class="title" style="font-size:40px">Список того, чего <span class="accent">нет</span></h2>
    <div class="cards c2" style="margin-top:2px">
      <div class="panel"><div class="idx">Нет диагнозов</div><h3>«Уровень эмпатии» не считается</h3><p>Продукт — регистратор вовлечённости и поведения в сценариях: что выбрал, сколько паузил, сколько времени занял ответ. Оценки личности не выставляются.</p></div>
      <div class="panel"><div class="idx">Нет сравнений</div><h3>Ребёнок не сравнивается ни с кем</h3><p>Ни с другими детьми, ни с нормой возраста, ни с «как было в семье раньше». Награда одинакова за любой выбор.</p></div>
      <div class="panel"><div class="idx">Нет «правильного ответа»</div><h3>Ветка — не экзамен</h3><p>Каждый выбор получает ту же награду; мы поощряем осмысленный выбор, а не угадывание «одобренного взрослыми» хода.</p></div>
      <div class="panel"><div class="idx">Нет замены врачу</div><h3>Кризис — к специалисту</h3><p>Ночные страхи, отказ от еды, смена настроения дольше двух недель, самоповреждение — повод к детскому психологу очно.</p></div>
    </div>
    <p class="footnote"><b>Проверяется по коду:</b> <i>lib/events/journal.ts</i> — события без оценок личности; <i>lib/engine/session.ts</i> — любой выбор завершает сцену с равной наградой; паспорт исследования — <i>docs/research-passport.md</i>.</p>
    $F10
  </section>

  <!-- 11 · Паспорт исследования -->
  <section class="slide" data-title="Паспорт исследования" data-notes="Если в зале методологи/исследователи — это их слайд: продукт как «нулевой уровень» данных.">
    <p class="kicker"><span class="num">ПАСПОРТ</span> Что продукт фиксирует на самом деле</p>
    <h2 class="title" style="font-size:38px">Семь типов событий — и ни одного сверх</h2>
    <table class="table">
      <thead><tr><th>Событие</th><th>Что несёт</th><th>Что даёт</th></tr></thead>
      <tbody>
        <tr><td class="ev">session_started</td><td>день, повтор, journey</td><td>факт начала занятия и возврата</td></tr>
        <tr><td class="ev">story_selected</td><td>cardId, offerSize</td><td>какую историю и из скольких выбрал</td></tr>
        <tr><td class="ev">story_answered</td><td>choiceIndex, itemCount</td><td>какой ход, из скольких вариантов</td></tr>
        <tr><td class="ev">practice_answered</td><td>skipped</td><td>прошёл практику или отказался</td></tr>
        <tr><td class="ev">task_answered</td><td>taskKind, taskSkill, ms</td><td>верность, помощь, время ответа</td></tr>
        <tr><td class="ev">session_completed</td><td>steps, correct, stars, seconds</td><td>завершение дня и ритм прохождения</td></tr>
        <tr><td class="ev">profile_created</td><td>band</td><td>линейка возраста</td></tr>
      </tbody>
    </table>
    <p class="footnote"><b>Зачем нам это на вебинаре:</b> это не «про науку», а про доверие: вы всегда знаете, что о вашем ребёнке известно программе — и чего она о нём принципиально не знает.</p>
    $F11
  </section>

  <!-- 12 · 48 навыков донат -->
  <section class="slide" data-title="48 навыков" data-notes="Показать плотность: программа — конструктор из 48 деталей.">
    <p class="kicker"><span class="num">КАРТА</span> 48 навыков · 7 компетенций</p>
    <h2 class="title" style="font-size:38px">Из чего собран год</h2>
    <div class="donut-wrap">
      <svg class="donut" id="donut" viewBox="0 0 120 120" role="img" aria-label="Распределение 48 навыков по 7 компетенциям"></svg>
      <ul class="legend" id="legend"></ul>
    </div>
    <p class="footnote"><b>Распределение:</b> саморегуляция 8 · отношения 8 · решения 8 · самопознание 7 · эмпатия 7 · творчество 5 · мышление роста 5. Один навык — ровно одна компетенция; проверено тестом согласования.</p>
    $F12
  </section>

  <!-- 13 · Три линейки -->
  <section class="slide" data-title="Три линейки" data-notes="«У первоклашки и семиклассника разные миры — мы не делаем вид, что они одинаковые».">
    <p class="kicker"><span class="num">ЛИНЕЙКИ</span> Возраст — не настройка, а другой мир</p>
    <h2 class="title" style="font-size:38px">Один метод, три языка</h2>
    <div class="cards c3" style="margin-top:4px">
      <div class="panel plum hero"><div class="hero-window lis"><img src="../shared/img/lis-window.jpg" alt="Лис — проводник линейки 5–7 лет" loading="lazy"></div><div class="idx">5–7 лет · Лис</div><h3>Тело и первая опора</h3><p>Медленные истории, короткие фразы. Опора — взрослый рядом. Акцент: телесные сигналы до слов.</p></div>
      <div class="panel lis hero"><div class="hero-window mira"><img src="../shared/img/mira-window.jpg" alt="Мира — проводница линейки 8–10 лет" loading="lazy"></div><div class="idx">8–10 лет · Мира</div><h3>Слова и сверстники</h3><p>Конфликт и договорённость: «вижу, что тебе обидно» вместо оценки — готовая модель фразы для жизни.</p></div>
      <div class="panel brass hero"><div class="hero-window tima"><img src="../shared/img/tima-window.jpg" alt="Тима — проводник линейки 11–13 лет" loading="lazy"></div><div class="idx">11–13 лет · Тима</div><h3>Пауза и ответственность</h3><p>Выборы с последствиями, приватность как право, «пауза — навык, а не характер».</p></div>
    </div>
    <p class="footnote"><b>Тексты:</b> одна ситуация программно размечена на три возрастных варианта; переключение внутри приложения, родитель видит отчёты своей линейки.</p>
    $F13
  </section>

'''

TPL += r'''
  <!-- 14 · Три ошибки -->
  <section class="slide" data-title="Три ошибки родителя" data-notes="После каждой ошибки — пауза. «Узнавание» здесь сильнее любой лекции.">
    <p class="kicker"><span class="num">ОШИБКИ</span> $ERRORS_TITLE</p>
    <h2 class="title" style="font-size:38px">Прежде чем чинить ребёнка</h2>
    <div class="cards" style="gap:12px; margin-top:2px">
$ERR_PANELS
    </div>
    <p class="footnote"><b>$ERRORS_MECH</b></p>
    $F14
  </section>

  <!-- 15 · Три дела по десять минут -->
  <section class="slide" data-title="Три дела по десять минут" data-notes="Попросить выбрать одно, не больше. «Домашнее задание» у взрослого? одно.">
    <p class="kicker"><span class="num">ДОМА</span> Три вещи, которые стоят вечера</p>
    <h2 class="title" style="font-size:38px">Десять минут — и никакого расписания</h2>
    <div class="cards c3" style="margin-top:4px">
$HOME_CARDS
    </div>
    <p class="footnote"><b>Заметка недели, написанная заранее:</b> $HOME_NOTE</p>
    $F15
  </section>

  <!-- 16 · Что в руки -->
  <section class="slide" data-title="Что в руки" data-notes="«Всё, что здесь, помещается в одну сумку». Показать и убрать в сторону.">
    <p class="kicker"><span class="num">ЧТО В РУКИ</span> Практика недели · предметы</p>
    <h2 class="title" style="font-size:36px">Что приготовить дома</h2>
    <div class="art-wide"><img src="assets/hands.jpg" alt="Натюрморт предметов недели: $THEME"></div>
    <div class="chips">
      $CHIPS
    </div>
    $F16
  </section>

  <!-- 17 · Вопрос за ужином -->
  <section class="slide" data-title="Вопрос за ужином" data-notes="Прочитать вслух один раз. Спросить «кто запишет?». Самый тихий слайд — самый дорогой.">
    <p class="kicker"><span class="num">ВОПРОС</span> Один вопрос — один ответ</p>
    <p class="anchor-quote" style="font-size:clamp(24px,2.9vw,36px); max-width:36ch; margin-top:10px"><span class="qmark">«</span>$DINNER_Q<span class="qmark">»</span></p>
    <p class="lede" style="margin-top:20px">Без оценивания. «Да, конечно» — правильный ответ. «Нет» — правильный ответ. «Не знаю» — тоже ответ: он просто присматривается молча.</p>
    <p class="lede" style="margin-top:12px; color:var(--lis); font-weight:600">Слушайте ответ дольше, чем говорите в нём сами.</p>
    $F17
  </section>

  <!-- 18 · Мини-кейс -->
  <section class="slide" data-title="Мини-кейс недели" data-notes="«Смоделированный, но типичный» — обязательно проговорить это вслух. Один раз, без морали сверху.">
    <p class="kicker"><span class="num">МИНИ-КЕЙС</span> Смоделированный, но типичный</p>
    <h2 class="title" style="font-size:38px">$CASE_TITLE</h2>
    <div class="panel plum" style="margin-top:6px; padding:20px 26px">
      <p style="font-size:17px; line-height:1.6">$CASE_TEXT</p>
    </div>
    <p class="footnote"><b>Откуда:</b> истории недели собраны по мотивам сценариев программы (неделя $WN, $COMP); герои и детали вымышлены, паттерн — типичный.</p>
    $F18
  </section>

  <!-- 19 · FAQ недели -->
  <section class="slide" data-title="Четыре возражения" data-notes="Если зал молчит — задать себе первым. Возражения снимаются фактами, а не тоном.">
    <p class="kicker"><span class="num">ВОПРОСЫ</span> Что обычно спрашивают про эту неделю</p>
    <h2 class="title" style="font-size:36px">Честные ответы</h2>
    <div class="cards c2" style="gap:12px; margin-top:2px">
$FAQ_PANELS
    </div>
    $F19
  </section>

  <!-- 20 · Одно действие -->
  <section class="slide" data-title="Одно действие на неделю" data-notes="Последняя просьба встречи. Одна — и только одна.">
    <p class="kicker"><span class="num">ДЕЙСТВИЕ</span> Если взять только одно</p>
    <h2 class="title" style="font-size:42px">Откройте <span class="accent">день 1</span> вместе</h2>
    <p class="lede" style="margin-top:6px">Десять минут любого вечера недели. Без оценок, без подсказок. Вы рядом с чаем — не с проверкой. Всё остальное программа сделает сама.</p>
    <p class="footnote"><b>Дальше по программе:</b> $NEXT_LINE.</p>
    $F20
  </section>

  <!-- 21 · Как устроены замеры -->
  <section class="slide" data-title="Как устроены замеры" data-notes="Показать шкалу года и сказать: «нас интересует динамика, не балл».">
    <p class="kicker"><span class="num">ЗАМЕРЫ</span> Год в трёх точках</p>
    <h2 class="title" style="font-size:38px">Сентябрь · январь · май</h2>
    <div class="year-track">
      <div class="pt" style="left:8%"><div class="dot"></div><b>Сентябрь</b><span>вход · привычные сценарии, «до»</span></div>
      <div class="pt mid" style="left:50%"><div class="dot"></div><b>Январь</b><span>середина · отделяет рост навыка от привычки к игре</span></div>
      <div class="pt end" style="left:92%"><div class="dot"></div><b>Май</b><span>итог · «после» · перенос в жизнь</span></div>
    </div>
    <p class="footnote"><b>Почему не «до/после»:</b> один цикл «60 дней» давал две точки и путал рост навыка с привыканием к игре. Три точки за год дают динамику без ложных обещаний — и ни одной цифры «уровня» в отчёте родителя.</p>
    $F21
  </section>

  <!-- 22 · Источники -->
  <section class="slide" data-title="Источники" data-notes="Показывать, если спросят «откуда цифры». Читать не надо.">
    <p class="kicker"><span class="num">ИСТОЧНИКИ</span> Что мы можем доказать</p>
    <h2 class="title" style="font-size:34px">Все цифры на слайдах имеют адрес</h2>
    <div class="cards" style="gap:8px; margin-top:2px">
$SRC_CARDS
      <div class="panel" style="padding:11px 16px"><p style="font-size:13px; line-height:1.45; color:var(--ink-soft)"><b>Программа «Гиб»:</b> 36 занятий · 12 тем · 60 историй × 3 линейки · 48 навыков · замеры сентябрь/январь/май. <b>Документы:</b> <i>docs/research-passport.md</i> · <i>docs/skills-map.md</i> · <i>docs/program-year-design.md</i> · <i>lib/events/journal.ts</i></p></div>
    </div>
    $F22
  </section>

  <!-- 23 · Закрытие -->
  <section class="slide slide--velvet" data-title="Закрытие" data-notes="Спасибо, вопросы. Не продавать — помогать решить, подходит ли.">
    <div class="floaters" aria-hidden="true">
      <svg class="floater f-ring-big" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="none" stroke="#F2B544" stroke-width="6.5"/></svg>
      <svg class="floater f-ring-sm" viewBox="0 0 100 100"><circle cx="50" cy="50" r="41" fill="none" stroke="#FFE9A8" stroke-width="9"/></svg>
      <svg class="floater f-tri" viewBox="0 0 100 100"><path d="M50 10 L92 86 L8 86 Z" fill="none" stroke="#FFD97A" stroke-width="6" stroke-linejoin="round"/></svg>
      <svg class="floater f-hex" viewBox="0 0 100 100"><polygon points="50,4 93,27 93,73 50,96 7,73 7,27" fill="rgba(242,181,68,.16)" stroke="#F2B544" stroke-width="5" stroke-linejoin="round"/></svg>
      <svg class="floater f-dot-1" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="#FFE9A8"/></svg>
      <svg class="floater f-dot-2" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="#F2B544"/></svg>
    </div>
    <p class="kicker"><span class="num">ФИНАЛ</span> Гиб · Открытая мастерская</p>
    <h1 class="display" style="font-size:clamp(48px,5.6vw,72px)">Тихо войти<br>в <em class="accent">год</em></h1>
    <p class="lede" style="margin-top:18px">Не «вырастить чемпиона», а <strong>дать ребёнку язык для себя</strong> — годом, в 36 встречах, без оценок и без спешки.</p>
    <p class="lede" style="margin-top:10px; color:rgba(253,244,233,.68); font-size:16px">$NEXT_LINE · пригласительная ссылка: <strong style="color:var(--gold)">[ССЫЛКА — впишите]</strong></p>
    $F23
  </section>

</div>
<div class="hud"><kbd>←</kbd> <kbd>→</kbd> · <kbd>S</kbd> заметки · <kbd>F</kbd> во весь экран</div>
<aside class="notes" id="notes"><b>ЗАМЕТКИ ВЕДУЩЕГО · </b><span id="notesText"></span></aside>
<script src="../shared/deck.js"></script>
</body>
</html>
'''

for w in WEEKS:
    out_dir = f'{ROOT}/parent-{w["num"]}'
    with open(f'{out_dir}/index.html', 'w') as f:
        f.write(render(w))
    art_css = (
        "/* Фон титула и закрытия выпуска: ART в стиле «Занавес» (без людей). */\n"
        ".slide--velvet {\n"
        "  background:\n"
        "    var(--grain),\n"
        "    linear-gradient(90deg, rgba(23, 7, 24, .88) 0%, rgba(23, 7, 24, .62) 34%, rgba(23, 7, 24, .18) 52%, rgba(23, 7, 24, .05) 68%, rgba(23, 7, 24, .38) 100%),\n"
        "    linear-gradient(180deg, rgba(23, 7, 24, .4) 0%, rgba(23, 7, 24, .05) 26%, rgba(23, 7, 24, .12) 66%, rgba(23, 7, 24, .6) 100%),\n"
        "    url('assets/bg-hero.jpg') right center / cover no-repeat,\n"
        "    linear-gradient(180deg, #3C1836 0%, #2C102A 48%, #200A20 100%);\n"
        "}\n"
    )
    with open(f'{out_dir}/art.css', 'w') as f:
        f.write(art_css)
    print('written', out_dir)
