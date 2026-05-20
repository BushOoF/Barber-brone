import { motion, type HTMLMotionProps } from "framer-motion";
import { haptic } from "../../lib/telegram";
import { forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost" | "destructive" | "dark";
type Size = "sm" | "md" | "lg" | "xl";

export interface ButtonProps extends Omit<HTMLMotionProps<"button">, "ref"> {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  hapticOnPress?: false | "light" | "medium" | "selection";
}

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-tg-button text-tg-buttonText shadow-pop ring-1 ring-black/5 hover:brightness-105 active:brightness-95",
  secondary:
    "bg-surface-2 text-tg-text ring-1 ring-line-strong hover:bg-surface-1",
  ghost:
    "bg-transparent text-tg-text ring-1 ring-line-strong hover:bg-surface-1",
  destructive:
    "bg-tg-destructive text-white shadow-soft ring-1 ring-black/5 hover:brightness-105 active:brightness-95",
  dark:
    "bg-tg-text text-tg-bg shadow-soft ring-1 ring-black/5 hover:brightness-110 active:brightness-95",
};

const sizeClasses: Record<Size, string> = {
  sm: "h-9 px-3 text-sm rounded-xl",
  md: "h-11 px-4 text-sm rounded-xl",
  lg: "h-13 px-5 py-3 text-base rounded-2xl",
  xl: "h-16 px-6 text-lg rounded-2xl font-bold",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", fullWidth, hapticOnPress = "light", className = "", onClick, children, disabled, ...rest },
  ref,
) {
  return (
    <motion.button
      ref={ref}
      type={rest.type ?? "button"}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      transition={{ type: "spring", stiffness: 380, damping: 24 }}
      disabled={disabled}
      onClick={(e) => {
        if (disabled) return;
        if (hapticOnPress) haptic(hapticOnPress);
        onClick?.(e);
      }}
      className={[
        "inline-flex items-center justify-center gap-2 font-semibold tracking-tight",
        "transition-[filter,background-color,box-shadow] duration-150",
        "disabled:opacity-50 disabled:pointer-events-none select-none",
        variantClasses[variant],
        sizeClasses[size],
        fullWidth ? "w-full" : "",
        className,
      ].join(" ")}
      {...rest}
    >
      {children}
    </motion.button>
  );
});
