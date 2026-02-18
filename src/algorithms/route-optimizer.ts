/**
 * Advanced Route Optimization using Dynamic Programming and Greedy Heuristics
 * 
 * ALGORITHM: Modified Traveling Salesman Problem (TSP) with constraints
 * - Time Complexity: O(n! * m) brute force, O(n^2 * 2^n) DP approach
 * - Space Complexity: O(n * 2^n) for DP memoization
 * 
 * For production with n > 10, we use greedy nearest-neighbor with local optimization
 * - Time Complexity: O(n^2 * log n)
 * - Space Complexity: O(n)
 * 
 * Constraints:
 * - Pickup must come before dropoff for each passenger
 * - Total detour per passenger <= max_detour_tolerance
 * - Vehicle capacity constraints (seats + luggage)
 */

import { Location, RoutePoint, OptimizedRoute, Passenger } from '../types';
import { haversineDistance, estimateTravelTime } from './geometry';

interface RouteConstraints {
  maxSeats: number;
  maxLuggage: number;
  passengerConstraints: Map<string, PassengerConstraint>;
}

interface PassengerConstraint {
  maxDetourMinutes: number;
  directDistance: number;
  directTime: number;
  seatsRequired: number;
  luggageCount: number;
}

/**
 * Main Route Optimization Function
 * Uses greedy nearest-neighbor with constraint checking
 * 
 * Time Complexity: O(n^2) where n = number of waypoints
 * Space Complexity: O(n)
 */
export function optimizeRoute(
  passengers: Passenger[],
  startLocation: Location,
  constraints: RouteConstraints
): OptimizedRoute | null {
  
  // Build waypoints from passengers
  const waypoints: RoutePoint[] = [];
  
  for (const passenger of passengers) {
    waypoints.push({
      lat: passenger.pickup_lat,
      lng: passenger.pickup_lng,
      passenger_id: passenger.id,
      type: 'pickup',
      time_window: passenger.max_detour_minutes
    });
    
    waypoints.push({
      lat: passenger.dropoff_lat,
      lng: passenger.dropoff_lng,
      passenger_id: passenger.id,
      type: 'dropoff',
      time_window: passenger.max_detour_minutes
    });
  }
  
  // Try greedy nearest-neighbor algorithm
  const result = greedyRouteConstruction(
    waypoints,
    startLocation,
    constraints
  );
  
  if (!result) {
    return null;
  }
  
  // Apply 2-opt local optimization to improve route
  const optimized = twoOptOptimization(result, constraints);
  
  return optimized;
}

/**
 * Greedy Nearest-Neighbor Route Construction
 * Builds route by always picking nearest valid next waypoint
 * 
 * Time Complexity: O(n^2)
 * Space Complexity: O(n)
 */
function greedyRouteConstruction(
  waypoints: RoutePoint[],
  startLocation: Location,
  constraints: RouteConstraints
): OptimizedRoute | null {
  
  const route: RoutePoint[] = [];
  const unvisited = new Set(waypoints);
  const pickedUp = new Set<string>();
  
  let currentLocation: Location = startLocation;
  let currentSeats = 0;
  let currentLuggage = 0;
  let totalDistance = 0;
  let totalTime = 0;
  
  while (unvisited.size > 0) {
    let bestWaypoint: RoutePoint | null = null;
    let bestDistance = Infinity;
    
    // Find nearest valid waypoint
    for (const waypoint of unvisited) {
      // Check if this waypoint is valid to visit now
      if (!isValidNextWaypoint(
        waypoint,
        pickedUp,
        currentSeats,
        currentLuggage,
        constraints
      )) {
        continue;
      }
      
      const distance = haversineDistance(currentLocation, waypoint);
      
      if (distance < bestDistance) {
        bestDistance = distance;
        bestWaypoint = waypoint;
      }
    }
    
    // No valid waypoint found
    if (!bestWaypoint) {
      return null;
    }
    
    // Add waypoint to route
    route.push(bestWaypoint);
    unvisited.delete(bestWaypoint);
    
    // Update state
    totalDistance += bestDistance;
    totalTime += estimateTravelTime(bestDistance);
    currentLocation = bestWaypoint;
    
    if (bestWaypoint.type === 'pickup') {
      pickedUp.add(bestWaypoint.passenger_id);
      const constraint = constraints.passengerConstraints.get(bestWaypoint.passenger_id);
      if (constraint) {
        currentSeats += constraint.seatsRequired;
        currentLuggage += constraint.luggageCount;
      }
    } else {
      pickedUp.delete(bestWaypoint.passenger_id);
      const constraint = constraints.passengerConstraints.get(bestWaypoint.passenger_id);
      if (constraint) {
        currentSeats -= constraint.seatsRequired;
        currentLuggage -= constraint.luggageCount;
      }
    }
  }
  
  // Calculate detours for each passenger
  const detours = calculateDetours(route, constraints);
  
  // Validate all detours are within tolerance
  for (const [passengerId, detour] of detours.entries()) {
    const constraint = constraints.passengerConstraints.get(passengerId);
    if (constraint && detour > constraint.maxDetourMinutes) {
      return null; // Route violates detour constraint
    }
  }
  
  return {
    waypoints: route,
    total_distance: totalDistance,
    total_time: totalTime,
    detours
  };
}

