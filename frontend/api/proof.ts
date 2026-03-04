import type { VercelRequest, VercelResponse } from '@vercel/node';
import { RpcProvider, CallData } from 'starknet';

const REGISTRY_ADDRESS = '0x0490029d0c2007f40a39eac70e5c728351568770248a6f29cfa42b7d9ce32c75';
const PROVIDER = new RpcProvider({ nodeUrl: 'https://rpc.starknet-testnet.lava.build' });

const BRACKETS = [
  { id: 0, name: 'Shrimp', emoji: '🦐', minBtc: 0, maxBtc: 1 },
  { id: 1, name: 'Crab', emoji: '🦀', minBtc: 1, maxBtc: 10 },
  { id: 2, name: 'Fish', emoji: '🐟', minBtc: 10, maxBtc: 50 },
  { id: 3, name: 'Shark', emoji: '🦈', minBtc: 50, maxBtc: 100 },
  { id: 4, name: 'Whale', emoji: '🐋', minBtc: 100, maxBtc: null },
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { address } = req.query;
  if (!address || typeof address !== 'string') {
    return res.status(400).json({
      error: 'Missing ?address=0x... parameter',
      usage: 'GET /api/proof?address=<starknet_address>',
      example: '/api/proof?address=0x044e59e0dd3cec8fb232e3060ffceffbe383d474955c6499b57376e55d289ff5',
    });
  }

  try {
    // Optional: max_age parameter (e.g. "30d", "7d", "90d") — default: no limit
    const maxAgeParam = req.query.max_age as string | undefined;
    let maxAgeSeconds = 0; // 0 = no limit
    if (maxAgeParam) {
      const match = maxAgeParam.match(/^(\d+)d$/);
      if (match) {
        maxAgeSeconds = parseInt(match[1]) * 86400;
      }
    }

    // get_proof(owner) → (pubkey_hash: felt252, bracket: u8, timestamp: u64, valid: bool)
    const result = await PROVIDER.callContract({
      contractAddress: REGISTRY_ADDRESS,
      entrypoint: 'get_proof',
      calldata: [address],
    });

    const pubkeyHash = result[0];
    const bracket = Number(result[1]);
    const timestamp = Number(BigInt(result[2]));
    const valid = result[3] !== '0x0';

    if (!valid) {
      return res.status(200).json({
        address,
        hasProof: false,
        message: 'No verified Bitcoin ownership proof found for this address.',
      });
    }

    // Check age if max_age was specified
    const proofAgeDays = Math.floor((Date.now() / 1000 - timestamp) / 86400);
    const expired = maxAgeSeconds > 0 && (Date.now() / 1000 - timestamp) > maxAgeSeconds;

    if (expired) {
      return res.status(200).json({
        address,
        hasProof: true,
        expired: true,
        proofAgeDays,
        message: `Proof exists but is older than ${maxAgeParam}. User should re-prove.`,
      });
    }

    const bracketInfo = BRACKETS[bracket] || BRACKETS[0];

    // Get total proof count
    let totalProofs = 0;
    try {
      const countResult = await PROVIDER.callContract({
        contractAddress: REGISTRY_ADDRESS,
        entrypoint: 'get_proof_count',
        calldata: [],
      });
      totalProofs = Number(BigInt(countResult[0]));
    } catch {}

    return res.status(200).json({
      address,
      hasProof: true,
      bracket: {
        id: bracketInfo.id,
        name: bracketInfo.name,
        emoji: bracketInfo.emoji,
        description: bracketInfo.maxBtc
          ? `${bracketInfo.minBtc}-${bracketInfo.maxBtc} BTC`
          : `${bracketInfo.minBtc}+ BTC`,
      },
      proofTimestamp: timestamp,
      proofDate: new Date(timestamp * 1000).toISOString(),
      proofAgeDays,
      expired: false,
      pubkeyHash,
      stats: { totalProofs },
      contract: REGISTRY_ADDRESS,
      network: 'starknet-sepolia',
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'RPC call failed' });
  }
}
