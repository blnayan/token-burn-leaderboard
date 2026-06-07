# Member Usage Breakdown Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users click provider, model, and device breakdown rows in the member usage dialog to filter the chart and Tokens/Cost summary.

**Architecture:** Filtering is server-backed because the current response only has one aggregate trend. The dialog owns local filter state, sends repeated query parameters to the member usage endpoint, and receives a filtered summary/trend while keeping breakdown rows visible as clickable controls. Server query helpers apply all active filters to summary/trend and apply cross-category filters to breakdown lists so users can continue adding/removing rows.

**Tech Stack:** Next.js App Router, React client components, Vitest, Testing Library, Prisma, zod, shadcn/ui Button and Badge, Recharts via shadcn Chart, Tailwind CSS semantic tokens.

---

## File Structure

- Modify `packages/shared/src/schemas.ts` to add `deviceId` to public member usage device breakdown rows.
- Modify `packages/shared/src/schemas.test.ts` to require `deviceId` for device breakdown rows.
- Modify `apps/web/src/server/leaderboard.ts` to add filter types, query builders, filtered summary/trend aggregation, filtered breakdown aggregation, and model-cost fallback support under filters.
- Modify `apps/web/src/server/leaderboard.test.ts` to cover provider/model/device filter semantics.
- Modify `apps/web/src/app/api/leaderboard/members/[username]/route.ts` to parse repeated `provider`, `model`, and `device` query parameters and reject provider+model conflicts.
- Modify `apps/web/src/app/api/leaderboard/members/[username]/route.test.ts` to cover valid filters and validation errors.
- Add shadcn `Badge` component under `apps/web/src/components/ui/badge.tsx` for active filter chips.
- Modify `apps/web/src/components/member-usage-dialog.tsx` to own filter state, build filtered request URLs, reset filters when member/range changes, and render active filter chips.
- Modify `apps/web/src/components/member-usage-dialog.test.tsx` to cover URL changes, category clearing, device composition, and clear-all behavior.
- Modify `apps/web/src/components/member-usage-charts.tsx` to render clickable breakdown rows with `aria-pressed` and filter callbacks.
- Modify `apps/web/src/components/member-usage-charts.test.tsx` to cover pressed rows and callbacks.

### Task 1: Device ID In Public Detail Schema

**Files:**
- Modify: `packages/shared/src/schemas.ts`
- Modify: `packages/shared/src/schemas.test.ts`

- [ ] **Step 1: Write the failing shared schema test**

In `packages/shared/src/schemas.test.ts`, update the accepted detail fixture device row:

```ts
devices: [
  {
    deviceId: "device-1",
    deviceName: "Ada MacBook",
    os: "darwin",
    totalTokens: 100,
    totalCostUsd: 1.25,
  },
],
```

Add an assertion in the same test:

```ts
expect(parsed.devices[0]?.deviceId).toBe("device-1");
```

Add a rejection case:

```ts
expect(() =>
  memberUsageDetailSchema.parse({
    member: { username: "ada", displayName: "Ada" },
    period: "7d",
    summary: { rank: null, totalTokens: 0, totalCostUsd: 0 },
    trend: [],
    providers: [],
    models: [],
    devices: [
      {
        deviceName: "Ada MacBook",
        os: "darwin",
        totalTokens: 100,
        totalCostUsd: 1.25,
      },
    ],
  }),
).toThrow();
```

Update every other `memberUsageDetailSchema.parse` fixture that includes valid device rows so those rows include a stable `deviceId`. Keep the device-id-missing fixture above as the only test where `deviceId` is intentionally absent.

- [ ] **Step 2: Run the failing shared test**

Run:

```bash
pnpm --dir packages/shared test -- schemas.test.ts
```

Expected: FAIL because `deviceId` is not in `memberUsageDeviceBreakdownSchema`.

- [ ] **Step 3: Implement schema support**

In `packages/shared/src/schemas.ts`, change `memberUsageDeviceBreakdownSchema` to:

```ts
export const memberUsageDeviceBreakdownSchema = z.object({
  deviceId: z.string().trim().min(1).max(120),
  deviceName: z.string().trim().min(1).max(80),
  os: z.enum(["darwin", "linux", "win32"]),
  totalTokens: z.number().int().nonnegative().safe(),
  totalCostUsd: costUsdSchema,
});
```

- [ ] **Step 4: Run shared tests**

Run:

```bash
pnpm --dir packages/shared test -- schemas.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schemas.ts packages/shared/src/schemas.test.ts
git commit -m "feat: expose member usage device ids"
```

### Task 2: Server Filtered Aggregation

**Files:**
- Modify: `apps/web/src/server/leaderboard.ts`
- Modify: `apps/web/src/server/leaderboard.test.ts`

