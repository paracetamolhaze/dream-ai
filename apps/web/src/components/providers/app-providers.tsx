"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { ToastProvider } from "@/components/ui/toast";
import { I18nProvider } from "@/i18n";
import { shouldRetry } from "@/lib/queries";
import { SessionGate } from "./session";

export function AppProviders({ children, botUsername }: { children: React.ReactNode; botUsername: string | null }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 10_000, retry: shouldRetry, refetchOnWindowFocus: true },
          mutations: { retry: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <I18nProvider>
        <MotionConfig reducedMotion="user">
          <ToastProvider>
            <SessionGate botUsername={botUsername}>{children}</SessionGate>
          </ToastProvider>
        </MotionConfig>
      </I18nProvider>
    </QueryClientProvider>
  );
}
