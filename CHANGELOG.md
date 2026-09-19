# Changelog

### v8.20.0 (2026-09-19)

**New features:**

- \[MINOR] feat: add cli commands aliases (● [f23e659](https://github.com/corejslib/core/commit/f23e659d8), [26fc742](https://github.com/corejslib/core/commit/26fc742d2); 👬 zdm)

- \[MINOR] feat: add cli optionsAutoShorts option (● [7b5046c](https://github.com/corejslib/core/commit/7b5046c47); 👬 zdm)

Compare with the previous release: [v8.19.0...v8.20.0](https://github.com/corejslib/core/compare/v8.19.0...v8.20.0)

### v8.19.0 (2026-09-19)

**New features:**

- \[MINOR] feat: add JSON replacer support to JsonContainer (● [f636ca1](https://github.com/corejslib/core/commit/f636ca15d); 👬 zdm)

**Other changes:**

- docs: add node 26 removal note (● [c3c9acf](https://github.com/corejslib/core/commit/c3c9acfc5); 👬 zdm)

Compare with the previous release: [v8.18.0...v8.19.0](https://github.com/corejslib/core/compare/v8.18.0...v8.19.0)

### v8.18.0 (2026-09-16)

**New features:**

- \[MINOR] feat: add custom inspect support for Locale (● [06c9a65](https://github.com/corejslib/core/commit/06c9a651d); 👬 zdm)

**Bug fixes:**

- \[PATCH] fix: ensure JsonContainer serializes nested values safely (● [bbc0ffa](https://github.com/corejslib/core/commit/bbc0ffa25); 👬 zdm)

    Restore option state after serialization, add recursive conversion for
    nested toJSON values, and remove the custom JSON.stringify override.

- \[PATCH] fix: handle null and null-prototype objects in plain object check (● [cdecc3d](https://github.com/corejslib/core/commit/cdecc3d14); 👬 zdm)

- \[PATCH] fix: handle plain objects in JSON conversion (● [3abf0f7](https://github.com/corejslib/core/commit/3abf0f748); 👬 zdm)

- \[PATCH] fix: preserve translation fallback in L10nt#toJSON (● [a2f6e8e](https://github.com/corejslib/core/commit/a2f6e8eca); 👬 zdm)

**Code refactoring:**

- \[PATCH] refactor: use shared plain-object detection in JSON container (● [3436cfc](https://github.com/corejslib/core/commit/3436cfcd6); 👬 zdm)

Compare with the previous release: [v8.17.1...v8.18.0](https://github.com/corejslib/core/compare/v8.17.1...v8.18.0)

### v8.17.1 (2026-09-15)

**Other changes:**

- build(deps): downgrade @corejslib/utils to ^1.0.0 (● [a654bdd](https://github.com/corejslib/core/commit/a654bddaa); 👬 zdm)

- Revert "feat: add bundled utility implementations for ANSI and external resources" (● [21ec1b4](https://github.com/corejslib/core/commit/21ec1b4fc); 👬 zdm)

    This reverts commit [a2d6b0c](https://github.com/corejslib/core/commit/a2d6b0c0afb8659b28a0b79bc88317f23de2d10f).

Compare with the previous release: [v8.17.0...v8.17.1](https://github.com/corejslib/core/compare/v8.17.0...v8.17.1)

### v8.17.0 (2026-09-15)

**New features:**

- \[MINOR] feat: add bundled utility implementations for ANSI and external resources (● [a2d6b0c](https://github.com/corejslib/core/commit/a2d6b0c0a); 👬 zdm)

Compare with the previous release: [v8.16.2...v8.17.0](https://github.com/corejslib/core/compare/v8.16.2...v8.17.0)

### v8.16.2 (2026-09-15)

**Other changes:**

- chore: move app modules to app package (● [14718b7](https://github.com/corejslib/core/commit/14718b759), [8e79859](https://github.com/corejslib/core/commit/8e7985935); 👬 zdm)

Compare with the previous release: [v8.16.1...v8.16.2](https://github.com/corejslib/core/compare/v8.16.1...v8.16.2)

### v8.16.1 (2026-09-15)

**Bug fixes:**

- \[PATCH] fix: guard telegram bot availability (● [bb21683](https://github.com/corejslib/core/commit/bb21683bc); 👬 zdm)

    - check the configured Telegram bot component before enabling notifications
    - avoid dereferencing a missing telegram bot instance

**Code refactoring:**

- \[PATCH] refactor: rename AJV base class import (● [1402d40](https://github.com/corejslib/core/commit/1402d40cd); 👬 zdm)

**Other changes:**

- chore: remove stale Russian locale entries (● [26bacf0](https://github.com/corejslib/core/commit/26bacf004); 👬 zdm)

Compare with the previous release: [v8.16.0...v8.16.1](https://github.com/corejslib/core/compare/v8.16.0...v8.16.1)

### v8.16.0 (2026-09-15)

**New features:**

- \[MINOR] feat: move telegram to separate package (● [d3c40ee](https://github.com/corejslib/core/commit/d3c40eec5); 👬 zdm)

Compare with the previous release: [v8.15.2...v8.16.0](https://github.com/corejslib/core/compare/v8.15.2...v8.16.0)

### v8.15.2 (2026-09-14)

**Bug fixes:**

- \[PATCH] fix: fix sql (● [c8b4d48](https://github.com/corejslib/core/commit/c8b4d487e); 👬 zdm)

Compare with the previous release: [v8.15.1...v8.15.2](https://github.com/corejslib/core/compare/v8.15.1...v8.15.2)

### v8.15.1 (2026-09-13)

**Bug fixes:**

- \[PATCH] fix: fix patterns depth (● [f627a6c](https://github.com/corejslib/core/commit/f627a6cbc), [03d3c9e](https://github.com/corejslib/core/commit/03d3c9eab); 👬 zdm)

- \[PATCH] fix: rename pattern maxDepth to depth (● [8dec49b](https://github.com/corejslib/core/commit/8dec49b15); 👬 zdm)

Compare with the previous release: [v8.15.0...v8.15.1](https://github.com/corejslib/core/compare/v8.15.0...v8.15.1)

### v8.15.0 (2026-09-12)

**New features:**

- \[MINOR] feat: add fs .checkFsCaseSensitive() (● [d0fc269](https://github.com/corejslib/core/commit/d0fc26931); 👬 zdm)

Compare with the previous release: [v8.14.0...v8.15.0](https://github.com/corejslib/core/compare/v8.14.0...v8.15.0)

### v8.14.0 (2026-09-12)

**New features:**

- \[MINOR] feat: add fs .checkFsCaseSensitiveSync() (● [74e83b4](https://github.com/corejslib/core/commit/74e83b422); 👬 zdm)

**Code refactoring:**

- \[PATCH] refactor: replace patterns caseSensitive with ignoreCase property (● [1691522](https://github.com/corejslib/core/commit/169152254); 👬 zdm)

Compare with the previous release: [v8.13.7...v8.14.0](https://github.com/corejslib/core/compare/v8.13.7...v8.14.0)

### v8.13.7 (2026-09-11)

**Bug fixes:**

- \[PATCH] fix: fix typo (● [aa87b66](https://github.com/corejslib/core/commit/aa87b66cd); 👬 zdm)

Compare with the previous release: [v8.13.6...v8.13.7](https://github.com/corejslib/core/compare/v8.13.6...v8.13.7)

### v8.13.6 (2026-09-11)

**Bug fixes:**

- \[PATCH] fix: update locales po (● [daa5d2e](https://github.com/corejslib/core/commit/daa5d2e41); 👬 zdm)

**Code refactoring:**

- \[PATCH] refactor: refactor glob patterns (● [a3e2d1f](https://github.com/corejslib/core/commit/a3e2d1f56); 👬 zdm)

Compare with the previous release: [v8.13.5...v8.13.6](https://github.com/corejslib/core/compare/v8.13.5...v8.13.6)

### v8.13.5 (2026-09-07)

**Bug fixes:**

- \[PATCH] fix: fix sql select into (● [0336359](https://github.com/corejslib/core/commit/0336359e5); 👬 zdm)

**Code refactoring:**

- \[PATCH] refactor: rename .install() to .update() (● [7f06d4e](https://github.com/corejslib/core/commit/7f06d4e2c); 👬 zdm)

Compare with the previous release: [v8.13.4...v8.13.5](https://github.com/corejslib/core/compare/v8.13.4...v8.13.5)

### v8.13.4 (2026-09-06)

**Code refactoring:**

- \[PATCH] refactor: use var prefixes in sql functions (● [bc3ef5d](https://github.com/corejslib/core/commit/bc3ef5d46); 👬 zdm)

Compare with the previous release: [v8.13.3...v8.13.4](https://github.com/corejslib/core/compare/v8.13.3...v8.13.4)

### v8.13.3 (2026-09-05)

**Bug fixes:**

- \[PATCH] fix: fix ejs id accessor (● [e4dd983](https://github.com/corejslib/core/commit/e4dd983b2); 👬 zdm)

**Code refactoring:**

- \[PATCH] refactor: refactor mime (● [4428a5f](https://github.com/corejslib/core/commit/4428a5f93); 👬 zdm)

Compare with the previous release: [v8.13.2...v8.13.3](https://github.com/corejslib/core/compare/v8.13.2...v8.13.3)

### v8.13.2 (2026-08-30)

**Code refactoring:**

- \[PATCH] refactor: refactor mime (● [25c1afa](https://github.com/corejslib/core/commit/25c1afacd), [2217441](https://github.com/corejslib/core/commit/22174413f); 👬 zdm)

Compare with the previous release: [v8.13.1...v8.13.2](https://github.com/corejslib/core/compare/v8.13.1...v8.13.2)

### v8.13.1 (2026-08-30)

**Code refactoring:**

- \[PATCH] refactor: refactor mime (● [86a81a1](https://github.com/corejslib/core/commit/86a81a192); 👬 zdm)

- \[PATCH] refactor: rename emitSync to runCallbacks (● [910ab5d](https://github.com/corejslib/core/commit/910ab5d0f); 👬 zdm)

Compare with the previous release: [v8.13.0...v8.13.1](https://github.com/corejslib/core/compare/v8.13.0...v8.13.1)

### v8.13.0 (2026-08-30)

**New features:**

- \[MINOR] feat: add mime shebang regexps (● [0490bb2](https://github.com/corejslib/core/commit/0490bb212); 👬 zdm)

**Code refactoring:**

- \[PATCH] refactor: refactor benchmarks (● [53b4456](https://github.com/corejslib/core/commit/53b44565b); 👬 zdm)

Compare with the previous release: [v8.12.4...v8.13.0](https://github.com/corejslib/core/compare/v8.12.4...v8.13.0)

### v8.12.4 (2026-08-28)

**Bug fixes:**

- \[PATCH] fix: fix filetype by shebang detection (● [b6d3c46](https://github.com/corejslib/core/commit/b6d3c4603); 👬 zdm)

Compare with the previous release: [v8.12.3...v8.12.4](https://github.com/corejslib/core/compare/v8.12.3...v8.12.4)

### v8.12.3 (2026-08-28)

**Bug fixes:**

- \[PATCH] fix: fix shebang (● [bb7bf97](https://github.com/corejslib/core/commit/bb7bf9753); 👬 zdm)

Compare with the previous release: [v8.12.2...v8.12.3](https://github.com/corejslib/core/compare/v8.12.2...v8.12.3)

### v8.12.2 (2026-08-27)

**Bug fixes:**

- \[PATCH] fix: fix global values access (● [7c13a72](https://github.com/corejslib/core/commit/7c13a72dc), [3b445e8](https://github.com/corejslib/core/commit/3b445e82d); 👬 zdm)

- \[PATCH] fix: use webcrypto (● [8c042d1](https://github.com/corejslib/core/commit/8c042d1aa); 👬 zdm)

Compare with the previous release: [v8.12.1...v8.12.2](https://github.com/corejslib/core/compare/v8.12.1...v8.12.2)

### v8.12.1 (2026-08-27)

**Bug fixes:**

- \[PATCH] fix: fix app signup (● [a29b149](https://github.com/corejslib/core/commit/a29b14900); 👬 zdm)

Compare with the previous release: [v8.12.0...v8.12.1](https://github.com/corejslib/core/compare/v8.12.0...v8.12.1)

### v8.12.0 (2026-08-27)

**New features:**

- \[MINOR] feat: add pwnedpasswords.com api (● [ac209f4](https://github.com/corejslib/core/commit/ac209f4ac), [9282683](https://github.com/corejslib/core/commit/92826839b), [79664cf](https://github.com/corejslib/core/commit/79664cf6a); 👬 zdm)

Compare with the previous release: [v8.11.2...v8.12.0](https://github.com/corejslib/core/compare/v8.11.2...v8.12.0)

### v8.11.2 (2026-08-26)

**Code refactoring:**

- \[PATCH] refactor: improve random-values performance (● [8e6b9d4](https://github.com/corejslib/core/commit/8e6b9d420); 👬 zdm)

- \[PATCH] refactor: update random-values tests (● [a5a3250](https://github.com/corejslib/core/commit/a5a325029); 👬 zdm)

Compare with the previous release: [v8.11.1...v8.11.2](https://github.com/corejslib/core/compare/v8.11.1...v8.11.2)

### v8.11.1 (2026-08-26)

**Bug fixes:**

- \[PATCH] fix: fix bugs in progress (● [b193b1a](https://github.com/corejslib/core/commit/b193b1acb), [dc0ab67](https://github.com/corejslib/core/commit/dc0ab6796), [e0b9049](https://github.com/corejslib/core/commit/e0b90499b), [7c3bdcd](https://github.com/corejslib/core/commit/7c3bdcd6e), [d3a9c39](https://github.com/corejslib/core/commit/d3a9c3991), [7d9bc87](https://github.com/corejslib/core/commit/7d9bc8704), [d379e7f](https://github.com/corejslib/core/commit/d379e7f32), [245ef41](https://github.com/corejslib/core/commit/245ef4144), [f8acb0b](https://github.com/corejslib/core/commit/f8acb0bd0), [dccd7bc](https://github.com/corejslib/core/commit/dccd7bc9c), [e3a03da](https://github.com/corejslib/core/commit/e3a03da80); 👬 zdm)

- \[PATCH] fix: fix DisposableStack usage (● [932c8ec](https://github.com/corejslib/core/commit/932c8ec11); 👬 zdm)

Compare with the previous release: [v8.11.0...v8.11.1](https://github.com/corejslib/core/compare/v8.11.0...v8.11.1)

### v8.11.0 (2026-08-25)

**New features:**

- \[MINOR] feat: add progress (● [eb5f505](https://github.com/corejslib/core/commit/eb5f505ec); 👬 zdm)

Compare with the previous release: [v8.10.2...v8.11.0](https://github.com/corejslib/core/compare/v8.10.2...v8.11.0)

### v8.10.2 (2026-08-22)

**Bug fixes:**

- \[PATCH] fix: fix ascii posix class (● [fecdbde](https://github.com/corejslib/core/commit/fecdbdeb1); 👬 zdm)

**Code refactoring:**

- \[PATCH] refactor: optimize glob pattern code (● [0d1e5ea](https://github.com/corejslib/core/commit/0d1e5eaaa); 👬 zdm)

- \[PATCH] refactor: optimize glob patterns code (● [80bb58d](https://github.com/corejslib/core/commit/80bb58dd1); 👬 zdm)

**Other changes:**

- style: fix typo (● [afb68d8](https://github.com/corejslib/core/commit/afb68d8b4); 👬 zdm)

Compare with the previous release: [v8.10.1...v8.10.2](https://github.com/corejslib/core/compare/v8.10.1...v8.10.2)

### v8.10.1 (2026-08-21)

**Code refactoring:**

- \[PATCH] refactor: refactor glob api (● [c480910](https://github.com/corejslib/core/commit/c480910da); 👬 zdm)

Compare with the previous release: [v8.10.0...v8.10.1](https://github.com/corejslib/core/compare/v8.10.0...v8.10.1)

### v8.10.0 (2026-08-21)

**New features:**

- \[MINOR] feat: add glob pattern .testList() (● [5a0e172](https://github.com/corejslib/core/commit/5a0e17255); 👬 zdm)

**Code refactoring:**

- \[PATCH] refactor: update xml parser (● [f6f521f](https://github.com/corejslib/core/commit/f6f521fa8); 👬 zdm)

**Other changes:**

- build(deps): add micromark-extension-frontmatter (● [c77a197](https://github.com/corejslib/core/commit/c77a197e2); 👬 zdm)

Compare with the previous release: [v8.9.3...v8.10.0](https://github.com/corejslib/core/compare/v8.9.3...v8.10.0)

### v8.9.3 (2026-08-20)

**Bug fixes:**

- \[PATCH] fix: fix glob api (● [bf097aa](https://github.com/corejslib/core/commit/bf097aa83); 👬 zdm)

Compare with the previous release: [v8.9.2...v8.9.3](https://github.com/corejslib/core/compare/v8.9.2...v8.9.3)

### v8.9.2 (2026-08-19)

**Code refactoring:**

- \[PATCH] refactor: remove markdown list indentation (● [eb7196e](https://github.com/corejslib/core/commit/eb7196e57); 👬 zdm)

Compare with the previous release: [v8.9.1...v8.9.2](https://github.com/corejslib/core/compare/v8.9.1...v8.9.2)

### v8.9.1 (2026-08-18)

**Bug fixes:**

- \[PATCH] fix: fix markdown list indentation (● [4723e43](https://github.com/corejslib/core/commit/4723e4360), [c67f9d9](https://github.com/corejslib/core/commit/c67f9d972); 👬 zdm)

Compare with the previous release: [v8.9.0...v8.9.1](https://github.com/corejslib/core/compare/v8.9.0...v8.9.1)

### v8.9.0 (2026-08-18)

**New features:**

- \[MINOR] feat: add markdown frontmatter support (● [abfc384](https://github.com/corejslib/core/commit/abfc384bc); 👬 zdm)

Compare with the previous release: [v8.8.6...v8.9.0](https://github.com/corejslib/core/compare/v8.8.6...v8.9.0)

### v8.8.6 (2026-08-18)

**Code refactoring:**

- \[PATCH] refactor: rename glob pattern options (● [b3db275](https://github.com/corejslib/core/commit/b3db27514); 👬 zdm)

Compare with the previous release: [v8.8.5...v8.8.6](https://github.com/corejslib/core/compare/v8.8.5...v8.8.6)

### v8.8.5 (2026-08-16)

**Bug fixes:**

- \[PATCH] fix: fix js-yaml tags (● [1e2a72c](https://github.com/corejslib/core/commit/1e2a72ca1); 👬 zdm)

Compare with the previous release: [v8.8.4...v8.8.5](https://github.com/corejslib/core/compare/v8.8.4...v8.8.5)

### v8.8.4 (2026-08-16)

**Code refactoring:**

- \[PATCH] refactor: refactor glob api (● [0f538dc](https://github.com/corejslib/core/commit/0f538dc92); 👬 zdm)

**Other changes:**

- style: comment fixme bug (● [1be0847](https://github.com/corejslib/core/commit/1be084732); 👬 zdm)

Compare with the previous release: [v8.8.3...v8.8.4](https://github.com/corejslib/core/compare/v8.8.3...v8.8.4)

### v8.8.3 (2026-08-06)

**Bug fixes:**

- \[PATCH] fix: fix npm dry-run mode (● [777579e](https://github.com/corejslib/core/commit/777579e20); 👬 zdm)

- \[PATCH] fix: harden environment loading (● [95783e4](https://github.com/corejslib/core/commit/95783e4a3); 👬 zdm)

Compare with the previous release: [v8.8.2...v8.8.3](https://github.com/corejslib/core/compare/v8.8.2...v8.8.3)

### v8.8.2 (2026-08-04)

**Other changes:**

- chore: rename capi to zapi (● [4f68a61](https://github.com/corejslib/core/commit/4f68a6188); 👬 zdm)

- chore: rename ccli to zcli (● [ac783ec](https://github.com/corejslib/core/commit/ac783ece3), [b6328d0](https://github.com/corejslib/core/commit/b6328d07c), [b209861](https://github.com/corejslib/core/commit/b209861db); 👬 zdm)

Compare with the previous release: [v8.8.1...v8.8.2](https://github.com/corejslib/core/compare/v8.8.1...v8.8.2)

### v8.8.1 (2026-08-04)

**Other changes:**

- style: lint (● [d0ecb66](https://github.com/corejslib/core/commit/d0ecb66ff), [fa8b6a5](https://github.com/corejslib/core/commit/fa8b6a5ef), [d87252c](https://github.com/corejslib/core/commit/d87252c84), [71e030e](https://github.com/corejslib/core/commit/71e030e2d); 👬 zdm)

Compare with the previous release: [v8.8.0...v8.8.1](https://github.com/corejslib/core/compare/v8.8.0...v8.8.1)

### v8.8.0 (2026-08-03)

**New features:**

- \[MINOR] feat: add File .extname, .dirname (● [a52a445](https://github.com/corejslib/core/commit/a52a44533); 👬 zdm)

Compare with the previous release: [v8.7.3...v8.8.0](https://github.com/corejslib/core/compare/v8.7.3...v8.8.0)

### v8.7.3 (2026-08-03)

**Other changes:**

- build: update dependabot config (● [d05780d](https://github.com/corejslib/core/commit/d05780d6e); 👬 zdm)

- chore(metadata): update package metadata (● [acf0be6](https://github.com/corejslib/core/commit/acf0be6ef); 👬 zdm)

Compare with the previous release: [v8.7.2...v8.7.3](https://github.com/corejslib/core/compare/v8.7.2...v8.7.3)

### v8.7.2 (2026-08-03)

**Other changes:**

- chore(metadata): update package metadata (● [0feb169](https://github.com/corejslib/core/commit/0feb169f1); 👬 zdm)

Compare with the previous release: [v8.7.1...v8.7.2](https://github.com/corejslib/core/compare/v8.7.1...v8.7.2)

### v8.7.1 (2026-08-02)

**Bug fixes:**

- \[PATCH] fix: fix npm api pack (● [a75da72](https://github.com/corejslib/core/commit/a75da7274); 👬 zdm)

Compare with the previous release: [v8.7.0...v8.7.1](https://github.com/corejslib/core/compare/v8.7.0...v8.7.1)

### v8.7.0 (2026-08-02)

**New features:**

- \[MINOR] feat: rename softvisio proxy to cproxy (● [4d8bc89](https://github.com/corejslib/core/commit/4d8bc897b); 👬 zdm)

Compare with the previous release: [v8.6.0...v8.7.0](https://github.com/corejslib/core/compare/v8.6.0...v8.7.0)

### v8.6.0 (2026-08-01)

**New features:**

- \[MINOR] feat: add env .isDocker (● [a4566f8](https://github.com/corejslib/core/commit/a4566f820); 👬 zdm)

**Bug fixes:**

- \[PATCH] fix: rename sapi to capi (● [14b5bb1](https://github.com/corejslib/core/commit/14b5bb12a); 👬 zdm)

**Other changes:**

- chore: rename softvisio to corejslib (● [209c8bf](https://github.com/corejslib/core/commit/209c8bf6a); 👬 zdm)

- docs: update (● [2fc3c88](https://github.com/corejslib/core/commit/2fc3c889a); 👬 zdm)

Compare with the previous release: [v8.5.2...v8.6.0](https://github.com/corejslib/core/compare/v8.5.2...v8.6.0)

### v8.5.2 (2026-08-01)

**Bug fixes:**

- \[PATCH] fix: update package keywords (● [0a7e868](https://github.com/corejslib/core/commit/0a7e868fb); 👬 zdm)

Compare with the previous release: [v8.5.1...v8.5.2](https://github.com/corejslib/core/compare/v8.5.1...v8.5.2)

### v8.5.1 (2026-07-30)

**Bug fixes:**

- \[PATCH] fix: fix Numeric static round (● [a76b1c0](https://github.com/corejslib/core/commit/a76b1c0bb), [5e947e3](https://github.com/corejslib/core/commit/5e947e38d), [215c54e](https://github.com/corejslib/core/commit/215c54eaa); 👬 zdm)

Compare with the previous release: [v8.5.0...v8.5.1](https://github.com/corejslib/core/compare/v8.5.0...v8.5.1)

### v8.5.0 (2026-07-30)

**New features:**

- \[MINOR] feat: add Numeric constructor .radix option (● [12470f2](https://github.com/corejslib/core/commit/12470f234), [afaf9df](https://github.com/corejslib/core/commit/afaf9df49); 👬 zdm)

**Bug fixes:**

- \[PATCH] fix: parse Numeric strings contained \_ sep (● [8b754b6](https://github.com/corejslib/core/commit/8b754b601); 👬 zdm)

**Code refactoring:**

- \[PATCH] refactor: add new Numeric modulo modes (● [3ede987](https://github.com/corejslib/core/commit/3ede9879a); 👬 zdm)

- \[PATCH] refactor: add new Numeric rounding modes (● [2254515](https://github.com/corejslib/core/commit/225451530); 👬 zdm)

- \[PATCH] refactor: move math module to Numeric static (● [636386a](https://github.com/corejslib/core/commit/636386a43); 👬 zdm)

- \[PATCH] refactor: rename Numeric roundMode to roundingMode (● [c58c2d0](https://github.com/corejslib/core/commit/c58c2d076); 👬 zdm)

- \[PATCH] refactor: update Numeric .ceil() signature (● [539a1fc](https://github.com/corejslib/core/commit/539a1fc28), [c397eea](https://github.com/corejslib/core/commit/c397eeaea); 👬 zdm)

- \[PATCH] refactor: update Numeric .floor() signature (● [fec2118](https://github.com/corejslib/core/commit/fec2118c5); 👬 zdm)

- \[PATCH] refactor: update Numeric .round method (● [19c444e](https://github.com/corejslib/core/commit/19c444ef5), [eec9788](https://github.com/corejslib/core/commit/eec9788dd); 👬 zdm)

- \[PATCH] refactor: update Numeric .round() signature (● [d8f1993](https://github.com/corejslib/core/commit/d8f1993b3); 👬 zdm)

- \[PATCH] refactor: update Numeric .truncate() signature (● [bbbce4e](https://github.com/corejslib/core/commit/bbbce4ed0); 👬 zdm)

Compare with the previous release: [v8.4.8...v8.5.0](https://github.com/corejslib/core/compare/v8.4.8...v8.5.0)

### v8.4.8 (2026-07-29)

**Bug fixes:**

- \[PATCH] fix: fix Numecit precision calculation (● [2511705](https://github.com/corejslib/core/commit/251170585), [b1acf7c](https://github.com/corejslib/core/commit/b1acf7c1c), [c454e54](https://github.com/corejslib/core/commit/c454e5435); 👬 zdm)

Compare with the previous release: [v8.4.7...v8.4.8](https://github.com/corejslib/core/compare/v8.4.7...v8.4.8)

### v8.4.7 (2026-07-29)

**Bug fixes:**

- \[PATCH] fix: fix Number.bigint (● [f7e692a](https://github.com/corejslib/core/commit/f7e692a31); 👬 zdm)

Compare with the previous release: [v8.4.6...v8.4.7](https://github.com/corejslib/core/compare/v8.4.6...v8.4.7)

### v8.4.6 (2026-07-28)

**Code refactoring:**

- \[PATCH] refactor: add optimizations to Numeric constructor (● [79b0f28](https://github.com/corejslib/core/commit/79b0f28f9); 👬 zdm)

Compare with the previous release: [v8.4.5...v8.4.6](https://github.com/corejslib/core/compare/v8.4.5...v8.4.6)

### v8.4.5 (2026-07-28)

**Bug fixes:**

- \[PATCH] fix: fix Numeric .isInteger (● [937845a](https://github.com/corejslib/core/commit/937845abf); 👬 zdm)

- \[PATCH] fix: fix Numeric fractional digits (● [ff9022a](https://github.com/corejslib/core/commit/ff9022a23); 👬 zdm)

Compare with the previous release: [v8.4.4...v8.4.5](https://github.com/corejslib/core/compare/v8.4.4...v8.4.5)

### v8.4.4 (2026-07-28)

**Bug fixes:**

- \[PATCH] fix: fix Numeric constructor (● [638ff11](https://github.com/corejslib/core/commit/638ff1171); 👬 zdm)

**Code refactoring:**

- \[PATCH] refactor: optimize Interval (● [70127ac](https://github.com/corejslib/core/commit/70127acec); 👬 zdm)

Compare with the previous release: [v8.4.3...v8.4.4](https://github.com/corejslib/core/compare/v8.4.3...v8.4.4)

### v8.4.3 (2026-07-28)

**Bug fixes:**

- \[PATCH] fix: fix access to privale props (● [743fd0b](https://github.com/corejslib/core/commit/743fd0b80); 👬 zdm)

**Code refactoring:**

- \[PATCH] refactor: optimize Interval (● [5ea7d54](https://github.com/corejslib/core/commit/5ea7d5440), [98cfd9d](https://github.com/corejslib/core/commit/98cfd9dd1), [e01ad8e](https://github.com/corejslib/core/commit/e01ad8ee1), [1c5c430](https://github.com/corejslib/core/commit/1c5c4304c), [4d4c5b2](https://github.com/corejslib/core/commit/4d4c5b28d); 👬 zdm)

Compare with the previous release: [v8.4.2...v8.4.3](https://github.com/corejslib/core/compare/v8.4.2...v8.4.3)

### v8.4.2 (2026-07-28)

**Bug fixes:**

- \[PATCH] fix: fix numeric scale compare (● [90dd183](https://github.com/corejslib/core/commit/90dd18315), [b9b34be](https://github.com/corejslib/core/commit/b9b34bece), [9ca4b20](https://github.com/corejslib/core/commit/9ca4b20a0), [1cf31ad](https://github.com/corejslib/core/commit/1cf31ad66); 👬 zdm)

**Code refactoring:**

- \[PATCH] refactor: cache Numeric compareRank (● [c37b7a9](https://github.com/corejslib/core/commit/c37b7a9c4); 👬 zdm)

- \[PATCH] refactor: cache Numeric sign (● [3ac0618](https://github.com/corejslib/core/commit/3ac06181c); 👬 zdm)

Compare with the previous release: [v8.4.1...v8.4.2](https://github.com/corejslib/core/compare/v8.4.1...v8.4.2)

### v8.4.1 (2026-07-28)

**Code refactoring:**

- \[PATCH] refactor: refactor numeric (● [dc6e100](https://github.com/corejslib/core/commit/dc6e10081), [7286ad6](https://github.com/corejslib/core/commit/7286ad60d); 👬 zdm)

Compare with the previous release: [v8.4.0...v8.4.1](https://github.com/corejslib/core/compare/v8.4.0...v8.4.1)

### v8.4.0 (2026-07-24)

**New features:**

- \[MINOR] feat: add ip-ranges getRandomAddress() method (● [f8f76d3](https://github.com/corejslib/core/commit/f8f76d330); 👬 zdm)

**Bug fixes:**

- \[PATCH] fix: fix digital-size (● [c739a0e](https://github.com/corejslib/core/commit/c739a0e52); 👬 zdm)

- \[PATCH] fix: fix ip address v4 parser (● [6758b74](https://github.com/corejslib/core/commit/6758b7415); 👬 zdm)

- \[PATCH] fix: fix ip range constructor (● [af174e1](https://github.com/corejslib/core/commit/af174e1b3); 👬 zdm)

- \[PATCH] fix: fix random-values (● [4b4ddf4](https://github.com/corejslib/core/commit/4b4ddf42f), [4ea33ee](https://github.com/corejslib/core/commit/4ea33eee8), [63f6d9c](https://github.com/corejslib/core/commit/63f6d9c63); 👬 zdm)

- \[PATCH] fix: fix streaming-splitter.js (● [01189ed](https://github.com/corejslib/core/commit/01189edf1); 👬 zdm)

Compare with the previous release: [v8.3.0...v8.4.0](https://github.com/corejslib/core/compare/v8.3.0...v8.4.0)

### v8.3.0 (2026-07-23)

**New features:**

- \[MINOR] feat: add Range .compare() (● [a090765](https://github.com/corejslib/core/commit/a09076525); 👬 zdm)

**Bug fixes:**

- \[PATCH] fix: fix avl cmp (● [32ec4d4](https://github.com/corejslib/core/commit/32ec4d4ea); 👬 zdm)

- \[PATCH] fix: fix ip ranges api (● [5a0ab2e](https://github.com/corejslib/core/commit/5a0ab2e9a); 👬 zdm)

Compare with the previous release: [v8.2.2...v8.3.0](https://github.com/corejslib/core/compare/v8.2.2...v8.3.0)

### v8.2.2 (2026-07-19)

**Bug fixes:**

- \[PATCH] fix: fix subnets getter (● [fac6248](https://github.com/corejslib/core/commit/fac624875); 👬 zdm)

Compare with the previous release: [v8.2.1...v8.2.2](https://github.com/corejslib/core/compare/v8.2.1...v8.2.2)

### v8.2.1 (2026-07-19)

**Code refactoring:**

- \[PATCH] refactor: remove http server .beginWrite() (● [98f8740](https://github.com/corejslib/core/commit/98f874081); 👬 zdm)

Compare with the previous release: [v8.2.0...v8.2.1](https://github.com/corejslib/core/compare/v8.2.0...v8.2.1)

### v8.2.0 (2026-07-19)

**New features:**

- \[MINOR] feat: add big ranges (● [2b28ac8](https://github.com/corejslib/core/commit/2b28ac834); 👬 zdm)

- \[MINOR] feat: add ranges .hasIntersectingRanges property (● [3c54251](https://github.com/corejslib/core/commit/3c542510b); 👬 zdm)

- \[MINOR] feat: add segmented-tree module (● [05be862](https://github.com/corejslib/core/commit/05be8621f), [096d7ae](https://github.com/corejslib/core/commit/096d7ae36), [36295a5](https://github.com/corejslib/core/commit/36295a5a2), [8c0f04e](https://github.com/corejslib/core/commit/8c0f04e83), [2a97dbe](https://github.com/corejslib/core/commit/2a97dbe80), [90114c5](https://github.com/corejslib/core/commit/90114c536), [720d349](https://github.com/corejslib/core/commit/720d349f7), [839d1e2](https://github.com/corejslib/core/commit/839d1e209), [b1c16d5](https://github.com/corejslib/core/commit/b1c16d522), [3df72dc](https://github.com/corejslib/core/commit/3df72dc5b), [3ddccbc](https://github.com/corejslib/core/commit/3ddccbcef), [a2bb84c](https://github.com/corejslib/core/commit/a2bb84c1c), [084628a](https://github.com/corejslib/core/commit/084628a12); 👬 zdm)

**Bug fixes:**

- \[PATCH] fix: fix ip ranges search (● [cd4bb16](https://github.com/corejslib/core/commit/cd4bb169b), [c2a1485](https://github.com/corejslib/core/commit/c2a1485dd), [90ed8c1](https://github.com/corejslib/core/commit/90ed8c161); 👬 zdm)

- \[PATCH] fix: fix npm api (● [afeafd9](https://github.com/corejslib/core/commit/afeafd9f1); 👬 zdm)

**Code refactoring:**

- \[PATCH] refactor: migrate to teleproto (● [86aaa01](https://github.com/corejslib/core/commit/86aaa0195); 👬 zdm)

- \[PATCH] refactor: refactor avl tree (● [c08931f](https://github.com/corejslib/core/commit/c08931f9b), [b543e6d](https://github.com/corejslib/core/commit/b543e6d79); 👬 zdm)

- \[PATCH] refactor: refactor ip ranges (● [1eabb1d](https://github.com/corejslib/core/commit/1eabb1d6d), [2409837](https://github.com/corejslib/core/commit/2409837ae), [826d82d](https://github.com/corejslib/core/commit/826d82dc4), [ed01706](https://github.com/corejslib/core/commit/ed0170674), [55f393d](https://github.com/corejslib/core/commit/55f393dea); 👬 zdm)

- \[PATCH] refactor: refactor ranges (● [77288fc](https://github.com/corejslib/core/commit/77288fcab), [f86e8d2](https://github.com/corejslib/core/commit/f86e8d2df); 👬 zdm)

- \[PATCH] refactor: use http server .beginWrite() (● [6d60f34](https://github.com/corejslib/core/commit/6d60f34a0); 👬 zdm)

- \[PATCH] refactor: use result.setMeta() (● [250a1b2](https://github.com/corejslib/core/commit/250a1b2d9); 👬 zdm)

- \[PATCH] refactor: use segmented tree in ranges (● [b3b94d6](https://github.com/corejslib/core/commit/b3b94d66f); 👬 zdm)

**Other changes:**

- build(deps): bunp adm-zip@^0.6.0 (● [f40d3ea](https://github.com/corejslib/core/commit/f40d3ea4e); 👬 zdm)

- build(deps): bunp npm@>=12.0.1 (● [30e00d6](https://github.com/corejslib/core/commit/30e00d6e4), [8548be3](https://github.com/corejslib/core/commit/8548be376); 👬 zdm)

- style: lint (● [a0cef18](https://github.com/corejslib/core/commit/a0cef185c), [e1a6a1c](https://github.com/corejslib/core/commit/e1a6a1c82); 👬 zdm)

Compare with the previous release: [v8.1.8...v8.2.0](https://github.com/corejslib/core/compare/v8.1.8...v8.2.0)

### v8.1.8 (2026-07-09)

**Bug fixes:**

- \[PATCH] fix: unpin npm\@11 (● [47b8c07](https://github.com/corejslib/core/commit/47b8c0723); 👬 zdm)

Compare with the previous release: [v8.1.7...v8.1.8](https://github.com/corejslib/core/compare/v8.1.7...v8.1.8)

### v8.1.7 (2026-07-09)

**Bug fixes:**

- \[PATCH] fix: unpin npm\@11 (● [2062ea3](https://github.com/corejslib/core/commit/2062ea307); 👬 zdm)

Compare with the previous release: [v8.1.6...v8.1.7](https://github.com/corejslib/core/compare/v8.1.6...v8.1.7)

### v8.1.6 (2026-07-09)

**Bug fixes:**

- \[PATCH] fix: pin npm\@11 (● [af534d0](https://github.com/corejslib/core/commit/af534d04e); 👬 zdm)

Compare with the previous release: [v8.1.5...v8.1.6](https://github.com/corejslib/core/compare/v8.1.5...v8.1.6)

### v8.1.5 (2026-07-09)

**Bug fixes:**

- \[PATCH] fix: fix npm api (● [15f2f3a](https://github.com/corejslib/core/commit/15f2f3aca); 👬 zdm)

Compare with the previous release: [v8.1.4...v8.1.5](https://github.com/corejslib/core/compare/v8.1.4...v8.1.5)

### v8.1.4 (2026-07-09)

**Bug fixes:**

- \[PATCH] fix: fix npm api (● [b74936b](https://github.com/corejslib/core/commit/b74936b90); 👬 zdm)

Compare with the previous release: [v8.1.3...v8.1.4](https://github.com/corejslib/core/compare/v8.1.3...v8.1.4)

### v8.1.3 (2026-07-09)

**Bug fixes:**

- \[PATCH] fix: fix npm api (● [2115ea8](https://github.com/corejslib/core/commit/2115ea818); 👬 zdm)

Compare with the previous release: [v8.1.2...v8.1.3](https://github.com/corejslib/core/compare/v8.1.2...v8.1.3)

### v8.1.2 (2026-07-09)

**Bug fixes:**

- \[PATCH] fix: fix npm api (● [d4e575a](https://github.com/corejslib/core/commit/d4e575a75); 👬 zdm)

Compare with the previous release: [v8.1.1...v8.1.2](https://github.com/corejslib/core/compare/v8.1.1...v8.1.2)

### v8.1.1 (2026-07-09)

**Bug fixes:**

- \[PATCH] fix: fix npm api (● [4ce8280](https://github.com/corejslib/core/commit/4ce82801a); 👬 zdm)

**Other changes:**

- build: update engines (● [b3bd996](https://github.com/corejslib/core/commit/b3bd996b1); 👬 zdm)

Compare with the previous release: [v8.1.0...v8.1.1](https://github.com/corejslib/core/compare/v8.1.0...v8.1.1)

### v8.1.0 (2026-07-08)

**New features:**

- \[MINOR] feat: add ip ranges iterator (● [8c3b97a](https://github.com/corejslib/core/commit/8c3b97a01); 👬 zdm)

Compare with the previous release: [v8.0.0...v8.1.0](https://github.com/corejslib/core/compare/v8.0.0...v8.1.0)

### v8.0.0 (2026-07-06)

**Migration notes:**

See the list of the breaking changes below for details.

**Breaking changes:**

- \[MAJOR] feat!: bump major release (● [dc3cb51](https://github.com/corejslib/core/commit/dc3cb518f); 👬 zdm)

**Other changes:**

- style: refactor code (● [99ddb1c](https://github.com/corejslib/core/commit/99ddb1cc9); 👬 zdm)

Compare with the previous release: [v7.235.4...v8.0.0](https://github.com/corejslib/core/compare/v7.235.4...v8.0.0)
