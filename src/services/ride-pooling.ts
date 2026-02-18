/**
 * Ride Pooling Service
 * Core business logic for smart ride pooling system
 * 
 * Handles:
 * - Ride request creation
 * - Passenger-to-pool matching
 * - Real-time cancellations
 * - Pool lifecycle management
 */

import { Env, Passenger, Pool, CreateRideRequest, MatchedRide, SurgeZone } from '../types';
import { matchPassengersToPool } from '../algorithms/matcher';
import { estimatePrice, calculateDynamicPrice } from '../algorithms/pricing';
import { haversineDistance, isWithinRadius } from '../algorithms/geometry';
import { 
  withPoolLock, 
  updatePoolWithVersionCheck, 
  generateRequestId,
  canAddPassengerAtomic
} from './concurrency';

/**
 * Create new ride request
 * 
 * Steps:
 * 1. Validate request data
 * 2. Determine surge zone and calculate price
 * 3. Create passenger record
 * 4. Attempt to match with existing pools
 * 5. Return confirmation
 * 
 * Time Complexity: O(n * m) where n = pools, m = matching complexity
 */
export async function createRideRequest(
  db: D1Database,
  request: CreateRideRequest
): Promise<{ passenger_id: string, estimated_price: number, status: string }> {
  
  const passengerId = `pass_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Determine surge zone
  const surgeZone = await findSurgeZone(db, {
    lat: request.pickup_lat,
    lng: request.pickup_lng
  });
  
  // Calculate base price
  const pricing = estimatePrice(
    { lat: request.pickup_lat, lng: request.pickup_lng },
    { lat: request.dropoff_lat, lng: request.dropoff_lng },
    'sedan',
    surgeZone || undefined
  );
  
  // Create passenger record
  const result = await db.prepare(`
    INSERT INTO passengers (
      id, user_id, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
      luggage_count, seats_required, max_detour_minutes, detour_tolerance,
      status, base_price, surge_multiplier
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).bind(
    passengerId,
    request.user_id,
    request.pickup_lat,
    request.pickup_lng,
    request.dropoff_lat,
    request.dropoff_lng,
    request.luggage_count || 0,
    request.seats_required || 1,
    request.max_detour_minutes || 15,
    1.5,
    pricing.basePrice,
    pricing.surgeMultiplier
  ).run();
  
  if (!result.success) {
    throw new Error('Failed to create ride request');
  }
  
  // Update surge zone statistics
  if (surgeZone) {
    await db.prepare(`
      UPDATE surge_zones
      SET active_requests = active_requests + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(surgeZone.id).run();
  }
  
  return {
    passenger_id: passengerId,
    estimated_price: pricing.finalPrice,
    status: 'pending'
  };
}

/**
 * Match pending passengers to pools
 * Run periodically (every 10-30 seconds) to batch-match passengers
 * 
 * Time Complexity: O(n^2 * m) worst case
 */
export async function matchPendingPassengers(
  db: D1Database
): Promise<{ matched: number, pools_created: number }> {
  
  const startTime = Date.now();
  
  // Get pending passengers
  const passengers = await db.prepare(`
    SELECT * FROM passengers
    WHERE status = 'pending'
    ORDER BY requested_at ASC
    LIMIT 100
  `).all() as { results: Passenger[] };
  
  if (passengers.results.length === 0) {
    return { matched: 0, pools_created: 0 };
  }
  
  // Get available pools that are still forming
  const pools = await db.prepare(`
    SELECT * FROM pools
    WHERE status = 'forming'
    AND created_at > datetime('now', '-10 minutes')
  `).all() as { results: Pool[] };
  
  // Run matching algorithm
  const matchingResults = await matchPassengersToPool(
    passengers.results,
    pools.results
  );
  
  let matchedCount = 0;
  let poolsCreated = 0;
  
  // Process matching results
  for (const result of matchingResults) {
    if (!result.feasible) continue;
    
    try {
      // Create new pool
      const poolId = result.pool_id;
      const vehicleType = determineVehicleType(result.passengers.length);
      const capacity = getVehicleCapacity(vehicleType);
      
      const poolResult = await db.prepare(`
        INSERT INTO pools (
          id, vehicle_type, max_seats, max_luggage,
          current_seats, current_luggage, status, total_distance,
          optimized_route, version
        ) VALUES (?, ?, ?, ?, ?, ?, 'forming', ?, ?, 0)
      `).bind(
        poolId,
        vehicleType,
        capacity.maxSeats,
        capacity.maxLuggage,
        result.passengers.length,
        result.passengers.reduce((sum, pid) => {
          const p = passengers.results.find(p => p.id === pid);
          return sum + (p?.luggage_count || 0);
        }, 0),
        result.route.total_distance,
        JSON.stringify(result.route)
      ).run();
      
      if (!poolResult.success) continue;
      
      poolsCreated++;
      
      // Update passengers
      for (const passengerId of result.passengers) {
        const finalPrice = result.pricing.get(passengerId) || 0;
        
        await db.prepare(`
          UPDATE passengers
          SET status = 'matched',
              pool_id = ?,
              final_price = ?,
              matched_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(poolId, finalPrice, passengerId).run();
        
        matchedCount++;
      }
      
      // Create waypoints
      for (let i = 0; i < result.route.waypoints.length; i++) {
        const wp = result.route.waypoints[i];
        await db.prepare(`
          INSERT INTO waypoints (
            id, pool_id, passenger_id, sequence_order,
            waypoint_type, lat, lng
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
          `wp_${poolId}_${i}`,
          poolId,
          wp.passenger_id,
          i,
          wp.type,
          wp.lat,
          wp.lng
        ).run();
      }
      
    } catch (error) {
      console.error('Failed to create pool:', error);
    }
  }
  
  const elapsedMs = Date.now() - startTime;
  console.log(`Matching completed in ${elapsedMs}ms: ${matchedCount} passengers, ${poolsCreated} pools`);
  
  return { matched: matchedCount, pools_created: poolsCreated };
}

/**
 * Cancel ride request
 * Handles concurrent cancellation safely
 * 
 * Time Complexity: O(1) for solo ride, O(n) for pooled ride
 */
export async function cancelRideRequest(
  db: D1Database,
  passengerId: string,
  reason?: string
): Promise<{ success: boolean, refund_amount?: number }> {
  
  const requestId = generateRequestId();
  
  // Get passenger details
  const passenger = await db.prepare(`
    SELECT * FROM passengers WHERE id = ?
  `).bind(passengerId).first() as Passenger | null;
  
  if (!passenger) {
    return { success: false };
  }
  
  // Check if already cancelled or completed
  if (passenger.status === 'cancelled' || passenger.status === 'completed') {
    return { success: false };
  }
  
  // If not in pool, simple cancellation
  if (!passenger.pool_id || passenger.status === 'pending') {
    await db.prepare(`
      UPDATE passengers
      SET status = 'cancelled',
          cancelled_at = CURRENT_TIMESTAMP,
          cancellation_reason = ?
      WHERE id = ?
    `).bind(reason || 'User cancelled', passengerId).run();
    
    return { success: true };
  }
  
  // If in pool, need to handle with lock
  const result = await withPoolLock(
    db,
    passenger.pool_id,
    requestId,
    async () => {
      // Remove passenger from pool
      await db.prepare(`
        UPDATE passengers
        SET status = 'cancelled',
            cancelled_at = CURRENT_TIMESTAMP,
            cancellation_reason = ?,
            pool_id = NULL
        WHERE id = ?
      `).bind(reason || 'User cancelled', passengerId).run();
      
      // Update pool capacity
      await db.prepare(`
        UPDATE pools
        SET current_seats = current_seats - ?,
            current_luggage = current_luggage - ?,
            version = version + 1
        WHERE id = ?
      `).bind(
        passenger.seats_required,
        passenger.luggage_count,
        passenger.pool_id
      ).run();
      
      // Remove waypoints
      await db.prepare(`
        DELETE FROM waypoints
        WHERE passenger_id = ?
      `).bind(passengerId).run();
      
      // Check if pool is empty, delete if so
      const pool = await db.prepare(`
        SELECT current_seats FROM pools WHERE id = ?
      `).bind(passenger.pool_id).first();
      
      if (pool && (pool.current_seats as number) <= 0) {
        await db.prepare(`
          DELETE FROM pools WHERE id = ?
        `).bind(passenger.pool_id).run();
      }
      
      return { success: true };
    }
  );
  
  return result || { success: false };
}

/**
 * Find surge zone for location
 * 
 * Time Complexity: O(z) where z = number of zones
 */
async function findSurgeZone(
  db: D1Database,
  location: { lat: number, lng: number }
): Promise<SurgeZone | null> {
  
  const zones = await db.prepare(`
    SELECT * FROM surge_zones
  `).all() as { results: SurgeZone[] };
  
  for (const zone of zones.results) {
    if (isWithinRadius(
      location,
      { lat: zone.center_lat, lng: zone.center_lng },
      zone.radius_km
    )) {
      return zone;
    }
  }
  
  return null;
}

/**
 * Determine vehicle type based on passenger count
 */
function determineVehicleType(passengerCount: number): 'sedan' | 'suv' | 'van' {
  if (passengerCount <= 2) return 'sedan';
  if (passengerCount <= 4) return 'suv';
  return 'van';
}

/**
 * Get vehicle capacity
 */
function getVehicleCapacity(type: 'sedan' | 'suv' | 'van') {
  switch (type) {
    case 'sedan': return { maxSeats: 4, maxLuggage: 3 };
    case 'suv': return { maxSeats: 6, maxLuggage: 5 };
    case 'van': return { maxSeats: 8, maxLuggage: 8 };
  }
}
