import type { VercelRequest, VercelResponse } from '@vercel/node';
import { RpcProvider, CallData } from 'starknet';
import { createDecipheriv } from 'crypto';

const ENCRYPTION_KEY = process.env.SATOSHI_PROOF_ENCRYPTION_KEY || ''; // 32-byte hex

async function decryptBtcAddress(encryptedBase64: string): Promise<string> {
  const combined = Buffer.from(encryptedBase64, 'base64');
  const iv = combined.subarray(0, 12);
  const ciphertext = combined.subarray(12, -16);
  const authTag = combined.subarray(-16);
  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext, undefined, 'utf8') + decipher.final('utf8');
}

async function fetchBtcBalance(btcAddress: string): Promise<number> {
  const resp = await fetch(`https://blockstream.info/api/address/${btcAddress}`);
  if (!resp.ok) return 0;
  const data = await resp.json() as any;
  const funded = data.chain_stats?.funded_txo_sum || 0;
  const spent = data.chain_stats?.spent_txo_sum || 0;
  return (funded - spent) / 1e8;
}

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

    const response: any = {
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
    };

    // Live balance: ?include_balance=true
    if (req.query.include_balance === 'true' && ENCRYPTION_KEY) {
      try {
        const encResult = await PROVIDER.callContract({
          contractAddress: REGISTRY_ADDRESS,
          entrypoint: 'get_encrypted_btc_addr',
          calldata: [address],
        });
        // Decode ByteArray from calldata result
        const encryptedAddr = encResult.map((f: string) =>
          String.fromCharCode(...BigInt(f).toString(16).match(/.{2}/g)!.map(h => parseInt(h, 16)))
        ).join('');

        if (encryptedAddr) {
          const btcAddress = await decryptBtcAddress(encryptedAddr);
          const liveBalance = await fetchBtcBalance(btcAddress);
          const currentBracket = BRACKETS.slice().reverse().find(b => liveBalance >= b.minBtc) || BRACKETS[0];

          response.liveBalance = {
            btc: liveBalance,
            currentBracket: {
              id: currentBracket.id,
              name: currentBracket.name,
              emoji: currentBracket.emoji,
            },
            bracketChanged: currentBracket.id !== bracketInfo.id,
            fetchedAt: new Date().toISOString(),
          };
        }
      } catch (e: any) {
        response.liveBalance = { error: 'Could not fetch live balance' };
      }
    }

    return res.status(200).json(response);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'RPC call failed' });
  }
}
