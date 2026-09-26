import React, { useEffect, useState } from 'react';
import { Ban, Play, Search, ExternalLink, BadgeCheck, MailCheck, Eye, ShieldAlert } from 'lucide-react';
import { api } from '../api';
import { Btn, Input, Avatar } from '../ui';

// Owner tools — quick actions directly in the main app (full control lives in /console)
export function OwnerTools({ me, toast }: { me: any; toast: (s: string) => void }) {
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<any[]>([]);
  const [convs, setConvs] = useState<any[]>([]);
  const [openConv, setOpenConv] = useState<null | { title: string; messages: any[] }>(null);

  const search = async () => {
    const d = await api.get(`/search?q=${encodeURIComponent(q)}`);
    setUsers(d.users || []);
  };
  useEffect(() => {
    api.get('/admin/conversations').then(d => setConvs(d.conversations)).catch(() => {});
  }, []);

  const setStatus = async (id: string, status: string, username: string) => {
    if (!confirm(`${status === 'banned' ? 'Ban' : 'Restore'} @${username}?`)) return;
    try {
      await api.post(`/admin/users/${id}/status`, { status, reason: status === 'banned' ? 'Community guidelines violation' : '' });
      toast(status === 'banned' ? 'user banned' : 'user restored');
      search();
    } catch (e: any) { toast(e.code || 'failed'); }
  };

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-r from-violet-950/60 to-transparent border border-violet-900/40 rounded-2xl p-4">
        <h3 className="text-white text-sm font-semibold flex items-center gap-2"><ShieldAlert size={15} className="text-violet-400" /> Full control console</h3>
        <p className="text-neutral-400 text-xs mt-1">Live join feed, appeals inbox, message oversight, moderation queue.</p>
        <Btn className="mt-3 text-xs" onClick={() => window.open('/console', '_blank')}><ExternalLink size={13} className="inline mr-1" />Open Console</Btn>
      </div>

      <div className="bg-neutral-900 rounded-2xl p-4">
        <h3 className="text-white text-sm font-semibold mb-2">Ban / restore a user</h3>
        <div className="flex gap-2">
          <Input placeholder="Username or email" value={q} onChange={e => setQ(e.target.value)} />
          <Btn className="text-xs shrink-0" onClick={search}><Search size={14} /></Btn>
        </div>
        <div className="mt-3 space-y-2">
          {users.map(u => (
            <div key={u.id} className="flex items-center gap-2 bg-neutral-800/50 rounded-xl px-3 py-2">
              <Avatar src={u.avatarUrl} size={28} />
              <span className="text-white text-sm flex-1 truncate">@{u.username}</span>
              {u.id !== me.id && <>
                <button onClick={() => setStatus(u.id, 'banned', u.username)} title="Ban" className="p-1.5 rounded bg-red-900/60 text-red-300"><Ban size={13} /></button>
                <button onClick={() => setStatus(u.id, 'active', u.username)} title="Restore" className="p-1.5 rounded bg-green-900/60 text-green-300"><Play size={13} /></button>
              </>}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-neutral-900 rounded-2xl p-4">
        <h3 className="text-white text-sm font-semibold mb-2">Read conversations</h3>
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {convs.map(c => (
            <button key={c.id} className="w-full text-left bg-neutral-800/50 rounded-xl px-3 py-2 hover:bg-neutral-800"
              onClick={async () => {
                const d = await api.get(`/admin/conversations/${c.id}/messages`);
                setOpenConv({ title: c.is_group ? (c.title || 'Group') : (c.members || []).map((m: any) => '@' + m.username).join(' ↔ '), messages: d.messages });
              }}>
              <div className="text-white text-sm truncate">{c.is_group ? (c.title || 'Group') : (c.members || []).map((m: any) => '@' + m.username).join(' ↔ ')}</div>
              <div className="text-neutral-500 text-xs">{c.message_count} messages</div>
            </button>
          ))}
          {!convs.length && <p className="text-neutral-500 text-xs">No conversations yet</p>}
        </div>
      </div>

      {openConv && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setOpenConv(null)}>
          <div className="bg-neutral-950 border border-neutral-800 rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-neutral-800 flex justify-between items-center">
              <h3 className="text-white font-semibold">{openConv.title}</h3>
              <button onClick={() => setOpenConv(null)} className="text-neutral-400">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {openConv.messages.map(m => (
                <div key={m.id} className="text-sm">
                  <span className="text-violet-300 font-medium">@{m.sender.username}</span>
                  <span className="text-neutral-500 text-[10px] ml-2">{new Date(m.createdAt).toLocaleString()}</span>
                  <div className={m.deleted ? 'text-neutral-600 italic' : 'text-neutral-200'}>{m.deleted ? 'deleted' : (m.kind !== 'text' ? `[${m.kind}]` : m.body)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
