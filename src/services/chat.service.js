import { db } from "../config/firebase.js";
import { FieldValue } from "firebase-admin/firestore";
import { getConversationId } from "../socket/conversation.identity.js";

/**
 * Chat Repository - Core Firestore Database Operations
 */
export class ChatRepository {
  /**
   * Persist or retrieve message idempotently.
   * If messageId already exists in Firestore, it returns the existing message to avoid duplicate writes.
   */
  static async createMessage({
    messageId,
    conversationId,
    senderId,
    receiverId,
    type = "text",
    text,
    replyToMessageId = null,
    replyToText = null,
    replyToSenderId = null,
    clientCreatedAt,
  }) {
    try {
      const convId = conversationId || getConversationId(senderId, receiverId);
      const convRef = db.collection("conversations").doc(convId);
      const messageRef = convRef.collection("messages").doc(messageId);

      // Check for idempotency
      const existingDoc = await messageRef.get();
      if (existingDoc.exists) {
        console.info(`Idempotency check: message ${messageId} already exists in Firestore.`);
        return { isDuplicate: true, message: existingDoc.data() };
      }

      const messageData = {
        messageId,
        conversationId: convId,
        senderId,
        receiverId,
        type,
        text: text || "",
        status: "sent",
        deletedFor: [],
        isDeletedForEveryone: false,
        isEdited: false,
        reactions: {},
        replyToMessageId: replyToMessageId || null,
        replyToText: replyToText || null,
        replyToSenderId: replyToSenderId || null,
        clientCreatedAt: clientCreatedAt || new Date().toISOString(),
        createdAt: FieldValue.serverTimestamp(),
      };

      const batch = db.batch();

      // Write message doc
      batch.set(messageRef, messageData);

      // Upsert shared conversation metadata doc
      batch.set(
        convRef,
        {
          conversationId: convId,
          participantIds: [senderId, receiverId].sort(),
          lastMessageId: messageId,
          lastMessage: text || `[${type}]`,
          lastMessageSenderId: senderId,
          lastMessageAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
          [`unreadCount.${receiverId}`]: FieldValue.increment(1),
          [`unreadCount.${senderId}`]: FieldValue.increment(0),
        },
        { merge: true }
      );

      // Single chat sync in Firestore only (Users/{uid}/chats and Users/{uid}/save_chat)
      const senderChatRef = db.collection("Users").doc(senderId).collection("chats").doc(receiverId);
      const receiverChatRef = db.collection("Users").doc(receiverId).collection("chats").doc(senderId);

      batch.set(
        senderChatRef,
        {
          chat: true,
          time: FieldValue.serverTimestamp(),
          lastMessage: text || `[${type}]`,
          lastTimestamp: clientCreatedAt || new Date().toISOString(),
        },
        { merge: true }
      );

      batch.set(
        receiverChatRef,
        {
          chat: true,
          time: FieldValue.serverTimestamp(),
          lastMessage: text || `[${type}]`,
          lastTimestamp: clientCreatedAt || new Date().toISOString(),
        },
        { merge: true }
      );

      const senderSaveChatRef = db
        .collection("Users")
        .doc(senderId)
        .collection("save_chat")
        .doc(receiverId)
        .collection("messages")
        .doc(messageId);

      const receiverSaveChatRef = db
        .collection("Users")
        .doc(receiverId)
        .collection("save_chat")
        .doc(senderId)
        .collection("messages")
        .doc(messageId);

      const saveChatData = {
        messageId,
        sender: senderId,
        receiver: receiverId,
        message: text || "",
        messagestate: "send",
        time: FieldValue.serverTimestamp(),
        clientCreatedAt: clientCreatedAt || new Date().toISOString(),
        type,
      };

      batch.set(senderSaveChatRef, saveChatData);
      batch.set(receiverSaveChatRef, saveChatData);

      await batch.commit();

      return { isDuplicate: false, message: messageData };
    } catch (error) {
      console.error("Error persisting message to Firestore:", error);
      throw error;
    }
  }

  /** Get message history for conversation */
  static async getMessages(conversationId, lastMessageId = null, limit = 50) {
    try {
      const messagesRef = db.collection("conversations").doc(conversationId).collection("messages");
      let query = messagesRef.orderBy("createdAt", "desc").limit(limit);

      if (lastMessageId) {
        const lastDoc = await messagesRef.doc(lastMessageId).get();
        if (lastDoc.exists) {
          query = query.startAfter(lastDoc);
        }
      }

      const snapshot = await query.get();
      return snapshot.docs.map((doc) => ({
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate()?.toISOString() || doc.data().clientCreatedAt,
      }));
    } catch (error) {
      console.error("Error getting messages:", error);
      return [];
    }
  }

  /** Update message delivery/read status */
  static async updateMessageStatus(conversationId, messageId, status) {
    try {
      const messageRef = db.collection("conversations").doc(conversationId).collection("messages").doc(messageId);
      await messageRef.update({
        status,
        updatedAt: FieldValue.serverTimestamp(),
      });
    } catch (error) {
      console.error(`Error updating message ${messageId} status to ${status}:`, error);
    }
  }

