/**
 * Canonical conversation ID generator for 1-to-1 chats.
 * Sorts user IDs lexicographically:
 * userA + userB -> always same conversation ID regardless of who initiates
 *
 * @param {string} userId1 - First user's Firebase UID
 * @param {string} userId2 - Second user's Firebase UID
 * @returns {string} Canonical conversation ID (e.g. "conv_abc_xyz")
 */
export function getConversationId(userId1, userId2) {
  if (!userId1 || !userId2) {
    throw new Error("Both user IDs are required for conversation ID generation");
  }
  const sorted = [String(userId1), String(userId2)].sort();
  return `conv_${sorted[0]}_${sorted[1]}`;
}

export function generateConversationId(userId1, userId2) {
  return getConversationId(userId1, userId2);
}

/**
 * Validate that an authenticated user is a participant of a conversation.
 * @param {object} socket - Authenticated Socket.IO socket
 * @param {string} conversationId - Target conversation ID
 * @returns {{valid: boolean, reason?: string}}
 */
export function authorizeConversationJoin(socket, conversationId) {
  const userId = socket.user?.uid;
  if (!userId) {
    return { valid: false, reason: "User not authenticated" };
  }

  if (!conversationId || !conversationId.startsWith("conv_")) {
    return { valid: false, reason: "Invalid conversation ID format" };
  }

  // Format: conv_userA_userB
  const parts = conversationId.split("_");
  if (parts.length < 3) {
    return { valid: false, reason: "Conversation ID malformed" };
  }

  const participantA = parts[1];
  const participantB = parts.slice(2).join("_"); // handle uids with underscores if any

  const isParticipant = userId === participantA || userId === participantB;

  return {
    valid: isParticipant,
    reason: isParticipant ? undefined : "You are not a member of this conversation",
  };
}