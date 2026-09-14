import { db } from "../config/firebase.js";
import { FieldValue } from "firebase-admin/firestore";

export class GroupService {
  /**
   * Create a new Group Chat
   */
  static async createGroup({ groupId, name, description = "", imageUrl = "", createdBy, initialMemberUids = [] }) {
    try {
      const groupRef = db.collection("groups").doc(groupId);
      const allMemberUids = Array.from(new Set([createdBy, ...initialMemberUids]));

      const groupData = {
        groupId,
        name,
        description,
        imageUrl,
        createdBy,
        memberUids: allMemberUids,
        createdAt: FieldValue.serverTimestamp(),
        memberCount: allMemberUids.length,
        updatedAt: FieldValue.serverTimestamp(),
      };

      const batch = db.batch();
      batch.set(groupRef, groupData);

      for (const uid of allMemberUids) {
        const memberRef = groupRef.collection("members").doc(uid);
        const role = uid === createdBy ? "owner" : "member";
        batch.set(memberRef, {
          uid,
          role,
          joinedAt: FieldValue.serverTimestamp(),
        });
      }

      await batch.commit();
      return { groupId, name, description, imageUrl, createdBy, memberCount: allMemberUids.length, memberUids: allMemberUids };
    } catch (error) {
      console.error("Error creating group:", error);
      throw error;
    }
  }

  /**
   * Add member to group (Admin authorization required)
   */
  static async addMember(groupId, memberUid, requestingUserId) {
    try {
      const groupRef = db.collection("groups").doc(groupId);
      const reqMemberDoc = await groupRef.collection("members").doc(requestingUserId).get();

      if (!reqMemberDoc.exists) throw new Error("Requesting user is not a member of this group");
      const reqRole = reqMemberDoc.data().role;
      if (reqRole !== "owner" && reqRole !== "admin") {
        throw new Error("UNAUTHORIZED: Only group owners or admins can add members");
      }

      const newMemberRef = groupRef.collection("members").doc(memberUid);
      await newMemberRef.set({
        uid: memberUid,
        role: "member",
        joinedAt: FieldValue.serverTimestamp(),
      });

      await groupRef.update({
        memberCount: FieldValue.increment(1),
        memberUids: FieldValue.arrayUnion(memberUid),
        updatedAt: FieldValue.serverTimestamp(),
      });

      return { groupId, memberUid, role: "member" };
    } catch (error) {
      console.error("Error adding member to group:", error);
      throw error;
    }
  }

  /**
   * Remove member or Leave Group
   */
  static async removeMember(groupId, memberUid, requestingUserId) {
    try {
      const groupRef = db.collection("groups").doc(groupId);

      if (memberUid !== requestingUserId) {
        const reqMemberDoc = await groupRef.collection("members").doc(requestingUserId).get();
        if (!reqMemberDoc.exists) throw new Error("Requesting user is not a member");
        const reqRole = reqMemberDoc.data().role;
        if (reqRole !== "owner" && reqRole !== "admin") {
          throw new Error("UNAUTHORIZED: Only owners or admins can remove members");
        }
      }

      await groupRef.collection("members").doc(memberUid).delete();
      await groupRef.update({
        memberCount: FieldValue.increment(-1),
        memberUids: FieldValue.arrayRemove(memberUid),
        updatedAt: FieldValue.serverTimestamp(),
      });

      return { groupId, memberUid };
    } catch (error) {
      console.error("Error removing member from group:", error);
      throw error;
    }
  }

  /**
   * Promote Member to Admin
   */
  static async promoteAdmin(groupId, memberUid, requestingUserId) {
    try {
      const groupRef = db.collection("groups").doc(groupId);
      const reqMemberDoc = await groupRef.collection("members").doc(requestingUserId).get();

      if (!reqMemberDoc.exists || reqMemberDoc.data().role !== "owner") {
        throw new Error("UNAUTHORIZED: Only group owner can promote admins");
      }

      await groupRef.collection("members").doc(memberUid).update({
        role: "admin",
        updatedAt: FieldValue.serverTimestamp(),
      });

      return { groupId, memberUid, role: "admin" };
    } catch (error) {
      console.error("Error promoting admin in group:", error);
      throw error;
    }
  }

  /**
   * Send Group Message
   */
  static async sendGroupMessage({ messageId, groupId, senderId, senderName, type = "text", text, clientCreatedAt }) {
    try {
      const groupRef = db.collection("groups").doc(groupId);

      // Verify sender is an active member of this group
      const memberDoc = await groupRef.collection("members").doc(senderId).get();
      if (!memberDoc.exists) {
        const err = new Error("FORBIDDEN: You are not a member of this group");
        err.code = "NOT_A_GROUP_MEMBER";
        throw err;
      }

      const messageRef = groupRef.collection("messages").doc(messageId);

      const messageData = {
        messageId,
        groupId,
        senderId,
        senderName: senderName || "Member",
        type,
        text: text || "",
        status: "sent",
        clientCreatedAt: clientCreatedAt || new Date().toISOString(),
        createdAt: FieldValue.serverTimestamp(),
      };

      await messageRef.set(messageData);

      await groupRef.update({
        lastMessage: text || `[${type}]`,
        lastMessageSenderId: senderId,
        lastMessageAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Get all group member UIDs
      const membersSnap = await groupRef.collection("members").get();
      const memberUids = membersSnap.docs.map((doc) => doc.id);

      return { message: messageData, memberUids };
    } catch (error) {
      console.error("Error sending group message:", error);
      throw error;
    }
  }
}

export default GroupService;
