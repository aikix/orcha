## [1.0.1](https://github.com/aikix/orcha/compare/v1.0.0...v1.0.1) (2026-04-06)


### Bug Fixes

* set git remote URL with app token for semantic-release push ([09a0b18](https://github.com/aikix/orcha/commit/09a0b18fe91109c1cd1e266c312b0c8f40e92de2))
* use GitHub App token for semantic-release to bypass branch protection ([4325078](https://github.com/aikix/orcha/commit/4325078662b752c9ea2985180d0296ce3f2a8f43))

## [1.0.1](https://github.com/aikix/orcha/compare/v1.0.0...v1.0.1) (2026-04-02)


### Bug Fixes

* drop --frozen-lockfile to avoid stale registry URLs ([d407b7a](https://github.com/aikix/orcha/commit/d407b7a2a105cd54a82923507565df61651d8404))
* revert to bun 1.1.38 for CI — 1.3.11 has networking issues ([e9577a8](https://github.com/aikix/orcha/commit/e9577a804d4cd52c3be2f5cfb6cbe166c2b0483d)), closes [oven-sh/bun#22846](https://github.com/oven-sh/bun/issues/22846)
* use bun 1.3.11 with --linker hoisted to fix CI hang ([576c73d](https://github.com/aikix/orcha/commit/576c73dce68b36e354f5d8c10612697f5746fb29)), closes [oven-sh/bun#22846](https://github.com/oven-sh/bun/issues/22846)

# 1.0.0 (2026-04-02)


### Bug Fixes

* add Node.js 22 for semantic-release compatibility ([0bab55f](https://github.com/aikix/orcha/commit/0bab55f1f06233ee46fba952b9879296405ccb7d))
* add verbose and no-cache to debug bun install hang on CI ([7151b4f](https://github.com/aikix/orcha/commit/7151b4faac29b90fa2be0f25be8895e62d9d3f0e))
* pin bun version and use frozen-lockfile in CI ([f3d3be2](https://github.com/aikix/orcha/commit/f3d3be275ee6f47aa836c4425ebcba8df1eb3db7))
* use --ignore-scripts to avoid turbo binary download hang on CI ([f95d7f6](https://github.com/aikix/orcha/commit/f95d7f692cf89011fae739c6a4ca1a1f2fca3926))
* use bun 1.1.38 and fresh install to fix CI hang ([67e03a3](https://github.com/aikix/orcha/commit/67e03a3436909c06b1e5842f065b52485692caf7))
* use plain bun install with CI=true in workflows ([41cb3fb](https://github.com/aikix/orcha/commit/41cb3fb1e253223293519a11bfb4d0e71e372582))


### Features

* add semantic-release for automated versioning and binary releases ([29ed64d](https://github.com/aikix/orcha/commit/29ed64d43867e19d89593763fdb9a85ec9f6547d))
* prepare for open-source release ([2348cfa](https://github.com/aikix/orcha/commit/2348cfa8e27fe2a5ded37ff22f74ff2d1567608e))
