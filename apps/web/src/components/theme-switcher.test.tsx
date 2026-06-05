// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeSwitcher } from "./theme-switcher";

describe("ThemeSwitcher", () => {
  let mediaListeners: Array<(event: MediaQueryListEvent) => void> = [];

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
    mediaListeners = [];
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: (_event: "change", listener: (event: MediaQueryListEvent) => void) => {
          mediaListeners.push(listener);
        },
        removeEventListener: (_event: "change", listener: (event: MediaQueryListEvent) => void) => {
          mediaListeners = mediaListeners.filter((candidate) => candidate !== listener);
        },
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("defaults to system theme without forcing a light or dark class", () => {
    render(<ThemeSwitcher />);

    expect(screen.getByRole("button", { name: "Toggle theme" })).toBeTruthy();
    expect(screen.queryByText("System")).toBeNull();
    expect(document.documentElement.classList.contains("light")).toBe(false);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("token-burn-theme")).toBeNull();
  });

  it("defaults to the resolved system dark theme when the OS prefers dark", () => {
    vi.mocked(window.matchMedia).mockImplementation(
      (query: string) =>
        ({
          matches: true,
          media: query,
          onchange: null,
          addEventListener: (_event: "change", listener: (event: MediaQueryListEvent) => void) => {
            mediaListeners.push(listener);
          },
          removeEventListener: (_event: "change", listener: (event: MediaQueryListEvent) => void) => {
            mediaListeners = mediaListeners.filter((candidate) => candidate !== listener);
          },
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) as unknown as MediaQueryList,
    );

    render(<ThemeSwitcher />);

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
    expect(localStorage.getItem("token-burn-theme")).toBeNull();
  });

  it("toggles from system light to explicit dark and back to system light", async () => {
    const user = userEvent.setup();

    render(<ThemeSwitcher />);

    await user.click(screen.getByRole("button", { name: "Toggle theme" }));

    expect(document.documentElement.classList.contains("light")).toBe(false);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("token-burn-theme")).toBe("dark");

    await user.click(screen.getByRole("button", { name: "Toggle theme" }));

    expect(document.documentElement.classList.contains("light")).toBe(false);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("token-burn-theme")).toBeNull();
  });

  it("toggles from system dark to explicit light and back to system dark", async () => {
    const user = userEvent.setup();

    vi.mocked(window.matchMedia).mockImplementation(
      (query: string) =>
        ({
          matches: true,
          media: query,
          onchange: null,
          addEventListener: (_event: "change", listener: (event: MediaQueryListEvent) => void) => {
            mediaListeners.push(listener);
          },
          removeEventListener: (_event: "change", listener: (event: MediaQueryListEvent) => void) => {
            mediaListeners = mediaListeners.filter((candidate) => candidate !== listener);
          },
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) as unknown as MediaQueryList,
    );

    render(<ThemeSwitcher />);

    await user.click(screen.getByRole("button", { name: "Toggle theme" }));

    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("token-burn-theme")).toBe("light");

    await user.click(screen.getByRole("button", { name: "Toggle theme" }));

    expect(document.documentElement.classList.contains("light")).toBe(false);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("token-burn-theme")).toBeNull();
  });

  it("updates the resolved system theme when the OS preference changes", () => {
    render(<ThemeSwitcher />);

    expect(document.documentElement.classList.contains("dark")).toBe(false);

    mediaListeners.forEach((listener) => listener({ matches: true } as MediaQueryListEvent));

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
  });
});
