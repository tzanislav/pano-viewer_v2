# Authentication and tour access

## Decision

Use **Firebase Authentication** in a new Firebase project for this app, with user accounts separate from JimLocations. Start with email/password registration, sign-in, sign-out, and password reset, matching the approach in `F:\Web Dev\jim-locations\frontend\src\auth`. Firebase provides identity; Express remains responsible for deciding which tours a signed-in user may access. Tour data stays in SQLite and images stay in S3. [Firebase's web guide](https://firebase.google.com/docs/auth/web/start) documents the email/password flow, and its [user guide](https://firebase.google.com/docs/auth/web/manage-users) documents auth-state observation and password reset.

## Client flow

1. Initialize the Firebase Web SDK once from the app's Firebase project configuration. Enable Email/Password in the Firebase project.
2. Use `onAuthStateChanged` to distinguish initialization, signed-out, and signed-in states. Do not render a protected route based on an early `currentUser === null`, since Firebase may still be restoring the session.
3. Provide Create account, Sign in, Forgot password, and Sign out screens/actions. Firebase owns credentials and password reset emails; the app never sends a password to Express.
4. Before an API request, call the signed-in user's `getIdToken()` and send `Authorization: Bearer <ID token>` over HTTPS. Obtain a token for each request through one shared API client so refresh is handled consistently.
5. Protect creator and viewer routes in React for navigation and user feedback. The API remains the authority; a client route guard alone does not grant access. A signed-out user opening a private tour is sent to Sign in and returned to the requested route afterward.

The owner viewer requires Firebase authentication. Its default state is navigation; the owner can toggle Edit mode to adjust links on their own scenes. A separate public route uses an unguessable project share token to fetch only the viewer manifest. It needs no Firebase session and offers no Edit mode or canvas access. The owner can revoke the token, and project deletion removes it. Existing short-lived signed media URLs expire according to the configured read URL TTL.

## Express flow

1. Initialize the Firebase Admin SDK once with the same project ID as the web client. Use Application Default Credentials or server-only service account credentials; never ship these credentials in the frontend bundle. See the [Admin SDK setup guide](https://firebase.google.com/docs/admin/setup).
2. Authentication middleware reads the Bearer token and calls `verifyIdToken(idToken, true)`. It attaches the decoded Firebase `uid` to the request. Missing, invalid, expired, or revoked credentials return `401`. Firebase documents [ID-token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens) and [revocation checking](https://firebase.google.com/docs/auth/admin/manage-sessions). Client sign-out clears the browser session but does not itself revoke an already issued token; explicitly revoke tokens when account access must be terminated server-side.
3. Tour services load the tour by ID and compare its `owner_uid` with the verified `uid`. A non-owner gets `404` for a specific tour to avoid confirming that tour's existence. Never trust a `uid` or `owner_uid` sent in request JSON.
4. Apply the same owner check to tour reads and writes, the viewer manifest, upload reservation/completion, and media URL signing. The API issues short-lived S3 URLs only after authorization.

Firebase's `uid` is the stable owner key. Store `tours.owner_uid TEXT NOT NULL` in SQLite and index it for listing. Do not store passwords or duplicate Firebase credentials in SQLite. Display name and email may be shown from Firebase, but neither is an authorization key.

## Configuration and local development

Use the root [`.env.example`](../.env.example) and [service setup guide](SERVICE_SETUP.md) to obtain and configure values.

- **Web:** Firebase public app configuration (`apiKey`, `authDomain`, `projectId`, `appId`) through `VITE_FIREBASE_*` variables. These identify the Firebase app; they are not Admin credentials.
- **API:** Firebase project ID and Admin credentials from server configuration, plus S3 credentials. Keep the web and API project IDs equal.
- **Local:** Use the [Firebase Authentication emulator](https://firebase.google.com/docs/emulator-suite/connect_auth) for registration and API authorization tests. Point the web SDK at its local URL and set `FIREBASE_AUTH_EMULATOR_HOST` for the Admin SDK in development only.

## Access checks to verify

- A newly registered user can create a tour and reopen it after a browser refresh.
- A signed-out request to any tour, manifest, or upload endpoint receives `401`.
- User B cannot read, edit, upload to, or obtain media URLs for User A's tour, even with its ID.
- A signed-in owner can switch between creator and viewer routes and use viewer Edit mode to adjust links. The API verifies ownership for every edit regardless of the toggle state.
- Sign-out removes access in the browser; a separately revoked or disabled account is rejected by Express. Existing signed S3 URLs remain valid until their short expiry.
- Password reset uses Firebase's email flow and does not change tour ownership.
