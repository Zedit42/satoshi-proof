import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createCipheriv, randomBytes } from 'crypto';

const ENCRYPTION_KEY = process.env.SATOSHI_PROOF_ENCRYPTION_KEY || '';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const { btcAddress } = req.body;
  if (!btcAddress || typeof btcAddress !== 'string') {
    return res.status(400).json({ error: 'Missing btcAddress' });
  }

  if (!ENCRYPTION_KEY) {
    return res.status(500).json({ error: 'Encryption not configured' });
  }

  try {
    const key = Buffer.from(ENCRYPTION_KEY, 'hex');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(btcAddress, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // iv (12) + ciphertext + authTag (16) → base64
    const combined = Buffer.concat([iv, encrypted, authTag]);
    const encryptedBase64 = combined.toString('base64');

    return res.status(200).json({ encrypted: encryptedBase64 });
  } catch (err: any) {
    return res.status(500).json({ error: 'Encryption failed' });
  }
}
