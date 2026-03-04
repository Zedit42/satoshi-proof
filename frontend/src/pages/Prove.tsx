import { useState } from 'react';
import type { WalletState } from '../App';
import {
  bitcoinMessageHash, hashToU256Hex, parseSignature,
  recoverPubKey, pubkeyToP2PKH, pubkeyPoseidonHash,
  getBracket, fetchBtcBalance, BRACKETS, addressMatchesPubkey,
} from '../crypto/bitcoin';
import { CallData } from 'starknet';
import WalletSelector, { type WalletType } from '../components/WalletSelector';
import { connectXverse, signWithXverse } from '../wallets/xverse';
import { connectUnisat, signWithUnisat, ensureMainnet } from '../wallets/unisat';

const REGISTRY_ADDRESS = '0x0490029d0c2007f40a39eac70e5c728351568770248a6f29cfa42b7d9ce32c75';
const PROOF_MESSAGE = 'Satoshi Proof: I own this Bitcoin address. Timestamp: ';

async function encryptBtcAddress(btcAddress: string): Promise<string> {
  const resp = await fetch('/api/encrypt-address', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ btcAddress }),
  });
  if (!resp.ok) throw new Error('Encryption failed');
  const { encrypted } = await resp.json();
  return encrypted;
}

interface Props {
  wallet: WalletState;
  connectWallet: () => Promise<void>;
}

type Step = 'select' | 'sign' | 'verify' | 'balance' | 'submit' | 'done';

