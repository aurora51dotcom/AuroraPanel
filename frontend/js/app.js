/* AuroraPanel single-page app. */
(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const el = (tag, attrs = {}, children = []) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k === "html") node.innerHTML = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined) node.setAttribute(k, v);
    }
    for (const c of [].concat(children)) {
      if (c == null) continue;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return node;
  };

  // -------- formatting helpers --------
  const fmtBytes = (n) => {
    if (n == null) return "—";
    const u = ["B", "KB", "MB", "GB", "TB", "PB"];
    let i = 0, v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
  };
  const fmtUptime = (s) => {
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return [d && `${d}d`, (d || h) && `${h}h`, `${m}m`].filter(Boolean).join(" ");
  };
  const meterClass = (p) => (p >= 90 ? "bad" : p >= 75 ? "warn" : "");
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let toastTimer = null;
  function toast(msg, kind = "good") {
    const t = $("#toast");
    t.textContent = msg;
    t.className = `toast ${kind}`;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }

  window.addEventListener("aurora-updated", () => {
    if (document.querySelector(".update-banner")) return;
    document.body.append(el("div", { class: "update-banner", role: "status" }, [
      el("span", { text: "AuroraPanel was updated — reload to use the new version." }),
      el("button", { class: "btn btn-sm btn-primary", text: "Reload", onclick: () => location.reload() }),
    ]));
  });

  // ======================================================================
  //  SVG line icons (Lucide-style)
  // ======================================================================
  const ICONS = {
    dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>',
    terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
    services: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
    processes: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
    packages: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.3 7 12 12 20.7 7"/><line x1="12" y1="22" x2="12" y2="12"/>',
    network: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
    firewall: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/>',
    wizard: '<line x1="4" y1="20" x2="15" y2="9"/><path d="M17 3l.9 2.1L20 6l-2.1.9L17 9l-.9-2.1L14 6l2.1-.9z"/><circle cx="19" cy="15" r="1"/><circle cx="6" cy="6" r="1"/>',
    globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z"/>',
    redirect: '<polyline points="15 14 20 9 15 4"/><path d="M4 20v-7a4 4 0 0 1 4-4h12"/>',
    zone: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/>',
    refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15"/>',
    key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 8-8"/><path d="m16 6 2 2"/><path d="m18.5 3.5 2 2"/>',
    ban: '<circle cx="12" cy="12" r="10"/><line x1="4.9" y1="4.9" x2="19.1" y2="19.1"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    token: '<path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2 2 2 0 0 0 0 4 2 2 0 0 1-2 2H5a2 2 0 0 1-2-2 2 2 0 0 0 0-4z"/><line x1="13" y1="7" x2="13" y2="17" stroke-dasharray="2 2"/>',
    link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5"/>',
    trap: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12.5"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
    brick: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
    phone: '<rect x="7" y="2" width="10" height="20" rx="2.5"/><line x1="11" y1="18" x2="13" y2="18"/>',
    home: '<path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    virus: '<rect x="8" y="6" width="8" height="14" rx="4"/><path d="M8 12H4m16 0h-4M8 16H5m14 0h-3M8.5 8.5 6 6m9.5 2.5L18 6"/><path d="M9.5 3v2m5-2v2"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    disk: '<line x1="22" y1="12" x2="2" y2="12"/><path d="M5.5 5h13a2 2 0 0 1 1.8 1.1l1.4 3A2 2 0 0 1 22 10v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 .3-1L3.7 6A2 2 0 0 1 5.5 5z"/><line x1="6" y1="16" x2="6.01" y2="16"/><line x1="10" y1="16" x2="10.01" y2="16"/>',
    backup: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><line x1="10" y1="12" x2="14" y2="12"/>',
    cron: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>',
    indexes: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
    error: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    handler: '<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
    mime: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><polyline points="10 12 8 14 10 16"/><polyline points="14 12 16 14 14 16"/>',
    dns: '<circle cx="12" cy="12" r="2"/><path d="M4.9 4.9a10 10 0 0 0 0 14.2m14.2 0a10 10 0 0 0 0-14.2M7.8 7.8a6 6 0 0 0 0 8.4m8.4 0a6 6 0 0 0 0-8.4"/>',
    search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    menu: '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>',
    chevron: '<polyline points="9 6 15 12 9 18"/>',
    dot: '<circle cx="12" cy="12" r="3"/>',
    flame: '<path d="M12 22a7 7 0 0 0 7-7c0-4-3-6-4-9-1 2-2 3-3.5 3.5C11 7 11 4 9 2 8 6 5 9 5 15a7 7 0 0 0 7 7z"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
    apps: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><path d="M17.5 14v7M14 17.5h7"/>',
    wordpress: '<circle cx="12" cy="12" r="10"/><path d="M3.5 8.5 8 20l3-8.5M9 8.5h6M12.5 8.5 16 20l3.5-11.5M7 8.5h3.5M14 8.5h3.5"/>',
    wifi: '<path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M2 9a15 15 0 0 1 20 0"/><circle cx="12" cy="19.5" r="1"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>',
    vpn: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><rect x="9" y="10.5" width="6" height="5" rx="1"/><path d="M10.5 10.5V9a1.5 1.5 0 0 1 3 0v1.5"/>',
    plug: '<path d="M9 2v6M15 2v6"/><path d="M6 8h12v3a6 6 0 0 1-12 0z"/><path d="M12 17v5"/>',
    radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12 18.5 5.5"/><circle cx="12" cy="12" r="1"/>',
    tunnel: '<path d="M3 20V11a9 9 0 0 1 18 0v9"/><path d="M8 20v-7a4 4 0 0 1 8 0v7"/><line x1="2" y1="20" x2="22" y2="20"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
    info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="11"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M10.6 5.1A9.8 9.8 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.6 3.5M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><line x1="3" y1="3" x2="21" y2="21"/>',
    wand: '<path d="m15 4 1-2 1 2 2 1-2 1-1 2-1-2-2-1z"/><path d="m18 12 .7-1.3L20 10l-1.3-.7L18 8l-.7 1.3L16 10l1.3.7z"/><line x1="3" y1="21" x2="14" y2="10"/>',
    git: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="8" r="2.5"/><line x1="6" y1="8.5" x2="6" y2="15.5"/><path d="M18 10.5c0 4-6 3-11 6"/>',
  };
  // Polar-bear brand logo (filled, drawn on the aurora chip).
  const POLAR_BEAR = '<svg width="22" height="22" viewBox="0 0 24 24">'
    + '<circle cx="7.3" cy="6.4" r="2.3" fill="#fff"/><circle cx="16.7" cy="6.4" r="2.3" fill="#fff"/>'
    + '<circle cx="7.3" cy="6.4" r="1" fill="#eaf6ff"/><circle cx="16.7" cy="6.4" r="1" fill="#eaf6ff"/>'
    + '<ellipse cx="12" cy="13" rx="7.2" ry="6.4" fill="#fff"/>'
    + '<ellipse cx="12" cy="16.2" rx="3.3" ry="2.7" fill="#e6f2ff"/>'
    + '<circle cx="9.1" cy="11.8" r="0.95" fill="#0a1226"/><circle cx="14.9" cy="11.8" r="0.95" fill="#0a1226"/>'
    + '<ellipse cx="12" cy="15" rx="1.1" ry="0.9" fill="#0a1226"/>'
    + '</svg>';
  function brandLogo() {
    document.querySelectorAll(".brand-mark").forEach((m) => { m.innerHTML = POLAR_BEAR; });
  }
  function icon(name, size) {
    const span = document.createElement("span");
    span.className = "ic";
    span.innerHTML = `<svg width="${size || 18}" height="${size || 18}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ICONS.dot}</svg>`;
    return span;
  }
  // view/nav -> icon name
  const VIEW_ICONS = {
    dashboard: "dashboard", terminal: "terminal", services: "services", processes: "processes",
    packages: "packages", network: "network", firewall: "firewall", users: "users",
    mysql: "database", mysqlwiz: "wizard", pgsql: "database", pgwiz: "wizard",
    vhosts: "globe", redirects: "redirect", zones: "zone", dyndns: "refresh",
    ssh: "key", ipblocker: "ban", ssl: "lock", tokens: "token", hotlink: "link",
    leech: "trap", modsec: "brick", security: "phone", fixperms: "home", virus: "virus",
    files: "folder", disk: "disk", backups: "backup", cron: "cron", indexes: "indexes",
    errorpages: "error", handlers: "handler", mime: "mime", dns: "dns",
    appmgr: "packages", sysapps: "services", phpver: "brick", password: "lock", accountprefs: "services",
    contact: "phone", language: "globe", wordpress: "wordpress",
    vpn: "vpn", wireguard: "tunnel", openvpn: "key", ipsec: "shield", portcheck: "plug", netmon: "radar",
    images: "image", dirprivacy: "lock", webdisk: "disk", ftpaccounts: "folder", backupwiz: "wizard", git: "git", inodes: "indexes",
    about: "info",
  };
  function decorateNav() {
    document.querySelectorAll("#nav .nav-item").forEach((btn) => {
      const ic = btn.querySelector(".nav-ico");
      const name = VIEW_ICONS[btn.dataset.view];
      if (ic && name) { ic.textContent = ""; ic.appendChild(icon(name, 16)); }
    });
    document.querySelectorAll("[data-ic]").forEach((sp) => {
      if (!sp.querySelector("svg")) { sp.textContent = ""; sp.appendChild(icon(sp.dataset.ic, 18)); }
    });
  }
  function closeDrawer() { document.body.classList.remove("nav-open"); const o = $("#nav-overlay"); if (o) o.hidden = true; }
  function setupNav() {
    const toggle = $("#nav-toggle"), overlay = $("#nav-overlay");
    if (toggle) toggle.addEventListener("click", () => { document.body.classList.add("nav-open"); if (overlay) overlay.hidden = false; });
    if (overlay) overlay.addEventListener("click", closeDrawer);
    // Collapsible sidebar categories (persisted).
    let collapsed = [];
    try { collapsed = JSON.parse(localStorage.getItem("aurora-nav-collapsed") || "[]"); } catch (e) {}
    document.querySelectorAll("#nav .nav-group").forEach((g) => {
      const name = g.dataset.group || g.textContent.trim();
      g.dataset.group = name;
      if (!g.querySelector(".nav-group-chev")) {
        g.classList.add("nav-group-btn");
        const chev = document.createElement("span"); chev.className = "nav-group-chev"; chev.appendChild(icon("chevron", 12));
        g.appendChild(chev);
      }
      const apply = (isC) => {
        g.classList.toggle("collapsed", isC);
        let s = g.nextElementSibling;
        while (s && !s.classList.contains("nav-group")) { s.hidden = isC; s = s.nextElementSibling; }
      };
      apply(collapsed.includes(name));
      g.addEventListener("click", () => {
        const nowC = !g.classList.contains("collapsed");
        apply(nowC);
        collapsed = collapsed.filter((n) => n !== name); if (nowC) collapsed.push(name);
        try { localStorage.setItem("aurora-nav-collapsed", JSON.stringify(collapsed)); } catch (e) {}
      });
    });
  }

  // ======================================================================
  //  Shell chrome: icon rail (sections) + pill tabs (tools in a section)
  // ======================================================================
  const GROUP_ICONS = {
    System: "processes", Network: "network", Applications: "apps", Databases: "database", Domains: "globe", Security: "shield",
    Files: "folder", Advanced: "terminal", Software: "packages", Preferences: "gear",
  };
  let NAV_GROUPS = [];
  function buildNavGroups() {
    NAV_GROUPS = [];
    let cur = null;
    document.querySelectorAll("#nav > *").forEach((n) => {
      if (n.classList.contains("nav-group")) { cur = { name: n.dataset.group || n.textContent.trim(), items: [] }; NAV_GROUPS.push(cur); }
      else if (cur && n.dataset.view && n.dataset.view !== "dashboard") {
        cur.items.push({ view: n.dataset.view, label: n.textContent.trim() });
      }
    });
  }
  function groupOf(view) {
    if (view === "dashboard") return null;
    if (state.group) { const g = NAV_GROUPS.find((x) => x.name === state.group); if (g && g.items.some((i) => i.view === view)) return g; }
    return NAV_GROUPS.find((g) => g.items.some((i) => i.view === view)) || null;
  }
  function buildRail() {
    const box = $("#rail-groups");
    box.innerHTML = "";
    $("#rail-brand").onclick = () => navigate("dashboard");
    box.append(el("button", { class: "rail-btn", "data-rail": "Home", title: "Home", onclick: () => navigate("dashboard") }, icon("home", 19)));
    NAV_GROUPS.filter((g) => g.name !== "Preferences").forEach((g) => {
      box.append(el("button", { class: "rail-btn", "data-rail": g.name, title: g.name, onclick: () => { state.group = g.name; navigate(g.items[0].view); } }, icon(GROUP_ICONS[g.name] || "dot", 19)));
    });
    const pref = NAV_GROUPS.find((g) => g.name === "Preferences");
    const sb = $("#rail-settings");
    if (sb && pref) { sb.textContent = ""; sb.appendChild(icon("gear", 19)); sb.onclick = () => { state.group = pref.name; navigate(pref.items[0].view); }; }
  }
  function renderChrome(view) {
    const g = groupOf(view);
    state.group = g ? g.name : null;
    document.querySelectorAll(".rail-btn[data-rail]").forEach((b) => b.classList.toggle("active", b.dataset.rail === (g ? g.name : "Home")));
    const settings = $("#rail-settings");
    if (settings) settings.classList.toggle("active", !!g && g.name === "Preferences");
    const tabs = $("#tabs");
    tabs.innerHTML = "";
    const pill = (label, active, onclick) => el("button", { class: `tab ${active ? "active" : ""}`, text: label, onclick });
    tabs.append(pill("Home", !g, () => navigate("dashboard")));
    if (!g) NAV_GROUPS.forEach((x) => tabs.append(pill(x.name, false, () => { state.group = x.name; navigate(x.items[0].view); })));
    else g.items.forEach((i) => tabs.append(pill(i.label, i.view === view, () => navigate(i.view))));
    const act = tabs.querySelector(".tab.active");
    if (act && act.scrollIntoView) try { act.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (e) {}
    const user = $("#user-label").textContent;
    const h = new Date().getHours();
    const part = h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : h < 22 ? "Good evening" : "Good night";
    $("#view-title").textContent = g ? (TITLES[view] || view) : `${part}, ${user || "there"}!`;
    $("#view-crumb").textContent = g ? g.name : "";
  }
  function isoWeek(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
    return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
  }
  function tickClock() {
    const d = new Date();
    $("#now-date").textContent = d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
    $("#now-time").textContent = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
    $("#now-week").textContent = `Week ${isoWeek(d)}`;
  }
  function setupAvatar(username) {
    $("#avatar-initial").textContent = (username || "?").charAt(0).toUpperCase();
    const btn = $("#avatar-btn"), menu = $("#avatar-menu");
    btn.addEventListener("click", (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; });
    document.addEventListener("click", (e) => { if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true; });
  }

  // ======================================================================
  //  Theme toggle
  // ======================================================================
  function applyTheme(theme) {
    if (theme === "light") document.documentElement.setAttribute("data-theme", "light");
    else document.documentElement.removeAttribute("data-theme");
    const btn = $("#theme-btn");
    if (btn) { btn.textContent = ""; btn.appendChild(icon(theme === "light" ? "moon" : "sun", 17)); }
  }
  function initTheme() {
    let t = "dark";
    try { t = localStorage.getItem("aurora-theme") || "dark"; } catch (e) {}
    applyTheme(t);
    const btn = $("#theme-btn");
    if (btn) btn.addEventListener("click", () => {
      const cur = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
      const next = cur === "light" ? "dark" : "light";
      applyTheme(next);
      try { localStorage.setItem("aurora-theme", next); } catch (e) {}
    });
  }

  // ======================================================================
  //  Command palette (⌘K)
  // ======================================================================
  function allCommands() {
    const cmds = [];
    for (const [view, title] of Object.entries(TITLES)) {
      cmds.push({ label: title, view, icon: VIEW_ICONS[view] || "dot" });
    }
    cmds.push({ label: "phpMyAdmin", ext: "/phpmyadmin", icon: "database" });
    cmds.push({ label: "phpPgAdmin", ext: "/phppgadmin", icon: "database" });
    return cmds;
  }
  function fuzzy(q, s) {
    q = q.toLowerCase(); s = s.toLowerCase();
    if (!q) return 1;
    if (s.includes(q)) return 100 - s.indexOf(q);
    let i = 0; for (const ch of s) { if (ch === q[i]) i++; if (i === q.length) return 10; }
    return -1;
  }
  let cmdkEl = null, cmdkIdx = 0, cmdkList = [];
  function openCmdk() {
    if (cmdkEl) return;
    cmdkEl = el("div", { class: "cmdk-backdrop", onclick: (e) => { if (e.target === cmdkEl) closeCmdk(); } }, [
      el("div", { class: "cmdk" }, [
        el("div", { class: "cmdk-input-wrap" }, [icon("search", 18), el("input", { id: "cmdk-input", type: "text", placeholder: "Jump to any tool…", autocomplete: "off" })]),
        el("div", { class: "cmdk-list", id: "cmdk-results" }),
      ]),
    ]);
    document.body.appendChild(cmdkEl);
    const input = $("#cmdk-input");
    input.addEventListener("input", () => renderCmdk(input.value));
    input.addEventListener("keydown", cmdkKeys);
    renderCmdk("");
    setTimeout(() => input.focus(), 20);
  }
  function closeCmdk() { if (cmdkEl) { cmdkEl.remove(); cmdkEl = null; } }
  function renderCmdk(q) {
    const results = allCommands().map((c) => ({ c, score: fuzzy(q, c.label) }))
      .filter((r) => r.score >= 0).sort((a, b) => b.score - a.score).slice(0, 9).map((r) => r.c);
    cmdkList = results; cmdkIdx = 0;
    const box = $("#cmdk-results");
    box.innerHTML = "";
    if (!results.length) { box.append(el("div", { class: "cmdk-empty", text: "No matches" })); return; }
    results.forEach((c, i) => {
      const row = el("div", { class: `cmdk-item ${i === 0 ? "sel" : ""}`, "data-i": i,
        onmouseenter: () => { cmdkIdx = i; highlightCmdk(); },
        onclick: () => runCmdk(c) }, [
        icon(c.icon, 16), el("span", { text: c.label }), c.ext ? el("span", { class: "cmdk-tag", text: "port 80" }) : null,
      ]);
      box.append(row);
    });
  }
  function highlightCmdk() {
    document.querySelectorAll(".cmdk-item").forEach((r, i) => r.classList.toggle("sel", i === cmdkIdx));
  }
  function cmdkKeys(e) {
    if (e.key === "ArrowDown") { e.preventDefault(); cmdkIdx = Math.min(cmdkIdx + 1, cmdkList.length - 1); highlightCmdk(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); cmdkIdx = Math.max(cmdkIdx - 1, 0); highlightCmdk(); }
    else if (e.key === "Enter") { e.preventDefault(); if (cmdkList[cmdkIdx]) runCmdk(cmdkList[cmdkIdx]); }
    else if (e.key === "Escape") { closeCmdk(); }
  }
  function runCmdk(c) {
    closeCmdk();
    if (c.ext) window.open(`${location.protocol}//${location.hostname}${c.ext}`, "_blank");
    else navigate(c.view);
  }
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); cmdkEl ? closeCmdk() : openCmdk(); }
  });

  // ======================================================================
  //  Auth flow
  // ======================================================================
  const state = { view: "dashboard", needsSetup: false, refreshHandler: null, sysUser: null, sysHome: null };
  // The Pi's regular login (whoever installed the panel) — used for defaults/placeholders.
  const sysUser = () => state.sysUser || "pi";
  const sysHome = () => state.sysHome || `/home/${sysUser()}`;

  async function boot() {
    brandLogo();
    try {
      const s = await API.status();
      state.needsSetup = !s.initialized;
      if (!s.initialized) return showAuth(true);
      // Already have creds — check for a live session.
      try {
        const me = await API.me();
        return enterApp(me.username);
      } catch (e) {
        return showAuth(false);
      }
    } catch (e) {
      showAuth(false);
      toast("Cannot reach the server", "bad");
    }
  }

  function showAuth(setupMode) {
    $("#app-shell").hidden = true;
    $("#auth-screen").hidden = false;
    $("#auth-subtitle").textContent = setupMode
      ? "First run — create your admin account"
      : "Sign in to your Raspberry Pi";
    $("#auth-submit").textContent = setupMode ? "Create account" : "Sign in";
    $("#auth-password").setAttribute("autocomplete", setupMode ? "new-password" : "current-password");
    $("#auth-error").hidden = true;
    state.needsSetup = setupMode;
  }

  function ensureOtpField() {
    let wrap = $("#auth-otp-wrap");
    if (!wrap) {
      wrap = el("label", { id: "auth-otp-wrap", style: "display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--text-dim)" }, [
        "2FA code",
        el("input", { id: "auth-otp", type: "text", inputmode: "numeric", autocomplete: "one-time-code", placeholder: "6-digit code" }),
      ]);
      const errEl = $("#auth-error");
      errEl.parentNode.insertBefore(wrap, errEl);
    }
    wrap.hidden = false;
    $("#auth-otp").focus();
  }

  $("#auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = $("#auth-username").value.trim();
    const password = $("#auth-password").value;
    const otpEl = $("#auth-otp");
    const otp = otpEl ? otpEl.value.trim() : null;
    const errEl = $("#auth-error");
    errEl.hidden = true;
    try {
      if (state.needsSetup) {
        await API.setup(username, password);
        await API.login(username, password);
      } else {
        await API.loginOtp(username, password, otp || null);
      }
      $("#auth-password").value = "";
      enterApp(username);
    } catch (err) {
      if (err.message === "otp_required") {
        ensureOtpField();
        errEl.textContent = "Enter your authenticator code to continue.";
        errEl.hidden = false;
        return;
      }
      errEl.textContent = err.message;
      errEl.hidden = false;
    }
  });

  function enterApp(username) {
    $("#auth-screen").hidden = true;
    $("#app-shell").hidden = false;
    $("#user-label").textContent = username;
    state.meReady = API.me().then((m) => { state.sysUser = m.system_user; state.sysHome = m.home; }).catch(() => {});
    initTheme();
    decorateNav();
    setupNav();
    buildNavGroups();
    buildRail();
    setupAvatar(username);
    tickClock();
    setInterval(tickClock, 15000);
    const cmdkBtn = $("#cmdk-open");
    if (cmdkBtn) cmdkBtn.addEventListener("click", openCmdk);
    // Open the page named in the URL (#/openvpn) so refresh and bookmarks land where they were.
    navigate(viewFromHash() || "dashboard", { history: "replace" });
    window.addEventListener("popstate", () => {
      // Back/Forward: close an open dialog first, then show the page from the URL.
      closeModal(); closeCmdk();
      const v = viewFromHash() || "dashboard";
      if (v !== state.view || (argFromHash() || null) !== (state.viewArg || null)) navigate(v, { history: "none" });
    });
    API.overview().then((o) => { $("#host-label").textContent = o.hostname; $("#host-badge").textContent = o.hostname; }).catch(() => {});
    API.about().then((a) => {
      const v = $("#am-version");
      if (v) { v.textContent = `AuroraPanel ${a.label}`; v.onclick = () => { $("#avatar-menu").hidden = true; navigate("about"); }; }
    }).catch(() => {});
  }

  $("#logout-btn").addEventListener("click", async () => {
    try { await API.logout(); } catch (e) {}
    location.reload();
  });

  $("#refresh-btn").addEventListener("click", () => {
    if (state.refreshHandler) state.refreshHandler();
  });

  // ======================================================================
  //  Navigation
  // ======================================================================
  const TITLES = {
    dashboard: "Dashboard", terminal: "Terminal", services: "Services", processes: "Processes",
    packages: "Packages", cron: "Cron Jobs", files: "File Manager", disk: "Disk Usage",
    backups: "Backups", network: "Interfaces & Wi-Fi", firewall: "Firewall", users: "Users", security: "Security",
    indexes: "Indexes", mime: "MIME Types", errorpages: "Error Pages", handlers: "Apache Handlers",
    virus: "Virus Scanner", dns: "Track DNS",
    ssh: "SSH Access", ipblocker: "IP Blocker & Trust", ssl: "SSL/TLS Certificates", tokens: "Manage API Tokens",
    hotlink: "Hotlink Protection", redirects: "Redirects", modsec: "ModSecurity", leech: "Fail2ban",
    fixperms: "Fix Home Permissions", vhosts: "Domains", dyndns: "Dynamic DNS", zones: "Zone Editor",
    mysql: "Manage Databases", mysqlwiz: "MariaDB Wizard", pgsql: "PostgreSQL Databases",
    pgwiz: "PostgreSQL Wizard",
    sysapps: "System Applications", appmgr: "Application Manager", phpver: "PHP Settings",
    password: "Password & Security", accountprefs: "Account Preferences",
    contact: "Contact Information", language: "Change Language", wordpress: "WordPress",
    vpn: "VPN Overview", wireguard: "WireGuard", openvpn: "OpenVPN", ipsec: "IPsec / IKEv2 (strongSwan)",
    portcheck: "Port Checker", netmon: "Network Monitor",
    images: "Images", dirprivacy: "Directory Privacy", webdisk: "Web Disk", ftpaccounts: "FTP Accounts",
    backupwiz: "Backup Wizard", git: "Git Version Control", inodes: "Inodes Usage",
    about: "About & Updates",
  };

  $("#nav").addEventListener("click", (e) => {
    const btn = e.target.closest(".nav-item");
    if (btn) navigate(btn.dataset.view);
  });

  // "#/wireguard" -> "wireguard"; "#/sysapps/vsftpd" -> view "sysapps", arg "vsftpd".
  // Only known pages; anything else falls back to the dashboard.
  function viewFromHash() {
    const m = /^#\/([a-z0-9_-]+)(?:\/([^?#]*))?/i.exec(location.hash || "");
    return m && (TITLES[m[1]] || m[1] === "dashboard") ? m[1] : null;
  }
  function argFromHash() {
    const m = /^#\/[a-z0-9_-]+\/([^?#]+)/i.exec(location.hash || "");
    try { return m ? decodeURIComponent(m[1]) : null; } catch (e) { return null; }
  }
  const argToUrl = (a) => encodeURIComponent(a).replace(/%3A/g, ":");
  // Sub-page inside a view (a tab, an app id): updates the URL without re-rendering.
  function setViewArg(arg, replace) {
    state.viewArg = arg || null;
    const hash = `#/${state.view}${arg ? "/" + argToUrl(arg) : ""}`;
    if (location.hash !== hash) history[replace ? "replaceState" : "pushState"]({ view: state.view, arg }, "", hash);
  }
  // opts.history: "push" (default, a user click) | "replace" (startup) | "none" (Back/Forward)
  // opts.arg: optional sub-page (#/view/arg)
  function navigate(view, opts = {}) {
    if (!TITLES[view] && view !== "dashboard") view = "dashboard";
    const mode = opts.history || "push";
    state.viewArg = opts.arg !== undefined ? opts.arg : (mode === "push" ? null : argFromHash());
    const hash = `#/${view}${state.viewArg ? "/" + argToUrl(state.viewArg) : ""}`;
    if (mode === "push" && location.hash !== hash) history.pushState({ view }, "", hash);
    else if (mode === "replace" && location.hash !== hash) history.replaceState({ view }, "", hash);
    document.title = view === "dashboard" ? "AuroraPanel" : `${TITLES[view]} · AuroraPanel`;
    // Run any per-view cleanups (polling timers, sockets) before switching.
    (state.cleanups || []).forEach((fn) => { try { fn(); } catch (e) {} });
    state.cleanups = [];
    closeDrawer();
    state.view = view;
    state.refreshHandler = null;
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
    $("#view-title").textContent = TITLES[view] || view;
    renderChrome(view);
    const root = $("#view-root");
    root.innerHTML = "";
    // Scroll back to the top so a short view never looks blank.
    try { window.scrollTo(0, 0); const c = document.querySelector(".content"); if (c) c.scrollTop = 0; } catch (e) {}
    // Tear down any active terminal when leaving its view.
    if (view !== "terminal" && termCtx.dispose) { termCtx.dispose(); }
    ({
      dashboard: viewDashboard,
      terminal: viewTerminal,
      services: viewServices,
      processes: viewProcesses,
      packages: viewPackages,
      cron: viewCron,
      files: viewFiles,
      disk: viewDisk,
      backups: viewBackups,
      network: viewNetwork,
      firewall: viewFirewall,
      users: viewUsers,
      security: viewSecurity,
      indexes: viewIndexes,
      mime: viewMime,
      errorpages: viewErrorPages,
      handlers: viewHandlers,
      virus: viewVirus,
      dns: viewDns,
      ssh: viewSSH,
      ipblocker: viewIPBlocker,
      ssl: viewSSL,
      tokens: viewAPITokens,
      hotlink: viewHotlink,
      redirects: viewRedirects,
      modsec: viewModSec,
      leech: viewLeech,
      fixperms: viewFixPerms,
      vhosts: viewDomains,
      dyndns: viewDynDNS,
      zones: viewZoneEditor,
      mysql: viewMySQL,
      mysqlwiz: viewMySQLWizard,
      pgsql: viewPgSQL,
      pgwiz: viewPgWizard,
      sysapps: viewSysApps,
      appmgr: viewAppManager,
      phpver: viewPHPVersion,
      password: viewPassword,
      accountprefs: viewAccountPrefs,
      contact: viewContact,
      language: viewLanguage,
      wordpress: viewWordPress,
      vpn: viewVPNOverview,
      wireguard: viewWireGuard,
      openvpn: viewOpenVPN,
      ipsec: viewIPsec,
      portcheck: viewPortCheck,
      netmon: viewNetMon,
      images: viewImages,
      dirprivacy: viewDirPrivacy,
      webdisk: viewWebDisk,
      ftpaccounts: (r) => { r.append(el("p", { class: "muted", style: "margin:0 0 14px", text: "Accounts for uploading files with an FTP program (FileZilla, WinSCP, Cyberduck…). Each account is locked into its own folder." })); ftpAccountsPanel(r); },
      backupwiz: viewBackupWizard,
      git: viewGit,
      inodes: viewInodes,
      about: viewAbout,
    }[view] || viewDashboard)(root);
  }

  async function guardedLoad(fn) {
    try { await fn(); }
    catch (err) {
      if (err.status === 401) return location.reload();
      throw err;
    }
  }

  // ======================================================================
  //  Dashboard
  // ======================================================================
  const TILE_GROUPS = [
    { name: "Databases", icon: "database", tiles: [
      { label: "phpMyAdmin", icon: "database", ext: "/phpmyadmin" },
      { label: "Manage Databases", icon: "database", view: "mysql" },
      { label: "MariaDB Wizard", icon: "wizard", view: "mysqlwiz" },
      { label: "PostgreSQL Databases", icon: "database", view: "pgsql" },
      { label: "PostgreSQL Wizard", icon: "wizard", view: "pgwiz" },
      { label: "phpPgAdmin", icon: "database", ext: "/phppgadmin" },
    ]},
    { name: "Domains", icon: "globe", tiles: [
      { label: "Domains", icon: "globe", view: "vhosts" },
      { label: "Redirects", icon: "redirect", view: "redirects" },
      { label: "Zone Editor", icon: "zone", view: "zones" },
    ]},
    { name: "Network", icon: "network", tiles: [
      { label: "VPN Overview", icon: "vpn", view: "vpn" },
      { label: "WireGuard", icon: "tunnel", view: "wireguard" },
      { label: "OpenVPN", icon: "key", view: "openvpn" },
      { label: "IPsec / IKEv2", icon: "shield", view: "ipsec" },
      { label: "Dynamic DNS", icon: "refresh", view: "dyndns" },
      { label: "Port Checker", icon: "plug", view: "portcheck" },
      { label: "Network Monitor", icon: "radar", view: "netmon" },
      { label: "IP Blocker & Trust", icon: "ban", view: "ipblocker" },
      { label: "Fail2ban", icon: "trap", view: "leech" },
      { label: "Interfaces & Wi-Fi", icon: "wifi", view: "network" },
    ]},
    { name: "Security", icon: "shield", tiles: [
      { label: "SSH Access", icon: "key", view: "ssh" },
      { label: "IP Blocker & Trust", icon: "ban", view: "ipblocker" },
      { label: "SSL/TLS Certificates", icon: "lock", view: "ssl" },
      { label: "Manage API Tokens", icon: "token", view: "tokens" },
      { label: "Hotlink Protection", icon: "link", view: "hotlink" },
      { label: "Fail2ban", icon: "trap", view: "leech" },
      { label: "ModSecurity", icon: "brick", view: "modsec" },
      { label: "Two-Factor Authentication", icon: "phone", view: "security" },
      { label: "Fix Home Permissions", icon: "home", view: "fixperms" },
      { label: "Antivirus", icon: "virus", view: "virus" },
    ]},
    { name: "Files", icon: "folder", tiles: [
      { label: "File Manager", icon: "folder", view: "files" },
      { label: "Images", icon: "image", view: "images" },
      { label: "Directory Privacy", icon: "lock", view: "dirprivacy" },
      { label: "Disk Usage", icon: "disk", view: "disk" },
      { label: "Web Disk", icon: "disk", view: "webdisk" },
      { label: "FTP Accounts", icon: "folder", view: "ftpaccounts" },
      { label: "Backup", icon: "backup", view: "backups" },
      { label: "Backup Wizard", icon: "wizard", view: "backupwiz" },
      { label: "Git Version Control", icon: "git", view: "git" },
      { label: "Inodes Usage", icon: "indexes", view: "inodes" },
    ]},
    { name: "Metrics", icon: "processes", tiles: [
      { label: "Resource Usage", icon: "dashboard", view: "dashboard" },
      { label: "Processes", icon: "processes", view: "processes" },
      { label: "Bandwidth / Network", icon: "network", view: "network" },
    ]},
    { name: "System", icon: "services", tiles: [
      { label: "Services", icon: "services", view: "services" },
      { label: "Packages", icon: "packages", view: "packages" },
      { label: "Firewall", icon: "firewall", view: "firewall" },
      { label: "Users", icon: "users", view: "users" },
    ]},
    { name: "Applications", icon: "apps", tiles: [
      { label: "System Applications", icon: "services", view: "sysapps" },
      { label: "Application Manager", icon: "packages", view: "appmgr" },
      { label: "Setup Node.js App", icon: "terminal", view: "appmgr" },
      { label: "Setup Python App", icon: "terminal", view: "appmgr" },
      { label: "Setup Ruby App", icon: "terminal", view: "appmgr" },
      { label: "PHP Settings", icon: "brick", view: "phpver" },
    ]},
    { name: "Advanced", icon: "terminal", tiles: [
      { label: "Terminal", icon: "terminal", view: "terminal" },
      { label: "Cron Jobs", icon: "cron", view: "cron" },
      { label: "Track DNS", icon: "dns", view: "dns" },
      { label: "Indexes", icon: "indexes", view: "indexes" },
      { label: "Error Pages", icon: "error", view: "errorpages" },
      { label: "Apache Handlers", icon: "handler", view: "handlers" },
      { label: "MIME Types", icon: "mime", view: "mime" },
    ]},
    { name: "Preferences", icon: "services", tiles: [
      { label: "Password & Security", icon: "lock", view: "password" },
      { label: "Account Preferences", icon: "services", view: "accountprefs" },
      { label: "Contact Information", icon: "phone", view: "contact" },
      { label: "Change Language", icon: "globe", view: "language" },
      { label: "User Manager", icon: "users", view: "users" },
    ]},
  ];

  const dashHistory = { cpu: [], mem: [], temp: [], disk: [] };
  const dashTimes = [];
  const HISTORY_MAX = 40;
  function pushHist(o, disks) {
    const rd = rootDisk(disks) || {};
    const vals = { cpu: o.cpu.percent, mem: o.memory.percent, temp: o.cpu.temperature_c || 0, disk: rd.percent || 0 };
    for (const k of Object.keys(dashHistory)) {
      dashHistory[k].push(vals[k]);
      if (dashHistory[k].length > HISTORY_MAX) dashHistory[k].shift();
    }
    dashTimes.push(Date.now());
    if (dashTimes.length > HISTORY_MAX) dashTimes.shift();
  }

  // ======================================================================
  //  Bento dashboard — device-style cards fed by live system data
  // ======================================================================
  const I = (name, size) => icon(name, size).outerHTML;
  const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));
  const hhmm = (d) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

  function bcHead(ico, kicker, name, extra) {
    return `<div class="bc-head"><span class="bc-ico">${I(ico, 16)}</span>
      <div class="bc-titles"><div class="bc-kicker">${esc(kicker)}</div><div class="bc-name">${esc(name)}</div></div>${extra || ""}</div>`;
  }
  const rbtn = (ico, view, title, cls) => `<button class="rbtn ${cls || ""}" data-go="${view}" title="${esc(title)}">${I(ico, 14)}</button>`;
  const tuneBtn = (view, title) => rbtn("services", view, title || "Open", "rbtn-tune");

  const netState = { prev: null, prevT: 0, rx: 0, tx: 0, iface: null };

  function viewDashboard(root) {
    const grid = el("div", { class: "bento", id: "bento" });
    const slots = {};
    const add = (id, cls) => { const c = el("div", { class: `bcard ${cls}`, id: `c-${id}` }, el("div", { class: "bc-loading" })); slots[id] = c; grid.append(c); };
    add("cpu", "tone-ember");
    add("temp", "tone-ember-hot span-2");
    add("mem", "tone-dark span-2 split");
    add("disk", "tone-fill");
    add("svc", "tone-violet span-2");
    add("fw", "tone-green");
    add("user", "tone-slate");
    add("sys", "tone-sky span-2 row-2");
    add("cron", "tone-ember span-2 row-2");
    add("activity", "tone-dark span-2");
    add("net", "tone-ember");
    add("storage", "tone-dark span-2");
    add("term", "tone-dark tone-glow");

    grid.addEventListener("click", (e) => {
      const b = e.target.closest("[data-go]");
      if (b) navigate(b.dataset.go);
    });

    const tilesWrap = el("div", { id: "dash-tiles" });
    root.append(grid, el("h2", { class: "section-title dash-section", text: "All tools" }), tilesWrap);
    renderTiles(tilesWrap);

    renderUserCard(slots.user);
    renderTermCard(slots.term);

    const fast = async () => {
      const [o, dr, n] = await Promise.all([API.overview(), API.disks(), API.network().catch(() => null)]);
      const d = dr.disks || [];
      pushHist(o, d);
      if (n) trackNet(n);
      renderCpuCard(slots.cpu, o);
      renderTempCard(slots.temp, o);
      renderMemCard(slots.mem, o);
      renderDiskCard(slots.disk, d);
      renderSysCard(slots.sys, o);
      renderActivityCard(slots.activity, o);
      renderNetCard(slots.net);
      renderStorageCard(slots.storage, d);
      renderTermCard(slots.term, o);
    };
    const slow = () => {
      API.services().then((s) => renderSvcCard(slots.svc, Array.isArray(s) ? s : s.services || [])).catch(() => renderSvcCard(slots.svc, null));
      API.firewall().then((f) => renderFwCard(slots.fw, f)).catch(() => renderFwCard(slots.fw, null));
      API.cronList().then((c) => renderCronCard(slots.cron, c)).catch(() => renderCronCard(slots.cron, null));
    };
    const load = async () => { slow(); await guardedLoad(fast); };
    state.refreshHandler = load;
    load();

    const t1 = setInterval(() => { fast().catch(() => {}); }, 3000);
    const t2 = setInterval(slow, 30000);
    (state.cleanups = state.cleanups || []).push(() => { clearInterval(t1); clearInterval(t2); });
  }

  function trackNet(data) {
    const now = Date.now();
    let rx = 0, tx = 0;
    const ifs = data.interfaces.filter((n) => n.name !== "lo");
    ifs.forEach((n) => { rx += n.bytes_recv; tx += n.bytes_sent; });
    if (netState.prev && now > netState.prevT) {
      const dt = (now - netState.prevT) / 1000;
      netState.rx = Math.max(0, (rx - netState.prev.rx) / dt);
      netState.tx = Math.max(0, (tx - netState.prev.tx) / dt);
    }
    netState.prev = { rx, tx }; netState.prevT = now;
    netState.iface = ifs.find((n) => n.is_up && n.ipv4) || ifs[0] || null;
  }

  // ---- CPU (slider card) ----
  function renderCpuCard(c, o) {
    const p = clamp(o.cpu.percent);
    c.innerHTML = `${bcHead("processes", "Processor", `${o.cpu.cores_logical} cores${o.cpu.freq_mhz ? " · " + (o.cpu.freq_mhz / 1000).toFixed(1) + " GHz" : ""}`)}
      <div class="bc-body">
        <div class="bc-row"><span class="bc-lbl">CPU load</span><b>${p.toFixed(0)}%</b></div>
        <div class="slider"><span class="slider-fill" style="width:${p}%"></span><span class="slider-knob" style="left:${p}%"></span></div>
      </div>
      <div class="bc-foot">${rbtn("processes", "processes", "Processes")}${rbtn("terminal", "terminal", "Terminal")}<span class="grow"></span>${tuneBtn("processes", "Processes")}</div>`;
  }

  // ---- Temperature (HVAC card with glowing dial) ----
  function renderTempCard(c, o) {
    const t = o.cpu.temperature_c;
    const hot = t != null && t >= 75;
    const frac = t == null ? 0 : clamp((t - 25) / 60, 0, 1);
    const R = 92, C = 2 * Math.PI * R;
    const ticks = Array.from({ length: 13 }, (_, i) => {
      const a = Math.PI / 2 + (i / 12) * Math.PI; // left half, top→bottom
      const x1 = 120 + Math.cos(a) * 112, y1 = 120 - Math.sin(a) * 112, x2 = 120 + Math.cos(a) * 122, y2 = 120 - Math.sin(a) * 122;
      return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
    }).join("");
    const throttled = o.throttled && o.throttled !== "0x0";
    const hist = dashHistory.temp.filter((v) => v > 0);
    c.innerHTML = `
      <svg class="dial" viewBox="0 0 240 240" aria-hidden="true">
        <defs><linearGradient id="dialg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd29a"/><stop offset="1" stop-color="#ff6a14"/></linearGradient></defs>
        <g class="dial-ticks">${ticks}</g>
        <circle cx="120" cy="120" r="${R}" class="dial-track"/>
        <circle cx="120" cy="120" r="${R}" class="dial-fill" transform="rotate(90 120 120)" style="stroke-dasharray:${C.toFixed(1)};stroke-dashoffset:${(C * (1 - frac)).toFixed(1)}"/>
        <circle cx="120" cy="120" r="70" class="dial-core"/>
      </svg>
      ${bcHead("flame", "Thermal", "SoC temperature")}
      <div class="bc-body">
        <div class="bc-big ${hot ? "is-hot" : ""}">${t != null ? t.toFixed(1) : "—"}<small>°C</small></div>
        <div class="bc-sub">${throttled ? "⚠ Throttled (" + esc(o.throttled) + ")" : hist.length > 1 ? `Low ${Math.min(...hist).toFixed(0)}° · High ${Math.max(...hist).toFixed(0)}°` : "No throttling"}</div>
      </div>
      <div class="bc-foot">
        <span class="chip">${I("processes", 12)} ${o.cpu.freq_mhz ? o.cpu.freq_mhz.toFixed(0) + " MHz" : "—"}</span>
        <span class="chip ${throttled ? "chip-bad" : ""}">${throttled ? "throttled" : "nominal"}</span>
      </div>`;
  }

  // ---- Memory (speaker-style split card) ----
  function renderMemCard(c, o) {
    const m = o.memory, p = clamp(m.percent);
    const R = 34, C = 2 * Math.PI * R;
    c.innerHTML = `
      <div class="split-art">
        <div class="disc"><svg viewBox="0 0 84 84"><circle cx="42" cy="42" r="${R}" class="disc-track"/><circle cx="42" cy="42" r="${R}" class="disc-fill" style="stroke-dasharray:${C.toFixed(1)};stroke-dashoffset:${(C * (1 - p / 100)).toFixed(1)}"/></svg>
        <span class="disc-center">${p.toFixed(0)}<small>%</small></span></div>
      </div>
      <div class="split-main">
        <div class="bc-titles"><div class="bc-kicker">Memory</div><div class="bc-name">RAM · ${fmtBytes(m.total)}</div></div>
        <div class="split-now"><b>${fmtBytes(m.used)} in use</b><span>${fmtBytes(m.available)} available</span></div>
        <div class="line-meter"><span style="width:${p}%"></span></div>
        <div class="bc-row small"><span>Swap ${o.swap.percent.toFixed(0)}%</span><span>${fmtBytes(m.total)}</span></div>
        <div class="bc-foot">${rbtn("processes", "processes", "Processes")}<span class="grow"></span>${tuneBtn("processes", "Processes")}</div>
      </div>`;
  }

  // ---- Root disk (blinds-style fill) ----
  function renderDiskCard(c, disks) {
    const rd = rootDisk(disks) || {};
    const p = clamp(rd.percent || 0);
    c.style.setProperty("--fill", `${p}%`);
    c.innerHTML = `${bcHead("disk", "Root filesystem", rd.mountpoint || "/")}
      <div class="bc-body"><div class="bc-big accent">${rd.percent != null ? p.toFixed(0) : "—"}<small>%</small></div>
      <div class="bc-sub">Used · ${fmtBytes(rd.free)} free</div></div>
      <div class="bc-foot">${rbtn("disk", "disk", "Disk usage")}${rbtn("folder", "files", "File manager")}<span class="grow"></span>${tuneBtn("backups", "Backups")}</div>`;
  }

  // ---- Services (TV-remote style) ----
  function renderSvcCard(c, list) {
    if (!list) { c.innerHTML = `${bcHead("services", "Services", "systemd")}<div class="bc-body"><div class="bc-sub">Unavailable</div></div>`; return; }
    const running = list.filter((s) => s.sub === "running").length;
    const failed = list.filter((s) => s.active === "failed");
    const total = list.length || 1;
    const R = 50, C = 2 * Math.PI * R;
    c.innerHTML = `
      <div class="pad"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="${R}" class="pad-track"/><circle cx="60" cy="60" r="${R}" class="pad-fill" style="stroke-dasharray:${C.toFixed(1)};stroke-dashoffset:${(C * (1 - running / total)).toFixed(1)}"/></svg>
        <button class="pad-ok" data-go="services" title="Open services">${running}</button></div>
      ${bcHead("services", "Services", "systemd units")}
      <div class="bc-body">
        <div class="svc-stats"><span><b>${running}</b> running</span><span><b>${list.length}</b> loaded</span></div>
        <div class="svc-failed">${failed.length ? failed.slice(0, 3).map((s) => `<span class="chip chip-bad">${esc(s.unit.replace(/\.service$/, ""))}</span>`).join("") + (failed.length > 3 ? `<span class="chip">+${failed.length - 3}</span>` : "") : `<span class="chip chip-good">No failed units</span>`}</div>
      </div>
      <div class="bc-foot">${rbtn("services", "services", "Services")}${rbtn("terminal", "terminal", "Terminal")}${rbtn("packages", "packages", "Packages")}${rbtn("cron", "cron", "Cron")}<span class="grow"></span>
        <button class="pill-btn" data-go="services">Manage ${I("chevron", 12)}</button></div>`;
  }

  // ---- Firewall (lock card) ----
  function renderFwCard(c, f) {
    const avail = f && f.available, active = avail && f.active;
    c.classList.toggle("is-off", !active);
    c.innerHTML = `${bcHead("lock", avail ? (active ? "Active" : "Inactive") : "Not installed", "Firewall · ufw")}
      <div class="lock-ring">${I("lock", 22)}</div>
      <button class="slide-btn" data-go="firewall"><span class="slide-knob">${I("chevron", 14)}</span>${avail ? `${f.rules.length} rule${f.rules.length === 1 ? "" : "s"} · manage` : "Set up"}</button>`;
  }

  // ---- Signed-in user ----
  function renderUserCard(c) {
    const u = $("#user-label").textContent || "admin";
    c.innerHTML = `<div class="user-ring">${I("users", 22)}</div>
      <div class="user-meta"><div class="bc-kicker">Signed in</div><div class="bc-name">${esc(u)}</div></div>
      <div class="user-actions">${rbtn("lock", "password", "Password & security")}${rbtn("phone", "security", "Two-factor")}</div>`;
  }

  // ---- System (weather-style card) ----
  function renderSysCard(c, o) {
    const raw = (o.cpu.per_core && o.cpu.per_core.length) ? o.cpu.per_core : [o.cpu.percent];
    // Many-core hosts: average into at most 8 columns so the row never overflows.
    const per = Math.ceil(raw.length / 8);
    const cores = [];
    for (let i = 0; i < raw.length; i += per) {
      const s = raw.slice(i, i + per);
      cores.push({ label: per > 1 ? `C${i}–${i + s.length - 1}` : `Core ${i}`, v: s.reduce((a, b) => a + b, 0) / s.length });
    }
    const boot = new Date(o.boot_time * 1000);
    const la = o.cpu.load_avg;
    const model = (o.pi_model || o.arch || "").replace(/Raspberry Pi/i, "Pi").replace(/ Model /i, " ").replace(/Rev [\d.]+/i, "").trim();
    c.innerHTML = `
      <svg class="waves" viewBox="0 0 400 200" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 70 C 80 40, 150 95, 240 62 S 360 40, 400 58 L400 200 L0 200 Z" class="w1"/>
        <path d="M0 105 C 90 80, 170 130, 260 100 S 360 84, 400 96 L400 200 L0 200 Z" class="w2"/>
      </svg>
      <div class="sys-top"><span class="sys-loc">${I("globe", 15)} ${esc(o.hostname)}</span><span class="sys-cond">${I("dashboard", 26)}<em>${esc(model || "Linux")}</em></span></div>
      <div class="sys-mid">
        <div><div class="sys-big">${esc(fmtUptime(o.uptime_seconds))}</div>
          <div class="sys-hl">Load ${la[0] != null ? la[0].toFixed(2) : "—"} · ${o.cpu.cores_logical} threads</div>
          <div class="sys-note">${esc(o.arch)} · Python ${esc(o.python)}</div></div>
        <div class="sys-stats">
          <div><span>Load 5m</span><b>${la[1] != null ? la[1].toFixed(2) : "—"}</b></div>
          <div><span>Load 15m</span><b>${la[2] != null ? la[2].toFixed(2) : "—"}</b></div>
          <div><span>Swap</span><b>${o.swap.percent.toFixed(0)}%</b></div>
        </div>
      </div>
      <div class="sys-sun"><span>${I("refresh", 13)} ${hhmm(boot)}</span><i></i><span>${esc(fmtUptime(o.uptime_seconds))} up</span><i></i><span>${I("cron", 13)} ${hhmm(new Date())}</span></div>
      <div class="sys-days">${cores.map(({ label, v }) => `<div class="day"><span>${label}</span><span class="day-bar"><span style="height:${clamp(v).toFixed(0)}%"></span></span><b>${v.toFixed(0)}%</b></div>`).join("")}</div>`;
  }

  // ---- Cron (calendar card) ----
  function cronLabel(s) {
    const t = s.trim();
    const at = { "@reboot": ["AT", "BOOT", ""], "@daily": ["EVERY", "DAY", ""], "@midnight": ["EVERY", "DAY", ""], "@hourly": ["EVERY", "HOUR", ""], "@weekly": ["EVERY", "WEEK", ""], "@monthly": ["EVERY", "MONTH", ""], "@yearly": ["EVERY", "YEAR", ""], "@annually": ["EVERY", "YEAR", ""] };
    if (at[t]) return at[t];
    const f = t.split(/\s+/);
    if (f.length !== 5) return ["CRON", "•", ""];
    const [mi, h, dom, mon, dow] = f;
    let m;
    if ((m = mi.match(/^\*\/(\d+)$/)) && h === "*" && dom === "*" && mon === "*" && dow === "*") return ["EVERY", m[1], "MIN"];
    if (/^\d+$/.test(mi) && (m = h.match(/^\*\/(\d+)$/))) return ["EVERY", m[1], "HRS"];
    if (/^\d+$/.test(mi) && h === "*" && dom === "*") return ["HOURLY", ":" + mi.padStart(2, "0"), ""];
    const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
    if (/^\d+$/.test(mi) && /^\d+$/.test(h)) {
      const time = `${h.padStart(2, "0")}:${mi.padStart(2, "0")}`;
      if (dom === "*" && mon === "*" && dow === "*") return ["DAILY", time, ""];
      if (dom === "*" && /^\d$/.test(dow)) return [DOW[+dow], time, "WEEKLY"];
      if (/^\d+$/.test(dom)) return ["DAY " + dom, time, "MONTHLY"];
    }
    return ["CRON", "•", ""];
  }
  function renderCronCard(c, data) {
    const jobs = data && data.jobs ? data.jobs : [];
    const head = bcHead("cron", "Scheduled", "Cron jobs", `<span class="grow"></span>${tuneBtn("cron", "Cron jobs")}`);
    if (!data || data.supported === false) { c.innerHTML = `${head}<div class="bc-empty">Cron isn't available on this host.</div>`; return; }
    if (!jobs.length) { c.innerHTML = `${head}<div class="bc-empty">No scheduled jobs yet.<button class="pill-btn" data-go="cron">Add a job ${I("chevron", 12)}</button></div>`; return; }
    c.innerHTML = `${head}<div class="agenda">${jobs.slice(0, 5).map((j) => {
      const [a, b, cc] = cronLabel(j.schedule);
      const name = (j.label || j.command.split(/\s+/)[0].split("/").pop() || j.command) + (j.paused ? " (paused)" : "");
      return `<div class="ag-row" data-go="cron"><div class="ag-date"><span>${esc(a)}</span><b>${esc(b)}</b><span>${esc(cc)}</span></div>
        <div class="ag-body"><div class="ag-title">${esc(name)}</div><div class="ag-meta">${I("cron", 11)} <code>${esc(j.schedule)}</code></div><div class="ag-meta dim">${esc(j.command)}</div></div></div>`;
    }).join("")}${jobs.length > 5 ? `<div class="ag-more" data-go="cron">+${jobs.length - 5} more</div>` : ""}</div>`;
  }

  // ---- Activity (energy-style chart) ----
  function renderActivityCard(c, o) {
    const data = dashHistory.cpu, n = data.length, W = 400, H = 110;
    let area = "", line = "";
    if (n >= 2) {
      const max = Math.max(20, ...data) * 1.15;
      const pts = data.map((v, i) => [(i / (n - 1)) * W, H - (v / max) * (H - 8)]);
      // smooth curve via midpoints
      let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
      for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], mx = (x0 + x1) / 2;
        d += ` C${mx.toFixed(1)},${y0.toFixed(1)} ${mx.toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
      }
      line = d; area = `${d} L${W},${H} L0,${H} Z`;
    }
    const span = n > 1 ? Math.round((dashTimes[n - 1] - dashTimes[0]) / 1000) : 0;
    c.innerHTML = `${bcHead("processes", "Activity", "CPU now", `<span class="grow"></span><div class="act-now"><b>${o.cpu.percent.toFixed(0)}%</b><span>Mem ${o.memory.percent.toFixed(0)}%</span></div>`)}
      <div class="act-chart">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
          <defs><linearGradient id="actg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff7a1a" stop-opacity=".55"/><stop offset="1" stop-color="#ff7a1a" stop-opacity="0"/></linearGradient></defs>
          <line x1="0" y1="10" x2="${W}" y2="10" class="act-dash"/>
          ${area ? `<path d="${area}" fill="url(#actg)"/><path d="${line}" class="act-line"/>` : ""}
        </svg>
        ${n < 2 ? '<div class="chart-empty">collecting…</div>' : ""}
        <div class="act-axis"><span>${span ? "−" + (span >= 60 ? Math.round(span / 60) + " min" : span + "s") : ""}</span><span>${span ? "−" + (span >= 120 ? Math.round(span / 120) + " min" : Math.round(span / 2) + "s") : ""}</span><span>now</span></div>
      </div>`;
  }

  // ---- Network (switch-style) ----
  function renderNetCard(c) {
    const i = netState.iface;
    c.innerHTML = `${bcHead("network", "Network", i ? i.name : "—")}
      <div class="bc-body"><div class="net-rate">${I("chevron", 12)}<b>${fmtBytes(netState.rx)}/s</b><span>down</span></div>
        <div class="net-rate up">${I("chevron", 12)}<b>${fmtBytes(netState.tx)}/s</b><span>up</span></div></div>
      <div class="bc-foot"><span class="bc-sub mono">${esc((i && i.ipv4) || "no IPv4")}</span><span class="grow"></span>${tuneBtn("network", "Network")}</div>`;
  }

  // ---- Storage (vacuum-style stats) ----
  function renderStorageCard(c, disks) {
    const rd = rootDisk(disks) || {};
    const totalAll = disks.reduce((s, d) => s + d.total, 0);
    c.innerHTML = `${bcHead("backup", `Storage · ${disks.length} mount${disks.length === 1 ? "" : "s"}`, rd.device || "—")}
      <div class="stat3">
        <div><span>${I("disk", 12)} Used</span><b>${fmtBytes(rd.used)}</b></div>
        <div><span>${I("folder", 12)} Free</span><b>${fmtBytes(rd.free)}</b></div>
        <div><span>${I("database", 12)} All disks</span><b>${fmtBytes(totalAll)}</b></div>
      </div>
      <div class="bc-foot">${rbtn("folder", "files", "File manager")}${rbtn("disk", "disk", "Disk usage")}${rbtn("backup", "backups", "Backups")}<span class="grow"></span>${tuneBtn("disk", "Disk usage")}</div>`;
  }

  // ---- Terminal shortcut ----
  function renderTermCard(c, o) {
    const u = $("#user-label").textContent || "root";
    const host = o ? o.hostname : ($("#host-label").textContent || "pi");
    c.innerHTML = `${bcHead("terminal", "Shell", "Terminal")}
      <div class="term-line" data-go="terminal"><span class="dim">${esc(u)}@${esc(host)}</span>:~$ <i class="caret"></i></div>
      <div class="bc-foot"><span class="grow"></span>${rbtn("chevron", "terminal", "Open terminal")}</div>`;
  }

  const GROUP_COLORS = {
    System: "#ff8a3d", Databases: "#b47cff", Domains: "#3fcf9a", Security: "#ff6b6b",
    Files: "#ffb347", Metrics: "#6fb6ff", Software: "#7fd46b", Advanced: "#ff9a5c",
    Preferences: "#f2c26b", Applications: "#21a1f1",
  };
  function renderTiles(root) {
    root.innerHTML = "";
    for (const group of TILE_GROUPS) {
      const c = GROUP_COLORS[group.name] || "#ff8a3d";
      const tint = `color-mix(in srgb, ${c} 15%, transparent)`;
      const grid = el("div", { class: "tile-grid" });
      for (const t of group.tiles) {
        const ico = el("span", { class: "tile-ico", style: `background:${tint}; color:${c}` }, icon(t.icon, 19));
        const tile = el("button", { class: `tile ${t.ext ? "ext" : ""}`, style: `--tile-accent:${c}`,
          onclick: () => {
            if (t.ext) window.open(`${location.protocol}//${location.hostname}${t.ext}`, "_blank");
            else navigate(t.view);
          } }, [
          ico,
          el("span", { class: "tile-body" }, [el("span", { class: "tile-label", text: t.label }), t.ext ? el("span", { class: "tile-sub", text: "opens on port 80" }) : null]),
          el("span", { class: "tile-chev", text: "›" }),
        ]);
        grid.append(tile);
      }
      const head = el("div", { class: "tile-group-head tgh", onclick: () => {
        const isC = !grid.hidden; grid.hidden = isC; head.classList.toggle("collapsed", isC); setTileCollapsed(group.name, isC);
      } }, [
        el("span", { class: "gh-ico", style: `background:${tint}; color:${c}` }, icon(group.icon, 14)),
        group.name,
        el("span", { class: "tgh-chev" }, icon("chevron", 13)),
      ]);
      if (getTileCollapsed().includes(group.name)) { grid.hidden = true; head.classList.add("collapsed"); }
      root.append(el("div", { class: "tile-group" }, [head, grid]));
    }
  }
  function getTileCollapsed() { try { return JSON.parse(localStorage.getItem("aurora-tiles-collapsed") || "[]"); } catch (e) { return []; } }
  function setTileCollapsed(name, isC) {
    let list = getTileCollapsed().filter((n) => n !== name);
    if (isC) list.push(name);
    try { localStorage.setItem("aurora-tiles-collapsed", JSON.stringify(list)); } catch (e) {}
  }

  function rootDisk(disks) {
    return disks.find((d) => d.mountpoint === "/" || /^[A-Za-z]:\\?$/.test(d.mountpoint)) || disks[0];
  }

  // ---- mini sparkline (used by the network view) ----
  function sparklineSvg(data, color, w = 96, h = 34) {
    const n = data.length;
    if (n < 2) return `<svg class="scard-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"></svg>`;
    const max = Math.max(1, ...data), min = Math.min(...data);
    const rng = Math.max(1, max - min);
    const y = (v) => (h - 3 - ((v - min) / rng) * (h - 6)).toFixed(2);
    const x = (i) => (i / (n - 1) * w).toFixed(2);
    const pts = data.map((v, i) => `${x(i)},${y(v)}`).join(" ");
    const gid = "sp" + (_sparkId++);
    return `<svg class="scard-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity="0.4"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
      <path d="M0,${h} L${pts.split(" ").join(" L")} L${w},${h} Z" fill="url(#${gid})"/>
      <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
    </svg>`;
  }
  let _sparkId = 0;

  function infoRow(k, v) {
    return el("div", { class: "info-row" }, [el("span", { class: "k", text: k }), el("span", { class: "v", text: v })]);
  }

  // ======================================================================
  //  Services
  // ======================================================================
  function viewServices(root) {
    const bar = el("div", { class: "toolbar" }, [
      el("input", { id: "svc-filter", type: "text", placeholder: "Filter services…", style: "max-width:280px" }),
    ]);
    const body = el("div", { id: "svc-body" }, el("div", { class: "loading", text: "Loading services…" }));
    root.append(bar, body);

    let all = [];
    const render = () => {
      const q = $("#svc-filter").value.toLowerCase();
      const list = all.filter((s) => s.unit.toLowerCase().includes(q) || (s.description || "").toLowerCase().includes(q));
      body.innerHTML = "";
      if (!all.length) { body.append(el("p", { class: "empty", text: "No systemd services (this host isn't running systemd)." })); return; }
      const rows = list.map((s) => {
        const running = s.active === "active";
        return el("tr", {}, [
          el("td", {}, el("span", { text: s.unit })),
          el("td", {}, el("span", { class: `pill ${running ? "good" : s.active === "failed" ? "bad" : "dim"}`, text: s.active })),
          el("td", { class: "muted", text: s.sub }),
          el("td", { class: "muted", text: s.description, style: "max-width:340px;overflow:hidden;text-overflow:ellipsis" }),
          el("td", { class: "actions" }, [
            el("button", { class: "btn btn-sm", text: running ? "Restart" : "Start",
              onclick: () => svcAction(s.unit, running ? "restart" : "start") }),
            running ? el("button", { class: "btn btn-sm btn-danger", text: "Stop", onclick: () => svcAction(s.unit, "stop") }) : null,
            el("button", { class: "btn btn-sm btn-ghost", text: "Status", onclick: () => svcShowStatus(s.unit) }),
          ]),
        ]);
      });
      body.append(el("div", { class: "table-wrap" }, el("table", {}, [
        el("thead", {}, el("tr", {}, ["Unit", "State", "Sub", "Description", ""].map((h) => el("th", { text: h })))),
        el("tbody", {}, rows),
      ])));
    };

    const load = async () => {
      await guardedLoad(async () => {
        const res = await API.services();
        all = res.services;
        render();
      });
    };
    $("#svc-filter").addEventListener("input", render);
    state.refreshHandler = load;
    load();

    window.__svcReload = load;
  }

  async function svcAction(unit, action) {
    try {
      await API.serviceControl(unit, action);
      toast(`${action} → ${unit}`, "good");
      if (window.__svcReload) setTimeout(window.__svcReload, 600);
    } catch (err) { toast(err.message, "bad"); }
  }

  async function svcShowStatus(unit) {
    try {
      const r = await API.serviceStatus(unit);
      openModal(unit, el("pre", { class: "log", text: r.output || "(no output)" }), []);
    } catch (err) { toast(err.message, "bad"); }
  }

  // ======================================================================
  //  Processes
  // ======================================================================
  function viewProcesses(root) {
    const bar = el("div", { class: "toolbar" }, [
      el("label", { class: "muted" }, "Sort by "),
      el("select", { id: "proc-sort", style: "max-width:160px" }, [
        el("option", { value: "cpu", text: "CPU" }),
        el("option", { value: "memory", text: "Memory" }),
      ]),
    ]);
    const body = el("div", { id: "proc-body" }, el("div", { class: "loading", text: "Loading…" }));
    root.append(bar, body);

    const load = async () => {
      await guardedLoad(async () => {
        const sort = $("#proc-sort").value;
        const res = await API.processes(sort);
        body.innerHTML = "";
        const rows = res.processes.map((p) => el("tr", {}, [
          el("td", { class: "muted", text: p.pid }),
          el("td", { text: p.name }),
          el("td", { class: "muted", text: p.username }),
          el("td", { text: `${p.cpu_percent}%` }),
          el("td", { text: `${p.memory_percent}%` }),
          el("td", {}, el("span", { class: `pill ${p.status === "running" ? "good" : "dim"}`, text: p.status })),
          el("td", { class: "actions" }, el("button", { class: "btn btn-sm btn-danger", text: "Kill",
            onclick: () => killProc(p.pid, p.name) })),
        ]));
        body.append(el("div", { class: "table-wrap" }, el("table", {}, [
          el("thead", {}, el("tr", {}, ["PID", "Name", "User", "CPU", "Mem", "Status", ""].map((h) => el("th", { text: h })))),
          el("tbody", {}, rows),
        ])));
      });
    };
    $("#proc-sort").addEventListener("change", load);
    state.refreshHandler = load;
    load();
    window.__procReload = load;
  }

  async function killProc(pid, name) {
    if (!confirmInline(`Terminate process ${pid} (${name})?`)) return;
    try {
      await API.killProcess(pid);
      toast(`Terminated ${pid}`, "good");
      if (window.__procReload) setTimeout(window.__procReload, 500);
    } catch (err) { toast(err.message, "bad"); }
  }

  // ======================================================================
  //  File manager
  // ======================================================================
  function viewFiles(root) {
    const crumb = el("div", { class: "breadcrumb", id: "fm-crumb" });
    const bar = el("div", { class: "fm-toolbar" }, [
      el("button", { class: "btn btn-sm", text: "↑ Up", id: "fm-up" }),
      el("button", { class: "btn btn-sm", text: "＋ New folder", onclick: fmNewFolder }),
      el("label", { class: "btn btn-sm", style: "position:relative;overflow:hidden" }, [
        "⬆ Upload",
        el("input", { type: "file", id: "fm-upload", multiple: "multiple", style: "position:absolute;inset:0;opacity:0;cursor:pointer", onchange: fmUpload }),
      ]),
      el("button", { class: "btn btn-sm", id: "fm-zip-btn", text: "🗜 Zip selected", onclick: fmZipSelected }),
      el("button", { class: "btn btn-sm btn-ghost", text: "🗑 Recycle Bin", onclick: fmRecycleBin }),
      el("label", { class: "muted", style: "display:flex;align-items:center;gap:7px;margin-left:auto;font-size:13px" }, [
        el("input", { type: "checkbox", id: "fm-hidden", style: "width:auto", onchange: () => { fmState.showHidden = $("#fm-hidden").checked; fmLoad(fmState.cwd); } }),
        "Show hidden",
      ]),
    ]);
    const body = el("div", { id: "fm-body" }, el("div", { class: "loading", text: "Loading…" }));
    const zone = el("div", { class: "fm-dropzone", id: "fm-zone" }, [
      body,
      el("div", { class: "fm-drop-overlay", text: "⬇ Drop files here to upload" }),
    ]);
    root.append(bar, crumb, zone);

    // Drag-and-drop upload.
    let dragDepth = 0;
    zone.addEventListener("dragenter", (e) => { e.preventDefault(); if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) { dragDepth++; zone.classList.add("dragging"); } });
    zone.addEventListener("dragover", (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"; });
    zone.addEventListener("dragleave", (e) => { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; zone.classList.remove("dragging"); } });
    zone.addEventListener("drop", (e) => {
      e.preventDefault(); dragDepth = 0; zone.classList.remove("dragging");
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) fmUploadFiles(e.dataTransfer.files);
    });

    fmState.cwd = fmState.cwd || "";
    $("#fm-up").addEventListener("click", () => { if (fmState.parent != null) fmLoad(fmState.parent); });
    state.refreshHandler = () => fmLoad(fmState.cwd);
    fmLoad(fmState.cwd);
  }

  const fmState = { cwd: "", parent: null, showHidden: false, selected: new Set() };

  async function fmLoad(path) {
    await guardedLoad(async () => {
      const data = await API.filesList(path);
      fmState.cwd = data.cwd;
      fmState.parent = data.parent;
      fmState.selected = new Set();
      $("#fm-crumb").innerHTML = `<span class="muted">${esc(data.root)}</span> / <b>${esc(data.cwd || "")}</b>`;
      $("#fm-up").disabled = data.parent == null;
      const body = $("#fm-body");
      body.innerHTML = "";
      let entries = data.entries;
      if (!fmState.showHidden) entries = entries.filter((e) => !e.is_hidden);
      if (!entries.length) { body.append(el("p", { class: "empty", text: fmState.showHidden ? "Empty folder" : "Empty (or only hidden files — tick “Show hidden”)" })); return; }
      const rows = entries.map((e) => {
        const cb = el("input", { type: "checkbox", style: "width:auto", onchange: (ev) => { ev.target.checked ? fmState.selected.add(e.name) : fmState.selected.delete(e.name); } });
        const nameCell = el("td", {}, el("span", { class: `fm-name ${e.is_dir ? "dir" : ""}`,
          onclick: () => e.is_dir ? fmLoad(e.path) : fmOpenFile(e) }, [
          el("span", { class: "fm-ico" }, icon(e.is_dir ? "folder" : (/\.zip$/i.test(e.name) ? "backup" : "mime"), 15)),
          e.name + (e.is_symlink ? " ↳" : "") + (e.is_hidden ? "" : ""),
        ]));
        return el("tr", {}, [
          el("td", { style: "width:34px" }, cb),
          nameCell,
          el("td", { class: "muted", text: e.is_dir ? "—" : fmtBytes(e.size) }),
          el("td", { class: "muted", text: e.mode }),
          el("td", { class: "muted", text: new Date(e.modified * 1000).toLocaleString() }),
          el("td", { class: "actions" }, [
            /\.zip$/i.test(e.name) ? el("button", { class: "btn btn-sm btn-ghost", text: "Extract", onclick: () => fmUnzip(e) }) : null,
            e.is_dir ? null : el("a", { class: "btn btn-sm btn-ghost", href: API.downloadUrl(e.path), text: "↓" }),
            el("button", { class: "btn btn-sm btn-danger", text: "✕", onclick: () => fmDelete(e) }),
          ]),
        ]);
      });
      body.append(el("div", { class: "table-wrap" }, el("table", {}, [
        el("thead", {}, el("tr", {}, ["", "Name", "Size", "Mode", "Modified", ""].map((h) => el("th", { text: h })))),
        el("tbody", {}, rows),
      ])));
    });
  }

  async function fmZipSelected() {
    const names = [...fmState.selected];
    if (!names.length) { toast("Select files/folders first (checkboxes)", "bad"); return; }
    const arc = promptInline("Archive name:", "archive.zip");
    if (!arc) return;
    try {
      await API.filesZip(fmState.cwd, names, arc);
      toast(`Zipped ${names.length} item(s)`, "good"); fmLoad(fmState.cwd);
    } catch (err) {
      if (/overwrite/i.test(err.message) && confirmInline(err.message + "\n\nOverwrite?")) {
        try { await API.filesZip(fmState.cwd, names, arc, true); toast("Zipped (overwritten)", "good"); fmLoad(fmState.cwd); }
        catch (e) { toast(e.message, "bad"); }
      } else toast(err.message, "bad");
    }
  }

  async function fmUnzip(entry) {
    try {
      const r = await API.filesUnzip(entry.path);
      toast(`Extracted ${r.count} item(s) → ${r.extracted_to}`, "good"); fmLoad(fmState.cwd);
    } catch (err) {
      if (/overwrite|already exists/i.test(err.message) && confirmInline(err.message + "\n\nExtract anyway (overwrite)?")) {
        try { const r = await API.filesUnzip(entry.path, true); toast(`Extracted ${r.count} item(s)`, "good"); fmLoad(fmState.cwd); }
        catch (e) { toast(e.message, "bad"); }
      } else toast(err.message, "bad");
    }
  }

  async function fmRecycleBin() {
    let data;
    try { data = await API.trashList(); } catch (e) { toast(e.message, "bad"); return; }
    const body = el("div", {});
    const render = (items) => {
      body.innerHTML = "";
      if (!items.length) { body.append(el("p", { class: "empty", text: "Recycle bin is empty." })); return; }
      const rows = items.map((it) => el("tr", {}, [
        el("td", {}, [el("span", { class: "fm-ico" }, icon(it.is_dir ? "folder" : "mime", 15)), " " + it.name]),
        el("td", { class: "muted", text: it.original }),
        el("td", { class: "muted", text: fmtBytes(it.size) }),
        el("td", { class: "muted", text: new Date(it.deleted_at * 1000).toLocaleString() }),
        el("td", { class: "actions" }, [
          el("button", { class: "btn btn-sm", text: "Restore", onclick: () => fmRestore(it, () => refresh()) }),
          el("button", { class: "btn btn-sm btn-danger", text: "Delete", onclick: async () => {
            if (!confirmInline(`Permanently delete "${it.name}"?`)) return;
            try { await API.trashDelete(it.id); refresh(); } catch (e) { toast(e.message, "bad"); } } }),
        ]),
      ]));
      body.append(simpleTable(["Name", "Original location", "Size", "Deleted", ""], rows));
    };
    const refresh = async () => { try { render((await API.trashList()).items); } catch (e) { toast(e.message, "bad"); } };
    render(data.items);
    openModal("♻ Recycle Bin", body, [
      el("button", { class: "btn btn-danger", text: "Empty bin", onclick: async () => {
        if (!confirmInline("Permanently delete everything in the recycle bin?")) return;
        try { const r = await API.trashEmpty(); toast(`Emptied ${r.emptied} item(s)`, "good"); refresh(); } catch (e) { toast(e.message, "bad"); } } }),
    ]);
  }

  async function fmRestore(it, done) {
    try { await API.trashRestore(it.id); toast(`Restored ${it.name}`, "good"); done && done(); fmLoad(fmState.cwd); }
    catch (err) {
      if (/overwrite|already exists/i.test(err.message) && confirmInline(err.message + "\n\nOverwrite the existing item?")) {
        try { await API.trashRestore(it.id, true); toast("Restored (overwritten)", "good"); done && done(); fmLoad(fmState.cwd); }
        catch (e) { toast(e.message, "bad"); }
      } else toast(err.message, "bad");
    }
  }

  async function fmOpenFile(entry) {
    try {
      const data = await API.filesRead(entry.path);
      const ta = el("textarea", { class: "editor", spellcheck: "false" });
      ta.value = data.content;
      openModal(entry.name, ta, [
        el("button", { class: "btn btn-primary", text: "Save", onclick: async (ev) => {
          try {
            await API.filesWrite(entry.path, ta.value);
            toast("Saved", "good");
            closeModal();
          } catch (err) { toast(err.message, "bad"); }
        } }),
      ]);
    } catch (err) {
      // Non-text or too large — offer download instead.
      toast(err.message + " — use ↓ to download", "bad");
    }
  }

  async function fmDelete(entry) {
    if (!confirmInline(`Move ${entry.is_dir ? "folder" : "file"} "${entry.name}" to the recycle bin?`)) return;
    try {
      await API.filesDelete(entry.path, false);
      toast("Moved to recycle bin", "good");
      fmLoad(fmState.cwd);
    } catch (err) { toast(err.message, "bad"); }
  }

  async function fmNewFolder() {
    const name = promptInline("New folder name:");
    if (!name) return;
    try {
      await API.filesMkdir(fmState.cwd, name);
      toast("Folder created", "good");
      fmLoad(fmState.cwd);
    } catch (err) { toast(err.message, "bad"); }
  }

  async function fmUpload(ev) {
    await fmUploadFiles(ev.target.files);
    ev.target.value = "";
  }
  async function fmUploadFiles(files) {
    const list = [...(files || [])];
    if (!list.length) return;
    let ok = 0;
    for (const file of list) {
      const form = new FormData();
      form.append("path", fmState.cwd);
      form.append("file", file);
      try { await API.postForm("/api/files/upload", form); ok++; }
      catch (err) { toast(`${file.name}: ${err.message}`, "bad"); }
    }
    if (ok) toast(`Uploaded ${ok} file${ok > 1 ? "s" : ""}`, "good");
    fmLoad(fmState.cwd);
  }

  // ======================================================================
  //  Network
  // ======================================================================
  const netHist = { rx: [], tx: [] };
  // ======================================================================
  //  Network — Overview · Wi-Fi · IP settings · Hotspot · Devices · Ports · Hostname
  // ======================================================================
  const NET_TABS = [["overview", "Overview", "dashboard"], ["wifi", "Wi-Fi", "wifi"], ["ip", "IP & DNS", "network"],
    ["hotspot", "Hotspot", "dns"], ["devices", "Devices on LAN", "users"], ["ports", "Open ports", "shield"], ["host", "Hostname", "home"]];
  const netView = { tab: "overview" };

  function viewNetwork(root) {
    const tabs = el("div", { class: "cw-seg net-tabs" });
    const body = el("div", { class: "net-body" });
    const banner = el("div", { id: "net-pending" });
    root.append(banner, tabs, body);
    let tabCleanups = [];
    NET_TABS.forEach(([k, l, ic]) => tabs.append(el("button", { type: "button", "data-t": k, class: k === netView.tab ? "active" : "", onclick: () => show(k) }, [icon(ic, 14), " ", l])));
    function show(k) {
      tabCleanups.forEach((f) => { try { f(); } catch (e) {} }); tabCleanups = [];
      netView.tab = k;
      tabs.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.t === k));
      body.innerHTML = "";
      const before = (state.cleanups || []).length;
      ({ overview: netOverviewTab, wifi: netWifiTab, ip: netIPTab, hotspot: netHotspotTab, devices: netDevicesTab, ports: netPortsTab, host: netHostTab })[k](body);
      tabCleanups = (state.cleanups || []).splice(before);
    }
    (state.cleanups = state.cleanups || []).push(() => tabCleanups.forEach((f) => { try { f(); } catch (e) {} }));
    const pt = setInterval(() => pollPending(banner), 3000);
    state.cleanups.push(() => clearInterval(pt));
    pollPending(banner);
    show(netView.tab);
  }

  // ---- confirm-or-revert banner ----
  async function pollPending(box, known) {
    let p = known;
    if (!p) { try { p = (await API.netPending()).pending; } catch (e) { return; } }
    box.innerHTML = "";
    if (!p) return;
    box.append(el("div", { class: "net-pending" }, [
      el("div", { class: "net-count", text: p.seconds_left }),
      el("div", { class: "grow" }, [el("b", { text: `Keep this change? — ${p.label}` }),
        el("span", { html: p.new_url ? `If this page stops responding, open <a href="${esc(p.new_url)}">${esc(p.new_url.split("?")[0])}</a> and it will confirm automatically. Otherwise everything is put back in <b>${p.seconds_left}s</b>.` : `If the panel still works, click Keep. Otherwise it's put back automatically in <b>${p.seconds_left}s</b>.` })]),
      el("button", { class: "btn btn-ghost", text: "Revert now", onclick: async () => { try { await API.netRevert(p.id); toast("Reverted", "good"); pollPending(box); } catch (e) { toast(e.message, "bad"); } } }),
      el("button", { class: "btn btn-primary", text: "Keep", onclick: async () => { try { await API.netConfirm(p.id); toast("Change kept", "good"); pollPending(box); } catch (e) { toast(e.message, "bad"); } } }),
    ]));
  }
  // Arriving at the new address after an IP change: confirm with the one-time code.
  (function handleNetConfirm() {
    const code = new URLSearchParams(location.search).get("netconfirm");
    if (!code) return;
    history.replaceState(null, "", location.pathname);
    API.netConfirm(code).then(() => toast("✔ New network settings kept", "good")).catch((e) => toast(e.message, "bad"));
  })();

  const netCard = (ico, title, sub, ...kids) => el("div", { class: "card dmm-card" }, [el("div", { class: "cw-card-h" }, [icon(ico, 16), el("div", {}, [el("h3", { text: title }), sub ? el("p", { text: sub }) : null])]), ...kids]);

  // ---- Overview ----
  function netOverviewTab(body) {
    const top = el("div", { class: "net-sum" }, el("div", { class: "loading", text: "Reading network…" }));
    const legacy = el("div", { style: "margin-top:16px" });
    body.append(top, legacy);
    API.netOverview().then((o) => {
      top.innerHTML = "";
      const tile = (ico, k, v, sub) => el("div", { class: "card net-tile" }, [el("span", { class: "scard-ico" }, icon(ico, 16)), el("div", {}, [el("span", { class: "muted", text: k }), el("b", { text: v }), sub ? el("span", { class: "dm-hint", text: sub }) : null])]);
      top.append(
        tile("home", "Hostname", o.hostname, `${o.hostname}.local on your LAN`),
        tile("link", "You're connected via", o.panel_iface || "?", o.panel_ip || ""),
        tile("network", "Gateway (router)", o.gateway ? o.gateway.ip : "—", o.gateway ? `via ${o.gateway.device}` : ""),
        tile("dns", "DNS servers", o.dns.join(", ") || "—", ""));
      if (!o.nm) top.append(el("div", { class: "dm-note", style: "grid-column:1/-1" }, [icon("error", 15), el("span", { text: "NetworkManager (nmcli) isn't available here, so Wi-Fi / IP / hotspot controls are disabled." })]));
      o.devices.forEach((d) => {
        const c = o.connections.find((x) => x.device === d.device);
        top.append(el("div", { class: "card net-dev" }, [
          el("span", { class: `net-dot ${/^connected/.test(d.state) ? "on" : ""}` }),
          el("div", {}, [el("b", { text: `${d.device} · ${d.type}` }), el("span", { class: "muted", text: `${d.state}${d.connection ? " · " + d.connection : ""}` }),
            c ? el("span", { class: "dm-hint", text: `${(c.live_addresses[0] || "no address")} · ${c.method === "manual" ? "static" : "DHCP"}` }) : null]),
        ]));
      });
    }).catch((e) => { top.innerHTML = ""; top.append(el("p", { class: "empty", text: e.message })); });
    netLegacy(legacy);
  }

  // ---- Wi-Fi ----
  function bars(sig) {
    const n = sig >= 75 ? 4 : sig >= 55 ? 3 : sig >= 35 ? 2 : 1;
    return el("span", { class: "net-bars", title: `${sig}%` }, [1, 2, 3, 4].map((i) => el("i", { class: i <= n ? "on" : "", style: `height:${i * 25}%` })));
  }
  function netWifiTab(body) {
    const head = el("div", { class: "dm-bar" });
    const listBox = el("div", {}, el("div", { class: "loading", text: "Scanning for networks…" }));
    body.append(head, listBox);
    const load = async (rescan = true) => {
      let d;
      try { d = await API.netWifi(rescan); } catch (e) { listBox.innerHTML = ""; listBox.append(el("p", { class: "empty", text: e.message })); return; }
      head.innerHTML = "";
      head.append(el("span", { class: "net-radio" }, [icon("wifi", 15), " Wi-Fi radio ", sw(d.radio === "enabled", async (v, i) => { try { await API.netWifiRadio(v); toast(`Wi-Fi ${v ? "on" : "off"}`, "good"); load(); } catch (e) { i.checked = !v; toast(e.message, "bad"); } })]),
        el("span", { class: "grow" }),
        el("button", { class: "btn btn-sm", onclick: () => connectModal("", true, true) }, [icon("lock", 12), " Hidden network"]),
        el("button", { class: "btn btn-sm btn-primary", onclick: () => { listBox.innerHTML = '<div class="loading">Scanning…</div>'; load(true); } }, [icon("refresh", 12), " Rescan"]));
      listBox.innerHTML = "";
      if (!d.networks.length) { listBox.append(el("p", { class: "empty", text: "No networks found." })); return; }
      listBox.append(el("div", { class: "net-wifi" }, d.networks.map((n) => el("div", { class: `net-ap ${n.in_use ? "on" : ""}` }, [
        bars(n.signal),
        el("div", { class: "grow" }, [el("b", { text: n.ssid }), el("span", { class: "muted", text: `${n.band} · ch ${n.channel} · ${n.security === "open" ? "open" : n.security}` })]),
        n.in_use ? el("span", { class: "pill good", text: "connected" }) : n.saved ? el("span", { class: "pill dim", text: "saved" }) : null,
        n.security !== "open" ? icon("lock", 13) : null,
        !n.in_use ? el("button", { class: "btn btn-sm", text: "Connect", onclick: () => connectModal(n.ssid, n.security !== "open" && !n.saved, false) }) : null,
        n.saved && !n.in_use ? el("button", { class: "btn btn-sm btn-ghost", title: "Forget", onclick: async () => { if (!confirmInline(`Forget ${n.ssid}?`)) return; try { await API.netWifiForget(n.ssid); toast("Forgotten", "good"); load(false); } catch (e) { toast(e.message, "bad"); } } }, icon("error", 12)) : null,
      ]))));
    };
    function connectModal(ssid, needPw, hidden) {
      const f = el("div", { class: "dm-form" });
      const s = el("input", { type: "text", value: ssid, placeholder: "Network name (SSID)" }); if (ssid) s.readOnly = true;
      const p = el("input", { type: "password", placeholder: needPw || hidden ? "Wi-Fi password" : "(saved or open — leave empty)", autocomplete: "off" });
      f.append(el("label", { class: "cw-lbl" }, ["Network", s]), el("label", { class: "cw-lbl" }, ["Password", p]),
        el("div", { class: "dm-note" }, [icon("error", 15), el("span", { text: "If you're using the panel over Wi-Fi, switching networks will disconnect this page. You'll have 2 minutes to confirm from the new network; otherwise the Pi reconnects to the current one automatically." })]));
      const go = el("button", { class: "btn btn-primary", text: "Connect", onclick: async () => {
        go.disabled = true;
        try { const r = await API.netWifiConnect({ ssid: s.value.trim(), password: p.value, hidden }); closeModal(); toast(r.pending ? "Switching… confirm when you're reconnected" : `Connected to ${s.value}`, "good"); pollPending($("#net-pending"), r.pending); setTimeout(() => load(false), 4000); }
        catch (e) { go.disabled = false; toast(e.message, "bad"); }
      } });
      openModal(hidden ? "Connect to a hidden network" : `Connect to ${ssid}`, f, [go]);
      setTimeout(() => (ssid ? p : s).focus(), 40);
    }
    load(false).then(() => load(true));
  }

  // ---- IP & DNS ----
  const DNS_PRESETS = [["Cloudflare", "1.1.1.1, 1.0.0.1"], ["Google", "8.8.8.8, 8.8.4.4"], ["Quad9", "9.9.9.9, 149.112.112.112"], ["Router (DHCP)", ""]];
  function netIPTab(body) {
    body.append(el("div", { class: "loading", text: "Loading connections…" }));
    API.netOverview().then((o) => {
      body.innerHTML = "";
      const conns = o.connections.filter((c) => (c.type === "ethernet" || c.type === "wifi") && c.mode !== "ap");
      if (!conns.length) { body.append(el("p", { class: "empty", text: "No Ethernet or Wi-Fi connections found." })); return; }
      body.append(el("p", { class: "muted dm-intro", text: "Give the Pi a fixed (static) address so bookmarks, port-forwards and SSH always find it — or leave it on DHCP. Changes to the connection you're using are applied with a 2-minute safety timer." }));
      conns.forEach((c) => {
        const live = (c.live_addresses[0] || c.addresses[0] || "");
        const s = { method: c.method === "manual" ? "manual" : "auto", address: c.addresses[0] || live, gateway: c.gateway_cfg || c.live_gateway || (o.gateway && o.gateway.ip) || "", dns: (c.dns_cfg.length ? c.dns_cfg : []).join(", ") };
        const mine = c.device && c.device === o.panel_iface;
        const addr = el("input", { type: "text", value: s.address, placeholder: "192.168.0.50/24", oninput: (e) => { s.address = e.target.value; } });
        const gw = el("input", { type: "text", value: s.gateway, placeholder: "192.168.0.1", oninput: (e) => { s.gateway = e.target.value; } });
        const dns = el("input", { type: "text", value: s.dns, placeholder: "empty = use the router's DNS", oninput: (e) => { s.dns = e.target.value; } });
        const staticBox = el("div", { class: "dm-row2 net-static" }, [el("label", { class: "cw-lbl" }, ["IP address / prefix", addr]), el("label", { class: "cw-lbl" }, ["Gateway (router)", gw])]);
        const segm = el("div", { class: "cw-seg cw-seg-sm" }, [["auto", "DHCP (automatic)"], ["manual", "Static IP"]].map(([m, l]) => el("button", { type: "button", class: s.method === m ? "active" : "", text: l, onclick: (e) => {
          s.method = m; segm.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === e.target)); staticBox.classList.toggle("dm-dim", m !== "manual");
        } })));
        staticBox.classList.toggle("dm-dim", s.method !== "manual");
        const save = el("button", { class: "btn btn-primary", onclick: async () => {
          if (mine && !confirmInline(`You're using ${c.device} right now.\n\nThe change is applied and you'll have 2 minutes to confirm it. If the panel can't be reached, the old settings come back automatically.\n\nApply?`)) return;
          save.disabled = true;
          try {
            const r = await API.netIPv4({ uuid: c.uuid, method: s.method, address: s.address.trim(), gateway: s.gateway.trim(), dns: s.dns.split(/[\s,]+/).filter(Boolean) });
            toast(r.pending ? "Applied — confirm to keep it" : "Applied", "good");
            pollPending($("#net-pending"), r.pending);
            if (r.pending && r.pending.new_url) setTimeout(() => { location.href = r.pending.new_url; }, 4500);
          } catch (e) { toast(e.message, "bad"); }
          save.disabled = false;
        } }, [icon("backup", 13), " Apply"]);
        body.append(netCard(c.type === "wifi" ? "wifi" : "network", `${c.name}`, `${c.device || "not active"} · now ${live || "no address"} · ${c.method === "manual" ? "static" : "DHCP"}`,
          mine ? el("div", { class: "dm-note" }, [icon("link", 15), el("span", { text: "You're connected to the panel through this connection." })]) : null,
          segm, staticBox,
          el("label", { class: "cw-lbl" }, ["DNS servers", dns, el("div", { class: "zn-presets" }, DNS_PRESETS.map(([l, v]) => el("button", { type: "button", class: "cw-chip", text: l, onclick: () => { dns.value = v; s.dns = v; } })))]),
          el("div", { class: "cw-actions" }, save)));
      });
    }).catch((e) => { body.innerHTML = ""; body.append(el("p", { class: "empty", text: e.message })); });
  }

  // ---- Hotspot ----
  function netHotspotTab(body) {
    body.append(el("div", { class: "loading", text: "Loading…" }));
    Promise.all([API.netHotspot(), API.netOverview(), API.netWifi(false).catch(() => ({ devices: [] }))]).then(([h, o, wf]) => {
      body.innerHTML = "";
      const devs = wf.devices.length ? wf.devices : ["wlan0"];
      const f = { ssid: h.ssid || `${o.hostname}-hotspot`, password: "", device: devs.find((d) => d !== o.panel_iface) || devs[0], band: "bg" };
      const blocked = f.device === o.panel_iface;
      const status = h.active ? el("div", { class: "dm-note good" }, [icon("wifi", 15), el("span", { html: `Hotspot <b>${esc(h.ssid || "")}</b> is on (${esc(h.device || "")}${h.address ? ", " + esc(h.address) : ""}). Devices that join get internet through the Pi's other connection.` }),
        el("button", { class: "btn btn-sm", text: "Stop hotspot", onclick: async () => { try { await API.netHotspotStop(); toast("Hotspot stopped", "good"); netHotspotTab((body.innerHTML = "", body)); } catch (e) { toast(e.message, "bad"); } } })]) : null;
      const ss = el("input", { type: "text", value: f.ssid, oninput: (e) => { f.ssid = e.target.value; } });
      const pw = el("input", { type: "text", placeholder: "8–63 characters", oninput: (e) => { f.password = e.target.value; } });
      const dev = el("select", { onchange: (e) => { f.device = e.target.value; } }, devs.map((d) => el("option", { value: d, text: d + (d === o.panel_iface ? " (you're using this)" : "") }))); dev.value = f.device;
      const band = el("select", { onchange: (e) => { f.band = e.target.value; } }, [el("option", { value: "bg", text: "2.4 GHz (best range)" }), el("option", { value: "a", text: "5 GHz (faster)" })]);
      body.append(status, netCard("wifi", "Turn the Pi into a Wi-Fi hotspot", "Great for travel, workshops or setting up gadgets with no router around.",
        blocked ? el("div", { class: "dm-note" }, [icon("error", 15), el("span", { text: `You're reaching the panel through ${f.device}. A Wi-Fi chip can't be a hotspot and a client at the same time — plug in Ethernet or add a USB Wi-Fi adapter first.` })]) : null,
        el("div", { class: "dm-row2" }, [el("label", { class: "cw-lbl" }, ["Hotspot name", ss]), el("label", { class: "cw-lbl" }, ["Password", el("div", { class: "wp-pw" }, [pw, el("button", { type: "button", class: "btn btn-sm", text: "Generate", onclick: async () => { const r = await API.appPassword(); pw.value = r.password.replace(/[^A-Za-z0-9]/g, "").slice(0, 16); f.password = pw.value; } })])])]),
        el("div", { class: "dm-row2" }, [el("label", { class: "cw-lbl" }, ["Wi-Fi adapter", dev]), el("label", { class: "cw-lbl" }, ["Band", band])]),
        el("div", { class: "cw-actions" }, el("button", { class: "btn btn-primary", onclick: async () => {
          try { await API.netHotspotStart(f); toast("Hotspot started", "good"); body.innerHTML = ""; netHotspotTab(body); } catch (e) { toast(e.message, "bad"); }
        } }, [icon("wifi", 13), h.active ? " Restart hotspot" : " Start hotspot"]))));
    }).catch((e) => { body.innerHTML = ""; body.append(el("p", { class: "empty", text: e.message })); });
  }

  // ---- Devices on LAN ----
  function netDevicesTab(body) {
    const box = el("div", {}, el("div", { class: "loading", text: "Looking around the network…" }));
    body.append(el("div", { class: "dm-bar" }, [el("span", { class: "muted", text: "Devices the Pi has talked to recently (ARP/neighbour table), with names where the network provides them." }), el("span", { class: "grow" }),
      el("button", { class: "btn btn-sm", onclick: () => { box.innerHTML = '<div class="loading">Refreshing…</div>'; load(); } }, [icon("refresh", 12), " Refresh"])]), box);
    const load = () => API.netNeighbours().then((d) => {
      box.innerHTML = "";
      if (!d.devices.length) { box.append(el("p", { class: "empty", text: "No neighbours seen yet." })); return; }
      box.append(el("div", { class: "dm-count muted", text: `${d.devices.length} device(s)` }), simpleTable(["IP address", "Name", "Vendor", "MAC", "Status"], d.devices.map((x) => el("tr", {}, [
        el("td", {}, el("code", { text: x.ip })), el("td", { text: x.hostname || "—" }), el("td", { class: "muted", text: x.vendor || "—" }),
        el("td", { class: "muted" }, el("code", { text: x.mac })),
        el("td", {}, el("span", { class: `pill ${x.state === "reachable" ? "good" : "dim"}`, text: x.state === "reachable" ? "online" : "seen recently" })),
      ]))));
    }).catch((e) => { box.innerHTML = ""; box.append(el("p", { class: "empty", text: e.message })); });
    load();
  }

  // ---- Open ports ----
  const PORT_HINTS = { 22: "SSH", 53: "DNS", 80: "HTTP (web)", 443: "HTTPS (web)", 3306: "MariaDB", 5432: "PostgreSQL", 8088: "AuroraPanel", 139: "Samba", 445: "Samba", 137: "Samba names", 138: "Samba", 5353: "mDNS / .local", 111: "rpcbind", 631: "Printing (CUPS)", 25: "Mail (SMTP)", 953: "BIND control", 3389: "Remote desktop", 5900: "VNC" };
  function netPortsTab(body) {
    const box = el("div", {}, el("div", { class: "loading", text: "Listing listening ports…" }));
    body.append(el("p", { class: "muted dm-intro", html: "Programs waiting for connections. Anything on <b>all interfaces</b> can be reached from your network — close what you don't use, or limit it with the Firewall." }), box);
    API.netPorts().then((d) => {
      box.innerHTML = "";
      box.append(simpleTable(["Port", "Protocol", "What it is", "Program", "Reachable from"], d.ports.map((p) => el("tr", {}, [
        el("td", {}, el("b", { text: p.port })), el("td", { class: "muted", text: p.proto.toUpperCase() }), el("td", { text: PORT_HINTS[p.port] || "—" }),
        el("td", {}, el("code", { text: p.process })),
        el("td", {}, el("span", { class: `pill ${p.scope === "all interfaces" ? "warn" : p.scope === "this machine only" ? "good" : "dim"}`, text: p.scope })),
      ]))));
    }).catch((e) => { box.innerHTML = ""; box.append(el("p", { class: "empty", text: e.message })); });
  }

  // ---- Hostname ----
  function netHostTab(body) {
    API.netOverview().then((o) => {
      const i = el("input", { type: "text", value: o.hostname });
      body.append(netCard("home", "Hostname", "The Pi's name on your network. With mDNS you can reach it as name.local from most computers and phones.",
        el("label", { class: "cw-lbl" }, ["Hostname", i, el("span", { class: "dm-hint", text: "Letters, digits and hyphens. /etc/hosts is updated too." })]),
        el("div", { class: "cw-actions" }, el("button", { class: "btn btn-primary", onclick: async () => {
          try { const r = await API.netHostname(i.value); toast(`Renamed to ${r.hostname} — now ${r.mdns}`, "good"); $("#host-badge").textContent = r.hostname; } catch (e) { toast(e.message, "bad"); }
        } }, [icon("backup", 13), " Save hostname"]))));
    }).catch((e) => body.append(el("p", { class: "empty", text: e.message })));
  }

  function netLegacy(root) {
    // Ping tool
    const ping = el("div", { class: "card", style: "margin-bottom:16px" }, [
      el("h3", { text: "Network test — ping" }),
      el("div", { class: "toolbar", style: "margin:0" }, [
        el("input", { id: "ping-host", type: "text", placeholder: "host or IP (e.g. google.com)", value: "8.8.8.8", style: "flex:1;min-width:200px", onkeydown: (e) => { if (e.key === "Enter") doPing(); } }),
        el("button", { class: "btn btn-sm btn-primary", text: "Ping", onclick: doPing }),
        el("button", { class: "btn btn-sm", text: "Traceroute", onclick: () => navigate("dns") }),
      ]),
      el("div", { id: "ping-out", style: "margin-top:12px" }),
    ]);
    const tiles = el("div", { class: "gauge-row", id: "net-tiles" });
    const chart = el("div", { class: "chart-row", id: "net-chart", style: "grid-template-columns:1fr;margin-bottom:16px" });
    const body = el("div", { id: "net-body" }, el("div", { class: "loading", text: "Loading…" }));
    root.append(ping, tiles, chart, body);

    let prev = null, prevT = 0;
    const load = async () => {
      await guardedLoad(async () => {
        const data = await API.network();
        const now = Date.now();
        // Aggregate totals across interfaces (skip loopback).
        let rx = 0, tx = 0;
        data.interfaces.forEach((n) => { if (n.name !== "lo") { rx += n.bytes_recv; tx += n.bytes_sent; } });
        let rxRate = 0, txRate = 0;
        if (prev && now > prevT) { const dt = (now - prevT) / 1000; rxRate = Math.max(0, (rx - prev.rx) / dt); txRate = Math.max(0, (tx - prev.tx) / dt); }
        prev = { rx, tx }; prevT = now;
        netHist.rx.push(rxRate); netHist.tx.push(txRate);
        if (netHist.rx.length > 40) { netHist.rx.shift(); netHist.tx.shift(); }

        tiles.innerHTML = "";
        tiles.append(netStat("Download", "↓", "#22c9a0", rxRate, rx));
        tiles.append(netStat("Upload", "↑", "#5aa2ff", txRate, tx));
        // throughput chart (scale to max)
        chart.innerHTML = "";
        chart.append(throughputChart(netHist));

        body.innerHTML = "";
        const rows = data.interfaces.map((n) => el("tr", {}, [
          el("td", { text: n.name }),
          el("td", {}, el("span", { class: `pill ${n.is_up ? "good" : "dim"}`, text: n.is_up ? "up" : "down" })),
          el("td", { class: "muted", text: n.ipv4 || "—" }),
          el("td", { class: "muted", text: n.mac || "—" }),
          el("td", { text: fmtBytes(n.bytes_recv) }),
          el("td", { text: fmtBytes(n.bytes_sent) }),
          el("td", { class: "muted", text: n.speed_mbps ? `${n.speed_mbps} Mbps` : "—" }),
        ]));
        body.append(el("div", { class: "table-wrap" }, el("table", {}, [
          el("thead", {}, el("tr", {}, ["Interface", "State", "IPv4", "MAC", "↓ Recv", "↑ Sent", "Speed"].map((h) => el("th", { text: h })))),
          el("tbody", {}, rows),
        ])));
      });
    };
    async function doPing() {
      const host = $("#ping-host").value.trim(); if (!host) return;
      $("#ping-out").innerHTML = '<div class="loading">Pinging…</div>';
      try {
        const r = await API.ping(host);
        $("#ping-out").innerHTML = "";
        $("#ping-out").append(el("div", { style: "display:flex;gap:10px;margin-bottom:10px;flex-wrap:wrap" }, [
          el("span", { class: `pill ${r.loss_pct === 0 ? "good" : r.loss_pct === 100 ? "bad" : "warn"}`, text: `${r.loss_pct != null ? r.loss_pct : "?"}% loss` }),
          r.avg_ms != null ? el("span", { class: "pill dim", text: `avg ${r.avg_ms} ms` }) : null,
        ]));
        $("#ping-out").append(el("pre", { class: "log", text: r.output }));
      } catch (e) { $("#ping-out").innerHTML = ""; toast(e.message, "bad"); }
    }
    const timer = setInterval(load, 2000);
    (state.cleanups = state.cleanups || []).push(() => clearInterval(timer));
    state.refreshHandler = load;
    load();
  }
  function netStat(title, arrow, color, rate, total) {
    const hist = (title === "Download" ? netHist.rx : netHist.tx);
    const card = el("div", { class: "card scard" });
    card.innerHTML = `
      <div class="scard-head"><span class="scard-ico" style="color:${color};background:color-mix(in srgb, ${color} 16%, transparent);font-weight:800">${arrow}</span><span class="scard-title">${title}</span></div>
      <div class="scard-main"><div><div class="scard-val">${fmtBytes(rate)}<span class="scard-unit">/s</span></div>
      <div class="scard-delta flat"><span class="scard-subtxt">total ${fmtBytes(total)}</span></div></div>
      ${sparklineSvg(hist, color)}</div>`;
    return card;
  }
  function throughputChart(h) {
    const W = 100, H = 40;
    const all = h.rx.concat(h.tx);
    const max = Math.max(1, ...all);
    const line = (data, color) => {
      if (data.length < 2) return "";
      const pts = data.map((v, i) => `${(i / (data.length - 1) * W).toFixed(2)},${(H - (v / max) * (H - 2)).toFixed(2)}`).join(" ");
      return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>`;
    };
    const card = el("div", { class: "card chart-card" });
    card.innerHTML = `<div class="chart-head"><span class="chart-title">Live throughput</span>
      <span style="font-size:12px"><span style="color:#22c9a0">↓ ${fmtBytes(h.rx[h.rx.length-1]||0)}/s</span>&nbsp;&nbsp;<span style="color:#5aa2ff">↑ ${fmtBytes(h.tx[h.tx.length-1]||0)}/s</span></span></div>
      <svg class="chart-svg" style="height:80px" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        ${[0.25,0.5,0.75].map(g=>`<line x1="0" y1="${(H*g).toFixed(1)}" x2="${W}" y2="${(H*g).toFixed(1)}" stroke="rgba(150,180,220,0.09)" stroke-width="0.5" vector-effect="non-scaling-stroke"/>`).join("")}
        ${line(h.rx, "#22c9a0")}${line(h.tx, "#5aa2ff")}</svg>`;
    return card;
  }

  // ======================================================================
  //  Shared: background-job output panel
  // ======================================================================
  function jobPanel(root) {
    const panel = el("div", { class: "card", style: "margin-top:16px", hidden: true });
    const title = el("h3", {});
    const pre = el("pre", { class: "log" });
    panel.append(title, pre);
    root.append(panel);

    let timer = null;
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    return {
      async run(jobId, label) {
        stop();
        panel.hidden = false;
        title.textContent = label || "Working…";
        pre.textContent = "Starting…";
        const tick = async () => {
          try {
            const j = await API.job(jobId);
            pre.textContent = j.output || "(no output yet)";
            pre.scrollTop = pre.scrollHeight;
            title.textContent = `${j.title} — ${j.status}${j.status !== "running" ? ` (exit ${j.returncode})` : ""}`;
            if (j.status !== "running") {
              stop();
              toast(`${j.title}: ${j.status}`, j.status === "done" ? "good" : "bad");
            }
          } catch (err) { stop(); toast(err.message, "bad"); }
        };
        await tick();
        timer = setInterval(tick, 1300);
      },
      stop,
    };
  }

  // ======================================================================
  //  Terminal (xterm.js over WebSocket PTY)
  // ======================================================================
  const termCtx = {};
  function viewTerminal(root) {
    const note = el("p", { class: "muted", style: "margin:0 0 12px",
      text: "Live shell on the Pi (runs as the panel's user). Type 'exit' or leave the tab to end the session." });
    const host = el("div", { id: "term-host", style: "height:70vh;border:1px solid var(--border);border-radius:10px;overflow:hidden;background:#000;padding:6px" });
    root.append(note, host);

    if (typeof Terminal === "undefined") {
      host.innerHTML = '<p class="empty">Terminal library failed to load.</p>';
      return;
    }
    const term = new Terminal({
      cursorBlink: true, fontSize: 13, fontFamily: '"Cascadia Code","Consolas",monospace',
      theme: { background: "#000000", foreground: "#e6edf3" },
    });
    let fit = null;
    try { fit = new FitAddon.FitAddon(); term.loadAddon(fit); } catch (e) {}
    term.open(host);
    if (fit) { try { fit.fit(); } catch (e) {} }

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/api/terminal/ws`);
    const sendResize = () => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    };
    ws.onopen = () => { term.focus(); sendResize(); };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "output") term.write(msg.data);
        else if (msg.type === "exit") term.write("\r\n\x1b[90m[session ended]\x1b[0m\r\n");
      } catch (e) {}
    };
    ws.onclose = () => { try { term.write("\r\n\x1b[90m[disconnected]\x1b[0m\r\n"); } catch (e) {} };
    term.onData((d) => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: "input", data: d })); });
    const onResize = () => { if (fit) { try { fit.fit(); } catch (e) {} } sendResize(); };
    window.addEventListener("resize", onResize);

    termCtx.dispose = () => {
      window.removeEventListener("resize", onResize);
      try { ws.close(); } catch (e) {}
      try { term.dispose(); } catch (e) {}
      termCtx.dispose = null;
    };
    setTimeout(onResize, 60);
  }

  // ======================================================================
  //  Packages (apt)
  // ======================================================================
  function viewPackages(root) {
    const tabs = el("div", { class: "toolbar" }, [
      el("button", { class: "btn btn-sm", text: "↻ Update lists", onclick: () => runPkgJob(API.pkgUpdate(), "apt update") }),
      el("button", { class: "btn btn-sm btn-primary", text: "⬆ Upgrade all", onclick: () => confirmInline("Upgrade all upgradable packages?") && runPkgJob(API.pkgUpgrade(), "apt upgrade") }),
    ]);
    const searchBar = el("div", { class: "toolbar" }, [
      el("input", { id: "pkg-q", type: "text", placeholder: "Search apt packages…", style: "max-width:320px",
        onkeydown: (e) => { if (e.key === "Enter") doSearch(); } }),
      el("button", { class: "btn btn-sm", text: "Search", onclick: () => doSearch() }),
    ]);
    const upg = el("div", { class: "card", style: "margin-bottom:16px" }, el("div", { class: "loading", text: "Loading upgradable…" }));
    const results = el("div", {});
    root.append(tabs, upg, searchBar, results);
    const jp = jobPanel(root);

    async function runPkgJob(promise, label) {
      try { const r = await promise; jp.run(r.job, label); }
      catch (err) { toast(err.message, "bad"); }
    }
    window.__pkgJob = runPkgJob;

    const loadUpg = async () => {
      await guardedLoad(async () => {
        upg.innerHTML = ""; upg.append(el("h3", { text: "Upgradable packages" }));
        let data;
        try { data = await API.pkgUpgradable(); }
        catch (e) { upg.append(el("p", { class: "muted", text: e.message })); return; }
        if (!data.packages.length) { upg.append(el("p", { class: "muted", text: "Everything is up to date." })); return; }
        const rows = data.packages.map((p) => el("tr", {}, [
          el("td", { text: p.name }), el("td", { class: "muted", text: p.current }),
          el("td", { text: p.new_version }), el("td", { class: "muted", text: p.arch }),
        ]));
        upg.append(el("div", { class: "table-wrap" }, el("table", {}, [
          el("thead", {}, el("tr", {}, ["Package", "Current", "New", "Arch"].map((h) => el("th", { text: h })))),
          el("tbody", {}, rows),
        ])));
      });
    };

    async function doSearch() {
      const q = $("#pkg-q").value.trim();
      if (!q) return;
      results.innerHTML = '<div class="loading">Searching…</div>';
      try {
        const data = await API.pkgSearch(q);
        results.innerHTML = "";
        if (!data.results.length) { results.append(el("p", { class: "empty", text: "No matches." })); return; }
        const rows = data.results.map((r) => el("tr", {}, [
          el("td", { text: r.name }), el("td", { class: "muted", text: r.summary }),
          el("td", { class: "actions" }, el("button", { class: "btn btn-sm btn-primary", text: "Install",
            onclick: () => confirmInline(`Install ${r.name}?`) && window.__pkgJob(API.pkgInstall([r.name]), `install ${r.name}`) })),
        ]));
        results.append(el("div", { class: "table-wrap" }, el("table", {}, [
          el("thead", {}, el("tr", {}, ["Package", "Summary", ""].map((h) => el("th", { text: h })))),
          el("tbody", {}, rows),
        ])));
      } catch (err) { results.innerHTML = ""; toast(err.message, "bad"); }
    }

    state.refreshHandler = loadUpg;
    loadUpg();
  }

  // ======================================================================
  //  Cron
  // ======================================================================
  // ======================================================================
  //  Cron — expression engine (parse / describe / next runs)
  // ======================================================================
  const CRON_FIELDS = [
    { key: "minute", label: "minute", min: 0, max: 59 },
    { key: "hour", label: "hour", min: 0, max: 23 },
    { key: "dom", label: "day", long: "day-of-month", min: 1, max: 31 },
    { key: "month", label: "month", min: 1, max: 12, names: ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] },
    { key: "dow", label: "weekday", long: "day-of-week", min: 0, max: 7, names: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] },
  ];
  const MONTHS_L = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const DAYS_L = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const CRON_MACROS = {
    "@yearly": "0 0 1 1 *", "@annually": "0 0 1 1 *", "@monthly": "0 0 1 * *", "@weekly": "0 0 * * 0",
    "@daily": "0 0 * * *", "@midnight": "0 0 * * *", "@hourly": "0 * * * *",
  };
  const pad2 = (n) => String(n).padStart(2, "0");
  const ordinal = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  const joinList = (a) => a.length <= 1 ? a.join("") : a.length === 2 ? `${a[0]} and ${a[1]}` : `${a.slice(0, -1).join(", ")}, and ${a[a.length - 1]}`;
  const topOf = (f) => (f.max === 7 ? 6 : f.max);

  function cronToken(s, f) {
    if (f.names) {
      const i = f.names.indexOf(s.toUpperCase());
      if (i >= 0) return i + (f.key === "month" ? 1 : 0);
    }
    if (!/^\d+$/.test(s)) throw new Error(`"${s}" isn't a valid ${f.long || f.label}`);
    const n = +s;
    if (n < f.min || n > f.max) throw new Error(`${f.long || f.label} must be between ${f.min} and ${f.max}`);
    return n;
  }
  function cronParseField(txt, f) {
    const vals = new Set();
    for (const part of txt.split(",")) {
      if (!part) throw new Error(`Empty value in the ${f.label} field`);
      const bits = part.split("/");
      if (bits.length > 2) throw new Error(`Only one "/" allowed in "${part}"`);
      const [range, step] = bits;
      let st = 1;
      if (step !== undefined) {
        if (!/^\d+$/.test(step) || +step === 0) throw new Error(`"/${step}" isn't a valid step`);
        st = +step;
      }
      let lo, hi;
      if (range === "*") { lo = f.min; hi = topOf(f); }
      else if (range.includes("-")) {
        const [a, b, extra] = range.split("-");
        if (extra !== undefined) throw new Error(`Bad range "${range}"`);
        lo = cronToken(a, f); hi = cronToken(b, f);
        if (lo > hi) throw new Error(`Range ${range} goes backwards`);
      } else { lo = cronToken(range, f); hi = step !== undefined ? topOf(f) : lo; }
      for (let v = lo; v <= hi; v += st) vals.add(f.key === "dow" && v === 7 ? 0 : v);
    }
    return vals;
  }
  function cronParse(expr) {
    const s = (expr || "").trim().replace(/\s+/g, " ");
    if (!s) return { error: "Enter a schedule", parts: [] };
    if (s === "@reboot") return { expr: s, reboot: true, parts: [] };
    if (s.startsWith("@")) {
      if (!CRON_MACROS[s]) return { error: `Unknown shortcut ${s}`, parts: [] };
      return { ...cronParse(CRON_MACROS[s]), expr: s, macro: s };
    }
    const parts = s.split(" ");
    if (parts.length !== 5) return { error: parts.length < 5 ? `Missing fields — need 5, got ${parts.length}` : `Too many fields — need 5, got ${parts.length}`, parts, badField: parts.length > 5 ? 5 : parts.length };
    const sets = [];
    for (let i = 0; i < 5; i++) {
      try { sets.push(cronParseField(parts[i], CRON_FIELDS[i])); }
      catch (e) { return { error: e.message, parts, badField: i }; }
    }
    return { expr: s, parts, sets, domAny: parts[2].startsWith("*"), dowAny: parts[4].startsWith("*") };
  }
  function cronDayOk(p, d) {
    const dom = p.sets[2].has(d.getUTCDate()), dow = p.sets[4].has(d.getUTCDay());
    return (p.domAny || p.dowAny) ? dom && dow : dom || dow;  // Vixie cron OR rule
  }
  // Dates are "server wall-clock" timestamps: read/write with getUTC*/setUTC*.
  function cronNext(p, fromMs, n) {
    const out = [];
    if (!p || p.error || p.reboot) return out;
    const d = new Date(fromMs);
    d.setUTCSeconds(0, 0); d.setUTCMinutes(d.getUTCMinutes() + 1);
    const limit = fromMs + 5 * 366 * 864e5;
    let guard = 0;
    while (out.length < n && d.getTime() < limit && guard++ < 200000) {
      if (!p.sets[3].has(d.getUTCMonth() + 1)) { d.setUTCMonth(d.getUTCMonth() + 1, 1); d.setUTCHours(0, 0, 0, 0); continue; }
      if (!cronDayOk(p, d)) { d.setUTCDate(d.getUTCDate() + 1); d.setUTCHours(0, 0, 0, 0); continue; }
      if (!p.sets[1].has(d.getUTCHours())) { d.setUTCHours(d.getUTCHours() + 1, 0, 0, 0); continue; }
      if (!p.sets[0].has(d.getUTCMinutes())) { d.setUTCMinutes(d.getUTCMinutes() + 1, 0, 0); continue; }
      out.push(new Date(d));
      d.setUTCMinutes(d.getUTCMinutes() + 1, 0, 0);
    }
    return out;
  }
  function cronName(fi, v) { return fi === 3 ? MONTHS_L[v - 1] : fi === 4 ? DAYS_L[v % 7] : String(v); }
  const cronPlain = (txt) => !/[*\/-]/.test(txt);
  function cronFieldPhrase(txt, fi) {
    const f = CRON_FIELDS[fi], unit = f.long || f.label;
    const tok = (s) => cronName(fi, cronToken(s, f) % (fi === 4 ? 7 : 1000));
    if (cronPlain(txt)) return (fi >= 3 ? "" : unit + " ") + joinList(txt.split(",").map(tok));
    return joinList(txt.split(",").map((part) => {
      const [range, step] = part.split("/");
      const every = step ? `every ${ordinal(+step)} ${unit}` : `every ${unit}`;
      if (range === "*") return every;
      if (range.includes("-")) { const [a, b] = range.split("-"); return `${every} from ${tok(a)} through ${tok(b)}`; }
      if (step) return `${every} from ${tok(range)} through ${cronName(fi, topOf(f))}`;
      return tok(range);
    }));
  }
  function cronDescribe(p) {
    if (!p || p.error) return null;
    if (p.reboot) return "At system startup.";
    const [mi, h, dom, mon, dow] = p.parts;
    let s;
    if (cronPlain(mi) && cronPlain(h)) {
      const ms = mi.split(",").map(Number), hs = h.split(",").map(Number);
      s = ms.length * hs.length <= 4
        ? "At " + joinList(hs.flatMap((hh) => ms.map((mm) => `${pad2(hh)}:${pad2(mm)}`)))
        : `At minute ${joinList(ms.map(String))} past hour ${joinList(hs.map(String))}`;
    } else if (mi === "*" && h === "*") s = "At every minute";
    else {
      s = "At " + cronFieldPhrase(mi, 0);
      if (h !== "*") s += " past " + cronFieldPhrase(h, 1);
    }
    const days = [];
    if (dom !== "*") days.push("on " + cronFieldPhrase(dom, 2));
    if (dow !== "*") days.push("on " + cronFieldPhrase(dow, 4));
    if (days.length) s += " " + days.join(" and ");
    if (mon !== "*") s += " in " + cronFieldPhrase(mon, 3);
    return s + ".";
  }
  function cronRandom() {
    const r = (n) => Math.floor(Math.random() * n);
    const pick = (a) => a[r(a.length)];
    return pick([
      () => `${r(60)} ${r(24)} * * *`,
      () => `*/${pick([5, 10, 15, 20, 30])} * * * *`,
      () => `${r(60)} ${r(24)} * * ${r(7)}`,
      () => `${pick([0, 15, 30, 45])} ${8 + r(10)} * * 1-5`,
      () => `${r(60)} ${r(24)} ${1 + r(28)} * *`,
      () => `${r(60)} */${pick([2, 3, 4, 6, 12])} * * *`,
      () => `0 ${r(24)} 1 */${pick([2, 3, 6])} *`,
      () => `${r(60)} ${r(24)} * * 6,0`,
    ])();
  }
  const cronState = { offMin: -new Date().getTimezoneOffset(), tz: "" };
  const cronNow = () => Date.now() + cronState.offMin * 60000;
  const cronFmt = (d, opts) => d.toLocaleString([], { timeZone: "UTC", ...opts });
  function cronRel(ms) {
    const m = Math.round(ms / 60000);
    if (m < 1) return "in under a minute";
    if (m < 60) return `in ${m} min`;
    const h = Math.floor(m / 60), mm = m % 60;
    if (h < 24) return `in ${h}h${mm ? " " + mm + "m" : ""}`;
    const d = Math.floor(h / 24), hh = h % 24;
    return `in ${d}d${hh ? " " + hh + "h" : ""}`;
  }
  // cron treats a bare % in the command as a newline — escape it.
  const cronEscape = (cmd) => cmd.replace(/(^|[^\\])%/g, "$1\\%").replace(/(^|[^\\])%/g, "$1\\%");

  // ======================================================================
  //  Cron Jobs view — wizard + job list
  // ======================================================================
  const CRON_PRESETS = [
    ["Every minute", "* * * * *"], ["Every 5 min", "*/5 * * * *"], ["Every 15 min", "*/15 * * * *"],
    ["Hourly", "0 * * * *"], ["Daily at midnight", "0 0 * * *"], ["Daily at 3 AM", "0 3 * * *"],
    ["Weekdays 9 AM", "0 9 * * 1-5"], ["Weekends 10 AM", "0 10 * * 6,0"], ["Sundays 4 AM", "0 4 * * 0"],
    ["1st of month", "0 0 1 * *"], ["Every quarter", "0 0 1 */3 *"], ["At boot", "@reboot"],
  ];
  const CRON_TEMPLATES = [
    { icon: "backup", label: "Back up /home", cmd: "mkdir -p /root/aurora-backups && tar -czf /root/aurora-backups/home-$(date +%F).tar.gz /home", sched: "0 3 * * *" },
    { icon: "packages", label: "Refresh package lists", cmd: "apt-get update -qq", sched: "0 4 * * 0" },
    { icon: "lock", label: "Renew SSL certificates", cmd: "certbot renew --quiet", sched: "17 3 * * *" },
    { icon: "services", label: "Restart a service", cmd: "systemctl restart apache2", sched: "0 5 * * 1" },
    { icon: "folder", label: "Clean old /tmp files", cmd: "find /tmp -type f -mtime +7 -delete", sched: "30 2 * * *" },
    { icon: "network", label: "Ping a health-check URL", cmd: "curl -fsS -m 10 --retry 3 https://example.com/health", sched: "*/5 * * * *" },
    { icon: "terminal", label: "Run a script", get cmd() { return `${sysHome()}/scripts/job.sh`; }, sched: "0 * * * *" },
    { icon: "refresh", label: "Weekly reboot", cmd: "/sbin/shutdown -r now", sched: "0 5 * * 0" },
  ];
  const CRON_LEGEND = [
    [["*", "any value"], [",", "value list separator"], ["-", "range of values"], ["/", "step values"], ["0-59", "allowed values"]],
    [["*", "any value"], [",", "value list separator"], ["-", "range of values"], ["/", "step values"], ["0-23", "allowed values"]],
    [["*", "any value"], [",", "value list separator"], ["-", "range of values"], ["/", "step values"], ["1-31", "allowed values"]],
    [["*", "any value"], [",", "value list separator"], ["-", "range of values"], ["/", "step values"], ["1-12", "allowed values"], ["JAN-DEC", "alternative single values"]],
    [["*", "any value"], [",", "value list separator"], ["-", "range of values"], ["/", "step values"], ["0-6", "allowed values"], ["SUN-SAT", "alternative single values"], ["7", "sunday (non-standard)"]],
  ];
  const CRON_MACRO_LEGEND = [["@yearly", "once a year, Jan 1 00:00"], ["@monthly", "1st of the month, 00:00"], ["@weekly", "Sundays at 00:00"], ["@daily", "every day at 00:00"], ["@hourly", "at minute 0 of every hour"], ["@reboot", "once, when the Pi boots"]];

  function viewCron(root) {
    const w = { expr: "5 4 * * *", field: -1, editing: null, output: "keep" };

    const hero = el("div", { class: "cw-hero" });
    hero.innerHTML = `
      <div class="cw-hero-top"><span class="cw-badge">${I("wizard", 14)} Cron wizard</span><span class="cw-tz" id="cw-tz"></span></div>
      <div class="cw-quote" id="cw-desc"></div>
      <div class="cw-next" id="cw-next"></div>
      <div class="cw-editor">
        <button class="cw-tag cw-random" id="cw-random" type="button">${I("refresh", 12)} random</button>
        <input id="cw-expr" class="cw-input" spellcheck="false" autocomplete="off" aria-label="Cron expression" />
        <button class="cw-copy" id="cw-copy" type="button">Copy</button>
      </div>
      <div class="cw-fields" id="cw-fields">${CRON_FIELDS.map((f, i) => `<button type="button" data-f="${i}">${f.label}</button>`).join("")}</div>
      <div class="cw-err" id="cw-err" hidden></div>
      <div class="cw-lower">
        <table class="cw-legend" id="cw-legend"></table>
        <div class="cw-runs"><div class="cw-runs-h">Next runs</div><ol id="cw-runs"></ol></div>
      </div>
      <div class="cw-presets">${CRON_PRESETS.map(([l, e]) => `<button type="button" class="cw-chip" data-e="${esc(e)}">${esc(l)}</button>`).join("")}</div>`;

    // ---- visual builder ----
    const builder = el("div", { class: "card cw-card" });
    const MODES = ["Minutes", "Hourly", "Daily", "Weekly", "Monthly", "Yearly"];
    builder.innerHTML = `<div class="cw-card-h">${I("wizard", 16)}<div><h3>Build it visually</h3><p>Pick a rhythm — the expression updates as you go.</p></div></div>
      <div class="cw-seg" id="cw-modes">${MODES.map((m, i) => `<button type="button" data-m="${i}" class="${i === 2 ? "active" : ""}">${m}</button>`).join("")}</div>
      <div class="cw-build" id="cw-build"></div>`;

    // ---- command ----
    const cmdCard = el("div", { class: "card cw-card" });
    cmdCard.innerHTML = `<div class="cw-card-h">${I("terminal", 16)}<div><h3 id="cw-cmd-h">What should it run?</h3><p>Runs as <b>root</b> on the Pi, from the root crontab.</p></div></div>
      <div class="cw-templates">${CRON_TEMPLATES.map((t, i) => `<button type="button" class="cw-tpl" data-t="${i}">${I(t.icon, 14)}<span>${esc(t.label)}</span></button>`).join("")}</div>
      <label class="cw-lbl"><span>Name<span class="muted">(optional)</span></span><input id="cw-label" type="text" placeholder="e.g. Nightly backup" maxlength="80" /></label>
      <label class="cw-lbl">Command<textarea id="cw-cmd" rows="2" class="cw-mono" placeholder="/usr/bin/python3 ${esc(sysHome())}/script.py" spellcheck="false"></textarea></label>
      <div class="cw-warn" id="cw-pct" hidden>${I("error", 13)} <span>cron treats <code>%</code> as a newline — it will be escaped to <code>\\%</code> automatically.</span></div>
      <div class="cw-lbl">Output</div>
      <div class="cw-seg cw-seg-sm" id="cw-out">
        <button type="button" data-o="keep" class="active">Keep (mail)</button>
        <button type="button" data-o="null">Discard</button>
        <button type="button" data-o="log">Log to file</button>
      </div>
      <div class="cw-lbl">Crontab line</div>
      <pre class="cw-preview" id="cw-preview"></pre>
      <div class="cw-actions">
        <button class="btn btn-ghost" id="cw-cancel" type="button" hidden>Cancel edit</button>
        <button class="btn btn-primary" id="cw-save" type="button">${I("cron", 14)} <span>Schedule job</span></button>
      </div>`;

    const cols = el("div", { class: "cw-cols" }, [builder, cmdCard]);
    const upcoming = el("div", { class: "cw-upcoming", id: "cw-upcoming" });
    const listWrap = el("div", { id: "cron-body" }, el("div", { class: "loading", text: "Loading…" }));
    root.append(hero, cols, el("div", { class: "cw-list-h" }, [el("h2", { class: "section-title", id: "cw-count", text: "Scheduled jobs" })]), upcoming, listWrap);

    const exprIn = $("#cw-expr", hero);
    exprIn.value = w.expr;

    // ---------- hero logic ----------
    function fieldAtCaret() {
      const v = exprIn.value, pos = exprIn.selectionStart ?? v.length;
      if (v.trim().startsWith("@")) return -1;
      const before = v.slice(0, pos).replace(/^\s+/, "");
      return Math.min(4, before.split(/\s+/).length - 1);
    }
    function renderLegend() {
      const lg = $("#cw-legend", hero);
      const rows = w.field >= 0 ? CRON_LEGEND[w.field] : CRON_MACRO_LEGEND;
      lg.innerHTML = rows.map(([k, v]) => `<tr${w.field < 0 ? ` class="cw-macro" data-e="${k}"` : ""}><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("");
      hero.querySelectorAll("#cw-fields button").forEach((b) => b.classList.toggle("on", +b.dataset.f === w.field));
    }
    function update(fromInput) {
      if (!fromInput) exprIn.value = w.expr;
      w.expr = exprIn.value;
      const p = cronParse(w.expr);
      w.parsed = p;
      const desc = $("#cw-desc", hero), err = $("#cw-err", hero), next = $("#cw-next", hero), runs = $("#cw-runs", hero);
      hero.classList.toggle("invalid", !!p.error);
      hero.querySelectorAll("#cw-fields button").forEach((b) => b.classList.toggle("bad", p.badField === +b.dataset.f));
      if (p.error) {
        desc.textContent = "“…”"; err.hidden = false; err.textContent = p.error; next.innerHTML = "&nbsp;"; runs.innerHTML = "";
      } else {
        err.hidden = true;
        desc.textContent = `“${cronDescribe(p)}”`;
        const now = cronNow(), list = cronNext(p, now, 6);
        if (p.reboot) { next.textContent = "runs once each time the Pi boots"; runs.innerHTML = `<li class="muted">No clock schedule</li>`; }
        else if (!list.length) { next.textContent = "never matches — check day/month combination"; runs.innerHTML = ""; }
        else {
          next.innerHTML = `next at <b>${esc(cronFmt(list[0], { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }))}</b> · ${cronRel(list[0] - now)}`;
          runs.innerHTML = list.map((d) => `<li><span>${esc(cronFmt(d, { weekday: "short", month: "short", day: "numeric" }))}</span><b>${esc(cronFmt(d, { hour: "2-digit", minute: "2-digit", hour12: false }))}</b></li>`).join("");
        }
      }
      renderPreview();
    }
    exprIn.addEventListener("input", () => { w.field = fieldAtCaret(); renderLegend(); update(true); });
    ["click", "keyup", "focus"].forEach((ev) => exprIn.addEventListener(ev, () => { w.field = fieldAtCaret(); renderLegend(); }));
    hero.addEventListener("click", (e) => {
      const fb = e.target.closest("#cw-fields button");
      if (fb) { // select that field's text in the input
        const i = +fb.dataset.f, v = exprIn.value; const re = /\S+/g; let m, k = 0;
        while ((m = re.exec(v))) { if (k++ === i) { exprIn.focus(); exprIn.setSelectionRange(m.index, m.index + m[0].length); break; } }
        w.field = i; renderLegend(); return;
      }
      const chip = e.target.closest("[data-e]");
      if (chip) { w.expr = chip.dataset.e; update(); exprIn.focus(); w.field = fieldAtCaret(); renderLegend(); }
    });
    $("#cw-random", hero).addEventListener("click", () => { w.expr = cronRandom(); update(); });
    $("#cw-copy", hero).addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(exprIn.value.trim()); toast("Copied", "good"); }
      catch (e) { exprIn.select(); document.execCommand("copy"); toast("Copied", "good"); }
    });

    // ---------- builder ----------
    const hourOpts = (sel) => Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === sel ? "selected" : ""}>${pad2(h)}</option>`).join("");
    const minOpts = (sel, stepv) => Array.from({ length: 60 / (stepv || 1) }, (_, i) => i * (stepv || 1)).map((m) => `<option value="${m}" ${m === sel ? "selected" : ""}>${pad2(m)}</option>`).join("");
    const timePick = (h, m) => `<span class="cw-time"><select data-k="h">${hourOpts(h)}</select><b>:</b><select data-k="m">${minOpts(m)}</select></span>`;
    let mode = 2;
    function renderBuilder() {
      const b = $("#cw-build", builder);
      const days = [1, 2, 3, 4, 5, 6, 0];
      b.innerHTML = [
        `<div class="cw-row">Every <select data-k="n">${[1, 2, 3, 5, 10, 15, 20, 30].map((n) => `<option value="${n}" ${n === 5 ? "selected" : ""}>${n}</option>`).join("")}</select> minute(s)</div>`,
        `<div class="cw-row">Every <select data-k="n">${[1, 2, 3, 4, 6, 8, 12].map((n) => `<option value="${n}">${n}</option>`).join("")}</select> hour(s), at minute <select data-k="m">${minOpts(0)}</select></div>`,
        `<div class="cw-row">Every day at ${timePick(3, 0)}</div><div class="cw-row cw-sub"><label class="cw-check"><input type="checkbox" data-k="wd" /> Weekdays only (Mon–Fri)</label></div>`,
        `<div class="cw-row">On</div><div class="cw-days">${days.map((d) => `<button type="button" data-d="${d}" class="${d === 1 ? "on" : ""}">${DAYS_L[d].slice(0, 3)}</button>`).join("")}</div><div class="cw-row">at ${timePick(9, 0)}</div>`,
        `<div class="cw-row">On day <select data-k="dom">${Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}">${ordinal(i + 1)}</option>`).join("")}</select> of every <select data-k="every">${[[1, "month"], [2, "2 months"], [3, "3 months"], [6, "6 months"]].map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></div><div class="cw-row">at ${timePick(0, 0)}</div>`,
        `<div class="cw-row">Every year on <select data-k="mon">${MONTHS_L.map((m, i) => `<option value="${i + 1}">${m}</option>`).join("")}</select> <select data-k="dom">${Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join("")}</select></div><div class="cw-row">at ${timePick(0, 0)}</div>`,
      ][mode];
      b.querySelectorAll(".cw-days button").forEach((x) => x.addEventListener("click", () => { x.classList.toggle("on"); fromBuilder(); }));
      b.querySelectorAll("select, input").forEach((x) => x.addEventListener("change", fromBuilder));
      fromBuilder();
    }
    function fromBuilder() {
      const b = $("#cw-build", builder), v = (k) => { const x = b.querySelector(`[data-k="${k}"]`); return x ? (x.type === "checkbox" ? x.checked : +x.value) : null; };
      const h = v("h"), m = v("m");
      let e;
      if (mode === 0) e = v("n") === 1 ? "* * * * *" : `*/${v("n")} * * * *`;
      else if (mode === 1) e = `${m} ${v("n") === 1 ? "*" : "*/" + v("n")} * * *`;
      else if (mode === 2) e = `${m} ${h} * * ${v("wd") ? "1-5" : "*"}`;
      else if (mode === 3) {
        const ds = [...b.querySelectorAll(".cw-days button.on")].map((x) => +x.dataset.d).sort((a, c) => a - c);
        e = `${m} ${h} * * ${ds.length && ds.length < 7 ? ds.join(",") : "*"}`;
        if (ds.join(",") === "1,2,3,4,5") e = `${m} ${h} * * 1-5`;
      } else if (mode === 4) e = `${m} ${h} ${v("dom")} ${v("every") === 1 ? "*" : "*/" + v("every")} *`;
      else e = `${m} ${h} ${v("dom")} ${v("mon")} *`;
      w.expr = e; update();
    }
    $("#cw-modes", builder).addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      mode = +b.dataset.m;
      builder.querySelectorAll("#cw-modes button").forEach((x) => x.classList.toggle("active", x === b));
      renderBuilder();
    });

    // ---------- command ----------
    const cmdIn = $("#cw-cmd", cmdCard), labelIn = $("#cw-label", cmdCard);
    const slug = () => (labelIn.value.trim() || cmdIn.value.trim().split(/\s+/)[0].split("/").pop() || "job").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "job";
    function finalCommand() {
      let c = cronEscape(cmdIn.value.trim());
      if (!c) return "";
      if (w.output === "null") c += " >/dev/null 2>&1";
      else if (w.output === "log") c += ` >> /var/log/aurora-cron-${slug()}.log 2>&1`;
      return c;
    }
    function renderPreview() {
      const pv = $("#cw-preview", cmdCard); if (!pv) return;
      $("#cw-pct", cmdCard).hidden = !/(^|[^\\])%/.test(cmdIn.value);
      const lab = labelIn.value.trim(), c = finalCommand();
      const sched = (w.parsed && !w.parsed.error) ? w.expr.trim().replace(/\s+/g, " ") : "<schedule>";
      pv.innerHTML = (lab ? `<span class="c-com"># aurora: ${esc(lab)}</span>\n` : "") + `<span class="c-sch">${esc(sched)}</span> ${c ? esc(c) : '<span class="muted">&lt;command&gt;</span>'}`;
      $("#cw-save", cmdCard).disabled = !(w.parsed && !w.parsed.error && c);
    }
    [cmdIn, labelIn].forEach((x) => x.addEventListener("input", renderPreview));
    $("#cw-out", cmdCard).addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      w.output = b.dataset.o;
      cmdCard.querySelectorAll("#cw-out button").forEach((x) => x.classList.toggle("active", x === b));
      renderPreview();
    });
    cmdCard.querySelector(".cw-templates").addEventListener("click", (e) => {
      const b = e.target.closest(".cw-tpl"); if (!b) return;
      const t = CRON_TEMPLATES[+b.dataset.t];
      cmdIn.value = t.cmd; labelIn.value = t.label; w.expr = t.sched; update();
      cmdIn.focus();
    });
    function splitOutput(cmd) {
      let m;
      if ((m = cmd.match(/^(.*?)\s*>\s*\/dev\/null\s+2>&1\s*$/))) return { cmd: m[1], output: "null" };
      if ((m = cmd.match(/^(.*?)\s*>>\s*\/var\/log\/aurora-cron-[\w-]+\.log\s+2>&1\s*$/))) return { cmd: m[1], output: "log" };
      return { cmd, output: "keep" };
    }
    function loadIntoWizard(j, asCopy) {
      const so = splitOutput(j.command);
      cmdIn.value = so.cmd.replace(/\\%/g, "%");
      labelIn.value = (j.label || "") + (asCopy && j.label ? " (copy)" : "");
      w.output = so.output;
      cmdCard.querySelectorAll("#cw-out button").forEach((x) => x.classList.toggle("active", x.dataset.o === so.output));
      w.expr = j.schedule; update();
      w.editing = asCopy ? null : j;
      $("#cw-cmd-h", cmdCard).textContent = w.editing ? "Editing job" : "What should it run?";
      $("#cw-save span", cmdCard).textContent = w.editing ? "Save changes" : "Schedule job";
      $("#cw-cancel", cmdCard).hidden = !w.editing;
      cmdCard.classList.toggle("editing", !!w.editing);
      hero.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    function resetWizard() {
      w.editing = null; cmdIn.value = ""; labelIn.value = "";
      $("#cw-cmd-h", cmdCard).textContent = "What should it run?";
      $("#cw-save span", cmdCard).textContent = "Schedule job";
      $("#cw-cancel", cmdCard).hidden = true; cmdCard.classList.remove("editing");
      renderPreview();
    }
    $("#cw-cancel", cmdCard).addEventListener("click", resetWizard);
    $("#cw-save", cmdCard).addEventListener("click", async () => {
      const schedule = w.expr.trim().replace(/\s+/g, " "), command = finalCommand(), label = labelIn.value.trim() || null;
      if (!w.parsed || w.parsed.error || !command) return;
      try {
        if (w.editing) { await API.cronUpdate({ raw: w.editing.raw, schedule, command, label, paused: w.editing.paused }); toast("Job updated", "good"); }
        else { await API.cronAdd(schedule, command, label); toast("Job scheduled", "good"); }
        resetWizard(); load();
      } catch (e) { toast(e.message, "bad"); }
    });

    // ---------- job list ----------
    async function runNow(j) {
      if (!confirmInline(`Run this job now as root?\n\n${j.command}`)) return;
      try {
        const r = await API.cronRun(j.raw);
        const pre = el("pre", { class: "log", text: "Starting…" });
        const status = el("div", { class: "cw-runstate" }, [el("span", { class: "pill dim", text: "running" })]);
        openModal(`Run now — ${j.label || j.command.split(/\s+/)[0]}`, el("div", {}, [status, pre]), []);
        const tick = async () => {
          if (!$("#modal")) { clearInterval(t); return; }
          try {
            const s = await API.job(r.job_id);
            pre.textContent = s.output || "(no output)";
            pre.scrollTop = pre.scrollHeight;
            if (s.status !== "running") {
              clearInterval(t);
              status.innerHTML = "";
              status.append(el("span", { class: `pill ${s.status === "done" ? "good" : "bad"}`, text: `${s.status} · exit ${s.returncode}` }),
                el("span", { class: "muted", text: ` ${((s.finished - s.started)).toFixed(1)}s` }));
            }
          } catch (e) { clearInterval(t); }
        };
        const t = setInterval(tick, 1000); tick();
      } catch (e) { toast(e.message, "bad"); }
    }
    function renderList(data) {
      listWrap.innerHTML = ""; upcoming.innerHTML = "";
      if (data.tz) { cronState.tz = data.tz; }
      if (data.utc_offset_min != null) cronState.offMin = data.utc_offset_min;
      $("#cw-tz", hero).textContent = `Pi time · ${cronFmt(new Date(cronNow()), { hour: "2-digit", minute: "2-digit", hour12: false })}${cronState.tz ? " " + cronState.tz : ""}`;
      update(true);
      if (!data.supported) { listWrap.append(el("p", { class: "empty", text: "cron is not available on this host." })); return; }
      const jobs = data.jobs;
      $("#cw-count").textContent = `Scheduled jobs · ${jobs.length}`;
      if (!jobs.length) {
        listWrap.append(el("div", { class: "cw-empty" }, [icon("cron", 28), el("b", { text: "No jobs scheduled yet" }), el("span", { class: "muted", text: "Pick a template above, or build a schedule and add your command." })]));
        return;
      }
      const now = cronNow();
      const up = [];
      const rows = jobs.map((j) => {
        const p = cronParse(j.schedule), nx = j.paused ? [] : cronNext(p, now, 3);
        nx.forEach((d) => up.push({ d, j }));
        const name = j.label || j.command.split(/\s+/)[0].split("/").pop();
        const row = el("div", { class: `cw-job ${j.paused ? "paused" : ""}` });
        row.innerHTML = `
          <div class="cw-job-ico">${I(j.paused ? "cron" : "cron", 18)}</div>
          <div class="cw-job-main">
            <div class="cw-job-t"><b>${esc(name)}</b>${j.paused ? '<span class="pill warn">paused</span>' : ""}<code class="cw-expr-pill">${esc(j.schedule)}</code></div>
            <div class="cw-job-d">${esc(cronDescribe(p) || p.error || "")}${nx.length ? ` <span class="cw-job-n">· next ${esc(cronFmt(nx[0], { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }))} (${cronRel(nx[0] - now)})</span>` : ""}</div>
            <div class="cw-job-c">${esc(j.command)}</div>
          </div>
          <div class="cw-job-a"></div>`;
        const a = row.querySelector(".cw-job-a");
        const act = (ic, title, fn, cls) => a.append(el("button", { class: `rbtn cw-rb ${cls || ""}`, title, onclick: fn }, icon(ic, 14)));
        act("chevron", "Run now", () => runNow(j), "go");
        act(j.paused ? "refresh" : "ban", j.paused ? "Resume" : "Pause", async () => {
          try { await API.cronPause(j.raw, !j.paused); toast(j.paused ? "Resumed" : "Paused", "good"); load(); } catch (e) { toast(e.message, "bad"); }
        });
        act("indexes", "Edit", () => loadIntoWizard(j));
        act("backup", "Duplicate", () => loadIntoWizard(j, true));
        act("error", "Delete", async () => {
          if (!confirmInline(`Delete "${name}"?`)) return;
          try { await API.cronDelete(j.raw); toast("Deleted", "good"); if (w.editing && w.editing.raw === j.raw) resetWizard(); load(); } catch (e) { toast(e.message, "bad"); }
        }, "bad");
        return row;
      });
      up.sort((x, y) => x.d - y.d);
      if (up.length) {
        upcoming.append(el("div", { class: "cw-up-h", text: "Coming up" }));
        const strip = el("div", { class: "cw-up-strip" });
        up.slice(0, 6).forEach(({ d, j }) => {
          strip.append(el("div", { class: "cw-up" }, [
            el("span", { class: "cw-up-when", text: cronFmt(d, { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }) }),
            el("b", { text: j.label || j.command.split(/\s+/)[0].split("/").pop() }),
            el("span", { class: "muted", text: cronRel(d - now) }),
          ]));
        });
        upcoming.append(strip);
      }
      listWrap.append(el("div", { class: "cw-jobs" }, rows));
    }
    const load = async () => {
      await guardedLoad(async () => {
        let data;
        try { data = await API.cronList(); }
        catch (e) { listWrap.innerHTML = ""; listWrap.append(el("p", { class: "empty", text: e.message })); return; }
        renderList(data);
      });
    };

    renderLegend();
    renderBuilder();
    w.expr = "5 4 * * *"; update();
    state.refreshHandler = load;
    load();
    const t = setInterval(() => { if (document.activeElement !== exprIn) update(true); }, 30000);
    (state.cleanups = state.cleanups || []).push(() => clearInterval(t));
  }

  // ======================================================================
  //  Disk usage
  // ======================================================================
  const duState = { path: "/" };
  function viewDisk(root) {
    const crumb = el("div", { class: "breadcrumb", id: "du-crumb" });
    const bar = el("div", { class: "toolbar" }, [
      el("button", { class: "btn btn-sm", id: "du-up", text: "↑ Up" }),
      el("input", { id: "du-path", type: "text", style: "flex:1;min-width:220px", placeholder: "/absolute/path" }),
      el("button", { class: "btn btn-sm", text: "Go", onclick: () => duLoad($("#du-path").value.trim() || "/") }),
    ]);
    const body = el("div", { id: "du-body" }, el("div", { class: "loading", text: "Scanning…" }));
    root.append(bar, crumb, body);
    $("#du-up").addEventListener("click", () => { if (duState.parent) duLoad(duState.parent); });
    state.refreshHandler = () => duLoad(duState.path);
    duLoad(duState.path);
  }
  async function duLoad(path) {
    await guardedLoad(async () => {
      const body = $("#du-body"); body.innerHTML = '<div class="loading">Scanning…</div>';
      let data;
      try { data = await API.diskUsage(path); }
      catch (e) { body.innerHTML = ""; body.append(el("p", { class: "empty", text: e.message })); return; }
      duState.path = data.path; duState.parent = data.parent;
      $("#du-path").value = data.path;
      $("#du-crumb").innerHTML = `<b>${esc(data.path)}</b> — total ${esc(fmtBytes(data.total))}`;
      $("#du-up").disabled = !data.parent;
      body.innerHTML = "";
      if (!data.entries.length) { body.append(el("p", { class: "empty", text: "Empty." })); return; }
      const max = data.entries[0].size || 1;
      const rows = data.entries.map((e) => el("tr", {}, [
        el("td", {}, el("span", { class: `fm-name ${e.is_dir ? "dir" : ""}`, onclick: () => e.is_dir && duLoad(e.path) }, [
          el("span", { class: "fm-ico", text: e.is_dir ? "🗀" : "🗎" }), e.name])),
        el("td", { text: fmtBytes(e.size) }),
        el("td", {}, el("div", { class: "meter", style: "width:160px;margin:0" }, el("span", { style: `width:${(e.size / max * 100).toFixed(1)}%` }))),
      ]));
      body.append(el("div", { class: "table-wrap" }, el("table", {}, [
        el("thead", {}, el("tr", {}, ["Name", "Size", ""].map((h) => el("th", { text: h })))),
        el("tbody", {}, rows),
      ])));
    });
  }

  // ======================================================================
  //  Backups
  // ======================================================================
  function viewBackups(root) {
    const form = el("div", { class: "card", style: "margin-bottom:16px" }, [
      el("h3", { text: "Create backup" }),
      el("div", { class: "toolbar" }, [
        el("input", { id: "bk-src", type: "text", placeholder: `${sysHome()}  (absolute path to archive)`, style: "flex:1;min-width:240px" }),
        el("input", { id: "bk-label", type: "text", placeholder: "label (optional)", style: "max-width:180px" }),
        el("button", { class: "btn btn-sm btn-primary", text: "Create", onclick: createBackup }),
      ]),
    ]);
    const body = el("div", { id: "bk-body" }, el("div", { class: "loading", text: "Loading…" }));
    root.append(form, body);
    const jp = jobPanel(root);

    const load = async () => {
      await guardedLoad(async () => {
        const data = await API.backups();
        body.innerHTML = "";
        body.append(el("p", { class: "muted", style: "margin:0 0 10px", text: `Stored in ${data.dir}` }));
        if (!data.backups.length) { body.append(el("p", { class: "empty", text: "No backups yet." })); return; }
        const rows = data.backups.map((b) => el("tr", {}, [
          el("td", { text: b.name }), el("td", { text: fmtBytes(b.size) }),
          el("td", { class: "muted", text: new Date(b.modified * 1000).toLocaleString() }),
          el("td", { class: "actions" }, [
            el("a", { class: "btn btn-sm btn-ghost", href: API.backupDownloadUrl(b.name), text: "↓" }),
            el("button", { class: "btn btn-sm", text: "Restore", onclick: () => restoreBackup(b.name) }),
            el("button", { class: "btn btn-sm btn-danger", text: "✕", onclick: async () => {
              if (!confirmInline(`Delete backup ${b.name}?`)) return;
              try { await API.backupDelete(b.name); toast("Deleted", "good"); load(); } catch (e) { toast(e.message, "bad"); } } }),
          ]),
        ]));
        body.append(el("div", { class: "table-wrap" }, el("table", {}, [
          el("thead", {}, el("tr", {}, ["Backup", "Size", "Created", ""].map((h) => el("th", { text: h })))),
          el("tbody", {}, rows),
        ])));
      });
    };
    async function createBackup() {
      const source = $("#bk-src").value.trim(), label = $("#bk-label").value.trim();
      if (!source) { toast("Source path required", "bad"); return; }
      try { const r = await API.backupCreate(source, label); jp.run(r.job, "Creating backup"); setTimeout(load, 1500); }
      catch (err) { toast(err.message, "bad"); }
    }
    async function restoreBackup(name) {
      const dest = promptInline("Restore to which directory? (archive recreates its original folder inside this)", "/");
      if (dest === null) return;
      if (!confirmInline(`Restore ${name} into ${dest}? Existing files may be overwritten.`)) return;
      try { const r = await API.backupRestore(name, dest || "/"); jp.run(r.job, "Restoring backup"); }
      catch (err) { toast(err.message, "bad"); }
    }
    state.refreshHandler = load;
    load();
  }

  // ======================================================================
  //  Files: Backup Wizard (files + databases in one archive, selective restore)
  // ======================================================================
  function viewBackupWizard(root) {
    const body = el("div", {}, el("div", { class: "loading", text: "Loading…" }));
    root.append(body);
    const jp = jobPanel(root);
    state.cleanups.push(jp.stop);
    const cb = (checked) => { const c = el("input", { type: "checkbox" }); c.checked = !!checked; return c; };
    const load = () => guardedLoad(async () => {
      const o = await API.backupWizard();
      const list = await API.backups();
      body.innerHTML = "";
      subTabs(body, [["backup", "1 · Back up"], ["restore", "2 · Restore"]], (tab, pane) => tab === "backup" ? backupPane(pane) : restorePane(pane));

      function backupPane(pane) {
        let kind = "full";
        const seg = el("div", { class: "cw-seg" }, [["full", "Full backup"], ["files", "Website & home files"], ["databases", "Databases"], ["custom", "Custom"]].map(([k, l]) =>
          el("button", { type: "button", class: k === kind ? "active" : "", text: l, onclick: (e) => { kind = k; seg.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === e.target)); draw(); } })));
        const opts = el("div");
        const label = el("input", { type: "text", placeholder: "optional name, e.g. before-update", maxlength: 60 });
        const picks = { paths: {}, mysql: {}, pgsql: {} };
        const extra = el("input", { type: "text", placeholder: "/srv/data  /etc/nginx   (space separated, optional)" });
        function group(title, items, bucket, preset) {
          if (!items.length) return null;
          return el("div", { class: "bw-group" }, [el("h4", { text: title }), ...items.map((it) => {
            const c = cb(preset); picks[bucket][it] = c;
            return el("label", { class: "dm-check" }, [c, el("code", { class: "net-mono", text: it })]);
          })]);
        }
        function draw() {
          opts.innerHTML = ""; picks.paths = {}; picks.mysql = {}; picks.pgsql = {};
          const fileItems = [o.web_root, o.home].filter(Boolean);
          if (kind === "full") {
            opts.append(el("p", { class: "muted", text: "Everything needed to rebuild this Pi's sites: your home folder, the web root, all databases and the server configuration (Apache/PHP/MariaDB/VPN/FTP/fail2ban/panel settings)." }),
              kv([["Folders", [...fileItems, ...o.configs].join(", ")], ["MariaDB databases", o.mysql.join(", ") || "none"], ["PostgreSQL databases", o.pgsql.join(", ") || "none"]]),
              el("p", { class: "dm-hint", text: "The archive contains private keys and password hashes (VPN, FTP) — keep downloads somewhere safe." }));
          } else {
            // append() would render a null as the text "null" — drop empty/hidden groups.
            const add = (...nodes) => opts.append(...nodes.filter(Boolean));
            if (kind === "files" || kind === "custom") add(group("Folders", fileItems, "paths", kind === "files"), kind === "custom" ? group("Server configuration", o.configs, "paths", false) : null);
            if (kind === "databases" || kind === "custom") add(group("MariaDB / MySQL databases", o.mysql, "mysql", kind === "databases"), group("PostgreSQL databases", o.pgsql, "pgsql", kind === "databases"));
            if (kind === "custom") opts.append(field("Other folders / files", extra));
          }
        }
        draw();
        const go = btn("Create backup", async () => {
          const sel = (b) => Object.entries(picks[b]).filter(([, c]) => c.checked).map(([k]) => k);
          const body2 = { kind, label: label.value.trim(), paths: sel("paths").concat(kind === "custom" ? extra.value.split(/\s+/).filter(Boolean) : []), mysql: sel("mysql"), pgsql: sel("pgsql") };
          go.disabled = true;
          try { const r = await API.backupWizardCreate(body2); watchJob(jp, r.job, "Creating backup", () => { go.disabled = false; load(); }); }
          catch (e) { toast(e.message, "bad"); go.disabled = false; }
        }, "btn-primary");
        pane.append(el("div", { class: "card" }, [el("h3", { text: "What should be backed up?" }), seg, opts,
          el("div", { class: "net-form" }, [field("Name", label)]), el("div", { style: "margin-top:14px" }, go),
          el("p", { class: "dm-hint", text: `Archives are stored in ${o.dir} and can be downloaded from the Restore tab or the Backup page. Tip: schedule this with Cron Jobs for automatic backups.` })]));
      }

      function restorePane(pane) {
        if (!list.backups.length) { pane.append(el("p", { class: "empty", text: "No backups yet — create one first." })); return; }
        const sel = el("select", {}, list.backups.map((b) => el("option", { value: b.name, text: `${b.name} — ${fmtBytes(b.size)} — ${new Date(b.modified * 1000).toLocaleString()}` })));
        const detail = el("div");
        const show = async () => {
          detail.innerHTML = ""; detail.append(el("div", { class: "loading", text: "Reading backup…" }));
          try {
            const m = await API.backupManifest(sel.value);
            detail.innerHTML = "";
            if (!m.wizard) { detail.append(el("p", { class: "muted", text: `This is a simple backup (contains: ${m.top.join(", ") || "?"}). Restore it from the Backup page.` }), btn("Open Backup page", () => navigate("backups"), "btn-ghost")); return; }
            const picks = { paths: {}, mysql: {}, pgsql: {} };
            const grp = (title, items, bucket) => items.length ? el("div", { class: "bw-group" }, [el("h4", { text: title }), ...items.map((it) => { const c = cb(false); picks[bucket][it] = c; return el("label", { class: "dm-check" }, [c, el("code", { class: "net-mono", text: it })]); })]) : null;
            detail.append(kv([["Made", new Date(m.created * 1000).toLocaleString()], ["Type", m.kind], ["On", m.host]]),
              grp("Folders (restored to their original location, overwriting files)", m.paths, "paths"),
              grp("MariaDB databases (tables are replaced)", m.mysql, "mysql"), grp("PostgreSQL databases", m.pgsql, "pgsql"));
            const go = btn("Restore selected", async () => {
              const s = (b) => Object.entries(picks[b]).filter(([, c]) => c.checked).map(([k]) => k);
              const b2 = { name: sel.value, paths: s("paths"), mysql: s("mysql"), pgsql: s("pgsql") };
              if (!b2.paths.length && !b2.mysql.length && !b2.pgsql.length) { toast("Tick what to restore", "bad"); return; }
              if (!confirmInline("Restore now? Current files/data for the selected items will be overwritten.")) return;
              try { const r = await API.backupWizardRestore(b2); watchJob(jp, r.job, "Restoring"); } catch (e) { toast(e.message, "bad"); }
            }, "btn-danger");
            detail.append(el("div", { class: "toolbar", style: "margin:14px 0 0" }, [go, el("a", { class: "btn btn-sm btn-ghost", href: API.backupDownloadUrl(sel.value), text: "Download archive" })]));
          } catch (e) { detail.innerHTML = ""; detail.append(el("p", { class: "empty", text: e.message })); }
        };
        sel.onchange = show;
        pane.append(el("div", { class: "card" }, [el("h3", { text: "Pick a backup" }), sel, detail]));
        show();
      }
    });
    state.refreshHandler = load; load();
  }

  // ======================================================================
  //  Files: Images (thumbnails, scale, convert)
  // ======================================================================
  function viewImages(root) {
    const pathIn = el("input", { type: "text", placeholder: "folder or image inside the web root, e.g. uploads/photos", value: state.viewArg || "" });
    const info = el("div");
    const jp = jobPanel(root);
    state.cleanups.push(jp.stop);
    let current = null;
    const look = async () => {
      info.innerHTML = ""; info.append(el("div", { class: "loading", text: "Reading…" }));
      try {
        const d = await API.imageInfo(pathIn.value.trim());
        info.innerHTML = ""; current = d;
        if (!d.available) { info.append(el("p", { class: "empty", text: "The image library isn't installed on this Pi (pip install Pillow)." })); return; }
        if (d.type === "folder") {
          info.append(el("p", { class: "muted", text: `${d.count} image(s) in /${d.path}` }), d.images.length ? el("div", { class: "net-chips" }, d.images.slice(0, 60).map((i) =>
            el("button", { type: "button", class: "net-chip", text: `${i.name} (${fmtBytes(i.size)})`, onclick: () => { pathIn.value = (d.path ? d.path + "/" : "") + i.name; look(); } }))) : null);
        } else {
          info.append(kv([["Image", "/" + d.path], ["Size", `${d.width} × ${d.height} px`], ["Format", d.format], ["File size", fmtBytes(d.size)]]));
        }
        draw();
      } catch (e) { info.innerHTML = ""; info.append(el("p", { class: "empty", text: e.message })); }
    };
    const tools = el("div");
    function draw() {
      tools.innerHTML = "";
      if (!current || !current.available) return;
      const isDir = current.type === "folder";
      // Scaler
      if (!isDir) {
        const w = el("input", { type: "number", min: 1, placeholder: "width px" }), h = el("input", { type: "number", min: 1, placeholder: "height px" });
        const pct = el("input", { type: "number", min: 1, max: 1000, placeholder: "or %" });
        const aspect = el("input", { type: "checkbox" }); aspect.checked = true;
        const keep = el("input", { type: "checkbox" }); keep.checked = true;
        tools.append(el("div", { class: "card" }, [el("h3", { text: "Scale (resize)" }),
          el("div", { class: "net-form" }, [field("Width", w), field("Height", h), field("Percent", pct)]),
          el("div", { class: "toolbar", style: "margin:10px 0 0" }, [el("label", { class: "dm-check" }, [aspect, el("span", { text: "Keep proportions" })]), el("label", { class: "dm-check" }, [keep, el("span", { text: "Keep a copy of the original" })]),
            btn("Resize", async () => { try { const r = await API.imageScale({ path: current.path, width: +w.value || null, height: +h.value || null, percent: +pct.value || null, keep_aspect: aspect.checked, keep_original: keep.checked }); toast(`Resized ${r.from.join("×")} → ${r.to.join("×")}`, "good"); look(); } catch (e) { toast(e.message, "bad"); } }, "btn-primary")])]));
      }
      // Thumbnailer
      if (isDir) {
        const pct = el("input", { type: "number", min: 1, max: 100, value: 25 }), mx = el("input", { type: "number", min: 16, max: 4000, placeholder: "or max px (e.g. 300)" });
        const rec = el("input", { type: "checkbox" });
        tools.append(el("div", { class: "card" }, [el("h3", { text: "Thumbnailer" }), el("p", { class: "muted", text: "Creates tn_<name> copies in a 'thumbnails' folder next to each image. Originals are untouched." }),
          el("div", { class: "net-form" }, [field("Scale to %", pct), field("Max size (px)", mx)]),
          el("div", { class: "toolbar", style: "margin:10px 0 0" }, [el("label", { class: "dm-check" }, [rec, el("span", { text: "Include sub-folders" })]),
            btn("Make thumbnails", async () => { try { const r = await API.imageThumbs({ path: current.path, percent: +pct.value || null, max_px: +mx.value || null, recursive: rec.checked }); watchJob(jp, r.job, "Thumbnails", look); } catch (e) { toast(e.message, "bad"); } }, "btn-primary")])]));
      }
      // Converter
      const to = el("select", {}, ["webp", "jpg", "png", "gif", "bmp"].map((f) => el("option", { value: f, text: f.toUpperCase() + (f === "webp" ? " (smallest for the web)" : "") })));
      const q = el("input", { type: "number", min: 30, max: 100, value: 85 });
      const del = el("input", { type: "checkbox" });
      tools.append(el("div", { class: "card" }, [el("h3", { text: isDir ? "Convert all images in this folder" : "Convert this image" }),
        el("div", { class: "net-form" }, [field("To format", to), field("Quality (JPG/WebP)", q)]),
        el("div", { class: "toolbar", style: "margin:10px 0 0" }, [el("label", { class: "dm-check" }, [del, el("span", { text: "Delete originals after converting" })]),
          btn("Convert", async () => { if (del.checked && !confirmInline("Delete the original images after converting?")) return; try { const r = await API.imageConvert({ path: current.path, to: to.value, quality: +q.value, delete_original: del.checked }); watchJob(jp, r.job, "Converting", look); } catch (e) { toast(e.message, "bad"); } }, "btn-primary")])]));
    }
    root.prepend(el("div", { class: "card" }, [el("h3", { text: "Pick a folder or an image" }),
      el("div", { class: "toolbar", style: "margin:0" }, [pathIn, btn("Open", look, "btn-primary"), btn("Web root", () => { pathIn.value = ""; look(); }, "btn-ghost")]),
      el("p", { class: "dm-hint", text: "Paths are relative to the File Manager's folder (the web root)." })]), info, tools);
    pathIn.addEventListener("keydown", (e) => { if (e.key === "Enter") look(); });
    look();
  }

  // ======================================================================
  //  Files: Directory Privacy (password-protected folders)
  // ======================================================================
  function viewDirPrivacy(root) {
    const body = el("div", {}, el("div", { class: "loading", text: "Loading…" }));
    root.append(el("p", { class: "muted", style: "margin:0 0 14px", text: "Password-protect folders of your websites. Visitors get a login prompt from the browser; only the users you add here get in." }), body);
    const load = () => guardedLoad(async () => {
      const d = await API.dirPrivacy();
      body.innerHTML = "";
      if (!d.apache) { body.append(el("p", { class: "empty", text: "Directory Privacy needs Apache (System Applications)." })); return; }
      body.append(el("h2", { class: "section-title", text: `Protected folders (${d.folders.length})` }));
      body.append(d.folders.length ? simpleTable(["Folder", "Prompt", "Users", "Status", ""], d.folders.map((f) => row(
        el("span", {}, [el("code", { class: "net-mono", text: f.path }), f.exists ? null : pill("missing", "bad")]), f.label || "—",
        el("div", { class: "net-chips" }, f.users.map((u) => el("button", { type: "button", class: "net-chip", title: "Remove user", text: `${u} ✕`, onclick: async () => {
          if (!confirmInline(`Remove ${u} from ${f.path}?`)) return; try { await API.dirPrivacyUser({ path: f.path, name: u, remove: true }); toast("Removed", "good"); load(); } catch (e) { toast(e.message, "bad"); } } }))),
        pill(f.enabled ? "protected" : "off", f.enabled ? "good" : "dim"),
        el("div", { class: "net-actions" }, [
          btn("Add user", () => userDialog(f.path)),
          btn(f.enabled ? "Turn off" : "Turn on", async () => { try { await API.dirPrivacyToggle(f.path, !f.enabled); load(); } catch (e) { toast(e.message, "bad"); } }, "btn-ghost"),
          btn("Remove", async () => { if (!confirmInline(`Remove protection from ${f.path}? It becomes public again.`)) return; try { await API.dirPrivacyRemove(f.path); toast("Protection removed", "good"); load(); } catch (e) { toast(e.message, "bad"); } }, "btn-danger")]),
      ))) : el("p", { class: "empty", text: "No protected folders yet." }));
      const path = el("input", { type: "text", placeholder: "/var/www/html/private" });
      const label = el("input", { type: "text", placeholder: "e.g. Staff area", maxlength: 60 });
      const user = el("input", { type: "text", placeholder: "username", maxlength: 32, autocomplete: "off" });
      const pw = passwordField();
      body.append(el("div", { class: "card" }, [el("h3", { text: "Protect a folder" }),
        el("div", { class: "net-form" }, [field("Folder", path, "Everything inside it (and sub-folders) needs a login."), field("Login prompt text", label), field("First user", user), field("Password", pw.node, "Leave empty to generate one.")]),
        el("div", { style: "margin-top:12px" }, btn("Protect folder", async () => {
          const password = pw.value() || genPassword();
          try { await API.dirPrivacyProtect({ path: path.value.trim(), label: label.value.trim(), name: user.value.trim(), password }); load(); showPw(user.value.trim(), password); } catch (e) { toast(e.message, "bad"); }
        }, "btn-primary"))]));
    });
    function showPw(user, password) {
      openModal("Folder protected", el("div", {}, [kv([["Username", user]]), el("div", { class: "net-cred" }, [el("span", { class: "net-k", text: "Password" }), el("input", { type: "text", readonly: "readonly", class: "net-mono net-pw-out", value: password }), btn("Copy", async () => toast(await copyText(password) ? "Copied" : "Copy failed", "good"))]),
        el("p", { class: "dm-hint", text: "Browsers send these credentials unencrypted over plain http — use https (SSL/TLS) or the VPN for anything sensitive." })]), []);
    }
    function userDialog(path) {
      const user = el("input", { type: "text", maxlength: 32 }); const pw = passwordField();
      const go = btn("Save", async () => { const password = pw.value() || genPassword(); try { await API.dirPrivacyUser({ path, name: user.value.trim(), password }); closeModal(); load(); showPw(user.value.trim(), password); } catch (e) { toast(e.message, "bad"); } }, "btn-primary");
      openModal(`Add user — ${path}`, el("div", {}, [field("Username (existing = change password)", user), field("Password", pw.node, "Leave empty to generate one.")]), [go]);
    }
    state.refreshHandler = load; load();
  }

  // ======================================================================
  //  Files: Web Disk (WebDAV network drive)
  // ======================================================================
  function viewWebDisk(root) {
    const body = el("div", {}, el("div", { class: "loading", text: "Loading…" }));
    root.append(el("p", { class: "muted", style: "margin:0 0 14px", text: "Web Disk lets you open a folder of this Pi like a drive on your computer or phone (WebDAV) — drag files in and out with Explorer, Finder or the Files app." }), body);
    const url = (n, secure) => `${secure ? "https" : "http"}://${location.hostname}/webdisk/${n}/`;
    let certInfo = null;
    let pageCertSlot = null;
    const load = () => guardedLoad(async () => {
      const d = await API.webdisk();
      try { certInfo = await API.webdiskCert(location.hostname); }
      catch (e) { certInfo = { ready: false, needs_trust: true, names: [], message: e.message, filename: "aurora.crt" }; }
      body.innerHTML = "";
      if (!d.apache) { body.append(el("p", { class: "empty", text: "Web Disk needs Apache (System Applications)." })); return; }
      pageCertSlot = el("div");
      body.append(pageCertSlot);
      paintCert(pageCertSlot, null, null);
      body.append(el("h2", { class: "section-title", text: `Web Disk accounts (${d.accounts.length})` }));
      body.append(d.accounts.length ? simpleTable(["User", "Folder", "Access", "Address", "Status", ""], d.accounts.map((a) => row(
        el("b", { text: a.name }), el("span", {}, [el("code", { class: "net-mono", text: a.path }), a.exists ? null : pill("missing", "bad")]),
        a.readonly ? "Read only" : "Read & write", el("code", { class: "net-mono", text: url(a.name, true) }),
        pill(a.disabled ? "disabled" : "active", a.disabled ? "bad" : "good"),
        el("div", { class: "net-actions" }, [
          btn("Connect…", () => connectHelp(a.name)),
          btn("Password", () => { const pw = passwordField(); openModal(`Password — ${a.name}`, field("New password", pw.node, "Leave empty to generate one."), [btn("Save", async () => { const password = pw.value() || genPassword(); try { await API.webdiskUpdate({ name: a.name, password }); closeModal(); openModal("New password", el("div", { class: "net-cred" }, [el("span", { class: "net-k", text: "Password" }), el("input", { type: "text", readonly: "readonly", class: "net-mono net-pw-out", value: password }), btn("Copy", async () => toast(await copyText(password) ? "Copied" : "Copy failed", "good"))]), []); } catch (e) { toast(e.message, "bad"); } }, "btn-primary")]); }),
          btn(a.readonly ? "Allow writing" : "Make read-only", async () => { try { await API.webdiskUpdate({ name: a.name, readonly: !a.readonly }); load(); } catch (e) { toast(e.message, "bad"); } }, "btn-ghost"),
          btn(a.disabled ? "Enable" : "Disable", async () => { try { await API.webdiskUpdate({ name: a.name, disabled: !a.disabled }); load(); } catch (e) { toast(e.message, "bad"); } }, "btn-ghost"),
          btn("Delete", async () => { if (!confirmInline(`Delete Web Disk account ${a.name}? Files are kept.`)) return; try { await API.webdiskDelete(a.name); toast("Deleted", "good"); load(); } catch (e) { toast(e.message, "bad"); } }, "btn-danger")]),
      ))) : el("p", { class: "empty", text: "No Web Disk accounts yet." }));
      const name = el("input", { type: "text", maxlength: 32, placeholder: "e.g. laptop", autocomplete: "off" });
      const pw = passwordField();
      const folder = el("input", { type: "text", value: "/var/www/html" });
      const ro = el("input", { type: "checkbox" });
      body.append(el("div", { class: "card" }, [el("h3", { text: "Create a Web Disk account" }),
        el("div", { class: "net-form" }, [field("Username", name), field("Password", pw.node, "Leave empty to generate one."), field("Folder", folder, "Created if it doesn't exist.")]),
        el("div", { class: "toolbar", style: "margin:10px 0 0" }, [el("label", { class: "dm-check" }, [ro, el("span", { text: "Read only" })]),
          btn("Create", async () => { const password = pw.value() || genPassword(); try { const r = await API.webdiskCreate({ name: name.value.trim(), password, path: folder.value.trim(), readonly: ro.checked }); load(); connectHelp(r.name, password); } catch (e) { toast(e.message, "bad"); } }, "btn-primary")]),
        el("p", { class: "dm-hint", text: "Scripts are never run from the Web Disk — PHP and other files are always transferred as files." })]));
    });
    function connectHelp(n, password) {
      const secure = url(n, true), plain = url(n, false);
      const certSlot = el("div");
      openModal(`Connect to Web Disk — ${n}`, el("div", {}, [
        kv([["Address (https)", el("code", { class: "net-mono", text: secure })], ["Address (http, LAN only)", el("code", { class: "net-mono", text: plain })], ["Username", n]]),
        password ? el("div", { class: "net-cred" }, [el("span", { class: "net-k", text: "Password" }), el("input", { type: "text", readonly: "readonly", class: "net-mono net-pw-out", value: password }), btn("Copy", async () => toast(await copyText(password) ? "Copied" : "Copy failed", "good"))]) : null,
        el("div", { class: "net-os" }, [el("h4", { text: "Windows" }), el("p", { class: "muted", text: "File Explorer → This PC → Map network drive → Folder: the https address → tick 'Connect using different credentials'. Windows only sends the password over https, and only after the certificate below is trusted." }), certSlot]),
        el("div", { class: "net-os" }, [el("h4", { text: "macOS" }), el("p", { class: "muted", text: `Finder → Go → Connect to Server (⌘K) → ${secure}` })]),
        el("div", { class: "net-os" }, [el("h4", { text: "Linux" }), el("p", { class: "muted", text: `Files → Other Locations → Connect to Server → davs://${location.hostname}/webdisk/${n}/` })]),
        el("div", { class: "net-os" }, [el("h4", { text: "iPhone / Android" }), el("p", { class: "muted", text: "Any WebDAV app (e.g. Documents, Solid Explorer, Cx File Explorer) with the address above." })]),
        el("p", { class: "dm-hint", text: "From outside your home network, connect through the VPN rather than opening port 80/443 for this." }),
      ]), []);
      paintCert(certSlot, n, secure);
    }
    function paintCert(slot, account, secure) {
      slot.replaceChildren();
      const info = certInfo;
      if (!info) { slot.append(el("p", { class: "muted", text: "Checking the certificate…" })); return; }
      const lines = [];
      if (info.ready && info.needs_trust) {
        lines.push(
          "# PowerShell as Administrator. The file is saved to Downloads.",
          `Import-Certificate -FilePath "$env:USERPROFILE\\Downloads\\${info.filename}" -CertStoreLocation Cert:\\LocalMachine\\Root`,
          "Restart-Service WebClient");
        if (account) lines.push(`net use W: ${secure} /user:${account} *`);
      } else if (account && info.ready) {
        lines.push(`net use W: ${secure} /user:${account} *`);
      }
      slot.append(el("div", { class: "net-note" }, [
        el("p", { text: info.message || "Certificate" }),
        info.names && info.names.length ? el("p", { class: "dm-hint", text: "Issued for " + info.names.join(", ") }) : null,
        el("div", { class: "toolbar" }, [
          btn(info.ready ? "Download certificate" : "Create and download certificate", () => downloadCert(slot, account, secure), "btn-primary"),
        ]),
        lines.length ? el("pre", { class: "log", text: lines.join("\n") }) : null,
      ]));
    }
    async function downloadCert(slot, account, secure) {
      try {
        let info = certInfo;
        const fresh = !info || !info.ready || !info.pem;
        if (fresh) {
          info = await API.webdiskCertCreate(location.hostname);
          certInfo = info;
          paintCert(slot, account, secure);
          if (pageCertSlot && pageCertSlot !== slot && pageCertSlot.isConnected) paintCert(pageCertSlot, null, null);
        }
        if (!info.pem) throw new Error("The certificate has no public file to download");
        downloadText(info.filename || "aurora.crt", info.pem, "application/x-x509-ca-cert");
        toast(fresh && info.generated ? "Certificate created and downloaded" : "Certificate downloaded", "good");
      } catch (e) { toast(e.message, "bad"); }
    }
    state.refreshHandler = load; load();
  }

  // ======================================================================
  //  Files: Git Version Control
  // ======================================================================
  function viewGit(root) {
    const body = el("div", {}, el("div", { class: "loading", text: "Loading…" }));
    root.append(body);
    const jp = jobPanel(root);
    state.cleanups.push(jp.stop);
    const load = () => guardedLoad(async () => {
      const d = await API.git();
      body.innerHTML = "";
      if (!d.git) { body.append(el("p", { class: "empty", text: "git is not installed (Packages → git)." })); return; }
      body.append(el("h2", { class: "section-title", text: `Repositories (${d.repos.length})` }));
      body.append(d.repos.length ? simpleTable(["Repository", "Branch", "Last commit", "Remote", "Deploys to", ""], d.repos.map((r) => row(
        el("div", {}, [el("b", { text: r.name }), el("div", { class: "dm-hint", text: `${r.path} · owner ${r.owner}` })]),
        r.exists ? el("span", {}, [el("code", { text: r.branch || "—" }), r.dirty ? pill(`${r.dirty} changed`, "warn") : null]) : pill("missing", "bad"),
        r.last ? el("div", {}, [el("span", { text: r.last.subject }), el("div", { class: "dm-hint", text: `${r.last.hash} · ${r.last.author} · ${ago(r.last.time)}` })]) : "—",
        r.remote || "—", r.deploy_path || "—",
        el("div", { class: "net-actions" }, [
          r.remote ? btn("Pull", async () => { try { const j = await API.gitPull(r.name); watchJob(jp, j.job, `Pull ${r.name}`, load); } catch (e) { toast(e.message, "bad"); } }) : null,
          btn("Deploy", async () => { try { const j = await API.gitDeploy(r.name); watchJob(jp, j.job, `Deploy ${r.name}`, load); } catch (e) { toast(e.message, "bad"); } }, "btn-primary"),
          btn("Manage", () => manage(r)),
          btn("Remove", async () => { const del = confirmInline(`Remove ${r.name} from the list?\n\nOK = also DELETE the folder ${r.path}\nCancel = keep the files`); try { await API.gitRemove(r.name, del); toast("Removed", "good"); load(); } catch (e) { toast(e.message, "bad"); } }, "btn-danger")]),
      ))) : el("p", { class: "empty", text: "No repositories yet." }));
      // create / clone
      const name = el("input", { type: "text", placeholder: "e.g. my-site", maxlength: 64 });
      const url = el("input", { type: "text", placeholder: "https://github.com/me/my-site.git  (empty = new empty repo)" });
      const branch = el("input", { type: "text", placeholder: "default branch" });
      const owner = el("input", { type: "text", value: sysUser() });
      const path = el("input", { type: "text", placeholder: `${sysHome()}/repositories/my-site` });
      const priv = el("input", { type: "checkbox" });
      name.addEventListener("input", () => { path.placeholder = `${sysHome()}/repositories/${name.value.trim() || "my-site"}`; });
      const keyBox = el("div");
      priv.addEventListener("change", async () => {
        keyBox.innerHTML = "";
        if (!priv.checked) return;
        if (!name.value.trim()) { toast("Enter a name first", "bad"); priv.checked = false; return; }
        try { const k = await API.gitKey(name.value.trim(), owner.value.trim()); keyBox.append(el("p", { class: "muted", text: "Add this deploy key to the repository (GitHub: Settings → Deploy keys → Add; GitLab: Settings → Repository → Deploy keys), then use the SSH clone URL (git@github.com:me/site.git)." }), el("pre", { class: "log", text: k.public_key }), btn("Copy key", async () => toast(await copyText(k.public_key) ? "Copied" : "Copy failed", "good"))); }
        catch (e) { toast(e.message, "bad"); priv.checked = false; }
      });
      body.append(el("div", { class: "card" }, [el("h3", { text: "Create or clone a repository" }),
        el("div", { class: "net-form" }, [field("Name", name), field("Clone URL", url), field("Branch", branch), field("Owner (Linux user)", owner), field("Folder", path)]),
        el("label", { class: "dm-check", style: "margin-top:10px" }, [priv, el("span", { text: "Private repository — create a deploy key (SSH)" })]), keyBox,
        el("div", { style: "margin-top:12px" }, btn("Create", async () => {
          const p = path.value.trim() || path.placeholder;
          try { const j = await API.gitCreate({ name: name.value.trim(), path: p, owner: owner.value.trim(), clone_url: url.value.trim() || null, branch: branch.value.trim() || null, use_key: priv.checked }); watchJob(jp, j.job, `Creating ${name.value.trim()}`, load); }
          catch (e) { toast(e.message, "bad"); }
        }, "btn-primary"))]));
    });
    async function manage(r) {
      let d;
      try { d = await API.gitDetails(r.name); } catch (e) { toast(e.message, "bad"); return; }
      const br = el("select", {}, d.branches.map((b) => el("option", { value: b, text: b }))); br.value = r.branch;
      const dp = el("input", { type: "text", value: d.deploy_path, placeholder: "/var/www/html/my-site (optional)" });
      const dc = el("input", { type: "text", value: d.deploy_cmd, placeholder: "e.g. npm ci && npm run build (optional)" });
      openModal(`Repository — ${r.name}`, el("div", {}, [
        el("h4", { text: "Branch" }), el("div", { class: "toolbar" }, [br, btn("Switch", async () => { try { await API.gitCheckout(r.name, br.value); toast(`Now on ${br.value}`, "good"); closeModal(); load(); } catch (e) { toast(e.message, "bad"); } })]),
        el("h4", { text: "Deployment" }), el("p", { class: "dm-hint", text: "Deploy = pull, then copy the files (without .git) to the folder below and/or run the command, as the repository owner." }),
        el("div", { class: "net-form" }, [field("Copy to folder", dp), field("Then run", dc)]),
        el("div", { style: "margin:10px 0 16px" }, btn("Save deployment", async () => { try { await API.gitDeploySettings(r.name, dp.value.trim(), dc.value.trim()); toast("Saved", "good"); closeModal(); load(); } catch (e) { toast(e.message, "bad"); } }, "btn-primary")),
        d.public_key ? el("div", {}, [el("h4", { text: "Deploy key" }), el("pre", { class: "log", text: d.public_key })]) : null,
        d.status.length ? el("div", {}, [el("h4", { text: `Uncommitted changes (${d.status.length})` }), el("pre", { class: "log", text: d.status.join("\n") })]) : null,
        el("h4", { text: "History" }), simpleTable(["Commit", "Message", "Author", "When"], d.log.map((c) => row(el("code", { text: c.hash }), c.subject, c.author, ago(c.time)))),
      ]), []);
    }
    state.refreshHandler = load; load();
  }

  // ======================================================================
  //  Files: Inodes Usage
  // ======================================================================
  function viewInodes(root) {
    const body = el("div", {}, el("div", { class: "loading", text: "Loading…" }));
    root.append(el("p", { class: "muted", style: "margin:0 0 14px", text: "Every file and folder uses one inode. A disk can run out of inodes (\"no space left\") even with free gigabytes — typically from millions of tiny cache or session files. Drill down to find them." }), body);
    const go = (path) => guardedLoad(async () => {
      body.innerHTML = ""; body.append(el("div", { class: "loading", text: `Counting ${path}…` }));
      const d = await API.inodes(path);
      setViewArg(path === "/" ? null : path, true);
      body.innerHTML = "";
      if (d.filesystem) {
        const f = d.filesystem;
        body.append(el("div", { class: "card" }, [el("h3", { text: `Filesystem ${f.mount}` }),
          kv([["Inodes used", `${f.used.toLocaleString()} of ${f.total.toLocaleString()} (${f.percent}%)`], ["Free", f.free.toLocaleString()]]),
          el("div", { class: `meter ${meterClass(f.percent)}`, style: "margin-top:10px" }, el("span", { style: `width:${Math.max(1, f.percent)}%` }))]));
      }
      const max = Math.max(1, ...d.entries.map((e) => e.inodes));
      body.append(el("div", { class: "toolbar" }, [el("code", { class: "net-mono", text: d.path }), d.parent ? btn("↑ Up", () => go(d.parent), "btn-ghost") : null, el("span", { class: "muted", text: `${d.total.toLocaleString()} inodes below` })]),
        simpleTable(["Name", "Inodes", ""], d.entries.map((e) => row(
          e.is_dir ? el("button", { type: "button", class: "linklike", text: `📁 ${e.name}`, onclick: () => go(e.path) }) : el("span", { text: e.name }),
          e.inodes.toLocaleString(),
          el("div", { class: "meter", style: "min-width:120px;margin-top:0" }, el("span", { style: `width:${Math.max(1, Math.round(e.inodes / max * 100))}%` }))))));
    });
    state.refreshHandler = () => go(state.viewArg || "/");
    go(state.viewArg || "/");
  }

  // ======================================================================
  //  Firewall (ufw)
  // ======================================================================
  function viewFirewall(root) {
    const body = el("div", { id: "fw-body" }, el("div", { class: "loading", text: "Loading…" }));
    root.append(body);
    const load = async () => {
      await guardedLoad(async () => {
        const data = await API.firewall();
        body.innerHTML = "";
        if (!data.available) {
          body.append(el("p", { class: "empty", text: "ufw is not installed. Install it from the Packages section to manage the firewall." }));
          return;
        }
        const head = el("div", { class: "card", style: "margin-bottom:16px" }, [
          el("h3", { text: "Firewall status" }),
          el("div", { style: "display:flex;align-items:center;gap:14px" }, [
            el("span", { class: `pill ${data.active ? "good" : "dim"}`, text: data.active ? "active" : "inactive" }),
            el("button", { class: "btn btn-sm", text: data.active ? "Disable" : "Enable",
              onclick: async () => {
                const msg = data.active ? "Disable the firewall?"
                  : `Enable the firewall?\n\nSSH (22) and the panel (${location.port || (location.protocol === "https:" ? 443 : 80)}) will be auto-allowed first so you won't be locked out.`;
                if (!confirmInline(msg)) return;
                try { const r = await API.firewallToggle(!data.active);
                  toast(!data.active && r.preallowed ? `Firewall on — allowed ${r.preallowed.join(", ")}` : "Done", "good"); load(); }
                catch (e) { toast(e.message, "bad"); } } }),
          ]),
          data.active ? null : el("p", { class: "muted", style: "margin:10px 0 0;font-size:12px",
            text: "Safeguard: enabling here always allows SSH (22) + the panel port first — you can't lock yourself out via the panel." }),
        ]);
        const addForm = el("div", { class: "card", style: "margin-bottom:16px" }, [
          el("h3", { text: "Add rule" }),
          el("div", { class: "toolbar" }, [
            el("select", { id: "fw-action", style: "max-width:120px" }, ["allow", "deny", "reject", "limit"].map((a) => el("option", { value: a, text: a }))),
            el("input", { id: "fw-port", type: "text", placeholder: "port (e.g. 22)", style: "max-width:140px" }),
            el("select", { id: "fw-proto", style: "max-width:100px" }, ["tcp", "udp"].map((p) => el("option", { value: p, text: p }))),
            el("button", { class: "btn btn-sm btn-primary", text: "Add", onclick: async () => {
              try { await API.firewallRule($("#fw-action").value, $("#fw-port").value.trim(), $("#fw-proto").value);
                toast("Rule added", "good"); load(); } catch (e) { toast(e.message, "bad"); } } }),
          ]),
        ]);
        const rulesWrap = el("div", { class: "card" }, [el("h3", { text: "Rules" })]);
        if (!data.rules.length) { rulesWrap.append(el("p", { class: "muted", text: "No rules." })); }
        else {
          const rows = data.rules.map((r) => el("tr", {}, [
            el("td", { class: "muted", text: r.num }), el("td", { text: r.rule }),
            el("td", { class: "actions" }, el("button", { class: "btn btn-sm btn-danger", text: "Delete",
              onclick: async () => { if (!confirmInline(`Delete rule [${r.num}] ${r.rule}?`)) return;
                try { await API.firewallDelete(r.num); toast("Deleted", "good"); load(); } catch (e) { toast(e.message, "bad"); } } })),
          ]));
          rulesWrap.append(el("div", { class: "table-wrap" }, el("table", {}, [
            el("thead", {}, el("tr", {}, ["#", "Rule", ""].map((h) => el("th", { text: h })))),
            el("tbody", {}, rows),
          ])));
        }
        body.append(head, addForm, rulesWrap);
      });
    };
    state.refreshHandler = load;
    load();
  }

  // ======================================================================
  //  Users
  // ======================================================================
  function viewUsers(root) {
    const bar = el("div", { class: "toolbar" }, [
      el("input", { id: "u-name", type: "text", placeholder: "new username", style: "max-width:180px" }),
      el("select", { id: "u-shell", style: "max-width:170px" }, ["/bin/bash", "/bin/sh", "/usr/sbin/nologin", "/bin/false"].map((s) => el("option", { value: s, text: s }))),
      el("label", { class: "muted", style: "display:flex;align-items:center;gap:6px" }, [el("input", { id: "u-home", type: "checkbox", checked: "checked", style: "width:auto" }), "create home"]),
      el("button", { class: "btn btn-sm btn-primary", text: "Add user", onclick: addUser }),
      el("label", { class: "muted", style: "display:flex;align-items:center;gap:6px;margin-left:auto" }, [el("input", { id: "u-sys", type: "checkbox", style: "width:auto", onchange: () => load() }), "show system"]),
    ]);
    const body = el("div", { id: "u-body" }, el("div", { class: "loading", text: "Loading…" }));
    root.append(bar, body);

    const load = async () => {
      await guardedLoad(async () => {
        const sys = $("#u-sys") && $("#u-sys").checked;
        const data = await API.usersList(sys);
        body.innerHTML = "";
        if (!data.supported) { body.append(el("p", { class: "empty", text: "User management is only available on Linux." })); return; }
        const rows = data.users.map((u) => el("tr", {}, [
          el("td", { text: u.name }), el("td", { class: "muted", text: u.uid }),
          el("td", { class: "muted", text: u.home }), el("td", { class: "muted", text: u.shell }),
          el("td", { class: "actions" }, [
            el("button", { class: "btn btn-sm btn-ghost", text: "Password", onclick: () => setUserPw(u.name) }),
            el("button", { class: "btn btn-sm btn-danger", text: "Delete", onclick: () => delUser(u.name) }),
          ]),
        ]));
        body.append(el("div", { class: "table-wrap" }, el("table", {}, [
          el("thead", {}, el("tr", {}, ["User", "UID", "Home", "Shell", ""].map((h) => el("th", { text: h })))),
          el("tbody", {}, rows),
        ])));
      });
    };
    async function addUser() {
      const name = $("#u-name").value.trim();
      if (!name) { toast("Username required", "bad"); return; }
      try { await API.userAdd({ name, shell: $("#u-shell").value, create_home: $("#u-home").checked });
        toast("User added", "good"); $("#u-name").value = ""; load(); }
      catch (err) { toast(err.message, "bad"); }
    }
    async function delUser(name) {
      const rmHome = confirmInline(`Delete user "${name}"?\n\nOK = also remove home directory, Cancel = keep it.\n(To abort entirely, dismiss the next prompt.)`);
      if (!confirmInline(`Confirm deleting user "${name}"${rmHome ? " and their home directory" : ""}?`)) return;
      try { await API.userDelete(name, rmHome); toast("User deleted", "good"); load(); }
      catch (err) { toast(err.message, "bad"); }
    }
    async function setUserPw(name) {
      const pw = promptInline(`Set a new password for ${name}:`);
      if (!pw) return;
      try { await API.userPassword(name, pw); toast("Password set", "good"); }
      catch (err) { toast(err.message, "bad"); }
    }
    state.refreshHandler = load;
    load();
  }

  // ======================================================================
  //  Security (2FA)
  // ======================================================================
  function viewSecurity(root) {
    const body = el("div", { id: "sec-body" }, el("div", { class: "loading", text: "Loading…" }));
    root.append(body);
    const load = async () => {
      await guardedLoad(async () => {
        const st = await API.twofaStatus();
        body.innerHTML = "";
        const card = el("div", { class: "card" }, [
          el("h3", { text: "Two-factor authentication (TOTP)" }),
          el("p", { class: "muted", style: "margin:0 0 14px",
            text: "Add a second step at login using an authenticator app (Google Authenticator, Authy, etc.)." }),
          el("div", { style: "display:flex;align-items:center;gap:12px" }, [
            el("span", { class: `pill ${st.enabled ? "good" : "dim"}`, text: st.enabled ? "enabled" : "disabled" }),
            st.enabled
              ? el("button", { class: "btn btn-sm btn-danger", text: "Disable 2FA", onclick: disable2fa })
              : el("button", { class: "btn btn-sm btn-primary", text: "Enable 2FA", onclick: enroll2fa }),
          ]),
        ]);
        body.append(card);
      });
    };
    async function enroll2fa() {
      try {
        const d = await API.twofaEnroll();
        const content = el("div", {}, [
          el("p", { class: "muted", text: "1. Add this secret to your authenticator app (manual entry):" }),
          el("div", { class: "card", style: "margin:8px 0;font-family:monospace;font-size:16px;letter-spacing:2px;text-align:center", text: d.secret }),
          el("p", { class: "muted", style: "word-break:break-all", html: `Or use this otpauth URI:<br><code>${esc(d.otpauth_uri)}</code>` }),
          el("p", { class: "muted", text: "2. Enter the current 6-digit code to confirm:" }),
          el("input", { id: "sec-code", type: "text", inputmode: "numeric", placeholder: "123456", style: "max-width:160px" }),
        ]);
        openModal("Enable 2FA", content, [
          el("button", { class: "btn btn-primary", text: "Confirm & enable", onclick: async () => {
            try { await API.twofaEnable($("#sec-code").value.trim()); toast("2FA enabled", "good"); closeModal(); load(); }
            catch (e) { toast(e.message, "bad"); } } }),
        ]);
      } catch (err) { toast(err.message, "bad"); }
    }
    async function disable2fa() {
      const content = el("div", {}, [
        el("p", { class: "muted", text: "Enter a current authenticator code to disable 2FA:" }),
        el("input", { id: "sec-code", type: "text", inputmode: "numeric", placeholder: "123456", style: "max-width:160px" }),
      ]);
      openModal("Disable 2FA", content, [
        el("button", { class: "btn btn-danger", text: "Disable", onclick: async () => {
          try { await API.twofaDisable($("#sec-code").value.trim()); toast("2FA disabled", "good"); closeModal(); load(); }
          catch (e) { toast(e.message, "bad"); } } }),
      ]);
    }
    state.refreshHandler = load;
    load();
  }

  // ======================================================================
  //  Advanced: shared Apache directory bar
  // ======================================================================
  const apDir = {}; // per-view current dir
  function apacheDirBar(view, hint, onGo) {
    apDir[view] = apDir[view] || "";
    const input = el("input", { id: `ap-dir-${view}`, type: "text", value: apDir[view],
      placeholder: "sub-directory under the web root (blank = root)", style: "flex:1;min-width:220px" });
    const bar = el("div", { class: "toolbar" }, [
      el("span", { class: "muted", text: "Dir:" }), input,
      el("button", { class: "btn btn-sm", text: "Load", onclick: () => { apDir[view] = input.value.trim(); onGo(); } }),
    ]);
    const note = el("p", { class: "muted", style: "margin:-6px 0 12px;font-size:12px", text: hint });
    return { bar, note, get dir() { return apDir[view]; } };
  }

  // ---- Indexes ----
  function viewIndexes(root) {
    const db = apacheDirBar("indexes", "Controls directory listing (Options ±Indexes) and DirectoryIndex via .htaccess. Requires Apache AllowOverride.", () => load());
    const body = el("div", { id: "idx-body" }, el("div", { class: "loading", text: "Loading…" }));
    root.append(db.bar, db.note, body);
    async function load() {
      body.innerHTML = '<div class="loading">Loading…</div>';
      try {
        const d = await API.apacheIndexes(db.dir);
        body.innerHTML = "";
        const listing = d.listing === true;
        const card = el("div", { class: "card" }, [
          el("h3", { text: `Directory listing — root: ${d.root}` }),
          el("label", { class: "muted", style: "display:flex;align-items:center;gap:8px;margin-bottom:12px" }, [
            el("input", { id: "idx-listing", type: "checkbox", style: "width:auto", ...(listing ? { checked: "checked" } : {}) }),
            "Enable directory listing (show files when no index page)",
          ]),
          el("h3", { text: "DirectoryIndex (default page order)" }),
          el("input", { id: "idx-di", type: "text", value: d.directory_index || "", placeholder: "index.html index.php", style: "max-width:360px" }),
          el("div", { style: "margin-top:14px" }, el("button", { class: "btn btn-primary btn-sm", text: "Save", onclick: save })),
          el("p", { class: "muted", style: "margin-top:10px;font-size:12px",
            text: d.listing === null ? "No explicit setting yet (Apache default applies)." : `Current: listing ${listing ? "on" : "off"}.` }),
        ]);
        body.append(card);
      } catch (e) { body.innerHTML = ""; body.append(el("p", { class: "empty", text: e.message })); }
    }
    async function save() {
      try {
        await API.apacheSetIndexes({ dir: db.dir, listing: $("#idx-listing").checked, directory_index: $("#idx-di").value.trim() || null });
        toast("Saved to .htaccess", "good"); load();
      } catch (e) { toast(e.message, "bad"); }
    }
    state.refreshHandler = load; load();
  }

  // ---- MIME Types ----
  function viewMime(root) {
    const db = apacheDirBar("mime", "Add custom MIME types (AddType) to this directory's .htaccess.", () => load());
    const addForm = el("div", { class: "card", style: "margin-bottom:16px" }, [
      el("h3", { text: "Add MIME type" }),
      el("div", { class: "toolbar" }, [
        el("input", { id: "mime-type", type: "text", placeholder: "application/json", style: "max-width:220px" }),
        el("input", { id: "mime-ext", type: "text", placeholder: "extensions: json map", style: "max-width:220px" }),
        el("button", { class: "btn btn-sm btn-primary", text: "Add", onclick: add }),
      ]),
    ]);
    const body = el("div", { id: "mime-body" }, el("div", { class: "loading", text: "Loading…" }));
    root.append(db.bar, db.note, addForm, body);
    async function load() {
      body.innerHTML = '<div class="loading">Loading…</div>';
      try {
        const d = await API.apacheMime(db.dir);
        body.innerHTML = "";
        const custom = el("div", { class: "card", style: "margin-bottom:16px" }, [el("h3", { text: "Custom MIME types (.htaccess)" })]);
        if (!d.entries.length) custom.append(el("p", { class: "muted", text: "None yet." }));
        else custom.append(directiveTable(d.entries, "mime", db));
        body.append(custom);
        if (d.system && d.system.available) {
          const rows = d.system.entries.slice(0, 60).map((e) => el("tr", {}, [el("td", { text: e.type }), el("td", { class: "muted", text: e.extensions })]));
          body.append(el("div", { class: "card" }, [
            el("h3", { text: "System MIME types (reference, /etc/mime.types)" }),
            el("div", { class: "table-wrap" }, el("table", {}, [el("thead", {}, el("tr", {}, [el("th", { text: "Type" }), el("th", { text: "Extensions" })])), el("tbody", {}, rows)])),
          ]));
        }
      } catch (e) { body.innerHTML = ""; body.append(el("p", { class: "empty", text: e.message })); }
    }
    async function add() {
      try { await API.apacheAddMime({ dir: db.dir, mime: $("#mime-type").value.trim(), extensions: $("#mime-ext").value.trim() });
        toast("Added", "good"); $("#mime-type").value = ""; $("#mime-ext").value = ""; load(); }
      catch (e) { toast(e.message, "bad"); }
    }
    state.refreshHandler = load; load();
  }

  // ---- Error Pages ----
  function viewErrorPages(root) {
    const db = apacheDirBar("errorpages", "Set custom error pages (ErrorDocument) per HTTP status via .htaccess.", () => load());
    const addForm = el("div", { class: "card", style: "margin-bottom:16px" }, [
      el("h3", { text: "Set error page" }),
      el("div", { class: "toolbar" }, [
        el("select", { id: "err-code", style: "max-width:120px" }, ["400", "401", "403", "404", "500", "503"].map((c) => el("option", { value: c, text: c }))),
        el("input", { id: "err-doc", type: "text", placeholder: "/404.html  or  https://…", style: "flex:1;min-width:220px" }),
        el("button", { class: "btn btn-sm btn-primary", text: "Save", onclick: save }),
      ]),
    ]);
    const body = el("div", { id: "err-body" }, el("div", { class: "loading", text: "Loading…" }));
    root.append(db.bar, db.note, addForm, body);
    async function load() {
      body.innerHTML = '<div class="loading">Loading…</div>';
      try {
        const d = await API.apacheErrors(db.dir);
        body.innerHTML = "";
        const card = el("div", { class: "card" }, [el("h3", { text: "Configured error pages" })]);
        if (!d.entries.length) card.append(el("p", { class: "muted", text: "None yet." }));
        else {
          const rows = d.entries.map((e) => el("tr", {}, [
            el("td", { text: e.code }), el("td", { class: "muted", text: e.document }),
            el("td", { class: "actions" }, el("button", { class: "btn btn-sm btn-danger", text: "Remove", onclick: () => removeDirective(e.raw, db, load) })),
          ]));
          card.append(el("div", { class: "table-wrap" }, el("table", {}, [el("thead", {}, el("tr", {}, ["Code", "Document", ""].map((h) => el("th", { text: h })))), el("tbody", {}, rows)])));
        }
        body.append(card);
      } catch (e) { body.innerHTML = ""; body.append(el("p", { class: "empty", text: e.message })); }
    }
    async function save() {
      try { await API.apacheSetError({ dir: db.dir, code: $("#err-code").value, document: $("#err-doc").value.trim() });
        toast("Saved", "good"); $("#err-doc").value = ""; load(); }
      catch (e) { toast(e.message, "bad"); }
    }
    state.refreshHandler = load; load();
  }

  // ---- Apache Handlers ----
  function viewHandlers(root) {
    const db = apacheDirBar("handlers", "Map file extensions to handlers (AddHandler) via .htaccess.", () => load());
    const addForm = el("div", { class: "card", style: "margin-bottom:16px" }, [
      el("h3", { text: "Add handler" }),
      el("div", { class: "toolbar" }, [
        el("input", { id: "h-name", type: "text", placeholder: "handler e.g. cgi-script", style: "max-width:220px" }),
        el("input", { id: "h-ext", type: "text", placeholder: "extensions: cgi pl", style: "max-width:220px" }),
        el("button", { class: "btn btn-sm btn-primary", text: "Add", onclick: add }),
      ]),
    ]);
    const body = el("div", { id: "h-body" }, el("div", { class: "loading", text: "Loading…" }));
    root.append(db.bar, db.note, addForm, body);
    async function load() {
      body.innerHTML = '<div class="loading">Loading…</div>';
      try {
        const d = await API.apacheHandlers(db.dir);
        body.innerHTML = "";
        const card = el("div", { class: "card" }, [el("h3", { text: "Handlers (.htaccess)" })]);
        if (!d.entries.length) card.append(el("p", { class: "muted", text: "None yet." }));
        else card.append(directiveTable(d.entries, "handlers", db));
        body.append(card);
      } catch (e) { body.innerHTML = ""; body.append(el("p", { class: "empty", text: e.message })); }
    }
    async function add() {
      try { await API.apacheAddHandler({ dir: db.dir, handler: $("#h-name").value.trim(), extensions: $("#h-ext").value.trim() });
        toast("Added", "good"); $("#h-name").value = ""; $("#h-ext").value = ""; load(); }
      catch (e) { toast(e.message, "bad"); }
    }
    state.refreshHandler = load; load();
  }

  function directiveTable(entries, view, db) {
    const rows = entries.map((e) => el("tr", {}, [
      el("td", { class: "muted", text: e.raw }),
      el("td", { class: "actions" }, el("button", { class: "btn btn-sm btn-danger", text: "Remove",
        onclick: () => removeDirective(e.raw, db, () => navigate(state.view)) })),
    ]));
    return el("div", { class: "table-wrap" }, el("table", {}, [
      el("thead", {}, el("tr", {}, [el("th", { text: "Directive" }), el("th", { text: "" })])), el("tbody", {}, rows)]));
  }
  async function removeDirective(raw, db, reload) {
    if (!confirmInline(`Remove:\n${raw}`)) return;
    try { await API.apacheRemove(db.dir, raw); toast("Removed", "good"); reload(); }
    catch (e) { toast(e.message, "bad"); }
  }

  // ---- Virus Scanner (with progress bar) ----
  function viewVirus(root) {
    const body = el("div", {});
    const scanUi = el("div", { id: "scan-ui" });
    const jp = jobPanel(root); // used for "Update virus DB" job
    root.append(body, scanUi);
    let scanTimer = null;
    const stopScan = () => { if (scanTimer) { clearInterval(scanTimer); scanTimer = null; } };
    (state.cleanups = state.cleanups || []).push(stopScan);

    const load = async () => {
      await guardedLoad(async () => {
        const st = await API.avStatus();
        body.innerHTML = "";
        if (!st.available) {
          body.append(el("div", { class: "card" }, [
            el("h3", { text: "ClamAV not installed" }),
            el("p", { class: "muted", text: "Install the 'clamav' package (Packages section, or apt install clamav) to enable on-demand virus scanning." }),
          ]));
          return;
        }
        body.append(el("div", { class: "card" }, [
          el("h3", { text: "On-demand scan (ClamAV)" }),
          el("div", { class: "toolbar" }, [
            el("input", { id: "av-path", type: "text", placeholder: `${sysHome()}  (absolute path to scan)`, style: "flex:1;min-width:240px" }),
            el("button", { class: "btn btn-sm btn-primary", text: "Scan", onclick: scan }),
            el("button", { class: "btn btn-sm", text: "Update virus DB", onclick: update }),
          ]),
          el("p", { class: "muted", style: "font-size:12px;margin:8px 0 0", text: "Scans run in the background — watch progress below." }),
        ]));
      });
    };

    function renderScan(job) {
      const total = (job.meta && job.meta.total_files) || 0;
      const lines = (job.output || "").split("\n");
      // Per-file lines look like "<path>: OK" or "<path>: <sig> FOUND".
      const scanned = lines.filter((l) => /: OK\s*$/.test(l) || /FOUND\s*$/.test(l)).length;
      const infected = lines.filter((l) => /FOUND\s*$/.test(l));
      const lastFile = [...lines].reverse().find((l) => /: OK\s*$/.test(l) || /FOUND\s*$/.test(l)) || "";
      const running = job.status === "running";
      const known = total > 0;
      const pct = known ? Math.min(100, Math.round((scanned / total) * 100)) : (running ? 0 : 100);

      // Pull the clamscan summary block (after "SCAN SUMMARY") once finished.
      let summary = "";
      const sumIdx = lines.findIndex((l) => /SCAN SUMMARY/.test(l));
      if (sumIdx >= 0) summary = lines.slice(sumIdx).join("\n");

      scanUi.innerHTML = "";
      const meterCls = infected.length ? "bad" : "";
      const meter = el("div", { class: `meter big ${meterCls} ${known ? "" : (running ? "indeterminate" : "")}` },
        el("span", { style: known ? `width:${pct}%` : "" }));
      const statusPill = running
        ? el("span", { class: "pill warn", text: "scanning" })
        : el("span", { class: `pill ${job.status === "done" && !infected.length ? "good" : "bad"}`,
            text: job.status === "done" ? (infected.length ? `${infected.length} infected` : "clean") : "failed" });

      const card = el("div", { class: "card" }, [
        el("div", { style: "display:flex;justify-content:space-between;align-items:center" }, [
          el("h3", { text: "Scan progress", style: "margin:0" }), statusPill,
        ]),
        meter,
        el("div", { class: "scan-stat" }, [
          el("span", { class: "muted", text: known ? `${scanned.toLocaleString()} / ${total.toLocaleString()} files` : `${scanned.toLocaleString()} files scanned` }),
          el("span", { text: known ? `${pct}%` : (running ? "…" : "done") }),
        ]),
        running && lastFile ? el("div", { class: "scan-current", text: lastFile.replace(/: OK\s*$/, "").replace(/: .*FOUND\s*$/, "") }) : null,
      ]);
      scanUi.append(card);

      if (infected.length) {
        scanUi.append(el("div", { class: "card", style: "margin-top:14px" }, [
          el("h3", { text: `⚠ Infected files (${infected.length})` }),
          el("div", {}, infected.map((l) => el("div", { class: "infected-line", text: l }))),
        ]));
      }
      if (summary && !running) {
        scanUi.append(el("div", { class: "card", style: "margin-top:14px" }, [
          el("h3", { text: "Summary" }), el("pre", { class: "log", text: summary }),
        ]));
      }
    }

    async function scan() {
      const path = $("#av-path").value.trim();
      if (!path) { toast("Path required", "bad"); return; }
      stopScan();
      scanUi.innerHTML = '<div class="card"><div class="loading">Counting files & starting scan…</div></div>';
      let jobId;
      try { const r = await API.avScan(path, true); jobId = r.job; }
      catch (e) { scanUi.innerHTML = ""; toast(e.message, "bad"); return; }
      const tick = async () => {
        try {
          const job = await API.job(jobId);
          renderScan(job);
          if (job.status !== "running") {
            stopScan();
            const inf = (job.output || "").split("\n").filter((l) => /FOUND\s*$/.test(l)).length;
            toast(inf ? `Scan complete — ${inf} infected` : "Scan complete — clean", inf ? "bad" : "good");
          }
        } catch (e) { stopScan(); toast(e.message, "bad"); }
      };
      await tick();
      scanTimer = setInterval(tick, 1000);
    }
    async function update() {
      try { const r = await API.avUpdate(); jp.run(r.job, "Updating virus DB"); } catch (e) { toast(e.message, "bad"); }
    }
    state.refreshHandler = load; load();
  }

  // ---- Track DNS ----
  function viewDns(root) {
    const bar = el("div", { class: "toolbar" }, [
      el("input", { id: "dns-host", type: "text", placeholder: "domain or IP (e.g. example.com)", style: "flex:1;min-width:240px",
        onkeydown: (e) => { if (e.key === "Enter") lookup(); } }),
      el("button", { class: "btn btn-sm btn-primary", text: "Lookup", onclick: lookup }),
      el("button", { class: "btn btn-sm", text: "Reverse (PTR)", onclick: reverse }),
      el("button", { class: "btn btn-sm", text: "Traceroute", onclick: trace }),
    ]);
    const body = el("div", { id: "dns-body" });
    root.append(bar, body);
    async function lookup() {
      const host = $("#dns-host").value.trim(); if (!host) return;
      body.innerHTML = '<div class="loading">Resolving…</div>';
      try {
        const d = await API.dnsRecords(host);
        body.innerHTML = "";
        const card = el("div", { class: "card" }, [el("h3", { text: `DNS records — ${d.host}` })]);
        const rows = Object.entries(d.records).map(([t, vals]) => el("tr", {}, [
          el("td", { text: t }), el("td", { class: "muted", html: vals.length ? vals.map(esc).join("<br>") : "—" })]));
        card.append(el("div", { class: "table-wrap" }, el("table", {}, [
          el("thead", {}, el("tr", {}, [el("th", { text: "Type" }), el("th", { text: "Value" })])), el("tbody", {}, rows)])));
        body.append(card);
      } catch (e) { body.innerHTML = ""; body.append(el("p", { class: "empty", text: e.message })); }
    }
    async function reverse() {
      const host = $("#dns-host").value.trim(); if (!host) return;
      body.innerHTML = '<div class="loading">Looking up…</div>';
      try { const d = await API.dnsReverse(host); body.innerHTML = ""; body.append(el("div", { class: "card" }, [el("h3", { text: "Reverse DNS" }), el("pre", { class: "log", text: d.result })])); }
      catch (e) { body.innerHTML = ""; body.append(el("p", { class: "empty", text: e.message })); }
    }
    async function trace() {
      const host = $("#dns-host").value.trim(); if (!host) return;
      body.innerHTML = '<div class="loading">Tracing route (up to a minute)…</div>';
      try { const d = await API.dnsTrace(host); body.innerHTML = ""; body.append(el("div", { class: "card" }, [el("h3", { text: `Traceroute — ${d.host}` }), el("pre", { class: "log", text: d.output })])); }
      catch (e) { body.innerHTML = ""; body.append(el("p", { class: "empty", text: e.message })); }
    }
  }

  // ======================================================================
  //  Shared helpers for Security / Domains / Databases
  // ======================================================================
  function installCard(title, msg, onInstall) {
    return el("div", { class: "card" }, [
      el("h3", { text: title }),
      el("p", { class: "muted", style: "margin:0 0 12px", text: msg }),
      onInstall ? el("button", { class: "btn btn-sm btn-primary", text: "Install now", onclick: onInstall }) : null,
    ]);
  }
  function simpleTable(headers, rows) {
    return el("div", { class: "table-wrap" }, el("table", {}, [
      el("thead", {}, el("tr", {}, headers.map((h) => el("th", { text: h })))),
      el("tbody", {}, rows),
    ]));
  }

  // ---- SSH Access ----
  function viewSSH(root) {
    const status = el("div", { id: "ssh-status" }, el("div", { class: "loading", text: "Loading…" }));
    const keysWrap = el("div", { style: "margin-top:16px" });
    root.append(status, keysWrap);
    let userSel = sysUser();
    const load = async () => {
      await guardedLoad(async () => {
        const st = await API.sshStatus();
        status.innerHTML = "";
        if (!st.supported) { status.append(el("p", { class: "empty", text: "SSH management is Linux-only." })); return; }
        const c = st.config;
        status.append(el("div", { class: "card" }, [
          el("div", { style: "display:flex;justify-content:space-between;align-items:center" }, [
            el("h3", { text: "SSH daemon", style: "margin:0" }),
            el("span", { class: `pill ${st.active === "active" ? "good" : "bad"}`, text: st.active || "unknown" }),
          ]),
          el("div", { class: "stat-sub", style: "margin-top:10px",
            html: `Port <b>${esc(c.port)}</b> · PermitRootLogin <b>${esc(c.permit_root_login)}</b> · PasswordAuth <b>${esc(c.password_auth)}</b> · startup <b>${esc(st.enabled || "?")}</b>` }),
          el("div", { style: "margin-top:12px" }, el("button", { class: "btn btn-sm", text: "↻ Restart sshd",
            onclick: async () => { if (!confirmInline("Restart the SSH daemon? Existing sessions stay connected.")) return;
              try { await API.sshRestart(); toast("sshd restarted", "good"); } catch (e) { toast(e.message, "bad"); } } })),
        ]));
        loadKeys();
      });
    };
    async function loadKeys() {
      await state.meReady;
      userSel = sysUser();
      const data = await API.sshKeys(userSel);
      keysWrap.innerHTML = "";
      const addForm = el("div", { class: "card", style: "margin-bottom:16px" }, [
        el("h3", { text: `Authorized keys for ${userSel}` }),
        el("textarea", { id: "ssh-newkey", class: "editor", style: "min-height:80px", placeholder: "ssh-ed25519 AAAA… user@host" }),
        el("div", { style: "margin-top:10px" }, el("button", { class: "btn btn-sm btn-primary", text: "Add key", onclick: async () => {
          try { await API.sshKeyAdd(userSel, $("#ssh-newkey").value.trim()); toast("Key added", "good"); loadKeys(); }
          catch (e) { toast(e.message, "bad"); } } })),
      ]);
      keysWrap.append(addForm);
      if (!data.keys.length) { keysWrap.append(el("p", { class: "empty", text: "No authorized keys." })); return; }
      const rows = data.keys.map((k) => el("tr", {}, [
        el("td", { text: k.type }), el("td", { class: "muted", text: k.comment || "—" }),
        el("td", { class: "muted", style: "font-family:monospace;font-size:11px", text: k.fingerprint }),
        el("td", { class: "actions" }, el("button", { class: "btn btn-sm btn-danger", text: "Remove", onclick: async () => {
          if (!confirmInline("Remove this key?")) return;
          try { await API.sshKeyRemove(userSel, k.raw); toast("Removed", "good"); loadKeys(); } catch (e) { toast(e.message, "bad"); } } })),
      ]));
      keysWrap.append(simpleTable(["Type", "Comment", "Fingerprint", ""], rows));
    }
    state.refreshHandler = load; load();
  }

  // ---- IP Blocker ----
  // ======================================================================
  //  IP Blocker & Trust — bans (IPs / ranges, expiry), fail2ban bans, trusted list
  // ======================================================================
  const BAN_DURATIONS = [[3600, "1 hour"], [86400, "1 day"], [604800, "1 week"], [2592000, "30 days"], [0, "Permanent"]];
  const fmtDur = (s) => s == null ? "—" : s < 3600 ? `${Math.ceil(s / 60)} min` : s < 86400 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} d`;
  function rangeOf(ip, bits) {
    const p = String(ip).split(".").map(Number);
    if (p.length !== 4) return ip;
    if (bits === 24) return `${p[0]}.${p[1]}.${p[2]}.0/24`;
    if (bits === 16) return `${p[0]}.${p[1]}.0.0/16`;
    return ip;
  }
  // Ban dialog (IP, its /24 or /16, or any custom range) — used by the Monitor and the IP Blocker.
  function banDialog(ip, done) {
    const target = el("input", { type: "text", value: ip || "", placeholder: "203.0.113.7  or  203.0.113.0/24" });
    const scope = isIPv4(ip) ? el("div", { class: "cw-seg cw-seg-sm" }, [["ip", `Just ${ip}`], [24, "Its /24 (256 addresses)"], [16, "Its /16 (65,536)"]].map(([k, l]) =>
      el("button", { type: "button", class: k === "ip" ? "active" : "", text: l, onclick: (e) => {
        target.value = k === "ip" ? ip : rangeOf(ip, k); e.target.parentNode.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === e.target)); } }))) : null;
    const dur = el("select", {}, BAN_DURATIONS.map(([v, l]) => el("option", { value: v, text: l })));
    dur.value = "86400";
    const reason = el("input", { type: "text", maxlength: 120, placeholder: "e.g. SSH brute force" });
    const go = btn("Ban", async () => {
      go.disabled = true;
      try {
        const r = await API.guardBan(target.value.trim(), reason.value.trim(), +dur.value || null);
        closeModal(); toast(`Banned ${r.ban.cidr}${r.replaced.length ? ` (replaced ${r.replaced.length} narrower ban${r.replaced.length > 1 ? "s" : ""})` : ""}`, "good"); done && done();
      } catch (e) { toast(e.message, "bad"); go.disabled = false; }
    }, "btn-danger");
    openModal("Ban an address", el("div", {}, [
      scope, field("Address or range", target, "A single IP, or CIDR like 203.0.113.0/24."), el("div", { class: "net-form" }, [field("For how long", dur), field("Reason (optional)", reason)]),
      el("p", { class: "dm-hint", text: "Banned addresses can't reach anything on this Pi. Your own address, this Pi, your router and trusted addresses can't be banned." }),
    ]), [go]);
  }
  function trustDialog(ip, done) {
    const target = el("input", { type: "text", value: ip || "", placeholder: "192.168.0.2  or  192.168.0.0/24" });
    const note = el("input", { type: "text", maxlength: 120, placeholder: "e.g. my laptop / office network" });
    const go = btn("Trust", async () => {
      go.disabled = true;
      try { const r = await API.guardTrust(target.value.trim(), note.value.trim()); closeModal(); toast(`Trusted${r.unbanned.length ? ` — lifted ${r.unbanned.length} ban(s)` : ""}`, "good"); done && done(); }
      catch (e) { toast(e.message, "bad"); go.disabled = false; }
    }, "btn-primary");
    openModal("Trust an address", el("div", {}, [field("Address or range", target), field("Note (optional)", note),
      el("p", { class: "dm-hint", text: "Trusted addresses are never blocked: existing bans on them are lifted, manual bans are refused, and fail2ban ignores them (they're added to its ignore list automatically)." })]), [go]);
  }
  function viewIPBlocker(root) {
    const body = el("div", {}, el("div", { class: "loading", text: "Loading…" }));
    root.append(el("div", { class: "toolbar" }, [btn("Ban an address…", () => banDialog("", load), "btn-danger"), btn("Trust an address…", () => trustDialog("", load), "btn-primary"),
      btn("Fail2ban settings", () => navigate("leech"), "btn-ghost"), btn("Network Monitor", () => navigate("netmon"), "btn-ghost")]), body);
    const load = () => guardedLoad(async () => {
      const d = await API.guard();
      body.innerHTML = "";
      if (!d.enabled) body.append(el("p", { class: "dm-hint", text: "The ban list is created the first time you ban or trust something." }));
      body.append(el("h2", { class: "section-title", text: `Banned by you (${d.bans.length})` }));
      body.append(d.bans.length ? simpleTable(["Address / range", "Reason", "Expires", "Blocked packets", ""], d.bans.map((b) => row(
        el("code", { class: "net-mono", text: b.cidr }), b.reason || "—", b.expires ? `${new Date(b.expires * 1000).toLocaleString()} (in ${fmtDur(b.expires - Date.now() / 1000)})` : "never",
        b.packets, el("div", { class: "net-actions" }, [btn("Unban", async () => { try { await API.guardUnban(b.cidr); toast(`${b.cidr} unbanned`, "good"); load(); } catch (e) { toast(e.message, "bad"); } })]),
      ))) : el("p", { class: "empty", text: "No manual bans." }));
      body.append(el("h2", { class: "section-title", text: `Banned by fail2ban (${d.fail2ban.length})` }));
      body.append(d.fail2ban.length ? simpleTable(["Address", "Caught by", "Time left", "Blocked packets", ""], d.fail2ban.map((a) => row(
        el("code", { class: "net-mono", text: a.ip }), a.jails.join(", ") || "fail2ban", a.expires_in ? fmtDur(a.expires_in) : "until unbanned", a.packets,
        el("div", { class: "net-actions" }, [
          btn("Unban", async () => { try { await API.guardUnban(a.ip); toast(`${a.ip} unbanned`, "good"); load(); } catch (e) { toast(e.message, "bad"); } }),
          btn("Ban permanently", () => banDialog(a.ip, load), "btn-ghost")]),
      ))) : el("p", { class: "empty", text: "Nothing is banned automatically right now." }));
      body.append(el("h2", { class: "section-title", text: `Trusted (${d.trusted.length})` }));
      body.append(d.trusted.length ? simpleTable(["Address / range", "Note", "Added", ""], d.trusted.map((t) => row(
        el("code", { class: "net-mono", text: t.cidr }), t.note || "—", new Date(t.created * 1000).toLocaleDateString(),
        el("div", { class: "net-actions" }, [btn("Remove", async () => { if (!confirmInline(`Stop trusting ${t.cidr}? It can then be banned by fail2ban again.`)) return; try { await API.guardUntrust(t.cidr); toast("Removed", "good"); load(); } catch (e) { toast(e.message, "bad"); } }, "btn-danger")]),
      ))) : el("p", { class: "empty", text: "No trusted addresses. Tip: trust your own devices (or your LAN range) so a mistyped password never locks you out." }));
      body.append(el("p", { class: "dm-hint", text: `Always protected: ${d.protected.join(", ")}.` }));
    });
    state.refreshHandler = load; load();
    const t = setInterval(load, 15000); state.cleanups.push(() => clearInterval(t));
  }

  // ---- SSL/TLS Certificates ----
  function viewSSL(root) {
    const form = el("div", { class: "card", style: "margin-bottom:16px" }, [
      el("h3", { text: "Generate self-signed certificate" }),
      el("div", { class: "toolbar" }, [
        el("input", { id: "ssl-cn", type: "text", placeholder: "common name (e.g. pi.local)", style: "max-width:240px" }),
        el("input", { id: "ssl-days", type: "number", value: "365", style: "max-width:100px" }),
        el("button", { class: "btn btn-sm btn-primary", text: "Generate", onclick: gen }),
      ]),
    ]);
    const body = el("div", { id: "ssl-body" }, el("div", { class: "loading", text: "Loading…" }));
    root.append(form, body);
    const load = async () => {
      await guardedLoad(async () => {
        const d = await API.sslCerts();
        body.innerHTML = "";
        body.append(el("p", { class: "muted", style: "margin:0 0 10px", text: `Self-signed certs are written to ${d.cert_dir}` }));
        if (!d.certs.length) { body.append(el("p", { class: "empty", text: "No certificates found." })); return; }
        const rows = d.certs.map((c) => el("tr", {}, [
          el("td", { text: c.name }), el("td", { class: "muted", text: c.subject || "—" }),
          el("td", { class: "muted", text: c.expires || "—" }),
          el("td", {}, el("span", { class: `pill ${c.self_signed ? "warn" : "good"}`, text: c.self_signed ? "self-signed" : "CA" })),
        ]));
        body.append(simpleTable(["File", "Subject", "Expires", "Type"], rows));
      });
    };
    async function gen() {
      try { const r = await API.sslSelfSigned($("#ssl-cn").value.trim(), parseInt($("#ssl-days").value) || 365);
        toast("Certificate generated", "good"); load(); }
      catch (e) { toast(e.message, "bad"); }
    }
    state.refreshHandler = load; load();
  }

  // ---- Manage API Tokens ----
  function viewAPITokens(root) {
    const form = el("div", { class: "card", style: "margin-bottom:16px" }, [
      el("h3", { text: "Create API token" }),
      el("p", { class: "muted", style: "margin:0 0 10px;font-size:12px", text: "Tokens authenticate API calls via header  Authorization: Bearer <token>.  Shown once." }),
      el("div", { class: "toolbar" }, [
        el("input", { id: "tok-name", type: "text", placeholder: "token name", style: "max-width:240px" }),
        el("button", { class: "btn btn-sm btn-primary", text: "Create", onclick: create }),
      ]),
    ]);
    const body = el("div", { id: "tok-body" }, el("div", { class: "loading", text: "Loading…" }));
    root.append(form, body);
    const load = async () => {
      await guardedLoad(async () => {
        const d = await API.tokens();
        body.innerHTML = "";
        if (!d.tokens.length) { body.append(el("p", { class: "empty", text: "No tokens." })); return; }
        const rows = d.tokens.map((t) => el("tr", {}, [
          el("td", { text: t.name }), el("td", { class: "muted", style: "font-family:monospace", text: t.prefix + "…" }),
          el("td", { class: "muted", text: new Date(t.created * 1000).toLocaleString() }),
          el("td", { class: "actions" }, el("button", { class: "btn btn-sm btn-danger", text: "Revoke", onclick: async () => {
            if (!confirmInline(`Revoke token "${t.name}"?`)) return;
            try { await API.tokenRevoke(t.id); toast("Revoked", "good"); load(); } catch (e) { toast(e.message, "bad"); } } })),
        ]));
        body.append(simpleTable(["Name", "Prefix", "Created", ""], rows));
      });
    };
    async function create() {
      const name = $("#tok-name").value.trim(); if (!name) return;
      try {
        const r = await API.tokenCreate(name);
        const ta = el("input", { type: "text", value: r.token, readonly: "readonly", style: "font-family:monospace;width:100%" });
        openModal("API token created", el("div", {}, [
          el("p", { class: "muted", text: "Copy this token now — it will not be shown again:" }),
          ta,
        ]), [el("button", { class: "btn btn-primary", text: "Copy", onclick: () => { ta.select(); try { document.execCommand("copy"); toast("Copied", "good"); } catch (e) {} } })]);
        $("#tok-name").value = ""; load();
      } catch (e) { toast(e.message, "bad"); }
    }
    state.refreshHandler = load; load();
  }

  // ---- Hotlink Protection ----
  function viewHotlink(root) {
    const db = apacheDirBar("hotlink", "Blocks other sites from embedding your images (writes RewriteRules to .htaccess).", () => load());
    const body = el("div", { id: "hl-body" }, el("div", { class: "loading", text: "Loading…" }));
    root.append(db.bar, db.note, body);
    async function load() {
      body.innerHTML = '<div class="loading">Loading…</div>';
      try {
        const d = await API.hotlink(db.dir);
        body.innerHTML = "";
        body.append(el("div", { class: "card" }, [
          el("label", { class: "muted", style: "display:flex;align-items:center;gap:8px;margin-bottom:12px" }, [
            el("input", { id: "hl-enabled", type: "checkbox", style: "width:auto", ...(d.enabled ? { checked: "checked" } : {}) }),
            "Enable hotlink protection",
          ]),
          el("h3", { text: "Allowed hosts (your domains)" }),
          el("input", { id: "hl-hosts", type: "text", value: d.allowed_hosts || "", placeholder: "example.com www.example.com", style: "max-width:420px" }),
          el("h3", { text: "Protected extensions", style: "margin-top:12px" }),
          el("input", { id: "hl-ext", type: "text", value: d.extensions || "jpg jpeg png gif webp svg", style: "max-width:420px" }),
          el("div", { style: "margin-top:14px" }, el("button", { class: "btn btn-sm btn-primary", text: "Save", onclick: save })),
        ]));
      } catch (e) { body.innerHTML = ""; body.append(el("p", { class: "empty", text: e.message })); }
    }
    async function save() {
      try { await API.hotlinkSet({ dir: db.dir, enabled: $("#hl-enabled").checked, allowed_hosts: $("#hl-hosts").value.trim(), extensions: $("#hl-ext").value.trim() });
        toast("Saved", "good"); load(); }
      catch (e) { toast(e.message, "bad"); }
    }
    state.refreshHandler = load; load();
  }

  // ---- Redirects ----
  function viewRedirects(root) {
    const db = apacheDirBar("redirects", "HTTP redirects written to .htaccess (Redirect directive).", () => load());
    const form = el("div", { class: "card", style: "margin-bottom:16px" }, [
      el("h3", { text: "Add redirect" }),
      el("div", { class: "toolbar" }, [
        el("select", { id: "rd-code", style: "max-width:110px" }, [["301", "301 permanent"], ["302", "302 temporary"]].map(([v, t]) => el("option", { value: v, text: t }))),
        el("input", { id: "rd-src", type: "text", placeholder: "/old-path", style: "max-width:180px" }),
        el("input", { id: "rd-dst", type: "text", placeholder: "https://new-target/…", style: "flex:1;min-width:200px" }),
        el("button", { class: "btn btn-sm btn-primary", text: "Add", onclick: add }),
      ]),
    ]);
    const body = el("div", { id: "rd-body" }, el("div", { class: "loading", text: "Loading…" }));
    root.append(db.bar, db.note, form, body);
    async function load() {
      body.innerHTML = '<div class="loading">Loading…</div>';
      try {
        const d = await API.redirects(db.dir);
        body.innerHTML = "";
        if (!d.entries.length) { body.append(el("p", { class: "empty", text: "No redirects." })); return; }
        const rows = d.entries.map((e) => el("tr", {}, [
          el("td", { class: "muted", text: e.raw }),
          el("td", { class: "actions" }, el("button", { class: "btn btn-sm btn-danger", text: "Remove", onclick: () => removeDirective(e.raw, db, load) })),
        ]));
        body.append(simpleTable(["Redirect", ""], rows));
      } catch (e) { body.innerHTML = ""; body.append(el("p", { class: "empty", text: e.message })); }
    }
    async function add() {
      try { await API.redirectAdd({ dir: db.dir, code: $("#rd-code").value, source: $("#rd-src").value.trim(), target: $("#rd-dst").value.trim() });
        toast("Added", "good"); $("#rd-src").value = ""; $("#rd-dst").value = ""; load(); }
      catch (e) { toast(e.message, "bad"); }
    }
    state.refreshHandler = load; load();
  }

  // ---- ModSecurity ----
  function viewModSec(root) {
    const body = el("div", {}, el("div", { class: "loading", text: "Loading…" }));
    root.append(body);
    const jp = jobPanel(root);
    const load = async () => {
      await guardedLoad(async () => {
        const d = await API.modsec();
        body.innerHTML = "";
        if (!d.installed) {
          body.append(installCard("ModSecurity (Apache WAF) not installed",
            "Install libapache2-mod-security2 to add a web application firewall to Apache.",
            async () => { try { const r = await API.modsecInstall(); jp.run(r.job, "Installing ModSecurity"); } catch (e) { toast(e.message, "bad"); } }));
          return;
        }
        body.append(el("div", { class: "card" }, [
          el("div", { style: "display:flex;justify-content:space-between;align-items:center" }, [
            el("h3", { text: "ModSecurity WAF", style: "margin:0" }),
            el("span", { class: `pill ${d.enabled ? "good" : "dim"}`, text: d.enabled ? "enabled" : "disabled" }),
          ]),
          el("div", { style: "margin-top:12px" }, el("button", { class: "btn btn-sm", text: d.enabled ? "Disable" : "Enable",
            onclick: async () => { try { await API.modsecToggle(!d.enabled); toast("Apache reloaded", "good"); load(); } catch (e) { toast(e.message, "bad"); } } })),
        ]));
      });
    };
    state.refreshHandler = load; load();
  }

  // ---- Leech Protection (fail2ban) ----
  // ======================================================================
  //  Fail2ban — automatic brute-force protection
  // ======================================================================
  function viewLeech(root) {
    const body = el("div", {}, el("div", { class: "loading", text: "Loading…" }));
    root.append(el("p", { class: "muted", style: "margin:0 0 14px", text: "fail2ban watches login logs and temporarily bans addresses that keep guessing passwords. Its bans go into the same ban list as yours (IP Blocker & Trust), and trusted addresses are never banned." }), body);
    const jp = jobPanel(root);
    state.cleanups.push(jp.stop);
    const minsInput = (v, allowForever) => el("input", { type: "number", min: allowForever ? -1 : 1, value: v, style: "max-width:110px" });
    const load = () => guardedLoad(async () => {
      const d = await API.fail2ban();
      body.innerHTML = "";
      if (!d.installed) {
        body.append(installCard("fail2ban is not installed", "Install it to protect SSH, this panel, OpenVPN, FTP, web logins and MariaDB from password guessing.",
          async () => { try { const r = await API.fail2banInstall(); watchJob(jp, r.job, "Installing fail2ban", load); } catch (e) { toast(e.message, "bad"); } }));
        return;
      }
      const cfg = d.config, g = cfg.global;
      body.append(el("div", { class: "card" }, [
        el("div", { class: "net-card-h" }, [icon("trap", 20), el("h3", { text: "fail2ban" }), el("span", { style: "flex:1" }), pill(d.active ? "protecting" : "off", d.active ? "good" : "bad"),
          btn(d.active ? "Turn off" : (cfg.configured ? "Turn on" : "Turn on with recommended settings"), async () => {
            if (d.active && !confirmInline("Turn fail2ban off? Brute-force attempts will no longer be banned.")) return;
            try { await API.fail2banService(!d.active); toast(d.active ? "fail2ban stopped" : "fail2ban is protecting this Pi", "good"); load(); } catch (e) { openModal("Couldn't change fail2ban", el("pre", { class: "log", text: e.message }), []); }
          }, d.active ? "btn-ghost" : "btn-primary")]),
        !cfg.configured ? el("p", { class: "dm-hint", text: "Not yet managed by the panel — turning it on (or saving below) writes the panel's settings; the stock config is left untouched." }) : null,
      ]));
      // global
      const gf = {
        bantime: minsInput(g.bantime, true), findtime: minsInput(g.findtime), maxretry: el("input", { type: "number", min: 1, max: 1000, value: g.maxretry, style: "max-width:110px" }),
        increment: (() => { const c = el("input", { type: "checkbox", class: "sf-switch" }); c.checked = g.increment; return c; })(),
        maxtime_days: el("input", { type: "number", min: 1, max: 3650, value: g.maxtime_days, style: "max-width:110px" }),
        extra_ignore: el("input", { type: "text", value: g.extra_ignore, placeholder: "extra IPs / ranges, space separated" }),
      };
      body.append(el("div", { class: "card" }, [
        el("h3", { text: "Default rules (every jail unless it overrides them)" }),
        el("div", { class: "net-form" }, [
          field("Ban for (minutes, -1 = forever)", gf.bantime), field("Count failures within (minutes)", gf.findtime), field("Failures before a ban", gf.maxretry),
          el("label", { class: "sf-field sf-bool" }, [gf.increment, el("span", { class: "sf-label", text: "Longer bans for repeat offenders" }), el("small", { class: "dm-hint", text: "Each new ban of the same address lasts longer (up to the maximum)." })]),
          field("Longest ban (days)", gf.maxtime_days), field("Also never ban", gf.extra_ignore, "Trusted addresses are added automatically."),
        ]),
      ]));
      // jails
      const jf = {};
      const rows = d.jails.filter((j) => j.available).map((j) => {
        const on = el("input", { type: "checkbox", class: "sf-switch" }); on.checked = j.enabled;
        const mr = el("input", { type: "number", min: 1, max: 1000, value: j.maxretry, style: "max-width:80px" });
        const ft = el("input", { type: "number", min: 1, value: j.findtime === -2 ? "" : j.findtime, placeholder: "default", style: "max-width:90px" });
        const bt = el("input", { type: "number", min: -1, value: j.bantime === -2 ? "" : j.bantime, placeholder: "default", style: "max-width:90px" });
        jf[j.id] = { on, mr, ft, bt, j };
        const live = j.live;
        return row(el("div", {}, [el("b", { text: j.label }), el("div", { class: "dm-hint", text: j.desc })]), on, mr, ft, bt,
          live ? el("span", {}, [pill(`${live.banned_now} banned`, live.banned_now ? "warn" : "dim"), el("div", { class: "dm-hint", text: `${live.failed_total} failures, ${live.banned_total} bans total` })]) : el("span", { class: "dm-hint", text: j.enabled ? "not running" : "off" }),
          live && live.banned_ips.length ? el("div", { class: "net-chips" }, live.banned_ips.map((ip) => el("button", { type: "button", class: "net-chip", title: "Unban", text: `${ip} ✕`, onclick: async () => {
            try { await API.fail2banUnban(j.id, ip); await API.guardUnban(ip).catch(() => {}); toast(`${ip} unbanned`, "good"); load(); } catch (e) { toast(e.message, "bad"); } } }))) : null);
      });
      body.append(el("h2", { class: "section-title", text: "Protections (jails)" }), el("p", { class: "dm-hint", text: "Leave time fields empty to use the defaults above. Jails for software that isn't installed are hidden." }),
        simpleTable(["Protects", "On", "Failures", "Within (min)", "Ban (min)", "Status", "Banned now"], rows));
      const save = btn("Save & apply", async () => {
        const global = { bantime: +gf.bantime.value, findtime: +gf.findtime.value, maxretry: +gf.maxretry.value, increment: gf.increment.checked, maxtime_days: +gf.maxtime_days.value, extra_ignore: gf.extra_ignore.value.trim() };
        const jails = {};
        for (const [id, x] of Object.entries(jf)) jails[id] = { enabled: x.on.checked, maxretry: +x.mr.value, findtime: x.ft.value === "" ? -2 : +x.ft.value, bantime: x.bt.value === "" ? -2 : +x.bt.value };
        save.disabled = true;
        try { await API.fail2banSave(global, jails); toast("fail2ban updated", "good"); load(); }
        catch (e) { openModal("Settings not applied", el("pre", { class: "log", text: e.message }), []); save.disabled = false; }
      }, "btn-primary");
      const manualIp = el("input", { type: "text", placeholder: "IP to ban", style: "max-width:200px" });
      const manualJail = el("select", {}, d.jails.filter((j) => j.live).map((j) => el("option", { value: j.id, text: j.label })));
      body.append(el("div", { class: "sf-actions" }, [save, btn("View log", async () => { const r = await API.fail2banLogs(); openModal("fail2ban log", el("pre", { class: "log app-log", text: r.text || "(empty)" }), []); }, "btn-ghost")]),
        d.active ? el("div", { class: "card" }, [el("h3", { text: "Ban an address through a jail" }), el("div", { class: "toolbar", style: "margin:0" }, [manualIp, manualJail,
          btn("Ban", async () => { try { await API.fail2banBan(manualJail.value, manualIp.value.trim()); toast("Banned", "good"); manualIp.value = ""; load(); } catch (e) { toast(e.message, "bad"); } }, "btn-danger")]),
          el("p", { class: "dm-hint", text: "Uses that jail's ban time and repeat-offender rules. For permanent or range bans use IP Blocker & Trust." })]) : null);
    });
    state.refreshHandler = load; load();
  }

  // ---- Fix Home Permissions ----
  function viewFixPerms(root) {
    const bar = el("div", { class: "card" }, [
      el("h3", { text: "Fix Home Permissions" }),
      el("p", { class: "muted", style: "margin:0 0 12px", text: "Reset a user's home directory ownership + safe permissions (home 711, .ssh 700, keys 600)." }),
      el("div", { class: "toolbar" }, [
        el("input", { id: "fp-user", type: "text", value: sysUser(), placeholder: "username", style: "max-width:200px" }),
        el("button", { class: "btn btn-sm btn-primary", text: "Fix permissions", onclick: fix }),
      ]),
    ]);
    const body = el("div", { id: "fp-body", style: "margin-top:16px" });
    root.append(bar, body);
    async function fix() {
      const name = $("#fp-user").value.trim(); if (!name) return;
      if (!confirmInline(`Reset permissions for ${name}'s home directory?`)) return;
      body.innerHTML = '<div class="loading">Working…</div>';
      try {
        const r = await API.fixPerms(name);
        body.innerHTML = "";
        const rows = r.actions.map((a) => el("tr", {}, [
          el("td", { text: a.action }), el("td", {}, el("span", { class: `pill ${a.ok ? "good" : "bad"}`, text: a.ok ? "ok" : "failed" })),
          el("td", { class: "muted", text: a.error || "" })]));
        body.append(el("div", { class: "card" }, [el("h3", { text: `${r.user} — ${r.home}` }), simpleTable(["Action", "Result", "Detail"], rows)]));
        toast(r.ok ? "Permissions fixed" : "Completed with warnings", r.ok ? "good" : "bad");
      } catch (e) { body.innerHTML = ""; toast(e.message, "bad"); }
    }
  }

  // ---- Domains (vhosts) ----
  // ======================================================================
  //  Domains — cPanel-style list + per-domain Manage page
  // ======================================================================
  const domState = { manage: null };
  const zoneState = { manage: null };
  const openDomain = (name) => { domState.manage = name; navigate("vhosts"); };
  const openZone = (name) => { zoneState.manage = name; navigate("zones"); };

  function sw(checked, onchange, opts = {}) {
    const input = el("input", { type: "checkbox", class: "sw-in", onchange: (e) => onchange(e.target.checked, e.target) });
    input.checked = !!checked;
    if (opts.disabled) input.disabled = true;
    return el("label", { class: `sw ${opts.disabled ? "disabled" : ""}`, title: opts.title || "" }, [input, el("span", { class: "sw-track" }, el("span", { class: "sw-knob" }))]);
  }
  const isIp = (n) => /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(n || "");

  function sslPill(s) {
    if (s.ssl === "none") return el("span", { class: "pill dim", text: "No SSL" });
    const label = { selfsigned: "Self-signed", letsencrypt: "Let's Encrypt", custom: "Custom cert" }[s.ssl] || s.ssl;
    const exp = s.cert_expires ? new Date(s.cert_expires) : null;
    const days = exp ? Math.round((exp - Date.now()) / 864e5) : null;
    const cls = s.ssl === "selfsigned" ? "warn" : days != null && days < 14 ? "bad" : "good";
    return el("span", { class: `pill ${cls}`, title: exp ? `Expires ${exp.toLocaleDateString()}` : "", text: label + (days != null ? ` · ${days}d` : "") });
  }

  function viewDomains(root) {
    if (domState.manage) { const n = domState.manage; domState.manage = null; return viewDomainManage(root, n); }
    const bar = el("div", { class: "dm-bar" });
    const search = el("input", { type: "search", placeholder: "Search domains…", class: "dm-search" });
    const bulk = el("select", { class: "dm-bulk" }, [
      el("option", { value: "", text: "Bulk actions…" }),
      el("option", { value: "force_https:1", text: "Enable Force HTTPS Redirect" }),
      el("option", { value: "force_https:0", text: "Disable Force HTTPS Redirect" }),
      el("option", { value: "enabled:1", text: "Enable site" }),
      el("option", { value: "enabled:0", text: "Disable site" }),
      el("option", { value: "maintenance:1", text: "Turn on maintenance mode" }),
      el("option", { value: "maintenance:0", text: "Turn off maintenance mode" }),
    ]);
    const applyBtn = el("button", { class: "btn btn-sm", text: "Apply" });
    bar.append(search, bulk, applyBtn, el("span", { class: "grow" }),
      el("button", { class: "btn btn-primary", onclick: createDomainModal }, [icon("globe", 15), " Create a New Domain"]));
    const body = el("div", {}, el("div", { class: "loading", text: "Loading…" }));
    root.append(el("p", { class: "muted dm-intro", text: "Manage your websites: document roots, HTTPS, redirects and more. Changes are tested with apache2ctl before they go live." }), bar, body);
    let data = null;
    const selected = new Set();

    function render() {
      body.innerHTML = "";
      if (!data.supported) { body.append(el("p", { class: "empty", text: "Apache is not available on this host." })); return; }
      const q = search.value.trim().toLowerCase();
      const list = data.sites.filter((s) => !q || s.server_name.includes(q) || s.aliases.some((a) => a.includes(q)) || (s.docroot || "").toLowerCase().includes(q));
      const all = el("input", { type: "checkbox", class: "dm-cb", onchange: (e) => { list.filter((s) => !s.system).forEach((s) => e.target.checked ? selected.add(s.server_name) : selected.delete(s.server_name)); render(); } });
      all.checked = list.filter((s) => !s.system).length > 0 && list.filter((s) => !s.system).every((s) => selected.has(s.server_name));
      const rows = list.map((s) => {
        const cb = el("input", { type: "checkbox", class: "dm-cb", onchange: (e) => { e.target.checked ? selected.add(s.server_name) : selected.delete(s.server_name); } });
        cb.checked = selected.has(s.server_name); if (s.system) cb.disabled = true;
        const scheme = s.ssl !== "none" ? "https" : "http";
        return el("tr", { class: s.enabled ? "" : "dm-off" }, [
          el("td", {}, cb),
          el("td", {}, el("div", { class: "dm-name" }, [
            el("a", { href: `${scheme}://${s.server_name}/`, target: "_blank", rel: "noopener", title: "Open site" }, [icon("link", 13), " ", s.server_name]),
            s.aliases.length ? el("span", { class: "dm-alias", text: "+ " + s.aliases.join(", ") }) : null,
            el("span", { class: "dm-tags" }, [
              s.system ? el("span", { class: "pill dim", text: "system" }) : null,
              !s.managed && !s.system ? el("span", { class: "pill dim", title: "Hand-written config — saving it once lets AuroraPanel manage it (original is backed up)", text: "manual" }) : null,
              !s.enabled ? el("span", { class: "pill warn", text: "disabled" }) : null,
              s.maintenance ? el("span", { class: "pill warn", text: "maintenance" }) : null,
            ]),
          ])),
          el("td", {}, el("span", { class: "dm-root" }, [icon("home", 13), " ", s.docroot || "—"])),
          el("td", { class: s.redirect_url ? "" : "muted", text: s.redirect_url || "Not Redirected" }),
          el("td", {}, sw(s.force_https, async (v, inp) => {
            if (v && s.ssl === "none" && !confirmInline(`${s.server_name} has no certificate yet.\n\nA self-signed certificate will be created so HTTPS works now (browsers will warn). You can switch to a free Let's Encrypt certificate in Manage.\n\nContinue?`)) { inp.checked = false; return; }
            try { await API.siteToggle(s.server_name, "force_https", v); toast(`Force HTTPS ${v ? "on" : "off"} · ${s.server_name}`, "good"); load(); }
            catch (e) { inp.checked = !v; toast(e.message, "bad"); }
          }, { disabled: s.system, title: s.system ? "System site" : "Redirect all HTTP traffic to HTTPS" })),
          el("td", {}, sslPill(s)),
          el("td", { class: "actions" }, [
            el("button", { class: "btn btn-sm", onclick: () => openDomain(s.system ? s.conf : s.server_name) }, [icon("services", 13), " Manage"]),
            isIp(s.server_name) ? null : el("button", { class: "btn btn-sm btn-ghost", title: "DNS zone", onclick: () => openZone(s.server_name.replace(/^www\./, "")) }, [icon("zone", 13), " Zone"]),
            isIp(s.server_name) ? null : el("button", { class: "btn btn-sm btn-ghost", title: "DNS & WHOIS check", onclick: () => showDomainInfo(s.server_name) }, icon("search", 13)),
          ].filter(Boolean)),
        ]);
      });
      body.append(el("div", { class: "dm-count muted", text: `Displaying ${list.length} of ${data.sites.length} domain${data.sites.length === 1 ? "" : "s"}` }));
      if (!list.length) { body.append(el("div", { class: "cw-empty" }, [icon("globe", 28), el("b", { text: q ? "No matches" : "No domains yet" }), el("span", { class: "muted", text: "Create one to get a site running on this Pi." })])); return; }
      body.append(el("div", { class: "table-wrap" }, el("table", { class: "dm-table" }, [
        el("thead", {}, el("tr", {}, [el("th", {}, all), ...["Domain", "Document Root", "Redirects To", "Force HTTPS", "SSL", "Actions"].map((h) => el("th", { text: h }))])),
        el("tbody", {}, rows),
      ])));
    }
    const load = async () => { await guardedLoad(async () => { data = await API.sites(); render(); }); };
    search.addEventListener("input", render);
    applyBtn.addEventListener("click", async () => {
      if (!bulk.value) return toast("Pick a bulk action", "bad");
      if (!selected.size) return toast("Select one or more domains first", "bad");
      const [key, v] = bulk.value.split(":");
      applyBtn.disabled = true;
      let ok = 0;
      for (const n of selected) {
        try { await API.siteToggle(n, key, v === "1"); ok++; } catch (e) { toast(`${n}: ${e.message}`, "bad"); }
      }
      applyBtn.disabled = false; selected.clear();
      if (ok) toast(`Updated ${ok} domain(s)`, "good");
      load();
    });
    state.refreshHandler = load; load();
  }

  function createDomainModal() {
    const f = el("div", { class: "dm-form" });
    f.innerHTML = `
      <label class="cw-lbl">Domain or IP address<input id="nd-name" type="text" placeholder="example.com or 192.168.0.100" autocomplete="off" /></label>
      <label class="cw-lbl">Document root<input id="nd-root" type="text" placeholder="/var/www/example.com" /></label>
      <label class="dm-check"><input id="nd-www" type="checkbox" checked /> Also answer on <b id="nd-www-l">www.example.com</b></label>
      <label class="dm-check"><input id="nd-ssl" type="checkbox" /> Create a self-signed certificate &amp; force HTTPS <span class="muted">(switch to Let's Encrypt later)</span></label>
      <label class="dm-check"><input id="nd-zone" type="checkbox" /> Create a DNS zone for it in the Zone Editor</label>
      <p class="muted" style="font-size:12px;margin:4px 0 0">Local names like <code>mysite.test</code> work too — you'll get the hosts-file line to add on your computer. No domain? Enter this Pi's IP to serve a folder at <code>http://&lt;ip&gt;/</code>.</p>`;
    const name = $("#nd-name", f), rootIn = $("#nd-root", f);
    name.addEventListener("input", () => {
      const n = name.value.trim().toLowerCase() || "example.com";
      rootIn.placeholder = `/var/www/${n}`;
      $("#nd-www-l", f).textContent = n.startsWith("www.") ? n.slice(4) : "www." + n;
      const ip = isIp(n);
      ["#nd-www", "#nd-zone"].forEach((id) => { const c = $(id, f); c.disabled = ip; if (ip) c.checked = false; c.parentElement.classList.toggle("dm-dim", ip); });
    });
    const go = el("button", { class: "btn btn-primary", text: "Create domain", onclick: async () => {
      const n = name.value.trim().toLowerCase();
      if (!n) return toast("Enter a domain", "bad");
      const ssl = $("#nd-ssl", f).checked;
      const settings = { server_name: n, docroot: rootIn.value.trim(), aliases: $("#nd-www", f).checked && !isIp(n) ? [n.startsWith("www.") ? n.slice(4) : "www." + n] : [],
        ssl: ssl ? "selfsigned" : "none", force_https: ssl };
      go.disabled = true;
      try {
        const r = await API.siteCreate(settings);
        if ($("#nd-zone", f).checked && !isIp(n)) { try { await API.dnsZoneCreate(n.replace(/^www\./, ""), "", "default"); } catch (e) { toast("Zone: " + e.message, "bad"); } }
        closeModal(); toast(`Created ${r.server_name}`, "good"); openDomain(r.server_name);
      } catch (e) { toast(e.message, "bad"); go.disabled = false; }
    } });
    openModal("Create a new domain", f, [go]);
    setTimeout(() => name.focus(), 30);
  }

  function viewDomainManage(root, name) {
    root.append(el("div", { class: "loading", text: `Loading ${name}…` }));
    const jp = { t: null };
    (state.cleanups = state.cleanups || []).push(() => clearInterval(jp.t));
    const load = async () => {
      let d;
      try { d = await API.siteGet(name); }
      catch (e) { root.innerHTML = ""; root.append(el("div", { class: "cw-empty" }, [icon("error", 28), el("b", { text: e.message }), el("button", { class: "btn btn-sm", text: "← Back to domains", onclick: () => navigate("vhosts") })])); return; }
      render(d);
    };
    state.refreshHandler = load;

    function render(d) {
      const orig = JSON.stringify(d.settings);
      const s = JSON.parse(orig);
      const ro = d.system;
      const ipSite = isIp(d.settings.server_name);
      root.innerHTML = "";
      const dirty = () => { const x = JSON.stringify(s) !== orig; saveBar.classList.toggle("show", x && !ro); };

      const head = el("div", { class: "dmm-head" }, [
        el("button", { class: "btn btn-sm btn-ghost", onclick: () => navigate("vhosts") }, [el("span", { class: "dmm-back", html: "&larr;" }), " Domains"]),
        el("h2", {}, ["Manage ", el("span", { class: "accent", text: `“${d.settings.server_name}”` })]),
        el("span", { class: "grow" }),
        el("a", { class: "btn btn-sm", href: `${d.settings.ssl !== "none" ? "https" : "http"}://${d.settings.server_name}/`, target: "_blank", rel: "noopener" }, [icon("link", 13), " Visit site"]),
      ]);
      root.append(head);
      if (ro) root.append(el("div", { class: "dm-note warn" }, [icon("lock", 15), el("span", { text: "This is a system default site (" + d.conf + "). Its settings are read-only so the panel never breaks Apache's fallback site, but you can turn it on or off." }),
        el("button", { class: "btn btn-sm", style: "margin-left:auto;flex-shrink:0", text: d.enabled ? "Disable site" : "Enable site", onclick: async (e) => {
          e.target.disabled = true;
          try { await API.siteToggle(d.conf, "enabled", !d.enabled); toast(`${d.settings.server_name} ${d.enabled ? "disabled" : "enabled"}`, "good"); load(); }
          catch (err) { toast(err.message, "bad"); e.target.disabled = false; }
        } })]));
      else if (!d.managed) root.append(el("div", { class: "dm-note" }, [icon("error", 15), el("span", { html: `This site uses a hand-written config (<code>${esc(d.conf)}</code>). Settings below were read from it — saving once lets AuroraPanel manage it, and the original is kept as <code>${esc(d.conf)}.aurora-bak</code>.` })]));

      const left = el("div", { class: "dmm-left" }), right = el("div", { class: "dmm-right" });
      root.append(el("div", { class: "dmm-cols" }, [left, right]));

      const card = (ico, title, sub, ...kids) => el("div", { class: "card dmm-card" }, [
        el("div", { class: "cw-card-h" }, [icon(ico, 16), el("div", {}, [el("h3", { text: title }), sub ? el("p", { text: sub }) : null])]), ...kids]);
      const field = (label, input, hint) => el("label", { class: "cw-lbl" }, [label, input, hint ? el("span", { class: "dm-hint", text: hint }) : null]);
      const text = (key, ph) => { const i = el("input", { type: "text", value: s[key] || "", placeholder: ph || "", oninput: (e) => { s[key] = e.target.value; dirty(); } }); if (ro) i.disabled = true; return i; };
      const toggleRow = (key, title, desc, onChange) => el("div", { class: "dm-trow" }, [
        el("div", {}, [el("b", { text: title }), el("span", { text: desc })]),
        sw(s[key], (v) => { s[key] = v; onChange && onChange(v); dirty(); }, { disabled: ro }),
      ]);
      const seg = (key, opts, onChange) => {
        const box = el("div", { class: "cw-seg cw-seg-sm" });
        opts.forEach(([v, l]) => box.append(el("button", { type: "button", class: s[key] === v ? "active" : "", text: l, disabled: ro ? "" : null, onclick: () => {
          s[key] = v; box.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.textContent === l)); onChange && onChange(v); dirty();
        } })));
        return box;
      };

      // ---- General ----
      const chips = el("div", { class: "dm-chips" });
      const drawChips = () => {
        chips.innerHTML = "";
        s.aliases.forEach((a, i) => chips.append(el("span", { class: "dm-chip" }, [a, ro ? null : el("button", { type: "button", title: "Remove", html: "&times;", onclick: () => { s.aliases.splice(i, 1); drawChips(); dirty(); } })])));
        if (!ro) {
          const inp = el("input", { type: "text", placeholder: s.aliases.length ? "add alias…" : "www.example.com, shop.example.com…", onkeydown: (e) => {
            if (e.key === "Enter" || e.key === "," || e.key === " ") {
              e.preventDefault(); const v = inp.value.trim().toLowerCase().replace(/,$/, "");
              if (v && !s.aliases.includes(v)) { s.aliases.push(v); drawChips(); dirty(); chips.querySelector("input").focus(); }
            } else if (e.key === "Backspace" && !inp.value && s.aliases.length) { s.aliases.pop(); drawChips(); dirty(); chips.querySelector("input").focus(); }
          } });
          chips.append(inp);
        }
      };
      drawChips();
      left.append(card("globe", "Update the domain", "Where the files live and which names this site answers on.",
        field("Document root", text("docroot", "/var/www/" + s.server_name), "Apache serves files from this folder. It's created if missing."),
        el("div", { class: "cw-lbl" }, ["Aliases", chips, el("span", { class: "dm-hint", text: "Extra hostnames for this site — press Enter after each." })]),
        ipSite ? null : el("div", { class: "cw-lbl" }, ["www handling", seg("www", [["none", "Leave as is"], ["force_www", "Always www"], ["force_bare", "Never www"]]),
          el("span", { class: "dm-hint", text: "Pick one canonical address so search engines don't see duplicates (301 redirect)." })]),
        toggleRow("enabled", "Site enabled", "Turn off to take the site offline without deleting anything."),
      ));

      // ---- HTTPS ----
      const sslDetail = el("div", { class: "dm-ssl-detail" });
      const certRow = d.cert ? el("div", { class: "dm-cert" }, [icon("lock", 14), el("span", { html: `<b>${esc(d.cert.subject || "")}</b> · issued by ${esc(d.cert.issuer || "?")} · expires <b>${esc(d.cert.expires || "?")}</b>` })]) : null;
      const drawSsl = () => {
        sslDetail.innerHTML = "";
        if (s.ssl === "none") sslDetail.append(el("p", { class: "dm-hint", text: "Visitors can only reach the site over plain http://. Pick a certificate to enable HTTPS." }));
        if (s.ssl === "selfsigned") sslDetail.append(el("p", { class: "dm-hint", text: "A certificate is generated on this Pi (covers the domain + aliases). Encrypts traffic, but browsers show a warning — fine for LAN/.test sites." }));
        if (s.ssl === "custom") sslDetail.append(field("Certificate file (.crt / fullchain.pem)", text("cert", "/etc/ssl/certs/site.crt")), field("Private key", text("key", "/etc/ssl/private/site.key")), field("Chain (optional)", text("chain", "")));
        if (s.ssl === "letsencrypt") {
          const email = el("input", { type: "email", placeholder: "you@example.com", value: (() => { try { return localStorage.getItem("aurora-le-email") || ""; } catch (e) { return ""; } })() });
          const withAliases = el("input", { type: "checkbox" }); withAliases.checked = true;
          const log = el("pre", { class: "log", hidden: true });
          const issue = el("button", { class: "btn btn-primary btn-sm", type: "button", onclick: async () => {
            if (!d.certbot) {
              try { const r = await API.certbotInstall(); follow(r.job, "Installing certbot…", () => load()); } catch (e) { toast(e.message, "bad"); }
              return;
            }
            if (JSON.stringify(s) !== orig) return toast("Save your other changes first", "bad");
            try { localStorage.setItem("aurora-le-email", email.value.trim()); } catch (e) {}
            try { const r = await API.siteLE(d.settings.server_name, email.value.trim(), withAliases.checked); follow(r.job, "Requesting certificate…", async (ok) => {
              if (!ok) return;
              try { const cur = (await API.siteGet(name)).settings; cur.ssl = "letsencrypt"; await API.siteSave(name, cur); toast("Let's Encrypt certificate installed", "good"); } catch (e) { toast(e.message, "bad"); }
              load();
            }); } catch (e) { toast(e.message, "bad"); }
          } }, [icon("lock", 13), d.certbot ? " Issue / renew certificate" : " Install certbot"]);
          function follow(jobId, label, done) {
            log.hidden = false; log.textContent = label; issue.disabled = true;
            clearInterval(jp.t);
            jp.t = setInterval(async () => {
              try {
                const j = await API.job(jobId);
                log.textContent = j.output || label; log.scrollTop = log.scrollHeight;
                if (j.status !== "running") { clearInterval(jp.t); issue.disabled = false; toast(`${j.title}: ${j.status}`, j.status === "done" ? "good" : "bad"); done && done(j.status === "done"); }
              } catch (e) { clearInterval(jp.t); issue.disabled = false; }
            }, 1300);
          }
          sslDetail.append(
            el("p", { class: "dm-hint", html: d.le_available ? "✅ A Let's Encrypt certificate exists for this domain — save to use it. It renews automatically via certbot's timer." : "Free, trusted certificate. The domain must already point at this Pi's <b>public IP</b> and port <b>80</b> must be forwarded to it, so Let's Encrypt can verify it." }),
            field("Email for expiry notices", email),
            el("label", { class: "dm-check" }, [withAliases, " Include aliases (", s.aliases.filter((a) => !a.startsWith("*")).join(", ") || "none", ")"]),
            el("p", { class: "dm-hint", html: "By issuing you agree to the <a href='https://letsencrypt.org/repository/' target='_blank' rel='noopener'>Let's Encrypt Subscriber Agreement</a>." }),
            el("div", {}, issue), log);
        }
      };
      drawSsl();
      const httpsToggles = el("div", {}, [
        toggleRow("force_https", "Force HTTPS redirect", "Send every http:// visit to https:// (301). Let's Encrypt renewals still work."),
        toggleRow("hsts", "HSTS", "Tell browsers to only ever use HTTPS for a year. Enable once HTTPS is working reliably."),
      ]);
      const syncHttps = () => httpsToggles.classList.toggle("dm-dim", s.ssl === "none");
      left.append(card("lock", "HTTPS / SSL", "Encrypt traffic and choose where the certificate comes from.",
        seg("ssl", [["none", "None"], ["selfsigned", "Self-signed"], ...(ipSite ? [] : [["letsencrypt", "Let's Encrypt"]]), ["custom", "Custom"]], (v) => { if (v === "none") { s.force_https = false; s.hsts = false; httpsToggles.querySelectorAll(".sw-in").forEach((i) => { i.checked = false; }); } drawSsl(); syncHttps(); }),
        certRow, sslDetail, httpsToggles));
      syncHttps();

      // ---- Redirect ----
      const code = el("select", { onchange: (e) => { s.redirect_code = +e.target.value; dirty(); } }, [el("option", { value: "301", text: "301 · Permanent" }), el("option", { value: "302", text: "302 · Temporary" })]);
      code.value = String(s.redirect_code || 301); if (ro) code.disabled = true;
      left.append(card("redirect", "Redirect this domain", "Send all visitors (keeping the path) to another address. Leave empty for no redirect.",
        el("div", { class: "dm-row2" }, [field("Redirect to", text("redirect_url", "https://www.example.org")), field("Type", code)])));

      // ---- Performance & security ----
      left.append(card("shield", "Performance & security", "One-click Apache tuning for this site.",
        toggleRow("gzip", "Gzip compression", "Compress HTML, CSS, JS and JSON — pages load faster."),
        toggleRow("cache_static", "Browser caching", "Let browsers keep images, fonts, CSS and JS for a week/month."),
        toggleRow("security_headers", "Security headers", "X-Frame-Options, nosniff and a safe Referrer-Policy."),
        toggleRow("indexes", "Directory listing", "Show a file list for folders without an index page."),
        toggleRow("allow_override", "Allow .htaccess", "Needed by WordPress & most PHP apps (and the Redirects / Indexes tools)."),
        toggleRow("maintenance", "Maintenance mode", "Visitors get a friendly “be right back” page (HTTP 503)."),
      ));

      // ---- Advanced ----
      const custom = el("textarea", { class: "cw-mono", rows: 5, placeholder: "# Extra Apache directives for this site, e.g.\nHeader set X-Robots-Tag \"noindex\"\nProxyPass /api http://127.0.0.1:3000/api", oninput: (e) => { s.custom = e.target.value; dirty(); } });
      custom.value = s.custom || ""; if (ro) custom.disabled = true;
      left.append(card("terminal", "Advanced", "Raw directives added inside the VirtualHost. Validated with apache2ctl before saving.",
        custom,
        el("div", {}, el("button", { class: "btn btn-sm btn-ghost", type: "button", onclick: () => openModal(d.conf, el("pre", { class: "log", text: d.config_text }), []) }, [icon("mime", 13), " View current config file"]))));

      // ---- right column ----
      const info = (k, v) => el("div", { class: "info-row" }, [el("span", { class: "k", text: k }), el("span", { class: "v" }, v)]);
      right.append(el("div", { class: "card" }, [el("h3", { text: "Domain information" }), el("div", { class: "info-list" }, [
        info("Domain", d.settings.server_name),
        info("Aliases", d.settings.aliases.join(", ") || "—"),
        info("Redirects to", d.settings.redirect_url || "Not Redirected"),
        info("Document root", d.settings.docroot),
        info("SSL", sslPill({ ...d.settings, cert_expires: d.cert && d.cert.expires })),
        info("Force HTTPS", d.settings.force_https ? "On" : "Off"),
        info("Status", el("span", { class: `pill ${d.enabled ? "good" : "warn"}`, text: d.enabled ? "enabled" : "disabled" })),
        info("Config", d.conf),
      ])]));
      const res = (ico, label, fn) => el("button", { class: "dm-res", type: "button", onclick: fn }, [icon(ico, 15), el("span", { text: label }), el("span", { class: "tile-chev", text: "›" })]);
      right.append(el("div", { class: "card" }, [el("h3", { text: "Additional resources" }),
        ipSite ? null : res("zone", "Modify the DNS zone", () => openZone(d.settings.server_name.replace(/^www\./, ""))),
        ipSite ? null : res("search", "Check DNS & WHOIS", () => showDomainInfo(d.settings.server_name)),
        res("redirect", "Path redirects (.htaccess)", () => navigate("redirects")),
        res("lock", "SSL/TLS certificates", () => navigate("ssl")),
      ].filter(Boolean)));
      if (!ro) right.append(el("div", { class: "card dm-danger" }, [el("h3", { text: "Remove the domain" }),
        el("p", { class: "muted", html: `Removes the Apache site for <b>${esc(d.settings.server_name)}</b>. Files in <code>${esc(d.settings.docroot)}</code> are kept.` }),
        el("button", { class: "btn btn-danger btn-sm", onclick: async () => {
          if (!confirmInline(`Remove ${d.settings.server_name}? The document root is kept.`)) return;
          try { await API.siteRemove(d.settings.server_name); toast("Domain removed", "good"); navigate("vhosts"); } catch (e) { toast(e.message, "bad"); }
        } }, [icon("error", 13), " Remove domain"])]));

      // ---- save bar ----
      const saveBtn = el("button", { class: "btn btn-primary", onclick: async () => {
        saveBtn.disabled = true;
        try {
          const r = await API.siteSave(name, s);
          toast(r.adopted ? "Saved — AuroraPanel now manages this site" : "Saved & Apache reloaded", "good");
          name = s.server_name; load();
        } catch (e) { openModal("Couldn't save", el("pre", { class: "log", text: e.message }), []); saveBtn.disabled = false; }
      } }, [icon("backup", 14), " Save changes"]);
      const saveBar = el("div", { class: "dm-savebar" }, [el("span", { class: "dm-dot" }), el("span", { text: "Unsaved changes" }), el("span", { class: "grow" }),
        el("button", { class: "btn btn-ghost", text: "Discard", onclick: () => render(d) }), saveBtn]);
      root.append(saveBar);
    }
    load();
  }

  async function showDomainInfo(name) {
    const box = el("div", { class: "loading", text: "Looking up WHOIS + DNS…" });
    openModal(name, box, []);
    let d;
    try { d = await API.domainInfo(name); } catch (e) { box.className = ""; box.textContent = e.message; return; }
    const w = d.whois || {};
    const rows = [];
    rows.push(el("div", { class: "info-row" }, [el("span", { class: "k", text: "Registered" }), el("span", { class: "v" }, el("span", { class: `pill ${d.registered ? "good" : "dim"}`, text: d.registered ? "yes" : "no / unregistered" }))]));
    if (w.expiry) rows.push(infoRow("Expires", w.expiry));
    if (w.registrar) rows.push(infoRow("Registrar", w.registrar));
    if (w.created) rows.push(infoRow("Created", w.created));
    rows.push(infoRow("Resolves to", d.resolved_ip || "—"));
    rows.push(infoRow("This Pi (LAN)", d.local_ip));
    if (d.public_ip) rows.push(infoRow("This Pi (public)", d.public_ip));

    const content = el("div", {}, [el("div", { class: "card", style: "margin-bottom:14px" }, [el("h3", { text: "Domain" }), el("div", { class: "info-list" }, rows)])]);

    if (d.mode === "local") {
      content.append(el("div", { class: "card", style: "margin-bottom:14px" }, [
        el("h3", { text: "🖥 Local / virtual domain — access it from your computer" }),
        el("p", { class: "muted", style: "margin:0 0 8px", text: "This domain isn't publicly registered/pointed here. To open it in your browser, add this line to your hosts file:" }),
        el("pre", { class: "log", text: d.hosts_line }),
        el("p", { class: "muted", style: "font-size:12px", text: "Windows: C:\\Windows\\System32\\drivers\\etc\\hosts   ·   macOS/Linux: /etc/hosts   (edit as administrator/root)" }),
      ]));
    } else {
      content.append(el("div", { class: "card" }, [
        el("h3", { text: "🌐 Make this domain live" }),
        el("p", { class: "muted", style: "margin:0 0 8px", text: "At your registrar's DNS, create this record so the domain points at this Pi:" }),
        el("pre", { class: "log", text: d.dns_record ? `${d.dns_record.type}   ${d.dns_record.name}   →   ${d.dns_record.value}` : "(public IP unavailable — check the Pi's internet)" }),
        el("p", { class: "muted", style: "font-size:12px", text: "Then forward ports 80/443 on your router to this Pi, and issue an SSL cert (Security → SSL/TLS). " + (d.resolves_here_wan ? "✅ It already points here!" : "") }),
      ]));
    }
    openModal(name, content, []);
  }

  // ======================================================================
  //  Network: VPN servers, Dynamic DNS, Port Checker, Network Monitor
  //  Security note: data here includes attacker-controlled text (usernames
  //  from failed logins, log lines, provider replies). It is only ever put
  //  into the DOM via el(..., { text }) / textContent — never `html:`.
  // ======================================================================
  const ago = (ts) => {
    if (!ts) return "never";
    const s = Math.max(0, Math.round(Date.now() / 1000 - ts));
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  };
  const when = (ts) => ts ? new Date(ts * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "—";
  const isIPv4 = (s) => /^\d{1,3}(\.\d{1,3}){3}$/.test(String(s || ""));
  function downloadText(filename, text, mime) {
    const url = URL.createObjectURL(new Blob([text], { type: mime || "text/plain" }));
    const a = el("a", { href: url, download: filename });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  const pill = (text, kind) => el("span", { class: `pill ${kind || "dim"}`, text });
  const row = (...cells) => el("tr", {}, cells.map((c) => el("td", {}, c == null ? "—" : (typeof c === "object" ? c : String(c)))));
  const btn = (text, onclick, cls) => el("button", { class: `btn btn-sm ${cls || ""}`, text, onclick });
  const kv = (pairs) => el("div", { class: "net-kv" }, pairs.filter(Boolean).map(([k, v]) =>
    el("div", {}, [el("span", { class: "net-k", text: k }), typeof v === "object" && v ? v : el("span", { class: "net-v", text: v == null ? "—" : String(v) })])));
  function field(label, input, hint) {
    return el("label", { class: "net-field" }, [el("span", { text: label }), input, hint ? el("small", { class: "dm-hint", text: hint }) : null]);
  }
  function gotoPortCheck(port, proto) { state.portPreset = { port, proto }; navigate("portcheck"); }

  // Watch a background job in the job panel, then call done() once it ends.
  async function watchJob(jp, jobId, label, done) {
    await jp.run(jobId, label);
    const t = setInterval(async () => {
      try { const j = await API.job(jobId); if (j.status !== "running") { clearInterval(t); done && done(j); } }
      catch (e) { clearInterval(t); }
    }, 1500);
    state.cleanups.push(() => clearInterval(t));
  }

  const VPN_INFO = {
    wireguard: { name: "WireGuard", view: "wireguard", icon: "tunnel",
      desc: "Modern, fast and simple. Best choice for phones and laptops — scan a QR code and you're in. Apps for every OS.",
      ports: (s) => [{ port: s.port, proto: "udp" }] },
    openvpn: { name: "OpenVPN", view: "openvpn", icon: "key",
      desc: "The classic. Works almost everywhere, can run over TCP to get through strict networks. One .ovpn file per device.",
      ports: (s) => [{ port: s.port, proto: s.proto }] },
    ipsec: { name: "IPsec / IKEv2", view: "ipsec", icon: "shield",
      desc: "Built into iPhone, Mac, Windows and Android (strongSwan app) — no extra VPN app needed. Username + password login.",
      ports: () => [{ port: 500, proto: "udp" }, { port: 4500, proto: "udp" }] },
  };

  function vpnStatusPill(s) {
    if (!s || s.error) return pill("error", "bad");
    if (!s.installed) return pill("Not installed");
    if (!s.configured) return pill("Not set up", "warn");
    return s.active ? pill("Running", "good") : pill("Stopped", "bad");
  }

  function endpointCard(settings, onSaved) {
    const ep = el("input", { type: "text", value: settings.endpoint || "", placeholder: settings.ddns_hostname || settings.public_ip || "vpn.example.com" });
    const dns = el("input", { type: "text", value: settings.dns || "" });
    const src = { custom: "your custom setting", ddns: "your Dynamic DNS hostname", public_ip: "your current public IP (changes? set up Dynamic DNS)" }[settings.endpoint_source];
    return el("div", { class: "card" }, [
      el("h3", { text: "Where clients connect" }),
      kv([["Clients will connect to", el("b", { text: settings.effective_endpoint || "unknown" })], ["Source", src], ["Public IP right now", settings.public_ip]]),
      el("div", { class: "net-form" }, [
        field("Endpoint override (hostname or IP)", ep, "Leave empty to use Dynamic DNS, or else the public IP."),
        field("DNS servers for VPN clients", dns, "Comma separated IPv4, e.g. 1.1.1.1, 9.9.9.9"),
      ]),
      el("div", { class: "toolbar", style: "margin:12px 0 0" }, [
        btn("Save", async () => {
          try { await API.vpnSettings({ endpoint: ep.value.trim(), dns: dns.value.trim() }); toast("Saved — re-download client configs to pick up changes", "good"); onSaved && onSaved(); }
          catch (e) { toast(e.message, "bad"); }
        }, "btn-primary"),
        btn("Set up Dynamic DNS", () => navigate("dyndns"), "btn-ghost"),
      ]),
    ]);
  }

  // ---- VPN Overview ----
  function viewVPNOverview(root) {
    root.append(el("p", { class: "muted", style: "margin:0 0 14px", text: "Run your own VPN server on this Pi so your devices can reach home — and browse through your home connection — from anywhere. Pick any (or all) of the three; each is independent." }));
    const body = el("div", {}, el("div", { class: "loading", text: "Loading…" }));
    root.append(body);
    const load = () => guardedLoad(async () => {
      const d = await API.vpnOverview();
      body.innerHTML = "";
      const cards = Object.entries(VPN_INFO).map(([k, info]) => {
        const s = d[k] || {};
        const ports = s.error ? [] : info.ports(s);
        const clients = (s.peers || s.clients || s.users || []).filter((c) => !c.revoked);
        return el("div", { class: "card net-vpn-card" }, [
          el("div", { class: "net-card-h" }, [icon(info.icon, 20), el("h3", { text: info.name }), el("span", { style: "flex:1" }), vpnStatusPill(s)]),
          el("p", { class: "muted", text: info.desc }),
          kv([
            ["Port", ports.map((p) => `${p.proto.toUpperCase()} ${p.port}`).join(" + ")],
            s.configured ? ["Clients", `${clients.length} (${clients.filter((c) => c.online).length} online)`] : null,
            s.configured ? ["Subnet", s.subnet] : null,
          ]),
          el("div", { class: "toolbar", style: "margin:auto 0 0" }, [
            btn(s.configured ? "Manage" : s.installed ? "Set up" : "Install", () => navigate(info.view), "btn-primary"),
            ports.length ? btn("Check port", () => gotoPortCheck(ports[0].port, ports[0].proto), "btn-ghost") : null,
          ]),
        ]);
      });
      body.append(el("div", { class: "net-grid" }, cards), endpointCard(d.settings, load),
        el("div", { class: "card" }, [
          el("h3", { text: "Reaching the VPN from outside" }),
          el("p", { class: "muted", text: "Your router must forward the VPN's port to this Pi. Use the Port Checker: it tests the port from the internet, detects double NAT / CGNAT and tells you exactly what to change on the router." }),
          btn("Open Port Checker", () => navigate("portcheck"), "btn-primary"),
        ]));
    });
    state.refreshHandler = load; load();
  }

  // Shared server header: status, controls, self-test, port shortcut.
  function vpnServerCard(kind, s, reload, jp) {
    const info = VPN_INFO[kind];
    const ports = info.ports(s);
    const ctl = async (action) => {
      try { await API.vpnControl(kind, action); toast(`${info.name}: ${action}`, "good"); reload(); } catch (e) { toast(e.message, "bad"); }
    };
    return el("div", { class: "card" }, [
      el("div", { class: "net-card-h" }, [icon(info.icon, 20), el("h3", { text: `${info.name} server` }), el("span", { style: "flex:1" }), vpnStatusPill(s)]),
      kv([
        ["Listening on", ports.map((p) => `${p.proto.toUpperCase()} ${p.port}`).join(" + ")],
        ["VPN subnet", s.subnet],
        ["IP forwarding", pill(s.forwarding ? "on" : "off", s.forwarding ? "good" : "bad")],
        ["NAT for clients", pill(s.nat ? "on" : "off", s.nat ? "good" : "bad")],
        kind === "wireguard" ? ["Server public key", el("code", { class: "net-mono", text: s.public_key })] : null,
        kind === "ipsec" ? ["Certificate issued for", s.host] : null,
      ]),
      el("div", { class: "toolbar", style: "margin:14px 0 0" }, [
        s.active ? btn("Restart", () => ctl("restart")) : btn("Start", () => ctl("start"), "btn-primary"),
        s.active ? btn("Stop", () => { if (confirmInline(`Stop ${info.name}? Connected clients will drop.`)) ctl("stop"); }, "btn-ghost") : null,
        kind !== "ipsec" ? btn("Run self-test", async () => {
          try { const r = await API.vpnSelftest(kind); watchJob(jp, r.job, `${info.name} self-test`, reload); } catch (e) { toast(e.message, "bad"); }
        }) : null,
        ...ports.map((p) => btn(`Check ${p.proto.toUpperCase()} ${p.port}`, () => gotoPortCheck(p.port, p.proto), "btn-ghost")),
      ]),
      kind !== "ipsec" ? el("p", { class: "dm-hint", style: "margin-top:10px", text: "Self-test connects a real temporary client from an isolated network namespace on this Pi, pings through the tunnel and out to the internet, then removes it." }) : null,
    ]);
  }

  // Generic 3-phase VPN view scaffold: install → set up → manage (auto-refresh).
  function vpnView(root, kind, { setupForm, manage }) {
    const info = VPN_INFO[kind];
    const body = el("div", {}, el("div", { class: "loading", text: "Loading…" }));
    root.append(body);
    const jp = jobPanel(root);
    state.cleanups.push(jp.stop);
    let phase = null, parts = null;
    const load = () => guardedLoad(async () => {
      const s = await API.vpn(kind);
      const p = !s.installed ? "install" : !s.configured ? "setup" : "manage";
      if (p !== phase) {
        phase = p; body.innerHTML = ""; parts = null;
        if (p === "install") {
          body.append(installCard(`${info.name} is not installed`, info.desc,
            async () => { try { const r = await API.vpnInstall(kind); watchJob(jp, r.job, `Installing ${info.name}`, load); } catch (e) { toast(e.message, "bad"); } }));
        } else if (p === "setup") {
          body.append(setupForm(s, jp, load));
        } else {
          parts = manage(s, jp, load);
          body.append(parts.node);
        }
      } else if (parts && parts.update) {
        parts.update(s);
      }
    });
    state.refreshHandler = load; load();
    const t = setInterval(() => { if (phase === "manage") load(); }, 5000);
    state.cleanups.push(() => clearInterval(t));
  }

  function subnetInput(v) { return el("input", { type: "text", value: v }); }

  // ---- WireGuard ----
  function viewWireGuard(root) {
    vpnView(root, "wireguard", {
      setupForm(s, jp, reload) {
        const port = el("input", { type: "number", min: 1, max: 65535, value: s.port });
        const subnet = subnetInput(s.subnet);
        const go = btn("Create WireGuard server", async () => {
          go.disabled = true;
          try { await API.vpnSetup("wireguard", { port: +port.value, subnet: subnet.value.trim() }); toast("WireGuard is running", "good"); reload(); }
          catch (e) { toast(e.message, "bad"); go.disabled = false; }
        }, "btn-primary");
        return el("div", { class: "card" }, [
          el("h3", { text: "Set up the WireGuard server" }),
          el("p", { class: "muted", text: "Generates the server keys, creates wg0, enables IP forwarding + NAT and starts it on boot." }),
          el("div", { class: "net-form" }, [field("UDP port", port, "Default 51820. Forward this UDP port on your router."), field("VPN subnet", subnet, "Private range not used on your LAN.")]),
          el("div", { style: "margin-top:14px" }, go),
        ]);
      },
      manage(s, jp, reload) {
        const head = el("div");
        const list = el("div");
        const name = el("input", { type: "text", placeholder: "e.g. phone", maxlength: 32 });
        const tunnel = el("select", {}, [el("option", { value: "full", text: "Full tunnel — all traffic via home" }), el("option", { value: "split", text: "Split — only home network via VPN" })]);
        const add = btn("Add client", async () => {
          try { const r = await API.vpnClientAdd("wireguard", { name: name.value.trim(), tunnel: tunnel.value }); name.value = ""; toast(`Client ${r.name} added (${r.ip})`, "good"); await reload(); showWgConfig(r.name); }
          catch (e) { toast(e.message, "bad"); }
        }, "btn-primary");
        const addCard = el("div", { class: "card" }, [el("h3", { text: "Add a client (device)" }), el("div", { class: "net-form" }, [field("Name", name), field("Routing", tunnel)]), el("div", { style: "margin-top:12px" }, add)]);
        const update = (st) => {
          head.innerHTML = ""; head.append(vpnServerCard("wireguard", st, reload, jp));
          list.innerHTML = "";
          list.append(el("h2", { class: "section-title", text: `Clients (${st.peers.length})` }));
          if (!st.peers.length) { list.append(el("p", { class: "empty", text: "No clients yet — add one below." })); return; }
          list.append(simpleTable(["Name", "VPN IP", "Status", "Last handshake", "Connected from", "Received / Sent", "Routing", ""],
            st.peers.map((p) => row(
              el("b", { text: p.name }), p.ip,
              p.disabled ? pill("disabled") : pill(p.online ? "online" : "offline", p.online ? "good" : "dim"),
              ago(p.latest_handshake), p.endpoint || "—", `${fmtBytes(p.rx)} / ${fmtBytes(p.tx)}`, p.tunnel,
              el("div", { class: "net-actions" }, [
                btn("Config / QR", () => showWgConfig(p.name)),
                btn(p.disabled ? "Enable" : "Disable", async () => { try { await API.wgToggle(p.name, !p.disabled); reload(); } catch (e) { toast(e.message, "bad"); } }, "btn-ghost"),
                btn("Remove", async () => { if (!confirmInline(`Remove client ${p.name}? Its config stops working immediately.`)) return; try { await API.vpnClientRemove("wireguard", p.name); toast("Removed", "good"); reload(); } catch (e) { toast(e.message, "bad"); } }, "btn-danger"),
              ]),
            ))));
        };
        update(s);
        return { node: el("div", {}, [head, list, addCard]), update };
      },
    });
  }
  async function showWgConfig(name) {
    try {
      const c = await API.vpnClientConfig("wireguard", name);
      // QR is shown through <img src=data:>: an SVG loaded as an image can't run script.
      const qr = c.qr_svg ? el("img", { class: "net-qr", alt: "QR code", src: "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(c.qr_svg))) }) : null;
      openModal(`WireGuard — ${name}`, el("div", { class: "net-cfg" }, [
        qr ? el("div", { class: "net-qr-wrap" }, [qr, el("p", { class: "dm-hint", text: "Scan with the WireGuard app (Android / iOS): + → Scan from QR code." })]) : null,
        el("div", {}, [
          el("p", { class: "muted", text: "Desktop: install WireGuard, then Import tunnel from file." }),
          el("pre", { class: "log", text: c.config }),
          el("p", { class: "dm-hint", text: "This file contains the device's private key — treat it like a password." }),
        ]),
      ]), [btn("Download .conf", () => downloadText(c.filename, c.config), "btn-primary")]);
    } catch (e) { toast(e.message, "bad"); }
  }

  // ---- OpenVPN ----
  function openvpnForm(s, label, onGo) {
    const port = el("input", { type: "number", min: 1, max: 65535, value: s.port });
    const proto = el("select", {}, [el("option", { value: "udp", text: "UDP (faster, recommended)" }), el("option", { value: "tcp", text: "TCP (gets through strict firewalls)" })]);
    proto.value = s.proto;
    const subnet = subnetInput(s.subnet);
    const redirect = el("select", {}, [el("option", { value: "1", text: "Full tunnel — all traffic via home" }), el("option", { value: "0", text: "Split — only home network via VPN" })]);
    redirect.value = s.redirect ? "1" : "0";
    const go = btn(label, () => onGo({ port: +port.value, proto: proto.value, subnet: subnet.value.trim(), redirect: redirect.value === "1" }, go), "btn-primary");
    return el("div", {}, [
      el("div", { class: "net-form" }, [field("Port", port, "Default 1194."), field("Protocol", proto), field("VPN subnet", subnet), field("Routing", redirect)]),
      el("div", { style: "margin-top:14px" }, go),
    ]);
  }
  function viewOpenVPN(root) {
    vpnView(root, "openvpn", {
      setupForm(s, jp, reload) {
        return el("div", { class: "card" }, [
          el("h3", { text: "Set up the OpenVPN server" }),
          el("p", { class: "muted", text: "Creates a private certificate authority (EC P-256), server certificate and tls-crypt key, writes the server config, enables forwarding + NAT and starts openvpn-server@aurora. Takes a few seconds." }),
          openvpnForm(s, "Create OpenVPN server", async (body, go) => {
            go.disabled = true;
            try { const r = await API.vpnSetup("openvpn", body); watchJob(jp, r.job, "Setting up OpenVPN", () => { go.disabled = false; reload(); }); }
            catch (e) { toast(e.message, "bad"); go.disabled = false; }
          }),
        ]);
      },
      manage(s, jp, reload) {
        const head = el("div"), banner = el("div"), list = el("div");
        // ---- add user ----
        const name = el("input", { type: "text", placeholder: "e.g. alice", maxlength: 32, autocomplete: "off" });
        const mode = el("select", {}, Object.entries(OVPN_MODES).map(([k, m]) => el("option", { value: k, text: m.label })));
        const modeHelp = el("p", { class: "dm-hint" });
        const pw = passwordField();
        const pwWrap = field("Password (8+ characters)", pw.node, "Leave empty to generate a strong one.");
        const syncMode = () => { modeHelp.textContent = OVPN_MODES[mode.value].help; pwWrap.hidden = mode.value === "cert"; };
        mode.addEventListener("change", syncMode); syncMode();
        const add = btn("Create user", async () => {
          add.disabled = true;
          try {
            const r = await API.ovpnUserAdd(name.value.trim(), mode.value, mode.value === "cert" ? null : pw.value());
            name.value = ""; pw.clear(); reload();
            ovpnCredentials(r, "User created");
          } catch (e) { toast(e.message, "bad"); }
          add.disabled = false;
        }, "btn-primary");
        const settings = el("details", { class: "card net-details" }, [
          el("summary", { text: "Server settings (port, protocol, routing)" }),
          el("p", { class: "dm-hint", text: "Changing port or protocol means every device needs its profile downloaded again." }),
          openvpnForm(s, "Apply & restart", async (body, go) => {
            go.disabled = true;
            try { const r = await API.vpnSetup("openvpn", body); watchJob(jp, r.job, "Reconfiguring OpenVPN", () => { go.disabled = false; reload(); }); }
            catch (e) { toast(e.message, "bad"); go.disabled = false; }
          }),
        ]);
        const addCard = el("div", { class: "card" }, [
          el("h3", { text: "Add a user" }),
          el("p", { class: "muted", text: "Each user gets their own .ovpn profile to import in OpenVPN Connect (any OS). Only you, the panel admin, can create users or change their passwords." }),
          el("div", { class: "net-form" }, [field("Username", name), field("Login type", mode), pwWrap]),
          modeHelp,
          el("div", { style: "margin-top:12px" }, add),
        ]);
        const act = (fn, ok) => async () => { try { await fn(); if (ok) toast(ok, "good"); reload(); } catch (e) { toast(e.message, "bad"); } };
        const update = (st) => {
          head.innerHTML = ""; head.append(vpnServerCard("openvpn", st, reload, jp));
          banner.innerHTML = "";
          if (!st.logins_enabled) banner.append(el("div", { class: "card net-warn" }, [
            el("p", { text: "Per-user logins are not enabled on this server yet. Enabling restarts OpenVPN (connected devices reconnect by themselves). Existing profiles keep working as 'Certificate only' users." }),
            btn("Enable user logins", async (e) => {
              e.target.disabled = true;
              try { const r = await API.vpnSetup("openvpn", { port: st.port, proto: st.proto, subnet: st.subnet, redirect: st.redirect }); watchJob(jp, r.job, "Enabling user logins", reload); }
              catch (err) { toast(err.message, "bad"); e.target.disabled = false; }
            }, "btn-primary"),
          ]));
          addCard.hidden = !st.logins_enabled;
          list.innerHTML = "";
          list.append(el("h2", { class: "section-title", text: `Users (${st.clients.length})` }));
          if (!st.clients.length) { list.append(el("p", { class: "empty", text: "No users yet — add one below." })); return; }
          list.append(simpleTable(["User", "Login type", "Status", "Connected from", "VPN IP", "Received / Sent", ""],
            st.clients.map((c) => row(
              el("b", { text: c.name }),
              pill(c.mode_label || c.mode, c.mode === "cert+password" ? "good" : "dim"),
              c.disabled ? pill("disabled", "bad") : pill(c.online ? (c.sessions > 1 ? `online ×${c.sessions}` : "online") : "offline", c.online ? "good" : "dim"),
              c.real_address || "—", c.virtual_address || "—", c.online ? `${fmtBytes(c.rx)} / ${fmtBytes(c.tx)}` : "—",
              el("div", { class: "net-actions" }, [
                btn("Profile", () => downloadOvpn(c.name)),
                c.mode !== "cert" ? btn("Password", () => ovpnPasswordDialog(c.name, reload)) : null,
                st.logins_enabled ? btn("Login type", () => ovpnModeDialog(c, reload), "btn-ghost") : null,
                st.logins_enabled ? btn(c.disabled ? "Enable" : "Disable", act(() => API.ovpnUserToggle(c.name, !c.disabled), c.disabled ? `${c.name} enabled` : `${c.name} disabled — disconnected`), "btn-ghost") : null,
                btn("Delete", async () => {
                  if (!confirmInline(`Delete user ${c.name}? They are disconnected and their profile stops working for good.`)) return;
                  await act(() => API.vpnClientRemove("openvpn", c.name), `${c.name} deleted`)();
                }, "btn-danger"),
              ]),
            ))));
        };
        update(s);
        return { node: el("div", {}, [head, banner, list, addCard, settings]), update };
      },
    });
  }
  async function downloadOvpn(name) {
    try { const c = await API.vpnClientConfig("openvpn", name); downloadText(c.filename, c.config, "application/x-openvpn-profile"); }
    catch (e) { toast(e.message, "bad"); }
  }

  const OVPN_MODES = {
    "cert+password": { label: "Certificate + password (most secure)",
      help: "The user needs their own profile AND their password. A copied .ovpn file alone is useless." },
    "password": { label: "Password only",
      help: "Everybody can use the same kind of profile — the username + password decide who gets in. Easiest to hand out." },
    "cert": { label: "Certificate only (no password)",
      help: "Whoever has the profile file is in — no password prompt. Keep the file safe." },
  };

  // Random password from the browser's CSPRNG (works on plain-http LAN too).
  function genPassword(len = 16) {
    const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    const buf = new Uint32Array(len); crypto.getRandomValues(buf);
    return Array.from(buf, (n) => abc[n % abc.length]).join("");
  }
  // Clipboard API needs https; fall back to selecting a hidden field + execCommand.
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      const t = el("textarea", { style: "position:fixed;opacity:0;left:-9999px" }); t.value = text;
      document.body.append(t); t.select();
      let ok = false; try { ok = document.execCommand("copy"); } catch (e2) {}
      t.remove(); return ok;
    }
  }
  // Password input with Generate / Show as small icon buttons *inside* the box,
  // so the field always fits its column (no buttons spilling into the next field).
  function passwordField() {
    const inp = el("input", { type: "password", autocomplete: "new-password", placeholder: "optional", maxlength: 128 });
    const iconBtn = (ico, label, onclick) => el("button", { type: "button", class: "net-pw-btn", title: label, "aria-label": label, onclick }, icon(ico, 16));
    const setShown = (on) => {
      inp.type = on ? "text" : "password";
      show.replaceChildren(icon(on ? "eyeOff" : "eye", 16));
      show.title = on ? "Hide password" : "Show password"; show.setAttribute("aria-label", show.title);
      show.setAttribute("aria-pressed", on ? "true" : "false");
    };
    const show = iconBtn("eye", "Show password", () => setShown(inp.type === "password"));
    const gen = iconBtn("wand", "Generate a strong password", () => { inp.value = genPassword(); setShown(true); inp.focus(); });
    return { node: el("div", { class: "net-pw" }, [inp, el("div", { class: "net-pw-btns" }, [gen, show])]),
      value: () => inp.value, clear: () => { inp.value = ""; setShown(false); }, input: inp };
  }
  // Shown once after create / password change — the panel never shows it again.
  function ovpnCredentials(r, title) {
    const rows = [["Username", r.name], ["Login type", (OVPN_MODES[r.mode] || {}).label || r.mode]];
    const body = [kv(rows)];
    if (r.password) {
      const pwBox = el("input", { type: "text", readonly: "readonly", class: "net-mono net-pw-out", value: r.password });
      body.push(el("div", { class: "net-cred" }, [el("span", { class: "net-k", text: "Password" }), pwBox,
        btn("Copy", async () => toast(await copyText(r.password) ? "Password copied" : "Copy failed — select it manually", "good"))]));
      body.push(el("p", { class: "dm-hint", text: "Write it down or send it to the user now — for security it is stored only as a hash and can't be shown again (you can always set a new one)." }));
    }
    if (r.new_profile || title === "User created") body.push(el("p", { class: "muted", text: "Give the user their .ovpn profile and import it in OpenVPN Connect." + (r.password ? " The app asks for the username and password when connecting." : "") }));
    openModal(title, el("div", {}, body), [btn(`Download ${r.name}.ovpn`, () => downloadOvpn(r.name), "btn-primary")]);
  }
  function ovpnPasswordDialog(name, reload) {
    const pw = passwordField();
    const save = btn("Set password", async () => {
      save.disabled = true;
      try { const r = await API.ovpnUserPassword(name, pw.value()); closeModal(); reload(); ovpnCredentials({ ...r, mode: null }, `New password for ${name}`); }
      catch (e) { toast(e.message, "bad"); save.disabled = false; }
    }, "btn-primary");
    openModal(`Change password — ${name}`, el("div", {}, [
      field("New password (8+ characters)", pw.node, "Leave empty to generate a strong one."),
      el("p", { class: "dm-hint", text: "The user is disconnected right away and must log in with the new password. Their profile file stays the same." }),
    ]), [save]);
    setTimeout(() => pw.input.focus(), 30);
  }
  function ovpnModeDialog(c, reload) {
    const sel = el("select", {}, Object.entries(OVPN_MODES).map(([k, m]) => el("option", { value: k, text: m.label })));
    sel.value = c.mode;
    const help = el("p", { class: "dm-hint" });
    const pw = passwordField();
    const pwWrap = field("Password for this user", pw.node, "Needed because this user has no password yet. Leave empty to generate.");
    const sync = () => { help.textContent = OVPN_MODES[sel.value].help; pwWrap.hidden = !(sel.value !== "cert" && c.mode === "cert"); };
    sel.addEventListener("change", sync); sync();
    const save = btn("Change login type", async () => {
      if (sel.value === c.mode) { closeModal(); return; }
      save.disabled = true;
      try { const r = await API.ovpnUserMode(c.name, sel.value, pw.value()); closeModal(); reload(); ovpnCredentials(r, `${c.name}: login type changed`); }
      catch (e) { toast(e.message, "bad"); save.disabled = false; }
    }, "btn-primary");
    openModal(`Login type — ${c.name}`, el("div", {}, [field("Login type", sel), help, pwWrap,
      el("p", { class: "muted", text: "The user is disconnected and needs to import their new profile (download it on the next screen)." })]), [save]);
  }

  // ---- IPsec / IKEv2 ----
  function viewIPsec(root) {
    vpnView(root, "ipsec", {
      setupForm(s, jp, reload) {
        const subnet = subnetInput(s.subnet);
        const go = btn("Create IKEv2 server", async () => {
          go.disabled = true;
          try { const r = await API.vpnSetup("ipsec", { subnet: subnet.value.trim() }); watchJob(jp, r.job, "Setting up strongSwan", () => { go.disabled = false; reload(); }); }
          catch (e) { toast(e.message, "bad"); go.disabled = false; }
        }, "btn-primary");
        return el("div", { class: "card" }, [
          el("h3", { text: "Set up the IPsec / IKEv2 server" }),
          el("p", { class: "muted", text: `Creates a certificate authority and a server certificate for ${s.endpoint || "your public address"} (set Dynamic DNS first if your IP changes — the certificate is tied to the name), then starts strongSwan. Users log in with username + password (EAP-MSCHAPv2).` }),
          el("div", { class: "net-form" }, [field("VPN subnet", subnet)]),
          el("div", { style: "margin-top:14px" }, go),
        ]);
      },
      manage(s, jp, reload) {
        const head = el("div"), warn = el("div"), list = el("div");
        const name = el("input", { type: "text", placeholder: "e.g. iphone", maxlength: 32 });
        const pw = el("input", { type: "text", placeholder: "leave empty to generate" });
        const add = btn("Add user", async () => {
          try {
            const r = await API.vpnClientAdd("ipsec", { name: name.value.trim(), password: pw.value });
            name.value = pw.value = ""; reload(); showIpsecProfiles(r.name);
          } catch (e) { toast(e.message, "bad"); }
        }, "btn-primary");
        const update = (st) => {
          head.innerHTML = ""; head.append(vpnServerCard("ipsec", st, reload, jp));
          warn.innerHTML = "";
          if (st.host_mismatch) warn.append(el("div", { class: "card net-warn" }, [
            el("p", { text: `The server certificate is for ${st.host}, but clients now connect to ${st.endpoint}. Devices will reject the server until the certificate is reissued (then re-install profiles).` }),
            btn(`Reissue certificate for ${st.endpoint}`, async () => { try { const r = await API.vpnSetup("ipsec", { subnet: st.subnet }); watchJob(jp, r.job, "Reissuing certificate", reload); } catch (e) { toast(e.message, "bad"); } }, "btn-primary"),
          ]));
          list.innerHTML = "";
          list.append(el("h2", { class: "section-title", text: `Users (${st.users.length})` }));
          if (!st.users.length) { list.append(el("p", { class: "empty", text: "No users yet — add one below." })); return; }
          list.append(simpleTable(["User", "Status", "Connected from", "VPN IP", "Received / Sent", "Since", ""],
            st.users.map((u) => row(
              el("b", { text: u.name }), pill(u.online ? "online" : "offline", u.online ? "good" : "dim"),
              u.remote || "—", u.virtual_address || "—", u.online ? `${fmtBytes(u.rx)} / ${fmtBytes(u.tx)}` : "—", u.since ? ago(u.since) : "—",
              el("div", { class: "net-actions" }, [
                btn("Profiles", () => showIpsecProfiles(u.name)),
                btn("Remove", async () => { if (!confirmInline(`Remove user ${u.name}?`)) return; try { await API.vpnClientRemove("ipsec", u.name); toast("Removed", "good"); reload(); } catch (e) { toast(e.message, "bad"); } }, "btn-danger"),
              ]),
            ))));
        };
        update(s);
        return { node: el("div", {}, [head, warn, list,
          el("div", { class: "card" }, [el("h3", { text: "Add a user" }), el("div", { class: "net-form" }, [field("Username", name), field("Password (8+ chars)", pw)]), el("div", { style: "margin-top:12px" }, add)])]), update };
      },
    });
  }
  async function showIpsecProfiles(name) {
    try {
      const c = await API.vpnClientConfig("ipsec", name);
      const pwBox = el("code", { class: "net-mono", text: "••••••••" });
      const block = (title, text, dl) => el("div", { class: "net-os" }, [el("h4", { text: title }), el("p", { class: "muted", text }), dl]);
      openModal(`IKEv2 — ${name}`, el("div", {}, [
        kv([["Server", c.host], ["Username", c.name], ["Password", el("span", {}, [pwBox, " ", btn("Show", (e) => { pwBox.textContent = c.password; e.target.remove(); }, "btn-ghost")])], ["Type", "IKEv2, EAP-MSCHAPv2"]]),
        block("iPhone / iPad / Mac", "Download the profile, open it, then install it under Settings → Profile Downloaded (Mac: System Settings → Profiles). CA + VPN + login in one step.",
          btn("Download .mobileconfig", () => downloadText(`aurora-${c.name}.mobileconfig`, c.mobileconfig, "application/x-apple-aspen-config"), "btn-primary")),
        block("Android", "Install the free strongSwan VPN Client app, then open this file with it and enter the password.",
          btn("Download .sswan", () => downloadText(`aurora-${c.name}.sswan`, c.sswan, "application/vnd.strongswan.profile"))),
        block("Windows 10/11", "Download the CA certificate and run the PowerShell below as Administrator in the same folder, then connect from the network menu.",
          el("div", {}, [btn("Download aurora-ca.crt", () => downloadText("aurora-ca.crt", c.ca_pem, "application/x-x509-ca-cert")), el("pre", { class: "log", text: c.windows_ps })])),
        block("Linux / other", "Use the CA certificate with any IKEv2 client (NetworkManager strongSwan plugin): server = the address above, auth = EAP username/password.", null),
      ]), []);
    } catch (e) { toast(e.message, "bad"); }
  }

  // ---- Dynamic DNS ----
  function viewDynDNS(root) {
    const statusBox = el("div"), formBox = el("div");
    root.append(el("p", { class: "muted", style: "margin:0 0 14px", text: "Home internet IPs change. Dynamic DNS gives you a fixed hostname (e.g. myhome.duckdns.org) that this Pi keeps pointed at your current IP — every 5 minutes, even when the panel is closed. VPN clients then connect to the hostname." }), statusBox, formBox);
    let d = null, chosen = null;
    function drawStatus() {
      statusBox.innerHTML = "";
      const c = d.config || {}, last = d.last || {};
      if (d.ddclient_active) statusBox.append(el("div", { class: "card net-warn" }, [
        el("p", { text: "The old ddclient service is also running. Two updaters for the same name fight each other — stop ddclient once you use this page." }),
        btn("Stop & disable ddclient", async () => { try { d = await API.ddnsStopDdclient(); drawStatus(); toast("ddclient stopped", "good"); } catch (e) { toast(e.message, "bad"); } }),
      ]));
      if (!c.provider) return;
      const match = d.resolved_ip && last.ip && d.resolved_ip === last.ip;
      statusBox.append(el("div", { class: "card" }, [
        el("div", { class: "net-card-h" }, [icon("refresh", 20), el("h3", { text: c.hostname || "" }), el("span", { style: "flex:1" }),
          c.enabled ? (last.ok ? pill("Updating", "good") : pill("Failing", "bad")) : pill("Disabled")]),
        kv([
          ["Provider", (d.providers[c.provider] || {}).name || c.provider],
          ["Public IP", last.ip],
          ["Hostname resolves to", el("span", {}, [el("span", { text: d.resolved_ip || "not resolving yet" }), " ", d.resolved_ip ? pill(match ? "matches" : "stale (DNS TTL, wait a few min)", match ? "good" : "warn") : null])],
          ["Last update", `${ago(last.ts)} — ${last.message || ""}`],
          ["Automatic updates", pill(d.timer_active ? "every 5 min" : "off", d.timer_active ? "good" : "dim")],
        ]),
        el("div", { class: "toolbar", style: "margin:14px 0 0" }, [
          btn("Update now", async () => { try { const r = await API.ddnsUpdate(); toast(`Sent ${r.ip}: ${r.message}`, "good"); load(); } catch (e) { toast(e.message, "bad"); load(); } }, "btn-primary"),
          c.enabled ? btn("Disable", async () => { try { d = await API.ddnsDisable(); drawStatus(); } catch (e) { toast(e.message, "bad"); } }, "btn-ghost") : null,
        ]),
      ]));
    }
    function drawForm() {
      formBox.innerHTML = "";
      const c = d.config || {};
      chosen = chosen || c.provider || "duckdns";
      const prov = d.providers[chosen];
      const seg = el("div", { class: "cw-seg" }, Object.entries(d.providers).map(([k, p]) =>
        el("button", { type: "button", class: k === chosen ? "active" : "", text: p.name, onclick: () => { chosen = k; drawForm(); } })));
      const inputs = {};
      const fields = prov.fields.map(([key, label, ph, secret]) => {
        const same = c.provider === chosen;
        const inp = el("input", { type: secret ? "password" : "text", placeholder: secret && same && c[key + "_set"] ? "(saved — leave empty to keep)" : ph || "", autocomplete: "off",
          value: !secret && same && c[key] ? (chosen === "duckdns" && key === "hostname" ? String(c[key]).replace(/\.duckdns\.org$/, "") : c[key]) : "" });
        inputs[key] = inp;
        return field(label, inp);
      });
      const save = btn(c.provider ? "Save & update" : "Save & get my address online", async () => {
        save.disabled = true;
        const vals = {}; for (const [k, i] of Object.entries(inputs)) vals[k] = i.value.trim();
        try { const r = await API.ddnsSave(chosen, vals, true); toast(`${r.config.hostname} → ${r.result ? r.result.ip : "?"}`, "good"); load(); }
        catch (e) { toast(e.message, "bad"); save.disabled = false; }
      }, "btn-primary");
      formBox.append(el("div", { class: "card" }, [
        el("h3", { text: c.provider ? "Change provider / credentials" : "Get a free hostname" }),
        seg,
        el("p", { class: "muted", style: "margin:12px 0" }, [
          el("span", { text: prov.note + " " }),
          prov.signup ? el("a", { href: prov.signup, target: "_blank", rel: "noopener noreferrer", text: `Sign up at ${prov.name} ↗` }) : null,
        ]),
        el("div", { class: "net-form" }, fields),
        el("div", { style: "margin-top:14px" }, save),
      ]));
    }
    const load = () => guardedLoad(async () => { d = await API.ddns(); drawStatus(); drawForm(); });
    state.refreshHandler = load; load();
  }

  // ---- Port Checker ----
  function viewPortCheck(root) {
    const preset = state.portPreset || {}; state.portPreset = null;
    const port = el("input", { type: "number", min: 1, max: 65535, value: preset.port || "", placeholder: "e.g. 51820" });
    let proto = preset.proto || "udp";
    const seg = el("div", { class: "cw-seg cw-seg-sm" }, ["tcp", "udp"].map((p) => el("button", { type: "button", class: p === proto ? "active" : "", text: p.toUpperCase(),
      onclick: (e) => { proto = p; seg.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === e.target)); } })));
    const presets = el("div", { class: "net-presets" });
    const result = el("div");
    const jp = jobPanel(root);
    state.cleanups.push(jp.stop);
    const go = btn("Check port", () => check(), "btn-primary");
    root.prepend(
      el("p", { class: "muted", style: "margin:0 0 14px", text: "Tests whether a port on this Pi can be reached from the internet, and if not, pinpoints where it's blocked: the service, the Pi's firewall, your router, or a second router / ISP NAT in front of it." }),
      el("div", { class: "card" }, [
        el("div", { class: "net-form" }, [field("Port", port), field("Protocol", seg)]),
        presets,
        el("div", { style: "margin-top:14px" }, go),
      ]), result);
    API.vpnOverview().then((o) => {
      const list = [];
      if (o.wireguard && o.wireguard.configured) list.push(["WireGuard", o.wireguard.port, "udp"]);
      if (o.openvpn && o.openvpn.configured) list.push(["OpenVPN", o.openvpn.port, o.openvpn.proto]);
      if (o.ipsec && o.ipsec.configured) list.push(["IPsec IKE", 500, "udp"], ["IPsec NAT-T", 4500, "udp"]);
      list.push(["SSH", 22, "tcp"], ["HTTP", 80, "tcp"], ["HTTPS", 443, "tcp"]);
      presets.append(el("span", { class: "dm-hint", text: "Quick pick: " }), ...list.map(([n, p, pr]) => el("button", { type: "button", class: "cw-chip", text: `${n} ${pr.toUpperCase()} ${p}`,
        onclick: () => { port.value = p; proto = pr; seg.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.textContent.toLowerCase() === pr)); check(); } })));
    }).catch(() => {});

    const line = (ok, title, text) => el("div", { class: `net-chk ${ok === true ? "ok" : ok === false ? "bad" : "unk"}` }, [
      el("span", { class: "net-chk-i", text: ok === true ? "✔" : ok === false ? "✖" : "?" }), el("div", {}, [el("b", { text: title }), el("div", { class: "muted", text })])]);

    async function check() {
      const p = +port.value;
      if (!p) { toast("Enter a port", "bad"); return; }
      go.disabled = true;
      result.innerHTML = ""; result.append(el("div", { class: "loading", text: `Checking ${proto.toUpperCase()} ${p} from outside… (up to ~20 s)` }));
      try { draw(await API.portCheck(p, proto)); }
      catch (e) { result.innerHTML = ""; toast(e.message, "bad"); }
      go.disabled = false;
    }

    function draw(r) {
      result.innerHTML = "";
      const P = `${r.proto.toUpperCase()} ${r.port}`;
      const verdict = { open: ["Open — reachable from the internet", "good"], closed: ["Closed — not reachable from the internet", "bad"], unverified: ["Can't be verified automatically (UDP)", "warn"] }[r.verdict];
      const L = r.listen || {}, F = r.firewall || {}, U = r.upnp || {};
      const checks = [
        line(L.listening ? true : r.temp_listener ? null : false, "Service on this Pi",
          L.listening ? `${L.process || "Something"} is listening on ${L.address}` : r.temp_listener ? "Nothing listens here — a temporary listener was used for the test" : `Nothing is listening on ${P}`),
        line(!F.active || F.allowed ? true : false, "Pi firewall (ufw)", !F.installed ? "Not installed" : !F.active ? "Inactive — not blocking" : F.allowed ? `Allows ${P}` : `Active and does NOT allow ${P}`),
        line(r.nat ? false : U.available ? true : null, "Router / NAT",
          r.nat === "double" ? `Double NAT: your router (${r.gateway}) gets ${U.router_wan_ip} from another router in front of it` :
          r.nat === "cgnat" ? `Carrier-grade NAT: router WAN ${U.router_wan_ip} is not a public address` :
          U.available ? `Router holds the public IP ${r.public_ip}` : "Router doesn't answer UPnP — can't inspect it (that's fine)"),
        r.inner_hop != null ? line(r.inner_hop, `Forward on your router (${r.gateway})`, r.inner_hop ? `Works: ${U.router_wan_ip}:${r.port} reaches this Pi` : `${U.router_wan_ip}:${r.port} does not reach this Pi`) : null,
        line(r.external, "From the internet", r.evidence ? r.evidence : r.external === true ? `${r.public_ip}:${r.port} answered the outside probe` : r.external === false ? `${r.public_ip}:${r.port} did not answer the outside probe` :
          "UDP has no handshake an outside prober can see. It counts as proven once a VPN client connects from outside (e.g. phone on mobile data)."),
      ].filter(Boolean);
      const steps = r.steps.length ? el("ol", { class: "net-steps" }, r.steps.map((s) => el("li", { text: s }))) : null;
      const links = [];
      if (isIPv4(r.gateway)) links.push(el("a", { class: "btn btn-sm", href: `http://${r.gateway}/`, target: "_blank", rel: "noopener noreferrer", text: `Open router ${r.gateway} ↗` }));
      if (r.nat === "double" && isIPv4(r.upstream_router)) links.push(el("a", { class: "btn btn-sm", href: `http://${r.upstream_router}/`, target: "_blank", rel: "noopener noreferrer", text: `Open upstream router ${r.upstream_router} ↗` }));
      const upnp = [];
      if (!U.installed) upnp.push(btn("Install UPnP tools", async () => { try { const j = await API.upnpInstall(); watchJob(jp, j.job, "Installing miniupnpc", () => check()); } catch (e) { toast(e.message, "bad"); } }, "btn-ghost"));
      else if (U.available && !r.upnp_mapping) upnp.push(btn(`Open ${P} automatically (UPnP)`, async () => { try { await API.upnpOpen(r.port, r.proto); toast("Router accepted the mapping", "good"); check(); } catch (e) { toast(e.message, "bad"); } }));
      else if (r.upnp_mapping) upnp.push(btn("Remove UPnP mapping", async () => { try { await API.upnpClose(r.port, r.proto); toast("Mapping removed", "good"); check(); } catch (e) { toast(e.message, "bad"); } }, "btn-ghost"));
      result.append(el("div", { class: "card" }, [
        el("div", { class: "net-card-h" }, [icon("plug", 20), el("h3", { text: P }), el("span", { style: "flex:1" }), pill(verdict[0], verdict[1])]),
        el("div", { class: "net-checks" }, checks),
      ]));
      if (steps) result.append(el("div", { class: "card" }, [
        el("h3", { text: "What to do" }), steps,
        kv([["This Pi (LAN)", r.lan_ip], ["Router", r.gateway], ["Public IP", r.public_ip], ["Protocol", r.proto.toUpperCase()], ["Port", r.port]]),
        el("div", { class: "toolbar", style: "margin:14px 0 0" }, [...links, ...upnp, btn("Check again", () => check(), "btn-primary")]),
        U.available && r.nat === "double" ? el("p", { class: "dm-hint", text: "UPnP only opens your own router — the upstream one still needs a manual forward." }) : null,
      ]));
    }
    if (preset.port) check();
  }

  // ---- Network Monitor ----
  function viewNetMon(root) {
    let hours = 24, scope = "internet";
    const ctrl = el("div", { class: "card net-mon-ctrl" });
    const body = el("div", {}, el("div", { class: "loading", text: "Loading…" }));
    root.append(el("p", { class: "muted", style: "margin:0 0 14px", text: "Who tried to reach this Pi: every new inbound connection attempt (also on closed or firewalled ports), plus logins and VPN handshakes — successful and failed." }), ctrl, body);
    const segOf = (opts, cur, set) => el("div", { class: "cw-seg cw-seg-sm" }, opts.map(([v, l]) => el("button", { type: "button", class: v === cur ? "active" : "", text: l,
      onclick: (e) => { set(v); e.target.parentNode.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === e.target)); load(); } })));
    const tile = (label, value, kind) => el("div", { class: `nm-tile ${kind || ""}` }, [el("div", { class: "nm-tile-v", text: String(value) }), el("div", { class: "nm-tile-l", text: label })]);
    const scopePill = (s) => pill({ internet: "internet", lan: "LAN", private: "private", local: "local" }[s] || s, s === "internet" ? "warn" : "dim");
    const outcomePill = (o) => pill({ ok: "success", fail: "failed", attempt: "attempt" }[o] || o, o === "ok" ? "good" : o === "fail" ? "bad" : "dim");
    // Ban / Trust / Unban for one address, depending on its current status.
    function ipActions(ip, status, scope) {
      if (!ip || scope === "local") return null;
      if (status === "trusted") return el("div", { class: "net-actions" }, [pill("trusted", "good")]);
      if (status === "banned") return el("div", { class: "net-actions" }, [pill("banned", "bad"),
        btn("Unban", async () => { try { await API.guardUnban(ip); toast(`${ip} unbanned`, "good"); load(); } catch (e) { toast(e.message, "bad"); } }, "btn-ghost")]);
      return el("div", { class: "net-actions" }, [btn("Ban", () => banDialog(ip, load), "btn-danger"), btn("Trust", () => trustDialog(ip, load), "btn-ghost")]);
    }
    const load = () => guardedLoad(async () => {
      const d = await API.netmon(hours, scope);
      ctrl.innerHTML = "";
      ctrl.append(...[
        el("div", { class: "net-card-h" }, [icon("radar", 20), el("h3", { text: "Connection logging" }), el("span", { style: "flex:1" }),
          pill(d.logging ? "recording" : "off", d.logging ? "good" : "dim"),
          d.logging ? btn("Turn off", async () => { try { await API.netmonLogging(false); load(); } catch (e) { toast(e.message, "bad"); } }, "btn-ghost")
                    : btn("Turn on", async () => { try { await API.netmonLogging(true); toast("Recording new connection attempts", "good"); load(); } catch (e) { toast(e.message, "bad"); } }, "btn-primary")]),
        !d.logging ? el("p", { class: "dm-hint", text: d.nft ? "Off: only logins and VPN events are shown. Turn on to also record every inbound connection attempt (rate-limited, stored in the system journal)." : "nftables is not installed — install any VPN first to enable connection logging." }) : null,
        el("div", { class: "toolbar", style: "margin:12px 0 0" }, [
          segOf([["internet", "Internet only"], ["all", "Everything"], ["lan", "LAN only"]], scope, (v) => { scope = v; }),
          segOf([[1, "1 h"], [24, "24 h"], [168, "7 days"]], hours, (v) => { hours = v; }),
        ]),
      ].filter(Boolean));
      body.innerHTML = "";
      const top = d.ports[0];
      body.append(el("div", { class: "nm-tiles" }, [
        tile("connection attempts", d.total), tile("unique sources", d.sources.length),
        tile("failed logins", d.failed_logins, d.failed_logins ? "bad" : ""), tile("blocked by bans", d.blocked_total || 0),
        tile("most targeted", top ? `${top.service || "port"} ${top.port ?? ""}` : "—"),
      ]));
      body.append(el("div", { class: "toolbar" }, [btn("Bans & trusted list", () => navigate("ipblocker"), "btn-ghost"), btn("Fail2ban", () => navigate("leech"), "btn-ghost")]));
      body.append(el("h2", { class: "section-title", text: "Logins & VPN events" }));
      body.append(d.events.length ? simpleTable(["When", "Via", "Result", "User", "From", ""],
        d.events.slice(0, 150).map((e) => {
          const tr = row(when(e.ts), e.source, outcomePill(e.outcome), e.user || "—", el("span", {}, [el("span", { text: e.ip || "—" }), " ", e.scope ? scopePill(e.scope) : null]),
            ipActions(e.ip, e.status, e.scope));
          tr.title = e.detail || "";
          return tr;
        })) : el("p", { class: "empty", text: "No login or VPN events in this period." }));
      body.append(el("h2", { class: "section-title", text: "Sources" }));
      body.append(d.sources.length ? simpleTable(["IP address", "Where", "Attempts", "Ports tried", "First seen", "Last seen", ""],
        d.sources.map((s) => row(el("code", { class: "net-mono", text: s.ip }), scopePill(s.scope),
          s.blocked ? `${s.count} (${s.blocked} blocked)` : s.count,
          el("div", { class: "net-chips" }, s.ports.map((p) => el("span", { class: "net-chip", text: `${p.key}${p.count > 1 ? " ×" + p.count : ""}` }))),
          ago(s.first), ago(s.last), ipActions(s.ip, s.status, s.scope))))
        : el("p", { class: "empty", text: d.logging ? "No connection attempts recorded in this period." : "Connection logging is off." }));
      if (d.ports.length) {
        body.append(el("h2", { class: "section-title", text: "Targeted ports" }));
        body.append(simpleTable(["Port", "Service", "Attempts", "Sources"], d.ports.map((p) => row(`${p.port ?? "—"}/${p.proto}`, p.service || "—", p.count, p.sources))));
      }
      if (d.recent.length) {
        body.append(el("h2", { class: "section-title", text: "Latest attempts" }));
        body.append(simpleTable(["When", "From", "To port", "Service", "Result"],
          d.recent.slice(0, 100).map((c) => row(when(c.ts), c.src, `${c.port ?? "—"}/${c.proto}`, c.service || "—",
            c.blocked ? pill("blocked (banned)", "bad") : pill("reached the Pi", "dim")))));
      }
    });
    state.refreshHandler = load; load();
    const t = setInterval(load, 20000);
    state.cleanups.push(() => clearInterval(t));
  }

  // ======================================================================
  //  Zone Editor — structured DNS records
  // ======================================================================
  const REC_TYPES = ["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV", "CAA"];
  const REC_HELP = {
    A: "Points a name at an IPv4 address.", AAAA: "Points a name at an IPv6 address.",
    CNAME: "Makes a name an alias of another hostname.", MX: "Where email for the domain is delivered.",
    TXT: "Free text — SPF, DKIM, DMARC, site verification…", NS: "Delegates a name to nameservers.",
    SRV: "Service location (e.g. _sip._tcp).", CAA: "Which CAs may issue certificates.",
  };
  const TTL_OPTS = [[300, "5 min"], [3600, "1 hour"], [14400, "4 hours"], [86400, "1 day"]];
  const dot = (s) => String(s || "").replace(/\.$/, "");

  function recordSummary(r) {
    const t = r.type;
    if (t === "A" || t === "AAAA") return esc(r.address);
    if (t === "CNAME" || t === "NS") return esc(dot(r.target));
    if (t === "MX") return `<b>Priority:</b> ${r.priority}<br><b>Destination:</b> ${esc(dot(r.target))}`;
    if (t === "SRV") return `<b>Priority:</b> ${r.priority} &nbsp;<b>Weight:</b> ${r.weight} &nbsp;<b>Port:</b> ${r.port}<br><b>Target:</b> ${esc(dot(r.target))}`;
    if (t === "TXT") return `<span class="zn-txt">${esc(r.text)}</span>`;
    if (t === "CAA") return `${r.flags} <b>${esc(r.tag)}</b> “${esc(r.value)}”`;
    return esc(r.raw || "");
  }

  // Record form: returns { node, read() }
  function recordForm(domain, rec, lockType) {
    const r = { type: "A", name: "", ttl: 14400, ...rec };
    const node = el("div", { class: "zn-form" });
    const typeSel = el("select", { class: "zn-type" }, REC_TYPES.map((t) => el("option", { value: t, text: t })));
    typeSel.value = r.type; if (lockType) typeSel.disabled = true;
    const nameIn = el("input", { type: "text", value: r.name ? dot(r.name) : "", placeholder: `sub  or  ${domain}` });
    const ttlIn = el("input", { type: "number", min: 60, max: 604800, value: r.ttl });
    const ttlQuick = el("select", { class: "zn-ttlq", onchange: (e) => { if (e.target.value) ttlIn.value = e.target.value; e.target.value = ""; } },
      [el("option", { value: "", text: "⏱" }), ...TTL_OPTS.map(([v, l]) => el("option", { value: v, text: l }))]);
    const fields = el("div", { class: "zn-fields" });
    const help = el("div", { class: "dm-hint" });
    const inp = (key, ph, type = "text", val) => el("input", { type, "data-k": key, placeholder: ph, value: val != null ? val : (r[key] != null ? (key === "target" ? dot(r[key]) : r[key]) : "") });
    const lab = (l, i, cls) => el("label", { class: `cw-lbl ${cls || ""}` }, [l, i]);
    function draw() {
      const t = typeSel.value;
      fields.innerHTML = ""; help.textContent = REC_HELP[t] || "";
      if (t === "A") fields.append(lab("IPv4 address", inp("address", "203.0.113.10")));
      if (t === "AAAA") fields.append(lab("IPv6 address", inp("address", "2001:db8::1")));
      if (t === "CNAME") fields.append(lab("Points to (hostname)", inp("target", domain)));
      if (t === "NS") fields.append(lab("Nameserver", inp("target", "ns1.example.net")));
      if (t === "MX") fields.append(lab("Priority", inp("priority", "10", "number", r.priority != null ? r.priority : 10), "zn-narrow"), lab("Mail server", inp("target", "mail." + domain)));
      if (t === "SRV") fields.append(lab("Priority", inp("priority", "0", "number", r.priority != null ? r.priority : 0), "zn-narrow"), lab("Weight", inp("weight", "0", "number", r.weight != null ? r.weight : 0), "zn-narrow"), lab("Port", inp("port", "443", "number"), "zn-narrow"), lab("Target", inp("target", domain)));
      if (t === "TXT") {
        const ta = el("textarea", { "data-k": "text", rows: 2, class: "cw-mono", placeholder: "v=spf1 a mx ~all" }); ta.value = r.text || "";
        const presets = el("div", { class: "zn-presets" }, [["SPF", `v=spf1 a mx ~all`], ["DMARC", "v=DMARC1; p=none; rua=mailto:postmaster@" + domain], ["Google verify", "google-site-verification="]].map(([l, v]) =>
          el("button", { type: "button", class: "cw-chip", text: l, onclick: () => { ta.value = v; if (l === "DMARC" && !nameIn.value) nameIn.value = "_dmarc"; } })));
        fields.append(lab("Text value", ta, "zn-wide"), presets);
      }
      if (t === "CAA") {
        const tag = el("select", { "data-k": "tag" }, ["issue", "issuewild", "iodef"].map((x) => el("option", { value: x, text: x }))); tag.value = r.tag || "issue";
        fields.append(lab("Flags", inp("flags", "0", "number", r.flags != null ? r.flags : 0), "zn-narrow"), lab("Tag", tag, "zn-narrow"), lab("Value", inp("value", "letsencrypt.org")));
      }
    }
    typeSel.addEventListener("change", draw);
    draw();
    node.append(el("div", { class: "zn-row1" }, [lab("Name", nameIn, "zn-name"), lab("TTL (seconds)", el("span", { class: "zn-ttl" }, [ttlIn, ttlQuick]), "zn-ttlw"), lab("Type", typeSel, "zn-narrow")]), fields, help);
    return {
      node,
      read() {
        const out = { type: typeSel.value, name: nameIn.value.trim() || "@", ttl: +ttlIn.value || 14400 };
        fields.querySelectorAll("[data-k]").forEach((i) => { out[i.dataset.k] = i.type === "number" ? +i.value : i.value.trim(); });
        return out;
      },
      focus() { (nameIn.value ? fields.querySelector("[data-k]") : nameIn)?.focus(); },
    };
  }

  function quickAddRecord(domain, type, done) {
    const f = recordForm(domain, { type }, false);
    const go = el("button", { class: "btn btn-primary", text: `Add ${type} record`, onclick: async () => {
      go.disabled = true;
      try { await API.dnsRecordAdd(domain, f.read()); closeModal(); toast(`${type} record added to ${domain}`, "good"); done && done(); }
      catch (e) { toast(e.message, "bad"); go.disabled = false; }
    } });
    openModal(`Add a record · ${domain}`, f.node, [go]);
    setTimeout(() => f.focus(), 40);
  }

  function createZoneModal(domain, done) {
    const body = el("div", { class: "dm-form" });
    body.innerHTML = `
      <label class="cw-lbl">Domain<input id="zc-d" type="text" placeholder="example.com" /></label>
      <div class="cw-lbl">Start from</div>
      <label class="dm-check"><input type="radio" name="zc-m" value="default" checked /> <span><b>Point at this Pi</b> — NS, A, www, mail, MX and SPF records like a fresh cPanel zone</span></label>
      <label class="dm-check"><input type="radio" name="zc-m" value="import" /> <span><b>Import current public DNS</b> — copies what the internet sees today (A, AAAA, CNAME, MX, TXT, NS, CAA)</span></label>
      <label class="cw-lbl" id="zc-ipw">IP address for the records<input id="zc-ip" type="text" placeholder="this Pi's LAN IP" /></label>
      <p class="dm-hint">Use your <b>public IP</b> if the domain should be reachable from the internet, or the LAN IP for a home-only domain.</p>`;
    const dIn = $("#zc-d", body); dIn.value = domain || "";
    body.querySelectorAll("[name=zc-m]").forEach((r) => r.addEventListener("change", () => { $("#zc-ipw", body).hidden = body.querySelector("[name=zc-m]:checked").value === "import"; }));
    API.domainInfo(domain || "example.com").then((i) => { $("#zc-ip", body).placeholder = `LAN ${i.local_ip}${i.public_ip ? "  ·  public " + i.public_ip : ""}`; }).catch(() => {});
    const go = el("button", { class: "btn btn-primary", text: "Create zone", onclick: async () => {
      go.disabled = true;
      try { const d = dIn.value.trim().toLowerCase(); await API.dnsZoneCreate(d, $("#zc-ip", body).value.trim(), body.querySelector("[name=zc-m]:checked").value); closeModal(); toast(`Zone created for ${d}`, "good"); done ? done(d) : openZone(d); }
      catch (e) { toast(e.message, "bad"); go.disabled = false; }
    } });
    openModal("Create a DNS zone", body, [go]);
  }

  function zoneBanner(bind) {
    if (bind) return el("div", { class: "dm-note good" }, [icon("shield", 15), el("span", { text: "BIND9 is running on this Pi — saved zones are served immediately." })]);
    return el("div", { class: "dm-note" }, [icon("error", 15), el("span", { html: "BIND9 isn't installed, so this Pi isn't answering DNS yet. Zones are still validated and saved — <b>Export</b> them to your registrar's DNS panel, or install BIND9 to serve them yourself." }),
      el("button", { class: "btn btn-sm", onclick: async (e) => {
        if (!confirmInline("Install BIND9 (apt-get install bind9)?")) return;
        e.target.disabled = true;
        try { const r = await API.bindInstall(); toast("Installing BIND9…", "good"); const t = setInterval(async () => { const j = await API.job(r.job); if (j.status !== "running") { clearInterval(t); toast(`BIND9: ${j.status}`, j.status === "done" ? "good" : "bad"); navigate("zones"); } }, 2000); }
        catch (err) { toast(err.message, "bad"); e.target.disabled = false; }
      } }, "Install BIND9")]);
  }

  function viewZoneEditor(root) {
    if (zoneState.manage) { const d = zoneState.manage; zoneState.manage = null; return viewZoneManage(root, d); }
    const search = el("input", { type: "search", placeholder: "Filter by domain…", class: "dm-search" });
    const body = el("div", {}, el("div", { class: "loading", text: "Loading…" }));
    const bannerBox = el("div");
    root.append(el("p", { class: "muted dm-intro", text: "DNS turns domain names into IP addresses. Create a zone per domain and manage its records here — every change is checked with named-checkzone before it's saved." }),
      bannerBox, el("div", { class: "dm-bar" }, [search, el("span", { class: "grow" }), el("button", { class: "btn btn-primary", onclick: () => createZoneModal("", null) }, [icon("zone", 15), " Create a zone"])]), body);
    let data;
    function render() {
      body.innerHTML = "";
      const q = search.value.trim().toLowerCase();
      const rows = [
        ...data.zones.map((z) => ({ domain: z.domain, zone: z })),
        ...data.without_zone.map((d) => ({ domain: d, zone: null })),
      ].filter((x) => !q || x.domain.includes(q)).sort((a, b) => a.domain.localeCompare(b.domain));
      body.append(el("div", { class: "dm-count muted", text: `Displaying ${rows.length} domain${rows.length === 1 ? "" : "s"}` }));
      if (!rows.length) { body.append(el("div", { class: "cw-empty" }, [icon("zone", 28), el("b", { text: "No zones yet" }), el("span", { class: "muted", text: "Create a zone for a domain you own — or add a site in Domains first." })])); return; }
      body.append(el("div", { class: "table-wrap" }, el("table", { class: "dm-table" }, [
        el("thead", {}, el("tr", {}, ["Domain", "Zone", "Actions"].map((h) => el("th", { text: h })))),
        el("tbody", {}, rows.map((x) => el("tr", {}, [
          el("td", {}, x.zone ? el("a", { class: "zn-dom", href: "#", onclick: (e) => { e.preventDefault(); openZone(x.domain); }, text: x.domain }) : el("span", { text: x.domain })),
          el("td", {}, x.zone ? el("span", { class: "pill good", text: `${x.zone.records} records` }) : el("span", { class: "pill dim", text: "no zone" })),
          el("td", { class: "actions" }, x.zone ? [
            ...["A", "CNAME", "MX"].map((t) => el("button", { class: "btn btn-sm", onclick: () => quickAddRecord(x.domain, t, load) }, ["+ ", t, " Record"])),
            el("button", { class: "btn btn-sm btn-ghost", onclick: () => openZone(x.domain) }, [icon("services", 13), " Manage"]),
          ] : [el("button", { class: "btn btn-sm btn-primary", onclick: () => createZoneModal(x.domain, () => load()) }, [icon("zone", 13), " Create zone"])]),
        ]))),
      ])));
    }
    const load = async () => { await guardedLoad(async () => { data = await API.dnsZones(); bannerBox.innerHTML = ""; bannerBox.append(zoneBanner(data.bind_installed)); render(); }); };
    search.addEventListener("input", render);
    state.refreshHandler = load; load();
  }

  function viewZoneManage(root, domain) {
    const filt = { q: "", type: "All" };
    let z = null, editing = null; // editing: index | "new"
    const load = async () => {
      try { z = await API.dnsZone(domain); }
      catch (e) {
        root.innerHTML = "";
        root.append(el("div", { class: "cw-empty" }, [icon("zone", 28), el("b", { text: e.message }),
          el("div", { style: "display:flex;gap:8px" }, [el("button", { class: "btn btn-sm btn-primary", text: `Create zone for ${domain}`, onclick: () => createZoneModal(domain, () => load()) }),
            el("button", { class: "btn btn-sm", text: "← Zone Editor", onclick: () => navigate("zones") })])]));
        return;
      }
      render();
    };
    state.refreshHandler = load;
    const done = (msg) => { toast(msg, "good"); editing = null; load(); };

    function render() {
      root.innerHTML = "";
      const nsMatch = z.ns_live.length && z.ns_zone.length && z.ns_live.join() === z.ns_zone.join();
      root.append(el("div", { class: "dmm-head" }, [
        el("button", { class: "btn btn-sm btn-ghost", onclick: () => navigate("zones") }, [el("span", { html: "&larr;" }), " Zone Editor"]),
        el("h2", {}, ["Zone records for ", el("span", { class: "accent", text: `“${domain}”` })]),
        el("span", { class: "grow" }),
        el("button", { class: "btn btn-sm", onclick: () => openDomain(domain) }, [icon("globe", 13), " Domain settings"]),
      ]));
      root.append(zoneBanner(z.bind_installed));
      root.append(el("div", { class: "zn-ns" }, [
        el("span", { class: "muted", text: "Nameservers in this zone:" }), ...(z.ns_zone.length ? z.ns_zone.map((n) => el("span", { class: "zn-nschip", text: n })) : [el("span", { class: "muted", text: "none" })]),
        el("span", { class: "zn-sep" }),
        el("span", { class: "muted", text: "Live (registrar):" }), ...(z.ns_live.length ? z.ns_live.map((n) => el("span", { class: `zn-nschip ${nsMatch ? "ok" : "live"}`, text: n })) : [el("span", { class: "muted", text: "not resolving" })]),
        !nsMatch && z.ns_live.length ? el("span", { class: "dm-hint", text: "Live DNS is served elsewhere — copy records there, or point the registrar at your nameservers." }) : null,
      ]));

      const typeChips = el("div", { class: "zn-typef" }, ["All", ...REC_TYPES].map((t) => {
        const n = t === "All" ? z.records.length : z.records.filter((r) => r.type === t).length;
        if (t !== "All" && !n) return null;
        return el("button", { type: "button", class: `zn-tf ${filt.type === t ? "on" : ""}`, onclick: () => { filt.type = t; render(); } }, [t, el("small", { text: n })]);
      }));
      const q = el("input", { type: "search", class: "dm-search", placeholder: "Filter by name…", value: filt.q, oninput: (e) => { filt.q = e.target.value; drawTable(); } });
      const addSel = el("select", { class: "zn-addsel", onchange: (e) => { if (e.target.value) { editing = "new:" + e.target.value; drawTable(); } e.target.value = ""; } },
        [el("option", { value: "", text: "+ Add Record" }), ...REC_TYPES.map((t) => el("option", { value: t, text: `${t} — ${REC_HELP[t].split(" —")[0].replace(/\.$/, "")}` }))]);
      root.append(el("div", { class: "dm-bar" }, [q, typeChips, el("span", { class: "grow" }), addSel,
        el("button", { class: "btn btn-sm", onclick: exportZone }, [icon("mime", 13), " Export"]),
        el("button", { class: "btn btn-sm btn-danger", title: "Delete zone", onclick: async () => {
          if (!confirmInline(`Delete the whole DNS zone for ${domain}? (a backup copy of the file is kept)`)) return;
          try { await API.dnsZoneDelete(domain); toast("Zone deleted", "good"); navigate("zones"); } catch (e) { toast(e.message, "bad"); }
        } }, icon("error", 13))]));
      const tableBox = el("div");
      root.append(tableBox);
      root.append(el("p", { class: "dm-hint zn-foot", text: `SOA serial ${z.soa.serial} · refresh ${z.soa.refresh}s · default TTL ${z.ttl}s — the serial is bumped automatically on every save.` }));

      function drawTable() {
        tableBox.innerHTML = "";
        const rows = [];
        if (editing && String(editing).startsWith("new:")) rows.push(editRow(null, { type: editing.slice(4), ttl: 14400 }));
        z.records.forEach((r, i) => {
          if (filt.type !== "All" && r.type !== filt.type) return;
          if (filt.q && !r.name.includes(filt.q.toLowerCase())) return;
          rows.push(editing === i ? editRow(i, r) : el("tr", {}, [
            el("td", { class: "zn-name", text: r.name }),
            el("td", { class: "muted", text: r.ttl }),
            el("td", {}, el("span", { class: `zn-badge t-${r.type}`, text: r.type })),
            el("td", { class: "zn-rec", html: recordSummary(r) }),
            el("td", { class: "actions" }, [
              el("button", { class: "btn btn-sm", onclick: () => { editing = i; drawTable(); } }, [icon("indexes", 12), " Edit"]),
              el("button", { class: "btn btn-sm btn-danger", onclick: async () => {
                if (!confirmInline(`Delete ${r.type} record ${r.name}?`)) return;
                try { await API.dnsRecordDelete(domain, i, { name: r.name, type: r.type }); done("Record deleted"); } catch (e) { toast(e.message, "bad"); }
              } }, [icon("error", 12), " Delete"]),
            ]),
          ]));
        });
        if (!rows.length) { tableBox.append(el("p", { class: "empty", text: "No records match." })); return; }
        tableBox.append(el("div", { class: "table-wrap" }, el("table", { class: "dm-table zn-table" }, [
          el("thead", {}, el("tr", {}, ["Name", "TTL", "Type", "Record", "Actions"].map((h) => el("th", { text: h })))),
          el("tbody", {}, rows),
        ])));
        const f = tableBox.querySelector(".zn-editrow input, .zn-editrow textarea");
        if (f) f.focus();
      }
      function editRow(index, r) {
        const f = recordForm(domain, r, index != null);
        const save = el("button", { class: "btn btn-sm btn-primary", onclick: async () => {
          save.disabled = true;
          try {
            if (index == null) await API.dnsRecordAdd(domain, f.read());
            else await API.dnsRecordUpdate(domain, index, f.read(), { name: r.name, type: r.type });
            done(index == null ? "Record added" : "Record saved");
          } catch (e) { toast(e.message, "bad"); save.disabled = false; }
        } }, index == null ? "Add record" : "Save record");
        const cancel = el("button", { class: "btn btn-sm btn-ghost", text: "Cancel", onclick: () => { editing = null; drawTable(); } });
        f.node.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.tagName === "INPUT") save.click(); if (e.key === "Escape") cancel.click(); });
        return el("tr", { class: "zn-editrow" }, el("td", { colspan: 5 }, [f.node, el("div", { class: "zn-editact" }, [cancel, save])]));
      }
      drawTable();
    }
    function exportZone() {
      const pre = el("pre", { class: "log", text: z.zone_text });
      const copy = el("button", { class: "btn btn-primary", text: "Copy", onclick: async () => { try { await navigator.clipboard.writeText(z.zone_text); toast("Zone file copied", "good"); } catch (e) { toast("Select the text and copy it manually", "bad"); } } });
      openModal(`db.${domain}`, el("div", {}, [el("p", { class: "dm-hint", text: "Standard BIND zone file — most registrars and DNS hosts (Cloudflare, Namecheap…) can import it." }), pre]), [copy]);
    }
    load();
  }

  // ---- MySQL / MariaDB (Manage Databases) ----
  function viewMySQL(root) {
    subTabs(root, [["mysql", "MariaDB / MySQL"], ["pgsql", "PostgreSQL"]], (tab, pane) => tab === "pgsql" ? pgManager(pane) : mysqlManager(pane));
  }

  // Shared bits of the MariaDB and PostgreSQL pages.
  const dbChk = (label, checked, hint) => {
    const c = el("input", { type: "checkbox" }); c.checked = !!checked;
    return { input: c, node: el("label", { class: "dm-check" }, [c, el("span", {}, [label, hint ? el("span", { class: "muted", text: ` — ${hint}` }) : null].filter(Boolean))]) };
  };
  const dbPwField = () => {
    const inp = el("input", { type: "text", placeholder: "password (6+ characters)", autocomplete: "new-password", spellcheck: "false", style: "min-width:0;flex:1" });
    return { input: inp, node: el("div", { class: "toolbar", style: "margin:0;flex-wrap:nowrap" }, [inp,
      btn("Generate", () => { inp.value = genPassword(18); }, "btn-ghost"),
      btn("Copy", async () => { if (!inp.value) return toast("Nothing to copy yet", "bad"); toast(await copyText(inp.value) ? "Password copied" : "Copy failed", "good"); }, "btn-ghost")]) };
  };
  const MY_HOSTS = [["localhost", "This Pi only (localhost)"], ["%", "Any computer (%)"]];
  const myHostLabel = (h) => h === "localhost" ? "this Pi only" : h === "%" ? "any computer" : h;
  const myHostSelect = () => el("select", {}, MY_HOSTS.map(([v, t]) => el("option", { value: v, text: t })));
  const MY_HOST_HINT = "Apps on this Pi use localhost. “Any computer” also needs MariaDB to listen on the network (System Applications → MariaDB → configure).";

  // ---- Manage Databases → MariaDB / MySQL ----
  function mysqlManager(root) {
    const body = el("div", {}, el("div", { class: "loading", text: "Loading…" }));
    root.append(body);
    const jp = jobPanel(root);
    state.cleanups.push(jp.stop);
    // Every action reloads afterwards — also on failure, so a server that went away shows the install/start card.
    const call = async (fn, okMsg) => {
      try { const r = await fn(); if (okMsg) toast(okMsg, "good"); load(); return r || true; }
      catch (e) { toast(e.message, "bad"); load(); return null; }
    };
    const manageable = (u) => !u.system && !u.app;

    function phpMyAdminCard(p) {
      let status, actions;
      if (!p.installed) {
        status = pill("not installed", "dim");
        actions = [btn("Install phpMyAdmin", async () => {
          const r = await call(() => API.phpmyadminInstall());
          if (r && r.job) watchJob(jp, r.job, "Installing phpMyAdmin…", load);
        }, "btn-primary")];
      } else if (!p.apache) {
        status = pill("Apache stopped", "warn");
        actions = [btn("Open System Applications", () => navigate("sysapps"), "btn-primary")];
      } else {
        status = pill("ready", "good");
        actions = [el("a", { class: "btn btn-sm btn-primary", href: p.path, target: "_blank", rel: "noopener noreferrer", text: "Open phpMyAdmin ↗" })];
      }
      return el("div", { class: "card", style: "margin-bottom:16px" }, [
        el("div", { class: "net-card-h" }, [icon("database", 20), el("h3", { text: "phpMyAdmin" }), el("span", { style: "flex:1" }), status]),
        el("p", { class: "muted", style: "margin:6px 0 10px", text: p.installed
          ? "Web tool for browsing tables and running SQL. Log in with a user below that has a password — root has none (it only works from the Pi's own terminal). Tick “Admin” on a user for full access to every database."
          : "Optional web tool for browsing tables and running SQL. Needs Apache; it's added at /phpmyadmin." }),
        p.installed && !p.apache ? el("p", { class: "dm-hint", text: "Apache isn't running — start it in System Applications to use phpMyAdmin." }) : null,
        el("div", { class: "toolbar", style: "margin:0" }, actions),
      ]);
    }

    function createCards(d) {
      const dbName = el("input", { type: "text", placeholder: "myapp", style: "min-width:0" });
      const dbCard = el("div", { class: "card db-form" }, [
        el("h3", { text: "Create database" }),
        field("Name", dbName, "Letters, digits and underscore. Created with utf8mb4 (full Unicode, emoji included)."),
        btn("Create database", async () => {
          const name = dbName.value.trim(); if (!name) return toast("Enter a database name", "bad");
          if (await call(() => API.mysqlCreate(name), `Database ${name} created`)) dbName.value = "";
        }, "btn-primary"),
      ]);
      const uName = el("input", { type: "text", placeholder: "myapp_user", autocomplete: "off", style: "min-width:0" });
      const uHost = myHostSelect();
      const uPw = dbPwField();
      const uDb = el("select", {}, [el("option", { value: "", text: "— none —" }),
        ...d.databases.filter((x) => !x.system && !x.app).map((x) => el("option", { value: x.name, text: x.name }))]);
      const uAdmin = dbChk("Admin", false, "every privilege on every database; use for phpMyAdmin");
      const userCard = el("div", { class: "card db-form" }, [
        el("h3", { text: "Create user" }),
        field("Username", uName),
        field("Allow connections from", uHost, MY_HOST_HINT),
        field("Password", uPw.node, "Save it somewhere — it can be changed later but not shown again."),
        field("Give full access to", uDb, "Optional — you can grant access to more databases later."),
        el("div", { style: "margin:4px 0 12px" }, uAdmin.node),
        btn("Create user", async () => {
          const user = uName.value.trim(); if (!user) return toast("Enter a username", "bad");
          if (await call(() => API.mysqlUserCreate({ user, host: uHost.value, password: uPw.input.value, db: uDb.value, admin: uAdmin.input.checked }),
            `User ${user} created${uDb.value ? ` with access to ${uDb.value}` : ""}`)) { uName.value = ""; uPw.input.value = ""; }
        }, "btn-primary"),
      ]);
      return el("div", { class: "db-grid" }, [dbCard, userCard]);
    }

    function manageDb(db, d) {
      const users = d.users.filter(manageable);
      const list = el("div", { style: "display:flex;flex-direction:column;gap:6px" }, users.length ? users.map((u) => {
        const c = dbChk(`${u.user}@${u.host}`, db.access.includes(u.account) || u.admin, u.admin ? "admin — always has access" : "");
        if (u.admin) c.input.disabled = true;
        c.input.onchange = async () => {
          c.input.disabled = true;
          try { await API.mysqlGrant(db.name, u.user, u.host, c.input.checked); toast(`${u.user}: access ${c.input.checked ? "granted" : "removed"}`, "good"); }
          catch (e) { c.input.checked = !c.input.checked; toast(e.message, "bad"); }
          c.input.disabled = false; load();
        };
        return c.node;
      }) : [el("p", { class: "muted", text: "No users yet — create one first." })]);
      openModal(`Database ${db.name}`, el("div", { style: "display:flex;flex-direction:column;gap:14px;min-width:min(520px,80vw)" }, [
        kv([["Size", db.size], ["Tables", String(db.tables)], ["Character set", db.charset]]),
        el("div", {}, [el("h4", { text: "Users with full access", style: "margin:0 0 6px" }), list,
          el("p", { class: "dm-hint", text: "Full access = every privilege on this database: read, write, and create or change tables." })]),
        el("div", {}, [el("h4", { text: "Connect from an app", style: "margin:0 0 6px" }),
          el("pre", { class: "log", style: "margin:0;white-space:pre-wrap", text:
            `mysql://<user>:<password>@localhost:3306/${db.name}\n\nmysql -u <user> -p ${db.name}` })]),
      ]), []);
    }

    function editUser(u, d) {
      const admin = dbChk("Admin", u.admin, "every privilege on every database");
      const dbs = d.databases.filter((x) => !x.system && !x.app).map((x) => ({ name: x.name, c: dbChk(x.name, u.databases.includes(x.name)) }));
      const syncDisabled = () => dbs.forEach(({ c }) => { c.input.disabled = admin.input.checked; });
      admin.input.onchange = syncDisabled; syncDisabled();
      openModal(`User ${u.user}@${u.host}`, el("div", { style: "display:flex;flex-direction:column;gap:10px;min-width:min(440px,80vw)" }, [
        kv([["Connects from", myHostLabel(u.host)], ["Password", u.has_password ? "set" : "none"]]),
        admin.node,
        el("h4", { text: "Full access to", style: "margin:6px 0 0" }),
        dbs.length ? el("div", { style: "display:flex;flex-direction:column;gap:6px" }, dbs.map((x) => x.c.node)) : el("p", { class: "muted", text: "No databases yet." }),
        el("p", { class: "dm-hint", text: "An admin already has access to everything, so the list is locked while Admin is ticked." }),
      ]), [btn("Save", async () => {
        try {
          if (admin.input.checked !== u.admin) await API.mysqlUserAdmin(u.user, u.host, admin.input.checked);
          for (const x of dbs) {
            const want = x.c.input.checked, had = u.databases.includes(x.name);
            if (!admin.input.checked && want !== had) await API.mysqlGrant(x.name, u.user, u.host, want);
          }
          toast(`${u.user} updated`, "good"); closeModal();
        } catch (e) { toast(e.message, "bad"); }
        load();
      }, "btn-primary")]);
    }

    function setPassword(u) {
      const pw = dbPwField();
      openModal(`Password for ${u.user}@${u.host}`, el("div", { style: "min-width:min(420px,80vw)" }, [field("New password", pw.node, "Apps using the old password will need the new one.")]),
        [btn("Set password", async () => {
          if (await call(() => API.mysqlUserPassword(u.user, u.host, pw.input.value), `Password changed for ${u.user}`)) closeModal();
        }, "btn-primary")]);
    }

    function render(d) {
      body.innerHTML = "";
      body.append(phpMyAdminCard(d.phpmyadmin), createCards(d));
      const tag = (x) => x.system ? el("span", { class: "pill dim", style: "margin-left:6px", text: "system" })
        : x.app ? el("span", { class: "pill dim", style: "margin-left:6px", text: x.app }) : null;
      const dbRows = d.databases.map((db) => el("tr", {}, [
        el("td", {}, [el("b", { text: db.name }), tag(db)].filter(Boolean)),
        el("td", { class: "muted", text: db.size }), el("td", { class: "muted", text: String(db.tables) }),
        el("td", {}, db.access.length ? db.access.map((a) => el("span", { class: "pill", style: "margin:0 4px 2px 0", text: a })) : el("span", { class: "muted", text: db.system || db.app ? "" : "admins only" })),
        el("td", { class: "actions" }, db.system || db.app ? "" : [
          btn("Manage", () => manageDb(db, d)),
          el("button", { class: "btn btn-sm btn-danger", text: "Drop", onclick: () => {
            if (!confirmInline(`Drop database "${db.name}"? All its data is deleted. This can't be undone.`)) return;
            call(() => API.mysqlDrop(db.name), `Dropped ${db.name}`); } })]),
      ]));
      body.append(el("div", { class: "card", style: "margin-bottom:16px" }, [el("h3", { text: "Databases" }),
        simpleTable(["Database", "Size", "Tables", "Users with access", ""], dbRows)]));
      const userRows = d.users.map((u) => el("tr", {}, [
        el("td", {}, [el("b", { text: u.user }), u.system ? el("span", { class: "pill dim", style: "margin-left:6px", text: "built-in" }) : u.app ? el("span", { class: "pill dim", style: "margin-left:6px", text: u.app }) : null].filter(Boolean)),
        el("td", { class: "muted", text: myHostLabel(u.host) }),
        el("td", {}, u.admin ? pill("admin", "warn") : u.databases.length ? u.databases.map((x) => el("span", { class: "pill", style: "margin:0 4px 2px 0", text: x })) : el("span", { class: "muted", text: "no databases" })),
        el("td", {}, u.has_password ? pill("set", "good") : el("span", { class: "muted", text: u.system ? "none (local only)" : "none" })),
        el("td", { class: "actions" }, manageable(u) ? [
          btn("Password", () => setPassword(u)), btn("Edit", () => editUser(u, d)),
          el("button", { class: "btn btn-sm btn-danger", text: "Delete", onclick: () => {
            if (!confirmInline(`Delete user "${u.user}@${u.host}"? Apps logging in with it will stop working. Databases are kept.`)) return;
            call(() => API.mysqlUserDrop(u.user, u.host), `Deleted ${u.user}`); } })] : ""),
      ]));
      body.append(el("div", { class: "card" }, [el("h3", { text: "Users" }),
        el("p", { class: "muted", style: "margin:0 0 10px", text: "Apps and phpMyAdmin log in with a user that has a password. Built-in accounts are managed by the system and can't be changed here." }),
        simpleTable(["User", "Connects from", "Access", "Password", ""], userRows)]));
    }

    const load = async () => {
      await guardedLoad(async () => {
        let d;
        try { d = await API.mysql(); }
        catch (e) { body.innerHTML = ""; body.append(el("p", { class: "empty", text: e.message })); return; }
        if (!dbOffer("mariadb", d, body, jp, load)) return;
        render(d);
      });
    };
    state.refreshHandler = load; load();
  }

  // ---- Database wizards (MariaDB and PostgreSQL share the layout) ----
  // spec: { app, title, intro, userLabel, fetch, create(vals), result(r, vals) → [[k, v]…], conn(vals) → text, host }
  function dbWizard(root, spec) {
    const gate = el("div", {});
    const jp = jobPanel(root);
    state.cleanups.push(jp.stop);
    const name = el("input", { type: "text", placeholder: "myapp", autocomplete: "off", style: "min-width:0" });
    const user = el("input", { type: "text", placeholder: "myapp_user", autocomplete: "off", style: "min-width:0" });
    const host = spec.host ? myHostSelect() : null;
    const pw = dbPwField();
    const out = el("div", {});
    const createBtn = btn("Create database and user", async () => {
      const vals = { db: name.value.trim(), user: user.value.trim(), host: host ? host.value : "localhost", password: pw.input.value };
      if (!vals.db) return toast("Enter a database name", "bad");
      if (!vals.user) return toast(`Enter a ${spec.userLabel.toLowerCase()}`, "bad");
      createBtn.disabled = true;
      try { const r = await spec.create(vals); showResult(r, vals); }
      catch (e) { toast(e.message, "bad"); check(); }
      createBtn.disabled = false;
    }, "btn-primary");
    const form = el("div", { class: "db-form", style: "max-width:520px" }, [
      field("Database name", name, "Letters, digits and underscore."),
      field(spec.userLabel, user, spec.userHint),
      host ? field("Allow connections from", host, MY_HOST_HINT) : null,
      field("Password", pw.node, "Click Generate for a strong one, and save it — it can't be shown again later."),
      el("div", {}, createBtn),
    ].filter(Boolean));
    const wiz = el("div", { class: "card", hidden: true }, [
      el("h3", { text: spec.title }),
      el("p", { class: "muted", style: "margin:0 0 14px", text: spec.intro }), form, out,
    ]);
    function showResult(r, vals) {
      out.innerHTML = "";
      form.hidden = true;
      out.append(
        el("div", { class: "net-card-h", style: "margin-bottom:10px" }, [pill("created", "good"), el("span", { class: "muted", text: "Save these details now — the password isn't stored anywhere you can see it again." })]),
        kv([...spec.result(r, vals), ["Password", vals.password]]),
        el("h4", { text: "Connect from an app", style: "margin:14px 0 6px" }),
        el("pre", { class: "log", style: "margin:0 0 14px;white-space:pre-wrap", text: spec.conn(vals) }),
        el("div", { class: "toolbar", style: "margin:0" }, [
          btn("Copy password", async () => toast(await copyText(vals.password) ? "Password copied" : "Copy failed", "good"), "btn-primary"),
          btn("Create another", () => { out.innerHTML = ""; form.hidden = false; name.value = user.value = pw.input.value = ""; name.focus(); }),
          btn("Manage databases", () => navigate(spec.manage), "btn-ghost"),
        ]));
    }
    const check = async () => {
      try { const d = await spec.fetch(); wiz.hidden = !dbOffer(spec.app, d, gate, jp, check); if (!wiz.hidden) gate.innerHTML = ""; }
      catch (e) { gate.innerHTML = ""; wiz.hidden = false; }  // errors surface on Create
    };
    root.prepend(gate, wiz);
    state.refreshHandler = check; check();
  }

  function viewMySQLWizard(root) {
    dbWizard(root, {
      app: "mariadb", title: "MariaDB Database Wizard", manage: "mysql", host: true,
      intro: "Creates a new database and a new user in one step, and gives that user full access to the database — what most apps (WordPress, Nextcloud, …) ask for.",
      userLabel: "Username", userHint: "The account your app logs in with.",
      fetch: () => API.mysql(),
      create: (v) => API.mysqlWizard({ db: v.db, user: v.user, host: v.host, password: v.password }),
      result: (r, v) => [["Database", v.db], ["User", r.user], ["Connects from", myHostLabel(v.host)]],
      conn: (v) => `mysql://${v.user}:<password>@localhost:3306/${v.db}\n\nmysql -u ${v.user} -p ${v.db}`,
    });
  }

  // ---- Database server missing / stopped / half-installed → offer to install, start or
  // repair it (same System Applications endpoints). Returns true when the server is ready;
  // otherwise renders the offer into box.
  const DB_SERVERS = {
    postgresql: { name: "PostgreSQL", size: "about 50 MB download; uses ~30–60 MB RAM while running",
      stopped: "The PostgreSQL server is installed but no database cluster is online. Start it to manage databases here." },
    mariadb: { name: "MariaDB", size: "about 40 MB download; uses ~80–150 MB RAM while running",
      stopped: "The MariaDB server is installed but not running. Start it to manage databases here." },
  };
  function dbOffer(app, d, box, jp, reload) {
    if (d.installed && d.running) return true;
    const s = DB_SERVERS[app];
    box.innerHTML = "";
    const install = !d.installed;
    const act = install
      ? el("button", { class: "btn btn-primary", text: d.broken ? `Repair ${s.name}` : `Install ${s.name}`, onclick: async (e) => {
          const b = e.currentTarget; b.disabled = true;
          try {
            const r = await API.sysappInstall(app);
            await jp.run(r.job, d.broken ? `Repairing ${s.name}…` : `Installing ${s.name}…`);
            const t = setInterval(async () => {
              try { const j = await API.job(r.job); if (j.status !== "running") { clearInterval(t); reload(); } }
              catch (err) { clearInterval(t); }
            }, 2000);
            state.cleanups.push(() => clearInterval(t));
          } catch (err) { b.disabled = false; toast(err.message, "bad"); } } })
      : el("button", { class: "btn btn-primary", text: `Start ${s.name}`, onclick: async () => {
          try { await API.sysappControl(app, "start"); toast(`${s.name} started`, "good"); reload(); }
          catch (err) { toast(err.message, "bad"); } } });
    box.append(el("div", { class: "card" }, [
      el("h3", { text: d.broken ? `${s.name}'s installation didn't finish` : install ? `${s.name} isn't installed` : `${s.name} isn't running` }),
      el("p", { class: "muted", style: "margin:0 0 14px", text: d.broken
        ? `${s.name} was only partly installed (its setup stopped part-way), so the server can't run. Repair finishes the installation; existing databases are kept.`
        : install ? `${s.name} isn't on this system yet. Install it now (${s.size}), or manage it later from System Applications → Extras.` : s.stopped }),
      el("div", { class: "toolbar" }, [act, btn("Open System Applications", () => navigate("sysapps"), "btn-ghost")]),
    ]));
    return false;
  }
  const pgOffer = (d, box, jp, reload) => dbOffer("postgresql", d, box, jp, reload);

  // ---- PostgreSQL Databases ----
  function viewPgSQL(root) { pgManager(root); }

  // Full PostgreSQL management: databases (owner, size, access), users/roles (password,
  // privileges), and phpPgAdmin. Also the "PostgreSQL" tab of Manage Databases.
  function pgManager(root) {
    const body = el("div", {}, el("div", { class: "loading", text: "Loading…" }));
    root.append(body);
    const jp = jobPanel(root);
    state.cleanups.push(jp.stop);
    const chk = (label, checked, hint) => {
      const c = el("input", { type: "checkbox" }); c.checked = !!checked;
      return { input: c, node: el("label", { class: "dm-check" }, [c, el("span", {}, [label, hint ? el("span", { class: "muted", text: ` — ${hint}` }) : null].filter(Boolean))]) };
    };
    const pwField = (id) => {
      const inp = el("input", { id, type: "text", placeholder: "password (6+ characters)", autocomplete: "new-password", style: "min-width:0;flex:1" });
      return { input: inp, node: el("div", { class: "toolbar", style: "margin:0;flex-wrap:nowrap" }, [inp,
        btn("Generate", () => { inp.value = genPassword(18); }, "btn-ghost"),
        btn("Copy", async () => toast(await copyText(inp.value) ? "Password copied" : "Copy failed", "good"), "btn-ghost")]) };
    };
    const call = async (fn, okMsg) => {
      try { const r = await fn(); if (okMsg) toast(okMsg, "good"); load(); return r || true; }
      catch (e) { toast(e.message, "bad"); load(); return null; }
    };

    function permissionError(e) {
      body.append(el("div", { class: "card" }, [
        el("h3", { text: "PostgreSQL can't read its data files" }),
        el("p", { class: "muted", style: "margin:0 0 10px", text: "The database folder is no longer owned by the postgres user, so every connection is refused. Repair gives it back to postgres and restarts the server (a few seconds of downtime; your data isn't touched)." }),
        el("pre", { class: "log", style: "margin:0 0 14px;white-space:pre-wrap", text: e.message }),
        el("button", { class: "btn btn-primary", text: "Repair permissions", onclick: async (ev) => {
          ev.currentTarget.disabled = true;
          try { await API.pgRepair(); toast("PostgreSQL repaired", "good"); load(); }
          catch (err) { ev.target.disabled = false; toast(err.message, "bad"); } } }),
      ]));
    }

    function phpPgAdminCard(p) {
      let status, actions;
      if (!p.installed) {
        status = pill("not installed", "dim");
        actions = [btn("Install phpPgAdmin", async () => {
          const r = await call(() => API.phppgadminInstall());
          if (r) { await jp.run(r.job, "Installing phpPgAdmin…"); const t = setInterval(async () => {
            try { const j = await API.job(r.job); if (j.status !== "running") { clearInterval(t); load(); } } catch (e) { clearInterval(t); } }, 2000);
            state.cleanups.push(() => clearInterval(t)); }
        }, "btn-primary")];
      } else if (!p.lan) {
        status = pill("only works on the Pi itself", "warn");
        actions = [btn("Allow from my network", () => call(() => API.phppgadminLan(true), "phpPgAdmin is now reachable from your network"), "btn-primary")];
      } else {
        status = pill("ready", "good");
        actions = [el("a", { class: "btn btn-sm btn-primary", href: p.path, target: "_blank", rel: "noopener noreferrer", text: "Open phpPgAdmin ↗" }),
          btn("Limit to this Pi only", () => call(() => API.phppgadminLan(false), "phpPgAdmin now only answers on the Pi itself"), "btn-ghost")];
      }
      return el("div", { class: "card", style: "margin-bottom:16px" }, [
        el("div", { class: "net-card-h" }, [icon("database", 20), el("h3", { text: "phpPgAdmin" }), el("span", { style: "flex:1" }), status]),
        el("p", { class: "muted", style: "margin:6px 0 10px", text: p.installed
          ? "Web tool for browsing tables and running SQL. Log in with a user below that has a password — the built-in postgres account has none and is blocked. Tick “Superuser” on a user for full admin rights."
          : "Optional web tool for browsing tables and running SQL. It's opened to your local network and VPN automatically (never the internet)." }),
        p.installed && !p.apache ? el("p", { class: "dm-hint", text: "Apache isn't running — start it in System Applications to use phpPgAdmin." }) : null,
        el("div", { class: "toolbar", style: "margin:0" }, actions),
      ]);
    }

    function createCards(d) {
      const owners = d.roles.filter((r) => r.login || r.system);
      const dbName = el("input", { type: "text", placeholder: "myapp", style: "min-width:0" });
      const dbOwner = el("select", {}, [el("option", { value: "", text: "postgres (default)" }),
        ...owners.filter((r) => !r.system).map((r) => el("option", { value: r.name, text: r.name }))]);
      const dbCard = el("div", { class: "card db-form" }, [
        el("h3", { text: "Create database" }),
        field("Name", dbName, "Letters, digits and underscore."),
        field("Owner", dbOwner, "The owner has full control. Pick the user your app logs in with."),
        btn("Create database", async () => {
          const name = dbName.value.trim(); if (!name) return toast("Enter a database name", "bad");
          if (await call(() => API.pgCreate(name, dbOwner.value), `Database ${name} created`)) dbName.value = "";
        }, "btn-primary"),
      ]);
      const uName = el("input", { type: "text", placeholder: "myapp_user", autocomplete: "off", style: "min-width:0" });
      const uPw = pwField("pg-new-pw");
      const cdb = chk("Can create databases"), csu = chk("Superuser", false, "full admin; use for phpPgAdmin");
      const uDb = el("select", {}, [el("option", { value: "", text: "— none —" }),
        ...d.databases.filter((x) => !x.system).map((x) => el("option", { value: x.name, text: x.name }))]);
      const userCard = el("div", { class: "card db-form" }, [
        el("h3", { text: "Create user" }),
        field("Username", uName),
        field("Password", uPw.node, "Save it somewhere — it can be changed later but not shown again."),
        field("Give full access to", uDb, "Optional — you can grant access to more databases later."),
        el("div", { style: "display:flex;flex-direction:column;gap:6px;margin:4px 0 12px" }, [cdb.node, csu.node]),
        btn("Create user", async () => {
          const name = uName.value.trim(); if (!name) return toast("Enter a username", "bad");
          try {
            await API.pgRoleCreate({ name, password: uPw.input.value, login: true, createdb: cdb.input.checked, superuser: csu.input.checked });
            if (uDb.value) await API.pgGrant(uDb.value, name, true);
            toast(`User ${name} created${uDb.value ? ` with access to ${uDb.value}` : ""}`, "good");
            uName.value = ""; uPw.input.value = ""; load();
          } catch (e) { toast(e.message, "bad"); load(); }
        }, "btn-primary"),
      ]);
      return el("div", { class: "db-grid" }, [dbCard, userCard]);
    }

    function manageDb(db, d) {
      const users = d.roles.filter((r) => !r.system && r.login);
      const owner = el("select", {}, [el("option", { value: "postgres", text: "postgres" }),
        ...users.map((r) => el("option", { value: r.name, text: r.name }))]);
      owner.value = db.owner;
      const list = el("div", { style: "display:flex;flex-direction:column;gap:6px" }, users.length ? users.filter((r) => r.name !== db.owner).map((r) => {
        const c = chk(r.name, db.access.includes(r.name) || r.superuser, r.superuser ? "superuser — always has access" : "");
        if (r.superuser) c.input.disabled = true;
        c.input.onchange = async () => {
          c.input.disabled = true;
          try { await API.pgGrant(db.name, r.name, c.input.checked); toast(`${r.name}: access ${c.input.checked ? "granted" : "removed"}`, "good"); }
          catch (e) { c.input.checked = !c.input.checked; toast(e.message, "bad"); }
          c.input.disabled = false; load();
        };
        return c.node;
      }) : [el("p", { class: "muted", text: "No users yet — create one first." })]);
      const host = location.hostname;
      openModal(`Database ${db.name}`, el("div", { style: "display:flex;flex-direction:column;gap:14px;min-width:min(520px,80vw)" }, [
        kv([["Size", db.size], ["Encoding", db.encoding], ["Open connections", String(db.connections)]]),
        el("div", {}, [el("h4", { text: "Owner", style: "margin:0 0 6px" }),
          el("div", { class: "toolbar", style: "margin:0" }, [owner, btn("Change owner", async () => {
            if (owner.value === db.owner) return;
            if (await call(() => API.pgOwner(db.name, owner.value), `${db.name} is now owned by ${owner.value}`)) closeModal();
          }, "btn-primary")])]),
        el("div", {}, [el("h4", { text: "Users with full access", style: "margin:0 0 6px" }), list,
          el("p", { class: "dm-hint", text: "Full access = read and write every table, including tables created later. The owner always has it." })]),
        el("div", {}, [el("h4", { text: "Connect from an app", style: "margin:0 0 6px" }),
          el("pre", { class: "log", style: "margin:0;white-space:pre-wrap", text:
            `postgresql://<user>:<password>@localhost:5432/${db.name}\n\npsql -h ${host} -U <user> -d ${db.name}` })]),
      ]), []);
    }

    function editRole(r) {
      const login = chk("Can log in", r.login), cdb = chk("Can create databases", r.createdb),
        crole = chk("Can create users", r.createrole), su = chk("Superuser", r.superuser, "full admin, bypasses all permissions");
      const lim = el("input", { type: "number", min: -1, max: 10000, value: r.conn_limit, style: "max-width:120px" });
      openModal(`User ${r.name}`, el("div", { style: "display:flex;flex-direction:column;gap:8px;min-width:min(420px,80vw)" }, [
        login.node, cdb.node, crole.node, su.node, field("Connection limit", lim, "-1 = unlimited"),
      ]), [btn("Save", async () => {
        if (await call(() => API.pgRoleUpdate({ name: r.name, login: login.input.checked, createdb: cdb.input.checked,
          createrole: crole.input.checked, superuser: su.input.checked, conn_limit: parseInt(lim.value, 10) }), `${r.name} updated`)) closeModal();
      }, "btn-primary")]);
    }

    function setPassword(r) {
      const pw = pwField("pg-set-pw");
      openModal(`Password for ${r.name}`, el("div", { style: "min-width:min(420px,80vw)" }, [field("New password", pw.node, "Apps using the old password will need the new one.")]),
        [btn("Set password", async () => {
          if (await call(() => API.pgRolePassword(r.name, pw.input.value), `Password changed for ${r.name}`)) closeModal();
        }, "btn-primary")]);
    }

    function render(d) {
      body.innerHTML = "";
      body.append(phpPgAdminCard(d.phppgadmin), createCards(d));
      const dbRows = d.databases.map((db) => el("tr", {}, [
        el("td", {}, [el("b", { text: db.name }), db.system ? el("span", { class: "pill dim", style: "margin-left:6px", text: "system" }) : null].filter(Boolean)),
        el("td", { text: db.owner }), el("td", { class: "muted", text: db.size }),
        el("td", {}, db.access.length ? db.access.map((a) => el("span", { class: "pill", style: "margin:0 4px 2px 0", text: a })) : el("span", { class: "muted", text: db.system ? "" : "owner only" })),
        el("td", { class: "muted", text: String(db.connections) }),
        el("td", { class: "actions" }, db.system ? "" : [
          btn("Manage", () => manageDb(db, d)),
          el("button", { class: "btn btn-sm btn-danger", text: "Drop", onclick: () => {
            if (!confirmInline(`Drop database "${db.name}"? All its data is deleted${db.connections ? ` and ${db.connections} open connection(s) are closed` : ""}. This can't be undone.`)) return;
            call(() => API.pgDrop(db.name), `Dropped ${db.name}`); } })]),
      ]));
      body.append(el("div", { class: "card", style: "margin-bottom:16px" }, [el("h3", { text: "Databases" }),
        simpleTable(["Database", "Owner", "Size", "Users with access", "Connections", ""], dbRows)]));
      const flags = (r) => [r.superuser ? pill("superuser", "warn") : null, r.createdb ? pill("create databases", "dim") : null,
        r.createrole ? pill("create users", "dim") : null, !r.login ? pill("can't log in", "dim") : null].filter(Boolean);
      const roleRows = d.roles.map((r) => el("tr", {}, [
        el("td", {}, [el("b", { text: r.name }), r.system ? el("span", { class: "pill dim", style: "margin-left:6px", text: "built-in" }) : null].filter(Boolean)),
        el("td", {}, flags(r).length ? flags(r) : el("span", { class: "muted", text: "regular user" })),
        el("td", {}, r.has_password ? pill("set", "good") : el("span", { class: "muted", text: r.system ? "none (local only)" : "none" })),
        el("td", { class: "muted", text: r.owns.join(", ") || "—" }),
        el("td", { class: "actions" }, r.system ? "" : [
          btn("Password", () => setPassword(r)), btn("Edit", () => editRole(r)),
          el("button", { class: "btn btn-sm btn-danger", text: "Delete", onclick: () => {
            if (!confirmInline(`Delete user "${r.name}"?${r.owns.length ? `\n\nIt owns ${r.owns.join(", ")} — ownership goes to postgres; the data is kept.` : ""}`)) return;
            call(() => API.pgRoleDrop(r.name), `Deleted ${r.name}`); } })]),
      ]));
      body.append(el("div", { class: "card" }, [el("h3", { text: "Users" }),
        el("p", { class: "muted", style: "margin:0 0 10px", text: "PostgreSQL calls them roles. Apps and phpPgAdmin log in with a user that has a password." }),
        simpleTable(["User", "Privileges", "Password", "Owns", ""], roleRows)]));
    }

    const load = async () => {
      await guardedLoad(async () => {
        let d;
        try { d = await API.pg(); }
        catch (e) { body.innerHTML = ""; if (/permission denied/i.test(e.message)) permissionError(e); else body.append(el("p", { class: "empty", text: e.message })); return; }
        if (!pgOffer(d, body, jp, load)) return;
        render(d);
      });
    };
    state.refreshHandler = load; load();
  }

  // ---- PostgreSQL Wizard ----
  function viewPgWizard(root) {
    dbWizard(root, {
      app: "postgresql", title: "PostgreSQL Database Wizard", manage: "pgsql", host: false,
      intro: "Creates a new database and a new user in one step, and makes that user the database's owner — what most apps (Django, Rails, Nextcloud, …) ask for.",
      userLabel: "Username", userHint: "The account your app logs in with (PostgreSQL calls it a role).",
      fetch: () => API.pg(),
      create: (v) => API.pgWizard({ db: v.db, role: v.user, password: v.password }),
      result: (r, v) => [["Database", v.db], ["User (owner)", r.role]],
      conn: (v) => `postgresql://${v.user}:<password>@localhost:5432/${v.db}\n\npsql -h ${location.hostname} -U ${v.user} -d ${v.db}`,
    });
  }

  function labeledInput(id, label, placeholder, value, type) {
    return el("label", { class: "muted", style: "display:flex;flex-direction:column;gap:6px;font-size:13px" }, [
      label, el("input", { id, type: type || "text", placeholder: placeholder || "", value: value || "" }),
    ]);
  }

  // ======================================================================
  //  Software: Application Manager
  // ======================================================================
  const APP_TEMPLATES = {
    node: { label: "Node.js", cmd: "node app.js" },
    python: { label: "Python", cmd: "python3 app.py" },
    ruby: { label: "Ruby", cmd: "ruby app.rb" },
    custom: { label: "Custom", cmd: "" },
  };
  function viewAppManager(root) {
    const form = el("div", { class: "card", style: "margin-bottom:16px" }, [
      el("h3", { text: "Create application (runs as a systemd service)" }),
      el("div", { style: "display:grid;gap:12px;max-width:560px" }, [
        el("div", { class: "toolbar", style: "margin:0" }, [
          el("label", { class: "muted", text: "Runtime:" }),
          el("select", { id: "app-runtime", style: "max-width:150px", onchange: () => { $("#app-cmd").value = APP_TEMPLATES[$("#app-runtime").value].cmd; } },
            Object.entries(APP_TEMPLATES).map(([k, v]) => el("option", { value: k, text: v.label }))),
        ]),
        labeledInput("app-name", "App name (slug)", "myapp"),
        labeledInput("app-dir", "Working directory", `${sysHome()}/myapp`),
        labeledInput("app-cmd", "Start command", "node app.js"),
        el("label", { class: "muted", style: "display:flex;align-items:center;gap:8px" }, [el("input", { id: "app-auto", type: "checkbox", checked: "checked", style: "width:auto" }), "Start now + enable on boot"]),
        el("button", { class: "btn btn-primary", style: "justify-self:start", text: "Create app", onclick: createApp }),
      ]),
    ]);
    const body = el("div", { id: "app-body" }, el("div", { class: "loading", text: "Loading…" }));
    root.append(form, body);
    const load = async () => {
      await guardedLoad(async () => {
        const d = await API.apps();
        body.innerHTML = "";
        if (!d.supported) { body.append(el("p", { class: "empty", text: "systemd not available." })); return; }
        if (!d.apps.length) { body.append(el("p", { class: "empty", text: "No apps yet." })); return; }
        const rows = d.apps.map((a) => el("tr", {}, [
          el("td", { text: a.name }),
          el("td", {}, el("span", { class: `pill ${a.active === "active" ? "good" : "dim"}`, text: a.active })),
          el("td", { class: "muted", text: a.command, style: "max-width:280px;overflow:hidden;text-overflow:ellipsis" }),
          el("td", { class: "actions" }, [
            el("button", { class: "btn btn-sm", text: a.active === "active" ? "Restart" : "Start", onclick: () => appCtl(a.name, a.active === "active" ? "restart" : "start", load) }),
            a.active === "active" ? el("button", { class: "btn btn-sm btn-ghost", text: "Stop", onclick: () => appCtl(a.name, "stop", load) }) : null,
            el("button", { class: "btn btn-sm btn-ghost", text: "Logs", onclick: () => showAppLogs(a.name) }),
            el("button", { class: "btn btn-sm btn-danger", text: "Remove", onclick: async () => { if (!confirmInline(`Remove app "${a.name}"?`)) return; try { await API.appRemove(a.name); toast("Removed", "good"); load(); } catch (e) { toast(e.message, "bad"); } } }),
          ]),
        ]));
        body.append(simpleTable(["App", "Status", "Command", ""], rows));
      });
    };
    async function createApp() {
      const b = { name: $("#app-name").value.trim(), workdir: $("#app-dir").value.trim(), command: $("#app-cmd").value.trim(), autostart: $("#app-auto").checked };
      if (!b.name || !b.workdir || !b.command) { toast("Fill name, directory and command", "bad"); return; }
      try { await API.appCreate(b); toast("App created", "good"); $("#app-name").value = ""; load(); }
      catch (e) { toast(e.message, "bad"); }
    }
    state.refreshHandler = load; load();
  }
  async function appCtl(name, action, done) { try { await API.appControl(name, action); toast(`${action} → ${name}`, "good"); done && setTimeout(done, 500); } catch (e) { toast(e.message, "bad"); } }
  async function showAppLogs(name) { try { const r = await API.appLogs(name); openModal(`Logs — ${name}`, el("pre", { class: "log", text: r.output }), []); } catch (e) { toast(e.message, "bad"); } }

  // ======================================================================
  //  Software: System Applications (one-click web servers / PHP-FPM / DB / FTP)
  // ======================================================================
  function viewSysApps(root) {
    const appArg = (state.viewArg || "").split(":")[0];
    if (appArg) return viewAppConfig(root, appArg);
    const intro = el("p", { class: "muted", style: "margin:0 0 14px",
      text: "Install and manage server software with one click. Only one web server can use port 80 at a time — switching stops the running one. Uninstall keeps config files and website content." });
    const body = el("div", {}, el("div", { class: "loading", text: "Loading…" }));
    const jp = jobPanel(root);
    root.prepend(intro, body);
    state.cleanups.push(jp.stop);

    // Run an action; on 409 (port 80 busy) ask to switch and retry.
    async function withSwitch(fn, okMsg) {
      try { return await fn(false); }
      catch (e) {
        if (e.status !== 409) { toast(e.message, "bad"); return null; }
        if (!confirmInline(e.message + "\n\nApache-only features (phpMyAdmin, .htaccess tools) stop working while another server is active.")) return null;
        try { return await fn(true); } catch (e2) { toast(e2.message, "bad"); return null; }
      }
    }
    async function watch(jobId, label) {
      await jp.run(jobId, label);
      const t = setInterval(async () => {
        try { const j = await API.job(jobId); if (j.status !== "running") { clearInterval(t); load(); } }
        catch (e) { clearInterval(t); }
      }, 2000);
      state.cleanups.push(() => clearInterval(t));
    }
    async function doInstall(a) {
      const r = await withSwitch((sw) => API.sysappInstall(a.id, sw));
      if (r) watch(r.job, `${a.broken ? "Repairing" : "Installing"} ${a.name}…`);
    }
    async function doUninstall(a) {
      const extra = a.id === "apache" ? "\n\nphpMyAdmin and your Apache sites will stop being served." : (a.id === "mariadb" || a.id === "postgresql") ? "\n\nDatabases stay on disk but nothing can use them until it is reinstalled." : "";
      if (!confirmInline(`Uninstall ${a.name}? Config files and website content are kept.${extra}`)) return;
      try { const r = await API.sysappUninstall(a.id); watch(r.job, `Uninstalling ${a.name}…`); }
      catch (e) { toast(e.message, "bad"); }
    }
    async function doCtl(a, action) {
      const r = await withSwitch((sw) => API.sysappControl(a.id, action, sw));
      if (r) { toast(`${a.name}: ${action}`, "good"); load(); }
    }

    function card(a) {
      const pill = a.broken ? el("span", { class: "pill bad", text: "Install incomplete" })
        : !a.installed ? el("span", { class: "pill dim", text: "Not installed" })
        : el("span", { class: `pill ${a.active ? "good" : "dim"}`, text: a.active ? "Running" : "Stopped" });
      const facts = [
        a.version ? `Version <b>${esc(a.version)}</b>` : null,
        a.ram_mb != null ? `RAM <b>${a.ram_mb} MB</b>` : `Typical RAM ${esc(a.ram_typical)}`,
        a.docroot ? `Web folder <code>${esc(a.docroot)}</code>` : null,
      ].filter(Boolean).join(" · ");
      const btns = !a.installed
        ? [el("button", { class: "btn btn-sm btn-primary", text: a.broken ? "Repair" : "Install", title: a.broken ? "The last install stopped part-way — finish it" : "", onclick: () => doInstall(a) })]
        : [
            a.active ? el("button", { class: "btn btn-sm", text: "Restart", onclick: () => doCtl(a, "restart") })
                     : el("button", { class: "btn btn-sm btn-primary", text: "Start", onclick: () => doCtl(a, "start") }),
            a.active ? el("button", { class: "btn btn-sm btn-ghost", text: "Stop", onclick: () => doCtl(a, "stop") }) : null,
            el("button", { class: "btn btn-sm btn-ghost sa-uninstall", text: "Uninstall", onclick: () => doUninstall(a) }),
          ];
      // Round icon buttons in the header: settings (gear) and, for FTP, its accounts.
      const iconBtn = (ico, label, onclick) => el("button", { class: "sa-icon-btn", type: "button", title: label, "aria-label": label, onclick }, icon(ico, 17));
      const headBtns = a.installed ? [
        a.id === "vsftpd" ? iconBtn("users", "FTP accounts", () => navigate("ftpaccounts")) : null,
        a.id === "postgresql" ? iconBtn("database", "PostgreSQL databases", () => navigate("pgsql")) : null,
        APP_NAMES[a.id] ? iconBtn("gear", `Configure ${a.name}`, () => navigate("sysapps", { arg: a.id })) : null,
      ] : [];
      return el("div", { class: `card sa-card ${a.installed ? "" : "sa-off"}` }, [
        el("div", { class: "sa-head" }, [el("h3", { text: a.name }), el("span", { style: "flex:1" }), pill, ...headBtns]),
        el("p", { class: "muted sa-desc", text: a.desc }),
        el("p", { class: "muted sa-facts", html: facts }),
        el("div", { class: "sa-actions" }, btns),
      ]);
    }
    const grid = (apps) => el("div", { style: "display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;margin-bottom:18px" }, apps.map(card));

    async function load() {
      await guardedLoad(async () => {
        const d = await API.sysapps();
        body.innerHTML = "";
        if (!d.supported) { body.append(el("p", { class: "empty", text: "apt/systemd not available on this host." })); return; }
        body.append(
          el("h3", { text: "Web servers" }), grid(d.apps.filter((a) => a.group === "web")),
          el("h3", { text: "Extras" }), grid(d.apps.filter((a) => a.group !== "web")),
        );
      });
    }
    state.refreshHandler = load; load();
  }

  // ======================================================================
  //  Software: Select PHP Version
  // ======================================================================
  // ======================================================================
  //  Software: one system application's configuration (#/sysapps/<id>[:tab])
  // ======================================================================
  const APP_NAMES = { apache: "Apache", nginx: "Nginx", lighttpd: "Lighttpd", caddy: "Caddy", phpfpm: "PHP-FPM", mariadb: "MariaDB", postgresql: "PostgreSQL", vsftpd: "vsftpd (FTP)" };
  function viewAppConfig(root, id) {
    $("#view-title").textContent = `${APP_NAMES[id] || id} — configuration`;
    document.title = `${APP_NAMES[id] || id} · AuroraPanel`;
    const head = el("div", { class: "toolbar" }, [btn("← All applications", () => navigate("sysapps")), el("span", { class: "muted", text: "Changes are checked before they're applied — if the app rejects them, the previous config is restored automatically." })]);
    const body = el("div", {}, el("div", { class: "loading", text: "Loading…" }));
    root.append(head, body);
    (async () => {
      let info;
      try { info = await API.appConfig(id); } catch (e) { body.innerHTML = ""; body.append(el("p", { class: "empty", text: e.message })); return; }
      body.innerHTML = "";
      const tabs = [];
      if (info.has_settings) tabs.push(["settings", "Settings"]);
      if (info.ftp_accounts) tabs.push(["accounts", "FTP accounts"]);
      if (info.has_modules) tabs.push(["modules", "Modules"]);
      if (info.files.length) tabs.push(["files", "Config files"]);
      tabs.push(["logs", "Logs"]);
      subTabs(body, tabs, (tab, pane) => {
        if (tab === "settings") appSettingsTab(pane);
        else if (tab === "accounts") ftpAccountsPanel(pane);
        else if (tab === "modules") appModulesTab(pane);
        else if (tab === "files") appFilesTab(pane);
        else appLogsTab(pane);
      }, id);

      function appSettingsTab(pane) {
        pane.append(el("div", { class: "loading", text: "Reading the current configuration…" }));
        (async () => {
          try {
            const d = await API.appSettings(id);
            pane.innerHTML = "";
            if (d.pool_file) pane.append(el("p", { class: "dm-hint", text: `PHP ${d.version} pool: ${d.pool_file}` }));
            const form = settingsForm(d.schema, d.values, { boolValues: d.bool_values });
            const save = btn("Save & apply", async () => {
              const ch = form.changes();
              if (!Object.keys(ch).length) { toast("Nothing changed", "good"); return; }
              save.disabled = true;
              try { await API.appSettingsSave(id, ch); toast(`${APP_NAMES[id]} updated`, "good"); pane.innerHTML = ""; appSettingsTab(pane); }
              catch (e) { toast("Not applied — see details", "bad"); openModal("Settings not applied", el("pre", { class: "log", text: e.message }), []); save.disabled = false; }
            }, "btn-primary");
            pane.append(form.node, el("div", { class: "sf-actions" }, [save]));
          } catch (e) { pane.innerHTML = ""; pane.append(el("p", { class: "empty", text: e.message })); }
        })();
      }

      function appModulesTab(pane) {
        const filter = el("input", { type: "search", placeholder: "Filter modules…", style: "max-width:260px" });
        const list = el("div");
        pane.append(el("div", { class: "toolbar" }, [filter, el("span", { class: "dm-hint", text: "Popular modules are listed first. The server restarts after each change." })]), list);
        let mods = [];
        const draw = () => {
          const q = filter.value.trim().toLowerCase();
          const rows = mods.filter((m) => !q || m.name.includes(q) || (m.desc || "").toLowerCase().includes(q))
            .sort((a, b) => (b.popular - a.popular) || a.name.localeCompare(b.name));
          list.innerHTML = "";
          list.append(simpleTable(["Module", "What it does", "Enabled"], rows.map((m) => {
            const c = el("input", { type: "checkbox", class: "sf-switch" }); c.checked = m.enabled; c.disabled = m.protected && m.enabled;
            c.title = m.protected ? "Required — can't be turned off here" : "";
            c.onchange = async () => {
              c.disabled = true;
              try { await API.appModule(id, m.name, c.checked); m.enabled = c.checked; toast(`${m.name} ${c.checked ? "enabled" : "disabled"}`, "good"); }
              catch (e) { c.checked = !c.checked; openModal("Module change undone", el("pre", { class: "log", text: e.message }), []); }
              c.disabled = m.protected && m.enabled;
            };
            return row(el("code", { text: m.name }), m.desc || (m.protected ? "required" : ""), c);
          })));
        };
        filter.addEventListener("input", draw);
        API.appModules(id).then((d) => { mods = d.modules; draw(); }).catch((e) => list.append(el("p", { class: "empty", text: e.message })));
      }

      function appFilesTab(pane) {
        const sel = el("select", {}, info.files.map((f) => el("option", { value: f, text: f })));
        const ta = el("textarea", { class: "cw-mono app-editor", spellcheck: "false", rows: 26 });
        let orig = "";
        const load = async () => { try { const f = await API.appFile(id, sel.value); ta.value = orig = f.content; } catch (e) { toast(e.message, "bad"); } };
        sel.onchange = () => { if (ta.value !== orig && !confirmInline("Discard unsaved changes?")) return; load(); };
        const save = btn("Check & save", async () => {
          if (ta.value === orig) { toast("Nothing changed", "good"); return; }
          save.disabled = true;
          try { await API.appFileSave(id, sel.value, ta.value); orig = ta.value; toast("Saved, checked and applied", "good"); }
          catch (e) { openModal("Not saved — the file was left as it was", el("pre", { class: "log", text: e.message }), []); }
          save.disabled = false;
        }, "btn-primary");
        pane.append(el("div", { class: "card net-warn" }, [el("p", { text: "Advanced: edit the raw configuration. It's validated before saving; if the application refuses it, the old file is put back." })]),
          el("div", { class: "toolbar" }, [sel, save, btn("Reload from disk", load, "btn-ghost")]), ta);
        load();
      }

      function appLogsTab(pane) {
        const src = el("select", {}, [el("option", { value: "", text: `System journal (${info.unit || id})` }), ...info.logs.map((f) => el("option", { value: f, text: f }))]);
        if (id === "postgresql" && info.logs.length) src.value = info.logs[0];  // PostgreSQL logs to its own file, not the journal
        const lines = el("select", {}, [100, 300, 1000].map((n) => el("option", { value: n, text: `last ${n} lines` })));
        const pre = el("pre", { class: "log app-log" });
        const load = async () => { try { const r = await API.appCfgLogs(id, src.value, lines.value); pre.textContent = r.text || "(empty)"; pre.scrollTop = pre.scrollHeight; } catch (e) { pre.textContent = e.message; } };
        src.onchange = load; lines.onchange = load;
        pane.append(el("div", { class: "toolbar" }, [src, lines, btn("Refresh", load)]), pre);
        load();
      }
    })();
  }

  // ---- FTP accounts (System Applications → vsftpd, and Files → FTP Accounts) ----
  function ftpAccountsPanel(pane) {
    const box = el("div", {}, el("div", { class: "loading", text: "Loading…" }));
    pane.append(box);
    const ACC = { full: "Full access", readonly: "Read only", upload: "Upload only (drop box)", custom: "Custom" };
    const load = async () => {
      let d;
      try { d = await API.ftpAccounts(); } catch (e) { box.innerHTML = ""; box.append(el("p", { class: "empty", text: e.message })); return; }
      box.innerHTML = "";
      if (!d.installed) {
        box.append(installCard("The FTP server (vsftpd) is not installed", "Install it from System Applications, then come back to create FTP accounts.", null),
          btn("Open System Applications", () => navigate("sysapps"), "btn-primary"));
        return;
      }
      const s = d.server;
      const lan = (await API.vpnOverview().catch(() => ({ settings: {} }))).settings || {};
      box.append(el("div", { class: "card" }, [
        el("div", { class: "net-card-h" }, [icon("folder", 20), el("h3", { text: "FTP server" }), el("span", { style: "flex:1" }), pill(s.active ? "running" : "stopped", s.active ? "good" : "bad")]),
        kv([["Host (LAN)", location.hostname], ["Host (internet)", lan.effective_endpoint || "—"], ["Port", s.port],
            ["Encryption", s.ssl ? "FTPS available (explicit TLS)" : "Off — plain FTP sends passwords unencrypted"],
            ["Passive ports", s.passive[0] ? `${s.passive[0]}–${s.passive[1]}` : "any (set a range for access from the internet)"],
            ["Who can log in", s.only_listed ? "Only the FTP accounts below" : "Any Linux user on this Pi"]]),
        el("div", { class: "toolbar", style: "margin:12px 0 0" }, [
          btn("Server settings", () => navigate("sysapps", { arg: "vsftpd" }), "btn-ghost"),
          btn(`Check port ${s.port}`, () => gotoPortCheck(+s.port, "tcp"), "btn-ghost"),
        ]),
      ]));
      box.append(el("h2", { class: "section-title", text: `FTP accounts (${d.accounts.length})` }));
      box.append(d.accounts.length ? simpleTable(["Username", "Folder", "Access", "Status", ""], d.accounts.map((a) => row(
        el("span", {}, [el("b", { text: a.name }), a.managed ? null : el("span", { class: "dm-hint", text: " (existing Linux user)" })]),
        el("span", {}, [el("code", { class: "net-mono", text: a.folder }), a.folder_exists ? null : pill("missing", "bad")]),
        ACC[a.access] || a.access,
        pill(a.enabled ? "active" : "disabled", a.enabled ? "good" : "bad"),
        el("div", { class: "net-actions" }, [
          btn("Password", () => ftpPasswordDialog(a.name)),
          btn("Edit", () => ftpEditDialog(a)),
          btn(a.enabled ? "Disable" : "Enable", async () => { try { await API.ftpToggle(a.name, !a.enabled); toast(`${a.name} ${a.enabled ? "disabled" : "enabled"}`, "good"); load(); } catch (e) { toast(e.message, "bad"); } }, "btn-ghost"),
          btn("Delete", async () => {
            if (!confirmInline(a.managed ? `Delete FTP account ${a.name}? Files in ${a.folder} are kept.` : `Remove FTP access for ${a.name}? The Linux user itself is kept.`)) return;
            try { const r = await API.ftpDelete(a.name); toast(r.note || `${a.name} deleted`, "good"); load(); } catch (e) { toast(e.message, "bad"); }
          }, "btn-danger"),
        ]),
      ))) : el("p", { class: "empty", text: "No FTP accounts yet." }));
      // create form
      const name = el("input", { type: "text", placeholder: "e.g. webdev", maxlength: 32, autocomplete: "off" });
      const pw = passwordField();
      const folder = el("input", { type: "text", value: "/var/www/html", placeholder: "/var/www/html" });
      const picks = el("div", { class: "net-presets" }, [el("span", { class: "dm-hint", text: "Quick pick:" }),
        ...["/var/www/html", sysHome(), "/srv/ftp"].map((p) => el("button", { type: "button", class: "cw-chip", text: p, onclick: () => { folder.value = p; } }))]);
      const access = el("select", {}, Object.entries(d.access_levels).map(([k, l]) => el("option", { value: k, text: l })));
      const add = btn("Create FTP account", async () => {
        const password = pw.value() || genPassword();
        add.disabled = true;
        try {
          const r = await API.ftpCreate({ name: name.value.trim(), password, folder: folder.value.trim(), access: access.value, create_folder: true });
          name.value = ""; pw.clear(); load();
          ftpCredentials({ name: r.name, password, folder: r.folder, server: s, host: location.hostname });
        } catch (e) { toast(e.message, "bad"); }
        add.disabled = false;
      }, "btn-primary");
      box.append(el("div", { class: "card" }, [
        el("h3", { text: "Create an FTP account" }),
        el("p", { class: "muted", text: "The account can only see its folder (it's locked in). Permissions are added with ACLs, so the folder's owner and existing permissions don't change." }),
        el("div", { class: "net-form" }, [field("Username", name), field("Password (8+ characters)", pw.node, "Leave empty to generate one."), field("Folder", folder, "Created if it doesn't exist."), field("Access", access)]),
        picks, el("div", { style: "margin-top:12px" }, add),
      ]));
    };
    function ftpCredentials(c) {
      const pwBox = el("input", { type: "text", readonly: "readonly", class: "net-mono net-pw-out", value: c.password });
      openModal(`FTP account ${c.name} created`, el("div", {}, [
        kv([["Host", c.host], ["Port", c.server.port], ["Username", c.name], ["Folder", c.folder], ["Encryption", c.server.ssl ? "FTPS (explicit TLS) available" : "none"]]),
        el("div", { class: "net-cred" }, [el("span", { class: "net-k", text: "Password" }), pwBox, btn("Copy", async () => toast(await copyText(c.password) ? "Password copied" : "Copy failed — select it manually", "good"))]),
        el("p", { class: "dm-hint", text: "The password isn't shown again. In FileZilla: File → Site Manager → Host, port, Logon type Normal." }),
      ]), []);
    }
    function ftpPasswordDialog(nm) {
      const pw = passwordField();
      const save = btn("Set password", async () => {
        const password = pw.value() || genPassword();
        save.disabled = true;
        try { await API.ftpPassword(nm, password); closeModal(); openModal(`New password for ${nm}`, el("div", {}, [el("div", { class: "net-cred" }, [el("span", { class: "net-k", text: "Password" }), el("input", { type: "text", readonly: "readonly", class: "net-mono net-pw-out", value: password }), btn("Copy", async () => toast(await copyText(password) ? "Copied" : "Copy failed", "good"))])]), []); }
        catch (e) { toast(e.message, "bad"); save.disabled = false; }
      }, "btn-primary");
      openModal(`Change password — ${nm}`, field("New password (8+ characters)", pw.node, "Leave empty to generate one."), [save]);
      setTimeout(() => pw.input.focus(), 30);
    }
    function ftpEditDialog(a) {
      const folder = el("input", { type: "text", value: a.folder });
      const access = el("select", {}, Object.entries(ACC).filter(([k]) => k !== "custom").map(([k, l]) => el("option", { value: k, text: l })));
      access.value = a.access === "custom" ? "full" : a.access;
      const save = btn("Save", async () => {
        save.disabled = true;
        try { await API.ftpModify({ name: a.name, folder: folder.value.trim(), access: access.value, create_folder: true }); closeModal(); toast("Updated", "good"); load(); }
        catch (e) { toast(e.message, "bad"); save.disabled = false; }
      }, "btn-primary");
      openModal(`Edit ${a.name}`, el("div", { class: "net-form" }, [field("Folder", folder), field("Access", access)]), [save]);
    }
    load();
  }

  // ---- shared: sub-tabs inside a view, remembered in the URL (#/view/tab) ----
  // prefix: when the URL arg also carries something else (e.g. an app id): "#/sysapps/vsftpd:logs"
  function subTabs(root, tabs, render, prefix) {
    const bar = el("div", { class: "cw-seg cw-seg-sm sub-tabs" });
    const pane = el("div", { class: "sub-pane" });
    root.append(bar, pane);
    const keys = tabs.map((t) => t[0]);
    const pre = prefix ? prefix + ":" : "";
    const show = (key, push) => {
      if (!keys.includes(key)) key = keys[0];
      bar.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.k === key));
      if (push) setViewArg(key === keys[0] ? (prefix || null) : pre + key);
      (state.subCleanups || []).forEach((fn) => { try { fn(); } catch (e) {} });
      state.subCleanups = [];
      pane.innerHTML = "";
      render(key, pane);
    };
    tabs.forEach(([k, label]) => bar.append(el("button", { type: "button", "data-k": k, text: label, onclick: () => show(k, true) })));
    state.cleanups.push(() => (state.subCleanups || []).forEach((fn) => { try { fn(); } catch (e) {} }));
    const arg = state.viewArg || "";
    show(pre ? (arg.startsWith(pre) ? arg.slice(pre.length) : keys[0]) : (arg || keys[0]), false);
    return { show };
  }

  // ---- shared: settings form rendered from a schema ----
  // schema: [{title, fields:[{key,label,type,help,options,min,max}]}]
  // types: bool | int | size | text | select | timezone | password | path | port
  const isOn = (v) => v === true || ["on", "yes", "true", "1"].includes(String(v == null ? "" : v).toLowerCase());
  function settingsForm(schema, values, opts = {}) {
    const inputs = {};
    const initial = { ...values };
    const overridden = new Set(opts.overridden || []);
    const reset = new Set();
    const tzList = opts.timezones || [];
    const sections = schema.map((sec) => el("div", { class: "card sf-sec" }, [
      el("h3", { text: sec.title }),
      sec.desc ? el("p", { class: "dm-hint", text: sec.desc }) : null,
      el("div", { class: "sf-grid" }, sec.fields.map((f) => {
        const v = values[f.key];
        let inp;
        if (f.type === "bool") {
          inp = el("input", { type: "checkbox", class: "sf-switch" }); inp.checked = isOn(v);
        } else if (f.type === "select") {
          inp = el("select", {}, (f.options || []).map((o) => el("option", { value: Array.isArray(o) ? o[0] : o, text: Array.isArray(o) ? o[1] : o })));
          if (v != null && ![...inp.options].some((o) => o.value === String(v))) inp.append(el("option", { value: String(v), text: `${v} (current)` }));
          inp.value = v == null ? "" : String(v);
        } else if (f.type === "timezone") {
          const listId = "tz-" + Math.random().toString(36).slice(2);
          inp = el("span", { class: "sf-combo" }, [
            el("input", { type: "text", list: listId, value: v || "", placeholder: "e.g. America/Los_Angeles" }),
            el("datalist", { id: listId }, tzList.map((z) => el("option", { value: z }))),
          ]);
          Object.defineProperty(inp, "value", { get: () => inp.firstChild.value });
        } else if (f.type === "int" || f.type === "port") {
          inp = el("input", { type: "number", value: v == null ? "" : v, min: f.min ?? (f.type === "port" ? 1 : null), max: f.max ?? (f.type === "port" ? 65535 : null) });
        } else if (f.type === "password") {
          inp = el("input", { type: "password", value: "", placeholder: v ? "(set — leave empty to keep)" : "", autocomplete: "new-password" });
        } else if (f.type === "textarea") {
          inp = el("textarea", { rows: 4, class: "cw-mono" }); inp.value = v == null ? "" : String(v);
        } else {
          inp = el("input", { type: "text", value: v == null ? "" : v, placeholder: f.placeholder || (f.type === "size" ? "e.g. 128M" : "") });
        }
        inputs[f.key] = { inp, f };
        const tag = overridden.has(f.key) ? el("button", { type: "button", class: "sf-reset", title: "Back to the default", text: "custom · reset", onclick: (e) => {
          reset.add(f.key); e.target.textContent = "will reset"; e.target.disabled = true; } }) : null;
        return el("label", { class: `sf-field ${f.type === "bool" ? "sf-bool" : ""}` }, [
          el("span", { class: "sf-label" }, [el("span", { text: f.label }), tag]),
          inp,
          f.help ? el("small", { class: "dm-hint", text: f.help }) : null,
        ]);
      })),
    ]));
    const readVal = ({ inp, f }) => f.type === "bool" ? (opts.boolValues ? (inp.checked ? opts.boolValues[0] : opts.boolValues[1]) : (inp.checked ? "On" : "Off")) : inp.value.trim();
    return {
      node: el("div", { class: "sf" }, sections),
      // Only what the user actually changed (passwords only when typed).
      changes() {
        const out = {};
        for (const [k, x] of Object.entries(inputs)) {
          const nv = readVal(x);
          if (x.f.type === "password") { if (nv) out[k] = nv; continue; }
          if (x.f.type === "bool") { if (x.inp.checked !== isOn(initial[k])) out[k] = nv; continue; }
          if (nv !== (initial[k] == null ? "" : String(initial[k]))) out[k] = nv;
        }
        return out;
      },
      resets: () => [...reset],
    };
  }

  // ======================================================================
  //  Software: PHP (settings, extensions, versions)
  // ======================================================================
  function viewPHPVersion(root) {
    const body = el("div", {}, el("div", { class: "loading", text: "Loading…" }));
    root.append(body);
    const jp = jobPanel(root);
    state.cleanups.push(jp.stop);
    let ov = null, ver = null;
    const load = () => guardedLoad(async () => {
      ov = await API.phpOverview();
      body.innerHTML = "";
      if (!ov.supported || !ov.versions.length) { body.append(el("p", { class: "empty", text: "No PHP installed. Install Apache + PHP from System Applications or Packages." })); return; }
      const webVers = ov.versions.filter((v) => v.sapis.some((s) => s !== "cli"));
      ver = ver || ov.apache || (webVers[0] || ov.versions[ov.versions.length - 1]).version;
      const verSel = el("select", { onchange: () => { ver = verSel.value; load(); } }, ov.versions.map((v) => el("option", { value: v.version, text: `PHP ${v.version}${v.version === ov.apache ? " — used by Apache" : v.sapis.includes("fpm") ? " — PHP-FPM" : v.sapis.length === 1 && v.sapis[0] === "cli" ? " — command line only" : ""}` })));
      verSel.value = ver;
      body.append(el("div", { class: "toolbar php-head" }, [el("span", { class: "muted", text: "Version:" }), verSel]));
      const host = el("div");
      body.append(host);
      subTabs(host, [["settings", "Settings"], ["extensions", "Extensions"], ["versions", "Versions"]], (tab, pane) => {
        if (tab === "settings") phpSettingsTab(pane);
        else if (tab === "extensions") phpExtensionsTab(pane);
        else phpVersionsTab(pane);
      });
    });

    function phpSettingsTab(pane) {
      const v = ov.versions.find((x) => x.version === ver);
      const labels = ov.sapi_labels;
      const primary = v.sapis.find((s) => s !== "cli") || v.sapis[0];
      const targets = {};
      const targetBox = el("div", { class: "php-targets" }, [el("span", { class: "muted", text: "Apply to:" }), ...v.sapis.map((s) => {
        const c = el("input", { type: "checkbox" }); c.checked = s !== "cli" || v.sapis.length === 1; targets[s] = c;
        return el("label", { class: "dm-check" }, [c, el("span", { text: labels[s] || s })]);
      })]);
      const formHost = el("div", {}, el("div", { class: "loading", text: "Loading…" }));
      pane.append(el("p", { class: "muted", text: `Showing the values PHP ${ver} uses for ${labels[primary] || primary}. Changes are saved as overrides — php.ini itself is never edited, and "reset" returns a value to the php.ini default.` }), targetBox, formHost);
      (async () => {
        try {
          const d = await API.phpSettings(ver, primary);
          const form = settingsForm(ov.schema, d.values, { overridden: d.overridden, timezones: ov.timezones });
          const save = btn("Save settings", async () => {
            const sapis = Object.entries(targets).filter(([, c]) => c.checked).map(([s]) => s);
            const changes = form.changes(), resets = form.resets();
            if (!Object.keys(changes).length && !resets.length) { toast("Nothing changed", "good"); return; }
            save.disabled = true;
            try { const r = await API.phpSettingsSave(ver, sapis, changes, resets); toast(`Saved${r.reloaded.length ? " — reloaded " + r.reloaded.join(", ") : ""}`, "good"); phpSettingsTabReload(); }
            catch (e) { toast(e.message, "bad"); }
            save.disabled = false;
          }, "btn-primary");
          formHost.innerHTML = "";
          formHost.append(form.node, el("div", { class: "sf-actions" }, [save, el("span", { class: "dm-hint", text: "Tip: for big uploads also raise the web server limit (Nginx client_max_body_size / Apache LimitRequestBody) in System Applications." })]));
        } catch (e) { formHost.innerHTML = ""; formHost.append(el("p", { class: "empty", text: e.message })); }
      })();
      function phpSettingsTabReload() { pane.innerHTML = ""; phpSettingsTab(pane); }
    }

    function phpExtensionsTab(pane) {
      pane.append(el("div", { class: "loading", text: "Loading extensions…" }));
      (async () => {
        try {
          const d = await API.phpExtensions(ver);
          pane.innerHTML = "";
          const labels = ov.sapi_labels;
          pane.append(el("h3", { class: "section-title", text: "Popular extensions" }),
            el("div", { class: "php-ext-grid" }, d.popular.filter((p) => p.installed || p.available).map((p) => el("div", { class: "php-ext" }, [
              el("div", {}, [el("b", { text: p.ext }), el("div", { class: "dm-hint", text: p.desc })]),
              p.installed ? pill("installed", "good") : btn("Install", async () => { try { const r = await API.phpExtInstall(ver, p.ext); watchJob(jp, r.job, `Installing ${p.package}`, () => { pane.innerHTML = ""; phpExtensionsTab(pane); }); } catch (e) { toast(e.message, "bad"); } }),
            ]))));
          pane.append(el("h3", { class: "section-title", text: "Enable / disable" }),
            el("p", { class: "dm-hint", text: "Turn loaded extensions on or off per mode. The web server reloads automatically." }),
            simpleTable(["Extension", ...d.sapis.map((s) => labels[s] || s)], d.modules.map((m) => row(el("code", { text: m.name }),
              ...d.sapis.map((s) => { const c = el("input", { type: "checkbox", class: "sf-switch" }); c.checked = m.enabled[s];
                c.onchange = async () => { c.disabled = true; try { await API.phpExtToggle(ver, m.name, s, c.checked); toast(`${m.name} ${c.checked ? "enabled" : "disabled"} (${s})`, "good"); } catch (e) { c.checked = !c.checked; toast(e.message, "bad"); } c.disabled = false; };
                return c; })))));
        } catch (e) { pane.innerHTML = ""; pane.append(el("p", { class: "empty", text: e.message })); }
      })();
    }

    function phpVersionsTab(pane) {
      pane.append(el("div", { class: "card" }, [
        el("h3", { text: "Websites (Apache)" }),
        ov.apache_available.length ? el("div", { class: "toolbar", style: "margin:8px 0 0" }, ov.apache_available.map((v) => btn(`PHP ${v}`, async () => {
          if (v === ov.apache) return;
          if (!confirmInline(`Switch Apache to PHP ${v}? Apache restarts; check your sites afterwards.`)) return;
          try { await API.phpApacheVersion(v); toast(`Apache now uses PHP ${v}`, "good"); load(); } catch (e) { toast(e.message, "bad"); }
        }, v === ov.apache ? "btn-primary" : ""))) : el("p", { class: "muted", text: "Apache has no PHP module installed." }),
      ]), el("div", { class: "card" }, [
        el("h3", { text: "Command line & cron (php)" }),
        el("div", { class: "toolbar", style: "margin:8px 0 0" }, ov.versions.filter((x) => x.sapis.includes("cli")).map((x) => btn(`PHP ${x.version}`, async () => {
          try { await API.phpSet(x.version); toast(`Command-line PHP → ${x.version}`, "good"); load(); } catch (e) { toast(e.message, "bad"); }
        }, x.version === ov.cli_default ? "btn-primary" : ""))),
      ]));
    }
    state.refreshHandler = load; load();
  }

  // ======================================================================
  //  Preferences
  // ======================================================================
  function viewPassword(root) {
    root.append(el("div", { class: "card" }, [
      el("h3", { text: "Change panel password" }),
      el("div", { style: "display:flex;flex-direction:column;gap:12px;max-width:380px" }, [
        labeledInput("pw-cur", "Current password", "", "", "password"),
        labeledInput("pw-new", "New password (min 8)", "", "", "password"),
        labeledInput("pw-new2", "Confirm new password", "", "", "password"),
        el("button", { class: "btn btn-primary", style: "align-self:flex-start", text: "Update password", onclick: async () => {
          const cur = $("#pw-cur").value, nw = $("#pw-new").value, nw2 = $("#pw-new2").value;
          if (nw !== nw2) { toast("Passwords don't match", "bad"); return; }
          try { await API.passwordChange(cur, nw); toast("Password updated", "good"); $("#pw-cur").value = $("#pw-new").value = $("#pw-new2").value = ""; }
          catch (e) { toast(e.message, "bad"); } } }),
      ]),
      el("p", { class: "muted", style: "margin-top:14px;font-size:12px", text: "Tip: also enable Two-Factor Authentication (Security → Two-Factor) for extra protection." }),
    ]));
  }
  function viewAccountPrefs(root) {
    const body = el("div", {}, el("div", { class: "loading", text: "Loading…" }));
    root.append(body);
    (async () => {
      const p = await API.prefs().catch(() => ({}));
      body.innerHTML = "";
      body.append(el("div", { class: "card" }, [
        el("h3", { text: "Account preferences" }),
        el("div", { style: "display:flex;flex-direction:column;gap:12px;max-width:380px" }, [
          labeledInput("ac-user", "Admin username", "", p.username || ""),
          el("label", { class: "muted", style: "display:flex;flex-direction:column;gap:6px;font-size:13px" }, ["Default theme",
            el("select", { id: "ac-theme" }, ["dark", "light"].map((t) => el("option", { value: t, text: t, ...(p.default_theme === t ? { selected: "selected" } : {}) })))]),
          el("button", { class: "btn btn-primary", style: "align-self:flex-start", text: "Save", onclick: async () => {
            try {
              const u = $("#ac-user").value.trim();
              if (u && u !== p.username) await API.renameUser(u);
              await API.prefsSet({ default_theme: $("#ac-theme").value });
              applyTheme($("#ac-theme").value); try { localStorage.setItem("aurora-theme", $("#ac-theme").value); } catch (e) {}
              toast("Saved", "good");
            } catch (e) { toast(e.message, "bad"); } } }),
        ]),
      ]));
    })();
  }
  function viewContact(root) {
    const body = el("div", {}, el("div", { class: "loading", text: "Loading…" }));
    root.append(body);
    (async () => {
      const p = await API.prefs().catch(() => ({}));
      body.innerHTML = "";
      body.append(el("div", { class: "card" }, [
        el("h3", { text: "Contact information" }),
        el("p", { class: "muted", style: "margin:0 0 12px", text: "Where the panel would send notifications (informational for now)." }),
        el("div", { style: "display:flex;gap:10px;max-width:440px" }, [
          el("input", { id: "ct-email", type: "email", placeholder: "you@example.com", value: p.contact_email || "", style: "flex:1" }),
          el("button", { class: "btn btn-primary", text: "Save", onclick: async () => { try { await API.prefsSet({ contact_email: $("#ct-email").value.trim() }); toast("Saved", "good"); } catch (e) { toast(e.message, "bad"); } } }),
        ]),
      ]));
    })();
  }
  // ---- About & Updates ----
  const REDDIT_URL = "https://www.reddit.com/r/RASPBERRY_PI_PROJECTS/comments/1ws2int/made_a_web_control_panel_for_raspberry_pi_and/";
  const FORUM_URL = "https://forums.raspberrypi.com/viewtopic.php?p=2388892";
  function viewAbout(root) {
    const body = el("div", {}, el("div", { class: "loading", text: "Loading…" }));
    root.append(body);
    const result = el("div");
    (async () => {
      let a;
      try { a = await API.about(); } catch (e) { body.innerHTML = ""; body.append(el("p", { class: "empty", text: e.message })); return; }
      body.innerHTML = "";
      const check = btn("Check for updates", async () => {
        check.disabled = true; result.innerHTML = ""; result.append(el("div", { class: "loading", text: "Asking aurora51.com…" }));
        try { showResult(await API.aboutCheck()); }
        catch (e) { result.innerHTML = ""; result.append(el("div", { class: "card net-warn" }, el("p", { text: e.message }))); }
        check.disabled = false;
      }, "btn-primary");
      const changes = el("div");
      const viewChanges = btn("View changes", async () => {
        if (changes.childNodes.length) { changes.innerHTML = ""; return; }  // toggle
        viewChanges.disabled = true; changes.append(el("div", { class: "loading", text: "Loading the change log…" }));
        try { showChanges(await API.aboutChangelog()); }
        catch (e) { changes.innerHTML = ""; changes.append(el("div", { class: "card net-warn" }, el("p", { text: e.message }))); }
        viewChanges.disabled = false;
      }, "btn-ghost");
      body.append(el("div", { class: "card about-card" }, [
        el("div", { class: "about-head" }, [
          el("span", { class: "about-logo", html: POLAR_BEAR }),
          el("div", {}, [el("h2", { text: "AuroraPanel" }), el("div", { class: "about-ver" }, [pill(a.label, "warn"), el("span", { class: "muted", text: ` released ${a.released}` })])]),
        ]),
        el("p", { class: "muted", text: "A free, open-source (MIT) hobby control panel for the Raspberry Pi. This is a beta — things may break, so please report anything odd." }),
        kv([["Version", a.version], ["Installed in", a.install_dir], ["Website", el("a", { href: a.site, target: "_blank", rel: "noopener noreferrer", text: "aurora51.com ↗" })]]),
        el("div", { class: "toolbar", style: "margin:16px 0 0" }, [check, viewChanges,
          el("a", { class: "btn btn-sm btn-ghost", href: REDDIT_URL, target: "_blank", rel: "noopener noreferrer", text: "Feedback on Reddit ↗" }),
          el("a", { class: "btn btn-sm btn-ghost", href: FORUM_URL, target: "_blank", rel: "noopener noreferrer", text: "Raspberry Pi Forums ↗" })]),
        el("p", { class: "dm-hint", text: "The panel never contacts the internet on its own — it only asks aurora51.com for the latest version or the change log when you click one of these buttons." }),
      ]), changes, result);

      function showChanges(c) {
        changes.innerHTML = "";
        changes.append(el("div", { class: "card about-changes" }, [
          el("div", { class: "net-card-h" }, [icon("info", 20), el("h3", { text: "What's changed" }), el("span", { style: "flex:1" }), pill(`you have ${c.label}`, "warn")]),
          ...(c.releases.length ? c.releases.map((rel) => el("div", { class: `about-rel${rel.newer ? " about-rel-new" : ""}` }, [
            el("h4", {}, [rel.label, " ", el("span", { class: "muted", text: rel.released ? `· ${rel.released}` : "" }), " ",
              rel.newer ? pill("new", "good") : rel.current ? pill("installed", "dim") : null].filter(Boolean)),
            el("ul", { class: "about-notes" }, rel.notes.map((n) => el("li", { text: n }))),
          ])) : [el("p", { class: "muted", text: "No releases listed yet." })]),
        ]));
      }

      // One-click update: the server downloads + verifies the release and a background
      // job installs it; the panel restarts, so poll until the new version answers.
      async function installUpdate(r, box) {
        if (!confirmInline(`Install ${r.latest_label} now?\n\nThe panel restarts during the update (about a minute). Your admin account, settings, VPNs and sites are kept, and the previous version is restored automatically if the new one doesn't start.`)) return;
        box.innerHTML = "";
        const pre = el("pre", { class: "log", text: "Downloading and verifying the release…" });
        const title = el("h4", { text: `Installing ${r.latest_label}…` });
        box.append(title, pre);
        try { await API.aboutUpdate(); }
        catch (e) { title.textContent = "Update not started"; pre.textContent = e.message; return; }
        const started = Date.now();
        const t = setInterval(async () => {
          try {
            const s = await API.aboutUpdateStatus();
            if (s.log.length) pre.textContent = s.log.join("\n");
            pre.scrollTop = pre.scrollHeight;
            if (s.version === r.latest) {
              clearInterval(t); title.textContent = `Updated to ${r.latest_label}`;
              toast(`Updated to ${r.latest_label} — reloading`, "good");
              setTimeout(() => location.reload(), 1500);
            } else if (!s.running && s.log.some((l) => l.startsWith("✖"))) {
              clearInterval(t); title.textContent = "Update failed — the previous version was kept";
            }
          } catch (e) { pre.textContent = pre.textContent.replace(/\n?… panel restarting$/, "") + "\n… panel restarting"; }
          if (Date.now() - started > 6 * 60 * 1000) {
            clearInterval(t); title.textContent = "Still not done after 6 minutes";
            pre.textContent += "\nCheck it over SSH: sudo journalctl -u aurorapanel-update  (log: /var/lib/aurora/updates/update.log)";
          }
        }, 2000);
        state.cleanups.push(() => clearInterval(t));
      }

      function showResult(r) {
        result.innerHTML = "";
        if (!r.update_available) {
          result.append(el("div", { class: "card about-result" }, [el("div", { class: "net-card-h" }, [icon("shield", 20), el("h3", { text: "You're up to date" }), el("span", { style: "flex:1" }), pill(r.label, "good")]),
            el("p", { class: "muted", text: `The newest release is ${r.latest_label}${r.latest_released ? ` (${r.latest_released})` : ""}.` })]));
          return;
        }
        const cmd = el("pre", { class: "log", text: r.update_command || a.update_command });
        const progress = el("div");
        result.append(el("div", { class: "card about-update" }, [
          el("div", { class: "net-card-h" }, [icon("refresh", 20), el("h3", { text: `${r.latest_label} is available` }), el("span", { style: "flex:1" }), pill(`you have ${r.label}`, "warn")]),
          r.latest_released ? el("p", { class: "muted", text: `Released ${r.latest_released}.` }) : null,
          r.notes.length ? el("div", {}, [el("h4", { text: "What's new" }), el("ul", { class: "about-notes" }, r.notes.map((n) => el("li", { text: n })))]) : null,
          r.auto_update ? el("div", { class: "toolbar", style: "margin:14px 0 0" }, [
            btn(`Install ${r.latest_label}`, () => installUpdate(r, progress), "btn-primary"),
            el("span", { class: "muted", text: "Downloads from aurora51.com, checks the file's checksum, and installs it." })]) : null,
          progress,
          el("h4", { text: r.auto_update ? "Or update manually" : "How to update" }),
          el("p", { class: "muted", text: "Run this in the Terminal (Advanced → Terminal) or over SSH. It downloads the new version over this install and re-runs the installer — your admin account, settings, VPNs and sites are kept." }),
          cmd,
          el("div", { class: "toolbar", style: "margin:10px 0 0" }, [
            btn("Copy command", async () => toast(await copyText(cmd.textContent) ? "Command copied" : "Copy failed — select it manually", "good"), "btn-primary"),
            btn("Open Terminal", () => navigate("terminal"), "btn-ghost"),
            el("a", { class: "btn btn-sm btn-ghost", href: r.download, text: "Download zip" })]),
        ]));
      }
    })();
  }

  function viewLanguage(root) {
    root.append(el("div", { class: "card" }, [
      el("h3", { text: "Change language" }),
      el("p", { class: "muted", style: "margin:0 0 12px", text: "Interface language. Only English is bundled right now — more can be added." }),
      el("select", { id: "lang-sel", style: "max-width:220px", onchange: async () => { try { await API.prefsSet({ language: $("#lang-sel").value }); toast("Saved", "good"); } catch (e) {} } },
        [["en", "English"]].map(([v, t]) => el("option", { value: v, text: t }))),
    ]));
  }

  // ======================================================================
  //  Modal + inline confirm/prompt (no native dialogs)
  // ======================================================================
  function openModal(title, bodyNode, footButtons) {
    closeModal();
    const backdrop = el("div", { class: "modal-backdrop", id: "modal",
      onclick: (e) => { if (e.target.id === "modal") closeModal(); } }, [
      el("div", { class: "modal" }, [
        el("div", { class: "modal-head" }, [
          el("h3", { text: title }),
          el("button", { class: "btn btn-sm btn-ghost", text: "✕", onclick: closeModal }),
        ]),
        el("div", { class: "modal-body" }, bodyNode),
        el("div", { class: "modal-foot" }, [
          ...footButtons,
          el("button", { class: "btn", text: "Close", onclick: closeModal }),
        ]),
      ]),
    ]);
    document.body.appendChild(backdrop);
  }
  function closeModal() { const m = $("#modal"); if (m) m.remove(); }

  // Lightweight synchronous confirm/prompt using window dialogs where allowed,
  // falling back gracefully. (Served over http on the LAN, dialogs are fine.)
  function confirmInline(msg) { return window.confirm(msg); }
  function promptInline(msg, def) { return window.prompt(msg, def !== undefined ? def : ""); }

  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

  // ======================================================================
  //  Applications → WordPress one-click installer
  // ======================================================================
  const WP_LOGO = '<svg viewBox="0 0 24 24" width="34" height="34" fill="currentColor"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-8.8 10c0-1.3.3-2.5.8-3.6l4.2 11.6A8.8 8.8 0 0 1 3.2 12zm8.8 8.8c-.9 0-1.7-.1-2.5-.4l2.6-7.7 2.7 7.4v.1c-.9.4-1.8.6-2.8.6zm1.2-12.9c.5 0 1-.1 1-.1.5-.1.4-.8-.1-.7 0 0-1.4.1-2.3.1-.9 0-2.3-.1-2.3-.1-.5 0-.5.7-.1.7 0 0 .4.1.9.1l1.3 3.6-1.9 5.6L6.5 7.9c.5 0 1-.1 1-.1.5-.1.4-.8-.1-.7 0 0-1.4.1-2.3.1h-.5A8.8 8.8 0 0 1 17.9 5.5h-.1c-.9 0-1.5.8-1.5 1.6 0 .7.4 1.3.9 2.1.3.6.7 1.3.7 2.4 0 .7-.3 1.6-.6 2.8l-.8 2.8-3.1-9.3zm3.2 11.8 2.7-7.8c.5-1.3.7-2.3.7-3.2l-.1-.9a8.8 8.8 0 0 1-3.3 11.9z"/></svg>';

  function viewWordPress(root) {
    const w = { mode: "new_domain", setup: true };
    let st = null;
    const hero = el("div", { class: "wp-hero" });
    const form = el("div", { class: "wp-grid" });
    const list = el("div");
    root.append(hero, form, el("h2", { class: "section-title", style: "margin-top:30px", text: "Installed WordPress sites" }), list);
    hero.innerHTML = `<div class="wp-logo">${WP_LOGO}</div><div><h2>Install WordPress</h2><p>Downloads the latest release straight from <b>wordpress.org</b>, creates the database, writes <code>wp-config.php</code> and sets up your admin account — about a minute on a Pi 5.</p><div class="wp-checks" id="wp-checks"><span class="loading" style="padding:0">Checking PHP &amp; MariaDB…</span></div></div>`;

    // ---------- step 1: where ----------
    const where = el("div", { class: "card dmm-card" });
    const whereBody = el("div", { class: "wp-where" });
    const preview = el("div", { class: "wp-preview" });
    const modes = [["new_domain", "New domain"], ["subdomain", "New subdomain"], ["existing", "Existing site"], ["folder", "Custom folder"]];
    const seg = el("div", { class: "cw-seg" }, modes.map(([m, l]) => el("button", { type: "button", class: m === w.mode ? "active" : "", text: l, onclick: (e) => {
      w.mode = m; seg.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === e.target)); drawWhere();
    } })));
    where.append(el("div", { class: "cw-card-h" }, [icon("globe", 16), el("div", {}, [el("h3", { text: "1 · Where should it live?" }), el("p", { text: "Create a fresh domain for it, or drop it into a site you already have." })])]), seg, whereBody, preview);

    const inp = (key, ph, extra = {}) => { const i = el("input", { type: "text", placeholder: ph, value: w[key] || "", oninput: (e) => { w[key] = e.target.value.trim(); updPreview(); }, ...extra }); return i; };
    const chk = (key, label, def) => { if (w[key] === undefined) w[key] = def; const c = el("input", { type: "checkbox", onchange: (e) => { w[key] = e.target.checked; updPreview(); } }); c.checked = w[key]; return el("label", { class: "dm-check" }, [c, el("span", { html: label })]); };
    const lab = (l, i, hint) => el("label", { class: "cw-lbl" }, [l, i, hint ? el("span", { class: "dm-hint", text: hint }) : null]);
    const userSites = () => (st ? st.sites.filter((s) => !s.system) : []);

    function drawWhere() {
      whereBody.innerHTML = "";
      if (w.mode === "new_domain") whereBody.append(
        lab("Domain", inp("domain", "myblog.com  or  blog.test")),
        chk("www", "Also answer on <b>www.</b>", true),
        chk("ssl", "Enable HTTPS now (self-signed — switch to Let's Encrypt in Domains → Manage)", false));
      if (w.mode === "subdomain") {
        const sel = el("select", { onchange: (e) => { w.parent = e.target.value; updPreview(); } }, userSites().map((s) => el("option", { value: s.server_name.replace(/^www\./, ""), text: s.server_name.replace(/^www\./, "") })));
        if (!w.parent && sel.options.length) w.parent = sel.value; else if (w.parent) sel.value = w.parent;
        whereBody.append(el("div", { class: "wp-row" }, [lab("Subdomain", inp("subdomain", "blog")), el("span", { class: "wp-dot", text: "." }), lab("Of domain", sel.options.length ? sel : el("span", { class: "muted", text: "No domains yet — add one in Domains" }))]),
          chk("ssl", "Enable HTTPS now (self-signed)", false),
          el("p", { class: "dm-hint", text: "Remember to add the subdomain in DNS (Zone Editor → + A Record) or your hosts file." }));
      }
      if (w.mode === "existing") {
        const sel = el("select", { onchange: (e) => { w.site = e.target.value; updPreview(); } }, userSites().map((s) => el("option", { value: s.server_name, text: `${s.server_name}  —  ${s.docroot}` })));
        if (!w.site && sel.options.length) w.site = sel.value; else if (w.site) sel.value = w.site;
        if (w.subfolder === undefined) w.subfolder = "blog";
        whereBody.append(lab("Site", sel.options.length ? sel : el("span", { class: "muted", text: "No sites yet — add one in Domains" })),
          lab("Sub-folder (optional)", inp("subfolder", "blog  →  example.com/blog"), "Leave empty to install at the site's root."),
          chk("overwrite", "Install even if the folder already has files", false));
      }
      if (w.mode === "folder") whereBody.append(
        lab("Folder", inp("path", "/var/www/html/wordpress")),
        lab("It will be reachable at", inp("url", `http://${location.hostname}/wordpress`), "The folder must already be served by Apache at this address."),
        chk("overwrite", "Install even if the folder already has files", false));
      updPreview();
    }
    function target() {
      const sub = (w.subfolder || "").replace(/^\/+|\/+$/g, "");
      if (w.mode === "new_domain" && w.domain) return { url: `${w.ssl ? "https" : "http"}://${w.domain.toLowerCase()}`, path: `/var/www/${w.domain.toLowerCase()}` };
      if (w.mode === "subdomain" && w.subdomain && w.parent) { const h = `${w.subdomain.toLowerCase()}.${w.parent}`; return { url: `${w.ssl ? "https" : "http"}://${h}`, path: `/var/www/${h}` }; }
      if (w.mode === "existing" && w.site) { const s = userSites().find((x) => x.server_name === w.site); if (s) return { url: `${s.ssl !== "none" ? "https" : "http"}://${s.server_name}${sub ? "/" + sub : ""}`, path: `${s.docroot}${sub ? "/" + sub : ""}` }; }
      if (w.mode === "folder" && w.path) return { url: w.url || "?", path: w.path };
      return null;
    }
    function updPreview() {
      const t = target();
      preview.innerHTML = t ? `${I("link", 14)}<span><b>${esc(t.url)}/</b></span><span class="muted">→</span><code>${esc(t.path)}</code>` : `<span class="muted">Fill in the details to see where WordPress will go.</span>`;
    }

    // ---------- step 2: site ----------
    const siteCard = el("div", { class: "card dmm-card" });
    const pw = el("input", { type: "password", placeholder: "at least 10 characters", autocomplete: "new-password", oninput: (e) => { w.admin_pass = e.target.value; meter(); } });
    const pwMeter = el("div", { class: "wp-meter" }, el("span"));
    function meter() {
      const v = pw.value; let s = 0;
      if (v.length >= 10) s++; if (v.length >= 16) s++; if (/[A-Z]/.test(v) && /[a-z]/.test(v)) s++; if (/\d/.test(v)) s++; if (/[^A-Za-z0-9]/.test(v)) s++;
      pwMeter.firstChild.style.width = `${(s / 5) * 100}%`; pwMeter.className = `wp-meter s${s}`;
    }
    const gen = el("button", { type: "button", class: "btn btn-sm", onclick: async () => { try { const r = await API.appPassword(); pw.value = r.password; pw.type = "text"; w.admin_pass = r.password; meter(); } catch (e) { toast(e.message, "bad"); } } }, [icon("refresh", 12), " Generate"]);
    const eye = el("button", { type: "button", class: "btn btn-sm btn-ghost", text: "Show", onclick: () => { pw.type = pw.type === "password" ? "text" : "password"; eye.textContent = pw.type === "password" ? "Show" : "Hide"; } });
    const setupBox = el("div", { class: "wp-setup" }, [
      lab("Site title", inp("title", "My WordPress Site")),
      el("div", { class: "dm-row2 wp-two" }, [lab("Admin username", inp("admin_user", "not “admin”", { autocomplete: "off" })), lab("Admin email", inp("admin_email", "you@example.com", { type: "email" }))]),
      el("label", { class: "cw-lbl" }, ["Admin password", el("div", { class: "wp-pw" }, [pw, eye, gen]), pwMeter, el("span", { class: "dm-hint", text: "Save it in your password manager — AuroraPanel doesn't keep a copy." })]),
      chk("hide_search", "Ask search engines not to index this site (good for test sites)", false),
    ]);
    const setupToggle = el("div", { class: "dm-trow" }, [el("div", {}, [el("b", { text: "Set up the admin account now" }), el("span", { text: "Off = you'll finish WordPress's “famous 5-minute install” in the browser." })]),
      sw(true, (v) => { w.setup = v; setupBox.classList.toggle("dm-dim", !v); })]);
    siteCard.append(el("div", { class: "cw-card-h" }, [icon("users", 16), el("div", {}, [el("h3", { text: "2 · Your site" }), el("p", { text: "Title and the administrator you'll log in with." })])]), setupToggle, setupBox);

    // ---------- install ----------
    const log = el("pre", { class: "log wp-log", hidden: true });
    const result = el("div");
    const go = el("button", { class: "btn btn-primary wp-go", onclick: install }, [el("span", { class: "wp-go-ico", html: WP_LOGO }), el("span", { text: "Install WordPress" })]);
    form.append(where, siteCard, el("div", { class: "wp-actions" }, [el("span", { class: "dm-hint", text: "Needs Apache + PHP + MariaDB. Missing PHP extensions are installed automatically." }), go]), log, result);

    async function install() {
      const t = target();
      if (!t) return toast("Tell me where to install it first", "bad");
      const o = { mode: w.mode, domain: w.domain, www: w.www, ssl: w.ssl, subdomain: w.subdomain, parent: w.parent, site: w.site,
        subfolder: w.subfolder, path: w.path, url: w.url, overwrite: w.overwrite, setup: w.setup,
        title: w.title || "My WordPress Site", admin_user: w.admin_user, admin_email: w.admin_email, admin_pass: pw.value, public: !w.hide_search };
      go.disabled = true; result.innerHTML = ""; log.hidden = false; log.textContent = "Starting…";
      try {
        const r = await API.wpInstall(o);
        const tick = async () => {
          const j = await API.job(r.job);
          log.textContent = j.output || "…"; log.scrollTop = log.scrollHeight;
          if (j.status === "running") return setTimeout(tick, 1200);
          go.disabled = false;
          if (j.status === "done" && j.result) {
            const e = j.result;
            result.append(el("div", { class: "wp-done" }, [
              el("div", { class: "wp-logo", html: WP_LOGO }),
              el("div", {}, [el("h3", { text: `WordPress ${e.version || ""} is ready 🎉` }),
                el("p", { class: "muted", html: `Files: <code>${esc(e.path)}</code> · Database: <code>${esc(e.db)}</code>` }),
                el("div", { class: "wp-links" }, [
                  el("a", { class: "btn btn-sm", href: e.url + "/", target: "_blank", rel: "noopener" }, [icon("link", 13), " Visit site"]),
                  el("a", { class: "btn btn-sm btn-primary", href: e.url + (o.setup ? "/wp-admin/" : "/wp-admin/install.php"), target: "_blank", rel: "noopener" }, [icon("lock", 13), o.setup ? " Open WP Admin" : " Finish setup"]),
                ]),
                /\.(test|local|localhost)(\/|$)/.test(e.url) ? el("p", { class: "dm-hint", text: "Local domain: add it to your computer's hosts file (Domains → 🔍 shows the exact line)." }) : null,
              ]),
            ]));
            pw.value = ""; w.admin_pass = ""; toast("WordPress installed", "good"); loadList();
          } else toast("Install failed — see the log", "bad");
        };
        tick();
      } catch (e) { go.disabled = false; log.hidden = true; toast(e.message, "bad"); }
    }

    async function loadList() {
      list.innerHTML = "";
      if (!st.installed.length) { list.append(el("div", { class: "cw-empty" }, [el("div", { class: "wp-logo", html: WP_LOGO }), el("b", { text: "No WordPress sites yet" }), el("span", { class: "muted", text: "Your first one is two steps away." })])); return; }
      list.append(el("div", { class: "wp-list" }, st.installed.map((it) => el("div", { class: `wp-item ${it.exists ? "" : "gone"}` }, [
        el("div", { class: "wp-logo sm", html: WP_LOGO }),
        el("div", { class: "wp-item-main" }, [
          el("b", { text: it.url || it.path }),
          el("span", { class: "muted", html: `<code>${esc(it.path)}</code>${it.db ? ` · DB <code>${esc(it.db)}</code>` : ""}` }),
          el("span", { class: "dm-tags" }, [it.version ? el("span", { class: "pill good", text: "v" + it.version }) : null, it.detected ? el("span", { class: "pill dim", text: "found on disk" }) : null, !it.exists ? el("span", { class: "pill bad", text: "folder missing" }) : null]),
        ]),
        el("div", { class: "actions" }, [
          it.url ? el("a", { class: "btn btn-sm", href: it.url + "/", target: "_blank", rel: "noopener" }, [icon("link", 12), " Site"]) : null,
          it.url ? el("a", { class: "btn btn-sm", href: it.url + "/wp-admin/", target: "_blank", rel: "noopener" }, [icon("lock", 12), " Admin"]) : null,
          el("button", { class: "btn btn-sm btn-danger", onclick: async () => {
            if (!confirmInline(`Remove WordPress at ${it.url || it.path}?\n\nFiles are moved to /var/lib/aurora/trash (recoverable) and the database ${it.db || ""} is DELETED.`)) return;
            const rmSite = it.created_site && confirmInline("Also remove the Apache site that was created for it?");
            try { const r = await API.appRemove2(it.path, true, rmSite); toast(`Removed · files kept in ${r.files_moved_to}`, "good"); load(); } catch (e) { toast(e.message, "bad"); }
          } }, [icon("error", 12), " Remove"]),
        ]),
      ]))));
    }
    const load = async () => {
      await guardedLoad(async () => {
        st = await API.appsStatus();
        const ok = (b, t) => `<span class="pill ${b ? "good" : "bad"}">${b ? "✓" : "✕"} ${esc(t)}</span>`;
        $("#wp-checks", hero).innerHTML = ok(!!st.php_bin, `PHP ${st.php_version || "?"}`) + ok(st.mysql, "MariaDB")
          + (st.php_missing.length ? `<span class="pill warn" title="Installed automatically during setup">+ ${esc(st.php_missing.join(", "))}</span>` : `<span class="pill good">✓ all PHP extensions</span>`);
        drawWhere(); loadList();
      });
    };
    state.refreshHandler = load; load();
  }

  // ---- go ----
  boot();
})();
