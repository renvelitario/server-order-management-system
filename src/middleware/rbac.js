import { AppError } from '../utils/errors.js';

export const requireRole = (...allowedRoles) => {
  const roleSet = new Set(allowedRoles.map((role) => String(role).toLowerCase()));

  return (req, res, next) => {
    const currentRole = String(req.localUser?.acc_type || '').toLowerCase();

    if (!currentRole || !roleSet.has(currentRole)) {
      throw new AppError(403, 'You are not authorized to perform this action.');
    }

    next();
  };
};

export const requireAdmin = requireRole('Admin');