- [ ] **Step 1: Write failing provider/device filter tests**

In `apps/web/src/server/leaderboard.test.ts`, add a test that calls:

```ts
const detail = await getMemberUsageDetail(
  "ada",
  "7d",
  new Date("2026-06-07T12:00:00.000Z"),
  {
    providers: ["codex"],
    models: [],
    devices: ["device-1"],
  },
);
```

Mock `dailyProviderUsage.aggregate` with `{ _sum: { totalTokens: 200n, costUsd: 2 } }`, mock trend rows with one date, provider rows with Codex and Claude rows, model rows with one Codex model, and device rows with `device-1`. Assert:

```ts
expect(detail?.summary).toEqual({
  rank: null,
  totalTokens: 200,
  totalCostUsd: 2,
});
expect(detail?.providers).toEqual([
  { provider: "codex", totalTokens: 200, totalCostUsd: 2 },
]);
expect(detail?.devices[0]).toMatchObject({
  deviceId: "device-1",
  deviceName: "Ada MacBook",
});
expect(prismaMock.dailyProviderUsage.aggregate).toHaveBeenCalledWith({
  _sum: { totalTokens: true, costUsd: true },
  where: {
    memberId: "member-1",
    date: {
      gte: new Date("2026-06-01T00:00:00.000Z"),
      lt: new Date("2026-06-08T00:00:00.000Z"),
    },
    provider: { in: ["codex"] },
    deviceId: { in: ["device-1"] },
  },
});
```

- [ ] **Step 2: Write failing model/device filter test**

Add a test that calls:

```ts
const detail = await getMemberUsageDetail(
  "ada",
  "30d",
  new Date("2026-06-07T12:00:00.000Z"),
  {
    providers: [],
    models: [{ provider: "codex", modelName: "gpt-5-codex" }],
    devices: ["device-1"],
  },
);
```

Mock `dailyModelUsage.aggregate` with `{ _sum: { totalTokens: 150n, costUsd: 1.5 } }` and the first `dailyModelUsage.groupBy` date trend row. Assert:

```ts
expect(detail?.summary).toEqual({
  rank: null,
  totalTokens: 150,
  totalCostUsd: 1.5,
});
expect(prismaMock.dailyModelUsage.aggregate).toHaveBeenCalledWith({
  _sum: { totalTokens: true, costUsd: true },
  where: {
    memberId: "member-1",
    date: {
      gte: new Date("2026-05-09T00:00:00.000Z"),
      lt: new Date("2026-06-08T00:00:00.000Z"),
    },
    deviceId: { in: ["device-1"] },
    OR: [{ provider: "codex", modelName: "gpt-5-codex" }],
  },
});
```

- [ ] **Step 3: Run failing server tests**

Run:

```bash
pnpm --dir apps/web test -- src/server/leaderboard.test.ts
```

Expected: FAIL because `getMemberUsageDetail` does not accept filters and still queries unfiltered aggregates.

- [ ] **Step 4: Implement server filter types**

In `apps/web/src/server/leaderboard.ts`, add:

```ts
type MemberUsageModelFilter = {
  provider: MemberUsageDetail["models"][number]["provider"];
  modelName: string;
};

export type MemberUsageFilters = {
  providers: MemberUsageDetail["providers"][number]["provider"][];
  models: MemberUsageModelFilter[];
  devices: string[];
};

const emptyMemberUsageFilters: MemberUsageFilters = {
  providers: [],
  models: [],
  devices: [],
};
```

Change the function signature:

```ts
export async function getMemberUsageDetail(
  username: string,
  period: MemberUsageRequestPeriod,
  now = new Date(),
  filters: MemberUsageFilters = emptyMemberUsageFilters,
): Promise<MemberUsageDetail | null> {
```

- [ ] **Step 5: Implement query helpers**

Add helpers:

```ts
function hasModelFilters(filters: MemberUsageFilters): boolean {
  return filters.models.length > 0;
}

function usageWhere(memberId: string, dateFilter?: DateFilter, filters: Pick<MemberUsageFilters, "providers" | "devices"> = emptyMemberUsageFilters) {
  return {
    memberId,
    ...(dateFilter ? { date: dateFilter } : {}),
    ...(filters.providers.length > 0 ? { provider: { in: filters.providers } } : {}),
    ...(filters.devices.length > 0 ? { deviceId: { in: filters.devices } } : {}),
  };
}

function modelUsageWhere(memberId: string, dateFilter: DateFilter | undefined, filters: Pick<MemberUsageFilters, "models" | "devices">) {
  return {
    memberId,
    ...(dateFilter ? { date: dateFilter } : {}),
    ...(filters.devices.length > 0 ? { deviceId: { in: filters.devices } } : {}),
    ...(filters.models.length > 0
      ? { OR: filters.models.map((model) => ({ provider: model.provider, modelName: model.modelName })) }
      : {}),
  };
}
```

