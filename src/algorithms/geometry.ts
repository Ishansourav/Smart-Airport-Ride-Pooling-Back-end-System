/**
 * Geometric Utilities for Location-Based Calculations
 * 
 * Time Complexity: O(1) for all operations
 * Space Complexity: O(1)
 */

import { Location } from '../types';

/**
 * Calculate Haversine distance between two coordinates
 * Returns distance in kilometers
 * 
 * Time Complexity: O(1)
 * Formula: Based on great-circle distance using Haversine formula
 */
export function haversineDistance(loc1: Location, loc2: Location): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = toRadians(loc2.lat - loc1.lat);
  const dLng = toRadians(loc2.lng - loc1.lng);
  
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(loc1.lat)) * Math.cos(toRadians(loc2.lat)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  
  return distance;
}

/**
 * Convert degrees to radians
 */
function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Calculate Manhattan distance (approximation for city grid)
 * Faster than Haversine for rough estimates
 * 
 * Time Complexity: O(1)
 */
export function manhattanDistance(loc1: Location, loc2: Location): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = Math.abs(loc2.lat - loc1.lat);
  const dLng = Math.abs(loc2.lng - loc1.lng);
  
  return R * (dLat + dLng) * (Math.PI / 180);
}

/**
 * Check if location is within radius of center point
 * Used for surge zone detection
 * 
 * Time Complexity: O(1)
 */
export function isWithinRadius(
  point: Location, 
  center: Location, 
  radiusKm: number
): boolean {
  return haversineDistance(point, center) <= radiusKm;
}

/**
 * Calculate bearing between two points (direction in degrees)
 * Returns value between 0-360 degrees
 * 
 * Time Complexity: O(1)
 */
export function calculateBearing(loc1: Location, loc2: Location): number {
  const lat1 = toRadians(loc1.lat);
  const lat2 = toRadians(loc2.lat);
  const dLng = toRadians(loc2.lng - loc1.lng);
  
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) -
            Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  
  let bearing = Math.atan2(y, x);
  bearing = bearing * (180 / Math.PI);
  bearing = (bearing + 360) % 360;
  
  return bearing;
}

/**
 * Estimate travel time based on distance
 * Assumes average city speed of 30 km/h
 * 
 * Time Complexity: O(1)
 * Returns time in minutes
 */
export function estimateTravelTime(distanceKm: number): number {
  const AVERAGE_SPEED_KMH = 30;
  return (distanceKm / AVERAGE_SPEED_KMH) * 60;
}

/**
 * Calculate centroid of multiple locations
 * Used for finding optimal pickup point for pool
 * 
 * Time Complexity: O(n) where n is number of locations
 */
export function calculateCentroid(locations: Location[]): Location {
  if (locations.length === 0) {
    throw new Error('Cannot calculate centroid of empty locations');
  }
  
  let sumLat = 0;
  let sumLng = 0;
  
  for (const loc of locations) {
    sumLat += loc.lat;
    sumLng += loc.lng;
  }
  
  return {
    lat: sumLat / locations.length,
    lng: sumLng / locations.length
  };
}

/**
 * Check if two routes are heading in similar direction
 * Uses bearing comparison with threshold
 * 
 * Time Complexity: O(1)
 */
export function isSimilarDirection(
  loc1Start: Location,
  loc1End: Location,
  loc2Start: Location,
  loc2End: Location,
  thresholdDegrees: number = 45
): boolean {
  const bearing1 = calculateBearing(loc1Start, loc1End);
  const bearing2 = calculateBearing(loc2Start, loc2End);
  
  let diff = Math.abs(bearing1 - bearing2);
  if (diff > 180) {
    diff = 360 - diff;
  }
  
  return diff <= thresholdDegrees;
}
