# Moving from cPanel

**Files → Move from cPanel** imports a cPanel **full account backup** (`cpmove-USER.tar.gz` or
`backup-DATE_USER.tar.gz`).

## 1. Get the backup onto this server

In the old cPanel: **Files → Backup → Download a Full Account Backup** (or ask your host for a
"cpmove" file). Then either

- upload it to the import folder shown on the page (File Manager or SFTP), or
- paste a download link and press **Download**.

Backups in the import folder, the backups folder, `/root` and home folders are listed.

## 2. Look inside and choose

**Look inside** reads the backup's table of contents (it isn't unpacked yet) and lists:

- **Websites** — the main domain, addon domains and subdomains with their folders and aliases;
- **Databases** — with their sizes;
- **Email** — mailboxes and forwarders;
- **DNS zones** — off by default; tick only if this server will answer DNS for the domains.

## 3. Import

| What | How it comes across |
| ---- | ------------------- |
| Websites | A new site per domain in `/var/www/<domain>` with a self-signed certificate until DNS points here (then AutoSSL replaces it). |
| Databases | Created and loaded. Database users are recreated **with their existing passwords** (cPanel keeps the password hashes), so `wp-config.php` and similar files keep working unchanged. |
| Mailboxes | Created with their **existing passwords** and all their mail. Needs the mail server set up first; otherwise email is skipped and can be imported later with only email ticked. |
| Forwarders | Address forwarders, `:fail:` (bounce with a message) and `:blackhole:` (discard). Forwarders to programs (pipes) can't be moved and are listed as skipped. |
| DNS zones | Written to the zone editor. Change the A records to this server's IP before switching nameservers. |

Nothing that already exists here is overwritten — existing sites, databases and mailboxes are
reported as skipped, so an import can be run again safely.

## Afterwards

Point the domains' DNS at this server. Once they resolve here, AutoSSL issues real certificates.