Keep a separate no-filter helper if TypeScript inference gets noisy:

```ts
const noFilters: MemberUsageFilters = emptyMemberUsageFilters;
```

- [ ] **Step 6: Implement filtered summary and trend**

Replace the current summary/trend promise setup with:

```ts
const summaryPromise = hasModelFilters(filters)
  ? prisma.dailyModelUsage.aggregate({
      _sum: { totalTokens: true, costUsd: true },
      where: modelUsageWhere(member.id, summaryDateFilter, filters),
    })
  : prisma.dailyProviderUsage.aggregate({
      _sum: { totalTokens: true, costUsd: true },
      where: usageWhere(member.id, summaryDateFilter, filters),
    });

const trendPromise = hasModelFilters(filters)
  ? prisma.dailyModelUsage.groupBy({
      by: ["date"],
      _sum: { totalTokens: true, costUsd: true },
      where: modelUsageWhere(member.id, trendDateFilter, filters),
      orderBy: { date: "asc" },
    })
  : prisma.dailyProviderUsage.groupBy({
      by: ["date"],
      _sum: { totalTokens: true, costUsd: true },
      where: usageWhere(member.id, trendDateFilter, filters),
      orderBy: { date: "asc" },
    });
```

- [ ] **Step 7: Implement filtered breakdown queries**

Use these control-list rules:

- provider rows apply date and devices; they do not apply provider filters to themselves
- model rows apply date, devices, and active provider filters; they do not apply model filters to themselves
- device rows apply date and active provider/model filters; they do not apply device filters to themselves

Implement promises:

```ts
const providerRowsPromise = hasModelFilters(filters)
  ? prisma.dailyModelUsage.groupBy({
      by: ["provider"],
      _sum: { totalTokens: true, costUsd: true },
      where: modelUsageWhere(member.id, summaryDateFilter, { models: filters.models, devices: filters.devices }),
      orderBy: { _sum: { totalTokens: "desc" } },
    })
  : prisma.dailyProviderUsage.groupBy({
      by: ["provider"],
      _sum: { totalTokens: true, costUsd: true },
      where: usageWhere(member.id, summaryDateFilter, { providers: [], devices: filters.devices }),
      orderBy: { _sum: { totalTokens: "desc" } },
    });
```

Implement a dedicated model-breakdown helper so model rows can apply provider and device filters without applying model filters to themselves:

```ts
function modelBreakdownWhere(memberId: string, dateFilter: DateFilter | undefined, filters: MemberUsageFilters) {
  return {
    memberId,
    ...(dateFilter ? { date: dateFilter } : {}),
    ...(filters.devices.length > 0 ? { deviceId: { in: filters.devices } } : {}),
    ...(filters.providers.length > 0 ? { provider: { in: filters.providers } } : {}),
  };
}
```

Use it for model rows:

```ts
const modelRowsPromise = prisma.dailyModelUsage.groupBy({
  by: ["provider", "modelName"],
  _sum: { totalTokens: true, costUsd: true },
  where: modelBreakdownWhere(member.id, summaryDateFilter, filters),
  orderBy: { _sum: { totalTokens: "desc" } },
  take: 5,
});
```

For device rows, add:

```ts
const deviceRowsPromise = hasModelFilters(filters)
  ? prisma.dailyModelUsage.groupBy({
      by: ["deviceId"],
      _sum: { totalTokens: true, costUsd: true },
      where: modelUsageWhere(member.id, summaryDateFilter, { models: filters.models, devices: [] }),
      orderBy: { _sum: { totalTokens: "desc" } },
      take: 5,
    })
  : prisma.dailyProviderUsage.groupBy({
      by: ["deviceId"],
      _sum: { totalTokens: true, costUsd: true },
      where: usageWhere(member.id, summaryDateFilter, { providers: filters.providers, devices: [] }),
      orderBy: { _sum: { totalTokens: "desc" } },
      take: 5,
    });
```

Replace the existing `Promise.all` entries with `summaryPromise`, `trendPromise`, `providerRowsPromise`, `modelRowsPromise`, and `deviceRowsPromise`.

- [ ] **Step 8: Add `deviceId` to device response rows**

Change device mapping to:

```ts
return [{ deviceId: device.id, deviceName: device.name, os, ...sumToTotals(row) }];
```

- [ ] **Step 9: Run server tests**

Run:

```bash
pnpm --dir apps/web test -- src/server/leaderboard.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/server/leaderboard.ts apps/web/src/server/leaderboard.test.ts
git commit -m "feat: filter member usage aggregates"
```

