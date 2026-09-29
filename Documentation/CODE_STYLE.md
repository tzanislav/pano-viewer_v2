# Code style and development agreement

These conventions apply to the React app, Express API, and shared packages. Keep them practical as the app grows. The [architecture](ARCHITECTURE.md) defines the main code boundaries.

## Small, focused, reusable code

- Organize code by feature and responsibility. A file should have one clear reason to change. Prefer short files with descriptive names, but do not split a coherent function or component just to meet a line count.
- Keep setup, migration, and maintenance scripts focused on one task with explicit inputs and a clear result. Compose small helpers when a workflow needs several steps.
- Keep React components focused on rendering and interaction. Put reusable stateful behavior in hooks and calculations in pure functions. Keep HTTP parsing in routes, business rules in services, SQL in repositories, and S3/Firebase calls in adapters.
- Build shared controls in `packages/ui` when multiple features need the same behavior. Keep feature-specific components close to their feature. Extract an abstraction when it removes real duplication or makes a boundary clearer; avoid generic components with many unrelated options.
- Use names that describe the job, such as `SceneThumbnail`, `useCanvasPan`, `createConnection`, and `tourRepository`. Avoid catch-all files such as `helpers.ts` or `misc.ts`.
- Give functions typed inputs and outputs. Validate data received from browsers, Firebase, S3, and SQLite at the relevant boundary. Shared tour and geometry contracts belong in `packages/domain`; the API remains the authority for permissions and graph rules.

## Actions, errors, and logging

- Make each meaningful action traceable: tour and page changes, uploads, placements, links, sign-in outcomes, background processing, and viewer navigation failures. Record a start or completion event and a failure event where useful. Do not emit a log for every render, pointer move, or animation frame; log the committed action instead.
- Use a small logging wrapper so the web app, API, and jobs use consistent event names and levels. Include an operation or request ID, action name, outcome, relevant tour/scene/asset ID, and duration for asynchronous work. Let the API return a request ID with errors so a UI report can be matched to server logs.
- Use debug level for detailed local interactions, info for completed operations, warn for expected refusals or recoverable failures, and error for unexpected failures. Show a useful message in the UI when an action fails; logs alone are not user feedback.
- Never log passwords, Firebase tokens, AWS keys, service-account JSON, signed S3 URLs, image contents, or full request bodies. Avoid logging user-supplied titles and email addresses unless a specific diagnostic need has been reviewed.
- Handle errors at the boundary that can add context or recover. Do not silently swallow them or log the same failure in every layer. Preserve a stable error code and the original cause for debugging.

## Development changes

- During active development, prefer a clear replacement over compatibility shims for designs we have discarded. API and schema changes may break earlier development builds.
- Rebuilding the development SQLite database is acceptable when a schema direction changes. Keep database setup reproducible and document the reset step and its data impact. Do not silently reset a database that contains data someone intends to keep.
- Update the relevant documentation and examples when a contract, environment variable, or workflow changes. Remove obsolete code and docs rather than maintaining two contradictory paths.

## Verification and collaboration

- Use TypeScript checks and linting once the workspace exists. Add focused tests for behavior that can regress, especially bearing math, graph mutations, authorization, and media lifecycle. Avoid tests that merely repeat a trivial implementation.
- Treat proposed implementation details, including the project owner's suggestions, as ideas to evaluate. If another approach better serves the requirements, explain the tradeoff plainly and recommend it. State uncertainty and evidence instead of offering agreement or praise without substance.
