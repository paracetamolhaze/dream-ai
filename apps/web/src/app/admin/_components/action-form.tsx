"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState, AdminAction } from "../_lib/types";

/**
 * Form bound to an admin server action. Shows pending state and the action's
 * result inline; optional browser confirmation for destructive actions.
 */
export function ActionForm({
  action,
  children,
  confirm,
  className,
  resetOnSuccess,
  inline,
}: {
  action: AdminAction;
  children: ReactNode;
  confirm?: string;
  className?: string;
  resetOnSuccess?: boolean;
  inline?: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form
      ref={ref}
      action={formAction}
      className={`${inline ? "adm-form-inline" : "adm-form"} ${className ?? ""}`}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      aria-busy={pending}
    >
      {children}
      {state ? (
        <p key={state.at} role="status" className={`adm-msg ${state.ok ? "adm-msg-ok" : "adm-msg-err"}`}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

export function Submit({ children, variant = "primary", size, name, value }: { children: ReactNode; variant?: "primary" | "ghost" | "danger" | "subtle"; size?: "sm"; name?: string; value?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} disabled={pending} className={`adm-btn adm-btn-${variant} ${size ? `adm-btn-${size}` : ""}`}>
      {pending ? <span className="adm-spinner" aria-hidden /> : null}
      {children}
    </button>
  );
}
