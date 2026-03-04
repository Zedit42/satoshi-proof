/**
 * Bitcoin Message Signing utilities
 * 
 * Handles BIP-137 Bitcoin signed message format:
 * 1. Message hash: SHA256(SHA256("\x18Bitcoin Signed Message:\n" + varint(len) + message))
 * 2. Signature parsing: base64 → (r, s, recovery_flag)
 * 3. Public key recovery from signature
 * 4. Public key → Bitcoin address derivation
 */

import { secp256k1 } from '@noble/curves/secp256k1';
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
  yParity: boolean;      // for Starknet contract (true = odd y)
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
    recoveryFlag = header - 27;
  } else if (header >= 31 && header <= 34) {
    recoveryFlag = header - 31;
  } else if (header >= 35 && header <= 38) {
    recoveryFlag = header - 35;
  } else if (header >= 39 && header <= 42) {
    recoveryFlag = header - 39;
  } else {
    throw new Error(`Unknown signature header: ${header}`);
  }

  const r = BigInt('0x' + toHex(raw.slice(1, 33)));
  const s = BigInt('0x' + toHex(raw.slice(33, 65)));

  return {
    r,
    s,
    recoveryFlag: recoveryFlag % 2,
    yParity: (recoveryFlag % 2) === 1,
  };
}

// ─── Public Key Recovery ───

/**
 * Recover the public key from a Bitcoin signed message
 * Uses @noble/curves/secp256k1 Signature class with proper recovery
 */
export function recoverPublicKey(
  msgHash: Uint8Array,
  sig: ParsedSignature,
): { x: bigint; y: bigint; compressed: Uint8Array; uncompressed: Uint8Array } {
  // Create Signature object with recovery bit
  const signature = new secp256k1.Signature(sig.r, sig.s).addRecoveryBit(sig.recoveryFlag);

  // Recover public key point
  const point = signature.recoverPublicKey(msgHash);

  const compressed = point.toRawBytes(true);   // 33 bytes
  const uncompressed = point.toRawBytes(false); // 65 bytes

  return { x: point.x, y: point.y, compressed, uncompressed };
}

// ─── Helpers ───

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

export function pubkeyToHash160(compressedPubkey: Uint8Array): Uint8Array {
  return ripemd160(sha256(compressedPubkey));
}

/**
 * Derive P2WPKH (SegWit) address from compressed public key (bc1q...)
 */
export function pubkeyToP2WPKH(compressedPubkey: Uint8Array, testnet = false): string {
  const hash160 = ripemd160(sha256(compressedPubkey));
  const hrp = testnet ? 'tb' : 'bc';
  return bech32Encode(hrp, 0, hash160);
}

/**
 * Derive all address formats from a compressed public key
 */
export function pubkeyToAllAddresses(compressedPubkey: Uint8Array): {
  p2pkh: string; p2wpkh: string; p2shP2wpkh: string;
} {
  const hash160Val = ripemd160(sha256(compressedPubkey));
  
  const p2pkhPayload = new Uint8Array(21);
  p2pkhPayload[0] = 0x00;
  p2pkhPayload.set(hash160Val, 1);
  const p2pkh = base58Check(p2pkhPayload);

  const p2wpkh = bech32Encode('bc', 0, hash160Val);

  const redeemScript = new Uint8Array(22);
  redeemScript[0] = 0x00; redeemScript[1] = 0x14;
  redeemScript.set(hash160Val, 2);
  const scriptHash = ripemd160(sha256(redeemScript));
  const p2shPayload = new Uint8Array(21);
  p2shPayload[0] = 0x05;
  p2shPayload.set(scriptHash, 1);
  const p2shP2wpkh = base58Check(p2shPayload);

  return { p2pkh, p2wpkh, p2shP2wpkh };
}

function bech32Encode(hrp: string, witnessVersion: number, data: Uint8Array): string {
  const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  const converted = convertBits(data, 8, 5, true);
  const values = [witnessVersion, ...converted];
  const polymod = bech32Polymod(hrpExpand(hrp).concat(values).concat([0, 0, 0, 0, 0, 0])) ^ 1;
  const checksum = [];
  for (let i = 0; i < 6; i++) checksum.push((polymod >> (5 * (5 - i))) & 31);
  return hrp + '1' + values.concat(checksum).map(v => CHARSET[v]).join('');
}

function convertBits(data: Uint8Array, fromBits: number, toBits: number, pad: boolean): number[] {
  let acc = 0, bits = 0;
  const ret: number[] = [];
  const maxv = (1 << toBits) - 1;
  for (const value of data) {
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) { bits -= toBits; ret.push((acc >> bits) & maxv); }
  }
  if (pad && bits > 0) ret.push((acc << (toBits - bits)) & maxv);
  return ret;
}

function hrpExpand(hrp: string): number[] {
  const ret: number[] = [];
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) >> 5);
  ret.push(0);
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) & 31);
  return ret;
}

function bech32Polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((b >> i) & 1) chk ^= GEN[i];
  }
  return chk;
}

// Base58Check encoding
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Check(payload: Uint8Array): string {
  const checksum = sha256(sha256(payload)).slice(0, 4);
  const data = new Uint8Array(payload.length + 4);
  data.set(payload, 0);
  data.set(checksum, payload.length);

  let num = 0n;
  for (const byte of data) num = num * 256n + BigInt(byte);

  let result = '';
  while (num > 0n) {
    const rem = Number(num % 58n);
    result = BASE58_ALPHABET[rem] + result;
    num = num / 58n;
  }

  for (const byte of data) {
    if (byte !== 0) break;
    result = '1' + result;
  }

  return result;
}

// ─── Starknet Integration ───

/**
 * Compute Poseidon hash of public key coordinates (for on-chain comparison)
 * Matches the Cairo contract: PoseidonTrait::new().update(x.low).update(x.high).update(y.low).update(y.high).finalize()
 */
export function pubkeyToPoseidonHash(x: bigint, y: bigint, salt?: string): string {
  const xLow = x & ((1n << 128n) - 1n);
  const xHigh = x >> 128n;
  const yLow = y & ((1n << 128n) - 1n);
  const yHigh = y >> 128n;

  const elements = [
    '0x' + xLow.toString(16),
    '0x' + xHigh.toString(16),
    '0x' + yLow.toString(16),
    '0x' + yHigh.toString(16),
  ];
  if (salt) elements.push(salt);

  return starkHash.computePoseidonHashOnElements(elements);
}

/**
 * Generate a random salt for Poseidon hash privacy
 */
export function generateSalt(): string {
  const bytes = new Uint8Array(31); // felt252 max ~31 bytes
  // Works in both Node.js and browser
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    // Node.js fallback
    const { randomBytes } = require('crypto');
    const buf = randomBytes(31);
    bytes.set(buf);
  }
  return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
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

// ─── Proof Message Format ───

/**
 * Generate proof message with nonce for replay protection
 */
export function createProofMessage(
  contractAddress: string,
  nonce: number,
  chain: string = 'SN_SEPOLIA'
): string {
  return `Satoshi Proof v1 | Chain: ${chain} | Contract: ${contractAddress} | Nonce: ${nonce} | `;
}

// ─── Full Proof Generation ───

export interface ProofData {
  message: string;
  msgHash: string;
  sigR: string;
  sigS: string;
  yParity: boolean;
  pubkeyX: string;
  pubkeyY: string;
  pubkeyHash: string;
  btcAddress: string;
  bracket: number;
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
