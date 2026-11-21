# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- GitLab CI, CircleCI and Buildkite context: the reporter and the CLI fill `build`, `ci`, the actor (`via = "gitlab"`, `"circleci"`, `"buildkite"`, verified only when signed) and the run group from each provider's standard variables (T-208).

## [0.1.0] - 2026-11-21

### Added

- First open-source version (v0.1): bundle format, `iw` CLI, local server and web UI, result store sync (folder and S3-compatible), Playwright reporter, GitHub Action, agent skills and MCP server, Cloudflare deploy, full archive export/import. See [docs/roadmap.md](docs/roadmap.md#v01--file-first-core-this-release).
- A `Demo` workflow deploys `examples/shop` to a public Cloudflare Worker from `main`, so every change has a live demo site (T-118).
- GitHub Action: `comment` and `check` inputs keep one PR comment per bundle and release and create an `INDX Watch` check run (T-204).
- `iw judge <run>`: an LLM judge (Claude, `claude-opus-5-5` by default) that adds an `llm` judgement from the test case's rubric, the run's steps and its last screenshot (T-202).
- Web app v2: a calm Home (verdict, summary cards, your queue, recent activity), List and Focus views with ← / → and swipes, runner sessions with keyboard shortcuts, an Activity screen and a CLI panel with copyable commands (T-213).
- "Who's testing?": a tester can declare a name in the browser where no verified identity exists; runs record it as `via = "browser"` (T-214).
- `iw push`, `iw clone`, drag-and-drop upload with a checked preview, and an Uploads screen (T-215).
- `iw translate`; release and plan titles are translatable; reviews record their locale; `examples/shop` and this repository's bundle are complete in Japanese (T-216).
- Signed records: `iw keygen`, `IW_SIGNING_KEY` and `[[signing_keys]]` in `project.toml`. A record that claims a verified `via` without a valid signature is shown as unverified, and `[gate] ignore_unverified` keeps it out of the gate (T-211, #5).
- Features, environments, releases and plans written by an agent carry `origin = "ai"` and `[ai]`; `iw check` warns until `iw approve` records a reviewer (#4).

### Changed

- The Japanese machine translations in `examples/shop` and this repository's bundle use consistent terms and more natural phrasing; they stay `status = "machine"` until a human reviews them (T-216).

### Fixed

- Two bodies with one record ID now converge on the one whose log key sorts first, in every clone and in the hosted index; the conflict shows in `iw check` and the UI (#3).
- `iw translate` keeps every `--set`, not only the last.
- The remaining acceptance criteria are tested (T-117, #6).

[Unreleased]: https://github.com/INDXDev/indx-watch/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/INDXDev/indx-watch/releases/tag/v0.1.0
