import React, { useEffect, useState } from 'react';
import { Grid3X3, Bookmark, Tag, Play, Settings, BadgeCheck, Lock, MoreHorizontal, BarChart3, Store, Users, Crown, ShieldCheck, Camera, Radio, Phone, Video } from 'lucide-react';
import { api } from '../api';
import { Avatar, Btn, Input, Modal, Spinner, fmt } from '../ui';
import { t } from '../i18n';
import type { User, Post } from '../types';
import { PostCard, Composer, StoryUpload } from './feed';
import { FollowBtn, ReelGrid } from './explore';
import { Badges } from '../components/badges';

export function Profile({ username, me, onProfile, onEditProfile, onOpenComments, onShare, toast, socket, onCall }: {
  username: string; me: User; onProfile: (u: string) => void; onEditProfile: () => void;
  onOpenComments: (p: Post) => void; onShare: (p: Post) => void; toast: (s: string) => void; socket: any; onCall?: (u: string, kind: 'audio'|'video') => void;
}) {
  const [user, setUser] = useState<any>(null);
  const [tab, setTab] = useState<'posts' | 'reels' | 'tagged' | 'saved'>('posts');
  const [posts, setPosts] = useState<Post[]>([]);
  const [reels, setReels] = useState<Post[]>([]);
  const [tagged, setTagged] = useState<Post[]>([]);
  const [saved, setSaved] = useState<Post[]>([]);
  const [showFollowers, setShowFollowers] = useState<null | 'followers' | 'following'>(null);
  const isMe = me.username === username;
  const loadUser = () => api.get(`/users/${username}`).then(d => setUser(d.user)).catch(() => setUser({ notFound: true }));
  useEffect(() => { setTab('posts'); loadUser(); }, [username]);
  useEffect(() => {
    if (tab === 'posts') api.get(`/users/${username}/posts`).then(d => setPosts(d.posts));
    if (tab === 'reels') api.get(`/users/${username}/reels`).then(d => setReels(d.posts));
    if (tab === 'tagged') api.get(`/users/${username}/tagged`).then(d => setTagged(d.posts));
    if (tab === 'saved' && isMe) api.get(`/me/saved`).then(d => setSaved(d.posts));
  }, [tab, username, me.username]);
  if (!user) return <div className="py-16 flex justify-center"><Spinner /></div>;
  if (user.notFound) return <p className="text-center text-neutral-500 py-16">User not found</p>;
  const update = (p: Post) => setPosts(ps => ps.map(x => x.id === p.id ? p : x).filter(x => x.status === 'published' || x.id !== p.id || x.status !== 'deleted'));
  return (
    <div className="pb-24">
      {user.profile_banner && <div className="h-32 sm:h-44 w-full bg-cover bg-center" style={{ backgroundImage: `url(${user.profile_banner})` }} />}
      <header className={`px-4 pt-6 pb-2 flex items-start gap-6 sm:gap-10 max-w-2xl mx-auto ${user.profile_banner ? '-mt-12' : ''}`}>
        <Avatar src={user.avatarUrl} size={88} ring={user.isVerified} />
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-4 sm:gap-8 mb-3">
            <div className="text-center"><div className="text-white font-bold">{fmt(user.postCount || 0)}</div><div className="text-neutral-500 text-xs">{t('posts')}</div></div>
            <button className="text-center" onClick={() => setShowFollowers('followers')}><div className="text-white font-bold">{fmt(user.followerCount || 0)}</div><div className="text-neutral-500 text-xs">{t('followers')}</div></button>
            <button className="text-center" onClick={() => setShowFollowers('following')}><div className="text-white font-bold">{fmt(user.followingCount || 0)}</div><div className="text-neutral-500 text-xs">{t('following')}</div></button>
          </div>
          <div className="flex gap-2">
            {isMe ? <>
              <Btn variant="ghost" className="flex-1 text-xs" onClick={onEditProfile}>{t('editProfile')}</Btn>
              <Btn variant="ghost" className="text-xs !px-3" onClick={() => location.hash = '#/settings'}><Settings size={14} /></Btn>
            </> : <>
              <div className="flex-1"><FollowBtn username={username} onDone={loadUser} /></div>
              <Btn variant="ghost" className="text-xs !px-3" title="Voice call" onClick={() => onCall?.(username, 'audio')}><Phone size={14} /></Btn>
              <Btn variant="ghost" className="text-xs !px-3" title="Video call" onClick={() => onCall?.(username, 'video')}><Video size={14} /></Btn>
              <Btn variant="ghost" className="text-xs" onClick={() => location.hash = '#/messages'}>{t('messages')}</Btn>
            </>}
          </div>
        </div>
      </header>
      <div className="px-4 max-w-2xl mx-auto mb-4">
        <div className="flex items-center gap-1.5 text-white font-semibold">
          {user.username} <Badges user={user} size={16} />
          {user.isPrivate && <Lock size={12} className="text-neutral-500" />}
        </div>
        {user.displayName && user.displayName !== user.username && <div className="text-neutral-400 text-sm">{user.displayName}</div>}
        {user.bio && <p className="text-neutral-300 text-sm mt-1 whitespace-pre-wrap">{user.bio}</p>}
        {user.website && <a href={user.website} target="_blank" rel="noopener noreferrer" className="text-sky-400 text-sm hover:underline">{user.website}</a>}
        {user.businessCategory && <div className="text-neutral-500 text-xs mt-1">{user.businessCategory}{user.businessContact ? ` · ${user.businessContact}` : ''}</div>}
      </div>
      <nav className="border-t border-neutral-900 flex justify-center gap-8 sm:gap-14">
        {([['posts', Grid3X3], ['reels', Play], ['tagged', Tag], ...(isMe ? [['saved', Bookmark]] : [])] as any).map(([k, Icon]: any) => (
          <button key={k} onClick={() => setTab(k)} className={`py-3 px-2 border-t -mt-px flex items-center gap-1.5 text-xs uppercase tracking-wide ${tab === k ? 'border-white text-white' : 'border-transparent text-neutral-500'}`}>
            <Icon size={16} /> {k === 'posts' ? t('posts') : k === 'reels' ? t('reels') : k === 'tagged' ? t('tagged') : t('saved')}
          </button>
        ))}
      </nav>
      <div className="pt-1">
        {tab === 'posts' && <Grid posts={posts} onProfile={onProfile} emptyText={isMe ? 'Share your first photo' : 'No posts yet'} />}
        {tab === 'reels' && <ReelGrid posts={reels} onProfile={onProfile} />}
        {tab === 'tagged' && <Grid posts={tagged} onProfile={onProfile} emptyText="No tagged posts" />}
        {tab === 'saved' && <Grid posts={saved} onProfile={onProfile} emptyText="Save posts to see them here" />}
      </div>
      {showFollowers && <FollowList username={username} kind={showFollowers} onClose={() => setShowFollowers(null)} onProfile={onProfile} />}
    </div>
  );
}

