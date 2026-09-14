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

export function authorizeConversationJoin(socket, conversationId) {
  const userId = socket.user?.uid;
  if (!userId) {
    return { valid: false, reason: "User not authenticated" };
  }

  if (!conversationId) {
    return { valid: false, reason: "Conversation ID missing" };
  }

  // Handle group chats
  if (conversationId.startsWith("group_")) {
    return { valid: true };
  }

  // Handle direct 1-on-1 conversations (conv_uidA_uidB or uidA_uidB)
  const cleanId = conversationId.startsWith("conv_")
    ? conversationId.slice(5)
    : conversationId;

  const isParticipant =
    cleanId.startsWith(`${userId}_`) ||
    cleanId.endsWith(`_${userId}`) ||
    cleanId.includes(`_${userId}_`) ||
    cleanId === userId;

  return {
    valid: isParticipant,
    reason: isParticipant ? undefined : "You are not a member of this conversation",
  };
}