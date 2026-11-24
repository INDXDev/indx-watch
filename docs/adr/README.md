# Architecture decision records

One decision per file, [MADR](https://adr.github.io/madr/)-style. Copy [0000-template.md](https://github.com/INDXDev/indx-watch/blob/main/docs/adr/0000-template.md) to add one. Superseded ADRs stay, with a link to their replacement.

| # | Decision |
|---|---|
| [0001](./0001-file-first-bundle.md) | The bundle is the source of truth; databases are indexes |
| [0002](./0002-two-sync-channels.md) | Definitions sync through git; results through a result store |
| [0003](./0003-storage-only-store-protocol.md) | The result store protocol needs only object storage |
| [0004](./0004-canonical-toml.md) | One canonical TOML serializer; comments are not preserved |
| [0005](./0005-ids-and-keys.md) | ULID machine IDs; human keys assigned locally |
| [0006](./0006-content-hash-versions.md) | Test case and fixture versions are content hashes |
| [0007](./0007-one-server-node-and-workers.md) | One Hono server for Node and Workers |
| [0008](./0008-identity-from-environment.md) | Identity comes from the environment; no custom auth |
| [0009](./0009-ports-and-adapters.md) | Every vendor sits behind a port |
| [0010](./0010-single-npm-package.md) | Ship one npm package, `indx-watch` |
| [0011](./0011-markdown-docs.md) | Markdown docs, one home per fact; HTML only for design |
| [0012](./0012-license-and-dco.md) | Apache-2.0 and the DCO |
| [0013](./0013-decision-policy.md) | One pure function turns judgements into a verdict |
| [0014](./0014-docs-site.md) | The docs are also published with Mintlify, from the same Markdown files |
