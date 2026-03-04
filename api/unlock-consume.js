import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = req.headers['x-unlock-token'];
  if (!token || token !== process.env.UNLOCK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  await redis.set('pending_minutes', 0);
  return res.status(200).json({ ok: true });
}
