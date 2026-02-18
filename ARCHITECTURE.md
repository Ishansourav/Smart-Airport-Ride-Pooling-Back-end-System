# Architecture Documentation

## System Design Overview

This document provides detailed architecture and design patterns used in the Smart Airport Ride Pooling Backend System.

---

## Low-Level Design (LLD)

### Class Diagram

```
┌─────────────────────────────────┐
│         <<Interface>>           │
│          Passenger              │
├─────────────────────────────────┤
│ + id: string                    │
│ + user_id: string               │
│ + pickup_lat: number            │
│ + pickup_lng: number            │
│ + dropoff_lat: number           │
│ + dropoff_lng: number           │
│ + luggage_count: number         │
│ + seats_required: number        │
│ + max_detour_minutes: number    │
│ + status: PassengerStatus       │
│ + pool_id?: string              │
│ + base_price: number            │
│ + final_price: number           │
│ + surge_multiplier: number      │
└─────────────────────────────────┘
          ▲
          │ uses
          │
┌─────────┴───────────────────────┐
│    <<Service>>                  │
│   RidePoolingService            │
├─────────────────────────────────┤
│ - db: D1Database                │
├─────────────────────────────────┤
│ + createRideRequest()           │
│ + matchPendingPassengers()      │
│ + cancelRideRequest()           │
│ + findSurgeZone()               │
└─────────┬───────────────────────┘
          │ uses
          ↓
┌─────────────────────────────────┐
│    <<Algorithm>>                │
│   MatchingAlgorithm             │
├─────────────────────────────────┤
│ + matchPassengersToPool()       │
│ + buildSpatialClusters()        │
│ + formPoolsFromCluster()        │
│ + tryFormPool()                 │
│ + isCompatible()                │
└─────────┬───────────────────────┘
          │ uses
          ↓
┌─────────────────────────────────┐
│    <<Algorithm>>                │
│   RouteOptimizer                │
├─────────────────────────────────┤
│ + optimizeRoute()               │
│ + greedyRouteConstruction()     │
│ + twoOptOptimization()          │
│ + calculateDetours()            │
│ + calculateEfficiencyScore()    │
└─────────────────────────────────┘

┌─────────────────────────────────┐
│    <<Algorithm>>                │
│   PricingEngine                 │
├─────────────────────────────────┤
│ + calculateDynamicPrice()       │
│ + calculateBasePrice()          │
│ + calculateSurgeMultiplier()    │
│ + calculatePoolDiscount()       │
│ + estimatePrice()               │
└─────────────────────────────────┘

┌─────────────────────────────────┐
│    <<Service>>                  │
│   ConcurrencyControl            │
├─────────────────────────────────┤
│ + acquirePoolLock()             │
│ + releasePoolLock()             │
│ + withPoolLock()                │
│ + updatePoolWithVersionCheck() │
│ + retryWithBackoff()            │
└─────────────────────────────────┘
```

### Design Patterns Used

#### 1. **Repository Pattern**
- Database access abstracted through service layer
- All DB operations in `ride-pooling.ts` service
- Clean separation of data access and business logic

#### 2. **Strategy Pattern**
- Multiple pricing strategies (base, surge, pool discount)
- Pluggable matching algorithms
- Route optimization strategies (greedy, 2-opt)

#### 3. **Middleware Pattern**
- Request pipeline with composable middleware
- Security, rate limiting, validation as middleware
- Error handling middleware

#### 4. **Factory Pattern**
- Vehicle type determination
- Pool creation with capacity calculation
- Dynamic passenger grouping

#### 5. **Optimistic Locking Pattern**
- Version field on pools table
- Compare-and-swap updates
- Retry on conflict

---

## Concurrency Handling Strategy

### Problem Statement
Multiple concurrent requests can cause race conditions:
- Two passengers trying to join same pool simultaneously
- Driver assignment conflicts
- Capacity overflow
- Lost updates

### Solution: Multi-Layer Concurrency Control

#### Layer 1: Optimistic Locking
```typescript
// Version-based updates
UPDATE pools 
SET current_seats = current_seats + 1,
    version = version + 1
WHERE id = ? AND version = ?
```

**Benefits**:
- No blocking for reads
- Good performance under low contention
- Automatic conflict detection

**Drawbacks**:
- Requires retry logic
- Can fail under high contention

#### Layer 2: Distributed Locks
```typescript
// Acquire lock with TTL
INSERT INTO pool_locks (pool_id, locked_by, expires_at)
VALUES (?, ?, datetime('now', '+30 seconds'))
ON CONFLICT DO NOTHING
```

**Benefits**:
- Prevents concurrent modifications
- TTL prevents deadlocks
- Works across distributed systems

**Usage**:
```typescript
await withPoolLock(db, poolId, requestId, async () => {
  // Critical section - only one request at a time
  await updatePoolCapacity();
});
```

#### Layer 3: Atomic Operations
```sql
-- Atomic capacity check and update
UPDATE pools 
SET current_seats = current_seats + ?
WHERE id = ? 
  AND current_seats + ? <= max_seats
```

### Concurrency Scenarios

#### Scenario 1: Multiple Passengers Joining Pool
```
Time    Request A              Request B
T0      acquire lock(pool_1)
T1      check capacity ✓       wait for lock...
T2      update pool
T3      release lock
T4                             acquire lock(pool_1)
T5                             check capacity ✓
T6                             update pool
T7                             release lock
```

