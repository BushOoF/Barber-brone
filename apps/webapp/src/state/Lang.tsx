import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { DEFAULT_LANG, translate, type Lang, type TranslationKey } from "../lib/i18n";

interface LangContextValue {
  lang: Lang;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

const LangContext = createContext<LangContextValue>({
  lang: DEFAULT_LANG,
  t: (k, v) => translate(DEFAULT_LANG, k, v),
});

export function LangProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>) => translate(lang, key, vars),
    [lang],
  );
  const value = useMemo<LangContextValue>(() => ({ lang, t }), [lang, t]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useT() {
  return useContext(LangContext).t;
}

export function useLang() {
  return useContext(LangContext).lang;
}
