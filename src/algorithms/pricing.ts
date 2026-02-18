/**
 * Dynamic Pricing Algorithm with Surge Pricing
 * 
 * Formula Components:
 * 1. Base Price = f(distance, time, vehicle_type)
 * 2. Surge Multiplier = f(demand, supply, time_of_day, weather)
 * 3. Pool Discount = f(number_of_passengers, detour_amount)
 * 4. Final Price = Base Price × Surge × Pool Discount
 * 
 * Time Complexity: O(1) for single calculation
 * Space Complexity: O(1)
 */

import { Location, SurgeZone } from '../types';
import { haversineDistance, estimateTravelTime } from './geometry';

interface PricingFactors {
  distance: number; // km
  estimatedTime: number; // minutes
  vehicleType: 'sedan' | 'suv' | 'van';
  timeOfDay: number; // hour (0-23)
  dayOfWeek: number; // 0 = Sunday, 6 = Saturday
  weatherCondition?: 'clear' | 'rain' | 'snow';
  surgeZone?: SurgeZone;
  poolSize?: number;
  detourMinutes?: number;
}

interface PricingResult {
  basePrice: number;
  surgeMultiplier: number;
  poolDiscount: number;
  finalPrice: number;
  breakdown: PriceBreakdown;
}

interface PriceBreakdown {
  distanceCharge: number;
  timeCharge: number;
  baseAmount: number;
  surgeAmount: number;
  poolSavings: number;
  totalAmount: number;
}

// Pricing Constants
const PRICING_CONFIG = {
  // Base rates per km by vehicle type
  BASE_RATE_PER_KM: {
    sedan: 2.50,
    suv: 3.50,
    van: 4.50
  },
  
  // Time-based charges (per minute)
  TIME_RATE_PER_MIN: {
    sedan: 0.40,
    suv: 0.55,
    van: 0.70
  },
  
  // Minimum fare
  MINIMUM_FARE: {
    sedan: 8.00,
    suv: 12.00,
    van: 15.00
  },
  
  // Surge multiplier ranges
  SURGE: {
    MIN: 1.0,
    MAX: 3.5,
    BASE_DEMAND_THRESHOLD: 1.5, // demand/supply ratio
    PEAK_HOUR_MULTIPLIER: 1.3,
    WEATHER_MULTIPLIER: {
      clear: 1.0,
      rain: 1.2,
      snow: 1.5
    }
  },
  
  // Pool discount rates
  POOL_DISCOUNT: {
    PER_PASSENGER: 0.15, // 15% discount per additional passenger
    MIN_DISCOUNT: 0.50, // Max 50% discount
    DETOUR_PENALTY: 0.02 // 2% penalty per minute of detour
  }
};

/**
 * Calculate Dynamic Price
 * Main pricing function with all factors
 * 
 * Time Complexity: O(1)
 */
export function calculateDynamicPrice(factors: PricingFactors): PricingResult {
  
  // 1. Calculate base price
  const basePrice = calculateBasePrice(
    factors.distance,
    factors.estimatedTime,
    factors.vehicleType
  );
  
  // 2. Calculate surge multiplier
  const surgeMultiplier = calculateSurgeMultiplier(factors);
  
  // 3. Calculate pool discount
  const poolDiscount = calculatePoolDiscount(
    factors.poolSize,
    factors.detourMinutes
  );
  
  // 4. Calculate final price
  const priceAfterSurge = basePrice * surgeMultiplier;
  const finalPrice = priceAfterSurge * poolDiscount;
  
  // 5. Build breakdown
  const distanceCharge = factors.distance * PRICING_CONFIG.BASE_RATE_PER_KM[factors.vehicleType];
  const timeCharge = factors.estimatedTime * PRICING_CONFIG.TIME_RATE_PER_MIN[factors.vehicleType];
  const surgeAmount = priceAfterSurge - basePrice;
  const poolSavings = priceAfterSurge - finalPrice;
  
  return {
    basePrice: Math.round(basePrice * 100) / 100,
    surgeMultiplier: Math.round(surgeMultiplier * 100) / 100,
    poolDiscount: Math.round(poolDiscount * 100) / 100,
    finalPrice: Math.round(finalPrice * 100) / 100,
    breakdown: {
      distanceCharge: Math.round(distanceCharge * 100) / 100,
      timeCharge: Math.round(timeCharge * 100) / 100,
      baseAmount: Math.round(basePrice * 100) / 100,
      surgeAmount: Math.round(surgeAmount * 100) / 100,
      poolSavings: Math.round(poolSavings * 100) / 100,
      totalAmount: Math.round(finalPrice * 100) / 100
    }
  };
}

/**
 * Calculate Base Price (distance + time)
 * 
 * Time Complexity: O(1)
 */
function calculateBasePrice(
  distance: number,
  time: number,
  vehicleType: 'sedan' | 'suv' | 'van'
): number {
  
  const distanceCharge = distance * PRICING_CONFIG.BASE_RATE_PER_KM[vehicleType];
  const timeCharge = time * PRICING_CONFIG.TIME_RATE_PER_MIN[vehicleType];
  
  const basePrice = distanceCharge + timeCharge;
  const minimumFare = PRICING_CONFIG.MINIMUM_FARE[vehicleType];
  
  return Math.max(basePrice, minimumFare);
}

/**
 * Calculate Surge Multiplier
 * Based on demand/supply ratio, time, weather
 * 
 * Time Complexity: O(1)
 */
