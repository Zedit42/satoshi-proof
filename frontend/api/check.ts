import type { VercelRequest, VercelResponse } from '@vercel/node';
import { RpcProvider } from 'starknet';

const REGISTRY_ADDRESS = '0x0490029d0c2007f40a39eac70e5c728351568770248a6f29cfa42b7d9ce32c75';
const PROVIDER = new RpcProvider({ nodeUrl: 'https://rpc.starknet-testnet.lava.build' });

/**
 * Quick boolean check: does this address have a proof at or above a minimum bracket?
 * GET /api/check?address=0x...&minBracket=2
 * 
 * Brackets: 0=Shrimp(<1 BTC), 1=Crab(1-10), 2=Fish(10-50), 3=Shark(50-100), 4=Whale(100+)
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { address, minBracket } = req.query;
  if (!address || typeof address !== 'string') {
    return res.status(400).json({
      error: 'Missing ?address=0x...&minBracket=0',
      brackets: { 0: 'Shrimp (<1 BTC)', 1: 'Crab (1-10)', 2: 'Fish (10-50)', 3: 'Shark (50-100)', 4: 'Whale (100+)' },
    });
  }

  const min = Math.max(0, Math.min(4, Number(minBracket) || 0));

  try {
    const result = await PROVIDER.callContract({
      contractAddress: REGISTRY_ADDRESS,
      entrypoint: 'has_valid_proof',
      calldata: [address, min.toString()],
    });

    const valid = result[0] !== '0x0';
    return res.status(200).json({ address, minBracket: min, eligible: valid });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
