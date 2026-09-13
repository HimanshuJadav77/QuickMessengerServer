import { broadcastToUser } from "./users.manager.js";

/**
 * Emit presence event to a user's active sockets.
 */
export function emitPresence(targetUserId, eventData) {
  broadcastToUser(targetUserId, "presence_update", eventData);
}