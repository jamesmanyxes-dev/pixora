// shared types
export interface User {
  id: string; email?: string; username: string; displayName: string; bio?: string; website?: string;
  avatarUrl?: string | null; phone?: string; phoneVerified?: boolean; emailVerified?: boolean;
  isPrivate?: boolean; isVerified?: boolean; isAdmin?: boolean; isOwner?: boolean; isBusiness?: boolean;
  businessCategory?: string; language?: string; theme?: string; settings?: any;
  followerCount?: number; followingCount?: number; postCount?: number;
  onboardingStep?: number; createdAt?: string; twoFactorEnabled?: boolean;
}
export interface Post {
  id: string; kind: 'post' | 'reel'; caption: string; location?: string; altText?: string;
  createdAt: string; editedAt?: string; status: string;
  likeCount: number; commentCount: number; viewCount: number; repostCount: number;
  commentsDisabled?: boolean; likesHidden?: boolean;
  liked?: boolean; saved?: boolean; reposted?: boolean; followingAuthor?: boolean;
  media: { id: string; url: string; mime: string; duration_ms?: number }[];
  author: { id: string; username: string; displayName: string; avatarUrl?: string | null; verified: boolean; private: boolean; business?: boolean };
}
export interface Comment {
  id: string; parentId: string | null; body: string | null; likeCount: number; liked?: boolean;
  createdAt: string; deleted: boolean; mine?: boolean;
  author: { id: string; username: string; displayName: string; avatarUrl?: string | null; verified?: boolean };
}
