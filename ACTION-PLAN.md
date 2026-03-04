# 🚀 Satoshi Proof — Acil Geliştirme İşlem Raporu

**Tarih:** 4 Mart 2026  
**Hedef:** Bugün tamamlanacak kritik geliştirmeler  
**Öncelik:** Güvenlik → Fonksiyon → DX

---

## 🔴 TASK 1: Signature Replay Koruması
**Risk:** KRİTİK | **Süre:** ~2 saat | **Dosyalar:** 4

### Problem
Aynı BIP-137 imzası farklı chain'lerde veya farklı contract'larda tekrar kullanılabilir. Mesaj formatı chain-agnostic olduğu için bir Starknet Sepolia'da kullanılan imza, mainnet'te de geçerli.

### Çözüm

**A. Contract'a `used_msg_hashes` mapping ekle:**

```cairo
// proof_registry.cairo - Storage'a ekle:
used_msg_hashes: Map<u256, bool>,  // replay protection

// register_proof() içine ekle (en başa):
assert!(!self.used_msg_hashes.read(msg_hash), "Signature already used");
self.used_msg_hashes.write(msg_hash, true);
```

**B. Mesaja chain binding ekle (SDK + Frontend):**

```typescript
// Eski:
const PROOF_MESSAGE = 'Satoshi Proof: I own this Bitcoin address. Timestamp: ';

// Yeni:
const PROOF_MESSAGE = `Satoshi Proof v1 | Chain: SN_SEPOLIA | Contract: ${REGISTRY_ADDRESS} | Nonce: ${Date.now()} | `;
```

**C. Contract'ta mesaj formatı doğrulama (opsiyonel ama önerilir):**
- Contract'a `chain_id` storage ekle, constructor'da set et
- Register sırasında chain binding kontrolü

### Dosya Değişiklikleri
| Dosya | Değişiklik |
|-------|-----------|
| `contracts/src/proof_registry.cairo` | `used_msg_hashes` map + assert ekleme |
| `sdk/src/bitcoin.ts` | Mesaj formatını güncelle |
| `frontend/src/crypto/bitcoin.ts` | Aynı mesaj formatı güncellemesi |
| `frontend/src/pages/Prove.tsx` | Mesaj template'i güncelle |

---

## 🔴 TASK 2: Bracket Doğrulama (Balance Verification)
**Risk:** KRİTİK | **Süre:** ~1.5 saat | **Dosyalar:** 3

### Problem
Kullanıcı `bracket: 4` (Whale, 100+ BTC) gönderebilir ama aslında 0 BTC'si olabilir. Contract bracket'ı doğrulamıyor, kullanıcının beyanına güveniyor.

### Kısa Vadeli Çözüm (Bugün)
Backend'de Blockstream API ile balance doğrulama. Tam trustless değil ama %99 yeterli.

**A. API endpoint'e balance verification ekle:**

```typescript
// frontend/api/verify-bracket.ts (YENİ DOSYA)
export default async function handler(req, res) {
  const { btcAddress, claimedBracket } = req.query;
  
  // Blockstream'den gerçek balance çek
  const resp = await fetch(`https://blockstream.info/api/address/${btcAddress}`);
  const data = await resp.json();
  const balance = (data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum) / 1e8;
  
  const actualBracket = getBracketId(balance);
  
  return res.json({
    valid: actualBracket >= claimedBracket,
    actualBracket,
    claimedBracket,
    balance: undefined, // privacy: balance'ı expose etme
  });
}
```

**B. Frontend'de submit öncesi doğrulama:**

```typescript
// Prove.tsx - submitProof() içine ekle:
const verifyResp = await fetch(`/api/verify-bracket?btcAddress=${btcAddress}&claimedBracket=${bracket.id}`);
const verifyData = await verifyResp.json();
if (!verifyData.valid) {
  setError(`Balance insufficient for ${bracket.name} bracket`);
  return;
}
```

### Uzun Vadeli Çözüm (Gelecek sprint)
- Herodotus storage proofs ile on-chain BTC balance doğrulama
- Veya oracle-based bracket attestation

### Dosya Değişiklikleri
| Dosya | Değişiklik |
|-------|-----------|
| `frontend/api/verify-bracket.ts` | YENİ - balance doğrulama endpoint |
| `frontend/src/pages/Prove.tsx` | Submit öncesi verification call |
| `frontend/vercel.json` | Yeni route ekleme |

---

## 🔴 TASK 3: Multi-Wallet Desteği (Xverse, Leather, Unisat)
**Risk:** KRİTİK | **Süre:** ~3 saat | **Dosyalar:** 5

### Problem
Şu an sadece BIP-137 legacy (P2PKH, 1xxx adresleri) destekleniyor. Modern cüzdanların %90+'ı Taproot (bc1p) veya SegWit (bc1q) kullanıyor. Xverse hackathon sponsoru — desteklememek ödül kaybettirir.

### Çözüm

**A. Xverse wallet connector ekle:**

```typescript
// frontend/src/wallets/xverse.ts (YENİ)
import { request } from 'sats-connect';

export async function connectXverse() {
  const response = await request('wallet_connect', null);
  if (response.status === 'success') {
    return {
      address: response.result.addresses[0].address,
      publicKey: response.result.addresses[0].publicKey,
      type: 'taproot' as const,
    };
  }
  throw new Error('Xverse connection failed');
}

