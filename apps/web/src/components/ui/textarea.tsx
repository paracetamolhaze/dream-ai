"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";
import { useAutosize } from "@/lib/hooks";
import { cn } from "@/lib/utils";

interface Props extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value"> {
  value: string;
  minRows?: number;
}

/** Auto-growing textarea styled as a calm "paper" surface. */
export const AutoTextarea = forwardRef<HTMLTextAreaElement, Props>(function AutoTextarea({ value, minRows = 6, className, ...props }, ref) {
  const inner = useRef<HTMLTextAreaElement | null>(null);
  useImperativeHandle(ref, () => inner.current as HTMLTextAreaElement);
  useAutosize(inner, value, minRows);
  return (
    <textarea
      ref={inner}
      value={value}
      className={cn(
        "block w-full resize-none rounded-[22px] border border-white/[0.07] bg-white/[0.03] px-5 py-4 text-[16px] leading-[1.65] text-fg outline-none transition-colors placeholder:text-fg-dim focus:border-lilac-300/35 focus:bg-white/[0.045]",
        className,
      )}
      {...props}
    />
  );
});

export const TextInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function TextInput({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-12 w-full rounded-2xl border border-white/[0.08] bg-white/[0.04] px-4 text-[16px] text-fg outline-none transition-colors placeholder:text-fg-dim focus:border-lilac-300/40",
        className,
      )}
      {...props}
    />
  );
});
