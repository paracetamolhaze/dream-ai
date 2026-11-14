"use client";

import { useState } from "react";

export function CopyButton({ value, label = "Копировать" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="adm-btn adm-btn-ghost adm-btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          window.prompt("Скопируйте вручную:", value);
        }
      }}
    >
      {done ? "Скопировано ✓" : label}
    </button>
  );
}