#### Scenario 2: Simultaneous Cancellations
```
Time    Cancel A              Cancel B
T0      acquire lock(pool_1)
T1      remove passenger A    wait for lock...
T2      update capacity
T3      release lock
T4                            acquire lock(pool_1)
T5                            remove passenger B
T6                            release lock
```

#### Scenario 3: Version Conflict
```
Time    Update A              Update B
T0      read pool v=5         read pool v=5
T1      modify pool
T2      write v=6 ✓           
T3                            write v=6 ✗ (conflict)
T4                            retry: read v=6
T5                            modify pool
T6                            write v=7 ✓
```

---

## Performance Optimizations

### Database Level

#### 1. Strategic Indexing
```sql
-- Composite index for common query
CREATE INDEX idx_passengers_status_requested 
ON passengers(status, requested_at);

-- Covers: WHERE status = 'pending' ORDER BY requested_at
-- Performance: O(log n) instead of O(n)
```

#### 2. Query Optimization
```typescript
// BAD: N+1 query problem
for (const passenger of passengers) {
  const user = await db.query('SELECT * FROM users WHERE id = ?', [passenger.user_id]);
}

// GOOD: JOIN query
const results = await db.query(`
  SELECT p.*, u.name, u.email 
  FROM passengers p 
  JOIN users u ON p.user_id = u.id
`);
```

### Algorithm Level

#### 1. Early Termination
```typescript
// Stop matching after timeout to maintain latency SLA
const startTime = Date.now();
if (Date.now() - startTime > 250) {
  break; // Prevent timeout
}
```

#### 2. Spatial Clustering
```typescript
// Instead of checking all pairs O(n²)
// Cluster nearby passengers first O(n log n) with KD-tree
const clusters = buildSpatialClusters(passengers, maxRadius);
```

#### 3. Greedy Approximation
```typescript
// Exact TSP is O(n!) - infeasible
// Greedy nearest-neighbor: O(n²) - acceptable
// 2-opt improvement: O(n²) - good approximation
```

### Application Level

#### 1. In-Memory Caching
```typescript
// Cache surge zones in memory
const surgeZoneCache = new Map<string, SurgeZone>();

// Refresh periodically instead of DB query each time
```

#### 2. Batch Processing
```typescript
// Process pending passengers in batches
const BATCH_SIZE = 100;
const passengers = await db.query(`
  SELECT * FROM passengers 
  WHERE status = 'pending' 
  LIMIT ?
`, [BATCH_SIZE]);
```

---

## Security Architecture

### Authentication & Authorization
- API key authentication (optional)
- User ID validation
- Request origin validation

### Input Validation
- Schema validation for all requests
- Coordinate range validation
- Type checking middleware

### Rate Limiting
- Per-IP rate limits
- Per-endpoint limits
- Exponential backoff on violations

### SQL Injection Prevention
- Parameterized queries only
- Input sanitization
- No dynamic SQL construction

### CORS Policy
- Configured allowed origins
- Restricted methods
- Security headers

---

## Scalability Considerations

### Horizontal Scaling
- Stateless application design
- No local state storage
- Cloudflare's edge network

### Database Sharding (Future)
- Shard by geographic region
- Route passengers to nearest shard
- Cross-shard queries for global analytics

### Caching Strategy
- Cache surge zones
- Cache vehicle capacity rules
- Cache pricing configuration

### Load Balancing
- Cloudflare automatic load balancing
- Geographic routing
- Failover support

---

## Monitoring & Observability

### Metrics to Track
- Request latency (P50, P95, P99)
- Request rate (req/s)
- Error rate (%)
- Pool formation rate
- Average pool size
- Matching success rate

### Logging Strategy
```typescript
// Structured logging
console.log({
  timestamp: new Date().toISOString(),
  level: 'info',
  event: 'ride_created',
  passenger_id: 'pass_xxx',
  estimated_price: 45.50,
  duration_ms: 123
});
```

### Health Checks
- `/health` endpoint
- Database connectivity
- Service availability

---

## Deployment Architecture

### Development
```
Local Machine
  └── PM2
      └── Wrangler Pages Dev
          └── Local D1 Database
```

### Production
```
Client Request
  ↓
Cloudflare Edge (nearest POP)
  ↓
Cloudflare Workers
  ↓
Cloudflare D1 (global replication)
```

### Benefits
- Global edge deployment
- Sub-50ms latency worldwide
- Automatic DDoS protection
- Zero-downtime deployments

---

## Complexity Analysis Summary

| Component | Time Complexity | Space Complexity | Notes |
|-----------|----------------|------------------|-------|
| Passenger Matching | O(n²×m) | O(n+k) | n=passengers, m=pool size, k=pools |
| Route Optimization | O(n²) | O(n) | Greedy + 2-opt, timeout limited |
| Dynamic Pricing | O(1) | O(1) | Constant time calculation |
| Lock Acquisition | O(1) | O(k) | k=active locks |
| Database Query | O(log n) | - | With proper indexing |

---

## Error Handling Strategy

### Error Types
1. **Validation Errors** (400) - Invalid input
2. **Authentication Errors** (401) - Missing/invalid credentials
3. **Rate Limit Errors** (429) - Too many requests
4. **Not Found Errors** (404) - Resource doesn't exist
5. **Conflict Errors** (409) - Version conflict, capacity full
6. **Server Errors** (500) - Unexpected failures

### Error Response Format
```json
{
  "success": false,
  "error": "Error type",
  "message": "Human-readable description",
  "details": ["Additional context"],
  "timestamp": "2026-02-17T09:00:00.000Z"
}
```

---

**Document Version**: 1.0  
**Last Updated**: 2026-02-17
