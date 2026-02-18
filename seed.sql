-- Seed Data for Smart Airport Ride Pooling System
-- Test data for development and testing

-- Insert Test Users
INSERT OR IGNORE INTO users (id, name, email, phone, rating, total_rides) VALUES 
  ('user_001', 'Alice Johnson', 'alice@example.com', '+1-555-0101', 4.8, 45),
  ('user_002', 'Bob Smith', 'bob@example.com', '+1-555-0102', 4.9, 67),
  ('user_003', 'Charlie Brown', 'charlie@example.com', '+1-555-0103', 4.7, 32),
  ('user_004', 'Diana Prince', 'diana@example.com', '+1-555-0104', 5.0, 89),
  ('user_005', 'Ethan Hunt', 'ethan@example.com', '+1-555-0105', 4.6, 28),
  ('driver_001', 'Driver One', 'driver1@example.com', '+1-555-1001', 4.9, 234),
  ('driver_002', 'Driver Two', 'driver2@example.com', '+1-555-1002', 4.8, 198),
  ('driver_003', 'Driver Three', 'driver3@example.com', '+1-555-1003', 5.0, 312);

-- Insert Test Drivers
INSERT OR IGNORE INTO drivers (id, user_id, vehicle_type, vehicle_number, max_seats, max_luggage, current_lat, current_lng, status, rating, total_trips) VALUES 
  ('drv_001', 'driver_001', 'sedan', 'ABC-1234', 4, 3, 40.7580, -73.9855, 'available', 4.9, 234),
  ('drv_002', 'driver_002', 'suv', 'XYZ-5678', 6, 5, 40.7614, -73.9776, 'available', 4.8, 198),
  ('drv_003', 'driver_003', 'van', 'DEF-9012', 8, 8, 40.7489, -73.9680, 'available', 5.0, 312);

-- Insert Surge Zones (Airport areas)
INSERT OR IGNORE INTO surge_zones (id, zone_name, center_lat, center_lng, radius_km, current_surge, demand_level, active_requests, available_drivers) VALUES 
  ('zone_jfk', 'JFK Airport', 40.6413, -73.7781, 5.0, 1.2, 'normal', 12, 8),
  ('zone_lga', 'LaGuardia Airport', 40.7769, -73.8740, 5.0, 1.5, 'high', 25, 5),
  ('zone_ewr', 'Newark Airport', 40.6895, -74.1745, 5.0, 1.0, 'low', 5, 15),
  ('zone_manhattan', 'Manhattan Downtown', 40.7580, -73.9855, 3.0, 1.8, 'very_high', 45, 12);

-- Insert Sample Pending Passengers (for matching algorithm testing)
INSERT OR IGNORE INTO passengers (id, user_id, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, luggage_count, seats_required, max_detour_minutes, status, base_price, surge_multiplier) VALUES 
  ('pass_001', 'user_001', 40.6413, -73.7781, 40.7580, -73.9855, 2, 1, 15, 'pending', 45.00, 1.2),
  ('pass_002', 'user_002', 40.6420, -73.7790, 40.7614, -73.9776, 1, 1, 20, 'pending', 47.00, 1.2),
  ('pass_003', 'user_003', 40.6425, -73.7795, 40.7489, -73.9680, 0, 1, 15, 'pending', 43.00, 1.2);

-- Insert Sample Completed Ride for Analytics
INSERT OR IGNORE INTO pools (id, driver_id, vehicle_type, max_seats, max_luggage, current_seats, current_luggage, status, total_distance, completed_at) VALUES 
  ('pool_001', 'drv_001', 'sedan', 4, 3, 3, 3, 'completed', 28.5, datetime('now', '-1 hour'));

INSERT OR IGNORE INTO passengers (id, user_id, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, luggage_count, seats_required, status, pool_id, base_price, final_price, surge_multiplier, requested_at, matched_at, completed_at) VALUES 
  ('pass_hist_001', 'user_004', 40.6413, -73.7781, 40.7580, -73.9855, 1, 1, 'completed', 'pool_001', 45.00, 38.25, 1.2, datetime('now', '-2 hours'), datetime('now', '-1 hour 50 minutes'), datetime('now', '-1 hour')),
  ('pass_hist_002', 'user_005', 40.6420, -73.7790, 40.7614, -73.9776, 1, 1, 'completed', 'pool_001', 47.00, 39.95, 1.2, datetime('now', '-2 hours'), datetime('now', '-1 hour 50 minutes'), datetime('now', '-1 hour'));
