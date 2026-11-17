'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'gib:cookie-notice-v1';

/**
 * Уведомление о куках.
 *
 * Сервис использует только технически необходимые cookie (серверная сессия
 * входа и родительский доступ) — согласия на них по 152-ФЗ не требуется,
 * поэтому это не «баннер согласия», а честное уведомление: одна кнопка
 * «Понятно» и ссылка на страницу «Куки» с перечнем того, что хранится на
 * устройстве. Рекламных и аналитических cookie здесь нет и подразумеваться
 * под этим баннером не могут.
 */
export default function CookieNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      setVisible(localStorage.getItem(STORAGE_KEY) !== '1');
    } catch {
      setVisible(false);
    }
  }, []);

  if (!visible) return null;

  return (
    <div className="cookie-notice" role="status" aria-live="polite">
      <p>
        Мы используем только технически необходимые cookie: вход в кабинет и родительский доступ.
        Рекламной и аналитической слежки нет. <a href="/legal/cookies">Что именно хранится на устройстве</a>
      </p>
      <div className="cookie-notice-actions">
        <button
          type="button"
          className="btn"
          onClick={() => {
            try {
              localStorage.setItem(STORAGE_KEY, '1');
            } catch {
              /* приватный режим — просто скрываем до следующей загрузки */
            }
            setVisible(false);
          }}
        >
          Понятно
        </button>
      </div>
    </div>
  );
}
