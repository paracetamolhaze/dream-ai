import Link from "next/link";

export default function AdminNotFound() {
  return (
    <div className="adm-card adm-error-box">
      <h1 className="adm-h2">Не найдено</h1>
      <p className="adm-muted">Запись не существует или была удалена.</p>
      <Link href="/admin" className="adm-btn adm-btn-ghost">
        На дашборд
      </Link>
    </div>
  );
}
