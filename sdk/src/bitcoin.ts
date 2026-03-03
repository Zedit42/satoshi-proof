/**
 * Bitcoin Message Signing utilities
 * 
 * Handles BIP-137 Bitcoin signed message format:
 * 1. Message hash: SHA256(SHA256("\x18Bitcoin Signed Message:\n" + varint(len) + message))
 * 2. Signature parsing: base64 → (r, s, recovery_flag)
 * 3. Public key recovery from signature
 * 4. Public key → Bitcoin address derivation
 */

import * as secp256k1 from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha2.js';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { hash as starkHash } from 'starknet';

// ─── Bitcoin Message Hash ───

function varintBuf(n: number): Uint8Array {
  if (n < 0xfd) return new Uint8Array([n]);
  if (n <= 0xffff) {
    const buf = new Uint8Array(3);
    buf[0] = 0xfd;
    buf[1] = n & 0xff;
    buf[2] = (n >> 8) & 0xff;
    return buf;
  }
  throw new Error('Message too long');
}

/**
 * Compute Bitcoin message hash (double SHA-256)
 * Format: SHA256(SHA256("\x18Bitcoin Signed Message:\n" + varint(len) + message))
 */
export function bitcoinMessageHash(message: string): Uint8Array {
  const prefix = '\x18Bitcoin Signed Message:\n';
  const prefixBuf = new TextEncoder().encode(prefix);
  const msgBuf = new TextEncoder().encode(message);
  const lenBuf = varintBuf(msgBuf.length);

  const combined = new Uint8Array(prefixBuf.length + lenBuf.length + msgBuf.length);
  combined.set(prefixBuf, 0);
  combined.set(lenBuf, prefixBuf.length);
  combined.set(msgBuf, prefixBuf.length + lenBuf.length);

  return sha256(sha256(combined));
}

/**
 * Convert message hash bytes to u256 hex string (for Starknet contract)
 */