export default function Prove({ wallet, connectWallet }: Props) {
  const [step, setStep] = useState<Step>('select');
  const [selectedWallet, setSelectedWallet] = useState<WalletType | null>(null);
  const [signature, setSignature] = useState('');
  const [error, setError] = useState('');

  // Proof data
  const [message] = useState(PROOF_MESSAGE + new Date().toISOString().split('T')[0]);
  const [btcAddress, setBtcAddress] = useState('');
  const [btcBalance, setBtcBalance] = useState<number | null>(null);
  const [bracket, setBracket] = useState<typeof BRACKETS[0] | null>(null);
  const [proofData, setProofData] = useState<any>(null);
  const [txHash, setTxHash] = useState('');
  const [copied, setCopied] = useState(false);

  const copyMessage = () => {
    navigator.clipboard.writeText(message);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleWalletSelect = async (walletType: WalletType) => {
    setSelectedWallet(walletType);
    setError('');

    if (walletType === 'manual') {
      // Manual flow: go to sign step
      setStep('sign');
      return;
    }

    // Auto-sign flow for Xverse/Unisat
    try {
      setStep('verify');
      let address: string;
      let sig: string;

      if (walletType === 'xverse') {
        // Connect and sign with Xverse
        address = await connectXverse();
        const result = await signWithXverse(message, address);
        sig = result.signature;
      } else if (walletType === 'unisat') {
        // Connect and sign with Unisat
        await ensureMainnet();
        address = await connectUnisat();
        const result = await signWithUnisat(message);
        sig = result.signature;
      } else {
        throw new Error('Unknown wallet type');
      }

      // Verify signature
      await verifySignatureData(sig, address);
    } catch (err: any) {
      setError(err.message || 'Wallet connection failed');
      setStep('select');
    }
  };

  const verifySignature = async () => {
    setError('');
    try {
      await verifySignatureData(signature.trim());
    } catch (err: any) {
      setError(err.message || 'Invalid signature');
      setStep('sign');
    }
  };

  const verifySignatureData = async (sig: string, expectedAddress?: string) => {
    const msgHash = bitcoinMessageHash(message);
    const parsedSig = parseSignature(sig);
    const pubkey = recoverPubKey(msgHash, parsedSig);
    const address = pubkeyToP2PKH(pubkey.compressed);
    const poseidonHash = pubkeyPoseidonHash(pubkey.x, pubkey.y);

    // If expected address is provided (from wallet), verify it matches any format
    if (expectedAddress && !addressMatchesPubkey(expectedAddress, pubkey.compressed)) {
      throw new Error('Signature address mismatch — recovered pubkey doesn\'t match wallet address');
    }

    // Use wallet's address if provided (preserves SegWit/Taproot format), otherwise P2PKH
    setBtcAddress(expectedAddress || address);
    setProofData({
      msgHash: hashToU256Hex(msgHash),
      sigR: '0x' + parsedSig.r.toString(16),
      sigS: '0x' + parsedSig.s.toString(16),
      yParity: parsedSig.yParity,
      pubkeyHash: poseidonHash,
    });

    setStep('balance');

    // Fetch balance
    const bal = await fetchBtcBalance(address);
    setBtcBalance(bal);
    setBracket(getBracket(bal));
  };

  const submitProof = async () => {
    if (!wallet.isConnected) {
      await connectWallet();
      return;
    }

    if (!proofData || !bracket) return;
    setStep('submit');

    try {
      const win = window as any;
      const sn = win.starknet_argentX || win.starknet_braavos || win.starknet;
      if (!sn?.account) throw new Error('Wallet not connected');

      // Split u256 into low/high felt252 for calldata
      const splitU256 = (hex: string) => {
        const n = BigInt(hex);
        const low = (n & ((1n << 128n) - 1n)).toString();
        const high = (n >> 128n).toString();
        return [low, high];
      };

      // Verify bracket matches actual balance before submitting
      const verifyResp = await fetch(
        `/api/verify-bracket?btcAddress=${encodeURIComponent(btcAddress)}&claimedBracket=${bracket.id}`
      );
      const verifyData = await verifyResp.json();
      if (!verifyData.valid) {
        throw new Error(`Balance verification failed. Your actual bracket is ${verifyData.actualBracket}, not ${bracket.id}.`);
      }

      // Encrypt BTC address via API (key never leaves server)
      const encryptedAddr = await encryptBtcAddress(btcAddress);

      // ByteArray calldata: serialize as felt252 chunks
      const byteArrayCalldata = CallData.compile({ encrypted_btc_addr: encryptedAddr });

      const tx = await sn.account.execute([{
        contractAddress: REGISTRY_ADDRESS,
        entrypoint: 'register_proof',
        calldata: [
          ...splitU256(proofData.msgHash),
          ...splitU256(proofData.sigR),
          ...splitU256(proofData.sigS),
          proofData.yParity ? '1' : '0',
          proofData.pubkeyHash,
          bracket.id.toString(),
          ...byteArrayCalldata,
        ],
      }]);

      setTxHash(tx.transaction_hash);
      setStep('done');
    } catch (err: any) {
      setError(err.message || 'Transaction failed');
      setStep('balance');
    }
  };

  const resetFlow = () => {
    setStep('select');
    setSelectedWallet(null);
    setSignature('');
    setError('');
    setBtcAddress('');
    setBtcBalance(null);
    setBracket(null);
    setProofData(null);
  };

  return (
    <div className="page">
      <div className="card">
        <h2>Prove Bitcoin Ownership</h2>

        {/* Step 0: Wallet Selection */}
        {step === 'select' && (
          <>
            <WalletSelector onSelect={handleWalletSelect} />
          </>
        )}

        {/* Step 1: Manual Sign */}
        {step === 'sign' && selectedWallet === 'manual' && (
          <>
            <p>Copy the message below and sign it with your Bitcoin wallet.</p>
            <div className="message-box">
              <code>{message}</code>
              <button onClick={copyMessage} className="copy-btn">
                {copied ? '✅ Copied' : '📋 Copy'}
              </button>
            </div>

            <p className="note">
              Use Sparrow, Electrum, Unisat, or any wallet that supports BIP-137 message signing.
              <br />Tools → Sign/Verify Message → Paste the message → Sign
            </p>

            <div className="form-group">
              <label>Paste your signature (base64)</label>
              <textarea
                value={signature}
                onChange={e => setSignature(e.target.value)}
                placeholder="H/2BYwz8..."
                rows={3}
              />
            </div>

            <button
              onClick={() => { setStep('verify'); verifySignature(); }}
              className="primary-btn"
              disabled={!signature.trim()}
            >
              Verify Signature →
            </button>
            <button onClick={resetFlow} className="secondary-btn">
              ← Back to Wallet Selection
            </button>
          </>
        )}

        {/* Step 2: Verifying */}
        {step === 'verify' && (
          <div className="status-box">
            <div className="spinner" />
            <p>
              {selectedWallet === 'manual'
                ? 'Verifying signature & recovering public key...'
                : `Connecting to ${selectedWallet === 'xverse' ? 'Xverse' : 'Unisat'}...`}
            </p>
          </div>
        )}

        {/* Step 3: Balance & Bracket */}
        {step === 'balance' && proofData && (
          <>
            <div className="success-box">
              <h3>✅ Signature Verified!</h3>
              <div className="proof-details">
                <div className="detail">
                  <span className="label">Bitcoin Address</span>
                  <code>{btcAddress}</code>
                </div>
                <div className="detail">
                  <span className="label">Balance</span>
                  <span>{btcBalance !== null ? `${btcBalance} BTC` : 'Loading...'}</span>
                </div>
                {bracket && (
                  <div className="detail">
                    <span className="label">Bracket</span>
                    <span className="bracket-badge">{bracket.emoji} {bracket.name}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="privacy-note">
              <strong>🔒 Privacy:</strong> Only a hash of your public key will be stored on-chain.
              Your Bitcoin address and balance are never revealed.
            </div>

            <button onClick={submitProof} className="primary-btn">
              {wallet.isConnected ? `Submit Proof as ${bracket?.emoji} ${bracket?.name}` : 'Connect Wallet & Submit'}
            </button>
            <button onClick={resetFlow} className="secondary-btn">
              ← Start Over
            </button>
          </>
        )}

        {/* Step 4: Submitting */}
        {step === 'submit' && (
          <div className="status-box">
            <div className="spinner" />
            <p>Confirm transaction in your wallet...</p>
          </div>
        )}

        {/* Step 5: Done */}
        {step === 'done' && (
          <div className="success-box confetti">
            <h3>🎉 Proof Registered!</h3>
            <p>You are a verified Bitcoin <strong>{bracket?.emoji} {bracket?.name}</strong></p>
            {txHash && txHash !== 'demo-mode' && (
              <a
                href={`https://sepolia.voyager.online/tx/${txHash}`}
                target="_blank" rel="noopener"
                className="tx-link"
              >
                View Transaction ↗
              </a>
            )}
            {txHash === 'demo-mode' && (
              <p className="note">Demo mode — contract not yet deployed. Full on-chain flow coming soon!</p>
            )}
            <div className="sbt-preview">
              <div className={`sbt-card bracket-${bracket?.id}`}>
                <span className="sbt-emoji">{bracket?.emoji}</span>
                <span className="sbt-label">Verified {bracket?.name}</span>
                <span className="sbt-sub">Satoshi Proof SBT</span>
              </div>
            </div>
            <button onClick={resetFlow} className="secondary-btn" style={{ marginTop: '1rem' }}>
              Create Another Proof
            </button>
          </div>
        )}

        {error && (
          <div className="error-box">
            <p>❌ {error}</p>
            <button onClick={resetFlow} className="secondary-btn">
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
