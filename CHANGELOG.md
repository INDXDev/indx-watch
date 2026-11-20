# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- GitHub Action: `comment` and `check` inputs keep one PR comment per bundle and release and create an `INDX Watch` check run (T-204).
- `iw judge <run>`: an LLM judge (Claude, `claude-opus-5-5` by default) that adds an `llm` judgement from the test case's rubric, the run's steps and its last screenshot (T-202).
- Web app v2: a calm Home (verdict, summary cards, your queue, recent activity), List and Focus views with ← / → and swipes, runner sessions with keyboard shortcuts, an Activity screen and a CLI panel with copyable commands (T-213).
- "Who's testing?": a tester can declare a name in the browser where no verified identity exists; runs record it as `via = "browser"` (T-214).
- `iw push`, `iw clone`, drag-and-drop upload with a checked preview, and an Uploads screen (T-215).
- `iw translate`; release and plan titles are translatable; reviews record their locale; `examples/shop` and this repository's bundle are complete in Japanese (T-216).

## [0.1.0] - 2026-11-20

### Added

- First open-source version (v0.1): bundle format, `iw` CLI, local server and web UI, result store sync (folder and S3-compatible), Playwright reporter, GitHub Action, agent skills and MCP server, Cloudflare deploy, full archive export/import. See [docs/roadmap.md](docs/roadmap.md#v01--file-first-core-this-release).

[Unreleased]: https://github.com/INDXDev/indx-watch/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/INDXDev/indx-watch/releases/tag/v0.1.0
