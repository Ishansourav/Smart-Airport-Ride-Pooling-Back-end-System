/**
 * Smart Ride Pooling Matching Algorithm
 * 
 * ALGORITHM: Graph-based matching with greedy clustering
 * 
 * Approach:
 * 1. Spatial Clustering: Group nearby passengers (O(n log n) using KD-tree approximation)
 * 2. Direction Filtering: Only match passengers heading same direction
 * 3. Constraint Validation: Check seats, luggage, detour tolerance
 * 4. Route Optimization: Use TSP solver for each potential pool
 * 5. Best Match Selection: Pick configuration with highest efficiency
 * 
 * Overall Time Complexity: O(n^2 * m) where n = passengers, m = avg pool size
 * Space Complexity: O(n + k) where k = number of pools
 */

import { Passenger, Pool, MatchingResult, Location } from '../types';
import { haversineDistance, isSimilarDirection, estimateTravelTime } from './geometry';
import { optimizeRoute, calculateEfficiencyScore } from './route-optimizer';

interface MatchingConfig {
  maxPoolSize: number;
  maxSearchRadius: number; // km
  minDirectionSimilarity: number; // degrees
  maxDetourMultiplier: number;
  timeoutMs: number;
}

const DEFAULT_CONFIG: MatchingConfig = {
  maxPoolSize: 4,
  maxSearchRadius: 5.0,
  minDirectionSimilarity: 45,
  maxDetourMultiplier: 1.5,
  timeoutMs: 250
};

/**
 * Main Matching Algorithm
 * Finds optimal passenger groupings for shared rides
 * 
 * Time Complexity: O(n^2 * m) worst case
 * Space Complexity: O(n + k)
 */
export async function matchPassengersToPool(
  passengers: Passenger[],
  availablePools: Pool[],
  config: MatchingConfig = DEFAULT_CONFIG
): Promise<MatchingResult[]> {
  
  const startTime = Date.now();
  const results: MatchingResult[] = [];
  
  // Filter only pending passengers
  const pendingPassengers = passengers.filter(p => p.status === 'pending');
  
  if (pendingPassengers.length === 0) {
    return results;
  }
  
  // Sort by request time (FIFO fairness)
  pendingPassengers.sort((a, b) => 
    new Date(a.requested_at).getTime() - new Date(b.requested_at).getTime()
  );
  
  // Build spatial clusters
  const clusters = buildSpatialClusters(
    pendingPassengers,
    config.maxSearchRadius
  );
  
  // Process each cluster
  for (const cluster of clusters) {
    if (Date.now() - startTime > config.timeoutMs) {
      break; // Timeout protection
    }
    
    // Try to form pools from cluster
    const poolResults = formPoolsFromCluster(cluster, config);
    results.push(...poolResults);
  }
  
  return results;
}

/**
 * Build Spatial Clusters using Distance-Based Grouping
 * 
 * Time Complexity: O(n^2) - can be optimized with KD-tree to O(n log n)
 * Space Complexity: O(n)
 */
function buildSpatialClusters(
  passengers: Passenger[],
  maxRadius: number
): Passenger[][] {
  
  const clusters: Passenger[][] = [];
  const assigned = new Set<string>();
  
  for (const passenger of passengers) {
    if (assigned.has(passenger.id)) continue;
    
    const cluster: Passenger[] = [passenger];
    assigned.add(passenger.id);
    
    const pickupLoc: Location = {
      lat: passenger.pickup_lat,
      lng: passenger.pickup_lng
    };
    
    // Find nearby passengers
    for (const other of passengers) {
      if (assigned.has(other.id)) continue;
      
      const otherPickupLoc: Location = {
        lat: other.pickup_lat,
        lng: other.pickup_lng
      };
      
      const distance = haversineDistance(pickupLoc, otherPickupLoc);
      
      if (distance <= maxRadius) {
        cluster.push(other);
        assigned.add(other.id);
      }
    }
    
    clusters.push(cluster);
  }
  
  return clusters;
}

/**
 * Form Pools from Cluster
 * Try different combinations and pick best
 * 
 * Time Complexity: O(n^m) where m = maxPoolSize
 * Uses pruning to reduce search space
 */
function formPoolsFromCluster(
  cluster: Passenger[],
  config: MatchingConfig
): MatchingResult[] {
  
  const results: MatchingResult[] = [];
  
  // If cluster is small, try all combinations
  if (cluster.length <= config.maxPoolSize) {
    const result = tryFormPool(cluster, config);
    if (result) {
      results.push(result);
    }
    return results;
  }
  
  // For larger clusters, use greedy approach
  const remaining = [...cluster];
  
  while (remaining.length > 0) {
    // Start with first passenger
    const seed = remaining.shift()!;
    const poolCandidates: Passenger[] = [seed];
    
    // Greedily add compatible passengers
    for (let i = remaining.length - 1; i >= 0; i--) {
      if (poolCandidates.length >= config.maxPoolSize) break;
      
      const candidate = remaining[i];
      
      // Quick compatibility check
      if (isCompatible(poolCandidates, candidate, config)) {
        poolCandidates.push(candidate);
        remaining.splice(i, 1);
      }
    }
    
    // Try to form pool with selected passengers
    const result = tryFormPool(poolCandidates, config);
    if (result) {
      results.push(result);
    }
  }
  
  return results;
}

/**
 * Try to form a valid pool from passengers
 * Returns null if not feasible
 * 
 * Time Complexity: O(n^2) for route optimization
 */