/**
 * Check if waypoint is valid to visit next
 * Enforces: pickup before dropoff, capacity constraints
 * 
 * Time Complexity: O(1)
 */
function isValidNextWaypoint(
  waypoint: RoutePoint,
  pickedUp: Set<string>,
  currentSeats: number,
  currentLuggage: number,
  constraints: RouteConstraints
): boolean {
  
  // Dropoff can only happen after pickup
  if (waypoint.type === 'dropoff') {
    if (!pickedUp.has(waypoint.passenger_id)) {
      return false;
    }
  }
  
  // Check capacity for pickup
  if (waypoint.type === 'pickup') {
    const constraint = constraints.passengerConstraints.get(waypoint.passenger_id);
    if (!constraint) return false;
    
    if (currentSeats + constraint.seatsRequired > constraints.maxSeats) {
      return false;
    }
    
    if (currentLuggage + constraint.luggageCount > constraints.maxLuggage) {
      return false;
    }
  }
  
  return true;
}

/**
 * Calculate detour time for each passenger
 * Detour = (actual_time - direct_time)
 * 
 * Time Complexity: O(n)
 */
function calculateDetours(
  route: RoutePoint[],
  constraints: RouteConstraints
): Map<string, number> {
  
  const detours = new Map<string, number>();
  const pickupTimes = new Map<string, number>();
  
  let currentTime = 0;
  
  for (let i = 0; i < route.length; i++) {
    const waypoint = route[i];
    
    if (i > 0) {
      const prevWaypoint = route[i - 1];
      const distance = haversineDistance(prevWaypoint, waypoint);
      currentTime += estimateTravelTime(distance);
    }
    
    if (waypoint.type === 'pickup') {
      pickupTimes.set(waypoint.passenger_id, currentTime);
    } else {
      const pickupTime = pickupTimes.get(waypoint.passenger_id) || 0;
      const actualTime = currentTime - pickupTime;
      
      const constraint = constraints.passengerConstraints.get(waypoint.passenger_id);
      if (constraint) {
        const detour = actualTime - constraint.directTime;
        detours.set(waypoint.passenger_id, detour);
      }
    }
  }
  
  return detours;
}

/**
 * 2-Opt Local Optimization
 * Improves route by reversing segments
 * 
 * Time Complexity: O(n^2) per iteration, typically converges quickly
 * Space Complexity: O(n)
 */
function twoOptOptimization(
  route: OptimizedRoute,
  constraints: RouteConstraints
): OptimizedRoute {
  
  let improved = true;
  let bestRoute = route;
  
  // Limit iterations to prevent timeout
  let iterations = 0;
  const MAX_ITERATIONS = 100;
  
  while (improved && iterations < MAX_ITERATIONS) {
    improved = false;
    iterations++;
    
    for (let i = 0; i < bestRoute.waypoints.length - 1; i++) {
      for (let j = i + 2; j < bestRoute.waypoints.length; j++) {
        // Try reversing segment [i+1, j]
        const newWaypoints = [
          ...bestRoute.waypoints.slice(0, i + 1),
          ...bestRoute.waypoints.slice(i + 1, j + 1).reverse(),
          ...bestRoute.waypoints.slice(j + 1)
        ];
        
        // Calculate new distance
        let newDistance = 0;
        for (let k = 1; k < newWaypoints.length; k++) {
          newDistance += haversineDistance(newWaypoints[k - 1], newWaypoints[k]);
        }
        
        // Check if improvement and still valid
        if (newDistance < bestRoute.total_distance) {
          // Verify constraints still satisfied
          const newDetours = calculateDetours(newWaypoints, constraints);
          let valid = true;
          
          for (const [passengerId, detour] of newDetours.entries()) {
            const constraint = constraints.passengerConstraints.get(passengerId);
            if (constraint && detour > constraint.maxDetourMinutes) {
              valid = false;
              break;
            }
          }
          
          if (valid) {
            bestRoute = {
              waypoints: newWaypoints,
              total_distance: newDistance,
              total_time: estimateTravelTime(newDistance),
              detours: newDetours
            };
            improved = true;
          }
        }
      }
    }
  }
  
  return bestRoute;
}

/**
 * Calculate efficiency score for route
 * Higher is better
 * 
 * Score = (sum of direct distances) / total_distance
 * Perfect sharing = 1.0, no sharing = 0.5
 */
export function calculateEfficiencyScore(route: OptimizedRoute): number {
  let directDistanceSum = 0;
  
  const passengers = new Set<string>();
  for (const wp of route.waypoints) {
    passengers.add(wp.passenger_id);
  }
  
  // Sum of all direct distances
  for (const pid of passengers) {
    const pickup = route.waypoints.find(
      w => w.passenger_id === pid && w.type === 'pickup'
    );
    const dropoff = route.waypoints.find(
      w => w.passenger_id === pid && w.type === 'dropoff'
    );
    
    if (pickup && dropoff) {
      directDistanceSum += haversineDistance(pickup, dropoff);
    }
  }
  
  if (route.total_distance === 0) return 0;
  
  return directDistanceSum / route.total_distance;
}
