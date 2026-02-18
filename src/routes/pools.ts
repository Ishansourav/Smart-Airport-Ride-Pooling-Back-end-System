/**
 * Pool API Routes
 * Endpoints for pool management and monitoring
 */

import { Hono } from 'hono';
import { Env } from '../types';
import { rateLimiter } from '../middleware/security';

const pools = new Hono<{ Bindings: Env }>();

/**
 * GET /api/pools/:id
 * Get pool details with all passengers
 */
pools.get('/:id', async (c) => {
  const db = c.env.DB;
  const poolId = c.req.param('id');
  
  try {
    // Get pool details
    const pool = await db.prepare(`
      SELECT * FROM pools WHERE id = ?
    `).bind(poolId).first();
    
    if (!pool) {
      return c.json({
        success: false,
        error: 'Pool not found'
      }, 404);
    }
    
    // Get passengers in pool
    const passengers = await db.prepare(`
      SELECT 
        p.*,
        u.name as user_name,
        u.phone as user_phone
      FROM passengers p
      LEFT JOIN users u ON p.user_id = u.id
      WHERE p.pool_id = ?
    `).bind(poolId).all();
    
    // Get waypoints
    const waypoints = await db.prepare(`
      SELECT * FROM waypoints
      WHERE pool_id = ?
      ORDER BY sequence_order
    `).bind(poolId).all();
    
    return c.json({
      success: true,
      data: {
        pool,
        passengers: passengers.results,
        waypoints: waypoints.results,
        passenger_count: passengers.results.length
      }
    });
  } catch (error) {
    console.error('Failed to get pool:', error);
    return c.json({
      success: false,
      error: 'Failed to retrieve pool details'
    }, 500);
  }
});

/**
 * GET /api/pools
 * Get all active pools
 */
pools.get('/', async (c) => {
  const db = c.env.DB;
  const status = c.req.query('status') || 'forming';
  
  try {
    const pools = await db.prepare(`
      SELECT 
        p.*,
        COUNT(pass.id) as passenger_count
      FROM pools p
      LEFT JOIN passengers pass ON pass.pool_id = p.id
      WHERE p.status = ?
      GROUP BY p.id
      ORDER BY p.created_at DESC
      LIMIT 50
    `).bind(status).all();
    
    return c.json({
      success: true,
      data: pools.results,
      count: pools.results.length
    });
  } catch (error) {
    console.error('Failed to get pools:', error);
    return c.json({
      success: false,
      error: 'Failed to retrieve pools'
    }, 500);
  }
});

/**
 * GET /api/analytics/surge
 * Get current surge zones
 */
pools.get('/analytics/surge', async (c) => {
  const db = c.env.DB;
  
  try {
    const zones = await db.prepare(`
      SELECT * FROM surge_zones
      ORDER BY current_surge DESC
    `).all();
    
    return c.json({
      success: true,
      data: zones.results
    });
  } catch (error) {
    console.error('Failed to get surge zones:', error);
    return c.json({
      success: false,
      error: 'Failed to retrieve surge data'
    }, 500);
  }
});

/**
 * GET /api/analytics/stats
 * Get system statistics
 */
pools.get('/analytics/stats', async (c) => {
  const db = c.env.DB;
  
  try {
    // Get various statistics
    const pendingRides = await db.prepare(`
      SELECT COUNT(*) as count FROM passengers WHERE status = 'pending'
    `).first();
    
    const activePools = await db.prepare(`
      SELECT COUNT(*) as count FROM pools WHERE status IN ('forming', 'matched', 'in_transit')
    `).first();
    
    const completedToday = await db.prepare(`
      SELECT COUNT(*) as count FROM passengers 
      WHERE status = 'completed' 
      AND DATE(completed_at) = DATE('now')
    `).first();
    
    const avgPoolSize = await db.prepare(`
      SELECT AVG(passenger_count) as avg_size
      FROM (
        SELECT pool_id, COUNT(*) as passenger_count
        FROM passengers
        WHERE pool_id IS NOT NULL
        GROUP BY pool_id
      )
    `).first();
    
    return c.json({
      success: true,
      data: {
        pending_rides: pendingRides?.count || 0,
        active_pools: activePools?.count || 0,
        completed_today: completedToday?.count || 0,
        average_pool_size: avgPoolSize?.avg_size || 0
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Failed to get stats:', error);
    return c.json({
      success: false,
      error: 'Failed to retrieve statistics'
    }, 500);
  }
});

export default pools;
