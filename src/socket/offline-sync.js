import { ChatService } from "../services/chat.service.js";

/**
 * Handle sync_messages event when user reconnects or requests missing message history
 */
export const handleSyncMessages = async (socket, data) => {
  const { conversationId, lastMessageId, limit = 50 } = data || {};
  if (!conversationId) return;

  try {
    const messages = await ChatService.getHistory(conversationId, lastMessageId, limit);
    socket.emit("sync_complete", {
      conversationId,
      messages,
    });
  } catch (error) {
    console.error("Error syncing messages:", error);
    socket.emit("error_event", {
      success: false,
      code: "SYNC_FAILED",
      message: error.message,
    });
  }
};