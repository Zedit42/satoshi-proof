/**
 * Frontend Bitcoin crypto — mirrors SDK's bitcoin.ts
 */

import * as secp256k1 from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { hash as starkHash } from 'starknet';

// Setup noble/secp256k1 v3 hashes
if (!(secp256k1.hashes as any).sha256) {
  (secp256k1.hashes as any).sha256 = (...msgs: Uint8Array[]) => {
    const total = msgs.reduce((a, m) => a + m.length, 0);
    const buf = new Uint8Array(total);
    let off = 0;
    for (const m of msgs) { buf.set(m, off); off += m.length; }
    return sha256(buf);
  };
  (secp256k1.hashes as any).hmacSha256 = (key: Uint8Array, ...msgs: Uint8Array[]) => {
    const h = hmac.create(sha256 as any, key);
    for (const m of msgs) h.update(m);
    return h.digest();
  };
}

function varintBuf(n: number): Uint8Array {
  if (n < 0xfd) return new Uint8Array([n]);
  const buf = new Uint8Array(3);
  buf[0] = 0xfd; buf[1] = n & 0xff; buf[2] = (n >> 8) & 0xff;
  return buf;
}

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

export function hashToU256Hex(hash: Uint8Array): string {
  return '0x' + Array.from(hash).map(b => b.toString(16).padStart(2, '0')).join('');
}

export interface ParsedSig { r: bigint; s: bigint; recoveryFlag: number; yParity: boolean; }

export function parseSignature(base64Sig: string): ParsedSig {
  const raw = Uint8Array.from(atob(base64Sig), c => c.charCodeAt(0));
  if (raw.length !== 65) throw new Error(`Invalid signature length: ${raw.length}`);
  const header = raw[0];
  let rf: number;
  if (header >= 27 && header <= 30) rf = header - 27;
  else if (header >= 31 && header <= 34) rf = header - 31;
  else if (header >= 35 && header <= 38) rf = header - 35;
  else if (header >= 39 && header <= 42) rf = header - 39;
  else throw new Error(`Unknown header: ${header}`);
  const toHex = (arr: Uint8Array) => Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
  return {
    r: BigInt('0x' + toHex(raw.slice(1, 33))),
    s: BigInt('0x' + toHex(raw.slice(33, 65))),
    recoveryFlag: rf % 2,
    yParity: (rf % 2) === 1,  // Starknet: true = odd y
  };
}

export function recoverPubKey(msgHash: Uint8Array, sig: ParsedSig) {
  // Build 65-byte "recovered" signature: recovery(1) + r(32) + s(32)
  const rBytes = bigintToBytes(sig.r, 32);
  const sBytes = bigintToBytes(sig.s, 32);
  const recSig = new Uint8Array(65);
  recSig[0] = sig.recoveryFlag;
  recSig.set(rBytes, 1);
  recSig.set(sBytes, 33);

  const compressed = secp256k1.recoverPublicKey(recSig, msgHash);
  const point = secp256k1.Point.fromBytes(compressed);
  const uncompressed = point.toBytes(false); // 65 bytes: 04 + x + y
  const x = BigInt('0x' + toHex(uncompressed.slice(1, 33)));
  const y = BigInt('0x' + toHex(uncompressed.slice(33, 65)));

  return { x, y, compressed, uncompressed };
}

