import { GroupService } from "../services/group.service.js";
import { broadcastToUser, userHasSockets } from "./users.manager.js";
import { sendFCMToUser } from "./fcm.service.js";
import { checkSocketRateLimit } from "../middleware/rateLimit.middleware.js";

export const handleCreateGroup = async (socket, data) => {
  const userId = socket.user?.uid;
  const { groupId, name, description, imageUrl, initialMemberUids } = data || {};

  if (!groupId || !name || !userId) {
    return socket.emit("error_event", {
      success: false,
      code: "INVALID_GROUP_PAYLOAD",
      message: "groupId and name are required",
    });
  }

  if (!checkSocketRateLimit(userId, 20).allowed) {
    return socket.emit("error_event", {
      success: false,
      code: "RATE_LIMIT_EXCEEDED",
      message: "Too many group actions. Please slow down.",
    });
  }

  try {
    const result = await GroupService.createGroup({
      groupId,
      name,
      description,
      imageUrl,
      createdBy: userId,
      initialMemberUids: initialMemberUids || [],
    });

    socket.emit("group_created", { success: true, group: result });

    for (const memberUid of result.memberUids) {
      if (memberUid !== userId) {
        broadcastToUser(memberUid, "added_to_group", { group: result });
      }
    }
  } catch (error) {
    console.error("Error in handleCreateGroup:", error);
    socket.emit("error_event", {
      success: false,
      code: "GROUP_CREATE_FAILED",
      message: error.message || "Failed to create group",
    });
  }
};

export const handleSendGroupMessage = async (socket, data) => {
  const senderId = socket.user?.uid;
  const { messageId, groupId, senderName, type = "text", text, clientCreatedAt } = data || {};

  if (!messageId || !groupId || !senderId) {
    return socket.emit("error_event", {
      success: false,
      code: "INVALID_GROUP_MESSAGE_PAYLOAD",
      message: "messageId and groupId are required",
    });
  }

  if (!checkSocketRateLimit(senderId).allowed) {
    return socket.emit("error_event", {
      success: false,
      code: "RATE_LIMIT_EXCEEDED",
      message: "Too many messages sent. Please slow down.",
    });
  }

  try {
    const { message, memberUids } = await GroupService.sendGroupMessage({
      messageId,
      groupId,
      senderId,
      senderName,
      type,
      text,
      clientCreatedAt,
    });

    socket.emit("group_message_sent", {
      success: true,
      messageId,
      groupId,
      status: "sent",
    });

    for (const memberUid of memberUids) {
      if (memberUid !== senderId) {
        const isOnline = userHasSockets(memberUid);
        if (isOnline) {
          broadcastToUser(memberUid, "group_message_received", message);
        } else {
          await sendFCMToUser(memberUid, {
            title: `Group: ${groupId}`,
            body: `${senderName || "Someone"}: ${text || "Sent a message"}`,
            groupId,
            messageId,
            senderId,
          });
        }
      }
    }
  } catch (error) {
    console.error("Error in handleSendGroupMessage:", error);
    socket.emit("error_event", {
      success: false,
      code: error.code || "GROUP_MESSAGE_FAILED",
      message: error.message || "Failed to send group message",
    });
  }
};

export const handleGroupTypingStart = (socket, data) => {
  const userId = socket.user?.uid;
  const { groupId, memberUids } = data || {};

  if (groupId && Array.isArray(memberUids)) {
    for (const memberUid of memberUids) {
      if (memberUid !== userId) {
        broadcastToUser(memberUid, "group_typing_start", { groupId, userId });
      }
    }
  }
};

export const handleGroupTypingStop = (socket, data) => {
  const userId = socket.user?.uid;
  const { groupId, memberUids } = data || {};

  if (groupId && Array.isArray(memberUids)) {
    for (const memberUid of memberUids) {
      if (memberUid !== userId) {
        broadcastToUser(memberUid, "group_typing_stop", { groupId, userId });
      }
    }
  }
};
