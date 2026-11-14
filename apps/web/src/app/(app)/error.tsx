"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/app/states";
import { useT } from "@/i18n";

export default function ScreenError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="safe-top flex min-h-app items-center justify-center px-5">
      <ErrorState title={t.app.errorTitle} text={t.app.errorText} onRetry={reset} retryLabel={t.common.tryAgain} />
    </div>
  );
}
