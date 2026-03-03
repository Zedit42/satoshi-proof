import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { useState, useCallback } from 'react';
import Home from './pages/Home';
import Prove from './pages/Prove';
import Verify from './pages/Verify';
import './App.css';

export interface WalletState {
  address: string;
  isConnected: boolean;
}

function App() {
  const [wallet, setWallet] = useState<WalletState>({ address: '', isConnected: false });
  const [connecting, setConnecting] = useState(false);

  const connectWallet = useCallback(async () => {
    setConnecting(true);
    try {
      const win = window as any;
      const sn = win.starknet_argentX || win.starknet_braavos || win.starknet;
      if (!sn) {
        alert('No Starknet wallet found!\nInstall Argent X or Braavos.');
        setConnecting(false);
        return;
      }
      await sn.enable({ starknetVersion: 'v5' });
      if (sn.selectedAddress) {
        setWallet({ address: sn.selectedAddress, isConnected: true });
      }
    } catch (err) {
      console.error(err);
      alert('Wallet connection failed.');
    }
    setConnecting(false);
  }, []);

  const disconnect = () => setWallet({ address: '', isConnected: false });

  return (
    <BrowserRouter>
      <div className="app">
        <nav className="navbar">
          <Link to="/" className="logo">₿ Satoshi Proof</Link>
          <div className="nav-links">
            <Link to="/prove">Prove</Link>
            <Link to="/verify">Verify</Link>
            {wallet.isConnected ? (
              <div className="wallet-connected">
                <span className="wallet-addr">{wallet.address.slice(0, 6)}...{wallet.address.slice(-4)}</span>
                <button onClick={disconnect} className="disconnect-btn">✕</button>
              </div>
            ) : (
              <button onClick={connectWallet} className="connect-btn" disabled={connecting}>
                {connecting ? 'Connecting...' : 'Connect Wallet'}
              </button>
            )}
          </div>
        </nav>
        <main>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/prove" element={<Prove wallet={wallet} connectWallet={connectWallet} />} />
            <Route path="/verify" element={<Verify />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
