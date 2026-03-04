import Wallet, { AddressPurpose } from 'sats-connect';

export interface XverseSignatureResult {
  address: string;
  signature: string;
}

/**
 * Connect to Xverse wallet and get Bitcoin address
 */
export async function connectXverse(): Promise<string> {
  const getAccountsResponse = await Wallet.request('getAccounts', {
    purposes: [AddressPurpose.Payment],
    message: 'Connect to Satoshi Proof',
  });

  if (getAccountsResponse.status === 'error') {
    throw new Error(getAccountsResponse.error.message || 'Failed to connect');
  }

  const paymentAddress = getAccountsResponse.result.find(
    (addr) => addr.purpose === AddressPurpose.Payment
  );

  if (!paymentAddress) {
    throw new Error('No payment address found');
  }

  return paymentAddress.address;
}

/**
 * Sign message with Xverse wallet using ECDSA (legacy BIP-137 format)
 * IMPORTANT: Request ECDSA signature, NOT Schnorr (for contract compatibility)
 */
export async function signWithXverse(
  message: string,
  address: string
): Promise<XverseSignatureResult> {
  const signResponse = await Wallet.request('signMessage', {
    address,
    message,
  });

  if (signResponse.status === 'error') {
    throw new Error(signResponse.error.message || 'Failed to sign message');
  }

  // Xverse returns signature object with base64 signature in BIP-137 format
  return {
    address: signResponse.result.address,
    signature: signResponse.result.signature,
  };
}

/**
 * Check if Xverse wallet is installed
 */
export function isXverseAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    (typeof window.BitcoinProvider !== 'undefined' ||
      typeof window.XverseProviders?.BitcoinProvider !== 'undefined')
  );
}
