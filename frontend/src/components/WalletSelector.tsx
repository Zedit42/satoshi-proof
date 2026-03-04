import { useState, useEffect } from 'react';
import { isXverseAvailable } from '../wallets/xverse';
import { isUnisatAvailable } from '../wallets/unisat';

export type WalletType = 'xverse' | 'unisat' | 'manual';

interface Props {
  onSelect: (walletType: WalletType) => void;
  disabled?: boolean;
}

export default function WalletSelector({ onSelect, disabled }: Props) {
  const [xverseAvailable, setXverseAvailable] = useState(false);
  const [unisatAvailable, setUnisatAvailable] = useState(false);

  useEffect(() => {
    // Check wallet availability on mount
    setXverseAvailable(isXverseAvailable());
    setUnisatAvailable(isUnisatAvailable());
  }, []);

  const wallets = [
    {
      id: 'xverse' as WalletType,
      name: 'Xverse',
      icon: '🦊',
      available: xverseAvailable,
      description: 'Browser extension wallet',
    },
    {
      id: 'unisat' as WalletType,
      name: 'Unisat',
      icon: '🟠',
      available: unisatAvailable,
      description: 'Browser extension wallet',
    },
    {
      id: 'manual' as WalletType,
      name: 'Manual Signature',
      icon: '✍️',
      available: true,
      description: 'Sign with any BIP-137 compatible wallet',
    },
  ];

  return (
    <div className="wallet-selector">
      <h3 style={{ marginBottom: '1rem', fontSize: '1.1rem', fontWeight: 600 }}>
        Choose Your Bitcoin Wallet
      </h3>
      <div className="wallet-options">
        {wallets.map((wallet) => (
          <button
            key={wallet.id}
            onClick={() => onSelect(wallet.id)}
            disabled={disabled || !wallet.available}
            className={`wallet-option ${!wallet.available ? 'unavailable' : ''}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '1rem',
              padding: '1rem',
              width: '100%',
              border: '2px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '12px',
              background: wallet.available
                ? 'rgba(255, 255, 255, 0.05)'
                : 'rgba(255, 255, 255, 0.02)',
              color: wallet.available ? '#fff' : '#666',
              cursor: wallet.available && !disabled ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s',
              textAlign: 'left',
            }}
            onMouseEnter={(e) => {
              if (wallet.available && !disabled) {
                e.currentTarget.style.borderColor = 'rgba(255, 140, 0, 0.6)';
                e.currentTarget.style.background = 'rgba(255, 140, 0, 0.1)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
              e.currentTarget.style.background = wallet.available
                ? 'rgba(255, 255, 255, 0.05)'
                : 'rgba(255, 255, 255, 0.02)';
            }}
          >
            <span style={{ fontSize: '2rem' }}>{wallet.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
                {wallet.name}
                {!wallet.available && wallet.id !== 'manual' && (
                  <span style={{ marginLeft: '0.5rem', fontSize: '0.85rem', opacity: 0.6 }}>
                    (Not installed)
                  </span>
                )}
              </div>
              <div style={{ fontSize: '0.85rem', opacity: 0.7 }}>
                {wallet.description}
              </div>
            </div>
            <span style={{ fontSize: '1.2rem', opacity: 0.5 }}>→</span>
          </button>
        ))}
      </div>

      {!xverseAvailable && !unisatAvailable && (
        <div
          style={{
            marginTop: '1rem',
            padding: '0.75rem',
            background: 'rgba(255, 165, 0, 0.1)',
            border: '1px solid rgba(255, 165, 0, 0.3)',
            borderRadius: '8px',
            fontSize: '0.9rem',
            lineHeight: 1.5,
          }}
        >
          <strong>💡 No wallet detected</strong>
          <br />
          Install{' '}
          <a
            href="https://www.xverse.app/"
            target="_blank"
            rel="noopener"
            style={{ color: '#ff8c00', textDecoration: 'underline' }}
          >
            Xverse
          </a>{' '}
          or{' '}
          <a
            href="https://unisat.io/"
            target="_blank"
            rel="noopener"
            style={{ color: '#ff8c00', textDecoration: 'underline' }}
          >
            Unisat
          </a>{' '}
          for automatic signing, or use Manual Signature with Sparrow/Electrum.
        </div>
      )}
    </div>
  );
}
