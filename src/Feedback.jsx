import React, { useState, useEffect, useRef } from 'react';
import { MessageSquare, ImagePlus, ArrowBigUp, X, Trash2, Plus } from 'lucide-react';
import { supabase } from './supabaseClient';

// ---------------------------------------------------------------------------
// Feedback board — testers-only (gated by being signed in at all, since
// signups are paused and only approved testers can create an account right
// now). Posts are anonymous to other testers: everyone sees the same list
// and can upvote, but nobody's name or email is ever shown next to a post.
// Voting uses the poster's own account (see feedback_votes in
// supabase-setup.sql), so it can't be stacked, and un-upvoting just removes
// the vote row.
// ---------------------------------------------------------------------------

// Shared style tokens (mirror App.jsx so this blends in seamlessly).
const PANEL = 'var(--panel)';
const PANEL2 = 'var(--panel2)';
const LINE = 'var(--line)';
const TEXT = 'var(--text)';
const SUB = 'var(--sub)';
const RED = 'var(--red)';
const INK = '#14171A';

const BUCKET = 'feedback-photos';
const MAX_PHOTOS = 3;
const MAX_BODY = 1000;

function timeAgo(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

// Shrinks + re-encodes a photo client-side before it ever leaves the device
// — keeps storage and load times sane even when someone attaches a full-res
// phone photo. Caps the longest edge at 1600px and re-encodes as JPEG.
function compressImage(file, maxDim = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width > height) { height = Math.round(height * (maxDim / width)); width = maxDim; }
        else { width = Math.round(width * (maxDim / height)); height = maxDim; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(url);
        if (blob) resolve(blob); else reject(new Error('image processing failed'));
      }, 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image read failed')); };
    img.src = url;
  });
}

