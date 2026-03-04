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
│  Bitcoin Wallet (Xverse, Unisat, Electrum, Sparrow)     │
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
│  • Encrypt BTC address (AES-256-GCM, server-side)       │
└────────────────┬────────────────────────────────────────┘
                 │ (msg_hash, r, s, y_parity, pubkey_hash, bracket, encrypted_addr)
                 ▼
┌─────────────────────────────────────────────────────────┐
│  Starknet Contracts                                      │
│  • secp256k1 ECDSA recovery via native syscall          │
│  • Poseidon hash verification (no raw pubkey stored)    │
│  • Encrypted BTC address stored on-chain (ByteArray)    │
│  • Replay protection (used_msg_hashes)                  │
│  • App-controlled expiry (has_valid_proof_with_age)      │
│  • SBT minting with bracket metadata                    │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  REST API (Vercel Serverless)                            │
│  • Query proofs by Starknet address                     │
│  • App-controlled freshness (?max_age=30d)              │
│  • Live BTC balance lookup (?include_balance=true)      │
│  • Server-side encryption endpoint                      │
│  • Eligibility checks with min bracket                  │
│  • Global stats                                         │
└─────────────────────────────────────────────────────────┘
```

### How It Works

1. **Sign** a message with your Bitcoin wallet (BIP-137 format)
2. **SDK recovers** your public key from the signature — no private key needed
3. **BTC address encrypted** server-side (AES-256-GCM) and stored on-chain — only the API can decrypt it
4. **On-chain verification**: Starknet's native `secp256k1` syscall re-derives the public key and verifies the Poseidon hash matches
5. **Proof stored permanently**: pubkey hash + bracket + timestamp + encrypted address
6. **SBT minted**: A non-transferable Soulbound Token with your bracket level
7. **Apps query freshness & live balance** via API — user proves once, apps set their own rules

---

## 📦 Project Structure

```
satoshi-proof/
├── contracts/          # Cairo smart contracts (Scarb 2.16)
│   ├── src/
│   │   ├── verifier.cairo        # secp256k1 ECDSA verification
│   │   ├── proof_registry.cairo  # Proof storage + Poseidon hash + encrypted addr + expiry
│   │   └── sbt.cairo             # Soulbound Token (ERC721-like, non-transferable)
│   └── tests/                    # Cairo tests
├── sdk/                # TypeScript SDK
│   └── src/
│       ├── bitcoin.ts            # BIP-137 parsing, key recovery, Poseidon hash
│       └── e2e-test.ts           # Full end-to-end test
├── frontend/           # React + Vite frontend
│   ├── src/pages/
│   │   ├── Prove.tsx             # Submit BTC ownership proof (Xverse/Unisat/manual)
│   │   └── Verify.tsx            # Check any address + API docs
│   └── api/                      # Vercel serverless functions
│       ├── proof.ts              # GET /api/proof — full proof + live balance
│       ├── check.ts              # GET /api/check — quick eligibility
│       ├── stats.ts              # GET /api/stats — global stats
│       ├── encrypt-address.ts    # POST /api/encrypt-address — server-side encryption
│       └── verify-bracket.ts     # Bracket verification
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

**Optional parameters:**
- `max_age=30d` — Reject proofs older than N days (app-controlled expiry)
- `include_balance=true` — Fetch live BTC balance from Blockstream (decrypts on-chain address)

```json
{
  "address": "0x044e59e...",
  "hasProof": true,
  "bracket": { "id": 4, "name": "Whale", "emoji": "🐋", "description": "100+ BTC" },
  "proofTimestamp": 1772561892,
  "proofDate": "2026-03-03T18:18:12.000Z",
  "proofAgeDays": 1,
  "expired": false,
  "pubkeyHash": "0x2c57d427...",
  "liveBalance": {
    "btc": 142.5,
    "currentBracket": { "id": 4, "name": "Whale", "emoji": "🐋" },
    "bracketChanged": false,
    "fetchedAt": "2026-03-04T07:30:00.000Z"
  },
  "stats": { "totalProofs": 42 },
  "contract": "0x0490029d...",
  "network": "starknet-sepolia"
}
```

**Expiry example:** If a proof is 45 days old and you request `?max_age=30d`:
```json
{
  "hasProof": true,
  "expired": true,
  "proofAgeDays": 45,
  "message": "Proof exists but is older than 30d. User should re-prove."
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
  "totalProofs": 42,
  "contract": "0x0490029d...",
  "network": "starknet-sepolia"
}
```

### `POST /api/encrypt-address`

Server-side BTC address encryption (used by frontend during proof submission).

```json
// Request
{ "btcAddress": "bc1q..." }

// Response
{ "encrypted": "base64-encoded-ciphertext" }
```

---

## ⏰ App-Controlled Expiry

Proofs are **permanent on-chain** — users prove once and don't need to re-submit. However, applications can enforce their own freshness requirements:

### Via API
```
GET /api/proof?address=0x...&max_age=30d    # Default: 30 days
GET /api/proof?address=0x...&max_age=7d     # Strict: 7 days
GET /api/proof?address=0x...                # No limit
```

