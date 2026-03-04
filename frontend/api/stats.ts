import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyRateLimit } from './_rateLimit.js';
import { RpcProvider } from 'starknet';

const REGISTRY_ADDRESS = '0x0490029d0c2007f40a39eac70e5c728351568770248a6f29cfa42b7d9ce32c75';
const SBT_ADDRESS = '0x0797278852c9a390b4a4e37b7eaf3aa5e34956447ec2cdf73c746888407cd86a';
const PROVIDER = new RpcProvider({ nodeUrl: 'https://rpc.starknet-testnet.lava.build' });

/**
 * GET /api/stats — Protocol-level statistics
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!applyRateLimit(req, res)) return;

  try {
    const countResult = await PROVIDER.callContract({
      contractAddress: REGISTRY_ADDRESS,
      entrypoint: 'get_proof_count',
      calldata: [],
    });
    const totalProofs = Number(BigInt(countResult[0]));

    return res.status(200).json({
      totalProofs,
      contracts: {
        registry: REGISTRY_ADDRESS,
        sbt: SBT_ADDRESS,
      },
      network: 'starknet-sepolia',
      brackets: {
        0: { name: 'Shrimp', range: '<1 BTC' },
        1: { name: 'Crab', range: '1-10 BTC' },
        2: { name: 'Fish', range: '10-50 BTC' },
        3: { name: 'Shark', range: '50-100 BTC' },
        4: { name: 'Whale', range: '100+ BTC' },
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