### Task 3: API Filter Query Parsing

**Files:**
- Modify: `apps/web/src/app/api/leaderboard/members/[username]/route.ts`
- Modify: `apps/web/src/app/api/leaderboard/members/[username]/route.test.ts`

- [ ] **Step 1: Write failing route tests**

Add a test for valid filters:

```ts
it("passes provider, model, and device filters to the loader", async () => {
  getMemberUsageDetailMock.mockResolvedValue({
    member: { username: "ada", displayName: "Ada" },
    period: "30d",
    summary: { rank: null, totalTokens: 100, totalCostUsd: 1.25 },
    trend: [],
    providers: [],
    models: [],
    devices: [],
  });

  const response = await GET(
    new NextRequest(
      "https://token-burn.test/api/leaderboard/members/ada?range=30d&provider=codex&device=device-1",
    ),
    { params: Promise.resolve({ username: "ada" }) },
  );

  expect(response.status).toBe(200);
  expect(getMemberUsageDetailMock).toHaveBeenCalledWith("ada", "30d", expect.any(Date), {
    providers: ["codex"],
    models: [],
    devices: ["device-1"],
  });
});
```

Add a model parsing test:

```ts
it("parses model filters as provider and model name pairs", async () => {
  getMemberUsageDetailMock.mockResolvedValue({
    member: { username: "ada", displayName: "Ada" },
    period: "7d",
    summary: { rank: null, totalTokens: 100, totalCostUsd: 1.25 },
    trend: [],
    providers: [],
    models: [],
    devices: [],
  });

  await GET(
    new NextRequest(
      "https://token-burn.test/api/leaderboard/members/ada?range=7d&model=codex:gpt-5%3Acodex&device=device-1",
    ),
    { params: Promise.resolve({ username: "ada" }) },
  );

  expect(getMemberUsageDetailMock).toHaveBeenCalledWith("ada", "7d", expect.any(Date), {
    providers: [],
    models: [{ provider: "codex", modelName: "gpt-5:codex" }],
    devices: ["device-1"],
  });
});
```

Add conflict and invalid provider tests:

```ts
it("rejects requests that combine provider and model filters", async () => {
  const response = await GET(
    new NextRequest("https://token-burn.test/api/leaderboard/members/ada?range=7d&provider=codex&model=codex:gpt-5"),
    { params: Promise.resolve({ username: "ada" }) },
  );

  expect(response.status).toBe(400);
  expect(getMemberUsageDetailMock).not.toHaveBeenCalled();
  await expect(response.json()).resolves.toEqual({ error: "Provider and model filters cannot be combined" });
});

it("rejects invalid provider filters", async () => {
  const response = await GET(
    new NextRequest("https://token-burn.test/api/leaderboard/members/ada?range=7d&provider=other"),
    { params: Promise.resolve({ username: "ada" }) },
  );

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({ error: "Invalid usage filters" });
});
```

Update the existing route tests that assert loader calls so they expect the new four-argument shape. For example:

```ts
expect(getMemberUsageDetailMock).toHaveBeenCalledWith("ada", "weekly", expect.any(Date), {
  providers: [],
  models: [],
  devices: [],
});
```

- [ ] **Step 2: Run failing route tests**

Run:

```bash
pnpm --dir apps/web test -- 'src/app/api/leaderboard/members/[username]/route.test.ts'
```

Expected: FAIL because filters are ignored.

- [ ] **Step 3: Implement route parsing**

In `route.ts`, import `providerSchema` and type `MemberUsageFilters` from `@/server/leaderboard`.

Add helper functions:

```ts
function parseUsageFilters(searchParams: URLSearchParams): MemberUsageFilters | Response {
  const providers = searchParams.getAll("provider");
  const models = searchParams.getAll("model");
  const devices = searchParams.getAll("device").filter((device) => device.trim().length > 0);

  const parsedProviders = providers.map((provider) => providerSchema.safeParse(provider));
  if (parsedProviders.some((provider) => !provider.success)) {
    return NextResponse.json({ error: "Invalid usage filters" }, { status: 400 });
  }

  const parsedModels = models.map(parseModelFilter);
  if (parsedModels.some((model) => model === null)) {
    return NextResponse.json({ error: "Invalid usage filters" }, { status: 400 });
  }

  if (providers.length > 0 && parsedModels.length > 0) {
    return NextResponse.json(
      { error: "Provider and model filters cannot be combined" },
      { status: 400 },
    );
  }

  return {
    providers: parsedProviders.map((provider) => provider.data),
    models: parsedModels,
    devices,
  };
}

function parseModelFilter(value: string): MemberUsageFilters["models"][number] | null {
  const separatorIndex = value.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) return null;

  const provider = providerSchema.safeParse(value.slice(0, separatorIndex));
  if (!provider.success) return null;

  return {
    provider: provider.data,
    modelName: value.slice(separatorIndex + 1),
  };
}
```

