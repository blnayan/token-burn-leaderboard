# Quarter-Hour Scheduler Design

## Goal

Change automatic Token Burn sync scheduling from interval-after-install behavior to wall-clock quarter-hour behavior across supported platforms.

After `token-burn setup` or `token-burn install-scheduler`, scheduled sync should run at the local machine's quarter-hour boundaries:

- `:00`
- `:15`
- `:30`
- `:45`

This makes scheduler behavior easier to explain, debug, and compare across users. The exact first run after install may depend on each platform scheduler's activation semantics, but recurring runs should align to quarter-hour wall-clock boundaries instead of running every 15 minutes from setup time.

## Non-Goals

- Do not add random or deterministic jitter.
- Do not add user-configurable schedules.
- Do not change the sync command that the scheduler runs.
- Do not change login, setup, or sync behavior outside scheduler artifact generation and install commands.
- Do not add new scheduler packages unless implementation discovers a platform-native limitation that cannot be handled cleanly.

## Platform Behavior

### Linux

The cron fallback already uses `*/15 * * * *`, which aligns with quarter-hour boundaries. Keep that cron expression.

The systemd user timer should switch from interval scheduling to calendar scheduling. Replace the interval-oriented timer fields:

```ini
OnBootSec=5min
OnUnitActiveSec=15min
```

with a calendar-oriented schedule:

```ini
OnCalendar=*:0/15
Persistent=true
```

`Persistent=true` lets missed timer events run after the user session becomes available again, which is helpful for laptops and suspended machines.

### macOS

The launchd agent should switch from `StartInterval` to `StartCalendarInterval`.

Instead of:

```xml
<key>StartInterval</key>
<integer>900</integer>
```

emit four minute entries under `StartCalendarInterval`:

```xml
<key>StartCalendarInterval</key>
<array>
  <dict><key>Minute</key><integer>0</integer></dict>
  <dict><key>Minute</key><integer>15</integer></dict>
  <dict><key>Minute</key><integer>30</integer></dict>
  <dict><key>Minute</key><integer>45</integer></dict>
</array>
```

Keep the existing label, command arguments, and stdout/stderr log paths.

### Windows

The Windows scheduled task should align to quarter-hour boundaries instead of using a setup-time-relative minute interval.

Use a minute schedule with an explicit midnight start time:

```text
/SC MINUTE /MO 15 /ST 00:00
```

Microsoft documents that minute schedules without a start date or time start relative to command completion. Adding `/ST 00:00` anchors the 15-minute cadence to the day's quarter-hour boundaries.

If implementation or smoke testing shows that `schtasks /Create` does not preserve this alignment reliably on supported Windows runners, switch to Task Scheduler XML creation through `schtasks /Create /XML` and encode an equivalent daily repeating trigger.

Keep the public task name `TokenBurnSync` and keep uninstall behavior as:

```text
schtasks /Delete /TN TokenBurnSync /F
```

## CLI UX

`token-burn install-scheduler --dry-run` should print scheduler artifacts that clearly show quarter-hour behavior for the current platform:

- Linux: systemd output includes `OnCalendar=*:0/15`; cron fallback remains `*/15 * * * *`.
- macOS: launchd output includes `StartCalendarInterval` with minutes `0`, `15`, `30`, and `45`.
- Windows: dry-run output shows the chosen quarter-hour task creation command or XML.

Successful install messages can remain the same unless the implementation needs wording changes to avoid saying "every 15 minutes" in an interval-specific way.

## Error Handling

Install and uninstall orchestration should keep the existing behavior:

- Linux tries user systemd first.
- Linux falls back to cron if user systemd is unavailable.
- macOS writes and loads the LaunchAgent plist.
- Windows creates the scheduled task.
- Uninstall removes the platform-specific scheduler artifact or task.

The quarter-hour change should not introduce new failure modes beyond malformed scheduler artifacts or unsupported scheduler command arguments.

## Testing

Update scheduler tests to verify:

- `buildSystemdTimer` emits quarter-hour calendar scheduling and no longer emits interval-after-activation fields.
- `buildCronLine` remains `*/15 * * * *`.
- `buildLaunchdPlist` emits `StartCalendarInterval` entries for minutes `0`, `15`, `30`, and `45`, and no longer emits `StartInterval`.
- Windows scheduler builder output includes `/SC MINUTE`, `/MO 15`, and `/ST 00:00`.
- Dry-run output includes the new platform-specific quarter-hour artifacts.
- Install and uninstall orchestration still call the same runtime operations at the same boundaries.

Run at minimum:

```text
pnpm --filter @blnayan/token-burn test -- src/scheduler.test.ts
pnpm --filter @blnayan/token-burn typecheck
```

If Windows scheduling requires XML generation after verification, add focused tests for the XML builder and command arguments.
