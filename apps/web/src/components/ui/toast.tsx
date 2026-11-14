"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CircleAlert, CircleCheck, Info } from "lucide-react";
import { haptic } from "@/lib/telegram";
import { cn } from "@/lib/utils";

type Tone = "default" | "success" | "error";
interface ToastItem {
  id: number;
  title: string;
  description?: string;
  tone: Tone;
}

interface ToastApi {
  toast: (t: { title: string; description?: string; tone?: Tone }) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);

  const toast = useCallback(
    ({ title, description, tone = "default" }: { title: string; description?: string; tone?: Tone }) => {
      const id = ++seq.current;
      if (tone === "success") haptic.notify("success");
      if (tone === "error") haptic.notify("error");
      setItems((xs) => [...xs.slice(-2), { id, title, description, tone }]);
      setTimeout(() => dismiss(id), tone === "error" ? 4200 : 3000);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      toast,
      success: (title, description) => toast({ title, description, tone: "success" }),
      error: (title, description) => toast({ title, description, tone: "error" }),
    }),
    [toast],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[80] flex flex-col items-center gap-2 px-4 pt-[calc(var(--app-top)+10px)]" aria-live="polite" role="status">
        <AnimatePresence initial={false}>
          {items.map((it) => {
            const Icon = it.tone === "success" ? CircleCheck : it.tone === "error" ? CircleAlert : Info;
            return (
              <motion.button
                key={it.id}
                type="button"
                layout
                initial={{ opacity: 0, y: -14, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.98, transition: { duration: 0.18 } }}
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
                onClick={() => dismiss(it.id)}
                className="glass-strong pointer-events-auto flex w-full max-w-[420px] items-start gap-3 rounded-2xl px-4 py-3 text-left"
              >
                <Icon className={cn("mt-0.5 size-[18px] shrink-0", it.tone === "success" ? "text-mint-300" : it.tone === "error" ? "text-rose-300" : "text-lilac-300")} aria-hidden />
                <span className="min-w-0">
                  <span className="block text-[14px] leading-snug font-semibold text-fg">{it.title}</span>
                  {it.description ? <span className="mt-0.5 block text-[13px] leading-snug text-fg-muted">{it.description}</span> : null}
                </span>
              </motion.button>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("ToastProvider is missing");
  return ctx;
}
