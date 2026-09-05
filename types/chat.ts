export type ProfileId = "ilan" | "naim" | "juul" | "ruben";

export type PublicProfile = {
  id: ProfileId;
  displayName: string;
  avatarUrl: string;
  online?: boolean;
};

export type UserSettings = {
  accent: string;
  fontScale: number;
  theme: "dark" | "light";
};

export type Reaction = {
  emoji: string;
  profileIds: ProfileId[];
};

export type MessagePreview = {
  id: string;
  senderId: ProfileId;
  senderName: string;
  content: string;
  deleted: boolean;
};

export type ChatMessage = {
  id: string;
  conversationId: string;
  senderId: ProfileId;
  senderName: string;
  senderAvatarUrl: string;
  content: string;
  mediaUrl: string | null;
  mediaName: string | null;
  mediaType: string | null;
  replyTo: MessagePreview | null;
  forwarded: boolean;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  reactions: Reaction[];
  readBy: ProfileId[];
};

export type Conversation = {
  id: string;
  type: "dm" | "group";
  title: string;
  avatarUrl: string | null;
  members: PublicProfile[];
  lastMessage: {
    content: string;
    senderId: ProfileId;
    createdAt: string;
  } | null;
  updatedAt: string;
  unreadCount: number;
};
