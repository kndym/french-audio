import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

/**
 * Returns seconds from now until the next 4am Eastern Time.
 * Handles EST (UTC-5) and EDT (UTC-4) automatically.
 */
function secondsUntil4amEastern() {
  const tz = 'America/New_York';
  const now = new Date();

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', hour12: false,
    }).formatToParts(now).map(({ type, value }) => [type, value])
  );

  const currentHour = parseInt(parts.hour);
  const addDay = currentHour >= 4;

  // Get Eastern date string for the target day
  const targetBase = addDay
    ? new Date(now.getTime() + 24 * 3600 * 1000)
    : now;
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(targetBase);

  // Eastern is UTC-4 (EDT) or UTC-5 (EST); try both to find the one that
  // produces exactly 4am in the Eastern timezone
  for (const utcHour of [8, 9]) {
    const candidate = new Date(`${ymd}T${String(utcHour).padStart(2, '0')}:00:00Z`);
    const h = parseInt(
      new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour: '2-digit', hour12: false,
      }).format(candidate)
    );
    if (h === 4) {
      return Math.max(1, Math.floor((candidate.getTime() - now.getTime()) / 1000));
    }
  }

  return 24 * 3600; // fallback: 24 hours
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = req.headers['x-unlock-token'];
  if (!token || token !== process.env.UNLOCK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (typeof req.body === 'string') {
    try { req.body = JSON.parse(req.body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  }

  const body = req.body;

  if (body.unlock_until_4am === true) {
    const ttl = secondsUntil4amEastern();
    await redis.set('unlock_until_4am', 'true', { ex: ttl });
    return res.status(200).json({ ok: true, ttl });
  }

  if (typeof body.minutes === 'number') {
    await redis.incrby('pending_minutes', body.minutes);
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'Invalid body' });
}
