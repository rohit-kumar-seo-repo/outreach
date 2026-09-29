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
  /** Present when fetching a body could change the \Seen flag, so it can be checked and restored. */
  isUnseen?(folder: string, uid: number): Promise<boolean>;
  markUnseen?(folder: string, uid: number): Promise<void>;
  /** Present when this provider can send replies (Hostinger Email API only). */
  sendReply?(msg: OutgoingReply): Promise<SendOutcome>;
  close(): Promise<void>;
}

export interface OutgoingReply {
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  displayName: string | null;
  /** The message answered, in this mailbox: the provider copies its Message-ID into In-Reply-To/References. */
  inReplyTo: { folder: string; uid: number };
}

/** sent = the provider confirmed; failed = it refused (nothing was sent); unknown = no answer (it may have been sent). */
export type SendOutcome = { result: 'sent' | 'failed' | 'unknown'; status: string; error: string | null };
