/* AuroraPanel — running the server: Activity Log, Alerts, Scheduled Backups, Updates, AutoSSL.
   Loaded before app.js; app.js calls window.AuroraOps(ui) once with its helpers (and extras.js's). */
window.AuroraOps = (ui) => {
  "use strict";
  const { el, icon, btn, pill, field, sw, toast, API, navigate, state, openModal, closeModal, copyText, fmtBytes, ago, downloadText,
    pageHead, empty, call, armed, seg, tile, card, t2s, num, dur, LS, requireCard, jobPanel } = ui;
  const modalWide = () => { const m = document.querySelector("#modal .modal"); if (m) m.classList.add("em-modal"); };
  const timeIn = (ts) => { const s = ts - Date.now() / 1000; return s <= 0 ? "now" : s < 3600 ? `in ${Math.round(s / 60)} min` : s < 86400 ? `in ${Math.round(s / 3600)} h` : `in ${Math.round(s / 86400)} days`; };
  async function waitJob(jobId, onTick) {
    for (;;) {
      let j;
      try { j = await API.job(jobId); } catch (e) { return null; }
      if (onTick) onTick(j);
      if (j.status !== "running") return j;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  function progressBox() {
    const bar = el("div", { class: "ax-bar" }, el("span"));
    const stage = el("div", { class: "ax-stage" });
    const box = el("div", { class: "ax-progress op-prog", hidden: "" }, [stage, bar]);
    return { node: box, set(j) { box.hidden = false; const pct = j.status === "done" ? 100 : (j.progress || 2); bar.firstChild.style.width = `${Math.max(2, pct)}%`;
      stage.textContent = j.stage || j.title || ""; box.classList.toggle("ok", j.status === "done"); box.classList.toggle("bad", j.status === "failed"); } };
  }

  // ======================================================================
  //  Security → Activity Log
  // ======================================================================
  async function viewActivity(root) {
    let days = LS.get("act.days", 7), q = "", who = "", failed = false, d;
    const search = el("input", { type: "search", class: "em-search", placeholder: "Search actions, IPs, names…" });
    let qt;
    search.addEventListener("input", () => { clearTimeout(qt); qt = setTimeout(() => { q = search.value.trim(); load(); }, 250); });
    const userSel = el("select", { class: "em-select mx-narrow", onchange: () => { who = userSel.value; load(); } });
    const failSw = sw(false, (v) => { failed = v; load(); });
    const list = el("div", {}, el("div", { class: "loading", text: "Loading…" }));
    root.append(pageHead("Activity Log", "Every change made in this panel — who did it, from which address, and whether it worked — plus logins and what the background tasks did on their own. Passwords and keys are never recorded.",
      [btn("Export CSV", () => {
        if (!d) return;
        const esc = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
        downloadText(`activity-${new Date().toISOString().slice(0, 10)}.csv`, ["time,user,ip,action,result,status",
          ...d.entries.map((e) => [new Date(e.ts * 1000).toISOString(), e.user, e.ip, e.action, e.ok ? "ok" : "failed", e.status].map(esc).join(","))].join("\n"), "text/csv");
      }, "btn-ghost")]),
      el("div", { class: "card em-pad0" }, [el("div", { class: "mx-toolbar" }, [search, userSel, el("label", { class: "mx-live" }, [failSw, el("span", { text: "Failures only" })]), el("span", { class: "grow" }),
        seg([[1, "24 h"], [7, "7 days"], [30, "30 days"], [90, "90 days"]], days, (v) => { days = v; LS.set("act.days", v); load(); })]), list]));
    async function load() {
      try { d = await API.audit(days, q, who, failed); } catch (e) { list.innerHTML = ""; list.append(el("p", { class: "empty", text: e.message })); return; }
      if (userSel.options.length !== d.users.length + 1) {
        userSel.innerHTML = "";
        userSel.append(el("option", { value: "", text: "Everyone" }), ...d.users.map((u) => el("option", { value: u, text: u })));
        userSel.value = who;
      }
      list.innerHTML = "";
      if (!d.entries.length) { list.append(empty("listing", "Nothing recorded", q || failed ? "Nothing matches the filter." : "Changes made from now on appear here.")); return; }
      let lastDay = "";
      const rows = [];
      for (const e of d.entries.slice(0, 1500)) {
        const day = new Date(e.ts * 1000).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
        if (day !== lastDay) { rows.push(el("div", { class: "op-day", text: day })); lastDay = day; }
        const sys = e.user === "system";
        rows.push(el("button", { type: "button", class: `op-act ${e.ok ? "" : "bad"}`, onclick: () => detail(e) }, [
          el("span", { class: "op-act-t", text: new Date(e.ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) }),
          el("span", { class: `op-who ${sys ? "sys" : ""}`, text: sys ? "⚙ system" : e.user }),
          el("span", { class: "op-act-a mx-ell", title: e.action, text: e.action }),
          el("span", { class: "op-act-ip mx-ell", text: e.ip || "" }),
          pill(e.ok ? "ok" : `failed ${e.status || ""}`, e.ok ? "good" : "bad"),
        ]));
      }
      list.append(el("div", { class: "op-acts" }, rows), d.total > 1500 ? el("p", { class: "muted mx-p", style: "padding:0 16px 14px", text: `Showing 1,500 of ${num(d.total)} — narrow the search or export.` }) : null);
    }
    function detail(e) {
      openModal("Activity", el("div", {}, [
        el("div", { class: "mx-kv" }, [el("span", { text: "When" }), el("span", { text: new Date(e.ts * 1000).toLocaleString() })]),
        el("div", { class: "mx-kv" }, [el("span", { text: "Who" }), el("span", { text: e.user })]),
        el("div", { class: "mx-kv" }, [el("span", { text: "From" }), e.ip ? btn(e.ip, () => { closeModal(); ui.ipCard && ui.ipCard(e.ip); }, "btn-ghost") : el("span", { text: "—" })]),
        el("div", { class: "mx-kv" }, [el("span", { text: "Action" }), el("span", { text: e.action })]),
        el("div", { class: "mx-kv" }, [el("span", { text: "Result" }), pill(e.ok ? `ok (${e.status})` : `failed (${e.status})`, e.ok ? "good" : "bad")]),
        e.path ? el("div", { class: "mx-kv" }, [el("span", { text: "Request" }), el("code", { text: `${e.method} ${e.path}` })]) : null,
        e.detail ? el("pre", { class: "mx-pre", text: JSON.stringify(e.detail, null, 2) }) : null,
      ]), []);
    }
    load();
  }

  // ======================================================================
  //  System → Alerts
  // ======================================================================
  const LVL = { critical: ["Critical", "bad"], warning: ["Warning", "warn"], info: ["Info", "dim"] };
  async function viewAlerts(root) {
    root.append(pageHead("Alerts", "Get told when something needs you: a disk filling up, a service down, a certificate about to expire, an attack wave, a failed backup, waiting security updates, a hot or under-powered Pi. Checked every minute — even when the panel itself is down."));
    const body = el("div", {}, el("div", { class: "loading", text: "Loading…" }));
    root.append(body);
    let d;
    async function load() {
      try { d = await API.alerts(); } catch (e) { body.innerHTML = ""; body.append(el("p", { class: "empty", text: e.message })); return; }
      draw();
    }
    function draw() {
      body.innerHTML = "";
      const ch = d.channels, anyOn = Object.values(ch).some((c) => c.enabled);
      const t = d.tasks || {};
      body.append(el("div", { class: `card mx-hero ${!anyOn ? "warn" : d.active.some((a) => a.level === "critical") ? "bad" : "good"}` }, [
        el("div", { class: "mx-hero-ico" }, icon("warning", 28)),
        el("div", { class: "mx-hero-txt" }, [
          el("h3", { text: !anyOn ? "Alerts are off — nothing will reach you" : d.active.length ? `${d.active.length} problem${d.active.length > 1 ? "s" : ""} right now` : "All good — nothing needs you" }),
          el("p", { class: "muted", text: `${t.timer === "active" ? "Checking every minute" : "The background checker isn't running"}${t.last_run ? ` · last check ${ago(t.last_run)}` : ""}.${anyOn ? "" : " Turn on email, Telegram or a webhook below."}` }),
        ]),
        el("div", { class: "mx-hero-act" }, [btn("Check now", async () => { const r = await call(() => API.alertsCheck(), "Checked"); if (r) { d = { ...d, ...r }; draw(); } }, "btn-ghost"),
          anyOn ? btn("Send a test alert", () => call(() => API.alertsTest(), "").then((r) => r && toast(r.sent.length ? `Sent by ${r.sent.join(", ")}${r.errors.length ? ` — failed: ${r.errors.join("; ")}` : ""}` : `Failed: ${r.errors.join("; ")}`, r.sent.length ? "good" : "bad")), "btn-primary") : null]),
      ]));
      if (d.active.length) body.append(card("Happening now", [el("div", { class: "op-alerts" }, d.active.map((a) => el("div", { class: `op-alert ${LVL[a.level]?.[1] || ""}` }, [
        pill(LVL[a.level]?.[0] || a.level, LVL[a.level]?.[1]), el("div", { class: "grow" }, [el("b", { text: a.title }), el("p", { class: "muted", text: a.text })]),
        el("span", { class: "muted mx-small", text: `since ${ago(a.since)}` })])))]));
      // channels
      const em = ch.email, tg = ch.telegram, wh = ch.webhook;
      const emOn = sw(em.enabled, () => {}), tgOn = sw(tg.enabled, () => {}), whOn = sw(wh.enabled, () => {});
      const emTo = el("input", { type: "email", value: em.to || "", placeholder: "you@example.com" });
      const emFrom = el("select", { class: "em-select" }, [el("option", { value: "", text: "AuroraPanel (aurora@this server)" }), ...d.mail_accounts.map((a) => el("option", { value: a, text: a }))]);
      emFrom.value = em.from || "";
      const tgTok = el("input", { type: "password", placeholder: tg.token_set ? "(saved — leave empty to keep)" : "123456789:AAE…", autocomplete: "off" });
      const tgChat = el("input", { type: "text", value: tg.chat_id || "", placeholder: "123456789" });
      const whKind = el("select", { class: "em-select" }, [["generic", "JSON (any service)"], ["discord", "Discord"], ["slack", "Slack"], ["ntfy", "ntfy (phone push)"]].map(([v, l]) => el("option", { value: v, text: l })));
      whKind.value = wh.kind || "generic";
      const whUrl = el("input", { type: "url", placeholder: wh.url_hint ? `${wh.url_hint} (saved — leave empty to keep)` : "https://…" });
      const chBox = (ico, title, sub, onSw, fields, hint) => el("div", { class: "op-ch" }, [el("div", { class: "op-ch-h" }, [el("span", { class: "em-rcard-ico" }, icon(ico, 18)), el("div", { class: "grow" }, [el("b", { text: title }), el("p", { class: "muted", text: sub })]), onSw]),
        el("div", { class: "op-ch-f" }, fields), hint ? el("p", { class: "muted mx-small", text: hint }) : null]);
      const saveCh = btn("Save channels", () => call(() => API.alertsSave({ channels: {
        email: { enabled: emOn.querySelector("input").checked, to: emTo.value.trim(), from: emFrom.value },
        telegram: { enabled: tgOn.querySelector("input").checked, token: tgTok.value.trim(), chat_id: tgChat.value.trim() },
        webhook: { enabled: whOn.querySelector("input").checked, url: whUrl.value.trim(), kind: whKind.value } } }), "Channels saved", (r) => { d = { ...d, ...r }; draw(); }), "btn-primary");
      body.append(card("Where alerts go", [el("div", { class: "op-chs" }, [
        chBox("mail", "Email", d.sendmail ? "Sent by this server's mail system." : "Needs the mail server (Email section) — or use Telegram/webhook.", emOn,
          [field("Send to", emTo), field("Send from", emFrom)]),
        chBox("send", "Telegram", "Instant on your phone. Free.", tgOn, [field("Bot token", tgTok), field("Chat ID", tgChat)],
          "Create a bot with @BotFather and copy its token; send your bot any message, then get your chat ID from @userinfobot."),
        chBox("link", "Webhook", "Discord, Slack, ntfy push, or any URL.", whOn, [field("Type", whKind), field("URL", whUrl)],
          "ntfy: install the ntfy app, subscribe to a hard-to-guess topic and use https://ntfy.sh/<topic>."),
      ]), el("div", { class: "toolbar" }, [saveCh])]));
      // rules
      const r = d.rules;
      const n = (k, min, max, suffix) => { const i = el("input", { type: "number", min, max, value: r[k], class: "op-num" }); i.dataset.k = k; return el("span", { class: "op-numw" }, [i, el("span", { class: "muted", text: suffix })]); };
      const t2 = (k, label, hint) => { const s = sw(r[k], () => {}); s.querySelector("input").dataset.k = k; return el("label", { class: "op-rule" }, [s, el("div", {}, [el("b", { text: label }), el("p", { class: "muted", text: hint })])]); };
      const rules = el("div", { class: "op-rules" }, [
        el("div", { class: "op-rule" }, [el("b", { text: "Disk fuller than" }), n("disk_pct", 50, 99, "%")]),
        el("div", { class: "op-rule" }, [el("b", { text: "Memory above" }), n("mem_pct", 50, 100, "%")]),
        el("div", { class: "op-rule" }, [el("b", { text: "CPU hotter than" }), n("temp_c", 50, 100, "°C")]),
        el("div", { class: "op-rule" }, [el("b", { text: "Certificate expires within" }), n("cert_days", 1, 60, "days")]),
        el("div", { class: "op-rule" }, [el("b", { text: "WAF blocks in 10 minutes" }), n("waf_burst", 5, 10000, "or more")]),
        el("div", { class: "op-rule" }, [el("b", { text: "Failed panel logins in 15 min" }), n("login_fails", 3, 1000, "or more")]),
        t2("services", "A service stops", "Web, mail, database, DNS, VPN, fail2ban, Docker…"),
        t2("backups", "A backup fails", "Or hasn't succeeded for twice its schedule."),
        t2("updates", "Security updates are waiting", "Checked every 6 hours."),
        t2("reboot", "A restart is needed", "After kernel or system library updates."),
        t2("power", "Raspberry Pi power problems", "Under-voltage or throttling."),
      ]);
      const minLvl = el("select", { class: "em-select mx-narrow" }, [["info", "Everything"], ["warning", "Warnings and critical"], ["critical", "Critical only"]].map(([v, l]) => el("option", { value: v, text: l })));
      minLvl.value = d.min_level;
      const remind = el("select", { class: "em-select mx-narrow" }, [[0, "Never"], [1, "Every hour"], [6, "Every 6 hours"], [24, "Every day"], [72, "Every 3 days"]].map(([v, l]) => el("option", { value: v, text: l })));
      remind.value = String(d.remind_hours);
      const quiet = sw(d.quiet, () => {});
      body.append(card("When to alert", [rules, el("div", { class: "op-rules2" }, [field("Send", minLvl), field("Remind me while it lasts", remind),
        el("label", { class: "op-rule" }, [quiet, el("div", {}, [el("b", { text: "Pause all alerts" }), el("p", { class: "muted", text: "Problems are still recorded below." })])])]),
        el("div", { class: "toolbar" }, [btn("Save", () => {
          const rr = {};
          rules.querySelectorAll("[data-k]").forEach((i) => { rr[i.dataset.k] = i.type === "checkbox" ? i.checked : +i.value; });
          call(() => API.alertsSave({ rules: rr, min_level: minLvl.value, remind_hours: +remind.value, quiet: quiet.querySelector("input").checked }), "Saved", (x) => { d = { ...d, ...x }; draw(); });
        }, "btn-primary")])]));
      body.append(card("History", [d.history.length ? el("div", { class: "mx-list" }, d.history.slice(0, 60).map((h) => el("div", { class: "mx-list-row" }, [
        pill(h.event === "resolved" ? "resolved" : LVL[h.level]?.[0] || h.level, h.event === "resolved" ? "good" : LVL[h.level]?.[1]),
        el("span", { class: "grow mx-ell", text: h.title }), el("span", { class: "muted", text: t2s(h.ts) })]))) : el("p", { class: "muted", text: "Nothing has happened yet." })]));
    }
    load();
  }

  // ======================================================================
  //  Files → Scheduled Backups
  // ======================================================================
  const DEST_T = { local: ["Folder on this machine", "disk", "A USB drive or second disk, e.g. /mnt/usb/backups"], s3: ["S3 storage", "t_cloud", "Amazon S3, Cloudflare R2, Wasabi, DigitalOcean Spaces, MinIO…"],
    b2: ["Backblaze B2", "t_cloud", "Cheap, reliable cloud storage"], sftp: ["SFTP server", "t_transfer", "Another server or NAS you can SSH into"],
    webdav: ["WebDAV / Nextcloud", "t_cloud", "Nextcloud, ownCloud, Synology, any WebDAV"], rclone: ["Other (rclone)", "link", "Google Drive, OneDrive, Dropbox… paste an rclone remote"] };
  const FREQ = { hourly: "Every hour", daily: "Every day", weekly: "Every week", monthly: "Every month" };
  const WD = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const WHAT = [["sites", "Websites", "Every site's files"], ["databases", "Databases", "All MariaDB and PostgreSQL databases"], ["mail", "Email", "Mailboxes, DKIM keys, calendars"],
    ["panel", "Server settings", "Panel, Apache, mail, DNS, certificates, VPN, firewall"], ["home", "Home folder", "Your user's home directory"]];
  function schedText(p) {
    return p.freq === "hourly" ? `Every hour at :${p.time.slice(3)}` : p.freq === "weekly" ? `Every ${WD[p.weekday]} at ${p.time}`
      : p.freq === "monthly" ? `On day ${p.monthday} of every month at ${p.time}` : `Every day at ${p.time}`;
  }
  async function viewSchedBackups(root) {
    root.append(pageHead("Scheduled Backups", "Automatic backups that leave this machine — to cloud storage, another server or a USB disk — so a dead SD card, a hacked site or a deleted file is never the end. Encrypted before they leave, old copies cleaned up for you.",
      [btn("Backups (manual)", () => navigate("backups"), "btn-ghost")]));
    const body = el("div", {}, el("div", { class: "loading", text: "Loading…" }));
    root.append(body);
    let d, poll = null;
    state.cleanups.push(() => clearInterval(poll));
    async function load() {
      try { d = await API.schedules(); } catch (e) { body.innerHTML = ""; body.append(el("p", { class: "empty", text: e.message })); return; }
      draw();
      clearInterval(poll);
      if (d.plans.some((p) => p.running)) poll = setInterval(load, 4000);
    }
    function draw() {
      body.innerHTML = "";
      // plans
      if (!d.plans.length) {
        body.append(el("div", { class: "card op-start" }, [el("div", { class: "op-start-ico" }, icon("backup", 34)), el("h3", { text: "No automatic backups yet" }),
          el("p", { class: "muted", text: "Two steps: tell AuroraPanel where to keep the copies, then what to back up and how often. A good start: everything, every night, kept for two weeks, encrypted, in cloud storage." }),
          el("div", { class: "toolbar" }, [btn(d.destinations.length ? "Create a backup plan" : "1. Add where to store backups", () => d.destinations.length ? planEditor() : destEditor(), "btn-primary"),
            d.destinations.length ? null : btn("Keep copies on this machine only", () => planEditor({ keep_local: 3 }), "btn-ghost")])]));
      } else {
        body.append(el("div", { class: "op-plans" }, d.plans.map(planCard)), el("div", { class: "toolbar" }, [btn("New backup plan", () => planEditor(), "btn-primary")]));
      }
      // destinations
      body.append(card("Where backups are stored", [
        d.destinations.length ? el("div", { class: "op-dests" }, d.destinations.map((x) => el("div", { class: "op-dest" }, [
          el("span", { class: "em-rcard-ico" }, icon(DEST_T[x.type][1], 18)),
          el("div", { class: "grow" }, [el("b", { text: x.name }), el("p", { class: "muted mx-ell", text: x.type === "local" ? x.path : [DEST_T[x.type][0], x.provider, x.bucket || x.host || x.url, x.prefix].filter(Boolean).join(" · ") })]),
          btn("Test", async (e) => { e.target.disabled = true; const r = await call(() => API.schedDestTest(x.id)); e.target.disabled = false; if (r) toast(`${x.name}: ${r.message} (${r.ms} ms)`, "good"); }, "btn-ghost"),
          btn("Edit", () => destEditor(x), "btn-ghost"),
          armed("Remove", "Click again", () => call(() => API.schedDestDelete(x.id), "Removed", load), "btn-ghost")]))) : el("p", { class: "muted", text: "Nowhere yet." }),
        el("div", { class: "toolbar" }, [btn("Add a destination", () => destEditor(), d.destinations.length ? "btn-ghost" : "btn-primary")]),
        d.ssh_key ? el("div", { class: "op-key" }, [el("p", { class: "muted mx-small", text: "SFTP destinations log in with this key — add it to ~/.ssh/authorized_keys on the other server:" }),
          el("div", { class: "em-copy" }, [el("code", { class: "em-mono", text: d.ssh_key }), el("button", { type: "button", class: "bk-mini", text: "Copy", onclick: async () => toast(await copyText(d.ssh_key) ? "Key copied" : "Copy failed", "good") })])]) : null,
      ]));
    }
    function planCard(p) {
      const last = p.last || {};
      const dests = p.dests.map((id) => (d.destinations.find((x) => x.id === id) || {}).name).filter(Boolean);
      const what = WHAT.filter(([k]) => p.what[k]).map(([, l]) => l).concat(p.what.paths.length ? [`${p.what.paths.length} folder(s)`] : []);
      const stateP = p.running ? pill("running…", "warn") : !p.enabled ? pill("paused") : !last.ts ? pill("not run yet") : last.ok ? pill("last run ok", "good") : pill("last run failed", "bad");
      const logBox = el("pre", { class: "mx-pre op-log", hidden: "" });
      if (p.running) API.schedLog(p.id).then((l) => { logBox.hidden = false; logBox.textContent = l.text || "Starting…"; logBox.scrollTop = 1e9; }).catch(() => {});
      return el("div", { class: `card op-plan ${last.ok === false ? "bad" : ""}` }, [
        el("div", { class: "op-plan-h" }, [el("span", { class: "op-plan-ico" }, icon("backup", 20)), el("div", { class: "grow" }, [el("h3", { text: p.name }), el("p", { class: "muted", text: `${schedText(p)} · keeps ${p.keep} cop${p.keep === 1 ? "y" : "ies"}${p.encrypt ? " · 🔒 encrypted" : ""}` })]), stateP]),
        el("div", { class: "op-plan-facts" }, [
          el("div", {}, [el("span", { class: "muted", text: "Backs up" }), el("b", { text: what.join(", ") })]),
          el("div", {}, [el("span", { class: "muted", text: "Sends to" }), el("b", { text: [...dests, p.keep_local ? `this machine (${p.keep_local})` : null].filter(Boolean).join(", ") })]),
          el("div", {}, [el("span", { class: "muted", text: "Last run" }), el("b", { text: last.ts ? `${ago(last.ts)}${last.size ? ` · ${fmtBytes(last.size)}` : ""}${last.secs != null ? ` · ${dur(last.secs)}` : ""}` : "—" })]),
          el("div", {}, [el("span", { class: "muted", text: "Next run" }), el("b", { text: p.enabled && p.next ? `${t2s(p.next)} (${timeIn(p.next)})` : "paused" })]),
        ]),
        last.ok === false ? el("div", { class: "mx-note" }, [icon("warning", 16), el("span", { text: last.error || "Failed — see the log." })]) : null,
        logBox,
        el("div", { class: "toolbar" }, [
          btn(p.running ? "Running…" : "Back up now", async (e) => { e.target.disabled = true; if (await call(() => API.schedRun(p.id), "Backup started")) setTimeout(load, 1500); }, "btn-primary"),
          btn("Copies & restore", () => snapshotsModal(p), "btn-ghost"),
          btn("Log", async () => { const l = await call(() => API.schedLog(p.id)); if (l) openModal(`Last run of ${p.name}`, el("pre", { class: "mx-pre", style: "max-height:60vh", text: l.text || "No runs yet." }), []); }, "btn-ghost"),
          btn("Edit", () => planEditor(p), "btn-ghost"),
          p.encrypt ? btn("Show passphrase", async () => { const r = await call(() => API.schedPass(p.id)); if (r) openModal("Encryption passphrase", el("div", {}, [
            el("p", { class: "muted", text: "Without this passphrase the off-site copies can't be opened. Keep it somewhere safe outside this server (a password manager)." }),
            el("div", { class: "em-copy" }, [el("code", { class: "em-mono", text: r.passphrase }), el("button", { type: "button", class: "bk-mini", text: "Copy", onclick: async () => toast(await copyText(r.passphrase) ? "Copied" : "Copy failed", "good") })]),
            el("p", { class: "muted mx-small", text: "To open a copy by hand: openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in FILE.tar.gz.enc -out FILE.tar.gz" })]), []); }, "btn-ghost") : null,
          armed("Delete plan", "Click again", () => call(() => API.schedPlanDelete(p.id), "Plan deleted", load), "btn-ghost"),
        ]),
      ]);
    }
    async function snapshotsModal(p) {
      const box = el("div", {}, el("div", { class: "loading", text: "Listing copies…" }));
      openModal(`Copies of “${p.name}”`, box, []); modalWide();
      let r;
      try { r = await API.schedSnaps(p.id); } catch (e) { box.innerHTML = ""; box.append(el("p", { class: "empty", text: e.message })); return; }
      box.innerHTML = "";
      Object.entries(r.errors).forEach(([id, msg]) => box.append(el("div", { class: "mx-note" }, [icon("warning", 16), el("span", { text: `${(d.destinations.find((x) => x.id === id) || {}).name || id}: ${msg}` })])));
      if (!r.snapshots.length) { box.append(empty("backup", "No copies yet", "Run the plan once (“Back up now”).")); return; }
      box.append(el("p", { class: "muted", text: "Restore brings a copy back to this machine (decrypting it) and opens it in Backups, where you choose exactly which files and databases to put back." }),
        el("div", { class: "table-wrap" }, el("table", { class: "mx-table" }, [el("thead", {}, el("tr", {}, ["Copy", "Where", "Size", "Made", ""].map((h) => el("th", { text: h })))),
          el("tbody", {}, r.snapshots.map((s) => el("tr", {}, [el("td", { class: "mx-ell", text: s.name }), el("td", { text: s.where }), el("td", { class: "num", text: fmtBytes(s.size) }),
            el("td", { text: s.time ? ago(s.time) : "—" }),
            el("td", { class: "mx-actions" }, btn("Restore…", async (e) => { e.target.disabled = true; e.target.textContent = "Fetching…";
              const x = await call(() => API.schedFetch(p.id, s.dest, s.name), "Copy fetched — choose what to restore");
              if (x) { closeModal(); state.backupFocus = x.name; navigate("backupwiz"); } else { e.target.disabled = false; e.target.textContent = "Restore…"; } }, "btn-primary"))])))])));
    }
    function planEditor(p = {}) {
      const isNew = !p.id;
      const w = p.what || { sites: true, databases: true, mail: true, panel: true, home: false, paths: [] };
      const name = el("input", { type: "text", value: p.name || "Full server backup", maxlength: 60 });
      const checks = WHAT.map(([k, l, h]) => { const c = el("input", { type: "checkbox" }); c.checked = !!w[k]; c.dataset.k = k;
        return el("label", { class: "op-what" }, [c, el("div", {}, [el("b", { text: l }), el("span", { class: "muted", text: h })])]); });
      const paths = el("textarea", { rows: 2, placeholder: "Extra folders, one per line (optional)", class: "mx-mono" }); paths.value = (w.paths || []).join("\n");
      let freq = p.freq || "daily";
      const time = el("input", { type: "time", value: p.time || "03:30" });
      const wday = el("select", { class: "em-select" }, WD.map((x, i) => el("option", { value: i, text: x }))); wday.value = String(p.weekday || 0);
      const mday = el("input", { type: "number", min: 1, max: 28, value: p.monthday || 1 });
      const extra = el("div", { class: "op-when-x" });
      const drawWhen = () => { extra.innerHTML = ""; if (freq === "weekly") extra.append(field("Day", wday)); if (freq === "monthly") extra.append(field("Day of month", mday)); };
      const keep = el("input", { type: "number", min: 1, max: 365, value: p.keep || 14 });
      const keepLocal = el("input", { type: "number", min: 0, max: 30, value: p.keep_local ?? 1 });
      const dests = d.destinations.map((x) => { const c = el("input", { type: "checkbox" }); c.checked = isNew ? true : (p.dests || []).includes(x.id); c.value = x.id;
        return el("label", { class: "dm-check" }, [c, el("span", { text: `${x.name} (${DEST_T[x.type][0]})` })]); });
      const enc = el("input", { type: "checkbox" }); enc.checked = isNew ? true : !!p.encrypt;
      const pass = el("input", { type: "text", placeholder: p.encrypt ? "(unchanged — leave empty)" : "Leave empty to generate a strong one", autocomplete: "off" });
      const enabled = el("input", { type: "checkbox" }); enabled.checked = p.enabled !== false;
      drawWhen();
      openModal(isNew ? "New backup plan" : `Edit “${p.name}”`, el("div", { class: "em-form" }, [
        field("Name", name),
        el("div", { class: "mx-sub" }, "What"), el("div", { class: "op-whats" }, checks), paths,
        el("div", { class: "mx-sub" }, "When"),
        el("div", { class: "op-when" }, [seg(Object.entries(FREQ), freq, (v) => { freq = v; drawWhen(); }), field(freq === "hourly" ? "Minute (hh:MM)" : "Time", time), extra]),
        el("div", { class: "mx-sub" }, "Where & how long"),
        dests.length ? el("div", { class: "op-destpick" }, dests) : el("p", { class: "muted", text: "No destinations yet — copies stay on this machine only (add one later for real safety)." }),
        el("div", { class: "mx-grid2" }, [field("Copies to keep at each destination", keep, "Older ones are deleted after each run."), field("Copies also kept on this machine", keepLocal, "0 = none (saves disk space).")]),
        el("label", { class: "dm-check" }, [enc, el("span", { text: "Encrypt with AES-256 before sending (recommended)" })]), field("Passphrase", pass, "Saved on this server so backups run unattended — but keep a copy elsewhere: without it, the off-site copies can't be opened."),
        el("label", { class: "dm-check" }, [enabled, el("span", { text: "Plan is active" })]),
      ]), [el("button", { class: "btn btn-primary", text: isNew ? "Create plan" : "Save", onclick: () => call(() => API.schedPlanSave({
        id: p.id, name: name.value.trim(), freq, time: time.value, weekday: +wday.value, monthday: +mday.value, keep: +keep.value, keep_local: +keepLocal.value,
        dests: dests.map((l) => l.querySelector("input")).filter((c) => c.checked).map((c) => c.value), encrypt: enc.checked, passphrase: pass.value, enabled: enabled.checked,
        what: { ...Object.fromEntries(checks.map((l) => [l.querySelector("input").dataset.k, l.querySelector("input").checked])), paths: paths.value.split("\n").map((x) => x.trim()).filter(Boolean) },
      }), isNew ? "Plan created — it runs on schedule; “Back up now” tests it right away" : "Saved", () => { closeModal(); load(); }) })]);
      modalWide();
    }
    function destEditor(x = null) {
      let type = x ? x.type : "s3";
      const box = el("div", {});
      const pick = el("div", { class: "op-dtypes" });
      const drawPick = () => { pick.innerHTML = ""; Object.entries(DEST_T).forEach(([k, [l, ico, h]]) => pick.append(el("button", { type: "button", class: `op-dtype ${k === type ? "on" : ""}`, disabled: x && k !== type ? "" : null,
        onclick: () => { type = k; drawPick(); drawForm(); } }, [el("span", { class: "em-rcard-ico" }, icon(ico, 18)), el("b", { text: l }), el("span", { class: "muted", text: h })]))); };
      const f = {};
      const inp = (k, ph, typeAttr = "text", val = "") => (f[k] = el("input", { type: typeAttr, placeholder: ph, value: val, autocomplete: "off" }));
      function drawForm() {
        box.innerHTML = "";
        Object.keys(f).forEach((k) => delete f[k]);
        const v = (k) => (x && x[k]) || "";
        box.append(field("Name", inp("name", DEST_T[type][0], "text", x ? x.name : "")));
        if (type !== "local" && !d.rclone) {
          box.append(requireCard ? el("div", { id: "op-rq" }) : el("p", { class: "empty", text: "Install rclone first." }));
          if (requireCard) { const host = box.querySelector("#op-rq"); API.requires(["rclone"]).then((st) => host.append(requireCard([st.components.rclone], "Off-site backups", false, () => load().then(() => destEditor(x))))).catch(() => {}); }
          return;
        }
        if (type === "local") box.append(field("Folder", inp("path", "/mnt/usb/aurora-backups", "text", v("path")), "Best on a different disk than the system (a USB drive). It's created if missing."));
        if (type === "s3") {
          const prov = el("select", { class: "em-select" }, Object.entries(d.s3_providers).map(([k, l]) => el("option", { value: k, text: l }))); prov.value = v("provider") || "Cloudflare"; f.provider = prov;
          box.append(field("Provider", prov), el("div", { class: "mx-grid2" }, [field("Access key ID", inp("access_key", x ? "(saved — leave empty to keep)" : "")), field("Secret access key", inp("secret_key", x ? "(saved)" : "", "password"))]),
            el("div", { class: "mx-grid2" }, [field("Bucket", inp("bucket", "my-backups", "text", v("bucket"))), field("Folder in the bucket (optional)", inp("prefix", "aurora", "text", v("prefix")))]),
            el("div", { class: "mx-grid2" }, [field("Endpoint", inp("endpoint", "R2: https://<account>.r2.cloudflarestorage.com", "text", v("endpoint")), "Leave empty for Amazon S3."), field("Region", inp("region", "auto / us-east-1", "text", v("region")))]));
        }
        if (type === "b2") box.append(el("div", { class: "mx-grid2" }, [field("Application key ID", inp("access_key", x ? "(saved — leave empty to keep)" : "")), field("Application key", inp("secret_key", x ? "(saved)" : "", "password"))]),
          el("div", { class: "mx-grid2" }, [field("Bucket", inp("bucket", "my-backups", "text", v("bucket"))), field("Folder (optional)", inp("prefix", "aurora", "text", v("prefix")))]));
        if (type === "sftp") box.append(el("div", { class: "mx-grid2" }, [field("Host", inp("host", "backup.example.com", "text", v("host"))), field("Port", inp("port", "22", "number", v("port") || "22"))]),
          el("div", { class: "mx-grid2" }, [field("User", inp("user", "backup", "text", v("user"))), field("Folder", inp("path", "backups/aurora", "text", v("prefix")))]),
          field("Password (optional)", inp("password", "Leave empty to use the key shown on the Scheduled Backups page", "password")));
        if (type === "webdav") {
          const vendor = el("select", { class: "em-select" }, [["nextcloud", "Nextcloud"], ["owncloud", "ownCloud"], ["other", "Other WebDAV"]].map(([a, b]) => el("option", { value: a, text: b }))); vendor.value = v("vendor") || "nextcloud"; f.vendor = vendor;
          box.append(field("Server", vendor), field("WebDAV URL", inp("url", "https://cloud.example.com/remote.php/dav/files/USER/", "url", v("url"))),
            el("div", { class: "mx-grid2" }, [field("User", inp("user", "", "text", v("user"))), field("App password", inp("password", x ? "(saved — leave empty to keep)" : "", "password"))]), field("Folder", inp("path", "Backups/aurora", "text", v("prefix"))));
        }
        if (type === "rclone") {
          f.conf = el("textarea", { rows: 6, class: "mx-mono", placeholder: "type = drive\nscope = drive.file\ntoken = {\"access_token\":…}" });
          box.append(el("p", { class: "muted", text: "For Google Drive, OneDrive, Dropbox and others: run “rclone config” on your computer, then paste the lines under your remote's [name] here (from rclone.conf)." }),
            field("rclone remote", f.conf), field("Folder (optional)", inp("path", "aurora-backups", "text", v("prefix"))));
        }
      }
      drawPick(); drawForm();
      openModal(x ? `Edit ${x.name}` : "Where should backups go?", el("div", { class: "em-form" }, [pick, box]), [el("button", { class: "btn btn-primary", text: x ? "Save" : "Add & test", onclick: async (e) => {
        const data = { id: x?.id, type };
        Object.entries(f).forEach(([k, i]) => { data[k] = i.value.trim(); });
        e.target.disabled = true;
        const r = await call(() => API.schedDestSave(data));
        if (!r) { e.target.disabled = false; return; }
        const t = await call(() => API.schedDestTest(r.id));
        e.target.disabled = false;
        if (t) { toast(`${r.name}: ${t.message}`, "good"); closeModal(); load(); }
      } })]);
      modalWide();
    }
    load();
  }

  // ======================================================================
  //  System → Updates
  // ======================================================================
  async function viewUpdates(root) {
    root.append(pageHead("Updates", "Security fixes and new versions for everything installed on this server. Install them with one click, or let the server install security updates by itself every night."));
    const body = el("div", {}, el("div", { class: "loading", text: "Loading…" }));
    const prog = progressBox();
    const log = el("pre", { class: "log op-log", hidden: "" });
    root.append(prog.node, log, body);
    let d, sel = new Set();
    async function load() {
      try { d = await API.updates(); } catch (e) { body.innerHTML = ""; body.append(el("p", { class: "empty", text: e.message })); return; }
      if (d.running) watch(d.running);
      draw();
    }
    async function watch(id) {
      log.hidden = false;
      const j = await waitJob(id, (j) => { prog.set(j); log.textContent = j.output || ""; log.scrollTop = 1e9; });
      if (j) { toast(j.status === "done" ? "Updates installed" : "Updating failed — see the log", j.status === "done" ? "good" : "bad"); load(); }
    }
    function draw() {
      body.innerHTML = "";
      if (!d.supported) { body.append(el("p", { class: "empty", text: "This system has no apt." })); return; }
      const rb = d.reboot;
      body.append(el("div", { class: `card mx-hero ${d.security ? "bad" : d.total ? "warn" : "good"}` }, [
        el("div", { class: "mx-hero-ico" }, icon(d.total ? "packages" : "check", 28)),
        el("div", { class: "mx-hero-txt" }, [el("h3", { text: d.total ? `${d.total} update${d.total > 1 ? "s" : ""} available${d.security ? ` — ${d.security} for security` : ""}` : "Everything is up to date" }),
          el("p", { class: "muted", text: `Checked ${d.checked ? ago(d.checked) : "never"}${d.auto.enabled ? ` · automatic ${d.auto.mode === "all" ? "updates" : "security updates"} on` : " · automatic updates off"}.${d.error ? " Last check had a problem: " + d.error : ""}` })]),
        el("div", { class: "mx-hero-act" }, [btn("Check now", async (e) => { e.target.disabled = true; e.target.textContent = "Checking…"; await call(() => API.updatesRefresh()); load(); }, "btn-ghost"),
          d.total ? btn(`Install all ${d.total}`, () => call(() => API.updatesInstall([]), "Updating…", (r) => watch(r.job)), "btn-primary") : null]),
      ]));
      if (rb.required) body.append(el("div", { class: "card op-reboot" }, [icon("refresh", 20), el("div", { class: "grow" }, [el("b", { text: "Restart needed to finish updating" }),
        el("p", { class: "muted", text: `${rb.packages.length ? rb.packages.slice(0, 6).join(", ") + (rb.packages.length > 6 ? "…" : "") : "System packages"} were updated. Websites and mail are offline for about a minute while it restarts.` })]),
        armed("Restart in 1 minute", "Click again to restart", () => call(() => API.reboot(1), "Restarting in 1 minute — the panel comes back by itself"), "btn-primary"),
        btn("Cancel a planned restart", () => call(() => API.reboot(0, true), "Cancelled"), "btn-ghost")]));
      // automatic updates
      const a = d.auto;
      let mode = a.mode;
      const on = sw(a.enabled, () => {});
      const rbOn = sw(a.reboot, () => {});
      const rbTime = el("input", { type: "time", value: a.reboot_time || "04:00" });
      body.append(card("Automatic updates", [
        el("label", { class: "op-rule" }, [on, el("div", {}, [el("b", { text: "Install updates automatically every night" }), el("p", { class: "muted", text: a.installed ? `Uses Debian's unattended-upgrades.${a.last ? " Last: " + a.last.replace(/^\S+ \S+ INFO /, "") : ""}` : "Installs Debian's unattended-upgrades the first time." })])]),
        el("div", { class: "op-auto" }, [seg([["security", "Security fixes only (safest)"], ["all", "All updates"]], mode, (v) => { mode = v; }),
          el("label", { class: "op-rule" }, [rbOn, el("div", {}, [el("b", { text: "Restart by itself when an update needs it" }), el("p", { class: "muted", text: "Only when needed, at the time below." })])]), field("Restart time", rbTime)]),
        el("div", { class: "toolbar" }, [btn("Save", () => call(() => API.updatesAuto(on.querySelector("input").checked, mode, rbOn.querySelector("input").checked, rbTime.value), "Saved",
          (r) => { if (r && r.job) watch(r.job); else load(); }), "btn-primary")])]));
      // list
      if (d.packages.length) {
        const selBtn = btn("Install selected", () => call(() => API.updatesInstall([...sel]), "Updating…", (r) => watch(r.job)), "btn-ghost");
        const upd = () => { selBtn.disabled = !sel.size; selBtn.textContent = sel.size ? `Install ${sel.size} selected` : "Install selected"; };
        upd();
        body.append(card(`Waiting updates (${d.packages.length})`, [el("div", { class: "table-wrap mx-table-wrap" }, el("table", { class: "mx-table" }, [
          el("thead", {}, el("tr", {}, ["", "Package", "Now", "New", "From"].map((h) => el("th", { text: h })))),
          el("tbody", {}, d.packages.map((p) => { const c = el("input", { type: "checkbox", onchange: () => { c.checked ? sel.add(p.name) : sel.delete(p.name); upd(); } }); c.checked = sel.has(p.name);
            return el("tr", {}, [el("td", {}, c), el("td", {}, [el("b", { text: p.name }), p.security ? el("span", { class: "pill bad", style: "margin-left:8px", text: "security" }) : null]),
              el("td", { class: "muted mx-mono", text: p.from }), el("td", { class: "mx-mono", text: p.to }), el("td", { class: "muted", text: p.origin.split(",")[0] })]); })),
        ]))], "", [selBtn]));
      }
    }
    load();
  }

  // ======================================================================
  //  Security → AutoSSL
  // ======================================================================
  const AS = { ok: ["Covered", "good"], renew: ["Renewing soon", "warn"], missing: ["Will get one", "warn"], elsewhere: ["Points elsewhere", "dim"], nodns: ["No DNS record", "dim"], excluded: ["Excluded", "dim"] };
  async function viewAutoSSL(root) {
    root.append(pageHead("AutoSSL", "A free, trusted HTTPS certificate for every website and the mail server — requested, installed and renewed by itself. Names that don't point to this server are skipped until their DNS does.",
      [btn("SSL/TLS Certificates", () => navigate("ssl"), "btn-ghost")]));
    const body = el("div", {}, el("div", { class: "loading", text: "Checking every name…" }));
    root.append(body);
    let d, poll = null;
    state.cleanups.push(() => clearInterval(poll));
    async function load() {
      try { d = await API.autossl(); } catch (e) { body.innerHTML = ""; body.append(el("p", { class: "empty", text: e.message })); return; }
      draw();
      clearInterval(poll);
      if (d.running) poll = setInterval(load, 5000);
    }
    function draw() {
      body.innerHTML = "";
      const todo = d.plan.reduce((a, i) => a + i.names.filter((r) => r.state === "missing" || r.state === "renew").length, 0);
      const okN = d.plan.reduce((a, i) => a + i.names.filter((r) => r.state === "ok").length, 0);
      if (!d.certbot) { body.append(el("div", { class: "card" }, empty("lock", "Certbot isn't installed", "AutoSSL uses Certbot (Let's Encrypt's official client).", btn("Install it on the SSL/TLS page", () => navigate("ssl"), "btn-primary")))); return; }
      const email = el("input", { type: "email", value: d.email || "", placeholder: "you@example.com" });
      const agree = el("input", { type: "checkbox" }); agree.checked = d.agreed;
      body.append(el("div", { class: `card mx-hero ${d.enabled ? (todo ? "warn" : "good") : "bad"}` }, [
        el("div", { class: "mx-hero-ico" }, icon("lock", 28)),
        el("div", { class: "mx-hero-txt" }, [el("h3", { text: d.enabled ? (todo ? `${todo} name${todo > 1 ? "s" : ""} waiting for a certificate` : `All ${okN} names are covered`) : "AutoSSL is off" }),
          el("p", { class: "muted", text: d.running ? "Requesting certificates right now…" : d.enabled ? `Runs every night${d.last_run ? ` · last run ${ago(d.last_run)}` : ""}.` : "Turn it on to get certificates for every site automatically." })]),
        el("div", { class: "mx-hero-act" }, [d.enabled ? btn(d.running ? "Running…" : "Run now", (e) => { e.target.disabled = true; call(() => API.autosslRun(""), "AutoSSL started", () => setTimeout(load, 2000)); }, "btn-primary") : null,
          d.enabled ? btn("Turn off", () => call(() => API.autosslSave({ enabled: false }), "AutoSSL off", (r) => { d = r; draw(); }), "btn-ghost") : null]),
      ]));
      if (!d.enabled) body.append(card("Turn on AutoSSL", [
        field("Email for expiry notices", email, "Let's Encrypt writes here only if a certificate is about to expire and renewal keeps failing."),
        el("label", { class: "dm-check" }, [agree, el("span", {}, ["I agree to the ", el("a", { href: "https://letsencrypt.org/repository/", target: "_blank", rel: "noopener noreferrer", text: "Let's Encrypt Subscriber Agreement" })])]),
        el("div", { class: "toolbar" }, [btn("Turn on AutoSSL", () => call(() => API.autosslSave({ email: email.value.trim(), agreed: agree.checked, enabled: true }), "AutoSSL on — click Run now to start", (r) => { d = r; draw(); }), "btn-primary")])]));
      // per site
      body.append(card("Your sites", [d.plan.length ? el("div", { class: "op-sites" }, d.plan.map((it) => {
        const res = d.results[it.site];
        return el("div", { class: "op-site" }, [
          el("div", { class: "op-site-h" }, [icon(it.mail ? "mail" : "globe", 16), el("b", { text: it.site }), it.mail ? pill("mail server") : null, el("span", { class: "grow" }),
            d.enabled && it.names.some((r) => r.state === "missing" || r.state === "renew") ? btn("Get it now", () => call(() => API.autosslRun(it.site), "Requesting…", () => setTimeout(load, 2000)), "btn-ghost") : null]),
          it.note ? el("p", { class: "muted mx-small", text: it.note }) : null,
          el("div", { class: "op-names" }, it.names.map((r) => el("div", { class: "op-name" }, [el("code", { text: r.name }), pill(AS[r.state][0] + (r.state === "ok" || r.state === "renew" ? ` · ${r.days} days` : ""), AS[r.state][1]),
            el("span", { class: "muted mx-small mx-ell", text: r.state === "elsewhere" ? `→ ${r.addrs.join(", ")}` : r.state === "nodns" ? "add an A record in the Zone Editor" : r.cert ? `certificate “${r.cert}”` : "" })]))),
          res && res.ok === false ? el("div", { class: "mx-note" }, [icon("warning", 16), el("span", { text: `${t2s(res.ts)}: ${res.error}` })]) : res && res.ok ? el("p", { class: "muted mx-small", text: `✓ ${t2s(res.ts)}${res.note ? " — " + res.note : ""}` }) : null,
        ]);
      })) : el("p", { class: "muted", text: "No websites yet." })]));
      // wildcards
      if (d.zones.length) body.append(card("Wildcard certificates", [el("p", { class: "muted", text: "One certificate for every subdomain (*.example.com) — handy for Dynamic DNS names and Docker apps. Needs this server to answer DNS for the domain: the panel adds the proof record itself." }),
        el("div", { class: "mx-list" }, d.zones.map((z) => { const r = d.results[`*.${z}`]; const have = d.certs.find((c) => c.names.includes(`*.${z}`));
          return el("div", { class: "mx-list-row" }, [el("code", { text: `*.${z}` }), have ? pill(`valid · ${Math.round((have.expires - Date.now() / 1000) / 86400)} days`, "good") : r && r.ok === false ? pill("failed", "bad") : pill("none"),
            el("span", { class: "grow muted mx-small mx-ell", text: r && r.ok === false ? r.error : have ? "Renewed automatically by Certbot" : "" }),
            d.agreed ? btn(have ? "Renew" : "Get wildcard", () => call(() => API.autosslWildcard(z), "Requesting — this takes 1–4 minutes (waiting for DNS)", () => setTimeout(load, 60000)), "btn-ghost") : null]); }))]));
    }
    load();
  }

  return { activity: viewActivity, alerts: viewAlerts, schedbackups: viewSchedBackups, updates: viewUpdates, autossl: viewAutoSSL };
};