function tryFormPool(
  passengers: Passenger[],
  config: MatchingConfig
): MatchingResult | null {
  
  if (passengers.length === 0) return null;
  
  // Check basic constraints
  const totalSeats = passengers.reduce((sum, p) => sum + p.seats_required, 0);
  const totalLuggage = passengers.reduce((sum, p) => sum + p.luggage_count, 0);
  
  // Determine vehicle type needed
  const vehicleType = determineVehicleType(totalSeats, totalLuggage);
  if (!vehicleType) return null;
  
  const { maxSeats, maxLuggage } = getVehicleCapacity(vehicleType);
  
  // Build constraints map
  const passengerConstraints = new Map();
  for (const passenger of passengers) {
    const directDistance = haversineDistance(
      { lat: passenger.pickup_lat, lng: passenger.pickup_lng },
      { lat: passenger.dropoff_lat, lng: passenger.dropoff_lng }
    );
    
    passengerConstraints.set(passenger.id, {
      maxDetourMinutes: passenger.max_detour_minutes,
      directDistance: directDistance,
      directTime: estimateTravelTime(directDistance),
      seatsRequired: passenger.seats_required,
      luggageCount: passenger.luggage_count
    });
  }
  
  // Calculate starting location (centroid of pickups)
  const pickupLocations = passengers.map(p => ({
    lat: p.pickup_lat,
    lng: p.pickup_lng
  }));
  
  const startLocation = calculateCentroid(pickupLocations);
  
  // Optimize route
  const route = optimizeRoute(passengers, startLocation, {
    maxSeats,
    maxLuggage,
    passengerConstraints
  });
  
  if (!route) return null;
  
  // Calculate pricing for each passenger
  const pricing = new Map<string, number>();
  for (const passenger of passengers) {
    const basePrice = passenger.base_price || 0;
    const surgeMultiplier = passenger.surge_multiplier || 1.0;
    
    // Pool discount: 15% per additional passenger
    const poolDiscount = 1 - (0.15 * (passengers.length - 1));
    const finalPrice = basePrice * surgeMultiplier * Math.max(poolDiscount, 0.50);
    
    pricing.set(passenger.id, finalPrice);
  }
  
  // Calculate efficiency score
  const efficiencyScore = calculateEfficiencyScore(route);
  
  return {
    pool_id: generatePoolId(),
    passengers: passengers.map(p => p.id),
    route,
    pricing,
    feasible: true,
    efficiency_score: efficiencyScore
  };
}

/**
 * Quick compatibility check between passengers
 * Checks direction and rough distance
 * 
 * Time Complexity: O(n)
 */
function isCompatible(
  existing: Passenger[],
  candidate: Passenger,
  config: MatchingConfig
): boolean {
  
  // Check direction compatibility with all existing passengers
  for (const passenger of existing) {
    const compatible = isSimilarDirection(
      { lat: passenger.pickup_lat, lng: passenger.pickup_lng },
      { lat: passenger.dropoff_lat, lng: passenger.dropoff_lng },
      { lat: candidate.pickup_lat, lng: candidate.pickup_lng },
      { lat: candidate.dropoff_lat, lng: candidate.dropoff_lng },
      config.minDirectionSimilarity
    );
    
    if (!compatible) return false;
  }
  
  // Check capacity
  const totalSeats = existing.reduce((sum, p) => sum + p.seats_required, 0) 
                     + candidate.seats_required;
  const totalLuggage = existing.reduce((sum, p) => sum + p.luggage_count, 0) 
                       + candidate.luggage_count;
  
  if (totalSeats > 6 || totalLuggage > 8) return false;
  
  return true;
}

/**
 * Determine appropriate vehicle type based on requirements
 */
function determineVehicleType(
  seats: number,
  luggage: number
): 'sedan' | 'suv' | 'van' | null {
  
  if (seats <= 4 && luggage <= 3) return 'sedan';
  if (seats <= 6 && luggage <= 5) return 'suv';
  if (seats <= 8 && luggage <= 8) return 'van';
  return null;
}

/**
 * Get vehicle capacity by type
 */
function getVehicleCapacity(type: 'sedan' | 'suv' | 'van'): { maxSeats: number, maxLuggage: number } {
  switch (type) {
    case 'sedan': return { maxSeats: 4, maxLuggage: 3 };
    case 'suv': return { maxSeats: 6, maxLuggage: 5 };
    case 'van': return { maxSeats: 8, maxLuggage: 8 };
  }
}

/**
 * Calculate centroid of locations
 */
function calculateCentroid(locations: Location[]): Location {
  const sumLat = locations.reduce((sum, loc) => sum + loc.lat, 0);
  const sumLng = locations.reduce((sum, loc) => sum + loc.lng, 0);
  
  return {
    lat: sumLat / locations.length,
    lng: sumLng / locations.length
  };
}

/**
 * Generate unique pool ID
 */
function generatePoolId(): string {
  return `pool_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Calculate matching score for existing pool
 * Used when trying to add passenger to existing pool
 * 
 * Time Complexity: O(1)
 */
export function calculateMatchScore(
  passenger: Passenger,
  pool: Pool
): number {
  
  let score = 100;
  
  // Penalize if pool is nearly full
  const capacityRatio = pool.current_seats / pool.max_seats;
  score -= capacityRatio * 20;
  
  // Penalize older pools (prefer matching quickly)
  const ageMinutes = (Date.now() - new Date(pool.created_at).getTime()) / 60000;
  score -= Math.min(ageMinutes * 2, 30);
  
  // Bonus for pools with similar routes (would need route data)
  
  return Math.max(score, 0);
}
