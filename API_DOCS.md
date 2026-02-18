# API Documentation

Complete API reference for Smart Airport Ride Pooling Backend System.

---

## Base URLs

- **Development**: `http://localhost:3000`
- **Production**: `https://your-project.pages.dev`

---

## Authentication

Currently optional. For production, include API key in header:

```
X-API-Key: your-api-key-here
```

---

## Rate Limits

| Endpoint Type | Limit | Window |
|--------------|-------|--------|
| Default | 100 requests | 1 minute |
| Ride Creation | 10 requests | 1 minute |
| Auth Operations | 20 requests | 1 minute |

Rate limit headers included in response:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1708167900
```

---

## Endpoints

### Health & Info

#### GET /health
Health check endpoint

**Response 200**:
```json
{
  "status": "healthy",
  "timestamp": "2026-02-17T09:00:00.000Z",
  "service": "Smart Airport Ride Pooling API",
  "version": "1.0.0"
}
```

#### GET /api/docs
API documentation overview

**Response 200**:
```json
{
  "service": "Smart Airport Ride Pooling API",
  "version": "1.0.0",
  "endpoints": { ... },
  "algorithms": { ... },
  "performance": { ... }
}
```

---

### Ride Management

#### POST /api/rides/request
Create a new ride request

**Request Body**:
```json
{
  "user_id": "user_001",
  "pickup_lat": 40.6413,
  "pickup_lng": -73.7781,
  "dropoff_lat": 40.7580,
  "dropoff_lng": -73.9855,
  "luggage_count": 2,
  "seats_required": 1,
  "max_detour_minutes": 15
}
```

**Field Descriptions**:
- `user_id` (required): User identifier
- `pickup_lat` (required): Pickup latitude (-90 to 90)
- `pickup_lng` (required): Pickup longitude (-180 to 180)
- `dropoff_lat` (required): Dropoff latitude (-90 to 90)
- `dropoff_lng` (required): Dropoff longitude (-180 to 180)
- `luggage_count` (optional): Number of luggage pieces (default: 0)
- `seats_required` (optional): Number of seats needed (default: 1)
- `max_detour_minutes` (optional): Maximum acceptable detour (default: 15)

**Response 201**:
```json
{
  "success": true,
  "data": {
    "passenger_id": "pass_1771319748353_ksjfr7xea",
    "estimated_price": 45.50,
    "status": "pending"
  },
  "message": "Ride request created successfully"
}
```

**Response 400** (Validation Error):
```json
{
  "error": "Validation failed",
  "details": [
    "Missing required field: user_id",
    "pickup_lat must be between -90 and 90"
  ]
}
```

**Response 429** (Rate Limit):
```json
{
  "error": "Rate limit exceeded",
  "retry_after_seconds": 45
}
```

---

#### GET /api/rides/:id
Get ride details by passenger ID

**Path Parameters**:
- `id`: Passenger ID

**Response 200**:
```json
{
  "success": true,
  "data": {
    "passenger": {
      "id": "pass_xxx",
      "user_id": "user_001",
      "user_name": "Alice Johnson",
      "user_email": "alice@example.com",
      "pickup_lat": 40.6413,
      "pickup_lng": -73.7781,
      "dropoff_lat": 40.7580,
      "dropoff_lng": -73.9855,
      "luggage_count": 2,
      "seats_required": 1,
      "status": "matched",
      "pool_id": "pool_xxx",
      "base_price": 45.00,
      "final_price": 38.25,
      "surge_multiplier": 1.2,
      "requested_at": "2026-02-17T09:00:00.000Z",
      "matched_at": "2026-02-17T09:05:00.000Z"
    },
    "waypoints": [
      {
        "id": "wp_xxx_0",
        "pool_id": "pool_xxx",
        "passenger_id": "pass_xxx",
        "sequence_order": 0,
        "waypoint_type": "pickup",
        "lat": 40.6413,
        "lng": -73.7781
      }
    ]
  }
}
```

**Response 404**:
```json
{
  "success": false,
  "error": "Ride not found"
}
```

---

#### POST /api/rides/:id/cancel
Cancel a ride request

**Path Parameters**:
- `id`: Passenger ID

**Request Body** (optional):
```json
{
  "reason": "User requested cancellation"
}
```

**Response 200**:
```json
{
  "success": true,
  "message": "Ride cancelled successfully",
  "refund_amount": 0
}
```

**Response 400**:
```json
{
  "success": false,
  "error": "Failed to cancel ride",
  "message": "Ride not found or already completed/cancelled"
}
```

---

#### GET /api/rides/user/:userId
Get all rides for a user

**Path Parameters**:
- `userId`: User ID

**Query Parameters**:
- `status` (optional): Filter by status (pending, matched, in_transit, completed, cancelled)

**Response 200**:
```json
{
  "success": true,
  "data": [
    {
      "id": "pass_xxx",
      "user_id": "user_001",
      "pickup_lat": 40.6413,
      "pickup_lng": -73.7781,
      "dropoff_lat": 40.7580,
      "dropoff_lng": -73.9855,
      "status": "completed",
      "pool_status": "completed",
      "final_price": 38.25,
      "requested_at": "2026-02-17T08:00:00.000Z",
      "completed_at": "2026-02-17T09:00:00.000Z"
    }
  ],
  "count": 1
}
```

---

#### GET /api/rides/estimate
Get price estimate for a route

**Query Parameters**:
- `pickup_lat` (required): Pickup latitude
- `pickup_lng` (required): Pickup longitude
- `dropoff_lat` (required): Dropoff latitude
- `dropoff_lng` (required): Dropoff longitude
- `vehicle_type` (optional): sedan/suv/van (default: sedan)

**Example**:
```
GET /api/rides/estimate?pickup_lat=40.6413&pickup_lng=-73.7781&dropoff_lat=40.7580&dropoff_lng=-73.9855&vehicle_type=sedan
```

**Response 200**:
```json
{
  "success": true,
  "data": {
    "pricing": {
      "basePrice": 45.00,
      "surgeMultiplier": 1.20,
      "poolDiscount": 1.00,
      "finalPrice": 54.00,
      "breakdown": {
        "distanceCharge": 35.00,
        "timeCharge": 10.00,
        "baseAmount": 45.00,
        "surgeAmount": 9.00,
        "poolSavings": 0.00,
        "totalAmount": 54.00
      }
    },
    "surge_zone": {
      "name": "JFK Airport",
      "surge": 1.2,
      "demand_level": "normal"
    }
  }
}
```

---

#### POST /api/rides/match
Trigger passenger matching algorithm (admin/cron)

**Response 200**:
```json
{
  "success": true,
  "data": {
    "matched": 12,
    "pools_created": 4
  },
  "message": "Matched 12 passengers into 4 pools"
}
```

---

### Pool Management

#### GET /api/pools/:id
Get pool details with all passengers

**Path Parameters**:
- `id`: Pool ID

**Response 200**:
```json
{
  "success": true,
  "data": {
    "pool": {
      "id": "pool_xxx",
      "driver_id": "drv_001",
      "vehicle_type": "sedan",
      "max_seats": 4,
      "max_luggage": 3,
      "current_seats": 3,
      "current_luggage": 3,
      "status": "matched",
      "total_distance": 28.5,
      "optimized_route": "{ ... }",
      "created_at": "2026-02-17T09:00:00.000Z",
      "version": 2
    },
    "passengers": [
      {
        "id": "pass_001",
        "user_name": "Alice Johnson",
        "user_phone": "+1-555-0101",
        "pickup_lat": 40.6413,
        "pickup_lng": -73.7781,
        "dropoff_lat": 40.7580,
        "dropoff_lng": -73.9855,
        "luggage_count": 1,
        "seats_required": 1,
        "status": "matched",
        "final_price": 38.25
      }
    ],
    "waypoints": [ ... ],
    "passenger_count": 3
  }
}
```

---

#### GET /api/pools
Get all active pools

**Query Parameters**:
- `status` (optional): Filter by status (forming, matched, in_transit, completed)

**Response 200**:
```json
{
  "success": true,
  "data": [
    {
      "id": "pool_xxx",
      "driver_id": "drv_001",
      "vehicle_type": "sedan",
      "max_seats": 4,
      "current_seats": 3,
      "status": "forming",
      "total_distance": 28.5,
      "created_at": "2026-02-17T09:00:00.000Z",
      "passenger_count": 3
    }
  ],
  "count": 1
}
```

---

### Analytics

#### GET /api/pools/analytics/surge
Get current surge zones

**Response 200**:
```json
{
  "success": true,
  "data": [
    {
      "id": "zone_jfk",
      "zone_name": "JFK Airport",
      "center_lat": 40.6413,
      "center_lng": -73.7781,
      "radius_km": 5.0,
      "current_surge": 1.2,
      "demand_level": "normal",
      "active_requests": 12,
      "available_drivers": 8,
      "updated_at": "2026-02-17T09:00:00.000Z"
    }
  ]
}
```

---

#### GET /api/pools/analytics/stats
Get system statistics

**Response 200**:
```json
{
  "success": true,
  "data": {
    "pending_rides": 25,
    "active_pools": 8,
    "completed_today": 147,
    "average_pool_size": 2.8
  },
  "timestamp": "2026-02-17T09:00:00.000Z"
}
```

---

## Error Responses

### Common Error Codes

| Code | Meaning | Description |
|------|---------|-------------|
| 400 | Bad Request | Invalid input, validation failed |
| 401 | Unauthorized | Missing or invalid API key |
| 404 | Not Found | Resource doesn't exist |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Server-side error |

### Error Response Format

```json
{
  "success": false,
  "error": "Error Type",
  "message": "Human-readable description",
  "details": ["Additional context if applicable"],
  "timestamp": "2026-02-17T09:00:00.000Z"
}
```

---

## Webhooks (Future)

To be implemented:
- Ride status updates
- Pool formation notifications
- Driver assignment alerts

---

## SDK Examples

### JavaScript/TypeScript

```typescript
const API_BASE = 'http://localhost:3000';

