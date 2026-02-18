/**
 * Ride API Routes
 * All endpoints for ride request management
 */

import { Hono } from 'hono';
import { Env, CreateRideRequest, CancellationRequest } from '../types';
import { createRideRequest, cancelRideRequest, matchPendingPassengers } from '../services/ride-pooling';
import { estimatePrice } from '../algorithms/pricing';
import { rateLimiter, validateRequest, validateCoordinates, sanitizeInput } from '../middleware/security';

const rides = new Hono<{ Bindings: Env }>();

/**
 * POST /api/rides/request
 * Create new ride request
 * 
 * Body:
 * - user_id: string
 * - pickup_lat: number
 * - pickup_lng: number
 * - dropoff_lat: number
 * - dropoff_lng: number
 * - luggage_count?: number
 * - seats_required?: number
 * - max_detour_minutes?: number
 */
rides.post(
  '/request',
  rateLimiter('create_ride'),
  sanitizeInput(),
  validateRequest({
    user_id: 'string',
    pickup_lat: 'number',
    pickup_lng: 'number',
    dropoff_lat: 'number',
    dropoff_lng: 'number'
  }),
  validateCoordinates(),
  async (c) => {
    const db = c.env.DB;
    const body = await c.req.json() as CreateRideRequest;
    
    try {
      const result = await createRideRequest(db, body);
      
      return c.json({
        success: true,
        data: result,
        message: 'Ride request created successfully'
      }, 201);
    } catch (error) {
      console.error('Failed to create ride:', error);
      return c.json({
        success: false,
        error: 'Failed to create ride request',
        message: (error as Error).message
      }, 500);
    }
  }
);

/**
 * GET /api/rides/:id
 * Get ride details by passenger ID
 */
rides.get('/:id', async (c) => {
  const db = c.env.DB;
  const passengerId = c.req.param('id');
  
  try {
    const passenger = await db.prepare(`
      SELECT 
        p.*,
        u.name as user_name,
        u.email as user_email,
        pool.status as pool_status,
        pool.driver_id,
        pool.optimized_route
      FROM passengers p
      LEFT JOIN users u ON p.user_id = u.id
      LEFT JOIN pools pool ON p.pool_id = pool.id
      WHERE p.id = ?
    `).bind(passengerId).first();
    
    if (!passenger) {
      return c.json({
        success: false,
        error: 'Ride not found'
      }, 404);
    }
    
    // Get waypoints if in pool
    let waypoints = null;
    if (passenger.pool_id) {
      waypoints = await db.prepare(`
        SELECT * FROM waypoints
        WHERE pool_id = ?
        ORDER BY sequence_order
      `).bind(passenger.pool_id).all();
    }
    
    return c.json({
      success: true,
      data: {
        passenger,
        waypoints: waypoints?.results || []
      }
    });
  } catch (error) {
    console.error('Failed to get ride:', error);
    return c.json({
      success: false,
      error: 'Failed to retrieve ride details'
    }, 500);
  }
});

/**
 * POST /api/rides/:id/cancel
 * Cancel ride request
 * 
 * Body:
 * - reason?: string
 */
rides.post('/:id/cancel', rateLimiter(), async (c) => {
  const db = c.env.DB;
  const passengerId = c.req.param('id');
  
  try {
    const body = await c.req.json().catch(() => ({})) as CancellationRequest;
    
    const result = await cancelRideRequest(
      db,
      passengerId,
      body.reason
    );
    
    if (!result.success) {
      return c.json({
        success: false,
        error: 'Failed to cancel ride',
        message: 'Ride not found or already completed/cancelled'
      }, 400);
    }
    
    return c.json({
      success: true,
      message: 'Ride cancelled successfully',
      refund_amount: result.refund_amount || 0
    });
  } catch (error) {
    console.error('Failed to cancel ride:', error);
    return c.json({
      success: false,
      error: 'Failed to cancel ride'
    }, 500);
  }
});

/**
 * GET /api/rides/user/:userId
 * Get all rides for a user
 */
rides.get('/user/:userId', async (c) => {
  const db = c.env.DB;
  const userId = c.req.param('userId');
  const status = c.req.query('status'); // Optional filter
  
  try {
    let query = `
      SELECT p.*, pool.status as pool_status
      FROM passengers p
      LEFT JOIN pools pool ON p.pool_id = pool.id
      WHERE p.user_id = ?
    `;
    
    const params: any[] = [userId];
    
    if (status) {
      query += ` AND p.status = ?`;
      params.push(status);
    }
    
    query += ` ORDER BY p.requested_at DESC LIMIT 50`;
    
    const rides = await db.prepare(query).bind(...params).all();
    
    return c.json({
      success: true,
      data: rides.results,
      count: rides.results.length
    });
  } catch (error) {
    console.error('Failed to get user rides:', error);
    return c.json({
      success: false,
      error: 'Failed to retrieve rides'
    }, 500);
  }
});

/**
 * GET /api/rides/estimate
 * Get price estimate for route
 * 
 * Query params:
 * - pickup_lat: number
 * - pickup_lng: number
 * - dropoff_lat: number
 * - dropoff_lng: number
 * - vehicle_type?: string
 */
rides.get('/estimate', async (c) => {
  const db = c.env.DB;
  
  try {
    const pickupLat = parseFloat(c.req.query('pickup_lat') || '0');
    const pickupLng = parseFloat(c.req.query('pickup_lng') || '0');
    const dropoffLat = parseFloat(c.req.query('dropoff_lat') || '0');
    const dropoffLng = parseFloat(c.req.query('dropoff_lng') || '0');
    const vehicleType = c.req.query('vehicle_type') as 'sedan' | 'suv' | 'van' || 'sedan';
    
    if (!pickupLat || !pickupLng || !dropoffLat || !dropoffLng) {
      return c.json({
        success: false,
        error: 'Missing required coordinates'
      }, 400);
    }
    
    // Find surge zone
    const zones = await db.prepare(`
      SELECT * FROM surge_zones
    `).all();
    
    let surgeZone = null;
    for (const zone of zones.results) {
      // Simple distance check (can be optimized)
      const latDiff = Math.abs((zone.center_lat as number) - pickupLat);
      const lngDiff = Math.abs((zone.center_lng as number) - pickupLng);
      
      if (latDiff < 0.05 && lngDiff < 0.05) {
        surgeZone = zone;
        break;
      }
    }
    
    const pricing = estimatePrice(
      { lat: pickupLat, lng: pickupLng },
      { lat: dropoffLat, lng: dropoffLng },
      vehicleType,
      surgeZone || undefined
    );
    
    return c.json({
      success: true,
      data: {
        pricing,
        surge_zone: surgeZone ? {
          name: surgeZone.zone_name,
          surge: surgeZone.current_surge,
          demand_level: surgeZone.demand_level
        } : null
      }
    });
  } catch (error) {
    console.error('Failed to estimate price:', error);
    return c.json({
      success: false,
      error: 'Failed to estimate price'
    }, 500);
  }
});

/**
 * POST /api/rides/match
 * Trigger matching algorithm (admin/cron)
 */
rides.post('/match', rateLimiter('auth'), async (c) => {
  const db = c.env.DB;
  
  try {
    const result = await matchPendingPassengers(db);
    
    return c.json({
      success: true,
      data: result,
      message: `Matched ${result.matched} passengers into ${result.pools_created} pools`
    });
  } catch (error) {
    console.error('Matching failed:', error);
    return c.json({
      success: false,
      error: 'Matching algorithm failed'
    }, 500);
  }
});

export default rides;
