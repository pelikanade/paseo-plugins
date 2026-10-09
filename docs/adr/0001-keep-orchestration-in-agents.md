# Keep nstack orchestration in agents

The `paseo-nstack` plugin detects signals, starts a fresh agent in the bound workspace, and supplies the nstack skills; it does not reproduce nstack routing or review policy in TypeScript. Native and hybrid policy implementations were rejected because either creates a second policy engine that can drift from the skills. Persistent per-binding agents were rejected because independent signals would share growing context and block each other, so one signal is handled by one fresh agent.