// ---------- full-width home dashboard card ----------
export function FeedbackHeroCard({ onNavigate }) {
  const [count, setCount] = useState(null);
  useEffect(() => {
    let alive = true;
    supabase.from('feedback_items').select('id', { count: 'exact', head: true }).then(({ count: c }) => {
      if (alive) setCount(c || 0);
    });
    return () => { alive = false; };
  }, []);

  const subtitle = count === null ? 'Tell us what\u2019s broken, missing, or great'
    : count === 0 ? 'Be the first to leave feedback'
    : `${count} piece${count === 1 ? '' : 's'} of feedback so far: add yours`;

  return (
    <button onClick={() => onNavigate('feedback')} style={{
      width: '100%', padding: 0, border: `1px solid ${LINE}`, borderRadius: 16, overflow: 'hidden',
      cursor: 'pointer', background: PANEL, display: 'flex', alignItems: 'center', gap: 14,
      textAlign: 'left', marginBottom: 14,
    }}>
      <div style={{ width: 60, height: 60, flexShrink: 0, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <MessageSquare size={24} color={INK} />
      </div>
      <div style={{ flex: 1, minWidth: 0, padding: '12px 14px 12px 0' }}>
        <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 16, fontWeight: 600, color: TEXT }}>Feedback</div>
        <div style={{ fontSize: 11.5, color: SUB, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subtitle}</div>
      </div>
    </button>
  );
}

// ---------- full feedback board page ----------
export default function FeedbackView({ userId }) {
  const [items, setItems] = useState(null); // null = loading
  const [myVotes, setMyVotes] = useState(new Set());
  const [myPostIds, setMyPostIds] = useState(new Set()); // which posts are mine (author ids are never sent to the browser)
  const [error, setError] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const [body, setBody] = useState('');
  const [staged, setStaged] = useState([]); // { file, previewUrl }
  const [submitting, setSubmitting] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setError('');
    // Note: user_id is intentionally NOT requested here. The board is
    // anonymous, and the database now refuses to hand that column to the
    // browser at all (see supabase-setup.sql, section 20a-i). Which posts
    // are the signed-in person's own comes from my_feedback_ids() below.
    const { data: rows, error: itemsErr } = await supabase
      .from('feedback_items')
      .select('id, body, photo_paths, created_at, upvote_count')
      .order('upvote_count', { ascending: false })
      .order('created_at', { ascending: false });
    if (itemsErr) { setError("Couldn't load feedback. Try refreshing."); setItems([]); return; }

    const { data: votes } = await supabase.from('feedback_votes').select('feedback_id').eq('user_id', userId);
    setMyVotes(new Set((votes || []).map(v => v.feedback_id)));

    const { data: mineIds } = await supabase.rpc('my_feedback_ids');
    setMyPostIds(new Set((mineIds || []).map(Number)));

    // Resolve every photo across every post in one batch signed-url call,
    // rather than one request per thumbnail.
    const allPaths = (rows || []).flatMap(r => r.photo_paths || []);
    let urlMap = {};
    if (allPaths.length) {
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(allPaths, 3600);
      (signed || []).forEach(s => { if (s.signedUrl) urlMap[s.path] = s.signedUrl; });
    }
    setItems((rows || []).map(r => ({ ...r, photoUrls: (r.photo_paths || []).map(p => urlMap[p]).filter(Boolean) })));
  }

  function addPhotos(fileList) {
    const room = MAX_PHOTOS - staged.length;
    if (room <= 0) return;
    const files = Array.from(fileList).slice(0, room);
    setStaged(prev => [...prev, ...files.map(file => ({ file, previewUrl: URL.createObjectURL(file) }))]);
  }
  function removeStaged(i) {
    setStaged(prev => {
      URL.revokeObjectURL(prev[i].previewUrl);
      return prev.filter((_, idx) => idx !== i);
    });
  }

  async function submit() {
    const trimmed = body.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const photoPaths = [];
      for (const p of staged) {
        const blob = await compressImage(p.file);
        const path = `${userId}/${crypto.randomUUID()}.jpg`;
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' });
        if (upErr) throw upErr;
        photoPaths.push(path);
      }
      const { error: insErr } = await supabase.from('feedback_items').insert({ user_id: userId, body: trimmed, photo_paths: photoPaths });
      if (insErr) throw insErr;
      staged.forEach(p => URL.revokeObjectURL(p.previewUrl));
      setStaged([]);
      setBody('');
      setComposerOpen(false);
      await load();
    } catch (e) {
      setError((e && e.message && e.message.includes('too fast')) ? e.message : "Couldn't post that. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleUpvote(item) {
    const voted = myVotes.has(item.id);
    setMyVotes(prev => { const next = new Set(prev); voted ? next.delete(item.id) : next.add(item.id); return next; });
    setItems(prev => prev.map(it => it.id === item.id ? { ...it, upvote_count: it.upvote_count + (voted ? -1 : 1) } : it));
    const { error: voteErr } = voted
      ? await supabase.from('feedback_votes').delete().eq('feedback_id', item.id).eq('user_id', userId)
      : await supabase.from('feedback_votes').insert({ feedback_id: item.id, user_id: userId });
    if (voteErr) {
      // revert the optimistic update if the write didn't actually go through
      setMyVotes(prev => { const next = new Set(prev); voted ? next.add(item.id) : next.delete(item.id); return next; });
      setItems(prev => prev.map(it => it.id === item.id ? { ...it, upvote_count: it.upvote_count + (voted ? 1 : -1) } : it));
    }
  }

  async function deleteOwn(item) {
    if (!window.confirm('Delete this feedback post? This can\u2019t be undone.')) return;
    // No user_id filter here on purpose: the row-level security delete policy
    // (auth.uid() = user_id) already guarantees you can only ever delete your
    // own post, and user_id is no longer readable by the browser anyway.
    await supabase.from('feedback_items').delete().eq('id', item.id);
    if (item.photo_paths && item.photo_paths.length) supabase.storage.from(BUCKET).remove(item.photo_paths).then(() => {});
    setItems(prev => (prev || []).filter(it => it.id !== item.id));
  }

  const cardBase = { background: PANEL, border: `1px solid ${LINE}`, borderRadius: 14, padding: 14 };

  return (
    <div style={{ padding: '22px 20px 40px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ width: '100%', maxWidth: 440 }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div>
            <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 22, fontWeight: 600, color: TEXT }}>Feedback</div>
            <div style={{ fontSize: 11.5, color: SUB, marginTop: 2 }}>Visible to testers only, never public</div>
          </div>
          {!composerOpen && (
            <button onClick={() => setComposerOpen(true)} style={{
              display: 'flex', alignItems: 'center', gap: 6, background: 'var(--accent)', color: INK, border: 'none',
              borderRadius: 10, padding: '9px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', flexShrink: 0,
            }}>
              <Plus size={15} /> Add
            </button>
          )}
        </div>

        {error && (
          <div style={{ background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 10, padding: '10px 12px', color: RED, fontSize: 12.5, marginBottom: 14 }}>{error}</div>
        )}

        {composerOpen && (
          <div style={{ ...cardBase, marginBottom: 18 }}>
            <textarea
              autoFocus
              value={body}
              onChange={e => setBody(e.target.value.slice(0, MAX_BODY))}
              placeholder="What's broken, missing, or great?"
              rows={4}
              style={{
                width: '100%', resize: 'vertical', background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 10,
                padding: '10px 12px', fontSize: 13.5, color: TEXT, fontFamily: "'Manrope', sans-serif", boxSizing: 'border-box',
              }}
            />
            <div style={{ fontSize: 10.5, color: SUB, textAlign: 'right', marginTop: 3 }}>{body.length}/{MAX_BODY}</div>

            <div style={{ fontSize: 11, color: SUB, margin: '10px 0 8px' }}>
              Got a screenshot? Bug reports with a photo get fixed a lot faster, up to {MAX_PHOTOS}.
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {staged.map((p, i) => (
                <div key={i} style={{ position: 'relative', width: 56, height: 56, borderRadius: 8, overflow: 'hidden', border: `1px solid ${LINE}` }}>
                  <img src={p.previewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  <button onClick={() => removeStaged(i)} style={{
                    position: 'absolute', top: 2, right: 2, width: 16, height: 16, borderRadius: '50%', background: 'rgba(20,23,26,0.75)',
                    border: 'none', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0,
                  }}><X size={10} /></button>
                </div>
              ))}
              {staged.length < MAX_PHOTOS && (
                <button onClick={() => fileInputRef.current && fileInputRef.current.click()} style={{
                  width: 56, height: 56, borderRadius: 8, border: `1px dashed ${LINE}`, background: PANEL2,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: SUB,
                }}>
                  <ImagePlus size={18} />
                </button>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={e => { addPhotos(e.target.files); e.target.value = ''; }} />

            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={() => { setComposerOpen(false); setBody(''); staged.forEach(p => URL.revokeObjectURL(p.previewUrl)); setStaged([]); }} style={{
                flex: 1, padding: '10px', borderRadius: 10, border: `1px solid ${LINE}`, background: 'transparent', color: SUB, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}>Cancel</button>
              <button onClick={submit} disabled={!body.trim() || submitting} style={{
                flex: 2, padding: '10px', borderRadius: 10, border: 'none', background: 'var(--accent)', color: INK, fontSize: 13,
                fontWeight: 700, cursor: (!body.trim() || submitting) ? 'default' : 'pointer', opacity: (!body.trim() || submitting) ? 0.5 : 1,
              }}>{submitting ? 'Posting…' : 'Post feedback'}</button>
            </div>
          </div>
        )}

        {items === null && <div style={{ textAlign: 'center', color: SUB, fontSize: 13, padding: '30px 0' }}>Loading…</div>}

        {items !== null && items.length === 0 && (
          <div style={{ ...cardBase, textAlign: 'center', padding: '30px 16px' }}>
            <MessageSquare size={22} color={SUB} style={{ marginBottom: 8 }} />
            <div style={{ fontSize: 13, color: TEXT, fontWeight: 600, marginBottom: 4 }}>No feedback yet</div>
            <div style={{ fontSize: 11.5, color: SUB }}>Be the first tester to leave some.</div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(items || []).map(item => {
            const voted = myVotes.has(item.id);
            const mine = myPostIds.has(item.id);
            return (
              <div key={item.id} style={cardBase}>
                <div style={{ display: 'flex', gap: 12 }}>
                  <button onClick={() => toggleUpvote(item)} style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, flexShrink: 0, width: 40, height: 44,
                    borderRadius: 10, border: `1px solid ${voted ? 'var(--accent)' : LINE}`, background: voted ? 'var(--accent)' : PANEL2,
                    color: voted ? INK : SUB, cursor: 'pointer',
                  }}>
                    <ArrowBigUp size={16} fill={voted ? INK : 'none'} />
                    <span style={{ fontSize: 11, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" }}>{item.upvote_count}</span>
                  </button>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: TEXT, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{item.body}</div>

                    {item.photoUrls.length > 0 && (
                      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                        {item.photoUrls.map((url, i) => (
                          <button key={i} onClick={() => setLightbox(url)} style={{ padding: 0, border: `1px solid ${LINE}`, borderRadius: 8, overflow: 'hidden', cursor: 'pointer', width: 56, height: 56, background: 'none' }}>
                            <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                          </button>
                        ))}
                      </div>
                    )}

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                      <span style={{ fontSize: 10.5, color: SUB }}>{mine ? 'You · ' : ''}{timeAgo(item.created_at)}</span>
                      {mine && (
                        <button onClick={() => deleteOwn(item)} style={{ background: 'none', border: 'none', color: SUB, cursor: 'pointer', padding: 4, display: 'flex' }}>
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{
          position: 'fixed', inset: 0, background: 'rgba(20,23,26,0.9)', display: 'flex', alignItems: 'center',
          justifyContent: 'center', zIndex: 1000, padding: 24, cursor: 'pointer',
        }}>
          <img src={lightbox} alt="" style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 10 }} />
        </div>
      )}
    </div>
  );
}
