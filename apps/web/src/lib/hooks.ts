"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

export function useDebounced<T>(value: T, delayMs: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return v;
}

function readSession<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * useState persisted in sessionStorage (survives back navigation inside the
 * Mini App). Screens render only on the client (after the session gate), so
 * reading storage in the initializer is safe.
 */
export function useSessionState<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => readSession(key, initial));
  const set = useCallback(
    (v: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
        try {
          window.sessionStorage.setItem(key, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [key],
  );
  return [value, set];
}

const noopSubscribe = () => () => undefined;

/** true on the client, false during server rendering — without effects. */
export function useMounted(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

/** Calls `onVisible` when the sentinel element scrolls into view. */
export function useInView<T extends Element>(onVisible: () => void, enabled: boolean): React.RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const cb = useRef(onVisible);
  useEffect(() => {
    cb.current = onVisible;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) cb.current();
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [enabled]);
  return ref;
}

/** Auto-growing textarea height. */
export function useAutosize(ref: React.RefObject<HTMLTextAreaElement | null>, value: string, minRows = 6): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight || "24") || 24;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, lineHeight * minRows)}px`;
  }, [ref, value, minRows]);
}
