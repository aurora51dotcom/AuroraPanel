# Alerts and the activity log

## Alerts

**System → Alerts** tells you when something needs attention. Each problem is sent once when it
starts, repeated as a reminder (every 24 hours by default) while it lasts, and followed by a
"resolved" message when it ends.

Channels (use any combination):

- **Email** — through this server's own mail server, or any address it can deliver to.
- **Telegram** — a bot token and chat ID.
- **Webhook** — generic JSON, Discord, Slack or ntfy.

What is watched (each can be tuned or switched off):

| Rule | Default |
| ---- | ------- |
| Disk usage | above 90 % |
| Memory | above 95 % |
| Temperature (Pi) | above 80 °C |
| Under-voltage / throttling (Pi) | on |
| Services stopped | web server, database, mail, DNS, fail2ban, FTP, VPN, Docker, PHP-FPM |
| Certificates expiring | within 14 days |
| WAF attack burst | 50 blocked requests in a few minutes |
| Failed logins | 20 in a short time |
| Scheduled backup failed | on |
| Updates waiting | on |
| Reboot required | on |

**Send a test alert** checks the channels. **Pause all alerts** stops sending; problems are still
recorded.
Checks run every minute from the `aurora-tasks.timer` systemd timer, so alerts still arrive when the
panel itself is stopped.

## Activity log

**Security → Activity Log** lists every change made through the panel — who (panel user or API
token), from which address, what, and whether it worked — plus logins and what the background tasks
did on their own. Simply viewing pages isn't recorded; refused actions are. Passwords, keys and
tokens are never written to the log.

The log is kept in `/var/lib/aurora/audit.jsonl` and rotated automatically. Search it, filter by
user, period or failures only, and **Export CSV**.
