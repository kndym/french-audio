import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = req.query.token;
  if (!token || token !== process.env.UNLOCK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const [pendingMinutes, unlockUntil4am] = await Promise.all([
    redis.get('pending_minutes'),
    redis.get('unlock_until_4am'),
  ]);

  return res.status(200).json({
    pending_minutes: pendingMinutes ? Number(pendingMinutes) : 0,
    unlock_until_4am: !!unlockUntil4am,
  });
}
