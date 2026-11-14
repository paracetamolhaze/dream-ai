"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { NotificationPrefsDto, ProfileDto } from "@dream/core/dto";
import { PageHeader } from "@/components/app/page-header";
import { useMe } from "@/components/providers/session";
import { Segmented, SectionTitle, Switch } from "@/components/ui/controls";
import { useToast } from "@/components/ui/toast";
import { useErrorMessage, useLocale, useT, type Locale } from "@/i18n";
import { api } from "@/lib/api";
import { qk } from "@/lib/queries";

function detectTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

export default function SettingsPage() {
  const t = useT();
  const [locale, setLocale] = useLocale();
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const [timezone] = useState(detectTimezone);
  const [timeDraft, setTimeDraft] = useState<string | null>(null);
  const prefs = me.notifications;

  async function save(body: { language?: Locale; notifications?: Partial<NotificationPrefsDto>; timezone?: string }): Promise<boolean> {
    try {
      const updated = await api<ProfileDto>("/api/profile", { method: "PATCH", body });
      qc.setQueryData(qk.profile, updated);
      return true;
    } catch (err) {
      toast.error(errorMessage(err));
      return false;
    }
  }

  // Timezone is detected on the device and saved so reminders arrive at local time.
  useEffect(() => {
    if (timezone && timezone !== me.timezone) void save({ timezone });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timezone]);

  async function setPref<K extends keyof NotificationPrefsDto>(key: K, value: NotificationPrefsDto[K]) {
    const previous = qc.getQueryData<ProfileDto>(qk.profile) ?? me;
    // Optimistic: reflect the change immediately, roll back on failure.
    qc.setQueryData<ProfileDto>(qk.profile, { ...previous, notifications: { ...previous.notifications, [key]: value } });
    const ok = await save({ notifications: { [key]: value } as Partial<NotificationPrefsDto> });
    if (!ok) qc.setQueryData(qk.profile, previous);
  }

  const reminderTime = timeDraft ?? prefs.reminderTime;
  const tz = timezone ?? me.timezone;

  return (
    <div className="min-h-app pb-[calc(var(--app-bottom)+28px)]">
      <PageHeader backHref="/profile" title={t.settings.title} large />

      <section className="mt-6 px-5">
        <SectionTitle>{t.settings.language}</SectionTitle>
        <Segmented
          label={t.settings.language}
          value={locale}
          onChange={async (l) => {
            const prev = locale;
            setLocale(l);
            if (!(await save({ language: l }))) setLocale(prev);
          }}
          options={[
            { value: "ru", label: t.settings.languageNames.ru },
            { value: "en", label: t.settings.languageNames.en },
          ]}
        />
      </section>

      <section className="mt-8 px-5">
        <SectionTitle>{t.settings.notifications}</SectionTitle>
        <div className="glass divide-y divide-white/[0.05] overflow-hidden rounded-[24px]">
          <Row title={t.settings.generationReady} hint={t.settings.generationReadyHint}>
            <Switch checked={prefs.generationReady} onCheckedChange={(v) => void setPref("generationReady", v)} label={t.settings.generationReady} />
          </Row>
          <Row title={t.settings.reminders} hint={t.settings.remindersHint}>
            <Switch checked={prefs.reminders} onCheckedChange={(v) => void setPref("reminders", v)} label={t.settings.reminders} />
          </Row>
          {prefs.reminders ? (
            <Row title={t.settings.reminderTime} hint={tz ? t.settings.timezone(tz) : undefined}>
              <input
                type="time"
                value={reminderTime}
                onChange={(e) => setTimeDraft(e.target.value)}
                onBlur={(e) => {
                  const v = e.target.value;
                  setTimeDraft(null);
                  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(v) && v !== prefs.reminderTime) void setPref("reminderTime", v);
                }}
                className="h-10 rounded-xl border border-white/[0.08] bg-white/[0.05] px-3 text-[15px] text-fg [color-scheme:dark] outline-none focus:border-lilac-300/40"
                aria-label={t.settings.reminderTime}
              />
            </Row>
          ) : null}
          <Row title={t.settings.product} hint={t.settings.productHint}>
            <Switch checked={prefs.product} onCheckedChange={(v) => void setPref("product", v)} label={t.settings.product} />
          </Row>
        </div>
      </section>
    </div>
  );
}

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3.5">
      <div className="min-w-0">
        <p className="text-[15px] font-medium text-fg">{title}</p>
        {hint ? <p className="mt-0.5 text-[12.5px] leading-snug text-fg-dim">{hint}</p> : null}
      </div>
      {children}
    </div>
  );
}