export function hashToU256Hex(hash: Uint8Array): string {
  return '0x' + Array.from(hash).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Signature Parsing (BIP-137) ───

export interface ParsedSignature {
  r: bigint;
  s: bigint;
  recoveryFlag: number;  // 0 or 1
  yParity: boolean;      // for Starknet contract
}

/**
 * Parse a base64 Bitcoin signature (BIP-137 format)
 * First byte is the header: 27-30 (uncompressed), 31-34 (compressed)
 * recovery_flag = (header - 27) % 4 for uncompressed
 * recovery_flag = (header - 31) % 4 for compressed
 */
export function parseSignature(base64Sig: string): ParsedSignature {
  const raw = Uint8Array.from(atob(base64Sig), c => c.charCodeAt(0));
  if (raw.length !== 65) throw new Error(`Invalid signature length: ${raw.length}`);

  const header = raw[0];
  let recoveryFlag: number;

  if (header >= 27 && header <= 30) {
    // Uncompressed
    recoveryFlag = header - 27;
  } else if (header >= 31 && header <= 34) {
    // Compressed (P2PKH)
    recoveryFlag = header - 31;
  } else if (header >= 35 && header <= 38) {
    // Segwit P2SH-P2WPKH
    recoveryFlag = header - 35;
  } else if (header >= 39 && header <= 42) {
    // Segwit Bech32
    recoveryFlag = header - 39;
  } else {
    throw new Error(`Unknown signature header: ${header}`);
  }

  const r = BigInt('0x' + Array.from(raw.slice(1, 33)).map(b => b.toString(16).padStart(2, '0')).join(''));
  const s = BigInt('0x' + Array.from(raw.slice(33, 65)).map(b => b.toString(16).padStart(2, '0')).join(''));

  return {
    r,
    s,
    recoveryFlag: recoveryFlag % 2,  // 0 or 1
    yParity: (recoveryFlag % 2) === 0,  // Starknet convention
  };
}

// ─── Public Key Recovery ───

/**
 * Recover the public key from a Bitcoin signed message
 */
export function recoverPublicKey(
  msgHash: Uint8Array,
  sig: ParsedSignature,
): { x: bigint; y: bigint; compressed: Uint8Array; uncompressed: Uint8Array } {
  // Build 65-byte recovered signature: r(32) + s(32) + recovery(1)
  const rBytes = bigintToBytes(sig.r, 32);
  const sBytes = bigintToBytes(sig.s, 32);
  const recSig = new Uint8Array(65);
  recSig.set(rBytes, 0);
  recSig.set(sBytes, 32);
  recSig[64] = sig.recoveryFlag;

  const rawPub = secp256k1.recoverPublicKey(recSig, msgHash, { format: 'recovered' });
  const uncompressed = rawPub;
  const x = BigInt('0x' + toHex(uncompressed.slice(1, 33)));
  const y = BigInt('0x' + toHex(uncompressed.slice(33, 65)));

  const prefix = (y % 2n === 0n) ? 0x02 : 0x03;
  const compressed = new Uint8Array(33);
  compressed[0] = prefix;
  compressed.set(uncompressed.slice(1, 33), 1);

  return { x, y, compressed, uncompressed };
}

function bigintToBytes(n: bigint, len: number): Uint8Array {
  const hex = n.toString(16).padStart(len * 2, '0');
  return new Uint8Array(hex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
}

function toHex(arr: Uint8Array): string {
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Bitcoin Address Derivation ───

/**
 * Derive P2PKH Bitcoin address from compressed public key
 */
export function pubkeyToP2PKH(compressedPubkey: Uint8Array, testnet = false): string {
  const hash1 = sha256(compressedPubkey);
  const hash160 = ripemd160(hash1);
  
  const version = testnet ? 0x6f : 0x00;
  const payload = new Uint8Array(21);
  payload[0] = version;
  payload.set(hash160, 1);

  return base58Check(payload);
}

/**
 * Derive P2WPKH (bech32) address from compressed public key  
 * (simplified — returns hash160 for comparison purposes)
 */
export function pubkeyToHash160(compressedPubkey: Uint8Array): Uint8Array {
  return ripemd160(sha256(compressedPubkey));
}

// Base58Check encoding
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Check(payload: Uint8Array): string {
  const checksum = sha256(sha256(payload)).slice(0, 4);
  const data = new Uint8Array(payload.length + 4);
  data.set(payload, 0);
  data.set(checksum, payload.length);

  // Convert to base58
  let num = 0n;
  for (const byte of data) num = num * 256n + BigInt(byte);

  let result = '';
  while (num > 0n) {
    const rem = Number(num % 58n);
    result = BASE58_ALPHABET[rem] + result;
    num = num / 58n;
  }

  // Leading zeros
  for (const byte of data) {
    if (byte !== 0) break;
    result = '1' + result;
  }

  return result;
}

// ─── Starknet Integration ───

/**
 * Compute Poseidon hash of public key coordinates (for on-chain comparison)
 * Matches the Cairo contract's hash computation
 */
export function pubkeyToPoseidonHash(x: bigint, y: bigint): string {
  const xLow = x & ((1n << 128n) - 1n);
  const xHigh = x >> 128n;
  const yLow = y & ((1n << 128n) - 1n);
  const yHigh = y >> 128n;

  return starkHash.computePoseidonHashOnElements([
    '0x' + xLow.toString(16),
    '0x' + xHigh.toString(16),
    '0x' + yLow.toString(16),
    '0x' + yHigh.toString(16),
  ]);
}

// ─── Bracket System ───

export type Bracket = 'shrimp' | 'crab' | 'fish' | 'shark' | 'whale';

export const BRACKETS: { name: Bracket; min: number; max: number; id: number; emoji: string }[] = [
  { name: 'shrimp', min: 0, max: 1, id: 0, emoji: '🦐' },
  { name: 'crab', min: 1, max: 10, id: 1, emoji: '🦀' },
  { name: 'fish', min: 10, max: 50, id: 2, emoji: '🐟' },
  { name: 'shark', min: 50, max: 100, id: 3, emoji: '🦈' },
  { name: 'whale', min: 100, max: Infinity, id: 4, emoji: '🐋' },
];

export function getBracket(btcBalance: number): typeof BRACKETS[0] {
  for (let i = BRACKETS.length - 1; i >= 0; i--) {
    if (btcBalance >= BRACKETS[i].min) return BRACKETS[i];
  }
  return BRACKETS[0];
}

// ─── Full Proof Generation ───

export interface ProofData {
  message: string;
  msgHash: string;          // u256 hex
  sigR: string;             // u256 hex
  sigS: string;             // u256 hex
  yParity: boolean;
  pubkeyX: string;          // u256 hex
  pubkeyY: string;          // u256 hex
  pubkeyHash: string;       // felt252 hex (Poseidon)
  btcAddress: string;       // P2PKH address
  bracket: number;          // 0-4
  bracketName: string;
  bracketEmoji: string;
}

/**
 * Generate a complete proof from a Bitcoin signed message
 */
export function generateProof(
  message: string,
  base64Signature: string,
  btcBalance: number,
): ProofData {
  const msgHash = bitcoinMessageHash(message);
  const sig = parseSignature(base64Signature);
  const pubkey = recoverPublicKey(msgHash, sig);
  const btcAddress = pubkeyToP2PKH(pubkey.compressed);
  const pubkeyHash = pubkeyToPoseidonHash(pubkey.x, pubkey.y);
  const bracket = getBracket(btcBalance);

  return {
    message,
    msgHash: hashToU256Hex(msgHash),
    sigR: '0x' + sig.r.toString(16),
    sigS: '0x' + sig.s.toString(16),
    yParity: sig.yParity,
    pubkeyX: '0x' + pubkey.x.toString(16),
    pubkeyY: '0x' + pubkey.y.toString(16),
    pubkeyHash,
    btcAddress,
    bracket: bracket.id,
    bracketName: bracket.name,
    bracketEmoji: bracket.emoji,
  };
}
