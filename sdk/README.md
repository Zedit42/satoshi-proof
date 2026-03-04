# @satoshi-proof/sdk

**Bitcoin signature verification and proof generation SDK for Starknet**

This SDK implements BIP-137 Bitcoin signed message verification with Poseidon hashing, enabling trustless Bitcoin balance proofs on Starknet.

---

## Installation

```bash
npm install @satoshi-proof/sdk
```

```bash
yarn add @satoshi-proof/sdk
```

```bash
pnpm add @satoshi-proof/sdk
```

---

## Quick Start

```typescript
import { generateProof } from '@satoshi-proof/sdk';

// User signs a message with their Bitcoin wallet
const message = "I own this Bitcoin address";
const signature = "H8k3..."; // Base64 signature from wallet
const btcBalance = 25.5; // BTC

// Generate cryptographic proof
const proof = generateProof(message, signature, btcBalance);

console.log(proof.btcAddress);    // "1A1zP1..."
console.log(proof.bracketName);   // "fish" (10-50 BTC)
console.log(proof.pubkeyHash);    // Poseidon hash for on-chain verification
```

---

## API Reference

### `generateProof(message, signature, btcBalance)`

Generate a complete cryptographic proof from a Bitcoin signed message.

**Parameters:**
- `message` (string): The message that was signed
- `signature` (string): Base64-encoded Bitcoin signature (BIP-137 format)
- `btcBalance` (number): Bitcoin balance in BTC

**Returns:** `ProofData`

```typescript
interface ProofData {
  message: string;           // Original message
  msgHash: string;           // SHA256(SHA256(Bitcoin message format))
  sigR: string;              // ECDSA signature r component (hex)
  sigS: string;              // ECDSA signature s component (hex)
  yParity: boolean;          // Public key y-coordinate parity
  pubkeyX: string;           // Recovered public key x-coordinate (hex)
  pubkeyY: string;           // Recovered public key y-coordinate (hex)
  pubkeyHash: string;        // Poseidon hash of pubkey (for Starknet)
  btcAddress: string;        // Derived P2PKH Bitcoin address
  bracket: number;           // Bracket ID (0-4)
  bracketName: string;       // 'shrimp' | 'crab' | 'fish' | 'shark' | 'whale'
  bracketEmoji: string;      // 🦐 | 🦀 | 🐟 | 🦈 | 🐋
}
```

---

### `getBracket(btcBalance)`

Determine the balance bracket based on BTC amount.

**Parameters:**
- `btcBalance` (number): Bitcoin balance in BTC

**Returns:** Bracket object

```typescript
type Bracket = {
  name: 'shrimp' | 'crab' | 'fish' | 'shark' | 'whale';
  min: number;
  max: number;
  id: number;
  emoji: string;
};

// Bracket ranges:
// 🦐 shrimp: 0-1 BTC
// 🦀 crab: 1-10 BTC
// 🐟 fish: 10-50 BTC
// 🦈 shark: 50-100 BTC
// 🐋 whale: 100+ BTC
```

---

### `parseSignature(base64Sig)`

Parse a base64 Bitcoin signature into its cryptographic components.

**Parameters:**
- `base64Sig` (string): Base64-encoded signature

**Returns:** `ParsedSignature`

```typescript
interface ParsedSignature {
  r: bigint;              // ECDSA r component
  s: bigint;              // ECDSA s component
  recoveryFlag: number;   // 0 or 1 (for pubkey recovery)
  yParity: boolean;       // true if y-coordinate is odd
}
```

---

### `recoverPublicKey(msgHash, sig)`

Recover the secp256k1 public key from a message hash and signature.

**Parameters:**
- `msgHash` (Uint8Array): Bitcoin message hash (from `bitcoinMessageHash()`)
- `sig` (ParsedSignature): Parsed signature

**Returns:**

```typescript
{
  x: bigint;                    // Public key x-coordinate
  y: bigint;                    // Public key y-coordinate
  compressed: Uint8Array;       // Compressed pubkey (33 bytes)
  uncompressed: Uint8Array;     // Uncompressed pubkey (65 bytes)
}
```

---

### `pubkeyToPoseidonHash(x, y)`

Compute the Poseidon hash of a public key for Starknet on-chain verification.

**Parameters:**
- `x` (bigint): Public key x-coordinate
- `y` (bigint): Public key y-coordinate

**Returns:** Poseidon hash (hex string)

This matches the Cairo contract implementation:
```cairo
PoseidonTrait::new()
  .update(x.low).update(x.high)
  .update(y.low).update(y.high)
  .finalize()
```

---

### `bitcoinMessageHash(message)`

Compute the Bitcoin message hash following BIP-137 format.