  /** Authoritative Edit Message (Sender validation required) */
  static async editMessage(conversationId, messageId, newText, requestingUserId) {
    try {
      const messageRef = db.collection("conversations").doc(conversationId).collection("messages").doc(messageId);
      const doc = await messageRef.get();

      if (!doc.exists) throw new Error("Message not found");
      const msgData = doc.data();

      if (msgData.senderId !== requestingUserId) {
        throw new Error("UNAUTHORIZED: Only the message sender can edit this message");
      }
      if (msgData.isDeletedForEveryone) {
        throw new Error("Cannot edit a deleted message");
      }

      await messageRef.update({
        text: newText,
        isEdited: true,
        updatedAt: FieldValue.serverTimestamp(),
      });

      return {
        messageId,
        conversationId,
        senderId: msgData.senderId,
        receiverId: msgData.receiverId,
        text: newText,
        isEdited: true,
      };
    } catch (error) {
      console.error(`Error editing message ${messageId}:`, error);
      throw error;
    }
  }

  /** Toggle Message Reaction (Add/Remove) */
  static async toggleReaction(conversationId, messageId, emoji, requestingUserId) {
    try {
      const messageRef = db.collection("conversations").doc(conversationId).collection("messages").doc(messageId);
      const doc = await messageRef.get();

      if (!doc.exists) throw new Error("Message not found");
      const msgData = doc.data();
      const currentReactions = msgData.reactions || {};

      if (currentReactions[requestingUserId] === emoji) {
        delete currentReactions[requestingUserId];
      } else {
        currentReactions[requestingUserId] = emoji;
      }

      await messageRef.update({
        reactions: currentReactions,
        updatedAt: FieldValue.serverTimestamp(),
      });

      return {
        messageId,
        conversationId,
        senderId: msgData.senderId,
        receiverId: msgData.receiverId,
        reactions: currentReactions,
      };
    } catch (error) {
      console.error(`Error toggling reaction on message ${messageId}:`, error);
      throw error;
    }
  }

  /** Mark all messages in a conversation as read by a specific user */
  static async markConversationAsRead(conversationId, userId) {
    try {
      const convRef = db.collection("conversations").doc(conversationId);
      await convRef.set(
        {
          [`unreadCount.${userId}`]: 0,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } catch (error) {
      console.error(`Error marking conversation ${conversationId} as read by ${userId}:`, error);
    }
  }

  /** Hide message for requesting user only */
  static async deleteForMe(conversationId, messageId, userId) {
    try {
      const messageRef = db.collection("conversations").doc(conversationId).collection("messages").doc(messageId);
      await messageRef.update({
        deletedFor: FieldValue.arrayUnion(userId),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return true;
    } catch (error) {
      console.error(`Error deleting message ${messageId} for me (${userId}):`, error);
      throw error;
    }
  }

  /** Authoritative Delete for Everyone (Sender validation required) */
  static async deleteForEveryone(conversationId, messageId, requestingUserId) {
    try {
      const messageRef = db.collection("conversations").doc(conversationId).collection("messages").doc(messageId);
      const doc = await messageRef.get();

      if (!doc.exists) {
        throw new Error("Message not found");
      }

      const msgData = doc.data();
      if (msgData.senderId !== requestingUserId) {
        throw new Error("UNAUTHORIZED: Only message sender can delete for everyone");
      }

      await messageRef.update({
        isDeletedForEveryone: true,
        text: "This message was deleted",
        updatedAt: FieldValue.serverTimestamp(),
      });

      return {
        messageId,
        conversationId,
        senderId: msgData.senderId,
        receiverId: msgData.receiverId,
      };
    } catch (error) {
      console.error(`Error deleting message ${messageId} for everyone by ${requestingUserId}:`, error);
      throw error;
    }
  }
}

/**
 * Chat Service - Business logic orchestration
 */
export class ChatService {
  static async sendMessage({
    messageId,
    senderId,
    receiverId,
    type,
    text,
    replyToMessageId,
    replyToText,
    replyToSenderId,
    clientCreatedAt,
  }) {
    const conversationId = getConversationId(senderId, receiverId);
    const result = await ChatRepository.createMessage({
      messageId,
      conversationId,
      senderId,
      receiverId,
      type,
      text,
      replyToMessageId,
      replyToText,
      replyToSenderId,
      clientCreatedAt,
    });
    return { conversationId, ...result };
  }

  static async editMessage(conversationId, messageId, newText, requestingUserId) {
    return await ChatRepository.editMessage(conversationId, messageId, newText, requestingUserId);
  }

  static async toggleReaction(conversationId, messageId, emoji, requestingUserId) {
    return await ChatRepository.toggleReaction(conversationId, messageId, emoji, requestingUserId);
  }

  static async markDelivered(conversationId, messageId) {
    await ChatRepository.updateMessageStatus(conversationId, messageId, "delivered");
  }

  static async markRead(conversationId, userId) {
    await ChatRepository.markConversationAsRead(conversationId, userId);
  }

  static async markConversationAsRead(conversationId, userId) {
    await ChatRepository.markConversationAsRead(conversationId, userId);
  }

  static async deleteForMe(conversationId, messageId, userId) {
    return await ChatRepository.deleteForMe(conversationId, messageId, userId);
  }

  static async deleteForEveryone(conversationId, messageId, requestingUserId) {
    return await ChatRepository.deleteForEveryone(conversationId, messageId, requestingUserId);
  }

  static async getHistory(conversationId, lastMessageId, limit) {
    return await ChatRepository.getMessages(conversationId, lastMessageId, limit);
  }
}

export default ChatService;