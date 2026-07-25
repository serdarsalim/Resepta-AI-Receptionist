"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  isLanguage,
  translate,
  type Language,
  type TranslationKey,
} from "./i18n";

type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: TranslationKey) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  // Server render always uses the default so markup matches on hydration; the
  // stored/org preference is applied in the effect below.
  const [language, setLanguageState] = useState<Language>(DEFAULT_LANGUAGE);

  useEffect(() => {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (isLanguage(stored)) {
      setLanguageState(stored);
      return;
    }
    // navigator.language is a full tag, so a browser reporting de-AT or de-CH
    // resolves to de the same way en-US resolves to en.
    const browser = navigator.language.split("-")[0];
    if (isLanguage(browser)) setLanguageState(browser);
  }, []);

  // Keep the document tag honest whatever moved the language: the stored
  // preference, the browser, the org, or the picker. Screen readers and
  // hyphenation read this, and German is where a wrong lang starts to show.
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
  }, []);

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      t: (key: TranslationKey) => translate(language, key),
    }),
    [language, setLanguage],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage outside LanguageProvider");
  return context;
}

// Convenience for components that only need the translate function.
export function useT(): (key: TranslationKey) => string {
  return useLanguage().t;
}
