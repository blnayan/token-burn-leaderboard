"use client";

import { Moon, Sun } from "lucide-react";
import React, { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

type ThemePreference = "system" | "light" | "dark";

const themeStorageKey = "token-burn-theme";
function isThemePreference(value: string | null): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

function readStoredTheme(): ThemePreference {
  if (typeof window === "undefined") return "system";

  try {
    const storedTheme = window.localStorage.getItem(themeStorageKey);
    return isThemePreference(storedTheme) ? storedTheme : "system";
  } catch {
    return "system";
  }
}

function applyTheme(theme: ThemePreference, systemPrefersDark?: boolean) {
  if (typeof document === "undefined") return;

  document.documentElement.classList.remove("light", "dark");

  if (theme === "system") {
    const prefersDark = systemPrefersDark ?? getSystemPrefersDark();

    if (prefersDark) {
      document.documentElement.classList.add("dark");
    }
    return;
  }

  document.documentElement.classList.add(theme);
}

function storeTheme(theme: ThemePreference) {
  if (typeof window === "undefined") return;

  try {
    if (theme === "system") {
      window.localStorage.removeItem(themeStorageKey);
      return;
    }

    window.localStorage.setItem(themeStorageKey, theme);
  } catch {
    // If storage is unavailable, the visible theme still updates for this page.
  }
}

function getSystemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

function ThemeIcon() {
  return (
    <>
      <Sun className="rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span className="sr-only">Toggle theme</span>
    </>
  );
}

export function ThemeSwitcher() {
  const [theme, setTheme] = useState<ThemePreference>(readStoredTheme);

  useEffect(() => {
    applyTheme(theme);

    if (theme !== "system" || typeof window.matchMedia !== "function") return;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemTheme = (event: MediaQueryListEvent) => applyTheme("system", event.matches);

    media.addEventListener("change", updateSystemTheme);
    return () => media.removeEventListener("change", updateSystemTheme);
  }, [theme]);

  function updateTheme() {
    const nextTheme = document.documentElement.classList.contains("dark") ? "light" : "dark";
    const systemTheme = getSystemPrefersDark() ? "dark" : "light";
    const nextPreference: ThemePreference = nextTheme === systemTheme ? "system" : nextTheme;

    setTheme(nextPreference);
    storeTheme(nextPreference);
  }

  return (
    <Button aria-label="Toggle theme" onClick={updateTheme} size="icon" type="button" variant="outline">
      <ThemeIcon />
    </Button>
  );
}
