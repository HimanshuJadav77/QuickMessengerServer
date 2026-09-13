import https from "https";
import http from "http";

/**
 * KeepAliveService
 * 
 * Monitors route calls and socket traffic.
 * If NO connection or route activity occurs for 12 minutes,
 * it pings the server's public URL (/health) to keep the host
 * (e.g. Render free tier) awake.
 * 
 * If ANY route or socket event occurs within that 12 minutes,
 * the timer automatically resets back to 0 and begins ticking again.
 */
class KeepAliveService {
  constructor() {
    this.inactivityLimitMs = 12 * 60 * 1000; // 12 minutes in milliseconds
    this.timer = null;
    this.lastActivityTime = Date.now();
    this.lastResetTime = Date.now();
  }

  /**
   * Reset timer to 0 whenever a route or socket event occurs.
   * Throttled by 3 seconds to avoid redundant timer resets under high throughput.
   */
  recordActivity(source = "unknown") {
    const now = Date.now();
    this.lastActivityTime = now;

    // Throttle resets to at most once every 3 seconds
    if (now - this.lastResetTime < 3000) {
      return;
    }

    this.lastResetTime = now;
    this.restartTimer();
  }

  /**
   * Start the keep-alive monitor
   */
  start() {
    console.log("⏱️  [Keep-Alive] Initialized. Timer: 12 minutes idle threshold.");
    this.restartTimer();
  }

  /**
   * Reset and schedule the 12-minute timeout
   */
  restartTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(() => {
      this.triggerKeepAlivePing();
    }, this.inactivityLimitMs);
  }

  /**
   * Ping the server's public health endpoint
   */
  triggerKeepAlivePing() {
    let serverUrl = process.env.RENDER_EXTERNAL_URL || process.env.SERVER_URL;

    if (!serverUrl) {
      console.log("⏱️  [Keep-Alive] 12 minutes elapsed without traffic. (RENDER_EXTERNAL_URL / SERVER_URL not set, skipping self-ping).");
      this.restartTimer();
      return;
    }

    if (!serverUrl.startsWith("http://") && !serverUrl.startsWith("https://")) {
      serverUrl = `https://${serverUrl}`;
    }

    const targetUrl = `${serverUrl.replace(/\/+$/, "")}/health`;
    console.log(`⏱️  [Keep-Alive] No traffic for 12 minutes! Pinging ${targetUrl} to keep server awake...`);

    const client = targetUrl.startsWith("https") ? https : http;

    try {
      const req = client.get(
        targetUrl,
        {
          headers: {
            "User-Agent": "QuickMessenger-KeepAlive/1.0",
            "X-Keep-Alive": "true",
          },
        },
        (res) => {
          console.log(`⏱️  [Keep-Alive] ✅ Ping response: HTTP ${res.statusCode}. Server remains active.`);
          this.restartTimer();
        }
      );

      req.on("error", (err) => {
        console.warn(`⏱️  [Keep-Alive] ⚠️ Ping warning: ${err.message}`);
        this.restartTimer();
      });

      req.setTimeout(15000, () => {
        req.destroy();
        this.restartTimer();
      });
    } catch (err) {
      console.error("⏱️  [Keep-Alive] Error executing ping:", err.message);
      this.restartTimer();
    }
  }

  /**
   * Stop the keep-alive timer
   */
  stop() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

export const keepAliveService = new KeepAliveService();
export default keepAliveService;
