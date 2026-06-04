# Post-Invite Setup Instructions Design

## Goal

After a user accepts a Token Burn invite, show a clear onboarding page that tells them how to finish setup: choose their display name, run the no-install CLI setup command, and return to the leaderboard.

## Current Behavior

The invite page accepts a valid invite and redirects the user to `/settings/display-name`.

That page only handles the display name. It does not explain the CLI setup command, automatic sync, or how the user gets back to the leaderboard after setup.

The invite page already includes a "Back to leaderboard" link, but that appears before the invite is accepted and does not guide the newly accepted member through the remaining steps.

## Recommended Flow

1. User opens an invite link.
2. User signs in with GitHub if needed.
3. User clicks "Accept invite".
4. The server creates or reuses the member record and redeems the invite.
5. The user is redirected to `/setup`.
6. `/setup` shows the remaining onboarding steps:
   - Set or confirm the leaderboard display name.
   - Run `npx @blnayan/token-burn@latest setup` in a terminal.
   - Let setup finish login approval, first sync, and automatic sync installation.
7. The page includes a prominent button that links back to `/`.

## Page Design

Create a new authenticated member page at `/setup`.

The page should use the existing quiet, compact application style: centered content, simple headings, restrained borders, and the existing `Button` component.

The page should include:

- A heading such as "Finish Token Burn Setup".
- A short sentence that the invite was accepted and the next steps finish leaderboard syncing.
- A compact ordered list of setup steps.
- The CLI command in a monospace block:

```bash
npx @blnayan/token-burn@latest setup
```

- A link or button to `/settings/display-name` for the display-name step.
- A primary button to `/` with text such as "Go to leaderboard".

The page should not add copy-to-clipboard behavior in this change. The command is short enough to select manually, and the user's request only requires instructions plus a leaderboard button.

## Access Rules

If the visitor is signed out, `/setup` should ask them to sign in with GitHub and redirect back to `/setup`.

If the signed-in user has not accepted an invite and does not have a member record, `/setup` should show an invite-required message and a button back to the leaderboard.

If the signed-in user is a member, `/setup` should show the onboarding instructions.

## Invite Redirect

The invite acceptance server action should redirect to `/setup` after successfully redeeming an invite.

This replaces the current redirect to `/settings/display-name`.

## Error Handling

Existing invite validation remains unchanged:

- Invalid invites still show the existing invalid or expired message.
- Already redeemed invites still show the existing unavailable state.
- Concurrent redemption protection remains in the existing transaction.

The setup page does not need to detect whether the user actually ran the CLI. The CLI and leaderboard already provide the real sync state after usage is submitted.

## Testing

Add focused web tests for:

- `/setup` renders the CLI setup command for an accepted member.
- `/setup` renders a link to `/settings/display-name`.
- `/setup` renders a button or link back to `/`.
- `/setup` shows sign-in guidance for signed-out users.
- `/setup` shows invite-required guidance for signed-in users without a member.
- Invite acceptance redirects to `/setup`.

## Non-Goals

This change does not add CLI setup completion tracking.

This change does not add a command copy button.

This change does not change invite creation, expiration, redemption, admin authorization, CLI login approval, or sync behavior.
