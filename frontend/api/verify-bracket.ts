import type { VercelRequest, VercelResponse } from '@vercel/node';

// Bracket definitions (same as in bitcoin.ts)
const BRACKETS = [
  { id: 0, name: 'Shrimp', range: '< 1 BTC', min: 0, max: 1 },
  { id: 1, name: 'Crab', range: '1-10 BTC', min: 1, max: 10 },
  { id: 2, name: 'Fish', range: '10-50 BTC', min: 10, max: 50 },
  { id: 3, name: 'Shark', range: '50-100 BTC', min: 50, max: 100 },
  { id: 4, name: 'Whale', range: '100+ BTC', min: 100, max: Infinity },
];

function getBracket(btcAmount: number): typeof BRACKETS[0] {
  return BRACKETS.find(b => btcAmount >= b.min && btcAmount < b.max) || BRACKETS[0];
}

async function fetchBtcBalance(address: string): Promise<number> {
  const url = `https://blockstream.info/api/address/${address}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Blockstream API error: ${res.status}`);
  
  const data = await res.json();
  const satoshis = (data.chain_stats?.funded_txo_sum || 0) - (data.chain_stats?.spent_txo_sum || 0);
  return satoshis / 100_000_000; // Convert to BTC
}

/**
 * Bracket Balance Verification API
 * GET /api/verify-bracket?btcAddress=1A1z...&claimedBracket=4
 * 
 * Verifies that a Bitcoin address belongs to the claimed bracket.
 * Returns: { valid: boolean, actualBracket: number }
 * 
 * NOTE: Balance is NOT included in response for privacy reasons.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { btcAddress, claimedBracket } = req.query;

  if (!btcAddress || typeof btcAddress !== 'string') {
    return res.status(400).json({
      error: 'Missing required parameter: btcAddress',
      usage: '/api/verify-bracket?btcAddress=<address>&claimedBracket=<0-4>',
    });
  }

  if (!claimedBracket || typeof claimedBracket !== 'string') {
    return res.status(400).json({
      error: 'Missing required parameter: claimedBracket',
      usage: '/api/verify-bracket?btcAddress=<address>&claimedBracket=<0-4>',
    });
  }

  const claimed = parseInt(claimedBracket, 10);
  if (isNaN(claimed) || claimed < 0 || claimed > 4) {
    return res.status(400).json({
      error: 'claimedBracket must be 0-4',
      brackets: BRACKETS.map(b => `${b.id}: ${b.name} (${b.range})`),
    });
  }

  try {
    const balance = await fetchBtcBalance(btcAddress);
    const actualBracket = getBracket(balance);
    const valid = actualBracket.id === claimed;

    return res.status(200).json({
      valid,
      actualBracket: actualBracket.id,
      // DO NOT include balance for privacy
    });
  } catch (err: any) {
    return res.status(500).json({
      error: 'Failed to fetch Bitcoin balance',
      details: err.message,
    });
  }
}
