"use client";

import { useEffect } from "react";

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const forbidden = /forbidden|Insufficient admin role/i.test(error.message);
  return (
    <div className="adm-card adm-error-box">
      <h1 className="adm-h2">{forbidden ? "Недостаточно прав" : "Не удалось загрузить раздел"}</h1>
      <p className="adm-muted">
        {forbidden ? "Этот раздел доступен только ролям с более высокими правами." : "Проверьте подключение к базе данных и Redis. Подробности — в логах сервера."}
        {error.digest ? (
          <>
            {" "}
            Код: <span className="adm-mono">{error.digest}</span>
          </>
        ) : null}
      </p>
      {!forbidden ? (
        <button type="button" className="adm-btn adm-btn-primary" onClick={reset}>
          Повторить
        </button>
      ) : null}
    </div>
  );
}
