import { db } from "../config/firebase.js";
import { ChatService } from "../services/chat.service.js";
import { getConversationId, authorizeConversationJoin } from "./conversation.identity.js";
import { broadcastToUser, userHasSockets, isUserViewingConversation } from "./users.manager.js";
import { sendFCMToUser } from "./fcm.service.js";
import { checkSocketRateLimit } from "../middleware/rateLimit.middleware.js";

// In-memory cache for user profile metadata (5 min TTL) to avoid repeated Firestore reads
const senderProfileCache = new Map();

async function getSenderProfile(senderId, fallbackData = {}) {
  let senderName = fallbackData.senderName || fallbackData.participantName || "";
  let senderAvatarUrl = fallbackData.senderAvatarUrl || fallbackData.participantImageUrl || "";

  if (senderName && senderName !== "User") {
    senderProfileCache.set(senderId, {
      name: senderName,
      avatar: senderAvatarUrl,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
    return { senderName, senderAvatarUrl };
  }

  const cached = senderProfileCache.get(senderId);
  if (cached && Date.now() < cached.expiresAt) {
    return { senderName: cached.name, senderAvatarUrl: cached.avatar };
  }

  try {
    const userDoc = await db.collection("Users").doc(senderId).get();
    if (userDoc.exists) {
      const uData = userDoc.data() || {};
      senderName = uData.username || uData.name || "User";
      senderAvatarUrl = uData.userimageurl || uData.imageurl || "";
      senderProfileCache.set(senderId, {
        name: senderName,
        avatar: senderAvatarUrl,
        expiresAt: Date.now() + 5 * 60 * 1000,
      });
      return { senderName, senderAvatarUrl };
    }
  } catch (err) {
    console.warn("Could not fetch sender metadata:", err.message);
  }

  return { senderName: senderName || "User", senderAvatarUrl: senderAvatarUrl || "" };
}

/**
 * Handle incoming send_message event from Flutter client
 */
export const handleSendMessage = async (socket, data) => {
  const senderId = socket.user?.uid;
  if (!senderId) {
    return socket.emit("error_event", {
      success: false,
      code: "UNAUTHORIZED",
      message: "Socket user not authenticated",
    });
  }

  // Rate limiting check
  if (!checkSocketRateLimit(senderId).allowed) {
    return socket.emit("error_event", {
      success: false,
      code: "RATE_LIMIT_EXCEEDED",
      message: "Too many messages sent. Please slow down.",
    });
  }

  const {
    messageId,
    receiverId,
    type = "text",
    text = "",
    replyToMessageId,
    replyToText,
    replyToSenderId,
    clientCreatedAt,
  } = data || {};

  if (!messageId || !receiverId) {
    return socket.emit("error_event", {
      success: false,
      code: "INVALID_PAYLOAD",
      message: "messageId and receiverId are required",
    });
  }

  try {
    const conversationId = getConversationId(senderId, receiverId);

    // 1. Persist message to Firestore idempotently
    const { isDuplicate, message } = await ChatService.sendMessage({
      messageId,
      senderId,
      receiverId,
      type,
      text,
      replyToMessageId,
      replyToText,
      replyToSenderId,
      clientCreatedAt: clientCreatedAt || new Date().toISOString(),
    });

    // 2. Emit ACK back to sender
    socket.emit("message_sent", {
      success: true,
      messageId,
      conversationId,
      status: "sent",
      isDuplicate,
      clientCreatedAt: message.clientCreatedAt,
    });

    // 3. Resolve sender profile details (for instant display on receiver UI)
    const { senderName, senderAvatarUrl } = await getSenderProfile(senderId, data);

    // 4. Evaluate recipient active status & conversation focus
    const isReceiverOnline = userHasSockets(receiverId);
    const isReceiverViewingThisConv = isUserViewingConversation(receiverId, conversationId);

    const payload = {
      messageId,
      conversationId,
      senderId,
      receiverId,
      senderName,
      senderAvatarUrl,
      type,
      text,
      replyToMessageId,
      replyToText,
      replyToSenderId,
      status: "sent",
      clientCreatedAt: message.clientCreatedAt,
    };

    if (isReceiverOnline) {
      // Real-time Socket delivery to recipient
      broadcastToUser(receiverId, "message_received", payload);

      // If receiver is online but not actively focused on this specific chat, send FCM notification as well
      if (!isReceiverViewingThisConv) {
        await sendFCMToUser(receiverId, {
          title: senderName || "New Message",
          body: text || "Sent a message",
          conversationId,
          messageId,
          senderId,
          senderName,
          senderAvatarUrl,
        });
      }
    } else {
      // Recipient is offline -> FCM Push notification
      await sendFCMToUser(receiverId, {
        title: senderName || "New Message",
        body: text || "Sent a message",
        conversationId,
        messageId,
        senderId,
        senderName,
        senderAvatarUrl,
      });
    }
  } catch (error) {
    console.error("Error in handleSendMessage:", error);
    socket.emit("error_event", {
      success: false,
      code: "MESSAGE_SEND_FAILED",
      message: error.message || "Failed to process message",
    });
  }
};

/**
 * Handle Edit Message event
 */
export const handleEditMessage = async (socket, data) => {
  const userId = socket.user?.uid;
  const { conversationId, messageId, newText, receiverId } = data || {};

  if (!messageId || !conversationId || !newText || !userId) return;

  const authCheck = authorizeConversationJoin(socket, conversationId);
  if (!authCheck.valid) {
    return socket.emit("error_event", {
      success: false,
      code: "UNAUTHORIZED",
      message: authCheck.reason,
    });
  }

  if (!checkSocketRateLimit(userId).allowed) {
    return socket.emit("error_event", {
      success: false,
      code: "RATE_LIMIT_EXCEEDED",
      message: "Too many edit requests. Please slow down.",
    });
  }

  try {
    const result = await ChatService.editMessage(conversationId, messageId, newText, userId);

    const payload = {
      messageId,
      conversationId,
      text: newText,
      isEdited: true,
      editedBy: userId,
    };

    broadcastToUser(userId, "message_edited", payload);
    if (receiverId) {
      broadcastToUser(receiverId, "message_edited", payload);
    } else if (result.receiverId) {
      broadcastToUser(result.receiverId, "message_edited", payload);
    }
  } catch (error) {
    console.error("Error handling edit_message:", error);
    socket.emit("error_event", {
      success: false,
      code: "EDIT_FAILED",
      message: error.message || "Failed to edit message",
    });
  }
};

/**
 * Handle Reaction event
 */
export const handleToggleReaction = async (socket, data) => {
  const userId = socket.user?.uid;
  const { conversationId, messageId, emoji, receiverId } = data || {};

  if (!messageId || !conversationId || !emoji || !userId) return;

  const authCheck = authorizeConversationJoin(socket, conversationId);
  if (!authCheck.valid) return;

  if (!checkSocketRateLimit(userId, 60).allowed) return;

  try {
    const result = await ChatService.toggleReaction(conversationId, messageId, emoji, userId);

    const payload = {
      messageId,
      conversationId,
      reactions: result.reactions,
      updatedBy: userId,
    };

    broadcastToUser(userId, "message_reaction_updated", payload);
    if (receiverId) {
      broadcastToUser(receiverId, "message_reaction_updated", payload);
    } else if (result.receiverId) {
      broadcastToUser(result.receiverId, "message_reaction_updated", payload);
    }
  } catch (error) {
    console.error("Error handling toggle_reaction:", error);
  }
};

/**
 * Handle delivery status event from recipient
 */
export const handleMessageDelivered = async (socket, data) => {
  const userId = socket.user?.uid;
  const { conversationId, messageId, senderId } = data || {};

  if (!messageId || !conversationId) return;

  const authCheck = authorizeConversationJoin(socket, conversationId);
  if (!authCheck.valid) return;

  try {
    await ChatService.updateMessageStatus(conversationId, messageId, "delivered");

    const parts = conversationId.replace("conv_", "").split("_");
    const targetSenderId = senderId || parts.find((id) => id !== userId);

    if (targetSenderId) {
      broadcastToUser(targetSenderId, "message_delivered", {
        messageId,
        conversationId,
        deliveredTo: userId,
      });
    }
  } catch (error) {
    console.error("Error handling message delivery update:", error);
  }
};

/**
 * Handle read status event from recipient opening conversation
 */
export const handleMarkRead = async (socket, data) => {
  const userId = socket.user?.uid;
  const { conversationId, senderId } = data || {};

  if (!conversationId) return;

  const authCheck = authorizeConversationJoin(socket, conversationId);
  if (!authCheck.valid) return;

  try {
    await ChatService.markConversationAsRead(conversationId, userId);

    const parts = conversationId.replace("conv_", "").split("_");
    const targetSenderId = senderId || parts.find((id) => id !== userId);

    if (targetSenderId) {
      broadcastToUser(targetSenderId, "read_receipt", {
        conversationId,
        readBy: userId,
      });
    }
  } catch (error) {
    console.error("Error marking conversation read:", error);
  }
};

/**
 * Handle Delete for Me
 */
export const handleDeleteForMe = async (socket, data) => {
  const userId = socket.user?.uid;
  const { conversationId, messageId } = data || {};

  if (!messageId || !conversationId || !userId) return;

  const authCheck = authorizeConversationJoin(socket, conversationId);
  if (!authCheck.valid) {
    return socket.emit("error_event", {
      success: false,
      code: "UNAUTHORIZED",
      message: authCheck.reason,
    });
  }

  try {
    await ChatService.deleteForMe(conversationId, messageId, userId);
    socket.emit("message_deleted_for_me", {
      success: true,
      messageId,
      conversationId,
    });
  } catch (error) {
    console.error("Error in handleDeleteForMe:", error);
    socket.emit("error_event", {
      success: false,
      code: "DELETE_FAILED",
      message: error.message || "Failed to delete message for me",
    });
  }
};

/**
 * Handle Delete for Everyone (Sender validation required)
 */
export const handleDeleteForEveryone = async (socket, data) => {
  const userId = socket.user?.uid;
  const { conversationId, messageId, receiverId } = data || {};

  if (!messageId || !conversationId || !userId) return;

  const authCheck = authorizeConversationJoin(socket, conversationId);
  if (!authCheck.valid) {
    return socket.emit("error_event", {
      success: false,
      code: "UNAUTHORIZED",
      message: authCheck.reason,
    });
  }

  try {
    const result = await ChatService.deleteForEveryone(conversationId, messageId, userId);

    const payload = {
      messageId,
      conversationId,
      deletedBy: userId,
      deleteType: "for_everyone",
    };

    broadcastToUser(userId, "message_deleted", payload);
    if (receiverId) {
      broadcastToUser(receiverId, "message_deleted", payload);
    } else if (result.receiverId) {
      broadcastToUser(result.receiverId, "message_deleted", payload);
    }
  } catch (error) {
    console.error("Error in handleDeleteForEveryone:", error);
    socket.emit("error_event", {
      success: false,
      code: "DELETE_UNAUTHORIZED",
      message: error.message || "Unauthorized to delete for everyone",
    });
  }
};

/**
 * Handle typing indicators
 */
export const handleTypingStart = (socket, data) => {
  const userId = socket.user?.uid;
  const { receiverId, conversationId } = data || {};
  if (receiverId) {
    broadcastToUser(receiverId, "typing_start", {
      conversationId,
      userId,
    });
  }
};

export const handleTypingStop = (socket, data) => {
  const userId = socket.user?.uid;
  const { receiverId, conversationId } = data || {};
  if (receiverId) {
    broadcastToUser(receiverId, "typing_stop", {
      conversationId,
      userId,
    });
  }
};