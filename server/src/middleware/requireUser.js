import { verifyToken } from '../services/authService.js';

// JWT identity gate — applied as router-level middleware to every router
// EXCEPT /api/auth (signup/login/guest/logout are JWT-exempt by design; /me
// applies this INSIDE the auth router itself). Reads the user JWT from
// `Authorization: Bearer <jwt>` or, for the export anchor-nav download ONLY
// (which can't set headers), `?authToken=<jwt>` — scoped to GET
// /api/transactions/export exactly (mirrors how index.js's static-gate
// `?token` fallback is documented/intended for that one route; see security
// review MEDIUM-1 on the team board — the JWT fallback was previously
// honored on every route, a durable-credential-in-logs exposure since the
// JWT never expires). On success sets `req.userId = payload.sub` and
// `req.user = payload`, then calls next() — never falls through to a route
// without req.userId set. On missing/invalid/expired token, responds 401
// `{ error: 'Authentication required' }` and does not call next().
const isExportRoute = (req) =>
  req.method === 'GET' && req.baseUrl === '/api/transactions' && req.path === '/export';

export default function requireUser(req, res, next) {
  if (req.method === 'OPTIONS') return next();

  const authHeader = req.headers['authorization'];
  let token = null;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice('Bearer '.length).trim();
  } else if (isExportRoute(req) && typeof req.query.authToken === 'string' && req.query.authToken) {
    token = req.query.authToken;
  }

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const payload = verifyToken(token);
    req.userId = payload.sub;
    req.user = payload;
    return next();
  } catch {
    return res.status(401).json({ error: 'Authentication required' });
  }
}
