/**
 * Socket Rate Limiter Middleware
 * Uses an in-memory sliding window counter per authenticated user UID.
 * Automatically purges expired windows to prevent memory leaks.
 */

const rateLimitMap = new Map();

// Periodic cleanup of stale rate limit windows every 5 minutes
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [userId, record] of rateLimitMap.entries()) {
    if (now > record.resetTime + 60000) {
      rateLimitMap.delete(userId);
    }
  }
}, 5 * 60 * 1000);

if (cleanupTimer.unref) {
  cleanupTimer.unref();
}

/**
 * Checks whether an action by a user exceeds the rate limit.
 * @param {string} userId - Firebase UID of the authenticated user
 * @param {number} maxRequests - Maximum requests permitted in the window (default: 45)
 * @param {number} windowMs - Window duration in milliseconds (default: 60,000ms = 1 min)
 * @returns {{ allowed: boolean, remaining: number, resetInMs: number }}
 */
export function checkSocketRateLimit(userId, maxRequests = 45, windowMs = 60000) {
  if (!userId) {
    return { allowed: true, remaining: maxRequests, resetInMs: 0 };
  }

  const now = Date.now();
  let record = rateLimitMap.get(userId);

  if (!record || now >= record.resetTime) {
    record = {
      count: 1,
      resetTime: now + windowMs,
    };
    rateLimitMap.set(userId, record);
    return {
      allowed: true,
      remaining: maxRequests - 1,
      resetInMs: windowMs,
    };
  }

  record.count += 1;
  const remaining = Math.max(0, maxRequests - record.count);
  const resetInMs = Math.max(0, record.resetTime - now);

  if (record.count > maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetInMs,
    };
  }

  return {
    allowed: true,
    remaining,
    resetInMs,
  };
}

export default { checkSocketRateLimit };
