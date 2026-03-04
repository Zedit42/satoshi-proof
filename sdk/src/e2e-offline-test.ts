/**
 * Satoshi Proof — Offline E2E Test (no chain interaction)
 * Tests the full SDK flow without deploying/calling contracts
 */

import { secp256k1 } from '@noble/curves/secp256k1';
import {
  bitcoinMessageHash, hashToU256Hex, parseSignature,
  recoverPublicKey, pubkeyToP2PKH, pubkeyToP2WPKH,
  pubkeyToAllAddresses, pubkeyToPoseidonHash,
  generateSalt, getBracket, generateProof, BRACKETS,
} from './bitcoin.js';

function toHex(arr: Uint8Array): string {
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

function signBitcoinMessage(message: string, privKeyBytes: Uint8Array): string {
  const msgHash = bitcoinMessageHash(message);
  const sig = secp256k1.sign(msgHash, privKeyBytes, { lowS: true });
  const header = 31 + sig.recovery;
  const rHex = sig.r.toString(16).padStart(64, '0');
  const sHex = sig.s.toString(16).padStart(64, '0');
  const raw = new Uint8Array(65);
  raw[0] = header;
  for (let i = 0; i < 32; i++) {
    raw[1 + i] = parseInt(rHex.slice(i * 2, i * 2 + 2), 16);
    raw[33 + i] = parseInt(sHex.slice(i * 2, i * 2 + 2), 16);
  }
  return btoa(String.fromCharCode(...raw));
}

function splitU256(hex: string): [string, string] {
  const n = BigInt(hex);
  const mask = (1n << 128n) - 1n;
  return [(n & mask).toString(), (n >> 128n).toString()];
}

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  Satoshi Proof — Offline E2E Test');
  console.log('═══════════════════════════════════════════\n');

  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => void) {
    try {
      fn();
      console.log(`  ✅ ${name}`);
      passed++;
    } catch (e: any) {
      console.log(`  ❌ ${name}: ${e.message}`);
      failed++;
    }
  }

  // ── 1. Key Generation ──
  console.log('🔑 Step 1: Generate BTC Keypair');
  const privKey = secp256k1.utils.randomPrivateKey();
  const pubKeyCompressed = secp256k1.getPublicKey(privKey, true);
  const btcAddress = pubkeyToP2PKH(pubKeyCompressed);
  console.log(`   Address (P2PKH): ${btcAddress}`);

  test('Key generation produces valid address', () => {
    if (!btcAddress.startsWith('1')) throw new Error('Invalid P2PKH prefix');
    if (btcAddress.length < 25 || btcAddress.length > 34) throw new Error('Invalid address length');
  });

  // ── 2. Multi-Address Formats ──
  console.log('\n🏠 Step 2: Multi-Address Derivation');
  const allAddrs = pubkeyToAllAddresses(pubKeyCompressed);
  console.log(`   P2PKH:       ${allAddrs.p2pkh}`);
  console.log(`   P2WPKH:      ${allAddrs.p2wpkh}`);
  console.log(`   P2SH-P2WPKH: ${allAddrs.p2shP2wpkh}`);

  test('P2PKH starts with 1', () => { if (!allAddrs.p2pkh.startsWith('1')) throw new Error('wrong'); });
  test('P2WPKH starts with bc1q', () => { if (!allAddrs.p2wpkh.startsWith('bc1q')) throw new Error('wrong'); });
  test('P2SH-P2WPKH starts with 3', () => { if (!allAddrs.p2shP2wpkh.startsWith('3')) throw new Error('wrong'); });

  // ── 3. Message Signing ──
  console.log('\n✍️  Step 3: BIP-137 Message Signing');
  const message = 'Satoshi Proof: I own this Bitcoin address. Timestamp: ' + new Date().toISOString();
  const base64Sig = signBitcoinMessage(message, privKey);
  console.log(`   Message: ${message.slice(0, 60)}...`);
  console.log(`   Signature: ${base64Sig.slice(0, 30)}...`);

  test('Signature is valid base64 (65 bytes)', () => {
    const raw = Uint8Array.from(atob(base64Sig), c => c.charCodeAt(0));
    if (raw.length !== 65) throw new Error(`Got ${raw.length} bytes`);
  });

  // ── 4. Signature Parsing ──
  console.log('\n🔍 Step 4: Parse BIP-137 Signature');
  const sig = parseSignature(base64Sig);
  console.log(`   r: 0x${sig.r.toString(16).slice(0, 16)}...`);
  console.log(`   s: 0x${sig.s.toString(16).slice(0, 16)}...`);
  console.log(`   yParity: ${sig.yParity}`);

  test('Parsed signature has valid r', () => { if (sig.r <= 0n) throw new Error('invalid r'); });
  test('Parsed signature has valid s', () => { if (sig.s <= 0n) throw new Error('invalid s'); });
  test('Recovery flag is 0 or 1', () => { if (sig.recoveryFlag !== 0 && sig.recoveryFlag !== 1) throw new Error('invalid'); });

  // ── 5. Public Key Recovery ──
  console.log('\n🔑 Step 5: Recover Public Key');
  const msgHash = bitcoinMessageHash(message);
  const recovered = recoverPublicKey(msgHash, sig);
  const recoveredAddr = pubkeyToP2PKH(recovered.compressed);
  console.log(`   Recovered: ${recoveredAddr}`);
  console.log(`   Original:  ${btcAddress}`);

  test('Recovered address matches original', () => {
    if (recoveredAddr !== btcAddress) throw new Error(`${recoveredAddr} !== ${btcAddress}`);
  });

  // ── 6. Salted Poseidon Hash ──
  console.log('\n🧂 Step 6: Salted Poseidon Hash');
  const salt = generateSalt();
  const saltedHash = pubkeyToPoseidonHash(recovered.x, recovered.y, salt);
  const unsaltedHash = pubkeyToPoseidonHash(recovered.x, recovered.y);
  console.log(`   Salt: ${salt.slice(0, 20)}...`);
  console.log(`   Salted hash:   ${saltedHash.slice(0, 20)}...`);
  console.log(`   Unsalted hash: ${unsaltedHash.slice(0, 20)}...`);

  test('Salted hash differs from unsalted', () => {
    if (saltedHash === unsaltedHash) throw new Error('Salt had no effect');
  });

  test('Same salt produces same hash', () => {
    const hash2 = pubkeyToPoseidonHash(recovered.x, recovered.y, salt);
    if (hash2 !== saltedHash) throw new Error('Not deterministic');
  });

  test('Different salt produces different hash', () => {
    const salt2 = generateSalt();
    const hash2 = pubkeyToPoseidonHash(recovered.x, recovered.y, salt2);
    if (hash2 === saltedHash) throw new Error('Collision with different salt');
  });

  // ── 7. Bracket System ──
  console.log('\n🦐 Step 7: Bracket System');
  const testCases = [
    { btc: 0, expected: 'Shrimp' },
    { btc: 0.5, expected: 'Shrimp' },
    { btc: 1, expected: 'Crab' },
    { btc: 9.99, expected: 'Crab' },
    { btc: 10, expected: 'Fish' },
    { btc: 50, expected: 'Shark' },
    { btc: 100, expected: 'Whale' },
    { btc: 10000, expected: 'Whale' },
  ];

  for (const tc of testCases) {
    const b = getBracket(tc.btc);
    test(`${tc.btc} BTC → ${tc.expected}`, () => {
      if (b.name.toLowerCase() !== tc.expected.toLowerCase())
        throw new Error(`Got ${b.name}`);
    });
  }

  // ── 8. Calldata Generation ──
  console.log('\n📦 Step 8: Contract Calldata');
  const msgHashHex = hashToU256Hex(msgHash);
  const [msgLow, msgHigh] = splitU256(msgHashHex);
  const [rLow, rHigh] = splitU256('0x' + sig.r.toString(16));
  const [sLow, sHigh] = splitU256('0x' + sig.s.toString(16));
  const bracket = getBracket(0);

  const calldata = [
    msgLow, msgHigh,        // msg_hash: u256
    rLow, rHigh,            // sig_r: u256
    sLow, sHigh,            // sig_s: u256
    sig.yParity ? '1' : '0', // y_parity: bool
    saltedHash,             // btc_pubkey_hash: felt252
    salt,                   // salt: felt252
    bracket.id.toString(),  // bracket: u8
    '0', '0', '0',         // encrypted_btc_addr: ByteArray (empty)
  ];

  console.log(`   Calldata (${calldata.length} felts):`);
  calldata.forEach((c, i) => console.log(`     [${i}] ${c.slice(0, 30)}${c.length > 30 ? '...' : ''}`));

  test('Calldata has 13 elements', () => {
    if (calldata.length !== 13) throw new Error(`Got ${calldata.length}`);
  });

  test('All calldata elements are strings', () => {
    if (!calldata.every(c => typeof c === 'string')) throw new Error('Non-string found');
  });

  // ── 9. Full generateProof() ──
  console.log('\n🎯 Step 9: generateProof() Integration');
  const proof = generateProof(message, base64Sig, 42.5);
  console.log(`   BTC Address: ${proof.btcAddress}`);
  console.log(`   Bracket: ${proof.bracketEmoji} ${proof.bracketName}`);

  test('generateProof returns correct bracket for 42.5 BTC', () => {
    if (proof.bracketName !== 'fish') throw new Error(`Got ${proof.bracketName}`);
  });

  test('generateProof address matches', () => {
    if (proof.btcAddress !== btcAddress) throw new Error('Address mismatch');
  });

  // ── 10. Replay Protection Simulation ──
  console.log('\n🔁 Step 10: Replay Protection');
  const msg1 = 'Satoshi Proof v1 | Chain: SN_SEPOLIA | Contract: 0x049... | Nonce: 1 | ';
  const msg2 = 'Satoshi Proof v1 | Chain: SN_SEPOLIA | Contract: 0x049... | Nonce: 2 | ';
  const hash1 = hashToU256Hex(bitcoinMessageHash(msg1));
  const hash2 = hashToU256Hex(bitcoinMessageHash(msg2));

  test('Different nonces produce different msg_hashes', () => {
    if (hash1 === hash2) throw new Error('Same hash for different nonces');
  });

  // ── Results ──
  console.log('\n═══════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  if (failed === 0) {
    console.log('  🎉 ALL TESTS PASSED');
  } else {
    console.log('  ⚠️  SOME TESTS FAILED');
  }
  console.log('═══════════════════════════════════════════');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('❌ Test crashed:', err);
  process.exit(1);
});