export async function signWithXverse(message: string) {
  const response = await request('signMessage', {
    address: currentAddress,
    message,
    protocol: 'bip322', // Taproot uses BIP-322
  });
  return response.result.signature;
}
```

**B. BIP-322 signature parsing ekle (Taproot):**

```typescript
// sdk/src/bitcoin.ts - ek fonksiyon:
export function parseBIP322Signature(base64Sig: string): ParsedSignature {
  // BIP-322 uses witness-based signature format
  const raw = Uint8Array.from(atob(base64Sig), c => c.charCodeAt(0));
  // Parse witness stack: [signature, pubkey]
  // Schnorr signature for Taproot (64 bytes, no recovery flag)
  // ...implementation
}
```

**C. Unisat connector:**

```typescript
// frontend/src/wallets/unisat.ts (YENİ)
export async function connectUnisat() {
  const unisat = (window as any).unisat;
  if (!unisat) throw new Error('Unisat not installed');
  const accounts = await unisat.requestAccounts();
  const pubkey = await unisat.getPublicKey();
  return { address: accounts[0], publicKey: pubkey };
}

export async function signWithUnisat(message: string) {
  return await (window as any).unisat.signMessage(message);
}
```

**D. Wallet selector UI:**

```tsx
// frontend/src/components/WalletSelector.tsx (YENİ)
<div className="wallet-grid">
  <button onClick={connectXverse}>
    <img src="/xverse.svg" /> Xverse
  </button>
  <button onClick={connectUnisat}>
    <img src="/unisat.svg" /> Unisat
  </button>
  <button onClick={() => setManualMode(true)}>
    ✍️ Manual Signature
  </button>
</div>
```

### ⚠️ Cairo Contract Notu
Taproot (Schnorr) imzaları Starknet'in native secp256k1 recover syscall'ı ile DOĞRULANAMAZ. Schnorr ≠ ECDSA.

**Workaround seçenekleri:**
1. Xverse'den ECDSA (legacy) imza iste (Xverse bunu destekliyor)
2. Schnorr verifier'ı Cairo'da implement et (karmaşık, gelecek sprint)
3. Off-chain Schnorr doğrulama + on-chain attestation

**Bugün için:** Xverse/Unisat'tan legacy ECDSA imza iste, mevcut contract'la uyumlu.

### Dosya Değişiklikleri
| Dosya | Değişiklik |
|-------|-----------|
| `frontend/src/wallets/xverse.ts` | YENİ - Xverse connector |
| `frontend/src/wallets/unisat.ts` | YENİ - Unisat connector |
| `frontend/src/components/WalletSelector.tsx` | YENİ - wallet seçici UI |
| `frontend/src/pages/Prove.tsx` | Wallet selector entegrasyonu |
| `frontend/package.json` | `sats-connect` dependency |

---

## 🔴 TASK 4: npm Package Publish
**Risk:** YÜKSEK | **Süre:** ~1 saat | **Dosyalar:** 4

### Problem
SDK sadece local. Başka protokoller entegre etmek istese kodu kopyalamak zorunda.

### Çözüm

**A. Package.json hazırla:**

```json
// sdk/package.json güncelle:
{
  "name": "@satoshi-proof/sdk",
  "version": "1.0.0",
  "description": "ZK Bitcoin ownership proof SDK for Starknet",
  "main": "dist/bitcoin.js",
  "types": "dist/bitcoin.d.ts",
  "exports": {
    ".": {
      "import": "./dist/bitcoin.js",
      "types": "./dist/bitcoin.d.ts"
    }
  },
  "files": ["dist/", "README.md"],
  "keywords": ["bitcoin", "starknet", "zk", "proof", "ownership"],
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/user/satoshi-proof"
  }
}
```

**B. Build & Publish:**

```bash
cd sdk
npm run build        # tsc → dist/
npm publish --access public
```

**C. SDK README ekle:**

```markdown
## Quick Start
npm install @satoshi-proof/sdk

import { generateProof, getBracket } from '@satoshi-proof/sdk';

const proof = generateProof(message, signature, btcBalance);
console.log(proof.bracket); // 'whale'
console.log(proof.pubkeyHash); // for on-chain submission
```

### Dosya Değişiklikleri
| Dosya | Değişiklik |
|-------|-----------|
| `sdk/package.json` | npm publish metadata |
| `sdk/tsconfig.json` | declaration: true, outDir: dist |
| `sdk/README.md` | YENİ - SDK docs |
| `sdk/.npmignore` | YENİ - exclude tests |

---

## 📋 Uygulama Sırası

```
09:00  ┌─ TASK 1: Replay koruması (contract + SDK)
       │   ├─ used_msg_hashes mapping ekle
       │   ├─ Mesaj formatını güncelle (chain binding)
       │   └─ Test et (scarb test)
11:00  ├─ TASK 2: Bracket doğrulama
       │   ├─ verify-bracket API endpoint
       │   ├─ Frontend integration
       │   └─ Test et
12:30  ├─ ÖĞLE ARASI
13:00  ├─ TASK 3: Multi-wallet (Xverse + Unisat)
       │   ├─ Wallet connectors
       │   ├─ WalletSelector component
       │   ├─ Prove.tsx entegrasyonu
       │   └─ Test et (Xverse extension ile)
16:00  ├─ TASK 4: npm publish
       │   ├─ Package.json hazırla
       │   ├─ Build + publish
       │   └─ Test: npm install @satoshi-proof/sdk
17:00  └─ Deploy & Verify
           ├─ Sepolia'ya yeniden deploy (yeni contract)
           ├─ Vercel'e push
           └─ E2E test
```

---

## ⚡ Komut Satırı Referansı

```bash
# Contract build & test
cd contracts && scarb build && scarb test

# Frontend dev
cd frontend && npm run dev

# SDK build
cd sdk && npx tsc && npm publish --access public

# Deploy contract (Sepolia)
cd contracts && starkli deploy ...

# Vercel deploy
cd frontend && vercel --prod
```

---

**Bu rapor ile 4 kritik geliştirmeyi bugün bitirebiliriz. Hangisinden başlayalım?**
