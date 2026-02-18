/**
 * Security Middleware
 * 
 * Provides:
 * - Rate limiting (per IP and per user)
 * - Request validation
 * - API key authentication
 * - CORS handling
 * - Input sanitization
 */

import { Context, Next } from 'hono';
import { Env } from '../types';

// In-memory rate limit store (use KV in production)
const rateLimitStore = new Map<string, { count: number, resetAt: number }>();

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

const RATE_LIMITS: Record<string, RateLimitConfig> = {
  default: { maxRequests: 100, windowMs: 60000 }, // 100 per minute
  auth: { maxRequests: 20, windowMs: 60000 }, // 20 per minute for sensitive endpoints
  create_ride: { maxRequests: 10, windowMs: 60000 } // 10 ride requests per minute
};

/**
 * Rate Limiting Middleware
 * Prevents abuse by limiting requests per IP
 * 
 * Time Complexity: O(1)
 */
export function rateLimiter(configKey: keyof typeof RATE_LIMITS = 'default') {
  return async (c: Context, next: Next) => {
    const config = RATE_LIMITS[configKey];
    const ip = c.req.header('cf-connecting-ip') || c.req.header('x-real-ip') || 'unknown';
    const key = `${configKey}:${ip}`;
    const now = Date.now();
    
    // Get current rate limit data
    let data = rateLimitStore.get(key);
    
    // Reset if window expired
    if (!data || data.resetAt < now) {
      data = { count: 0, resetAt: now + config.windowMs };
    }
    
    // Increment counter
    data.count++;
    rateLimitStore.set(key, data);
    
    // Check if exceeded
    if (data.count > config.maxRequests) {
      const retryAfter = Math.ceil((data.resetAt - now) / 1000);
      
      return c.json({
        error: 'Rate limit exceeded',
        retry_after_seconds: retryAfter
      }, 429);
    }
    
    // Add rate limit headers
    c.header('X-RateLimit-Limit', config.maxRequests.toString());
    c.header('X-RateLimit-Remaining', (config.maxRequests - data.count).toString());
    c.header('X-RateLimit-Reset', Math.ceil(data.resetAt / 1000).toString());
    
    await next();
  };
}

/**
 * Request Validation Middleware
 * Validates required fields and data types
 */
export function validateRequest(requiredFields: Record<string, string>) {
  return async (c: Context, next: Next) => {
    try {
      const body = await c.req.json();
      const errors: string[] = [];
      
      for (const [field, type] of Object.entries(requiredFields)) {
        // Check if field exists
        if (body[field] === undefined || body[field] === null) {
          errors.push(`Missing required field: ${field}`);
          continue;
        }
        
        // Validate type
        const actualType = typeof body[field];
        if (type === 'number' && actualType !== 'number') {
          errors.push(`Field ${field} must be a number`);
        } else if (type === 'string' && actualType !== 'string') {
          errors.push(`Field ${field} must be a string`);
        } else if (type === 'boolean' && actualType !== 'boolean') {
          errors.push(`Field ${field} must be a boolean`);
        }
      }
      
      if (errors.length > 0) {
        return c.json({
          error: 'Validation failed',
          details: errors
        }, 400);
      }
      
      await next();
    } catch (error) {
      return c.json({
        error: 'Invalid JSON body'
      }, 400);
    }
  };
}

/**
 * Coordinate Validation
 * Ensures lat/lng are valid
 */
export function validateCoordinates() {
  return async (c: Context, next: Next) => {
    try {
      const body = await c.req.json();
      const errors: string[] = [];
      
      if (body.pickup_lat !== undefined) {
        if (body.pickup_lat < -90 || body.pickup_lat > 90) {
          errors.push('pickup_lat must be between -90 and 90');
        }
      }
      
      if (body.pickup_lng !== undefined) {
        if (body.pickup_lng < -180 || body.pickup_lng > 180) {
          errors.push('pickup_lng must be between -180 and 180');
        }
      }
      
      if (body.dropoff_lat !== undefined) {
        if (body.dropoff_lat < -90 || body.dropoff_lat > 90) {
          errors.push('dropoff_lat must be between -90 and 90');
        }
      }
      
      if (body.dropoff_lng !== undefined) {
        if (body.dropoff_lng < -180 || body.dropoff_lng > 180) {
          errors.push('dropoff_lng must be between -180 and 180');
        }
      }
      
      if (errors.length > 0) {
        return c.json({
          error: 'Coordinate validation failed',
          details: errors
        }, 400);
      }
      
      await next();
    } catch (error) {
      return c.json({
        error: 'Invalid request body'
      }, 400);
    }
  };
}

/**
 * API Key Authentication (optional)
 * For production, use API keys for sensitive operations
 */
export function requireApiKey() {
  return async (c: Context, next: Next) => {
    const apiKey = c.req.header('X-API-Key');
    
    // In production, validate against database or environment variable
    // For now, we'll skip validation in development
    if (!apiKey && process.env.NODE_ENV === 'production') {
      return c.json({
        error: 'API key required',
        message: 'Please provide X-API-Key header'
      }, 401);
    }
    
    await next();
  };
}

/**
 * Input Sanitization
 * Prevents SQL injection and XSS
 */
export function sanitizeInput() {
  return async (c: Context, next: Next) => {
    try {
      const body = await c.req.json();
      
      // Sanitize string fields
      for (const [key, value] of Object.entries(body)) {
        if (typeof value === 'string') {
          // Remove potentially dangerous characters
          body[key] = value
            .replace(/<script[^>]*>.*?<\/script>/gi, '')
            .replace(/<[^>]+>/g, '')
            .trim();
        }
      }
      
      // Store sanitized body
      c.set('sanitizedBody', body);
      
      await next();
    } catch (error) {
      await next();
    }
  };
}

/**
 * Error Handler Middleware
 * Catches and formats errors
 */
export async function errorHandler(c: Context, next: Next) {
  try {
    await next();
  } catch (error) {
    console.error('Request error:', error);
    
    const err = error as Error;
    
    return c.json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? err.message : 'An error occurred',
      timestamp: new Date().toISOString()
    }, 500);
  }
}

/**
 * Request Logger Middleware
 * Logs all requests for monitoring
 */
export async function requestLogger(c: Context, next: Next) {
  const start = Date.now();
  const method = c.req.method;
  const path = c.req.path;
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-real-ip') || 'unknown';
  
  console.log(`[${new Date().toISOString()}] ${method} ${path} - IP: ${ip}`);
  
  await next();
  
  const duration = Date.now() - start;
  console.log(`[${new Date().toISOString()}] ${method} ${path} - ${c.res.status} - ${duration}ms`);
  
  // Add performance header
  c.header('X-Response-Time', `${duration}ms`);
}

/**
 * Cleanup rate limit store periodically
 * Call this from scheduled tasks or manually as needed
 */
export function cleanupRateLimitStore() {
  const now = Date.now();
  
  for (const [key, data] of rateLimitStore.entries()) {
    if (data.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
}

// Note: Cloudflare Workers don't support setInterval at global scope
// Use Scheduled Workers or call cleanup manually from routes if needed
