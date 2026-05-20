import { motion, AnimatePresence } from "framer-motion";
import type { ReactNode } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** Optional footer content rendered with a separator above and safe-bottom padding. */
  footer?: ReactNode;
}

/**
 * Bottom sheet primitive with spring entrance + tap-outside-to-close.
 * Designed to feel native on Telegram (rounded top, drag handle, safe-area aware).
 */
export function Sheet({ open, onClose, title, children, footer }: Props) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-50 flex items-end bg-black/45 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 32, stiffness: 320 }}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[92dvh] w-full flex-col rounded-t-[28px] bg-tg-bg shadow-[0_-12px_40px_rgba(0,0,0,0.18)]"
          >
            <div className="flex justify-center pt-2 pb-1">
              <div className="h-1.5 w-12 rounded-full bg-line-strong" />
            </div>
            {title ? (
              <div className="px-5 pb-2 pt-1">
                <h2 className="text-xl font-bold tracking-tight">{title}</h2>
              </div>
            ) : null}
            <div className="overflow-y-auto px-5 pb-2 pt-2">{children}</div>
            {footer ? (
              <div className="border-t border-line-soft px-5 pt-3 safe-bottom">{footer}</div>
            ) : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
