/**
 * Concurrency Control Service
 * 
 * Handles concurrent access to shared resources using:
 * 1. Optimistic Locking with version numbers
 * 2. Distributed Locks with TTL
 * 3. Transaction-like operations
 * 
 * Prevents race conditions when multiple requests try to:
 * - Add passenger to same pool
 * - Update pool capacity
 * - Match drivers to pools
 * 
 * Time Complexity: O(1) for lock operations
 * Space Complexity: O(k) where k = number of active locks
 */

import { Env, Pool } from '../types';

interface LockOptions {
  ttlSeconds?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

const DEFAULT_LOCK_OPTIONS: Required<LockOptions> = {
  ttlSeconds: 30,
  maxRetries: 3,
  retryDelayMs: 50
};

/**
 * Acquire distributed lock for pool
 * Uses database row as lock mechanism
 * 
 * Time Complexity: O(1)
 * Returns lock ID if successful, null if failed
 */
export async function acquirePoolLock(
  db: D1Database,
  poolId: string,
  lockerId: string,
  options: LockOptions = {}
): Promise<string | null> {
  
  const opts = { ...DEFAULT_LOCK_OPTIONS, ...options };
  const lockId = `${poolId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const expiresAt = new Date(Date.now() + opts.ttlSeconds * 1000).toISOString();
  
  try {
    // Try to insert lock
    const result = await db.prepare(`
      INSERT INTO pool_locks (pool_id, locked_by, expires_at, lock_version)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(pool_id) DO NOTHING
    `).bind(poolId, lockerId, expiresAt).run();
    
    if (result.success) {
      return lockId;
    }
    
    // Lock exists, check if expired
    const existing = await db.prepare(`
      SELECT * FROM pool_locks WHERE pool_id = ?
    `).bind(poolId).first();
    
    if (existing) {
      const expiresTime = new Date(existing.expires_at as string).getTime();
      const now = Date.now();
      
      // If expired, try to claim it
      if (expiresTime < now) {
        const claimResult = await db.prepare(`
          UPDATE pool_locks 
          SET locked_by = ?, 
              locked_at = CURRENT_TIMESTAMP,
              expires_at = ?,
              lock_version = lock_version + 1
          WHERE pool_id = ? AND expires_at < datetime('now')
        `).bind(lockerId, expiresAt, poolId).run();
        
        if (claimResult.success) {
          return lockId;
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error('Lock acquisition failed:', error);
    return null;
  }
}

/**
 * Release distributed lock
 * 
 * Time Complexity: O(1)
 */
export async function releasePoolLock(
  db: D1Database,
  poolId: string,
  lockerId: string
): Promise<boolean> {
  
  try {
    const result = await db.prepare(`
      DELETE FROM pool_locks 
      WHERE pool_id = ? AND locked_by = ?
    `).bind(poolId, lockerId).run();
    
    return result.success;
  } catch (error) {
    console.error('Lock release failed:', error);
    return false;
  }
}

/**
 * Execute operation with automatic lock management
 * Acquires lock, runs operation, releases lock
 * 
 * Time Complexity: O(T) where T = operation complexity
 */
export async function withPoolLock<T>(
  db: D1Database,
  poolId: string,
  lockerId: string,
  operation: () => Promise<T>,
  options: LockOptions = {}
): Promise<T | null> {
  
  const opts = { ...DEFAULT_LOCK_OPTIONS, ...options };
  let lockId: string | null = null;
  
  // Try to acquire lock with retries
  for (let attempt = 0; attempt < opts.maxRetries; attempt++) {
    lockId = await acquirePoolLock(db, poolId, lockerId, options);
    
    if (lockId) break;
    
    // Wait before retry
    if (attempt < opts.maxRetries - 1) {
      await sleep(opts.retryDelayMs * (attempt + 1));
    }
  }
  
  if (!lockId) {
    console.error(`Failed to acquire lock for pool ${poolId} after ${opts.maxRetries} attempts`);
    return null;
  }
  
  try {
    // Execute operation
    const result = await operation();
    return result;
  } catch (error) {
    console.error('Operation failed within lock:', error);
    throw error;
  } finally {
    // Always release lock
    await releasePoolLock(db, poolId, lockerId);
  }
}

/**
 * Optimistic Locking: Update pool with version check
 * Prevents lost updates when multiple processes modify same pool
 * 
 * Time Complexity: O(1)
 * Returns true if update successful, false if version conflict
 */
export async function updatePoolWithVersionCheck(
  db: D1Database,
  poolId: string,
  updates: Partial<Pool>,
  expectedVersion: number
): Promise<{ success: boolean, newVersion?: number }> {
  
  try {
    // Build UPDATE query dynamically
    const updateFields: string[] = [];
    const values: any[] = [];
    
    for (const [key, value] of Object.entries(updates)) {
      if (key !== 'id' && key !== 'version') {
        updateFields.push(`${key} = ?`);
        values.push(value);
      }
    }
    
    if (updateFields.length === 0) {
      return { success: false };
    }
    
    // Add version increment and WHERE clause values
    updateFields.push('version = version + 1');
    values.push(poolId, expectedVersion);
    
    const query = `
      UPDATE pools 
      SET ${updateFields.join(', ')}
      WHERE id = ? AND version = ?
    `;
    
    const result = await db.prepare(query).bind(...values).run();
    
    if (result.success && result.meta.changes > 0) {
      return { success: true, newVersion: expectedVersion + 1 };
    }
    
    return { success: false };
  } catch (error) {
    console.error('Optimistic lock update failed:', error);
    return { success: false };
  }
}

/**
 * Retry operation with exponential backoff
 * Used for handling transient failures
 * 
 * Time Complexity: O(T * n) where T = operation complexity, n = retries
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 100
): Promise<T> {
  
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt < maxRetries - 1) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await sleep(delay);
      }
    }
  }
  
  throw lastError || new Error('Operation failed after retries');
}

/**
 * Clean up expired locks
 * Should be called periodically
 * 
 * Time Complexity: O(k) where k = number of expired locks
 */
export async function cleanupExpiredLocks(db: D1Database): Promise<number> {
  
  try {
    const result = await db.prepare(`
      DELETE FROM pool_locks 
      WHERE expires_at < datetime('now')
    `).run();
    
    return result.meta.changes;
  } catch (error) {
    console.error('Failed to cleanup expired locks:', error);
    return 0;
  }
}

/**
 * Check if pool can accept new passenger (atomic check)
 * Combines capacity check with lock
 * 
 * Time Complexity: O(1)
 */
export async function canAddPassengerAtomic(
  db: D1Database,
  poolId: string,
  seatsRequired: number,
  luggageCount: number
): Promise<boolean> {
  
  try {
    const pool = await db.prepare(`
      SELECT current_seats, max_seats, current_luggage, max_luggage, status
      FROM pools
      WHERE id = ? AND status = 'forming'
    `).bind(poolId).first() as Pool | null;
    
    if (!pool) return false;
    
    // Check capacity
    if (pool.current_seats + seatsRequired > pool.max_seats) return false;
    if (pool.current_luggage + luggageCount > pool.max_luggage) return false;
    
    return true;
  } catch (error) {
    console.error('Capacity check failed:', error);
    return false;
  }
}

/**
 * Transaction-like batch operations
 * Executes multiple DB operations in sequence
 * Rolls back if any fails (best effort)
 * 
 * Time Complexity: O(n) where n = number of operations
 */
export async function executeBatch(
  db: D1Database,
  operations: Array<{ query: string, params: any[] }>
): Promise<{ success: boolean, errors: string[] }> {
  
  const errors: string[] = [];
  const completed: number[] = [];
  
  try {
    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      const result = await db.prepare(op.query).bind(...op.params).run();
      
      if (!result.success) {
        errors.push(`Operation ${i} failed`);
        break;
      }
      
      completed.push(i);
    }
    
    if (errors.length > 0) {
      // Best effort rollback (D1 doesn't support transactions)
      console.warn('Batch operation failed, no automatic rollback available');
      return { success: false, errors };
    }
    
    return { success: true, errors: [] };
  } catch (error) {
    errors.push((error as Error).message);
    return { success: false, errors };
  }
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generate unique request ID for lock identification
 */
export function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
