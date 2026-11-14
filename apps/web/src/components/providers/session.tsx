"use client";

import { createContext, useContext, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProfileDto, SessionDto } from "@dream/core/dto";
import { FullScreenMessage, Splash } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { useLocale, useT } from "@/i18n";
import { api, isApiError } from "@/lib/api";
import { NotInTelegramError, isDevIdentity } from "@/lib/auth";
import { brand } from "@/lib/brand";
import { qk, useProfile } from "@/lib/queries";
import { getWebApp, initTelegram, isInTelegram, openTelegramLink } from "@/lib/telegram";

type GateState =
  | { kind: "loading" }
  | { kind: "ready"; session: SessionDto }
  | { kind: "outside" }
  | { kind: "restricted" }
  | { kind: "auth" }
  | { kind: "error" };

interface SessionValue {
  session: SessionDto;
  demoMode: boolean;
  devIdentity: boolean;
}

const SessionContext = createContext<SessionValue | null>(null);

/**
 * Bootstraps the Mini App: Telegram init, server session (user upsert +
 * deep-link redirect), locale. Children render only with a valid session.
 */
export function SessionGate({ children, botUsername }: { children: React.ReactNode; botUsername: string | null }) {
  const t = useT();
  const [, setLocale] = useLocale();
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const redirected = useRef(false);
  const initialPath = useRef(pathname);

  // The session is bootstrapped once per launch: Telegram init, server upsert,
  // locale and deep-link redirect. Modelled as a query so no effect sets state.
  const sessionQ = useQuery({
    queryKey: ["session"],
    queryFn: async () => {
      initTelegram(brand.background);
      // The server records the `app_open` event (with the verified start parameter for attribution).
      const session = await api<SessionDto>("/api/session", { method: "POST", body: { inTelegram: isInTelegram(), platform: getWebApp()?.platform ?? "web" } });
      qc.setQueryData<ProfileDto>(qk.profile, session.user);
      setLocale(session.user.language);
      if (session.redirect && !redirected.current && initialPath.current === "/") {
        redirected.current = true;
        router.replace(session.redirect);
      }
      return session;
    },
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const err = sessionQ.error;
  const state: GateState = sessionQ.data
    ? { kind: "ready", session: sessionQ.data }
    : sessionQ.isPending || sessionQ.isFetching
      ? { kind: "loading" }
      : err instanceof NotInTelegramError
        ? { kind: "outside" }
        : isApiError(err, "account_restricted")
          ? { kind: "restricted" }
          : isApiError(err, "unauthorized")
            ? { kind: isInTelegram() ? "auth" : "outside" }
            : { kind: "error" };

  // Keep the UI language in sync with the profile (e.g. after changing it in settings).
  const profile = useProfile();
  const language = state.kind === "ready" ? profile.data?.language : undefined;
  useEffect(() => {
    if (language) setLocale(language);
  }, [language, setLocale]);

  if (state.kind === "loading") return <Splash />;
  if (state.kind === "outside") {
    const bot = botUsername;
    return (
      <FullScreenMessage
        title={t.app.outsideTitle}
        text={t.app.outsideText}
        action={
          bot ? (
            <Button size="lg" onClick={() => openTelegramLink(`https://t.me/${bot}`)}>
              {t.app.outsideButton}
            </Button>
          ) : undefined
        }
      />
    );
  }
  if (state.kind === "restricted") return <FullScreenMessage title={t.app.restrictedTitle} text={t.app.restrictedText} />;
  if (state.kind === "auth") return <FullScreenMessage title={t.app.authErrorTitle} text={t.app.authErrorText} />;
  if (state.kind === "error")
    return (
      <FullScreenMessage
        title={t.app.errorTitle}
        text={t.app.errorText}
        action={
          <Button
            variant="secondary"
            size="lg"
            onClick={() => void sessionQ.refetch()}
          >
            {t.app.reload}
          </Button>
        }
      />
    );

  return <SessionContext.Provider value={{ session: state.session, demoMode: state.session.demoMode, devIdentity: isDevIdentity() }}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionGate");
  return ctx;
}

/** Profile with live updates (falls back to the session snapshot). */
export function useMe(): ProfileDto {
  const { session } = useSession();
  const profile = useProfile();
  return profile.data ?? session.user;
}
