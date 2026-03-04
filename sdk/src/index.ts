/**
 * @satoshi-proof/sdk
 * 
 * Bitcoin signature verification and proof generation for Starknet
 * Implements BIP-137 Bitcoin signed message verification with Poseidon hashing
 */

export {
  // Core functions
  generateProof,
  getBracket,
  
  // Bitcoin utilities
  bitcoinMessageHash,
  hashToU256Hex,
  parseSignature,
  recoverPublicKey,
  pubkeyToP2PKH,
  pubkeyToP2WPKH,
  pubkeyToAllAddresses,
  pubkeyToHash160,
  pubkeyToPoseidonHash,
  
  // Types
  type ParsedSignature,
  type ProofData,
  type Bracket,
  
  // Constants
  BRACKETS,
} from './bitcoin.js';
