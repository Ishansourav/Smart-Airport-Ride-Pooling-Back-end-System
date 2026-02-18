-- Smart Airport Ride Pooling Database Schema
-- Optimized for high concurrency and fast lookups

-- Users Table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT NOT NULL,
  rating REAL DEFAULT 5.0,
  total_rides INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Passengers Table (ride requests)
CREATE TABLE IF NOT EXISTS passengers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  pickup_lat REAL NOT NULL,
  pickup_lng REAL NOT NULL,
  dropoff_lat REAL NOT NULL,
  dropoff_lng REAL NOT NULL,
  luggage_count INTEGER DEFAULT 0,
  seats_required INTEGER DEFAULT 1,
  max_detour_minutes INTEGER DEFAULT 15,
  detour_tolerance REAL DEFAULT 1.5,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'matched', 'in_transit', 'completed', 'cancelled')),
  pool_id TEXT,
  requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  matched_at DATETIME,
  completed_at DATETIME,
  cancelled_at DATETIME,
  cancellation_reason TEXT,
  base_price REAL,
  final_price REAL,
  surge_multiplier REAL DEFAULT 1.0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Pools Table (shared ride groups)
CREATE TABLE IF NOT EXISTS pools (
  id TEXT PRIMARY KEY,
  driver_id TEXT,
  vehicle_type TEXT DEFAULT 'sedan' CHECK(vehicle_type IN ('sedan', 'suv', 'van')),
  max_seats INTEGER DEFAULT 4,
  max_luggage INTEGER DEFAULT 4,
  current_seats INTEGER DEFAULT 0,
  current_luggage INTEGER DEFAULT 0,
  status TEXT DEFAULT 'forming' CHECK(status IN ('forming', 'matched', 'in_transit', 'completed')),
  total_distance REAL DEFAULT 0,
  optimized_route TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  matched_at DATETIME,
  completed_at DATETIME,
  version INTEGER DEFAULT 0
);

-- Drivers Table
CREATE TABLE IF NOT EXISTS drivers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  vehicle_type TEXT DEFAULT 'sedan',
  vehicle_number TEXT NOT NULL,
  max_seats INTEGER DEFAULT 4,
  max_luggage INTEGER DEFAULT 4,
  current_lat REAL,
  current_lng REAL,
  status TEXT DEFAULT 'available' CHECK(status IN ('available', 'assigned', 'in_transit', 'offline')),
  rating REAL DEFAULT 5.0,
  total_trips INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Route Waypoints (for optimized routing)
CREATE TABLE IF NOT EXISTS waypoints (
  id TEXT PRIMARY KEY,
  pool_id TEXT NOT NULL,
  passenger_id TEXT NOT NULL,
  sequence_order INTEGER NOT NULL,
  waypoint_type TEXT NOT NULL CHECK(waypoint_type IN ('pickup', 'dropoff')),
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  estimated_arrival DATETIME,
  actual_arrival DATETIME,
  FOREIGN KEY (pool_id) REFERENCES pools(id) ON DELETE CASCADE,
  FOREIGN KEY (passenger_id) REFERENCES passengers(id) ON DELETE CASCADE
);

-- Pricing Surge Zones (for dynamic pricing)
CREATE TABLE IF NOT EXISTS surge_zones (
  id TEXT PRIMARY KEY,
  zone_name TEXT NOT NULL,
  center_lat REAL NOT NULL,
  center_lng REAL NOT NULL,
  radius_km REAL DEFAULT 5.0,
  current_surge REAL DEFAULT 1.0,
  demand_level TEXT DEFAULT 'normal' CHECK(demand_level IN ('low', 'normal', 'high', 'very_high')),
  active_requests INTEGER DEFAULT 0,
  available_drivers INTEGER DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Locks Table (for optimistic locking and concurrency control)
CREATE TABLE IF NOT EXISTS pool_locks (
  pool_id TEXT PRIMARY KEY,
  locked_by TEXT NOT NULL,
  locked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  lock_version INTEGER DEFAULT 1
);

-- Analytics Table (for monitoring)
CREATE TABLE IF NOT EXISTS ride_analytics (
  id TEXT PRIMARY KEY,
  pool_id TEXT,
  total_passengers INTEGER,
  total_distance REAL,
  average_detour REAL,
  max_detour REAL,
  pricing_efficiency REAL,
  matching_time_ms INTEGER,
  completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pool_id) REFERENCES pools(id) ON DELETE SET NULL
);

-- Indexes for Performance Optimization

-- User lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);

-- Passenger queries - critical for matching algorithm
CREATE INDEX IF NOT EXISTS idx_passengers_status ON passengers(status);
CREATE INDEX IF NOT EXISTS idx_passengers_pool ON passengers(pool_id);
CREATE INDEX IF NOT EXISTS idx_passengers_user ON passengers(user_id);
CREATE INDEX IF NOT EXISTS idx_passengers_requested ON passengers(requested_at);
CREATE INDEX IF NOT EXISTS idx_passengers_location ON passengers(pickup_lat, pickup_lng);
CREATE INDEX IF NOT EXISTS idx_passengers_status_requested ON passengers(status, requested_at);

-- Pool queries
CREATE INDEX IF NOT EXISTS idx_pools_status ON pools(status);
CREATE INDEX IF NOT EXISTS idx_pools_driver ON pools(driver_id);
CREATE INDEX IF NOT EXISTS idx_pools_created ON pools(created_at);
CREATE INDEX IF NOT EXISTS idx_pools_status_created ON pools(status, created_at);

-- Driver queries - for availability checks
CREATE INDEX IF NOT EXISTS idx_drivers_status ON drivers(status);
CREATE INDEX IF NOT EXISTS idx_drivers_location ON drivers(current_lat, current_lng);
CREATE INDEX IF NOT EXISTS idx_drivers_status_location ON drivers(status, current_lat, current_lng);

-- Waypoint queries - for route optimization
CREATE INDEX IF NOT EXISTS idx_waypoints_pool ON waypoints(pool_id);
CREATE INDEX IF NOT EXISTS idx_waypoints_passenger ON waypoints(passenger_id);
CREATE INDEX IF NOT EXISTS idx_waypoints_sequence ON waypoints(pool_id, sequence_order);

-- Surge zone lookups
CREATE INDEX IF NOT EXISTS idx_surge_zones_location ON surge_zones(center_lat, center_lng);
CREATE INDEX IF NOT EXISTS idx_surge_zones_updated ON surge_zones(updated_at);

-- Lock management
CREATE INDEX IF NOT EXISTS idx_pool_locks_expires ON pool_locks(expires_at);
