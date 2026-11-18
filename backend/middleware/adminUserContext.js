import pool from '../config/database.js';

// Middleware to set user context for admin accessing user data
export const setAdminUserContext = async (req, res, next) => {
  try {
    console.log('[AdminUserContext] Request path:', req.path);
    console.log('[AdminUserContext] Request params:', req.params);
    console.log('[AdminUserContext] Query params:', req.query);
    console.log('[AdminUserContext] Body:', req.body);
    
    // Get userId from query params, body, or route params
    let userId = req.query.userId || req.body.userId;
    
    // Also check route params (e.g., /profile/:userId)
    if (!userId && req.params.userId) {
      userId = req.params.userId;
      console.log('[AdminUserContext] Found userId in route params:', userId);
    }
    
    // If still not found, try to extract from URL path
    // Pattern: /profile/:userId or /asset/:userId or /work-assets/:userId etc.
    if (!userId) {
      // Try matching common patterns: /resource/:userId or /resource/:id
      const pathMatch = req.path.match(/\/(profile|goal|expense|loan|asset|assets|work-asset|work-assets|insurance|asset-columns)\/(\d+)/);
      if (pathMatch && pathMatch[2]) {
        userId = pathMatch[2];
        console.log('[AdminUserContext] Found userId in path match:', userId);
      }
    }
    
    // Also check if userId is in the path segments
    if (!userId) {
      const pathParts = req.path.split('/').filter(p => p);
      // Look for numeric segments that could be userId
      for (const part of pathParts) {
        if (/^\d+$/.test(part)) {
          userId = part;
          console.log('[AdminUserContext] Found userId in path segments:', userId);
          break;
        }
      }
    }

    if (!userId) {
      console.error('[AdminUserContext] No userId found in request');
      return res.status(400).json({ error: 'userId is required. Please provide userId in query params, body, or URL path.' });
    }
    
    console.log('[AdminUserContext] Using userId:', userId);

    // Verify user exists and is assigned to this admin (if admin, not super admin)
    const userCheck = await pool.query(
      'SELECT id, email, name, admin_id FROM "user" WHERE id = $1 AND deleted_at IS NULL',
      [userId]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // If admin (not super admin), verify user is assigned to them
    if (req.admin.role === 'admin' && userCheck.rows[0].admin_id !== req.admin.id) {
      return res.status(403).json({ error: 'Access denied. User is not assigned to you' });
    }

    // Set user context for financial routes (override req.user)
    req.user = userCheck.rows[0];
    // Also set userId in body/query for routes that need it
    req.body.userId = userId;
    req.query.userId = userId;
    next();
  } catch (error) {
    console.error('Error setting admin user context:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

