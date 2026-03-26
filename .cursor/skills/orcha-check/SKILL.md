---
name: orcha-check
description: "Health assessment of workspace: binaries, services, dependencies. Auto-invokes when user asks about stack health or service status."
---

Run `orcha doctor --json` and `orcha verify stack --json`, then provide a concise summary with recommendations. Flag broken dependency chains (running service whose dep is down). Suggest startup commands if nothing is running.