function Grid({ posts, onProfile, emptyText }: { posts: Post[]; onProfile: (u: string) => void; emptyText: string }) {
  if (!posts.length) return <p className="text-center text-neutral-500 text-sm py-16">{emptyText}</p>;
  return <div className="grid grid-cols-3 gap-1 sm:gap-2 max-w-2xl mx-auto">
    {posts.map(p => (
      <button key={p.id} className="aspect-square bg-neutral-900 overflow-hidden" onClick={() => onProfile(p.author.username)}>
        {p.media[0] ? (p.media[0].mime.startsWith('video') ? <video src={p.media[0].url} className="w-full h-full object-cover" muted /> : <img src={p.media[0].url} className="w-full h-full object-cover" loading="lazy" alt={p.altText || ''} />) : <span className="text-neutral-600 text-xs p-2 line-clamp-4">{p.caption}</span>}
      </button>
    ))}
  </div>;
}

function FollowList({ username, kind, onClose, onProfile }: any) {
  const [users, setUsers] = useState<any[]>([]);
  useEffect(() => { api.get(`/users/${username}/${kind}`).then(d => setUsers(d.users)); }, [username, kind]);
  return (
    <Modal open onClose={onClose} title={kind === 'followers' ? t('followers') : t('following')}>
      <div className="space-y-3 max-h-80 overflow-y-auto">
        {users.map(u => (
          <div key={u.id} className="flex items-center gap-3">
            <button className="flex items-center gap-3 flex-1" onClick={() => onProfile(u.username)}>
              <Avatar src={u.avatarUrl} size={36} />
              <div className="text-left"><div className="text-white text-sm font-medium">{u.username}</div><div className="text-neutral-500 text-xs">{u.displayName}</div></div>
            </button>
            <FollowBtn username={u.username} className="!mt-0 !w-auto" />
          </div>
        ))}
        {!users.length && <p className="text-neutral-500 text-sm text-center py-4">Nobody here yet</p>}
      </div>
    </Modal>
  );
}

export function EditProfile({ me, onClose, onSaved }: { me: User; onClose: () => void; onSaved: (u: User) => void }) {
  const [displayName, setDisplayName] = useState(me.displayName || '');
  const [bio, setBio] = useState(me.bio || '');
  const [website, setWebsite] = useState(me.website || '');
  const [avatarUrl, setAvatarUrl] = useState(me.avatarUrl || '');
  return (
    <Modal open onClose={onClose} title={t('editProfile')}>
      <div className="flex items-center gap-4 mb-4">
        <Avatar src={avatarUrl} size={64} />
        <label className="text-sky-400 text-sm cursor-pointer">
          <input type="file" accept="image/*" hidden onChange={async e => {
            const fd = new FormData(); fd.append('file', e.target.files![0]);
            const d = await api.upload('/media/upload', fd);
            setAvatarUrl(d.ids[0]);
          }} />Change photo
        </label>
      </div>
      <div className="space-y-2">
        <Input placeholder={t('displayName')} value={displayName} onChange={e => setDisplayName(e.target.value)} />
        <textarea placeholder={t('bio')} rows={2} value={bio} onChange={e => setBio(e.target.value)}
          className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-violet-500 resize-none" />
        <Input placeholder={t('website')} value={website} onChange={e => setWebsite(e.target.value)} />
        <Btn className="w-full" onClick={async () => { const d = await api.patch('/me', { displayName, bio, website, avatarUrl }); onSaved(d.user); onClose(); }}>Save changes</Btn>
      </div>
    </Modal>
  );
}
