/**
 * Unisat Wallet Integration
 * Uses window.unisat API for Bitcoin wallet connection and signing
 */

export interface UnisatSignatureResult {
  address: string;
  signature: string;
}

declare global {
  interface Window {
    unisat?: {
      requestAccounts: () => Promise<string[]>;
      getAccounts: () => Promise<string[]>;
      signMessage: (message: string, type?: 'ecdsa' | 'bip322-simple') => Promise<string>;
      getPublicKey: () => Promise<string>;
      getNetwork: () => Promise<string>;
      switchNetwork: (network: 'livenet' | 'testnet') => Promise<void>;
    };
  }
}

/**
 * Connect to Unisat wallet and get Bitcoin address
 */
export async function connectUnisat(): Promise<string> {
  if (!window.unisat) {
    throw new Error('Unisat wallet not installed');
  }

  try {
    const accounts = await window.unisat.requestAccounts();
    if (!accounts || accounts.length === 0) {
      throw new Error('No accounts found');
    }
    return accounts[0];
  } catch (err: any) {
    throw new Error(err.message || 'Failed to connect to Unisat');
  }
}

/**
 * Sign message with Unisat wallet using ECDSA (BIP-137 format)
 */
export async function signWithUnisat(message: string): Promise<UnisatSignatureResult> {
  if (!window.unisat) {
    throw new Error('Unisat wallet not installed');
  }

  try {
    // Get current address
    const accounts = await window.unisat.getAccounts();
    if (!accounts || accounts.length === 0) {
      throw new Error('No accounts connected');
    }
    const address = accounts[0];

    // Sign with ECDSA (BIP-137 format, compatible with our recovery logic)
    const signature = await window.unisat.signMessage(message, 'ecdsa');

    return {
      address,
      signature,
    };
  } catch (err: any) {
    throw new Error(err.message || 'Failed to sign message');
  }
}

/**
 * Check if Unisat wallet is installed
 */
export function isUnisatAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.unisat !== 'undefined';
}

/**
 * Ensure Unisat is on mainnet
 */
export async function ensureMainnet(): Promise<void> {
  if (!window.unisat) {
    throw new Error('Unisat wallet not installed');
  }

  const network = await window.unisat.getNetwork();
  if (network !== 'livenet') {
    await window.unisat.switchNetwork('livenet');
  }
}