function bigintToBytes(n: bigint, len: number): Uint8Array {
  const hex = n.toString(16).padStart(len * 2, '0');
  return new Uint8Array(hex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
}

function toHex(arr: Uint8Array): string {
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function pubkeyToP2PKH(compressed: Uint8Array, testnet = false): string {
  const hash160 = ripemd160(sha256(compressed));
  const version = testnet ? 0x6f : 0x00;
  const payload = new Uint8Array(21);
  payload[0] = version;
  payload.set(hash160, 1);
  return base58Check(payload);
}

// SegWit P2WPKH address (bc1q...)
export function pubkeyToP2WPKH(compressed: Uint8Array, testnet = false): string {
  const hash160 = ripemd160(sha256(compressed));
  const hrp = testnet ? 'tb' : 'bc';
  return bech32Encode(hrp, 0, hash160);
}

// Derive all address formats from a compressed pubkey
export function pubkeyToAllAddresses(compressed: Uint8Array): {
  p2pkh: string; p2wpkh: string; p2shP2wpkh: string;
} {
  const hash160 = ripemd160(sha256(compressed));
  
  // P2PKH (1...)
  const p2pkhPayload = new Uint8Array(21);
  p2pkhPayload[0] = 0x00;
  p2pkhPayload.set(hash160, 1);
  const p2pkh = base58Check(p2pkhPayload);

  // P2WPKH (bc1q...)
  const p2wpkh = bech32Encode('bc', 0, hash160);

  // P2SH-P2WPKH (3...)
  const redeemScript = new Uint8Array(22);
  redeemScript[0] = 0x00; redeemScript[1] = 0x14;
  redeemScript.set(hash160, 2);
  const scriptHash = ripemd160(sha256(redeemScript));
  const p2shPayload = new Uint8Array(21);
  p2shPayload[0] = 0x05;
  p2shPayload.set(scriptHash, 1);
  const p2shP2wpkh = base58Check(p2shPayload);

  return { p2pkh, p2wpkh, p2shP2wpkh };
}

// Match an address against all formats derived from a pubkey
export function addressMatchesPubkey(address: string, compressed: Uint8Array): boolean {
  const all = pubkeyToAllAddresses(compressed);
  return address === all.p2pkh || address === all.p2wpkh || address === all.p2shP2wpkh;
}

// Bech32 encoding for SegWit addresses
function bech32Encode(hrp: string, witnessVersion: number, data: Uint8Array): string {
  const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  
  // Convert to 5-bit groups
  const converted = convertBits(data, 8, 5, true);
  const values = [witnessVersion, ...converted];
  
  // Create checksum
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

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58Check(payload: Uint8Array): string {
  const cs = sha256(sha256(payload)).slice(0, 4);
  const data = new Uint8Array(payload.length + 4);
  data.set(payload); data.set(cs, payload.length);
  let num = 0n;
  for (const b of data) num = num * 256n + BigInt(b);
  let r = '';
  while (num > 0n) { r = B58[Number(num % 58n)] + r; num /= 58n; }
  for (const b of data) { if (b !== 0) break; r = '1' + r; }
  return r;
}

export function pubkeyPoseidonHash(x: bigint, y: bigint): string {
  const mask = (1n << 128n) - 1n;
  return starkHash.computePoseidonHashOnElements([
    '0x' + (x & mask).toString(16), '0x' + (x >> 128n).toString(16),
    '0x' + (y & mask).toString(16), '0x' + (y >> 128n).toString(16),
  ]);
}

export const BRACKETS = [
  { name: 'Shrimp', min: 0, max: 1, id: 0, emoji: '🦐' },
  { name: 'Crab', min: 1, max: 10, id: 1, emoji: '🦀' },
  { name: 'Fish', min: 10, max: 50, id: 2, emoji: '🐟' },
  { name: 'Shark', min: 50, max: 100, id: 3, emoji: '🦈' },
  { name: 'Whale', min: 100, max: Infinity, id: 4, emoji: '🐋' },
];

export function getBracket(btc: number) {
  for (let i = BRACKETS.length - 1; i >= 0; i--) if (btc >= BRACKETS[i].min) return BRACKETS[i];
  return BRACKETS[0];
}

export function createProofMessage(contractAddress: string, nonce: number, chain = 'SN_SEPOLIA'): string {
  return `Satoshi Proof v1 | Chain: ${chain} | Contract: ${contractAddress} | Nonce: ${nonce} | `;
}

export function fetchBtcBalance(address: string): Promise<number> {
  return fetch(`https://blockstream.info/api/address/${address}`)
    .then(r => r.json())
    .then(data => {
      const funded = data.chain_stats?.funded_txo_sum || 0;
      const spent = data.chain_stats?.spent_txo_sum || 0;
      return (funded - spent) / 1e8;
    })
    .catch(() => 0);
}
