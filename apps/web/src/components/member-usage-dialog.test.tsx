// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MemberUsageDetail } from "@token-burn/shared";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MemberUsageDialog } from "./member-usage-dialog";

vi.mock("./member-usage-charts", () => ({
  MemberUsageCharts: ({
    onToggleDevice,
    onToggleModel,
    onToggleProvider,
  }: {
    onToggleDevice: (deviceId: string) => void;
    onToggleModel: (model: { provider: "codex"; modelName: string }) => void;
    onToggleProvider: (provider: "codex") => void;
  }) => (
    <div>
      <button type="button" onClick={() => onToggleProvider("codex")}>
        Mock provider Codex
      </button>
      <button type="button" onClick={() => onToggleModel({ provider: "codex", modelName: "gpt-5" })}>
        Mock model gpt-5
      </button>
      <button type="button" onClick={() => onToggleDevice("device-1")}>
        Mock device Workstation
      </button>
    </div>
  ),
}));

const detail = {
  member: {
    username: "ada",
    displayName: "Ada",
  },
  period: "7d",
  summary: {
    rank: 1,
    totalTokens: 12400,
    totalCostUsd: 12.34,
  },
  trend: [{ date: "2026-06-01", totalTokens: 12400, totalCostUsd: 12.34 }],
  providers: [{ provider: "codex", totalTokens: 12400, totalCostUsd: 12.34 }],
  models: [{ provider: "codex", modelName: "gpt-5", totalTokens: 12400, totalCostUsd: 12.34 }],
  devices: [
    {
      deviceId: "device-1",
      deviceName: "Workstation",
      os: "linux",
      totalTokens: 12400,
      totalCostUsd: 12.34,
    },
  ],
} satisfies MemberUsageDetail;

function mockSuccessfulFetch(responseDetail: MemberUsageDetail = detail) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => responseDetail,
  });
  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

function deferredFetchResponse(responseDetail: MemberUsageDetail = detail) {
  let resolve!: (value: { ok: true; json: () => Promise<MemberUsageDetail> }) => void;
  const promise = new Promise<{ ok: true; json: () => Promise<MemberUsageDetail> }>((resolver) => {
    resolve = resolver;
  });

  return {
    promise,
    resolve: () =>
      resolve({
        ok: true,
        json: async () => responseDetail,
      }),
  };
}

async function renderOpenDialog(fetchMock = mockSuccessfulFetch()) {
  render(
    <MemberUsageDialog
      member={{ username: "ada", displayName: "Ada", rank: 1 }}
      open
      onOpenChange={() => {}}
    />,
  );

  expect(await screen.findByRole("heading", { name: "Ada" })).toBeTruthy();

  return fetchMock;
}