Use the parsed filters:

```ts
const filters = parseUsageFilters(request.nextUrl.searchParams);
if (filters instanceof Response) return filters;

const detail = await getMemberUsageDetail(username, period, new Date(), filters);
```

- [ ] **Step 4: Run route tests**

Run:

```bash
pnpm --dir apps/web test -- 'src/app/api/leaderboard/members/[username]/route.test.ts'
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add 'apps/web/src/app/api/leaderboard/members/[username]/route.ts' 'apps/web/src/app/api/leaderboard/members/[username]/route.test.ts'
git commit -m "feat: parse member usage filters"
```

### Task 4: shadcn Badge Component

**Files:**
- Create: `apps/web/src/components/ui/badge.tsx`

- [ ] **Step 1: Add shadcn Badge**

Run:

```bash
pnpm dlx shadcn@latest add badge --yes
```

Expected: creates `apps/web/src/components/ui/badge.tsx`.

- [ ] **Step 2: Inspect the added component**

Run:

```bash
sed -n '1,220p' apps/web/src/components/ui/badge.tsx
```

Expected: component exports `Badge` and uses project aliases. If imports or styling violate local shadcn rules, fix them with `apply_patch`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/badge.tsx
git commit -m "chore: add shadcn badge"
```

### Task 5: Dialog Filter State And Request URLs

**Files:**
- Modify: `apps/web/src/components/member-usage-dialog.tsx`
- Modify: `apps/web/src/components/member-usage-dialog.test.tsx`

- [ ] **Step 1: Write failing URL/filter tests**

In `member-usage-dialog.test.tsx`, update `vi.mock("./member-usage-charts")` to render controls:

```tsx
vi.mock("./member-usage-charts", () => ({
  MemberUsageCharts: ({
    onProviderToggle,
    onModelToggle,
    onDeviceToggle,
    onClearFilters,
    selectedFilters,
  }: {
    onProviderToggle: (provider: "codex" | "claude_code") => void;
    onModelToggle: (model: { provider: "codex" | "claude_code"; modelName: string }) => void;
    onDeviceToggle: (deviceId: string) => void;
    onClearFilters: () => void;
    selectedFilters: {
      providers: string[];
      models: { provider: string; modelName: string }[];
      devices: string[];
    };
  }) => (
    <div>
      <div>Usage charts</div>
      <div data-testid="selected-providers">{selectedFilters.providers.join(",")}</div>
      <div data-testid="selected-models">{selectedFilters.models.map((model) => `${model.provider}:${model.modelName}`).join(",")}</div>
      <div data-testid="selected-devices">{selectedFilters.devices.join(",")}</div>
      <button onClick={() => onProviderToggle("codex")}>Toggle Codex</button>
      <button onClick={() => onProviderToggle("claude_code")}>Toggle Claude</button>
      <button onClick={() => onModelToggle({ provider: "codex", modelName: "gpt-5" })}>Toggle gpt-5</button>
      <button onClick={() => onDeviceToggle("device-1")}>Toggle Workstation</button>
      <button onClick={onClearFilters}>Clear filters</button>
    </div>
  ),
}));
```

Add tests:

```ts
it("adds provider filters to member usage requests", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => detail });
  vi.stubGlobal("fetch", fetchMock);

  render(<MemberUsageDialog member={{ username: "ada", displayName: "Ada", rank: 1 }} open onOpenChange={() => {}} />);
  await screen.findByRole("heading", { name: "Ada" });

  await user.click(screen.getByRole("button", { name: "Toggle Codex" }));

  expect(fetchMock).toHaveBeenLastCalledWith("/api/leaderboard/members/ada?range=7d&provider=codex");
});

it("model selection clears provider filters and device selection combines", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => detail });
  vi.stubGlobal("fetch", fetchMock);

  render(<MemberUsageDialog member={{ username: "ada", displayName: "Ada", rank: 1 }} open onOpenChange={() => {}} />);
  await screen.findByRole("heading", { name: "Ada" });

  await user.click(screen.getByRole("button", { name: "Toggle Codex" }));
  await user.click(screen.getByRole("button", { name: "Toggle gpt-5" }));
  await user.click(screen.getByRole("button", { name: "Toggle Workstation" }));

  expect(screen.getByTestId("selected-providers").textContent).toBe("");
  expect(screen.getByTestId("selected-models").textContent).toBe("codex:gpt-5");
  expect(screen.getByTestId("selected-devices").textContent).toBe("device-1");
  expect(fetchMock).toHaveBeenLastCalledWith(
    "/api/leaderboard/members/ada?range=7d&model=codex%3Agpt-5&device=device-1",
  );
});

