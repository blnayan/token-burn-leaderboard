# Admin Invite UI Design

## Goal

Make invites easier for the configured admin to use by adding a visible admin-only entry point from the leaderboard and a copy button for generated invite links.

## Current State

The app already has `/admin/invites`.

That page:

- Requires GitHub sign-in.
- Allows only the configured `ADMIN_GITHUB_LOGIN` user to create invites.
- Creates one-time invite codes that expire after seven days.
- Redirects back with `?code=...`.
- Displays the generated invite URL in a read-only input.

The current gaps are discoverability and sharing:

- The signed-in admin has no obvious invite button on the main leaderboard page.
- The invite URL can be selected manually, but there is no copy button.

## Design

### Admin Entry Point

The home page will check the current session with `auth()`.

If the signed-in session user has `githubLogin === env.ADMIN_GITHUB_LOGIN`, the page will render an admin-only button in the header that links to `/admin/invites`.

The button will:

- Be visible only to the configured admin.
- Not render for signed-out users.
- Not render for signed-in non-admin users.
- Use the existing `Button` component.
- Keep the public leaderboard as the primary page content.

The implementation will use `next/link` plus the existing server-rendered home page. No new client-side auth check is needed.

### Invite Link Copy Action

The admin invites page will keep the existing read-only invite URL input.

When a valid invite URL is present, the page will render a copy button next to the input.

The copy behavior will live in a small client component responsible only for displaying and copying an invite URL. It will:

- Accept `inviteUrl` as a prop.
- Render the existing `Label` and `Input` UI.
- Add a `Copy` button using the existing `Button` component.
- Call `navigator.clipboard.writeText(inviteUrl)` when clicked.
- Change the button label to `Copied` after a successful copy.
- Show a short failure message if the browser denies clipboard access or the API is unavailable.

The server page will continue to validate invite code availability before passing `inviteUrl` to the client component.

## Data Flow

1. Admin clicks the homepage invite button.
2. Admin lands on `/admin/invites`.
3. Admin submits the existing create invite form.
4. The server action creates and stores the hashed invite code.
5. The page redirects to `/admin/invites?code=<raw-code>`.
6. The server page validates that the code still points to an active invite.
7. The server page builds the public invite URL from `TOKEN_BURN_PUBLIC_URL`.
8. The client copy component receives the URL and copies it on button click.

## Error Handling

The existing admin access checks remain authoritative.

If an invite code is missing, expired, redeemed, or invalid, the page will continue to show the existing unavailable message and will not render the copy component.

If clipboard copy fails, the component will show a small inline message and leave the URL visible in the input so the admin can still select it manually.

## Testing

Add tests for the new behavior:

- Home page renders the invite button for the configured admin session.
- Home page does not render the invite button for signed-out or non-admin sessions.
- Invite copy component renders the URL and calls `navigator.clipboard.writeText`.
- Invite copy component shows copied state after success.
- Invite copy component shows failure state after clipboard rejection.

Run the existing web test suite and typecheck after implementation.

## Out of Scope

This design does not add invite listing, revocation, resend, or audit history.

This design does not change invite creation, expiration, redemption, or admin authorization rules.

This design does not add a full admin navigation system.
