# ₿ Satoshi Proof — ZK Bitcoin Ownership on Starknet

**Prove you own Bitcoin without revealing your public key or address.**

Satoshi Proof lets Bitcoin holders cryptographically prove their BTC ownership on Starknet using BIP-137 message signatures and Starknet's native secp256k1 verification. Your Bitcoin public key is never stored on-chain — only a Poseidon hash, preserving privacy.

🔗 **Live App:** [satoshi-proof.vercel.app](https://satoshi-proof.vercel.app)  
📜 **Contracts:** Starknet Sepolia  
🔬 **E2E Tested:** Signature → On-chain → API — fully verified

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Bitcoin Wallet (Electrum, Sparrow, etc.)                │
│  Signs message with BIP-137                             │
└────────────────┬────────────────────────────────────────┘
                 │ base64 signature
                 ▼
┌─────────────────────────────────────────────────────────┐
│  SDK / Frontend                                          │
│  • Parse BIP-137 signature                              │
│  • Recover secp256k1 public key                         │
│  • Compute Poseidon hash of pubkey (privacy layer)      │
│  • Determine BTC bracket (🦐🦀🐟🦈🐋)                   │
└────────────────┬────────────────────────────────────────┘
                 │ (msg_hash, r, s, y_parity, pubkey_hash, bracket)
                 ▼
┌─────────────────────────────────────────────────────────┐
│  Starknet Contracts                                      │
│  • secp256k1 ECDSA recovery via native syscall          │
│  • Poseidon hash verification (no raw pubkey stored)    │
│  • SBT minting with bracket metadata                    │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  REST API (Vercel Serverless)                            │
│  • Query proofs by Starknet address                     │
│  • Eligibility checks with min bracket                  │
│  • Global stats                                         │
└─────────────────────────────────────────────────────────┘
```

### How It Works

1. **Sign** a message with your Bitcoin wallet (BIP-137 format)
2. **SDK recovers** your public key from the signature — no private key needed
3. **On-chain verification**: Starknet's native `secp256k1` syscall re-derives the public key and verifies the Poseidon hash matches
4. **Proof stored**: pubkey hash + bracket + timestamp — your BTC public key never touches the blockchain
5. **SBT minted**: A non-transferable Soulbound Token with your bracket level

---

## 📦 Project Structure

```
satoshi-proof/
├── contracts/          # Cairo smart contracts (Scarb 2.16)
│   ├── src/
│   │   ├── verifier.cairo        # secp256k1 ECDSA verification
│   │   ├── proof_registry.cairo  # Proof storage + Poseidon hash check
│   │   └── sbt.cairo             # Soulbound Token (ERC721-like, non-transferable)
│   └── tests/                    # 9/9 Cairo tests passing
├── sdk/                # TypeScript SDK
│   └── src/
│       ├── bitcoin.ts            # BIP-137 parsing, key recovery, Poseidon hash
│       └── e2e-test.ts           # Full end-to-end test (sign → on-chain → API)
├── frontend/           # React + Vite frontend
│   ├── src/pages/
│   │   ├── Prove.tsx             # Submit BTC ownership proof
│   │   └── Verify.tsx            # Check any address + API docs
│   └── api/                      # Vercel serverless functions
│       ├── proof.ts              # GET /api/proof?address=0x...
│       ├── check.ts              # GET /api/check?address=0x...&minBracket=2
│       └── stats.ts              # GET /api/stats
└── README.md
```

---

## 🦐🦀🐟🦈🐋 Bracket System

Your BTC balance maps to a bracket tier, stored as an on-chain credential:

| Bracket | Tier     | BTC Range   | Emoji |
|---------|----------|-------------|-------|
| 0       | Shrimp   | 0 – 1       | 🦐    |
| 1       | Crab     | 1 – 10      | 🦀    |
| 2       | Fish     | 10 – 50     | 🐟    |
| 3       | Shark    | 50 – 100    | 🦈    |
| 4       | Whale    | 100+        | 🐋    |

Brackets are intentionally coarse — you prove you're a "whale" without revealing whether you hold 100 or 10,000 BTC.

---

## 🌐 REST API

The API is live at `https://satoshi-proof.vercel.app/api/` and reads directly from the on-chain registry.

### `GET /api/proof?address=0x...`

Returns full proof details for a Starknet address.

```json
{
  "address": "0x044e59e...",
  "hasProof": true,
  "bracket": { "id": 0, "name": "Shrimp", "emoji": "🦐", "description": "0-1 BTC" },
  "proofTimestamp": 1772561892,
  "proofDate": "2026-03-03T18:18:12.000Z",
  "pubkeyHash": "0x2c57d427...",
  "stats": { "totalProofs": 1 },
  "contract": "0x067c5e7c...",
  "network": "starknet-sepolia"
}
```

### `GET /api/check?address=0x...&minBracket=2`

Quick boolean eligibility check. Perfect for gating access.

```json
{
  "address": "0x044e59e...",
  "eligible": false,
  "requiredBracket": 2,
  "actualBracket": 0
}
```

### `GET /api/stats`

Global statistics.

```json
{
  "totalProofs": 1,
  "contract": "0x067c5e7c...",
  "network": "starknet-sepolia"
}
```

---

## 🔌 API Use Cases

Satoshi Proof's API enables any protocol to leverage verified Bitcoin ownership as a primitive:

### 1. 🪂 Airdrop Eligibility Gate
Filter airdrop recipients by BTC bracket. Call `/api/check?address=0x...&minBracket=3` to ensure only Shark+ holders (50+ BTC) qualify. Prevents sybil farming — you can't fake a BTC signature.

### 2. 🏛️ DAO Weighted Voting
Weight governance votes by Bitcoin tier. Whale = 5 votes, Shrimp = 1 vote. The SBT is non-transferable, so voting power can't be bought or sold.

### 3. 🔐 Token-Gated Communities
Build a Discord/Telegram bot that calls `/api/check` to gate channels to verified BTC holders. Like Collab.Land, but cross-chain (Bitcoin → Starknet).

### 4. 💰 Tiered Fee Structures
DEXs or DeFi protocols can offer reduced fees to proven Bitcoin whales. `/api/proof` returns the bracket — use it for VIP tier assignment.

### 5. 🎮 NFT Mint Whitelists
Gate NFT mints to BTC OGs. No wallet spoofing — the proof requires signing with the actual Bitcoin private key.

### 6. 📊 Proof of Reserves (Lite)
Small OTC desks or fund managers can prove BTC holdings to clients without revealing exact amounts. The bracket system provides range-based attestation.

### 7. 🌉 Cross-Chain Identity
Use BTC ownership as an identity signal in Starknet dApps. A user with a Whale SBT carries more credibility than an anonymous wallet.

### 8. 🛡️ Anti-Sybil Layer
Add BTC proof as a requirement for governance participation. Signing with a real Bitcoin key dramatically raises the cost of sybil attacks.

### 9. 📈 On-Chain Credit Scoring
Lending protocols can factor BTC bracket into credit decisions. A proven Shark (50-100 BTC) gets better terms than an unverified wallet.

### 10. 🏆 Reputation Systems
Stack Satoshi Proof SBTs with other credentials (ENS, POAPs, etc.) to build comprehensive on-chain reputation that spans Bitcoin and Starknet.

---

## 🚀 Deployed Contracts (Starknet Sepolia)

| Contract | Address |
|----------|---------|
| **ProofRegistry** | [`0x067c5e7cb777848f97d7f2eeaffe011fa1086390f1eb713277fc6311fe0d7f11`](https://sepolia.voyager.online/contract/0x067c5e7cb777848f97d7f2eeaffe011fa1086390f1eb713277fc6311fe0d7f11) |
| **SatoshiSBT** | [`0x0797278852c9a390b4a4e37b7eaf3aa5e34956447ec2cdf73c746888407cd86a`](https://sepolia.voyager.online/contract/0x0797278852c9a390b4a4e37b7eaf3aa5e34956447ec2cdf73c746888407cd86a) |
| **BitcoinVerifier** (class) | `0x1d01e37e7d3a46812588aa263d9df61ea795a9142dbcdd34876e8f7c08c2ab3` |

**E2E Test TX:** [View on Voyager](https://sepolia.voyager.online/tx/0x60a1cd0ed0a629a8db0cc4279157ee91855320a4dac6052d6a4cee5d71f7723)

---

## 🛠️ Development

### Prerequisites

- [Scarb](https://docs.swmansion.com/scarb/) 2.16+ (Cairo package manager)
- [snFoundry](https://foundry-rs.github.io/starknet-foundry/) 0.50+ (testing & deployment)
- Node.js 18+
- A Starknet wallet (Argent X or Braavos)

### Contracts

```bash
cd contracts

# Run tests (9/9 passing)
snforge test

# Build
scarb build

# Deploy (requires funded Starknet Sepolia account)
sncast --account <name> deploy --url https://api.cartridge.gg/x/starknet/sepolia --class-hash <hash>
```

### SDK

```bash
cd sdk
npm install

# Run E2E test (requires STARKNET_PRIVATE_KEY)
STARKNET_PRIVATE_KEY=0x... npx tsx src/e2e-test.ts
```

### Frontend

```bash
cd frontend
npm install
npm run dev       # local dev server
npm run build     # production build
```

---

## 🔒 Privacy Design

| Data | On-chain? | Details |
|------|-----------|---------|
| BTC Public Key | ❌ Never | Only Poseidon hash stored |
| BTC Address | ❌ Never | Not stored anywhere on-chain |
| BTC Balance | ❌ Never | Only bracket (range) stored |
| Signature | ❌ No | Used for verification, not stored |
| Poseidon Hash | ✅ Yes | Irreversible hash of pubkey coordinates |
| Bracket | ✅ Yes | Coarse range (e.g., 10-50 BTC) |
| Timestamp | ✅ Yes | When proof was submitted |

---

## 🧰 Tech Stack

- **Smart Contracts:** Cairo (Starknet) — native secp256k1 syscall, Poseidon hash
- **SDK:** TypeScript — `@noble/curves` for secp256k1, `starknet.js` for Poseidon
- **Frontend:** React + Vite + starknet.js wallet integration
- **API:** Vercel Serverless Functions
- **Deployment:** Starknet Sepolia testnet

---

## 📄 License

MIT

---

Built for the Starknet Hackathon 2026 🏗️
