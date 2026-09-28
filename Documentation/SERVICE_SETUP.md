# Service access and environment setup

This guide prepares the values for the planned React/Vite app and Express API. The repository currently contains documentation and configuration templates; there is no application process yet to test these credentials end to end. Create the external services and fill a local `.env` now, then validate the connections during the first build stage.

## 1. Create the local environment file

From the repository root in PowerShell:

```powershell
Copy-Item .env.example .env
```

Fill `.env` with your own values. Keep it out of source control; the root [`.gitignore`](../.gitignore) excludes `.env`, local SQLite data, and common credential files. The future web app should set Vite's `envDir` to the repository root, and the API should load that same root `.env`. Vite exposes `VITE_*` values to browser code, so never put a service-account key, AWS secret, or other private credential behind that prefix. See [Vite's environment docs](https://vite.dev/guide/env-and-mode) and [`envDir` setting](https://vite.dev/config/shared-options).

## 2. Firebase Authentication

### Create the project and web app

1. In the [Firebase console](https://console.firebase.google.com/), create a **new project for the walkthrough app**, then register a **Web app**. This project will have its own user accounts, separate from JimLocations. Firebase's [web setup guide](https://firebase.google.com/docs/web/setup) shows the current console flow.
2. In **Project settings → General → Your apps**, open the web app's configuration and copy `apiKey`, `authDomain`, `projectId`, and `appId` into the matching `VITE_FIREBASE_*` lines. Copy `projectId` again into `FIREBASE_PROJECT_ID`. Do not invent or alter the values; the API and web client must point to the same project. Firebase describes this config as [non-secret app identifiers](https://firebase.google.com/docs/web/learn-more).
3. In **Authentication → Sign-in method**, enable **Email/Password**. The first app build will use registration, sign-in, sign-out, and password reset through the Firebase Web SDK. See Firebase's [password authentication guide](https://firebase.google.com/docs/auth/web/password-auth).
4. In **Authentication → Settings → Authorized domains**, add the deployed web hostname when one exists. If local Firebase sign-in requires it, add `localhost` to your development Firebase project. New Firebase projects may not include `localhost` automatically; see the [Firebase Auth FAQ](https://firebase.google.com/docs/auth/faq-and-troubleshooting). Keep production and development projects separate when practical.

### Give Express Admin access

For local access to the real Firebase project, open **Project settings → Service accounts → Generate new private key**. Save the downloaded JSON **outside** this repository and set `GOOGLE_APPLICATION_CREDENTIALS` in `.env` to its absolute path, for example a forward-slash Windows path. Set `FIREBASE_PROJECT_ID` to the same project ID as the web config. In a Google-hosted deployment, use its [Application Default Credentials](https://firebase.google.com/docs/admin/setup) instead of a key file. The Admin credential belongs only to Express, never to Vite or the browser.

For local tests without a live Firebase project, use the [Authentication emulator](https://firebase.google.com/docs/emulator-suite/connect_auth): uncomment `VITE_FIREBASE_AUTH_EMULATOR_URL` and `FIREBASE_AUTH_EMULATOR_HOST`. The browser value includes `http://`; the Admin value does **not**. Use the same project ID on both sides. Never enable the emulator host in a production environment.

## 3. Private S3 media bucket

1. In the [Amazon S3 console](https://console.aws.amazon.com/s3/), create a **general purpose bucket** in your chosen Region. Copy its exact bucket name to `S3_BUCKET` and the Region code to `AWS_REGION`. The [bucket guide](https://docs.aws.amazon.com/AmazonS3/latest/userguide/create-bucket-overview.html) explains the current console steps. Keep **Block Public Access** on; this app will use short-lived signed URLs for browser upload and viewing.
2. Give the API/worker an IAM role with permission only for this bucket's `tours/` objects. On AWS hosting, prefer a workload role. For local development, use an AWS Identity Center or named SDK profile and uncomment `AWS_PROFILE`; the SDK retrieves and refreshes credentials through that profile. If you manually supply **temporary** credentials, copy `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_SESSION_TOKEN` from the same AWS STS or Identity Center session. The session token is issued with the other two values; it is not created separately in S3. If you have a long-term IAM user access key pair, it has no session token, so leave `AWS_SESSION_TOKEN` unset. The AWS SDK for JavaScript [resolves these credential sources automatically](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/setting-credentials-node.html); choose one source to avoid surprises. AWS [recommends temporary credentials](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html).
3. Attach an identity policy like the following to the role or IAM principal behind your local profile, replacing `YOUR_BUCKET_NAME`. The app will generate keys under `tours/<tour-id>/...`. `HeadObject` verification uses `s3:GetObject` permission. Adjust the policy if the storage key prefix changes. See [S3 IAM resource scoping](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security_iam_service-with-iam.html) and [HeadObject permissions](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html).

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PanoViewerMediaObjects",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/tours/*"
    }
  ]
}
```

4. In the bucket's **Permissions → Cross-origin resource sharing (CORS)**, add the JSON below. Replace the production origin with the actual web origin when known, and remove it until then. The development origin must exactly match `WEB_ORIGIN`; origins include scheme and port. CORS lets the browser use presigned PUT and GET URLs, while IAM and signed URLs still control object access. See AWS's [CORS console instructions](https://docs.aws.amazon.com/AmazonS3/latest/userguide/enabling-cors-examples.html) and [allowed fields](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ManageCorsUsing.html).

```json
[
  {
    "AllowedOrigins": ["http://localhost:5173", "https://YOUR_WEB_DOMAIN"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["Content-Type", "x-amz-*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

The API will issue signed URLs after verifying Firebase identity and tour ownership. AWS notes that [presigned URLs grant time-limited access](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html); keep the configured expiry short and avoid logging full URLs. `S3_ENDPOINT` and `S3_FORCE_PATH_STYLE=true` are only for an S3-compatible local service such as MinIO. The endpoint placed in a signed URL must be reachable by the browser as well as the API.

## 4. SQLite and local URLs

SQLite needs no account or cloud service. Leave `DATABASE_PATH=./data/pano-viewer.sqlite` for development; the app will create the directory/file during setup. In deployment, point it to a persistent writable volume and back it up. Relative paths in this project are defined from the repository root.

`PORT=3001`, `WEB_ORIGIN=http://localhost:5173`, and `VITE_API_BASE_URL=http://localhost:3001/api` are the planned local defaults. At deployment, set the web origin and browser API URL to the actual HTTPS addresses. Express CORS will allow the configured web origin. If web and API share an origin in production, the browser API URL may be `/api`.

The size limits and URL lifetimes in `.env.example` are initial defaults, not provider-issued values. The API will enforce declared and actual upload sizes and refresh media URLs during long viewer sessions.

## Values checklist

| Variable(s) | Where the value comes from |
| --- | --- |
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID` | Firebase web app config in Project settings. |
| `FIREBASE_PROJECT_ID` | Same Firebase project ID as the web app. |
| `GOOGLE_APPLICATION_CREDENTIALS` | Absolute local path to Admin service-account JSON, if not using runtime credentials or emulator. |
| `AWS_REGION`, `S3_BUCKET` | Region and bucket name in the S3 console. |
| `AWS_PROFILE` **or** AWS key variables | Chosen AWS credential source; omit these when the runtime supplies a role. `AWS_SESSION_TOKEN` is needed only when manually supplying temporary credentials. |
| `VITE_API_BASE_URL`, `WEB_ORIGIN`, `PORT` | Planned local or deployed web/API addresses. |
| `DATABASE_PATH` | Local or deployment-owned writable filesystem path. |
| `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE` | Only for an S3-compatible local service. |
| `VITE_FIREBASE_AUTH_EMULATOR_URL`, `FIREBASE_AUTH_EMULATOR_HOST` | Only for local Firebase Auth emulator use. |

Once app code exists, the first integration check is: sign in, create a tour, request a signed upload URL, upload one panorama, reload the viewer manifest, and confirm another Firebase user cannot obtain that tour or its media URLs. This is tracked in the [build plan](BUILD_PLAN.md).