describe("MemberUsageDialog", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("fetches member usage when opened and renders the member heading with token summary", async () => {
    const fetchMock = mockSuccessfulFetch();

    render(
      <MemberUsageDialog
        member={{ username: "ada", displayName: "Ada", rank: 1 }}
        open
        onOpenChange={() => {}}
      />,
    );

    expect(screen.getByText("Loading member usage...")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/leaderboard/members/ada?range=7d");
    expect(screen.getByRole("tab", { name: "Past 7 days" }).getAttribute("data-state")).toBe("active");

    expect(await screen.findByRole("heading", { name: "Ada" })).toBeTruthy();

    expect(screen.getByText("Tokens")).toBeTruthy();
    expect(screen.getByText("12.4K")).toBeTruthy();
  });

  it("falls back to the leaderboard rank from the selected member", async () => {
    mockSuccessfulFetch({
      ...detail,
      summary: {
        ...detail.summary,
        rank: null,
      },
    });

    render(
      <MemberUsageDialog
        member={{ username: "ada", displayName: "Ada", rank: 3 }}
        open
        onOpenChange={() => {}}
      />,
    );

    expect(await screen.findByText("#3")).toBeTruthy();
  });

  it("shows a retryable error state and recovers after retry", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "nope" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => detail,
      });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemberUsageDialog
        member={{ username: "ada", displayName: "Ada", rank: 1 }}
        open
        onOpenChange={() => {}}
      />,
    );

    expect(await screen.findByText("Could not load member usage.")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("heading", { name: "Ada" })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("lets the dialog switch from Past 7 days to Past 30 days", async () => {
    const user = userEvent.setup();
    const fetchMock = mockSuccessfulFetch({ ...detail, period: "30d" });

    render(
      <MemberUsageDialog
        member={{ username: "ada", displayName: "Ada", rank: 1 }}
        open
        onOpenChange={() => {}}
      />,
    );

    expect(await screen.findByRole("heading", { name: "Ada" })).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: "Past 30 days" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith("/api/leaderboard/members/ada?range=30d");
    });
    expect(screen.getByRole("tab", { name: "Past 30 days" }).getAttribute("data-state")).toBe("active");
  });

  it("adds provider, model, and device filters to member usage requests", async () => {
    const user = userEvent.setup();
    const fetchMock = await renderOpenDialog();

    await user.click(screen.getByRole("button", { name: "Mock provider Codex" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith("/api/leaderboard/members/ada?range=7d&provider=codex");
    });

    await user.click(screen.getByRole("button", { name: "Mock device Workstation" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/leaderboard/members/ada?range=7d&provider=codex&device=device-1",
      );
    });

    await user.click(screen.getByRole("button", { name: "Mock model gpt-5" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/leaderboard/members/ada?range=7d&model=codex%3Agpt-5&device=device-1",
      );
    });
  });

  it("keeps the existing chart visible while a filter request refreshes", async () => {
    const user = userEvent.setup();
    const pendingProviderResponse = deferredFetchResponse({
      ...detail,
      summary: {
        ...detail.summary,
        totalTokens: 24000,
      },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => detail,
      })
      .mockReturnValueOnce(pendingProviderResponse.promise);
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemberUsageDialog
        member={{ username: "ada", displayName: "Ada", rank: 1 }}
        open
        onOpenChange={() => {}}
      />,
    );

    expect(await screen.findByText("12.4K")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Mock provider Codex" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith("/api/leaderboard/members/ada?range=7d&provider=codex");
    });
    expect(screen.getByText("12.4K")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mock provider Codex" })).toBeTruthy();

    pendingProviderResponse.resolve();

    expect(await screen.findByText("24K")).toBeTruthy();
  });

  it("clears model selections when provider filters are selected and clears providers when models are selected", async () => {
    const user = userEvent.setup();
    const fetchMock = await renderOpenDialog();

    await user.click(screen.getByRole("button", { name: "Mock model gpt-5" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith("/api/leaderboard/members/ada?range=7d&model=codex%3Agpt-5");
    });

    await user.click(screen.getByRole("button", { name: "Mock provider Codex" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith("/api/leaderboard/members/ada?range=7d&provider=codex");
    });

    await user.click(screen.getByRole("button", { name: "Mock model gpt-5" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith("/api/leaderboard/members/ada?range=7d&model=codex%3Agpt-5");
    });
  });

  it("resets selected filters when the range changes", async () => {
    const user = userEvent.setup();
    const fetchMock = await renderOpenDialog();

    await user.click(screen.getByRole("button", { name: "Mock provider Codex" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith("/api/leaderboard/members/ada?range=7d&provider=codex");
    });

    await user.click(screen.getByRole("tab", { name: "Past 30 days" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith("/api/leaderboard/members/ada?range=30d");
    });

    await user.click(screen.getByRole("tab", { name: "Past 7 days" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith("/api/leaderboard/members/ada?range=7d");
    });
  });

  it("resets selected filters when the member changes", async () => {
    const user = userEvent.setup();
    const fetchMock = mockSuccessfulFetch();
    const view = render(
      <MemberUsageDialog
        member={{ username: "ada", displayName: "Ada", rank: 1 }}
        open
        onOpenChange={() => {}}
      />,
    );

    expect(await screen.findByRole("heading", { name: "Ada" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Mock provider Codex" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith("/api/leaderboard/members/ada?range=7d&provider=codex");
    });

    view.rerender(
      <MemberUsageDialog
        member={{ username: "grace", displayName: "Grace", rank: 2 }}
        open
        onOpenChange={() => {}}
      />,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith("/api/leaderboard/members/grace?range=7d");
    });

    view.rerender(
      <MemberUsageDialog
        member={{ username: "ada", displayName: "Ada", rank: 1 }}
        open
        onOpenChange={() => {}}
      />,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith("/api/leaderboard/members/ada?range=7d");
    });
  });

  it("removes individual chips and clears all active filters", async () => {
    const user = userEvent.setup();
    const fetchMock = await renderOpenDialog();

    await user.click(screen.getByRole("button", { name: "Mock provider Codex" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith("/api/leaderboard/members/ada?range=7d&provider=codex");
    });

    await user.click(await screen.findByRole("button", { name: "Remove provider filter Codex" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith("/api/leaderboard/members/ada?range=7d");
    });

    await user.click(screen.getByRole("button", { name: "Mock device Workstation" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith("/api/leaderboard/members/ada?range=7d&device=device-1");
    });

    await user.click(screen.getByRole("button", { name: "Clear all" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith("/api/leaderboard/members/ada?range=7d");
    });
  });
});
