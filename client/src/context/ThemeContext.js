import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export const THEME_STORAGE_KEY = "digitalether-pos-theme";
export const COLOR_THEME_STORAGE_KEY = "digitalether-pos-color-theme";

/** Checkout accent: sale type strip + Complete sale button. */
export const COLOR_THEME_OPTIONS = [
  { value: "light-orange", label: "Light orange" },
  { value: "dark-orange", label: "Dark orange" },
  { value: "light-blue", label: "Light blue" },
  { value: "dark-blue", label: "Dark blue" },
];

const ThemeContext = createContext(null);

function readStoredTheme() {
  if (typeof window === "undefined") return "dark";
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    /* ignore */
  }
  return "dark";
}

function readStoredColorTheme() {
  if (typeof window === "undefined") return "light-orange";
  try {
    const stored = window.localStorage.getItem(COLOR_THEME_STORAGE_KEY);
    if (COLOR_THEME_OPTIONS.some((o) => o.value === stored)) return stored;
  } catch {
    /* ignore */
  }
  return "light-orange";
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(readStoredTheme);
  const [colorTheme, setColorThemeState] = useState(readStoredColorTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.colorTheme = colorTheme;
    try {
      window.localStorage.setItem(COLOR_THEME_STORAGE_KEY, colorTheme);
    } catch {
      /* ignore */
    }
  }, [colorTheme]);

  const setTheme = useCallback((next) => {
    setThemeState(next === "light" ? "light" : "dark");
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((t) => (t === "dark" ? "light" : "dark"));
  }, []);

  const setColorTheme = useCallback((next) => {
    setColorThemeState(
      COLOR_THEME_OPTIONS.some((o) => o.value === next) ? next : "light-orange"
    );
  }, []);

  const value = useMemo(
    () => ({ theme, setTheme, toggleTheme, colorTheme, setColorTheme }),
    [theme, setTheme, toggleTheme, colorTheme, setColorTheme]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}
