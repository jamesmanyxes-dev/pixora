import { Pool } from 'pg';
const SRC = process.env.SRC_URL;
const DST = process.env.DST_URL;
const src = new Pool({ connectionString: SRC, max: 4 });
const dst = new Pool({ connectionString: DST, max: 4, ssl: { rejectUnauthorized: false } });

// order matters for FKs: parents first
const tables = [
  'users', 'sessions', 'login_history', 'otp_codes', 'follows', 'media', 'posts', 'post_media',
  'likes', 'comments', 'comment_likes', 'reposts', 'collections', 'saves', 'stories', 'story_views',
  'story_replies', 'conversations', 'conversation_members', 'messages', 'notifications',
  'hashtags', 'post_hashtags', 'post_views', 'profile_visits', 'reports', 'moderation_flags',
  'live_streams', 'live_comments', 'calls', 'tips', 'subscriptions', 'exclusive_posts',
  'products', 'orders', 'product_reviews', 'ad_campaigns', 'communities', 'community_members',
  'community_posts', 'verification_requests', 'wallets', 'scheduled_jobs', 'push_subscriptions',
  'post_mentions', 'message_reactions', 'blocks', 'channels', 'channel_follows', 'channel_posts',
  'channel_reactions', 'poll_votes', 'admin_audit', 'users_ban_history', 'appeals', 'translations_cache'
];

let total = 0;
for (const t of tables) {
  try {
    const { rows } = await src.query(`SELECT * FROM ${t}`);
    if (!rows.length) { console.log(t + ': 0 (skip)'); continue; }
    const cols = Object.keys(rows[0]);
    const chunk = 200;
    let n = 0;
    for (let i = 0; i < rows.length; i += chunk) {
      const slice = rows.slice(i, i + chunk);
      const values = [];
      const tuples = slice.map((row, ri) => {
        const ph = cols.map((_, ci) => `$${ri * cols.length + ci + 1}`);
        values.push(...cols.map(c => row[c] === undefined ? null : row[c]));
        return `(${ph.join(',')})`;
      });
      // insert with ON CONFLICT DO NOTHING (pk dedupe)
      const pks = { users: 'id', sessions: 'id', posts: 'id', media: 'id', messages: 'id' };
      const conflict = pks[t] ? ` ON CONFLICT (${pks[t]}) DO NOTHING` : ' ON CONFLICT DO NOTHING';
      await dst.query(`INSERT INTO ${t} (${cols.join(',')}) VALUES ${tuples.join(',')} ${conflict}`, values).catch(e => {
        console.log(`  ${t} chunk error: ${e.message.slice(0,80)}`);
      });
      n += slice.length;
    }
    total += n;
    console.log(`${t}: ${n} rows`);
  } catch (e) {
    console.log(`${t}: TABLE ERROR ${e.message.slice(0, 80)}`);
  }
}
console.log('TOTAL rows copied:', total);
await src.end(); await dst.end();
