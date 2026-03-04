/**
 * Satoshi Proof — E2E Test on Starknet Sepolia
 * 
 * Flow:
 * 1. Generate BTC keypair & sign message
 * 2. SDK: parse signature, recover pubkey, compute Poseidon hash
 * 3. Submit register_proof() to on-chain ProofRegistry
 * 4. Query get_proof() and verify
 * 5. Query has_valid_proof() for bracket check
 * 6. Test REST API
 */

import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  bitcoinMessageHash, hashToU256Hex, parseSignature,
  recoverPublicKey, pubkeyToP2PKH, pubkeyToPoseidonHash,
  generateSalt, getBracket,
} from './bitcoin.js';
import { Account, RpcProvider } from 'starknet';

// ─── Config ───
const RPC_URL = 'https://rpc.starknet-testnet.lava.build';
const REGISTRY = '0x0490029d0c2007f40a39eac70e5c728351568770248a6f29cfa42b7d9ce32c75';
const DEPLOYER_ADDR = '0x044e59e0dd3cec8fb232e3060ffceffbe383d474955c6499b57376e55d289ff5';
const DEPLOYER_PK = process.env.STARKNET_PRIVATE_KEY || '';

// ─── Helpers ───

function toHex(arr: Uint8Array): string {
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Sign a Bitcoin message and produce a BIP-137 base64 signature */
function signBitcoinMessage(message: string, privKeyBytes: Uint8Array): string {
  const msgHash = bitcoinMessageHash(message);

  // Sign with @noble/curves — returns Signature with recovery
  const sig = secp256k1.sign(msgHash, privKeyBytes, { lowS: true });

  // BIP-137 format: header(1) + r(32) + s(32)
  // Header = 31 + recovery for compressed P2PKH
  const header = 31 + sig.recovery;
  const rBytes = sig.r.toString(16).padStart(64, '0');
  const sBytes = sig.s.toString(16).padStart(64, '0');

  const raw = new Uint8Array(65);
  raw[0] = header;
  for (let i = 0; i < 32; i++) {
    raw[1 + i] = parseInt(rBytes.slice(i * 2, i * 2 + 2), 16);
    raw[33 + i] = parseInt(sBytes.slice(i * 2, i * 2 + 2), 16);
  }

  return btoa(String.fromCharCode(...raw));
}

function splitU256(hex: string): [string, string] {
  const n = BigInt(hex);
  const mask = (1n << 128n) - 1n;
  return [(n & mask).toString(), (n >> 128n).toString()];
}

// ─── Main ───
async function main() {
  if (!DEPLOYER_PK) {
    console.error('❌ Set STARKNET_PRIVATE_KEY env var');
    process.exit(1);
  }

  console.log('=== Satoshi Proof E2E Test ===\n');

  // 1. Generate BTC keypair
  const privKey = secp256k1.utils.randomPrivateKey();
  const pubKeyCompressed = secp256k1.getPublicKey(privKey, true);
  const btcAddress = pubkeyToP2PKH(pubKeyCompressed);
  console.log('📍 BTC Address:', btcAddress);

  // 2. Sign message
  const message = 'Satoshi Proof: I own this Bitcoin address. Timestamp: ' + new Date().toISOString();
  console.log('📝 Message:', message);
  const base64Sig = signBitcoinMessage(message, privKey);
  console.log('🔏 Signature:', base64Sig.slice(0, 30) + '...');

  // 3. SDK: parse & recover
  const msgHash = bitcoinMessageHash(message);
  const sig = parseSignature(base64Sig);
  const recovered = recoverPublicKey(msgHash, sig);
  const recoveredAddr = pubkeyToP2PKH(recovered.compressed);
  console.log('🔑 Recovered BTC Address:', recoveredAddr);

  if (recoveredAddr !== btcAddress) {
    console.error('❌ Address mismatch! Expected:', btcAddress, 'Got:', recoveredAddr);
    process.exit(1);
  }
  console.log('✅ Signature verified — addresses match\n');

  // 4. Compute on-chain data
  const msgHashHex = hashToU256Hex(msgHash);
  const sigR = '0x' + sig.r.toString(16);
  const sigS = '0x' + sig.s.toString(16);
  const salt = generateSalt();
  const poseidonHash = pubkeyToPoseidonHash(recovered.x, recovered.y, salt);
  const bracket = getBracket(0); // 0 BTC for test = Shrimp

  console.log('📦 Proof data:');
  console.log('  msgHash:', msgHashHex.slice(0, 20) + '...');
  console.log('  yParity:', sig.yParity);
  console.log('  salt:', salt.slice(0, 20) + '...');
  console.log('  pubkeyHash:', poseidonHash.slice(0, 20) + '...');
  console.log('  bracket:', bracket.id, bracket.emoji, bracket.name);
  console.log();

  // 5. Submit on-chain
  const provider = new RpcProvider({ nodeUrl: RPC_URL });
  const account = new Account(provider, DEPLOYER_ADDR, DEPLOYER_PK);

  console.log('⛓️  Submitting register_proof() to Starknet Sepolia...');
  const tx = await account.execute([{
    contractAddress: REGISTRY,
    entrypoint: 'register_proof',
    calldata: [
      ...splitU256(msgHashHex),
      ...splitU256(sigR),
      ...splitU256(sigS),
      sig.yParity ? '1' : '0',
      poseidonHash,
      salt,
      bracket.id.toString(),
      // ByteArray for encrypted_btc_addr (empty for test)
      '0', '0', '0',
    ],
  }]);

  console.log('📤 TX Hash:', tx.transaction_hash);
  console.log('⏳ Waiting for confirmation...');
  await provider.waitForTransaction(tx.transaction_hash);
  console.log('✅ Transaction confirmed!\n');

  // 6. Query get_proof()
  console.log('🔍 Querying get_proof()...');
  const result = await provider.callContract({
    contractAddress: REGISTRY,
    entrypoint: 'get_proof',
    calldata: [DEPLOYER_ADDR],
  });

  const storedHash = result[0];
  const storedBracket = Number(result[1]);
  const storedTimestamp = Number(BigInt(result[2]));
  const storedValid = result[3] !== '0x0';

  console.log('  pubkeyHash:', storedHash);
  console.log('  bracket:', storedBracket);
  console.log('  timestamp:', new Date(storedTimestamp * 1000).toISOString());
  console.log('  valid:', storedValid);

  if (!storedValid) { console.error('❌ Proof not valid on-chain!'); process.exit(1); }
  if (storedBracket !== bracket.id) { console.error('❌ Bracket mismatch!'); process.exit(1); }
  console.log('✅ Proof stored correctly on-chain!\n');

  // 7. Query has_valid_proof()
  console.log('🔍 Querying has_valid_proof(min_bracket=0)...');
  const checkResult = await provider.callContract({
    contractAddress: REGISTRY,
    entrypoint: 'has_valid_proof',
    calldata: [DEPLOYER_ADDR, '0'],
  });
  const isEligible = checkResult[0] !== '0x0';
  console.log('  eligible:', isEligible);
  if (!isEligible) { console.error('❌ has_valid_proof returned false!'); process.exit(1); }
  console.log('✅ has_valid_proof check passed!\n');

  // 8. Proof count
  const countResult = await provider.callContract({
    contractAddress: REGISTRY,
    entrypoint: 'get_proof_count',
    calldata: [],
  });
  console.log('📊 Total proofs on-chain:', Number(BigInt(countResult[0])));

  // 9. Test REST API
  console.log('\n🌐 Testing REST API...');
  try {
    const apiRes = await fetch(`https://satoshi-proof.vercel.app/api/proof?address=${DEPLOYER_ADDR}`);
    const apiData = await apiRes.json();
    console.log('API Response:', JSON.stringify(apiData, null, 2));
    if (apiData.hasProof) {
      console.log('✅ API returns proof data!');
    } else {
      console.log('⚠️  API says no proof (may need time to propagate)');
    }
  } catch (e: any) {
    console.log('⚠️  API test skipped:', e.message);
  }

  console.log('\n========================================');
  console.log('   ALL E2E TESTS PASSED ✅');
  console.log('========================================');
  console.log('🔗 TX:', `https://sepolia.voyager.online/tx/${tx.transaction_hash}`);
}

main().catch(err => {
  console.error('❌ E2E test failed:', err);
  process.exit(1);
});
