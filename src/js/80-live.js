/* ============================================================================
   THE RECORD — one continuous operation. Day 1 is 25 Oct 2026 from 06:00 AST.
   The simulation runs at whatever speed is chosen and is never reset: the
   state is saved every minute (and when the page is hidden or closed), and the
   next time the page opens it continues exactly from where it was saved.
   With the artifact's database, one open tab holds a short lease and is the
   one that runs and saves; other open tabs follow its saves. Each closed day is
   archived (totals and every leg flown). Without the database the record is kept
   in this browser only.
   ========================================================================== */

const REC = { saveEveryS: 60, leaseMs: 120000, followEveryS: 60, chunk: 120000, localKey: 'logixair-gulf-record-v' + SNAP_V,
  /* the shared record kept on the calendar by the GitHub Action (tools/record.js): every viewer opens on today */
  url: 'https://raw.githubusercontent.com/LogiXair/OPS-GCC/record/state.json.gz', logs: 'https://github.com/LogiXair/OPS-GCC/tree/main/logs',
  epoch: Date.UTC(2026, 9, 24, 21, 0), maxCatchUpS: 8 * 3600 };
const recNow = () => (Date.now() - REC.epoch) / 1000;              // the calendar in sim seconds: 25 Oct 2026 00:00 AST = 0

