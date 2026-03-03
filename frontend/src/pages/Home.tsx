import { Link } from 'react-router-dom';

export default function Home() {
  return (
    <div className="page">
      <div className="hero">
        <h1>Prove You Own Bitcoin</h1>
        <p className="subtitle">Verify your BTC holdings on Starknet — without revealing your address.</p>
        <div className="hero-actions">
          <Link to="/prove" className="primary-btn">Start Proving</Link>
          <Link to="/verify" className="secondary-btn">Verify Someone</Link>
        </div>
      </div>

      <div className="features">
        <div className="feature">
          <span className="feature-icon">✍️</span>
          <h3>1. Sign</h3>
          <p>Sign a message with your Bitcoin wallet. Your private key never leaves your device.</p>
        </div>
        <div className="feature">
          <span className="feature-icon">🔐</span>
          <h3>2. Prove</h3>
          <p>Submit your proof on Starknet. secp256k1 signature is verified on-chain via native syscall.</p>
        </div>
        <div className="feature">
          <span className="feature-icon">🏆</span>
          <h3>3. Earn Badge</h3>
          <p>Get a Soulbound Token showing your bracket: Shrimp 🦐, Crab 🦀, Fish 🐟, Shark 🦈, or Whale 🐋</p>
        </div>
      </div>

      <div className="card">
        <h2>How It Works</h2>
        <div className="info-grid">
          <div className="info-item">
            <strong>Bitcoin Signing</strong>
            <p>You sign a message with your BTC wallet (Sparrow, Electrum, Unisat, etc). This creates a secp256k1 ECDSA signature.</p>
          </div>
          <div className="info-item">
            <strong>On-chain Verification</strong>
            <p>Starknet natively supports secp256k1 ECDSA via syscall. Your signature is verified in Cairo — no Garaga needed.</p>
          </div>
          <div className="info-item">
            <strong>Privacy</strong>
            <p>Only a hash of your public key is stored on-chain. Your Bitcoin address and balance are never revealed.</p>
          </div>
          <div className="info-item">
            <strong>Composability</strong>
            <p>Any Starknet dApp can check your proof: DAOs, lending, airdrops. "Is this user a Bitcoin Whale?"</p>
          </div>
        </div>
      </div>

      <div className="brackets-showcase">
        <h2>Bracket System</h2>
        <div className="brackets">
          <div className="bracket-card shrimp"><span className="bracket-emoji">🦐</span><span className="bracket-name">Shrimp</span><span className="bracket-range">&lt; 1 BTC</span></div>
          <div className="bracket-card crab"><span className="bracket-emoji">🦀</span><span className="bracket-name">Crab</span><span className="bracket-range">1-10 BTC</span></div>
          <div className="bracket-card fish"><span className="bracket-emoji">🐟</span><span className="bracket-name">Fish</span><span className="bracket-range">10-50 BTC</span></div>
          <div className="bracket-card shark"><span className="bracket-emoji">🦈</span><span className="bracket-name">Shark</span><span className="bracket-range">50-100 BTC</span></div>
          <div className="bracket-card whale"><span className="bracket-emoji">🐋</span><span className="bracket-name">Whale</span><span className="bracket-range">100+ BTC</span></div>
        </div>
      </div>
    </div>
  );
}
