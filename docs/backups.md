# Backups

AuroraPanel has three ways to keep copies:

1. **Files → Backups** — back up a folder or a single database now; upload and import `.sql`
   dumps; restore several at once.
2. **Backup Wizard** — a full or partial backup (website files, databases) and selective restore.
3. **Scheduled Backups** — automatic, optionally encrypted, sent off this machine.

## Scheduled backups

A *plan* says:

- **what** — websites, databases, mailboxes, the panel's own settings, extra folders;
- **when** — hourly, daily, weekly or monthly at a set time;
- **how many** copies to keep (older ones are pruned at the destination);
- **where** — a destination.

Destinations:

| Type | Notes |
| ---- | ----- |
| Local disk | Another folder or disk on this machine (e.g. a USB drive). |
| S3 | Amazon S3 and S3-compatible storage: Cloudflare R2, Wasabi, MinIO, DigitalOcean Spaces… |
| Backblaze B2 | Bucket + application key. |
| SFTP | Any SSH server; password or key. |
| WebDAV | Nextcloud, ownCloud and other WebDAV servers. |
| rclone remote | Paste any rclone remote configuration (e.g. Google Drive, OneDrive). |

Off-site destinations use [rclone](https://rclone.org), which the page installs when needed. Its
configuration lives in `/var/lib/aurora/rclone.conf` (root-only).

### Encryption

Turn on encryption in a plan and every archive is encrypted with AES-256 *before* it leaves the
server. The passphrase is generated per plan and kept in `/var/lib/aurora/backup-keys/`
(root-only). Use **Show passphrase** and keep it somewhere safe outside this server (a password
manager) — without it the off-site copies can't be opened, for example if this server is lost.

### Restoring

On a plan, **Copies & restore** lists the copies at the destination. **Restore…** brings one back
to this machine (decrypting it) and opens it in Files → Backups, where it restores like any other
backup. **Back up now** runs a plan immediately; **Log** shows the last run.

### How runs happen

The background task runner starts each due run as its own systemd unit (`aurora-backup-<plan>`),
so long backups don't block anything and survive a panel restart. A failed run raises an
[alert](alerts-and-activity.md) when backup alerts are on.
