import { AppShell } from "@/components/app/app-shell";
import { NightSky } from "@/components/app/background";
import { AppProviders } from "@/components/providers/app-providers";

// Rendered per request so runtime configuration (bot username) is available.
export const dynamic = "force-dynamic";

export default function MiniAppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <NightSky />
      <AppProviders botUsername={process.env.TELEGRAM_BOT_USERNAME ?? null}>
        <AppShell>{children}</AppShell>
      </AppProviders>
    </>
  );
}
