import { useNavigate } from "react-router-dom";
import { haptic } from "../lib/telegram";
import { useT } from "../state/Lang";

interface Props {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  trailing?: React.ReactNode;
}

export function PageHeader({ title, subtitle, onBack, trailing }: Props) {
  const nav = useNavigate();
  const t = useT();
  return (
    <header className="flex items-center gap-3 px-5 pb-3 pt-4 safe-top">
      <button
        type="button"
        onClick={() => {
          haptic("light");
          if (onBack) onBack();
          else nav(-1);
        }}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-1 ring-1 ring-line-soft transition active:scale-95"
        aria-label={t("common.back")}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-xl font-bold tracking-tight">{title}</h1>
        {subtitle ? <div className="truncate text-xs text-tg-hint">{subtitle}</div> : null}
      </div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </header>
  );
}
