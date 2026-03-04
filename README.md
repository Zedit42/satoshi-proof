# ₿ Satoshi Proof — ZK Bitcoin Ownership on Starknet

**Prove you own Bitcoin without revealing your public key or address.**

Satoshi Proof lets Bitcoin holders cryptographically prove their BTC ownership on Starknet using BIP-137 message signatures and Starknet's native secp256k1 verification. Your Bitcoin public key is never stored on-chain — only a salted Poseidon hash, preserving privacy.

🔗 **Live App:** [satoshi-proof.vercel.app](https://satoshi-proof.vercel.app)  
📦 **SDK:** [`npm install satoshi-proof-sdk`](https://www.npmjs.com/package/satoshi-proof-sdk)  
📜 **Contracts:** Starknet Sepolia  
🔬 **E2E Tested:** Signature → On-chain → API — fully verified

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Bitcoin Wallet (Xverse, Unisat, Electrum, Sparrow)     │
│  Signs message with BIP-137                             │
│  Supports: P2PKH, P2WPKH (SegWit), P2SH-P2WPKH        │
└────────────────┬────────────────────────────────────────┘
                 │ base64 signature
                 ▼
┌─────────────────────────────────────────────────────────┐
│  SDK / Frontend                                          │
│  • Parse BIP-137 signature (all address types)          │
│  • Recover secp256k1 public key                         │
│  • Compute salted Poseidon hash (rainbow table proof)   │
│  • Determine BTC bracket (🦐🦀🐟🦈🐋)                   │
│  • Encrypt BTC address (AES-256-GCM, server-side)       │
│  • Verify bracket via API before submission             │
└────────────────┬────────────────────────────────────────┘
                 │ (msg_hash, r, s, y_parity, salted_hash, salt, bracket, encrypted_addr)
                 ▼
┌─────────────────────────────────────────────────────────┐
│  Starknet Contract (OwnableTwoStep)                      │
│  • secp256k1 ECDSA recovery via native syscall          │
│  • Salted Poseidon hash verification                    │
│  • Encrypted BTC address stored on-chain (ByteArray)    │
│  • Replay protection (used_msg_hashes)                  │
│  • App-controlled expiry (has_valid_proof_with_age)      │
│  • Owner: pause/unpause, admin revoke                   │
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
│  • Bracket verification endpoint                        │
│  • Rate limiting (30 req/min per IP)                    │
│  • Eligibility checks + global stats                    │
└─────────────────────────────────────────────────────────┘
```

### How It Works

1. **Sign** a message with your Bitcoin wallet (BIP-137 — supports legacy, SegWit, and wrapped SegWit)
2. **SDK recovers** your public key from the signature — no private key needed
3. **Bracket verified** against live Blockstream balance before submission
4. **BTC address encrypted** server-side (AES-256-GCM) and stored on-chain — only the API can decrypt
5. **On-chain verification**: Starknet's native `secp256k1` syscall re-derives the public key and verifies the salted Poseidon hash
6. **Proof stored permanently**: salted pubkey hash + bracket + timestamp + encrypted address
7. **SBT minted**: A non-transferable Soulbound Token with your bracket level
8. **Apps query freshness & live balance** via API — user proves once, apps set their own rules

---

## 📦 SDK — `satoshi-proof-sdk`

```bash
npm install satoshi-proof-sdk
```

```typescript
import {
  generateProof,
  getBracket,
  pubkeyToAllAddresses,
  pubkeyToPoseidonHash,
  generateSalt,
  BRACKETS,
} from 'satoshi-proof-sdk';

// Generate a complete proof from a signed message
const proof = generateProof(message, base64Signature, btcBalance);

// Get all address formats from a recovered pubkey
const addresses = pubkeyToAllAddresses(compressedPubkey);
// → { p2pkh: "1...", p2wpkh: "bc1q...", p2shP2wpkh: "3..." }

// Salted Poseidon hash for privacy
const salt = generateSalt();
const hash = pubkeyToPoseidonHash(pubkey.x, pubkey.y, salt);
```

---

## 📁 Project Structure

```
satoshi-proof/
├── contracts/          # Cairo smart contracts (Scarb 2.16)
│   ├── src/
│   │   ├── proof_registry.cairo  # Proof storage + salted Poseidon + access control
│   │   ├── verifier.cairo        # secp256k1 ECDSA verification
│   │   └── sbt.cairo             # Soulbound Token (ERC721-like, non-transferable)
│   └── tests/                    # Cairo tests
├── sdk/                # TypeScript SDK (published on npm)
│   └── src/
│       ├── bitcoin.ts            # BIP-137, key recovery, multi-address, Poseidon
│       └── index.ts              # Public API exports
├── frontend/           # React + Vite frontend
│   ├── src/
│   │   ├── pages/Prove.tsx       # Submit proof (Xverse/Unisat/manual)
│   │   ├── pages/Verify.tsx      # Check any address + API docs
│   │   ├── crypto/bitcoin.ts     # Frontend crypto (mirrors SDK)
│   │   └── wallets/              # Xverse + Unisat integrations
│   └── api/                      # Vercel serverless functions
│       ├── proof.ts              # GET — full proof + live balance
│       ├── check.ts              # GET — quick eligibility
│       ├── stats.ts              # GET — global stats
│       ├── verify-bracket.ts     # GET — bracket balance verification
│       ├── encrypt-address.ts    # POST — server-side AES encryption
│       └── _rateLimit.ts         # Rate limiting middleware
└── README.md
```

---

## 🦐🦀🐟🦈🐋 Bracket System

| Bracket | Tier     | BTC Range   | Emoji |
|---------|----------|-------------|-------|
| 0       | Shrimp   | 0 – 1       | 🦐    |
| 1       | Crab     | 1 – 10      | 🦀    |
| 2       | Fish     | 10 – 50     | 🐟    |
| 3       | Shark    | 50 – 100    | 🦈    |
| 4       | Whale    | 100+        | 🐋    |

Brackets are intentionally coarse — you prove you're a "whale" without revealing whether you hold 100 or 10,000 BTC. Bracket claims are **verified against live Blockstream balance** before on-chain submission.

---

## 🌐 REST API

Live at `https://satoshi-proof.vercel.app/api/` — all endpoints rate-limited to 30 req/min per IP.

### `GET /api/proof?address=0x...`

Full proof details. Optional params:
- `max_age=30d` — Reject proofs older than N days
- `include_balance=true` — Decrypt on-chain address + fetch live BTC balance

```json
{
  "address": "0x044e59e...",
  "hasProof": true,
  "bracket": { "id": 4, "name": "Whale", "emoji": "🐋", "description": "100+ BTC" },
  "proofTimestamp": 1772561892,
  "proofDate": "2026-03-03T18:18:12.000Z",
  "proofAgeDays": 1,
  "expired": false,
  "liveBalance": {
    "btc": 142.5,
    "currentBracket": { "id": 4, "name": "Whale", "emoji": "🐋" },
    "bracketChanged": false,
    "fetchedAt": "2026-03-04T07:30:00.000Z"
  },
  "pubkeyHash": "0x2c57d427...",
  "stats": { "totalProofs": 42 }
}
```

### `GET /api/check?address=0x...&minBracket=2`

Quick boolean eligibility check.

```json
{ "address": "0x044e59e...", "eligible": false, "requiredBracket": 2, "actualBracket": 0 }
```

### `GET /api/verify-bracket?btcAddress=1A1z...&claimedBracket=4`

Verify a bracket claim against live balance (no balance revealed in response).

```json
{ "valid": true, "actualBracket": 4 }
```

### `GET /api/stats`

```json
{ "totalProofs": 42, "contracts": { "registry": "0x049...", "sbt": "0x079..." }, "network": "starknet-sepolia" }
```

### `POST /api/encrypt-address`

Server-side AES-256-GCM encryption (used by frontend during proof submission).

```json
// Request
{ "btcAddress": "bc1q..." }
// Response
{ "encrypted": "base64-encoded-ciphertext" }
```

---

## ⏰ App-Controlled Expiry

Proofs are **permanent on-chain**. Applications enforce their own freshness:

```
GET /api/proof?address=0x...&max_age=30d    # 30 day freshness
GET /api/proof?address=0x...&max_age=7d     # 7 day freshness
GET /api/proof?address=0x...                # No limit
```

On-chain (for other contracts):
```cairo
has_valid_proof(owner, min_bracket)                        // No age limit
has_valid_proof_with_age(owner, min_bracket, 2592000)      // 30 days max
```

---

## 🔐 Encrypted Balance Lookup

BTC addresses are stored on-chain **encrypted** (AES-256-GCM). Only the API server holds the decryption key.

1. User submits proof → frontend calls `/api/encrypt-address` (key never leaves server)
2. Encrypted blob stored on-chain as `ByteArray`
3. App calls `GET /api/proof?include_balance=true`
4. API decrypts → fetches live balance from Blockstream
5. Returns current BTC amount + `bracketChanged` flag

---

## 🔑 Security

| Feature | Details |
|---------|---------|
| **Replay Protection** | Each signature used only once (`used_msg_hashes`) |
| **Salted Poseidon Hash** | Random salt per proof — prevents rainbow table attacks |
| **Encrypted Address** | AES-256-GCM; key only on server, never in browser |
| **Bracket Verification** | Live Blockstream check before on-chain submission |
| **Access Control** | OwnableTwoStep — owner can pause/unpause/admin-revoke |
| **Rate Limiting** | 30 req/min per IP on all API endpoints |
| **Non-Transferable SBT** | Proof can't be sold or transferred |

---

## 🔒 Privacy

| Data | On-chain? | Details |
|------|-----------|---------|
| BTC Public Key | ❌ Never | Only salted Poseidon hash stored |
| BTC Address | 🔐 Encrypted | AES-256-GCM, only API can decrypt |
| BTC Balance | ❌ Never | Only bracket stored; live balance via API |
| Signature | ❌ No | Used for verification, not stored |
| Poseidon Hash + Salt | ✅ Yes | Irreversible, rainbow-table resistant |
| Bracket | ✅ Yes | Coarse range (e.g., 10-50 BTC) |
| Timestamp | ✅ Yes | When proof was submitted |

---

## 💼 Multi-Wallet Support

All major Bitcoin address formats supported:

| Format | Prefix | Example |
|--------|--------|---------|
| P2PKH (Legacy) | `1...` | `1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa` |
| P2WPKH (Native SegWit) | `bc1q...` | `bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4` |
| P2SH-P2WPKH (Wrapped SegWit) | `3...` | `3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy` |

**Supported wallets:** Xverse, Unisat, Electrum, Sparrow, and any BIP-137 compatible wallet.

---

## 🔌 API Use Cases

1. **🪂 Airdrop Gate** — `/api/check?minBracket=3` → only Shark+ (50+ BTC)
2. **🏛️ DAO Weighted Voting** — Whale = 5 votes, Shrimp = 1
3. **🔐 Token-Gated Communities** — Bot calls `/api/check` for Discord/Telegram
4. **💰 Tiered Fees** — DEXs offer reduced fees to proven whales
5. **🎮 NFT Mint Whitelists** — Gate to BTC OGs
6. **📊 Proof of Reserves** — Range-based attestation for OTC desks
7. **🌉 Cross-Chain Identity** — BTC ownership as Starknet identity signal
8. **🛡️ Anti-Sybil** — Real BTC key signing raises sybil cost dramatically
9. **📈 Credit Scoring** — Factor bracket + live balance into lending decisions
10. **🏆 Reputation** — Stack with ENS, POAPs for cross-chain reputation

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
- [Scarb](https://docs.swmansion.com/scarb/) 2.16+ (Cairo)
- [snFoundry](https://foundry-rs.github.io/starknet-foundry/) 0.50+ (testing)
- Node.js 18+
- Starknet wallet (Argent X or Braavos)

### Contracts
```bash
cd contracts
snforge test     # Run tests
scarb build      # Build
```

### SDK
```bash
cd sdk
npm install && npm run build
```

### Frontend
```bash
cd frontend
npm install
npm run dev      # Local dev
npm run build    # Production
```

### Environment Variables

| Variable | Where | Description |
|----------|-------|-------------|
| `SATOSHI_PROOF_ENCRYPTION_KEY` | Vercel (server only) | 32-byte hex AES key |
| `STARKNET_PRIVATE_KEY` | Local/CI | For E2E tests and deployment |

---

## 🧰 Tech Stack

- **Smart Contracts:** Cairo — native secp256k1 syscall, Poseidon hash, OpenZeppelin access control
- **SDK:** TypeScript — `@noble/curves`, `starknet.js`, bech32 encoding
- **Frontend:** React + Vite + Xverse/Unisat wallet integration
- **API:** Vercel Serverless — rate-limited, encrypted balance lookup
- **Encryption:** AES-256-GCM (server-side only)
- **Balance Oracle:** Blockstream API

---

## 📄 License

MIT

---

Built for the Starknet Hackathon 2026 🏗️