### Via Smart Contract
```cairo
// No age limit — any valid proof
has_valid_proof(owner, min_bracket)

// With age limit — proof must be < 30 days old (2,592,000 seconds)
has_valid_proof_with_age(owner, min_bracket, 2592000)
```

This lets each app decide its own policy without burdening users.

---

## 🔐 Encrypted Balance Lookup

BTC addresses are stored on-chain in **encrypted form** (AES-256-GCM). Only the API server holds the decryption key.

**Flow:**
1. User submits proof → frontend calls `/api/encrypt-address` (key never leaves server)
2. Encrypted blob stored on-chain as `ByteArray`
3. App calls `GET /api/proof?include_balance=true`
4. API reads encrypted blob from chain → decrypts → fetches live balance from Blockstream
5. Returns current BTC amount + whether bracket has changed

**Why?** Users prove once, but apps can always check their **current** balance. If a "Whale" sells down to 5 BTC, `bracketChanged: true` flags it.

---

## 🔌 API Use Cases

### 1. 🪂 Airdrop Eligibility Gate
Filter recipients by BTC bracket. `/api/check?minBracket=3` → only Shark+ (50+ BTC).

### 2. 🏛️ DAO Weighted Voting
Weight governance votes by tier. Whale = 5 votes, Shrimp = 1. SBT is non-transferable.

### 3. 🔐 Token-Gated Communities
Discord/Telegram bot calls `/api/check` to gate channels to verified BTC holders.

### 4. 💰 Tiered Fee Structures
DEXs offer reduced fees to proven whales via `/api/proof` bracket lookup.

### 5. 🎮 NFT Mint Whitelists
Gate mints to BTC OGs — proof requires signing with actual Bitcoin private key.

### 6. 📊 Proof of Reserves (Lite)
OTC desks prove BTC holdings without revealing exact amounts. `include_balance=true` for real-time verification.

### 7. 🌉 Cross-Chain Identity
BTC ownership as identity signal in Starknet dApps.

### 8. 🛡️ Anti-Sybil Layer
BTC proof as governance requirement — signing with a real key raises sybil cost dramatically.

### 9. 📈 On-Chain Credit Scoring
Lending protocols factor BTC bracket into credit decisions + live balance for real-time risk.

### 10. 🏆 Reputation Systems
Stack Satoshi Proof SBTs with ENS, POAPs for cross-chain reputation.

---

## 🚀 Deployed Contracts (Starknet Sepolia)

| Contract | Address |
|----------|---------|
| **ProofRegistry** | [`0x0490029d0c2007f40a39eac70e5c728351568770248a6f29cfa42b7d9ce32c75`](https://sepolia.voyager.online/contract/0x0490029d0c2007f40a39eac70e5c728351568770248a6f29cfa42b7d9ce32c75) |
| **SatoshiSBT** | [`0x0797278852c9a390b4a4e37b7eaf3aa5e34956447ec2cdf73c746888407cd86a`](https://sepolia.voyager.online/contract/0x0797278852c9a390b4a4e37b7eaf3aa5e34956447ec2cdf73c746888407cd86a) |
| **BitcoinVerifier** (class) | `0x1d01e37e7d3a46812588aa263d9df61ea795a9142dbcdd34876e8f7c08c2ab3` |

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

# Run tests
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

### Environment Variables

| Variable | Where | Description |
|----------|-------|-------------|
| `SATOSHI_PROOF_ENCRYPTION_KEY` | Vercel (server) | 32-byte hex AES key for BTC address encryption |
| `STARKNET_PRIVATE_KEY` | Local/CI | For E2E tests and deployment |

---

## 🔒 Privacy Design

| Data | On-chain? | Details |
|------|-----------|---------|
| BTC Public Key | ❌ Never | Only Poseidon hash stored |
| BTC Address | 🔐 Encrypted | AES-256-GCM, only API can decrypt |
| BTC Balance | ❌ Never | Only bracket (range) stored; live balance via API |
| Signature | ❌ No | Used for verification, not stored |
| Poseidon Hash | ✅ Yes | Irreversible hash of pubkey coordinates |
| Bracket | ✅ Yes | Coarse range (e.g., 10-50 BTC) |
| Timestamp | ✅ Yes | When proof was submitted |

---

## 🔑 Security Features

- **Replay Protection**: Each signature can only be used once (`used_msg_hashes` mapping)
- **Poseidon Hash**: Public key never stored raw — only irreversible Poseidon hash
- **Encrypted Address**: BTC address stored with AES-256-GCM; encryption key only on server
- **Server-Side Encryption**: Key never touches the browser — `/api/encrypt-address` endpoint
- **Non-Transferable SBT**: Proof can't be sold or transferred

---

## 🧰 Tech Stack

- **Smart Contracts:** Cairo (Starknet) — native secp256k1 syscall, Poseidon hash
- **SDK:** TypeScript — `@noble/curves` for secp256k1, `starknet.js` for Poseidon
- **Frontend:** React + Vite + starknet.js + Xverse/Unisat wallet integration
- **API:** Vercel Serverless Functions
- **Encryption:** AES-256-GCM (server-side)
- **Balance Oracle:** Blockstream API (live BTC balance)
- **Deployment:** Starknet Sepolia testnet

---

## 📄 License

MIT

---

Built for the Starknet Hackathon 2026 🏗️
