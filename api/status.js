import { getAll, setStatus } from './_store.js';

const ID_RE = /^\d{1,20}$/;
const VOTES = new Set(['yes', 'no']);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      return res.status(200).json(await getAll());
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      const { id, vote } = body;
      if (!ID_RE.test(String(id)) || !VOTES.has(vote)) {
        return res.status(400).json({ error: 'invalid request' });
      }
      return res.status(200).json(await setStatus(String(id), vote));
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method not allowed' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'storage error' });
  }
}
