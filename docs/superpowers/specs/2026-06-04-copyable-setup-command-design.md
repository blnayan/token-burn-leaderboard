# Copyable Setup Command Design

## Goal

Make the CLI setup command on the post-invite `/setup` page easy to copy with a dedicated copy button.

## Current Behavior

The `/setup` page shows the command in a static code block:

```bash
npx @blnayan/token-burn@latest setup
```

Users can select the command manually, but there is no copy button.

The app already has a copy pattern for invite URLs in `apps/web/src/app/admin/invites/invite-url-copy.tsx`.

## Design

Create a small client component for the setup command copy UI:

- File: `apps/web/src/app/setup/setup-command-copy.tsx`
- Export a copy helper that writes the command to `navigator.clipboard`.
- Render the setup command in a read-only, monospace input or input-like control.
- Render a `Copy` button beside it.
- After successful copy, change button text to `Copied` and show `Setup command copied.`
- If copy fails or clipboard is unavailable, keep the button text as `Copy` and show `Could not copy command. Select it manually.`

Use the component inside `apps/web/src/app/setup/page.tsx` in place of the plain `<pre><code>` block.

## Command

The copied command must be exactly:

```bash
npx @blnayan/token-burn@latest setup
```

## Testing

Add focused jsdom tests for:

- The copy helper writes the setup command to a provided clipboard writer.
- The copy helper throws when clipboard writing is unavailable.
- The component renders the setup command in a read-only field.
- Clicking `Copy` writes the command and shows copied state.
- Clipboard failure shows the manual-copy fallback message.
- The setup page still renders the command for accepted members.

## Non-Goals

This change does not add CLI setup completion tracking.

This change does not change the setup command text.

This change does not change invite acceptance, authentication, scheduler behavior, or sync behavior.
