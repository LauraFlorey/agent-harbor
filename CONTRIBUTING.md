# Contributing to Agent Harbor

Start with an issue describing the problem and intended behavior. For security problems, follow [SECURITY.md](SECURITY.md) and do not publish exploit details or credentials in an issue.

Use Node.js 24+ and the pinned pnpm version. Install with `pnpm install --frozen-lockfile`. Work on a branch and keep each change focused. Explain the trigger, resulting behavior, and validation in the pull request.

Before requesting review, run:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm check:electron
pnpm build
pnpm build:server
pnpm check:server-package
pnpm audit --audit-level=moderate
```

Add regression tests for changes to authentication, permissions, provider boundaries, persistence, and installer behavior. Tests must use disposable data, fake provider CLIs, and the file secret store. Never run tests against your real fleet or Keychain.

Use runtime validation for external inputs. Keep credentials out of URLs, routine logs, screenshots, process arguments, and agent environments. Do not weaken an approval gate to make a test pass. Unknown or ambiguous tool actions must request a fresh decision.

Do not commit node_modules, compiled server/UI output, installer artifacts, `.env` files, access codes, conversations, or personal backups. Keep the existing upstream license attribution. Screenshots should use a clean demonstration workspace.

All public releases require a separately reviewed release commit, signing/provenance checks, and clean-machine acceptance. A successful build on a developer's checkout is not sufficient evidence that an installer is self-contained.
