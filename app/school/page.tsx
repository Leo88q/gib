import Link from 'next/link';
import type { Metadata } from 'next';
import {
  SCHOOL_LIMITS,
  SCHOOL_MEASURES,
  SCHOOL_NEEDS,
  schoolFacts,
  schoolMeetingBlocks,
  schoolOutline,
  schoolStages,
} from '@/lib/year/school.ts';
import { MEETING_MINUTES } from '@/lib/year/meeting.ts';

export const metadata: Metadata = {
  title: 'Курс для школы: 36 занятий, 40 минут',
  description:
    'Что школа получает: занятия, темы, структура встречи, что наблюдается и чего курс не обещает. Все числа — из программы, а не из презентации.',
};

/**
 * Страница для завуча и директора.
 *
 * Зачем отдельная страница, а не PDF. PDF живёт отдельно от продукта и
 * расходится с ним за месяц. Эта страница собрана из тех же данных, что и
 * кабинет педагога, поэтому показывает то, что школа действительно получит.
 *
 * Чего здесь нет:
 *  - формы заявки: страница честно говорит, что дальше нужно письмо;
 *  - процентов эффективности и обещаний оценок;
 *  - слова «диагностика»: наблюдение и разговор — не диагноз.
 */
export default function SchoolPage() {
  const facts = schoolFacts();
  const outline = schoolOutline();
  const blocks = schoolMeetingBlocks();
  const stages = schoolStages();

  return (
    <div className="wrap">
      <div className="card hero-card">
        <div className="hero-text">
          <span className="tag">Для школы</span>
          <h1>Курс на год: {facts[0].value} занятий по {MEETING_MINUTES} минут</h1>
          <p className="muted" style={{ marginBottom: 0 }}>
            Гибкие навыки через актёрское мастерство. Числа на этой странице собраны из самой
            программы: если программа изменится, изменится и страница.
          </p>
        </div>
      </div>

      {/* ---- Что получает школа ---- */}
      <div className="card">
        <h2>Что получает школа</h2>
        <table className="school-table">
          <tbody>
            {facts.map((fact) => (
              <tr key={fact.label}>
                <th scope="row">{fact.label}</th>
                <td>
                  <strong>{fact.value}</strong>
                  <div className="muted small">Источник: {fact.source}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ---- Структура года ---- */}
      <div className="card">
        <h2>Год по темам</h2>
        <p className="muted small">
          Тема — это несколько занятий подряд. Каждая заканчивается показом: дети показывают то,
          что получилось, по желанию. За год таких показов двенадцать вместо одного выпускного.
        </p>
        <ol className="school-outline">
          {outline.map((item) => (
            <li key={item.unit}>
              <strong>{item.title}</strong>
              <span className="muted small">
                {' '}
                — {item.lessons} {item.lessons === 1 ? 'занятие' : item.lessons < 5 ? 'занятия' : 'занятий'}
                {item.showcase ? ', показ в конце' : ''}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {/* ---- Что делает педагог ---- */}
      <div className="card">
        <h2>Что делает педагог {MEETING_MINUTES} минут</h2>
        <table className="school-table">
          <tbody>
            {blocks.map((block) => (
              <tr key={block.title}>
                <th scope="row">{block.title}</th>
                <td>{block.minutes} минут</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">
          Бумажных карточек нет: задания и истории открываются в приложении на проекторе или
          планшете.
        </p>
      </div>

      {/* ---- Этапы года ---- */}
      <div className="card">
        <h2>Три этапа года</h2>
        <p className="muted small">
          Этапы нужны, чтобы сентябрь, январь и май не были одинаковыми разговорами. Это не
          четверти и не зачётные точки.
        </p>
        {stages.map((stage) => (
          <div key={stage.title} className="school-stage">
            <strong>{stage.title}</strong>
            <p className="muted small">{stage.task}</p>
            <p className="small">Вопрос этапа: «{stage.question}»</p>
          </div>
        ))}
      </div>

      {/* ---- Что наблюдается ---- */}
      <div className="card">
        <h2>Что наблюдается и чего это не значит</h2>
        <table className="school-table">
          <thead>
            <tr>
              <th scope="col">Что</th>
              <th scope="col">Как</th>
              <th scope="col">Чего это не значит</th>
            </tr>
          </thead>
          <tbody>
            {SCHOOL_MEASURES.map((measure) => (
              <tr key={measure.what}>
                <th scope="row">{measure.what}</th>
                <td>{measure.how}</td>
                <td className="muted small">{measure.limit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ---- Границы ---- */}
      <div className="card">
        <h2>Чего курс не делает</h2>
        <ul>
          {SCHOOL_LIMITS.map((limit) => (
            <li key={limit}>{limit}</li>
          ))}
        </ul>
      </div>

      {/* ---- Что нужно от школы ---- */}
      <div className="card">
        <h2>Что нужно от школы</h2>
        <ul>
          {SCHOOL_NEEDS.map((need) => (
            <li key={need}>{need}</li>
          ))}
        </ul>
        <p className="muted small">
          Стоимость, формат договора и обучение педагога обсуждаются отдельно: на этой странице их
          нет, чтобы не обещать цену, которая ещё не согласована.
        </p>
      </div>

      <div className="card">
        <h2>Дальше</h2>
        <p className="muted small">
          Педагог ведёт занятие по плану встречи в{' '}
          <Link href="/teacher">кабинете</Link>, родитель видит отчёт в{' '}
          <Link href="/parent">кабинете родителя</Link>. Обе страницы работают на тех же данных,
          что и эта сводка.
        </p>
        <p className="muted small">
          Ссылка на страницу — не заявка. Чтобы обсудить пилот, напишите нам; мы не собираем
          контакты через форму, потому что для неё нужны согласие и политика хранения данных.
        </p>
      </div>
    </div>
  );
}
