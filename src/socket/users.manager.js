const userSockets = new Map();

/**
 * Add a socket to a user's connection set.
 * Supports multiple sockets per user (multi-device).
 * @param {string} userId - Firebase UID
 * @param {object} socket - Socket.IO socket
 */
export function addUserSocket(userId, socket) {
  if (!userSockets.has(userId)) {
    userSockets.set(userId, new Set());
  }
  userSockets.get(userId).add(socket);
}

/**
 * Remove a socket from a user's connection set.
 * Clean up the set if it becomes empty.
 * @param {string} userId - Firebase UID
 * @param {object} socket - Socket.IO socket
 */
export function removeUserSocket(userId, socket) {
  const sockets = userSockets.get(userId);
  if (sockets) {
    sockets.delete(socket);
    if (sockets.size === 0) {
      userSockets.delete(userId);
    }
  }
}

/**
 * Get all sockets for a user (supports multi-device).
 * @param {string} userId - Firebase UID
 * @returns {Set} Set of Socket.IO sockets
 */
export function getUserSockets(userId) {
  return userSockets.get(userId) || new Set();
}

/**
 * Check if a user has any active sockets.
 * @param {string} userId - Firebase UID
 * @returns {boolean}
 */
export function userHasSockets(userId) {
  return userSockets.has(userId) && userSockets.get(userId).size > 0;
}

/**
 * Set active conversation ID on a specific socket.
 * @param {object} socket - Socket.IO socket
 * @param {string|null} conversationId - Active conversation ID or null
 */
export function setActiveConversation(socket, conversationId) {
  if (socket) {
    socket.activeConversationId = conversationId || null;
  }
}

/**
 * Check if a user has at least one active socket viewing a specific conversation.
 * @param {string} userId - Firebase UID
 * @param {string} conversationId - Conversation ID
 * @returns {boolean}
 */
export function isUserViewingConversation(userId, conversationId) {
  const sockets = getUserSockets(userId);
  for (const socket of sockets) {
    if (socket.connected && socket.activeConversationId === conversationId) {
      return true;
    }
  }
  return false;
}

/**
 * Get the count of active sockets for a user.
 * @param {string} userId - Firebase UID
 * @returns {number}
 */
export function getUserSocketCount(userId) {
  return userSockets.get(userId)?.size || 0;
}

/**
 * Broadcast to all sockets of a user.
 * @param {string} userId - Firebase UID
 * @param {string} event - Event name
 * @param {object} data - Event data
 */
export function broadcastToUser(userId, event, data) {
  const sockets = getUserSockets(userId);
  sockets.forEach((socket) => {
    if (socket.connected) {
      socket.emit(event, data);
    }
  });
}

/**
 * Get user ID from a socket (set during auth middleware).
 * @param {object} socket - Socket.IO socket
 * @returns {string|null}
 */
export function getUserIdFromSocket(socket) {
  return socket.user ? socket.user.uid : null;
}

export default {
  addUserSocket,
  removeUserSocket,
  getUserSockets,
  userHasSockets,
  setActiveConversation,
  isUserViewingConversation,
  getUserSocketCount,
  broadcastToUser,
  getUserIdFromSocket,
};