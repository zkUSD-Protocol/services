# 💸 zkUSD Services Repo

This repository contains services and tools for working with the **zkUSD** ecosystem. It includes:
- Backend services for aggregating oracles, managing proofs, and orchestrating zkUSD flows.
- Utilities for interacting with **Mina nodes**, including setup, management, and automation scripts.

---

## ⚙️ mina-node Utilities

The `mina_node/` directory provides scripts to **set up**, **connect to**, and **work with** Mina nodes in the zkUSD infrastructure.

---
### Prerequisites

You must be able to assume the necessary AWS role.

### 🚀 Setup

Use the setup script to initialize the Mina node instance:

```bash
    sh setup.sh
```

### 🔐 SSH Interaction with the Mina Node

1. **Log in to the Mina node instance**
   This will open an **interactive SSH session**:

```bash
    ,/ssh.sh
```


2. **Execute a remote command on the Mina node**
   Pass a command to be executed remotely on the node:

To see the mina client status
```bash
    ./ssh.sh mina client status
```

To see the node's logs
```bash
    ./ssh.sh tail -f /var/log/mina-node/mina-node.log
```


