import { supabaseAdmin } from '../db/db.js';

export const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Missing Authorization header' });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'Missing token format (Bearer ...)' });
    }

    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired token', details: error });
    }

    req.user = user;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Internal server error during authentication' });
  }
};
