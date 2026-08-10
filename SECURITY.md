# Security policy

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability or exposed
credential.

Use GitHub's private vulnerability reporting flow:

1. Open the repository's **Security** tab.
2. Select **Advisories**.
3. Choose **Report a vulnerability**.

Include the affected route or file, reproduction steps, impact, and any safe
mitigation you already tested. Avoid including real credentials, personal data,
or destructive proof-of-concept payloads.

## Supported version

Security fixes target the current `main` branch and the live deployment at
<https://oddsfront.com>. Historical commits are not supported separately.

## Scope

In scope:

- accidental exposure of server-only environment variables;
- cross-site scripting or unsafe URL handling;
- server-side request forgery through a request-controlled destination;
- bypasses that expose non-public feed data;
- dependency or deployment issues with a concrete security impact.

Out of scope:

- market accuracy, market resolution disputes, or upstream data delays;
- denial of service caused solely by an upstream provider outage;
- social engineering, spam, or automated traffic without a product flaw;
- reports generated only by a scanner without a reproducible impact.

There is no public bug-bounty program. Good-faith reports are welcome and will
be handled privately.
