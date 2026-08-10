# Contributing

Thanks for helping improve OddsFront.

## Before you start

- Use an issue for bugs or a focused proposal for larger product changes.
- Never include credentials, private feed URLs, user data, or production state.
- Keep the product read-only. Wallet signing, custody, and embedded trading are
  outside this repository's scope.
- Treat market data as untrusted input and preserve the validated outbound-link
  helpers.

## Local workflow

```bash
npm ci
npm run dev
```

Before opening a pull request, run:

```bash
npm run lint
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
```

## Pull requests

Keep each pull request focused and explain:

- what changed and why;
- which routes or data contracts are affected;
- how the change was tested;
- whether screenshots are relevant;
- any deployment, cache, security, or rollback considerations.

Generated output, browser traces, `.env*` files, and `node_modules/` must remain
untracked. A maintainer reviews and merges accepted changes.
