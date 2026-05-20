import { motion } from "framer-motion";
import { haptic } from "../lib/telegram";
import { useT } from "../state/Lang";

interface Props {
  label: string;
  value: number;
  min: number;
  max?: number;
  onChange: (v: number) => void;
  icon?: string;
}

export function PartyStepper({ label, value, min, max = 10, onChange, icon }: Props) {
  const t = useT();
  const dec = () => {
    if (value <= min) return;
    haptic("light");
    onChange(value - 1);
  };
  const inc = () => {
    if (value >= max) return;
    haptic("light");
    onChange(value + 1);
  };
  const subtitle =
    value === 0
      ? t("common.none")
      : `${value} ${value === 1 ? t("common.person") : t("common.people")}`;
  return (
    <div className="flex items-center justify-between rounded-2xl bg-surface-1 px-4 py-3 ring-1 ring-line-soft">
      <div className="flex items-center gap-3">
        {icon ? <div className="text-xl">{icon}</div> : null}
        <div>
          <div className="text-base font-bold">{label}</div>
          <div className="text-[11px] text-tg-hint">{subtitle}</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <StepButton onClick={dec} disabled={value <= min}>−</StepButton>
        <motion.div
          key={value}
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 480, damping: 22 }}
          className="w-7 text-center text-xl font-extrabold tabular-nums"
        >
          {value}
        </motion.div>
        <StepButton onClick={inc} disabled={value >= max}>+</StepButton>
      </div>
    </div>
  );
}

function StepButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.88 }}
      transition={{ type: "spring", stiffness: 460, damping: 20 }}
      className="flex h-10 w-10 items-center justify-center rounded-full bg-tg-bg text-xl font-extrabold ring-1 ring-line-strong shadow-soft disabled:opacity-40"
    >
      {children}
    </motion.button>
  );
}
