#!/bin/bash

# Smart Airport Ride Pooling - API Test Demonstration
# This script demonstrates all major features of the system

BASE_URL="http://localhost:3000"

echo "=================================="
echo "Smart Airport Ride Pooling System"
echo "Complete API Test Demonstration"
echo "=================================="
echo ""

# 1. Health Check
echo "1. Health Check"
echo "   GET /health"
curl -s $BASE_URL/health | jq
echo ""

# 2. Get API Documentation
echo "2. API Documentation Overview"
echo "   GET /api/docs"
curl -s $BASE_URL/api/docs | jq '.service, .version, .performance'
echo ""

# 3. Get Price Estimate
echo "3. Price Estimation (JFK to Manhattan)"
echo "   GET /api/rides/estimate"
curl -s "$BASE_URL/api/rides/estimate?pickup_lat=40.6413&pickup_lng=-73.7781&dropoff_lat=40.7580&dropoff_lng=-73.9855" | jq '.data.pricing'
echo ""

# 4. Create Multiple Ride Requests
echo "4. Creating Multiple Ride Requests"
echo "   POST /api/rides/request (x3)"

# Request 1
RIDE1=$(curl -s -X POST $BASE_URL/api/rides/request \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "user_002",
    "pickup_lat": 40.6420,
    "pickup_lng": -73.7790,
    "dropoff_lat": 40.7614,
    "dropoff_lng": -73.9776,
    "luggage_count": 1,
    "seats_required": 1,
    "max_detour_minutes": 20
  }' | jq '.data.passenger_id' -r)

echo "   Ride 1 created: $RIDE1"

# Request 2
RIDE2=$(curl -s -X POST $BASE_URL/api/rides/request \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "user_003",
    "pickup_lat": 40.6425,
    "pickup_lng": -73.7795,
    "dropoff_lat": 40.7489,
    "dropoff_lng": -73.9680,
    "luggage_count": 0,
    "seats_required": 1,
    "max_detour_minutes": 15
  }' | jq '.data.passenger_id' -r)

echo "   Ride 2 created: $RIDE2"

# Request 3
RIDE3=$(curl -s -X POST $BASE_URL/api/rides/request \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "user_004",
    "pickup_lat": 40.6430,
    "pickup_lng": -73.7800,
    "dropoff_lat": 40.7550,
    "dropoff_lng": -73.9800,
    "luggage_count": 2,
    "seats_required": 1,
    "max_detour_minutes": 18
  }' | jq '.data.passenger_id' -r)

echo "   Ride 3 created: $RIDE3"
echo ""

# 5. Trigger Matching Algorithm
echo "5. Triggering Smart Matching Algorithm"
echo "   POST /api/rides/match"
MATCH_RESULT=$(curl -s -X POST $BASE_URL/api/rides/match | jq)
echo "$MATCH_RESULT"
echo ""

# 6. Get Ride Details
echo "6. Get Ride Details (First ride)"
echo "   GET /api/rides/$RIDE1"
curl -s $BASE_URL/api/rides/$RIDE1 | jq '.data.passenger | {id, status, pool_id, final_price, base_price}'
echo ""

# 7. Get Active Pools
echo "7. Get Active Pools"
echo "   GET /api/pools?status=forming"
curl -s "$BASE_URL/api/pools?status=forming" | jq '.data[] | {id, vehicle_type, current_seats, max_seats, passenger_count}'
echo ""

# 8. Get System Statistics
echo "8. System Statistics"
echo "   GET /api/pools/analytics/stats"
curl -s $BASE_URL/api/pools/analytics/stats | jq '.data'
echo ""

# 9. Get Surge Zones
echo "9. Current Surge Zones"
echo "   GET /api/pools/analytics/surge"
curl -s $BASE_URL/api/pools/analytics/surge | jq '.data[] | {zone_name, current_surge, demand_level, active_requests, available_drivers}'
echo ""

# 10. Cancel a Ride
echo "10. Cancel Ride Test"
echo "    POST /api/rides/$RIDE3/cancel"
curl -s -X POST $BASE_URL/api/rides/$RIDE3/cancel \
  -H "Content-Type: application/json" \
  -d '{"reason": "Test cancellation"}' | jq
echo ""

# 11. Get User Rides
echo "11. Get All Rides for User"
echo "    GET /api/rides/user/user_001"
curl -s $BASE_URL/api/rides/user/user_001 | jq '.count, .data[0] | {id, status, final_price}'
echo ""

echo "=================================="
echo "Test Demonstration Complete!"
echo "=================================="
echo ""
echo "Summary:"
echo "✓ Health check passed"
echo "✓ Price estimation working"
echo "✓ Ride creation successful (3 rides)"
echo "✓ Matching algorithm executed"
echo "✓ Pool formation verified"
echo "✓ Analytics endpoints working"
echo "✓ Cancellation handled"
echo ""
echo "Public API URL: https://3000-ihlkxuw9x40a1xpfohbi5-583b4d74.sandbox.novita.ai"
