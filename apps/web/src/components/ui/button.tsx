"use client";

import { forwardRef } from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import { haptic } from "@/lib/telegram";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap font-semibold tracking-[-0.005em] transition-[transform,background-color,box-shadow,opacity,filter,color] duration-200 ease-out active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "btn-moonlight hover:brightness-[1.04]",
        gold: "btn-gold hover:brightness-[1.03]",
        secondary: "border border-white/[0.09] bg-white/[0.06] text-fg hover:bg-white/[0.09]",
        ghost: "text-fg-muted hover:bg-white/[0.05] hover:text-fg",
        outline: "border border-lilac-300/25 bg-lilac-400/[0.06] text-lilac-200 hover:bg-lilac-400/[0.1]",
        danger: "border border-rose-400/20 bg-rose-400/10 text-rose-300 hover:bg-rose-400/15",
        link: "h-auto px-0 text-lilac-300 underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-9 rounded-full px-3.5 text-[13px] [&_svg]:size-4",
        md: "h-11 rounded-full px-5 text-sm [&_svg]:size-[18px]",
        lg: "h-14 rounded-full px-7 text-[15px] [&_svg]:size-5",
        icon: "size-11 rounded-full [&_svg]:size-5",
        "icon-sm": "size-9 rounded-full [&_svg]:size-[18px]",
      },
      block: { true: "w-full" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  /** Telegram haptic on press. */
  haptics?: "light" | "medium" | "soft" | "none";
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, block, asChild, loading, haptics = "light", onClick, children, disabled, type, ...props },
  ref,
) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : (type ?? "button")}
      className={cn(buttonVariants({ variant, size, block }), className)}
      disabled={asChild ? undefined : disabled || loading}
      aria-busy={loading || undefined}
      onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
        if (haptics !== "none") haptic.impact(haptics);
        onClick?.(e);
      }}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
          {children}
        </>
      )}
    </Comp>
  );
});

export { buttonVariants };
