import { useState } from 'react';
import { RpcProvider } from 'starknet';
import { BRACKETS } from '../crypto/bitcoin';

const REGISTRY_ADDRESS = '0x067c5e7cb777848f97d7f2eeaffe011fa1086390f1eb713277fc6311fe0d7f11';
const PROVIDER = new RpcProvider({ nodeUrl: 'https://rpc.starknet-testnet.lava.build' });

export default function Verify() {
  const [address, setAddress] = useState('');
  const [result, setResult] = useState<{ valid: boolean; bracket: number; timestamp: number } | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');

  const checkProof = async () => {
    if (!address.trim()) return;
    setChecking(true);
    setError('');
    setResult(null);

    try {
      const res = await PROVIDER.callContract({
        contractAddress: REGISTRY_ADDRESS,
        entrypoint: 'get_proof',
        calldata: [address],
      });

      const bracket = Number(res[1]);
      const timestamp = Number(res[2]);
      const valid = res[3] !== '0x0';

      setResult({ valid, bracket, timestamp });
    } catch (err: any) {
      setError(err.message || 'Query failed');
    }
    setChecking(false);
  };

  const bracketInfo = result ? BRACKETS[result.bracket] || BRACKETS[0] : null;

  return (
    <div className="page">
      <div className="card">
        <h2>Verify a Proof</h2>
        <p>Check if a Starknet address has a verified Bitcoin ownership proof.</p>

        <div className="form-group">
          <label>Starknet Address</label>
          <input
            type="text"
            value={address}
            onChange={e => setAddress(e.target.value)}
            placeholder="0x..."
          />
        </div>

        <button onClick={checkProof} className="primary-btn" disabled={checking || !address.trim()}>
          {checking ? 'Checking...' : 'Check Proof'}
        </button>

        {result && (
          <div className={`result-box ${result.valid ? 'valid' : 'invalid'}`}>
            {result.valid ? (
              <>
                <h3>✅ Verified Bitcoin Holder</h3>
                <div className="result-details">
                  <span className="bracket-badge large">{bracketInfo?.emoji} {bracketInfo?.name}</span>
                  <p>Proof registered: {new Date(result.timestamp * 1000).toLocaleDateString()}</p>
                </div>
              </>
            ) : (
              <>
                <h3>❌ No Valid Proof</h3>
                <p>This address has no verified Bitcoin ownership proof.</p>
              </>
            )}
          </div>
        )}

        {error && <div className="error-box"><p>❌ {error}</p></div>}

      </div>

      <div className="card">
        <h2>For Developers</h2>
        <p>Any Starknet contract can check Bitcoin ownership:</p>
        <pre className="code-block">{`// Cairo — on-chain integration
let is_whale = registry.has_valid_proof(user_address, 4);

// REST API — off-chain integration
GET /api/proof?address=0x...
GET /api/check?address=0x...&minBracket=2
GET /api/stats`}</pre>

        <h3 style={{marginTop: 16}}>REST API</h3>
        <p><code>GET /api/proof?address=0x...</code> — Full proof details + bracket</p>
        <p><code>GET /api/check?address=0x...&minBracket=2</code> — Quick boolean eligibility</p>
        <p><code>GET /api/stats</code> — Total proofs & contract info</p>
      </div>
    </div>
  );
}