it("clears all filters", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => detail });
  vi.stubGlobal("fetch", fetchMock);

  render(<MemberUsageDialog member={{ username: "ada", displayName: "Ada", rank: 1 }} open onOpenChange={() => {}} />);
  await screen.findByRole("heading", { name: "Ada" });

  await user.click(screen.getByRole("button", { name: "Toggle Codex" }));
  await user.click(screen.getByRole("button", { name: "Clear filters" }));

  expect(fetchMock).toHaveBeenLastCalledWith("/api/leaderboard/members/ada?range=7d");
});
```

- [ ] **Step 2: Run failing dialog tests**

Run:

```bash
pnpm --dir apps/web test -- src/components/member-usage-dialog.test.tsx
```

Expected: FAIL because the dialog has no filter state or callbacks.

- [ ] **Step 3: Implement filter state types and helpers**

In `member-usage-dialog.tsx`, import `Provider` and `Badge`:

```ts
import {
  type MemberUsageRange,
  type MemberUsageDetail,
  type Provider,
  formatTokens,
  formatUsd,
  memberUsageDetailSchema,
} from "@token-burn/shared";
import { Badge } from "@/components/ui/badge";
```

Add types:

```ts
type SelectedModelFilter = { provider: Provider; modelName: string };
type SelectedUsageFilters = {
  providers: Provider[];
  models: SelectedModelFilter[];
  devices: string[];
};

const emptySelectedUsageFilters: SelectedUsageFilters = {
  providers: [],
      models: [],
      devices: [{ deviceId: "device-1", deviceName: "Workstation", os: "linux", totalTokens: 12400, totalCostUsd: 12.34 }],
};
```

Add helpers:

```ts
function modelFilterKey(model: SelectedModelFilter): string {
  return `${model.provider}:${model.modelName}`;
}

function buildMemberUsageUrl(username: string, range: MemberUsageRange, filters: SelectedUsageFilters): string {
  const params = new URLSearchParams({ range });
  for (const provider of filters.providers) params.append("provider", provider);
  for (const model of filters.models) params.append("model", modelFilterKey(model));
  for (const device of filters.devices) params.append("device", device);
  return `/api/leaderboard/members/${encodeURIComponent(username)}?${params.toString()}`;
}
```

- [ ] **Step 4: Implement filter state updates**

Add local state:

```ts
const [filters, setFilters] = React.useState<SelectedUsageFilters>(emptySelectedUsageFilters);
```

Reset filters when member or range changes:

```ts
React.useEffect(() => {
  setFilters(emptySelectedUsageFilters);
}, [member?.username, selectedRange]);
```

Add callbacks:

```ts
function toggleProvider(provider: Provider) {
  setFilters((current) => ({
    providers: toggleValue(current.providers, provider),
    models: [],
    devices: current.devices,
  }));
}

function toggleModel(model: SelectedModelFilter) {
  setFilters((current) => ({
    providers: [],
    models: toggleModelValue(current.models, model),
    devices: current.devices,
  }));
}

function toggleDevice(deviceId: string) {
  setFilters((current) => ({
    ...current,
    devices: toggleValue(current.devices, deviceId),
  }));
}

function clearFilters() {
  setFilters(emptySelectedUsageFilters);
}
```

Add helpers:

```ts
function toggleValue<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function toggleModelValue(values: SelectedModelFilter[], value: SelectedModelFilter): SelectedModelFilter[] {
  const key = modelFilterKey(value);
  return values.some((item) => modelFilterKey(item) === key)
    ? values.filter((item) => modelFilterKey(item) !== key)
    : [...values, value];
}
```

Use `buildMemberUsageUrl(username, selectedRange, filters)` in `fetch`, and add `filters` to the effect dependency list.

- [ ] **Step 5: Render active chips and pass chart props**

Render active chips above `MemberUsageCharts`:

```tsx
<ActiveFilterChips
  filters={filters}
  onClear={clearFilters}
  onProviderRemove={toggleProvider}
  onModelRemove={toggleModel}
  onDeviceRemove={toggleDevice}
/>
```

Call chart:

```tsx
<MemberUsageCharts
  detail={state.detail}
  selectedFilters={filters}
  onProviderToggle={toggleProvider}
  onModelToggle={toggleModel}
  onDeviceToggle={toggleDevice}
  onClearFilters={clearFilters}