**Parameters:**
- `message` (string): The message to hash

**Returns:** `Uint8Array` (32 bytes)

**Format:**
```
SHA256(SHA256("\x18Bitcoin Signed Message:\n" + varint(len) + message))
```

---

### `pubkeyToP2PKH(compressedPubkey, testnet?)`

Derive a P2PKH Bitcoin address from a compressed public key.

**Parameters:**
- `compressedPubkey` (Uint8Array): 33-byte compressed public key
- `testnet` (boolean, optional): Use testnet version byte (default: false)

**Returns:** Bitcoin address (string)

---

## Code Examples

### Example 1: Verify a Bitcoin signature

```typescript
import { 
  bitcoinMessageHash, 
  parseSignature, 
  recoverPublicKey, 
  pubkeyToP2PKH 
} from '@satoshi-proof/sdk';

const message = "Prove I own this address";
const signature = "H8k3Qn..."; // From Bitcoin wallet

// Step 1: Hash the message
const msgHash = bitcoinMessageHash(message);

// Step 2: Parse the signature
const sig = parseSignature(signature);

// Step 3: Recover the public key
const pubkey = recoverPublicKey(msgHash, sig);

// Step 4: Derive the Bitcoin address
const address = pubkeyToP2PKH(pubkey.compressed);

console.log(`Signer address: ${address}`);
```

---

### Example 2: Generate proof for Starknet contract

```typescript
import { generateProof } from '@satoshi-proof/sdk';

async function submitProof(message: string, signature: string, btcBalance: number) {
  // Generate proof
  const proof = generateProof(message, signature, btcBalance);
  
  // Call Starknet contract
  const tx = await contract.verify_signature({
    msg_hash: proof.msgHash,
    r: proof.sigR,
    s: proof.sigS,
    y_parity: proof.yParity,
    expected_pubkey_hash: proof.pubkeyHash,
    bracket: proof.bracket
  });
  
  console.log(`Proof submitted for ${proof.btcAddress}`);
  console.log(`Bracket: ${proof.bracketEmoji} ${proof.bracketName}`);
  
  return tx;
}
```

---

### Example 3: Batch verify multiple signatures

```typescript
import { generateProof, getBracket, BRACKETS } from '@satoshi-proof/sdk';

interface User {
  message: string;
  signature: string;
  balance: number;
}

function processBatch(users: User[]) {
  const results = users.map(user => {
    try {
      const proof = generateProof(user.message, user.signature, user.balance);
      
      return {
        address: proof.btcAddress,
        bracket: proof.bracketName,
        pubkeyHash: proof.pubkeyHash,
        valid: true
      };
    } catch (error) {
      return {
        address: null,
        bracket: null,
        pubkeyHash: null,
        valid: false,
        error: error.message
      };
    }
  });
  
  // Group by bracket
  const byBracket = BRACKETS.map(bracket => ({
    ...bracket,
    count: results.filter(r => r.bracket === bracket.name).length
  }));
  
  console.log('Distribution:', byBracket);
  
  return results;
}
```

---

## Technical Details

### BIP-137 Bitcoin Signed Message Format

The SDK implements the standard Bitcoin message signing format:

1. **Message prefix**: `\x18Bitcoin Signed Message:\n`
2. **Length encoding**: Compact size varint
3. **Double SHA-256**: Hash the concatenated data twice
4. **Signature format**: 65 bytes (1 header byte + 32 bytes r + 32 bytes s)

### Signature Header Bytes

- **27-30**: Uncompressed public key
- **31-34**: Compressed public key
- **35-38**: Segwit P2SH-P2WPKH
- **39-42**: Segwit Bech32

Recovery flag = `(header - base) % 4`, where `base` is 27, 31, 35, or 39.

### Poseidon Hashing for Starknet

Public keys are hashed using Poseidon (Starknet's native hash function) by splitting each coordinate into 128-bit low/high components:

```
hash = Poseidon(x_low, x_high, y_low, y_high)
```

This allows efficient on-chain verification without storing full public keys.

---

## Dependencies

- `@noble/curves` - secp256k1 cryptography
- `@noble/hashes` - SHA-256, RIPEMD-160
- `starknet` - Poseidon hashing

All dependencies are audited and widely used in production crypto applications.

---

## License

MIT

---

## Contributing

Issues and PRs welcome at [github.com/yourusername/satoshi-proof](https://github.com/yourusername/satoshi-proof)

---

## Security

This SDK handles cryptographic operations. Always:
- ✅ Verify signatures client-side before submitting to chain
- ✅ Use official Bitcoin wallets for signing
- ✅ Never share private keys
- ✅ Audit contract code before mainnet deployment

For security issues, please email: security@yourproject.com
