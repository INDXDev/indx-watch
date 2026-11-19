# Security policy

## Reporting a vulnerability

Please **do not open a public issue**. Report privately through [GitHub Security Advisories](https://github.com/INDXDev/indx-watch/security/advisories/new). We aim to acknowledge within 3 business days and to publish a fix or mitigation within 90 days.

Include: affected version, a description, steps to reproduce, and impact.

## Supported versions

Until 1.0, only the latest minor release receives security fixes.

## Scope

The CLI, the server (Node and Cloudflare Workers), the Playwright reporter, the GitHub Action and the skills in this repository. The security model — identity, secrets, access control and threat model — is described in [docs/spec/security.md](docs/spec/security.md).
