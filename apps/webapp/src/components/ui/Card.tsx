import type { HTMLAttributes, ReactNode } from "react";

export function Card({ children, className = "", ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={[
        "rounded-2xl bg-surface-1 p-4 ring-1 ring-line-soft",
        className,
      ].join(" ")}
      {...rest}
    >
      {children}
    </div>
  );
}

export function ListItem({
  leading,
  title,
  subtitle,
  trailing,
  onClick,
}: {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex w-full items-center gap-3 rounded-2xl bg-surface-1 px-4 py-3 text-left",
        "ring-1 ring-line-soft transition active:scale-[0.99]",
        onClick ? "hover:bg-surface-2" : "cursor-default",
      ].join(" ")}
    >
      {leading ? <div className="shrink-0">{leading}</div> : null}
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-semibold">{title}</div>
        {subtitle ? <div className="mt-0.5 truncate text-xs text-tg-hint">{subtitle}</div> : null}
      </div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </button>
  );
}
