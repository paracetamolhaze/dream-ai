import { AppShell } from "@/components/app/app-shell";
import { NightSky } from "@/components/app/background";
import { AppProviders } from "@/components/providers/app-providers";

/**
 * Fully static layout (works both on the backend and as a static export on a CDN).
 * The bot username is inlined at build time (NEXT_PUBLIC_BOT_USERNAME); without it the
 * "open in Telegram" screen asks the backend's public /api/config at runtime.
 */
export default function MiniAppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <NightSky />
      <AppProviders botUsername={process.env.NEXT_PUBLIC_BOT_USERNAME || null}>
        <AppShell>{children}</AppShell>
      </AppProviders>
    </>
  );
}