/>
```

Implement `ActiveFilterChips` with shadcn `Badge` and `Button`:

```tsx
function ActiveFilterChips({
  filters,
  onClear,
  onProviderRemove,
  onModelRemove,
  onDeviceRemove,
}: {
  filters: SelectedUsageFilters;
  onClear: () => void;
  onProviderRemove: (provider: Provider) => void;
  onModelRemove: (model: SelectedModelFilter) => void;
  onDeviceRemove: (deviceId: string) => void;
}) {
  const hasFilters = filters.providers.length > 0 || filters.models.length > 0 || filters.devices.length > 0;
  if (!hasFilters) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">Active filters</span>
      {filters.providers.map((provider) => (
        <Badge key={provider} variant="outline">
          <button type="button" onClick={() => onProviderRemove(provider)}>
            {formatProviderLabel(provider)} x
          </button>
        </Badge>
      ))}
      {filters.models.map((model) => (
        <Badge key={modelFilterKey(model)} variant="outline">
          <button type="button" onClick={() => onModelRemove(model)}>
            {model.modelName} x
          </button>
        </Badge>
      ))}
      {filters.devices.map((deviceId) => (
        <Badge key={deviceId} variant="outline">
          <button type="button" onClick={() => onDeviceRemove(deviceId)}>
            {deviceId} x
          </button>
        </Badge>
      ))}
      <Button type="button" variant="ghost" size="sm" onClick={onClear}>
        Clear
      </Button>
    </div>
  );
}
```

Use a provider label helper:

```ts
function formatProviderLabel(provider: Provider): string {
  return provider === "claude_code" ? "Claude Code" : "Codex";
}
```

- [ ] **Step 6: Run dialog tests**

Run:

```bash
pnpm --dir apps/web test -- src/components/member-usage-dialog.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/member-usage-dialog.tsx apps/web/src/components/member-usage-dialog.test.tsx
git commit -m "feat: manage member usage filters"
```

### Task 6: Clickable Breakdown Controls

**Files:**
- Modify: `apps/web/src/components/member-usage-charts.tsx`
- Modify: `apps/web/src/components/member-usage-charts.test.tsx`

- [ ] **Step 1: Write failing chart control tests**

Convert `member-usage-charts.test.tsx` to jsdom by adding:

```ts
// @vitest-environment jsdom
```

Import Testing Library and user event:

```ts
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
```

Keep the chart config test, then add:

```ts
afterEach(() => cleanup());

const detail = {
  member: { username: "ada", displayName: "Ada" },
  period: "7d",
  summary: { rank: null, totalTokens: 300, totalCostUsd: 3 },
  trend: [{ date: "2026-06-01", totalTokens: 300, totalCostUsd: 3 }],
  providers: [{ provider: "codex", totalTokens: 300, totalCostUsd: 3 }],
  models: [{ provider: "codex", modelName: "gpt-5", totalTokens: 300, totalCostUsd: 3 }],
  devices: [{ deviceId: "device-1", deviceName: "Workstation", os: "linux", totalTokens: 300, totalCostUsd: 3 }],
} as const;

it("renders breakdown rows as pressed toggle controls", async () => {
  const user = userEvent.setup();
  const onProviderToggle = vi.fn();
  const onModelToggle = vi.fn();
  const onDeviceToggle = vi.fn();

  render(
    <MemberUsageCharts
      detail={detail}
      selectedFilters={{
        providers: ["codex"],
        models: [],
        devices: ["device-1"],
      }}
      onProviderToggle={onProviderToggle}
      onModelToggle={onModelToggle}
      onDeviceToggle={onDeviceToggle}
      onClearFilters={() => {}}
    />,
  );

  const provider = screen.getByRole("button", { name: /Codex/ });
  const model = screen.getByRole("button", { name: /gpt-5/ });
  const device = screen.getByRole("button", { name: /Workstation/ });

  expect(provider.getAttribute("aria-pressed")).toBe("true");
  expect(model.getAttribute("aria-pressed")).toBe("false");
  expect(device.getAttribute("aria-pressed")).toBe("true");

  await user.click(provider);
  await user.click(model);
  await user.click(device);

  expect(onProviderToggle).toHaveBeenCalledWith("codex");
  expect(onModelToggle).toHaveBeenCalledWith({ provider: "codex", modelName: "gpt-5" });
  expect(onDeviceToggle).toHaveBeenCalledWith("device-1");
});
```

- [ ] **Step 2: Run failing chart tests**

Run:

```bash
pnpm --dir apps/web test -- src/components/member-usage-charts.test.tsx
```

Expected: FAIL because breakdowns are static `div`s and required props do not exist.

- [ ] **Step 3: Implement chart props**

In `member-usage-charts.tsx`, import `type Provider` and `Button`:

```ts
import { type MemberUsageDetail, type Provider, formatTokens, formatUsd } from "@token-burn/shared";
import { Button } from "@/components/ui/button";
```

Add types:

```ts
type SelectedModelFilter = { provider: Provider; modelName: string };
type SelectedUsageFilters = {
  providers: Provider[];
  models: SelectedModelFilter[];
  devices: string[];
};

