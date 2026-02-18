// Type Definitions for Smart Airport Ride Pooling System

export interface Env {
  DB: D1Database;
}

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  rating: number;
  total_rides: number;
  created_at: string;
  updated_at: string;
}

export interface Passenger {
  id: string;
  user_id: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
  luggage_count: number;
  seats_required: number;
  max_detour_minutes: number;
  detour_tolerance: number;
  status: 'pending' | 'matched' | 'in_transit' | 'completed' | 'cancelled';
  pool_id?: string;
  requested_at: string;
  matched_at?: string;
  completed_at?: string;
  cancelled_at?: string;
  cancellation_reason?: string;
  base_price?: number;
  final_price?: number;
  surge_multiplier: number;
}

export interface Pool {
  id: string;
  driver_id?: string;
  vehicle_type: 'sedan' | 'suv' | 'van';
  max_seats: number;
  max_luggage: number;
  current_seats: number;
  current_luggage: number;
  status: 'forming' | 'matched' | 'in_transit' | 'completed';
  total_distance: number;
  optimized_route?: string;
  created_at: string;
  matched_at?: string;
  completed_at?: string;
  version: number;
}

export interface Driver {
  id: string;
  user_id: string;
  vehicle_type: 'sedan' | 'suv' | 'van';
  vehicle_number: string;
  max_seats: number;
  max_luggage: number;
  current_lat?: number;
  current_lng?: number;
  status: 'available' | 'assigned' | 'in_transit' | 'offline';
  rating: number;
  total_trips: number;
  created_at: string;
  updated_at: string;
}

export interface Waypoint {
  id: string;
  pool_id: string;
  passenger_id: string;
  sequence_order: number;
  waypoint_type: 'pickup' | 'dropoff';
  lat: number;
  lng: number;
  estimated_arrival?: string;
  actual_arrival?: string;
}

export interface SurgeZone {
  id: string;
  zone_name: string;
  center_lat: number;
  center_lng: number;
  radius_km: number;
  current_surge: number;
  demand_level: 'low' | 'normal' | 'high' | 'very_high';
  active_requests: number;
  available_drivers: number;
  updated_at: string;
}

export interface PoolLock {
  pool_id: string;
  locked_by: string;
  locked_at: string;
  expires_at: string;
  lock_version: number;
}

export interface RideAnalytics {
  id: string;
  pool_id?: string;
  total_passengers: number;
  total_distance: number;
  average_detour: number;
  max_detour: number;
  pricing_efficiency: number;
  matching_time_ms: number;
  completed_at: string;
}

// Request/Response DTOs
export interface CreateRideRequest {
  user_id: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
  luggage_count?: number;
  seats_required?: number;
  max_detour_minutes?: number;
}

export interface MatchedRide {
  passenger_id: string;
  pool_id: string;
  estimated_price: number;
  estimated_pickup_time: string;
  estimated_dropoff_time: string;
  shared_with: number;
  driver_info?: Driver;
}

export interface CancellationRequest {
  passenger_id: string;
  reason?: string;
}

// Algorithm Types
export interface Location {
  lat: number;
  lng: number;
}

export interface RoutePoint extends Location {
  passenger_id: string;
  type: 'pickup' | 'dropoff';
  time_window?: number;
}

export interface OptimizedRoute {
  waypoints: RoutePoint[];
  total_distance: number;
  total_time: number;
  detours: Map<string, number>;
}

export interface MatchingResult {
  pool_id: string;
  passengers: string[];
  route: OptimizedRoute;
  pricing: Map<string, number>;
  feasible: boolean;
  efficiency_score: number;
}