// Create ride request
async function createRide() {
  const response = await fetch(`${API_BASE}/api/rides/request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': 'your-api-key'
    },
    body: JSON.stringify({
      user_id: 'user_001',
      pickup_lat: 40.6413,
      pickup_lng: -73.7781,
      dropoff_lat: 40.7580,
      dropoff_lng: -73.9855,
      luggage_count: 2,
      seats_required: 1
    })
  });
  
  return await response.json();
}

// Get ride details
async function getRide(passengerId: string) {
  const response = await fetch(`${API_BASE}/api/rides/${passengerId}`);
  return await response.json();
}

// Cancel ride
async function cancelRide(passengerId: string, reason: string) {
  const response = await fetch(`${API_BASE}/api/rides/${passengerId}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason })
  });
  
  return await response.json();
}
```

### cURL Examples

```bash
# Create ride
curl -X POST http://localhost:3000/api/rides/request \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "user_001",
    "pickup_lat": 40.6413,
    "pickup_lng": -73.7781,
    "dropoff_lat": 40.7580,
    "dropoff_lng": -73.9855
  }'

# Get ride details
curl http://localhost:3000/api/rides/pass_xxx

# Cancel ride
curl -X POST http://localhost:3000/api/rides/pass_xxx/cancel \
  -H "Content-Type: application/json" \
  -d '{"reason": "User cancelled"}'

# Get price estimate
curl "http://localhost:3000/api/rides/estimate?pickup_lat=40.6413&pickup_lng=-73.7781&dropoff_lat=40.7580&dropoff_lng=-73.9855"

# Get system stats
curl http://localhost:3000/api/pools/analytics/stats
```

---

## Changelog

### v1.0.0 (2026-02-17)
- Initial API release
- Complete ride management endpoints
- Pool analytics endpoints
- Dynamic pricing with surge detection
- Real-time cancellation support

---

**API Version**: 1.0.0  
**Last Updated**: 2026-02-17