type MemberUsageChartsProps = {
  detail: MemberUsageDetail;
  selectedFilters: SelectedUsageFilters;
  onProviderToggle: (provider: Provider) => void;
  onModelToggle: (model: SelectedModelFilter) => void;
  onDeviceToggle: (deviceId: string) => void;
  onClearFilters: () => void;
};
```

Change the function signature:

```ts
export function MemberUsageCharts({
  detail,
  selectedFilters,
  onProviderToggle,
  onModelToggle,
  onDeviceToggle,
}: MemberUsageChartsProps) {
```

- [ ] **Step 4: Implement clickable breakdown items**

Change breakdown item type:

```ts
type BreakdownItem = {
  id: string;
  label: string;
  meta?: string;
  tokens: number;
  costUsd: number;
  pressed: boolean;
  onToggle: () => void;
};
```

Build items:

```ts
items={detail.providers.map((item) => ({
  id: item.provider,
  label: formatProvider(item.provider),
  tokens: item.totalTokens,
  costUsd: item.totalCostUsd,
  pressed: selectedFilters.providers.includes(item.provider),
  onToggle: () => onProviderToggle(item.provider),
}))}
```

For models:

```ts
const modelKey = `${item.provider}:${item.modelName}`;
pressed: selectedFilters.models.some((model) => `${model.provider}:${model.modelName}` === modelKey),
onToggle: () => onModelToggle({ provider: item.provider, modelName: item.modelName }),
```

For devices:

```ts
id: item.deviceId,
pressed: selectedFilters.devices.includes(item.deviceId),
onToggle: () => onDeviceToggle(item.deviceId),
```

Render each row as:

```tsx
<Button
  key={item.id}
  type="button"
  variant={item.pressed ? "secondary" : "outline"}
  aria-pressed={item.pressed}
  className="h-auto w-full justify-between p-3 text-left"
  onClick={item.onToggle}
>
  <span className="min-w-0">
    <span className="block truncate text-sm font-medium">{item.label}</span>
    {item.meta ? <span className="block text-xs text-muted-foreground">{item.meta}</span> : null}
  </span>
  <span className="shrink-0 text-right">
    <span className="block font-mono text-sm">{formatTokens(item.tokens)}</span>
    <span className="block font-mono text-xs text-muted-foreground">{formatUsd(item.costUsd)}</span>
  </span>
</Button>
```

- [ ] **Step 5: Run chart tests**

Run:

```bash
pnpm --dir apps/web test -- src/components/member-usage-charts.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Run dialog tests**

Run:

```bash
pnpm --dir apps/web test -- src/components/member-usage-dialog.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/member-usage-charts.tsx apps/web/src/components/member-usage-charts.test.tsx
git commit -m "feat: make member usage breakdowns filterable"
```

### Task 7: Full Verification

**Files:**
- No source files expected.

- [ ] **Step 1: Run shared tests**

Run:

```bash
pnpm --dir packages/shared test
```

Expected: PASS.

- [ ] **Step 2: Run web tests**

Run:

```bash
pnpm --dir apps/web test
```

Expected: PASS.

- [ ] **Step 3: Run web lint**

Run:

```bash
pnpm --dir apps/web lint
```

Expected: exit code 0. The existing `postJson` unused warning in `apps/web/scripts/sync-e2e.mjs` may still appear.

- [ ] **Step 4: Run web typecheck**

Run:

```bash
pnpm --dir apps/web typecheck
```

Expected: PASS. If a fresh worktree lacks generated outputs, first run:

```bash
pnpm --dir packages/shared build
DATABASE_URL=postgresql://tokenburn:tokenburn@127.0.0.1:5432/tokenburn pnpm --dir apps/web db:generate
```

- [ ] **Step 5: Run web build**

Run:

```bash
ADMIN_GITHUB_LOGIN=admin-user \
AUTH_GITHUB_ID=test-github-id \
AUTH_GITHUB_SECRET=test-github-secret \
AUTH_SECRET=test-auth-secret \
AUTH_URL=http://localhost:3000 \
TOKEN_BURN_PUBLIC_URL=http://localhost:3000 \
NEXT_PUBLIC_APP_URL=http://localhost:3000 \
DATABASE_URL=postgresql://tokenburn:tokenburn@127.0.0.1:5432/tokenburn \
SESSION_SECRET=test-session-secret \
SYNC_API_SECRET=test-sync-secret \
pnpm --dir apps/web build
```

Expected: PASS.