class Live {
  constructor(app) {
    this.app = app; this.sim = app.sim; this.db = null; this.tab = Math.random().toString(36).slice(2, 10);
    this.writer = false; this.ver = null; this.slot = null; this.lastSave = 0; this.savedAt = null; this.archived = -1; this.status = 'starting';
    this.busy = false; this.lastFollow = 0; this.speed = null; this.shared = false; this.recAt = null;
  }
  /* today's record from the repository: gzip JSON { meta, snap } */
  async _fetchShared() {
    if (!REC.url || typeof DecompressionStream === 'undefined') return null;
    try {
      const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 15000);
      const r = await fetch(REC.url + '?m=' + Math.floor(Date.now() / 120000), { signal: ctl.signal, cache: 'no-store' }); clearTimeout(to);
      if (!r.ok) return null;
      const txt = await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).text(), o = JSON.parse(txt);
      return o && o.snap && o.snap.v === SNAP_V ? o : null;
    } catch (e) { console.warn('shared record not reachable', e); return null; }
  }
  /* fly the gap between the record's last save and this minute */
  async _catchUp(say) {
    const gap = recNow() - this.sim.t; if (gap <= 0) return;
    const run = Math.min(gap, REC.maxCatchUpS), end = this.sim.t + run; let n = 0;
    while (this.sim.t < end) { this.sim.step(Math.min(300, end - this.sim.t), 2); if (++n % 6 === 0) { if (say) say('CATCHING UP TO NOW · ' + fmtClock(this.sim.t) + ' AST'); await new Promise(r => setTimeout(r, 0)); } }
  }
  async today(say) {
    const o = await this._fetchShared(); if (!o) return false;
    this.sim.restore(o.snap); this.recAt = o.meta && o.meta.savedAt; this.shared = true; this.status = 'today';
    await this._catchUp(say); return true;
  }
  async _db() {
    if (this.db !== null) return this.db;
    try { this.db = (window.claude && window.claude.use) ? await Promise.race([window.claude.use('db'), new Promise(r => setTimeout(() => r(null), 12000))]) : null; } catch (e) { this.db = null; }
    if (!this.db) this.db = false;
    return this.db;
  }
  /* newest saved state from the database, or from this browser */
  async _load() {
    const db = await this._db();
    if (db) {
      try {
        const m = await db.doc('live/meta').get();
        if (m.exists && m.data().v === SNAP_V) {
          const meta = m.data(), parts = [];
          for (let i = 0; i < meta.n; i++) { const c = await db.doc('snap/' + meta.slot + i).get(); if (!c.exists || c.data().ver !== meta.ver) return null; parts.push(c.data().s); }
          this.archived = meta.archived != null ? meta.archived : -1;
          return { meta, snap: JSON.parse(parts.join('')) };
        }
      } catch (e) { console.warn('record could not be read', e); }
      return null;
    }
    try { const s = localStorage.getItem(REC.localKey); if (s) { const o = JSON.parse(s); return { meta: o.meta, snap: o.snap }; } } catch (e) { /* storage blocked */ }
    return null;
  }
  /* page start: continue the saved record, or begin day 1 */
  async boot(say) {
    if (say) say('OPENING TODAY\'S RECORD …');
    if (await this.today(say)) { this.speed = 1; return; }
    const got = await this._load();
    if (got) {
      this.sim.restore(got.snap); this.ver = got.meta.ver; this.slot = got.meta.slot; this.savedAt = got.meta.savedAt;
      if (got.meta.speed != null) this.speed = got.meta.speed;
      this.status = 'resumed';
    } else {
      this.sim.warmUp(Math.max(6 * 3600 + 900, Math.min(recNow(), 18 * 3600)), 5);   // first opening: day 1 from 06:00 AST, flown up to now on the calendar (at most 12 h)
      this.status = (await this._db()) ? 'new record' : 'this browser only';
    }
  }
  /* background: hold the lease and save; or follow the tab that holds it */
  async loop() {
    if (this.shared) return;                                                   // the shared record is saved by the backend, not by viewers
    const db = await this._db();
    const run = async () => {
      if (this.busy) return;
      try {
        if (db) {
          let r = { acquired: false }; try { r = await db.doc('live/lease').acquire({ holder: this.tab, ttlMs: REC.leaseMs }); } catch (e) { r = { acquired: false }; }
          this.writer = !!r.acquired;
        } else this.writer = true;
        if (this.writer) { if (Date.now() - this.lastSave >= REC.saveEveryS * 1000 - 500) await this.save(); this.status = 'recording'; }
        else if (Date.now() - this.lastFollow >= REC.followEveryS * 1000 - 500) { this.lastFollow = Date.now(); await this.follow(); this.status = 'following'; }
      } catch (e) { this.status = 'record unavailable'; console.warn(e); }
    };
    await run(); setInterval(run, 15000);
    const flush = () => { if (this.writer) this.save().catch(() => 0); };
    document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
    window.addEventListener('pagehide', flush);
  }
  async save() {
    if (this.busy) return; this.busy = true;
    try {
      const db = await this._db(), snap = this.sim.snapshot(), savedAt = new Date().toISOString(), speed = this.app.paused ? 0 : this.app.speed;
      if (db) {
        const js = JSON.stringify(snap), ver = Date.now().toString(36) + '-' + this.tab, slot = this.slot === 'A' ? 'B' : 'A', n = Math.ceil(js.length / REC.chunk);
        for (let i = 0; i < n; i++) await db.doc('snap/' + slot + i).set({ ver, i, s: js.slice(i * REC.chunk, (i + 1) * REC.chunk) });
        await this.archive(db);
        await db.doc('live/meta').set({ v: SNAP_V, ver, slot, n, t: this.sim.t, day: dayOf(this.sim.t), savedAt, archived: this.archived, speed });
        this.ver = ver; this.slot = slot;
      } else {
        try { localStorage.setItem(REC.localKey, JSON.stringify({ meta: { t: this.sim.t, savedAt, speed }, snap })); } catch (e) { this.status = 'not saved · storage full or blocked'; }
      }
      this.lastSave = Date.now(); this.savedAt = savedAt;
    } finally { this.busy = false; }
  }
  /* closed days: totals per line, and every leg flown that day */
  async archive(db) {
    for (const d of this.sim.days) {
      if (d.day <= this.archived) continue;
      const legs = [];
      for (const a of this.sim.aircraft) for (const e of a.hist || []) if (e.k === 'L' && e.t >= d.t0 && e.t < d.t0 + 86400) legs.push([a.cs, Math.round(e.t), e.a ? Math.round(e.a) : null, e.f, e.to, e.r, e.kg || 0, e.ty || '', e.rev || 0, e.late || 0, e.mro || 0]);
      await db.doc('days/d' + (d.day + 1)).set({ day: d.day + 1, date: dateOf(d.t0), tot: d.tot, scn: d.scn });
      await db.doc('legs/d' + (d.day + 1)).set({ day: d.day + 1, cols: ['cs', 'dep', 'arr', 'from', 'to', 'route', 'kg', 'type', 'rev', 'late', 'mro'], legs });
      this.archived = d.day;
    }
  }
  /* a second open tab shows the record the running tab saved */
  async follow() {
    const db = await this._db(); if (!db) return;
    const m = await db.doc('live/meta').get(); if (!m.exists || m.data().ver === this.ver) return;
    const got = await this._load(); if (!got) return;
    this.sim.restore(got.snap); this.ver = got.meta.ver; this.slot = got.meta.slot; this.savedAt = got.meta.savedAt;
    if (got.meta.speed != null && got.meta.speed > 0) { this.app.speed = got.meta.speed; this.app.paused = false; } else if (got.meta.speed === 0) this.app.paused = true;
    this.app.ui.refresh();
  }
  /* seconds the view is ahead of (+) or behind (-) the calendar */
  drift() { return this.sim.t - recNow(); }
  label() {
    if (this.shared) {
      const d = this.drift(), a = Math.abs(d), p = this.app.paused ? 'PAUSED · ' : this.app.speed !== 1 ? this.app.speed + '× · ' : '';
      if (a < 180) return p + 'TODAY\'S RECORD';
      const span = a >= 86400 ? Math.floor(a / 86400) + ' D ' + Math.floor(a % 86400 / 3600) + ' H' : fmtDur(a).replace(' min', ' MIN').replace(' h ', ' H ');
      return p + (d > 0 ? 'AHEAD OF TODAY +' : 'BEHIND TODAY −') + span;
    }
    const s = this.status, t = this.savedAt ? new Date(this.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
    return s === 'recording' ? 'SAVED ' + (t || '—') + ' YOUR TIME' : s === 'following' ? 'FOLLOWING ANOTHER OPEN TAB' : s.toUpperCase();
  }
}
