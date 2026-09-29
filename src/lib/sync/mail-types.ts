export interface FolderInfo {
  path: string;
  name: string;
  specialUse: string | null;
  messageCount: number | null;
  unreadCount: number | null;
}

export interface HeaderMsg {
  uid: number;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  from: { name: string | null; address: string | null } | null;
  to: string[];
  cc: string[];
  subject: string | null;
  date: Date | null;
  flags: string[];
  unseen: boolean;
  size: number | null;
  hasAttachments: boolean;
}

export interface MailProvider {
  readonly kind: 'hostinger_api' | 'imap';
  readonly address: string;
  listFolders(): Promise<FolderInfo[]>;
  /** Headers of messages with uid > afterUid (newest first), bounded by `since` and `max`. */
  fetchHeaders(folder: string, afterUid: number, since: Date, max: number): Promise<HeaderMsg[]>;
  /** Current flags of the newest `limit` messages (for unread state). */
  recentFlags(folder: string, limit: number): Promise<{ uid: number; flags: string[]; unseen: boolean }[]>;
  fetchBody(folder: string, uid: number): Promise<{ text: string; html: string }>;
  fetchSource(folder: string, uid: number): Promise<string>;
  close(): Promise<void>;
}
