import { useState } from 'react';
import type { WalletState } from '../App';
import {
  bitcoinMessageHash, hashToU256Hex, parseSignature,
  recoverPubKey, pubkeyToP2PKH, pubkeyPoseidonHash,
  getBracket, fetchBtcBalance, BRACKETS,
} from '../crypto/bitcoin';

const REGISTRY_ADDRESS = '0x067c5e7cb777848f97d7f2eeaffe011fa1086390f1eb713277fc6311fe0d7f11';
const PROOF_MESSAGE = 'Satoshi Proof: I own this Bitcoin address. Timestamp: ';

interface Props {
  wallet: WalletState;
  connectWallet: () => Promise<void>;
}

type Step = 'sign' | 'verify' | 'balance' | 'submit' | 'done';

export default function Prove({ wallet, connectWallet }: Props) {
  const [step, setStep] = useState<Step>('sign');
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

  const verifySignature = async () => {
    setError('');
    try {
      const msgHash = bitcoinMessageHash(message);
      const sig = parseSignature(signature.trim());
      const pubkey = recoverPubKey(msgHash, sig);
      const address = pubkeyToP2PKH(pubkey.compressed);
      const poseidonHash = pubkeyPoseidonHash(pubkey.x, pubkey.y);

      setBtcAddress(address);
      setProofData({
        msgHash: hashToU256Hex(msgHash),
        sigR: '0x' + sig.r.toString(16),
        sigS: '0x' + sig.s.toString(16),
        yParity: sig.yParity,
        pubkeyHash: poseidonHash,
      });

      setStep('balance');

      // Fetch balance
      const bal = await fetchBtcBalance(address);
      setBtcBalance(bal);
      setBracket(getBracket(bal));

    } catch (err: any) {
      setError(err.message || 'Invalid signature');
    }
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
        ],
      }]);

      setTxHash(tx.transaction_hash);
      setStep('done');
    } catch (err: any) {
      setError(err.message || 'Transaction failed');
      setStep('balance');
    }
  };

  return (
    <div className="page">
      <div className="card">
        <h2>Prove Bitcoin Ownership</h2>

        {/* Step 1: Sign */}
        {step === 'sign' && (
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
          </>
        )}

        {/* Step 2: Verifying */}
        {step === 'verify' && (
          <div className="status-box">
            <div className="spinner" />
            <p>Verifying signature & recovering public key...</p>
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
            <button onClick={() => { setStep('sign'); setError(''); }} className="secondary-btn">
              ← Back
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
          </div>
        )}

        {error && (
          <div className="error-box">
            <p>❌ {error}</p>
            <button onClick={() => { setError(''); setStep('sign'); }} className="secondary-btn">
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