function calculateSurgeMultiplier(factors: PricingFactors): number {
  
  let surge = 1.0;
  
  // 1. Demand-based surge (from zone data)
  if (factors.surgeZone) {
    const demandSupplyRatio = factors.surgeZone.active_requests / 
                              Math.max(factors.surgeZone.available_drivers, 1);
    
    if (demandSupplyRatio > PRICING_CONFIG.SURGE.BASE_DEMAND_THRESHOLD) {
      // Exponential surge based on demand/supply ratio
      const excessDemand = demandSupplyRatio - PRICING_CONFIG.SURGE.BASE_DEMAND_THRESHOLD;
      surge += Math.min(excessDemand * 0.5, 1.5);
    }
    
    // Use zone's current surge if higher
    surge = Math.max(surge, factors.surgeZone.current_surge);
  }
  
  // 2. Time-of-day surge
  if (isPeakHour(factors.timeOfDay, factors.dayOfWeek)) {
    surge *= PRICING_CONFIG.SURGE.PEAK_HOUR_MULTIPLIER;
  }
  
  // 3. Weather-based surge
  if (factors.weatherCondition) {
    surge *= PRICING_CONFIG.SURGE.WEATHER_MULTIPLIER[factors.weatherCondition];
  }
  
  // 4. Cap surge multiplier
  surge = Math.min(surge, PRICING_CONFIG.SURGE.MAX);
  surge = Math.max(surge, PRICING_CONFIG.SURGE.MIN);
  
  return surge;
}

/**
 * Calculate Pool Discount
 * More passengers = higher discount
 * Detour penalty reduces discount
 * 
 * Time Complexity: O(1)
 */
function calculatePoolDiscount(
  poolSize?: number,
  detourMinutes?: number
): number {
  
  if (!poolSize || poolSize <= 1) {
    return 1.0; // No pool discount for solo rides
  }
  
  // Base pool discount
  const baseDiscount = PRICING_CONFIG.POOL_DISCOUNT.PER_PASSENGER * (poolSize - 1);
  
  // Detour penalty
  let detourPenalty = 0;
  if (detourMinutes && detourMinutes > 0) {
    detourPenalty = PRICING_CONFIG.POOL_DISCOUNT.DETOUR_PENALTY * detourMinutes;
  }
  
  // Net discount
  const netDiscount = baseDiscount - detourPenalty;
  
  // Ensure discount stays within bounds
  const discountMultiplier = 1 - Math.max(netDiscount, 0);
  
  return Math.max(discountMultiplier, PRICING_CONFIG.POOL_DISCOUNT.MIN_DISCOUNT);
}

/**
 * Check if current time is peak hour
 * Peak hours: 7-10 AM, 5-8 PM on weekdays
 * 
 * Time Complexity: O(1)
 */
function isPeakHour(hour: number, dayOfWeek: number): boolean {
  
  // Weekend has different peak hours
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return false;
  }
  
  // Weekday morning peak: 7-10 AM
  if (hour >= 7 && hour < 10) {
    return true;
  }
  
  // Weekday evening peak: 5-8 PM
  if (hour >= 17 && hour < 20) {
    return true;
  }
  
  return false;
}

/**
 * Update Surge Zone dynamically
 * Should be called periodically to update surge multipliers
 * 
 * Time Complexity: O(1)
 */
export function updateSurgeZone(
  activeRequests: number,
  availableDrivers: number,
  currentSurge: number
): { newSurge: number, demandLevel: 'low' | 'normal' | 'high' | 'very_high' } {
  
  const demandSupplyRatio = activeRequests / Math.max(availableDrivers, 1);
  
  let newSurge = 1.0;
  let demandLevel: 'low' | 'normal' | 'high' | 'very_high' = 'normal';
  
  // Determine demand level
  if (demandSupplyRatio < 0.5) {
    demandLevel = 'low';
    newSurge = 1.0;
  } else if (demandSupplyRatio < 1.5) {
    demandLevel = 'normal';
    newSurge = 1.0;
  } else if (demandSupplyRatio < 3.0) {
    demandLevel = 'high';
    newSurge = 1.0 + (demandSupplyRatio - 1.5) * 0.4;
  } else {
    demandLevel = 'very_high';
    newSurge = 1.6 + (demandSupplyRatio - 3.0) * 0.3;
  }
  
  // Smooth surge changes (exponential moving average)
  const ALPHA = 0.3; // Smoothing factor
  newSurge = ALPHA * newSurge + (1 - ALPHA) * currentSurge;
  
  // Cap surge
  newSurge = Math.min(newSurge, PRICING_CONFIG.SURGE.MAX);
  newSurge = Math.max(newSurge, PRICING_CONFIG.SURGE.MIN);
  
  return {
    newSurge: Math.round(newSurge * 100) / 100,
    demandLevel
  };
}

/**
 * Calculate price estimate for route
 * Helper function for API endpoints
 * 
 * Time Complexity: O(1)
 */
export function estimatePrice(
  pickup: Location,
  dropoff: Location,
  vehicleType: 'sedan' | 'suv' | 'van' = 'sedan',
  surgeZone?: SurgeZone
): PricingResult {
  
  const distance = haversineDistance(pickup, dropoff);
  const estimatedTime = estimateTravelTime(distance);
  
  const now = new Date();
  
  return calculateDynamicPrice({
    distance,
    estimatedTime,
    vehicleType,
    timeOfDay: now.getHours(),
    dayOfWeek: now.getDay(),
    weatherCondition: 'clear',
    surgeZone,
    poolSize: 1
  });
}
